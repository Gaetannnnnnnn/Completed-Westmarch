import { MOD } from "./const.js";
// ============================================================
// map.js — Logique du module autonome MOD,
// indépendant de westmarch (settings + flags namespacés
// MOD).
// ============================================================

export function MapHooks() {

    // ---- Queries de coordination de la fog (ciblent LE client d'un joueur) ----
    // Un onglet en arrière-plan est throttlé par le navigateur et ne « commit »
    // plus sa fog tout seul. Le GM peut donc demander explicitement au client
    // concerné de persister sa fog (avant un swap) ou de la recharger (après).
    // Le client renvoie sa PROPRE fog (le GM n'a pas accès au FogExploration des
    // autres joueurs). Si le joueur regarde la scène, on commit d'abord le canvas.
    CONFIG.queries["westmarch.fogCommit"] = async () => {
        try {
            const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
            if (!sceneId) return { ok: false };
            if (canvas?.scene?.id === sceneId) { canvas.fog?.commit?.(); await canvas.fog?.save?.(); }
            const fog = game.collections.get("FogExploration").find(f => f.scene === sceneId && f.user === game.user.id);
            return fog
                ? { ok: true, explored: fog.explored, positions: fog.positions, timestamp: fog.timestamp, forChar: fog.getFlag(MOD, "forChar") ?? null }
                : { ok: true, forChar: null };
        } catch (e) { console.warn("[CE] fogCommit:", e); return { ok: false }; }
    };
    // Le client applique la fog fournie (ou l'efface) SUR SON PROPRE document, puis
    // recharge le canvas s'il regarde la scène. C'est ainsi qu'on permute la fog
    // d'un joueur : le GM ne pouvant pas écrire le FogExploration d'autrui.
    CONFIG.queries["westmarch.fogSet"] = async ({ fog, clear, charId, redraw } = {}) => {
        try {
            const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
            if (!sceneId) return { ok: false };
            const coll = game.collections.get("FogExploration");
            const doc = coll.find(f => f.scene === sceneId && f.user === game.user.id);
            if (clear) {
                if (doc) await doc.delete();
            } else if (fog) {
                // On ÉTIQUETTE le document avec le perso auquel il appartient
                // (flag forChar), pour détecter et corriger un mélange de fogs.
                const data = { explored: fog.explored, positions: fog.positions, timestamp: fog.timestamp, [`flags.${MOD}.forChar`]: charId ?? null };
                if (doc) await doc.update(data);
                else await foundry.documents.FogExploration.create({ scene: sceneId, user: game.user.id, ...data });
            }
            if (canvas?.scene?.id === sceneId) {
                // redraw = changement de perso : on force un redraw COMPLET du canvas,
                // sinon la fog déjà affichée à l'écran ne se vide pas (mélange visuel).
                if (redraw) await canvas.draw();
                else {
                    await canvas.fog?.load?.();
                    canvas.perception.update({ refreshLighting: true, refreshVision: true }, true);
                }
            }
            return { ok: true };
        } catch (e) { console.warn("[CE] fogSet:", e); return { ok: false }; }
    };
    CONFIG.queries["westmarch.fogReload"] = async () => {
        try {
            const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
            if (!sceneId || canvas?.scene?.id !== sceneId) return { ok: false };
            await canvas.fog?.load?.();
            canvas.perception.update({ refreshLighting: true, refreshVision: true }, true);
            return { ok: true };
        } catch (e) { console.warn("[CE] fogReload:", e); return { ok: false }; }
    };

    // Après le déplacement d'un token de GROUPE sur la scène, force chaque membre
    // en ligne (même onglet en arrière-plan) à committer sa fog, pour qu'elle
    // soit persistée en continu et pas seulement quand l'onglet a le focus.
    Hooks.on("updateToken", (tokenDoc, changes) => {
        if (!game.user.isGM) return;
        if (!game.settings.get(MOD, "enableExpeditionMap")) return;
        if (!("x" in changes || "y" in changes)) return;
        const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
        if (!sceneId || tokenDoc.parent?.id !== sceneId) return;
        if (tokenDoc.actor?.type !== "group") return;
        _commitObserversFog(tokenDoc.actor);
    });

    Hooks.on("updateActor", async (actor, changes, options, userId) => {
        if (!game.settings.get(MOD, "enableExpeditionMap")) return;
        if (actor.type !== "group") return;
        if (!changes.system?.members) return;
        console.log(`[CE] updateActor(group) « ${actor.name} » | isToken=${actor.isToken} | members changés`);

        if (isActorOnExpeditionScene(actor)) enforceGroupExclusivity(actor);
        // Un membre ajouté/retiré peut accorder OU RETIRER Observer et changer le
        // « groupe actuel » d'un perso → on resynchronise TOUS les groupes + la fog.
        await resyncAllGroupOwnership();
        resyncAllCharacterFog();
    });

    // Token de GROUPE non lié : l'édition des Members passe par le delta du token
    // (pas par l'acteur de base) → écoute aussi updateToken pour ne pas rater un
    // retrait de membre (sinon l'Observer n'est jamais révoqué).
    Hooks.on("updateToken", async (tokenDoc, changes) => {
        if (!game.user.isGM) return;
        if (!game.settings.get(MOD, "enableExpeditionMap")) return;
        if (tokenDoc.actor?.type !== "group") return;
        if (!("delta" in changes) && !("actorData" in changes)) return;   // changement du delta (membres…)
        console.log(`[CE] updateToken(group) « ${tokenDoc.name} » | delta modifié → resync permissions`);
        if (isActorOnExpeditionScene(tokenDoc.actor)) enforceGroupExclusivity(tokenDoc.actor);
        await resyncAllGroupOwnership();
        resyncAllCharacterFog();
    });

    Hooks.once("ready", async () => {
        if (!game.user.isGM) return;
        if (!game.settings.get(MOD, "enableExpeditionMap")) return;

        // Acteur/token Groupe « modèle » (bons paramètres, à copier/renommer).
        await ensureTemplateGroupActor();
        // Acteur « Ancre de vision » (token invisible, à copier et attribuer).
        await ensureVisionAnchorActor();

        const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
        const scene = sceneId ? game.scenes.get(sceneId) : null;

        // Utilise les acteurs synthétiques des tokens sur la scène (actorLink: false
        // stocke les Members dans le delta du token, pas dans l'acteur de base).
        if (scene) {
            for (const token of scene.tokens.filter(t => t.actor?.type === "group")) {
                await syncGroupVisionOwnership(token.actor);
            }
        }
        // Nettoie aussi les acteurs Groupe hors-scène (retire les permissions résiduelles).
        for (const actor of game.actors.filter(a => a.type === "group" && !scene?.tokens.some(t => t.actorId === a.id))) {
            await syncGroupVisionOwnership(actor);
        }

        resyncAllCharacterFog();
    });

    Hooks.on("updateUser", async (user, changes, options, userId) => {
        if (!game.settings.get(MOD, "enableExpeditionMap")) return;
        console.log(`[CE] updateUser | user=${user.name} | "character" in changes=${"character" in changes} | newChar=${changes.character ?? "—"} | jeSuisGM=${game.user.isGM}`);
        if (!("character" in changes)) return;
        if (!game.user.isGM) return;

        const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
        const scene = sceneId ? game.scenes.get(sceneId) : null;
        console.log(`[CE] updateUser → scene carte trouvée=${!!scene} | tokens groupe=${scene ? scene.tokens.filter(t => t.actor?.type === "group").length : 0}`);

        // Resynchronise les permissions Observer sur TOUS les Groupes (acteurs
        // synthétiques pour les tokens non-liés, acteurs de base pour les hors-scène).
        if (scene) {
            for (const token of scene.tokens.filter(t => t.actor?.type === "group")) {
                await syncGroupVisionOwnership(token.actor);
            }
        }
        for (const actor of game.actors.filter(a => a.type === "group" && !scene?.tokens.some(t => t.actorId === a.id))) {
            await syncGroupVisionOwnership(actor);
        }

        recomputeFogForCharacter(changes.character ?? null);
    });

    // ---- Rafraîchit le fog affiché en direct sur le client concerné.
    // Ces hooks se déclenchent sur TOUS les clients connectés quand le
    // document FogExploration change (y compris celui du joueur dont le
    // fog vient d'être swappé par le GM) — contrairement à un simple
    // contrôle dans swapFogForUserCharacter, qui ne s'exécute que côté
    // GM et ne peut donc jamais correspondre au client du joueur. ----
    Hooks.on("createFogExploration", refreshFogIfMine);
    Hooks.on("updateFogExploration", refreshFogIfMine);
    Hooks.on("deleteFogExploration", refreshFogIfMine);

    // ---- Restauration côté JOUEUR à l'ouverture de la carte d'expédition ----
    // Sans token de groupe, le joueur n'a pas de source de vision. Pour qu'il voie
    // quand même les zones DÉJÀ EXPLORÉES par son perso courant, on réapplique sa
    // fog mémorisée (fogByKey) dans son document « live » à l'ouverture de la scène.
    Hooks.on("canvasReady", () => restoreOwnFogOnCanvas());

    // ---- Exploration par le MJ « pour » des joueurs hors-scène ----
    // Quand le MJ déplace un token de GROUPE sélectionné sur la scène de la
    // carte, son exploration est enregistrée dans la fog des membres de ce
    // groupe qui ne regardent pas la scène (hors-ligne ou sur une autre scène),
    // pour que la zone soit persistée par personnage.
    Hooks.on("createFogExploration", scheduleGmFogPropagation);
    Hooks.on("updateFogExploration", scheduleGmFogPropagation);
}

const _propagateGmFog = foundry.utils.debounce(() => { doPropagateGmFog(); }, 1200);

function scheduleGmFogPropagation(fogDoc) {
    if (!game.user.isGM) return;
    if (fogDoc.user !== game.user.id) return;             // seulement la fog du MJ courant
    if (!game.settings.get(MOD, "enableExpeditionMap")) return;
    if (fogDoc.scene !== game.settings.get(MOD, "expeditionMapSceneId")) return;
    _propagateGmFog();
}

async function doPropagateGmFog() {
    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    const scene = sceneId ? game.scenes.get(sceneId) : null;
    if (!scene) return;

    // Token(s) de GROUPE actuellement sélectionné(s) par le MJ : cible l'exploration.
    const controlled = (canvas?.tokens?.controlled ?? []).filter(t => t.actor?.type === "group");
    if (!controlled.length) return;

    // Force d'abord le commit de la fog du MJ pour capturer le TRACÉ COMPLET du
    // déplacement (sinon on lit un document périmé qui rate le chemin parcouru).
    if (canvas?.scene?.id === scene.id) { canvas.fog?.commit?.(); await canvas.fog?.save?.(); }

    // Instantané de la fog du MJ sur cette scène (reflète la vision des tokens
    // qu'il contrôle si la scène a bien « Vision par token » activée).
    const fogCollection = game.collections.get("FogExploration");
    const gmFog = fogCollection.find(f => f.scene === scene.id && f.user === game.user.id);
    if (!gmFog) return;
    const snapshot = { explored: gmFog.explored, positions: gmFog.positions, timestamp: gmFog.timestamp };

    for (const tok of controlled) {
        const memberIds = Array.from(tok.actor?.system?.members?.ids ?? []);
        for (const charId of memberIds) {
            const charActor = game.actors.get(charId);
            if (!charActor) continue;
            // On vise le(s) PROPRIÉTAIRE(S) du personnage membre, pas seulement le
            // joueur qui l'a assigné : ainsi la fog est mémorisée sous ce perso même
            // s'il n'est pas le perso actif du joueur. Il la retrouve en le rejouant.
            const owners = game.users.filter(u => !u.isGM && charActor.testUserPermission(u, "OWNER"));
            for (const user of owners) {
                const savedByKey = foundry.utils.deepClone(user.getFlag(MOD, "fogByKey") ?? {});
                savedByKey[charId] = { ...snapshot };
                await user.setFlag(MOD, "fogByKey", savedByKey);

                // Applique la fog « live » seulement si le joueur JOUE actuellement
                // ce perso (perso assigné) et qu'il ne l'explore pas lui-même en
                // direct. Sinon on se contente de mémoriser sous fogByKey.
                const isActiveChar = user.character?.id === charId;
                const isSelfExploring = user.active && user.viewedScene === scene.id;
                if (isActiveChar && !isSelfExploring && user.active) {
                    try { await user.query("westmarch.fogSet", { fog: snapshot, charId }); }
                    catch (e) { console.warn("[CE] fogSet (propagation) échoué:", e); }
                }
            }
        }
    }
    console.log(`[CE] Fog du MJ propagée aux propriétaires des membres des groupes sélectionnés.`);
}

// ============================================================
// Crée (une seule fois) un acteur Groupe « modèle » avec les bons
// paramètres de token pour la carte des expéditions — token NON LIÉ
// (Members stockés dans le delta du token) et VISION activée — puis en
// pose un exemplaire sur la scène configurée. Le GM n'a plus qu'à le
// copier / renommer et régler ses Members.
// ============================================================
const TEMPLATE_GROUP_NAME = "Token à copier et rennomer";

// Résout un dossier d'acteurs configuré (id du sélecteur ou nom en saisie libre).
async function resolveTemplateFolderId(settingKey = "expeditionMapTemplateFolder") {
    const val = game.settings.get(MOD, settingKey);
    if (!val) return null;
    const looksLikeId = (s) => /^[A-Za-z0-9]{16}$/.test(s ?? "");
    const byId = game.folders?.get(val);
    if (byId?.type === "Actor") return byId.id;
    if (!looksLikeId(val)) {
        const byName = game.folders?.find(f => f.type === "Actor" && f.name === val);
        if (byName) return byName.id;
        // Nom libre inexistant → on crée le dossier.
        const created = await Folder.create({ name: val, type: "Actor" });
        return created?.id ?? null;
    }
    return null;
}

async function ensureTemplateGroupActor() {
    if (!game.user.isGM) return null;

    let actor = game.actors.find(a => a.type === "group" && a.getFlag(MOD, "templateGroupToken") === true);
    if (!actor) {
        // Ne recrée pas si un acteur du même nom existe déjà (posé à la main).
        if (game.actors.find(a => a.type === "group" && a.name === TEMPLATE_GROUP_NAME)) return null;
        try {
            const folderId = await resolveTemplateFolderId();
            actor = await Actor.create({
                name: TEMPLATE_GROUP_NAME,
                type: "group",
                folder: folderId ?? null,
                flags: { [MOD]: { templateGroupToken: true } },
                prototypeToken: {
                    name: TEMPLATE_GROUP_NAME,
                    actorLink: false,                                  // Members dans le delta du token
                    sight: { enabled: true, range: 30 },               // vision (fog) — ajustez la portée au besoin
                    disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
                    displayName: CONST.TOKEN_DISPLAY_MODES.HOVER
                }
            });
            console.log(`[${MOD}] Acteur Groupe modèle « ${TEMPLATE_GROUP_NAME} » créé.`);
        } catch (e) {
            console.warn(`[${MOD}] Création de l'acteur Groupe modèle échouée :`, e);
            return null;
        }
    }
    if (!actor) return null;

    // Pose un exemplaire du token sur la scène de la carte (une seule fois).
    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    const scene = sceneId ? game.scenes.get(sceneId) : null;
    if (scene && !scene.tokens.some(t => t.actorId === actor.id)) {
        try {
            const x = Math.round((scene.width  ?? 1000) / 2);
            const y = Math.round((scene.height ?? 1000) / 2);
            const tokenDoc = await actor.getTokenDocument({ x, y });
            await scene.createEmbeddedDocuments("Token", [tokenDoc.toObject()]);
            console.log(`[${MOD}] Token Groupe modèle posé sur la scène de la carte.`);
        } catch (e) {
            console.warn(`[${MOD}] Dépôt du token Groupe modèle échoué :`, e);
        }
    }
    return actor;
}

// Acteur « Ancre de vision » : token INVISIBLE (alpha 0) avec vision activée à
// portée 0. Il ne révèle rien de neuf mais fournit la source de vision requise
// pour que le brouillard EXPLORÉ s'affiche à un joueur sans token de groupe.
// À copier et attribuer à un joueur (propriétaire) sur la scène.
const VISION_ANCHOR_NAME = "Ancre de vision";

async function ensureVisionAnchorActor() {
    if (!game.user.isGM) return null;

    let actor = game.actors.find(a => a.getFlag(MOD, "visionAnchor") === true);
    if (!actor) {
        if (game.actors.find(a => a.name === VISION_ANCHOR_NAME)) return null;   // déjà créé à la main
        try {
            const folderId = await resolveTemplateFolderId("expeditionAnchorFolder");
            actor = await Actor.create({
                name: VISION_ANCHOR_NAME,
                type: "character",
                folder: folderId ?? null,
                // Observateur par défaut → TOUS les joueurs voient (donc ont une
                // source de vision) via cette ancre, sans réglage manuel par joueur.
                ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
                flags: { [MOD]: { visionAnchor: true } },
                prototypeToken: {
                    name: VISION_ANCHOR_NAME,
                    actorLink: false,
                    alpha: 0,                                          // invisible mais reste une source de vision
                    sight: { enabled: true, range: 0 },                // contexte de vision sans rien révéler de neuf
                    disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
                    displayName: CONST.TOKEN_DISPLAY_MODES.NONE,
                    displayBars: CONST.TOKEN_DISPLAY_MODES.NONE
                }
            });
            console.log(`[${MOD}] Acteur « ${VISION_ANCHOR_NAME} » créé.`);
        } catch (e) {
            console.warn(`[${MOD}] Création de l'acteur Ancre de vision échouée :`, e);
            return null;
        }
    }
    if (!actor) return null;

    // S'assure que l'ancre est bien Observateur par défaut (répare une ancienne
    // ancre créée avant ce réglage).
    const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    if ((actor.ownership?.default ?? 0) !== OBS) {
        try { await actor.update({ "ownership.default": OBS }); }
        catch (e) { console.warn(`[${MOD}] MAJ ownership ancre échouée :`, e); }
    }
    return actor;
}

// À l'ouverture de la carte, garantit que le document de fog « live » du joueur
// appartient bien à SON perso courant. Le document est étiqueté (flag forChar) :
//  - s'il correspond déjà au perso courant → on n'y touche pas (exploration en cours) ;
//  - sinon (fog d'un AUTRE perso = mélange, ou vide) → on applique la fog mémorisée
//    du perso courant (ou on efface s'il n'a rien exploré).
async function restoreOwnFogOnCanvas() {
    if (game.user.isGM) return;
    if (!game.settings.get(MOD, "enableExpeditionMap")) return;
    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    if (!sceneId || canvas?.scene?.id !== sceneId) return;
    const charId = game.user.character?.id;
    if (!charId) return;

    try {
        const coll = game.collections.get("FogExploration");
        const doc = coll.find(f => f.scene === sceneId && f.user === game.user.id);

        // Le document affiché appartient-il déjà au perso courant ?
        const docChar = doc?.getFlag?.(MOD, "forChar") ?? null;
        if (doc && docChar === charId) return;   // déjà la bonne fog → on respecte l'exploration en cours

        // Fog mémorisée du perso courant (repli sur d'anciennes clés "char:group").
        const savedByKey = game.user.getFlag(MOD, "fogByKey") ?? {};
        let saved = savedByKey[charId] ?? null;
        if (!saved) {
            const legacy = Object.entries(savedByKey)
                .filter(([k]) => k.startsWith(`${charId}:`))
                .map(([, v]) => v)
                .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
            if (legacy.length) saved = legacy[0];
        }

        if (saved) {
            // On a une fog mémorisée pour le perso courant → on l'applique.
            const data = { explored: saved.explored, positions: saved.positions, timestamp: saved.timestamp, [`flags.${MOD}.forChar`]: charId };
            if (doc) await doc.update(data);
            else await foundry.documents.FogExploration.create({ scene: sceneId, user: game.user.id, ...data });
        } else if (doc && docChar == null && doc.explored) {
            // Document non étiqueté avec du contenu → probablement l'exploration
            // propre du perso courant (jamais passée par un swap) : on l'adopte.
            await doc.update({ [`flags.${MOD}.forChar`]: charId });
            return;   // contenu inchangé, pas besoin de recharger
        } else if (doc && docChar && docChar !== charId) {
            // Fog étiquetée pour un AUTRE perso, sans mémoire pour le perso courant → efface (noir).
            await doc.delete();
        } else {
            return;   // rien à faire
        }
        // Redraw complet pour vider la fog de l'autre perso restée affichée.
        await canvas.draw();
        console.log(`[CE] restoreOwnFog | perso=${charId} | docChar=${docChar} → appliqué (redraw)`);
    } catch (e) { console.warn("[CE] restoreOwnFog:", e); }
}

function refreshFogIfMine(fogDoc) {
    if (game.user.id !== fogDoc.user) return;
    if (canvas.scene?.id !== fogDoc.scene) return;
    console.log(`[CE] refreshFogIfMine déclenché pour user=${game.user.name}`);
    canvas.fog.load();
    canvas.perception.update({ refreshLighting: true, refreshVision: true }, true);
}

// ============================================================
// Retourne l'acteur effectif à utiliser pour lire system.members
// d'un acteur Groupe : pour les tokens non-liés (actorLink: false),
// les Members sont stockés dans le delta du token (acteur synthétique),
// pas dans l'acteur de base. On préfère donc token.actor si disponible.
// ============================================================
function getEffectiveGroupActor(actorId, scene) {
    const token = scene?.tokens.find(t => t.actorId === actorId);
    return token?.actor ?? game.actors.get(actorId);
}

function isActorOnExpeditionScene(actor) {
    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    if (!sceneId) return false;
    const scene = game.scenes.get(sceneId);
    if (!scene) return false;
    return scene.tokens.some(t => t.actorId === actor.id);
}

// Resynchronise les permissions Observer de TOUS les groupes : ceux présents
// sur la scène d'expédition (acteurs synthétiques des tokens non liés) et les
// groupes hors-scène (nettoyage des permissions résiduelles).
async function resyncAllGroupOwnership() {
    if (!game.user.isGM) return;
    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    const scene = sceneId ? game.scenes.get(sceneId) : null;
    if (scene) {
        for (const t of scene.tokens.filter(t => t.actor?.type === "group")) {
            await syncGroupVisionOwnership(t.actor);
        }
    }
    for (const a of game.actors.filter(a => a.type === "group" && !scene?.tokens.some(t => t.actorId === a.id))) {
        await syncGroupVisionOwnership(a);
    }
}

async function syncGroupVisionOwnership(actor) {
    // actor peut être un acteur synthétique (token non-lié) ou un acteur de base.
    // Dans tous les cas, actor.id est l'id de l'acteur de base, et actor.ownership
    // est lu/écrit sur l'acteur de base (les permissions ne sont jamais dans le delta).
    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    const scene = game.scenes.get(sceneId);

    const onScene = !!scene?.tokens.some(t => t.actorId === actor.id);

    // Lit les Members depuis l'acteur synthétique du token si présent.
    const effectiveActor = getEffectiveGroupActor(actor.id, scene);
    const memberActorIds = onScene ? Array.from(effectiveActor.system?.members?.ids ?? []) : [];

    const targetUserIds = onScene
        ? game.users
            .filter(u => !u.isGM && u.character && memberActorIds.includes(u.character.id))
            .map(u => u.id)
        : [];

    // L'ownership est toujours sur l'acteur de base — on récupère le bon objet.
    const baseActor = game.actors.get(actor.id) ?? actor;

    // Hors-scène : si aucun joueur n'est Member ET que le module n'a jamais géré
    // cet acteur, on ne touche à rien (groupes de ville / décoratifs préservés).
    // SUR la scène d'expédition, on applique TOUJOURS la règle « vision = membre »
    // pour qu'un membre retiré perde bien son Observer, même s'il avait été accordé
    // manuellement ou avant le suivi du module.
    const previouslyAutoOwned = baseActor.getFlag(MOD, "autoOwners") ?? [];
    if (!onScene && targetUserIds.length === 0 && previouslyAutoOwned.length === 0) return;

    const currentOwnership = baseActor.ownership;
    const toGrant = [];
    const toRevoke = [];

    // Retire Observer ET Owner de tout utilisateur non-GM qui ne devrait plus
    // avoir accès, quelle que soit l'origine de la permission.
    for (const userId of Object.keys(currentOwnership)) {
        if (userId === "default") continue;
        const user = game.users.get(userId);
        if (!user || user.isGM) continue;
        const lvl = currentOwnership[userId];
        if ((lvl === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER || lvl === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER)
            && !targetUserIds.includes(userId)) {
            toRevoke.push(userId);
        }
    }

    // Accorde Observer aux membres : suffit pour la vision/fog en v13,
    // sans donner les droits de contrôle du token au joueur.
    for (const userId of targetUserIds) {
        if (currentOwnership[userId] !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
            toGrant.push(userId);
        }
    }

    console.log(`[CE] sync « ${baseActor.name} » | onScene=${onScene} | members=[${memberActorIds.join(",")}] | cibles=[${targetUserIds.join(",")}] | grant=[${toGrant.join(",")}] | revoke=[${toRevoke.join(",")}]`);

    if (toGrant.length === 0 && toRevoke.length === 0) return;

    // On RECONSTRUIT tout l'objet ownership plutôt que d'utiliser "ownership.-=userId"
    // (mal interprété par certains acteurs / MidiActor → "ownership is not a mapping…",
    // update rejeté, donc aucune révocation). On remplace l'objet EN ENTIER via
    // l'option { recursive: false } pour que les entrées retirées disparaissent vraiment.
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const newOwnership = { default: currentOwnership.default ?? L.NONE };
    for (const [uid, lvl] of Object.entries(currentOwnership)) {
        if (uid === "default") continue;
        const u = game.users.get(uid);
        if (!u) continue;
        if (u.isGM) { newOwnership[uid] = lvl; continue; }   // on ne touche jamais aux GM
        if (targetUserIds.includes(uid)) newOwnership[uid] = L.OBSERVER;   // membre → Observateur
        // sinon : non-membre → on l'omet (retiré → retombe sur "default")
    }
    for (const uid of targetUserIds) newOwnership[uid] = L.OBSERVER;   // membres pas encore présents

    if (!foundry.utils.objectsEqual(newOwnership, currentOwnership)) {
        await baseActor.update({ ownership: newOwnership }, { recursive: false });
    }
    const prevAuto = baseActor.getFlag(MOD, "autoOwners") ?? [];
    if (!foundry.utils.objectsEqual([...prevAuto].sort(), [...targetUserIds].sort())) {
        await baseActor.setFlag(MOD, "autoOwners", targetUserIds);
    }
}

// ============================================================
// Exclusivité : sur la carte des expéditions, un même personnage ne
// doit jamais être Member de deux Groupes en même temps (sinon les
// deux Groupes lui donnent Observer, et sa vision/fog se mélange avec
// celle de tokens dont il ne devrait pas faire partie). Quand un
// personnage est ajouté aux Members d'un Groupe présent sur la
// scène configurée, on le retire des Members de tous les AUTRES
// Groupes présents sur cette même scène.
//
// On manipule les données brutes via toObject()/update() plutôt que
// l'API du système dnd5e pour system.members (non documentée ici),
// afin de ne pas risquer de corrompre la structure si elle diffère
// de ce qu'on suppose : on filtre simplement les entrées concernées
// dans le tableau brut, en préservant tout le reste tel quel.
// ============================================================
function getRawMemberId(entry) {
    if (typeof entry === "string") return entry;
    return entry?.actor ?? entry?.id ?? entry?._id ?? null;
}

async function enforceGroupExclusivity(actor) {
    if (!game.user.isGM) return;

    // Lit les Members depuis l'acteur synthétique (token non-lié).
    const memberActorIds = Array.from(actor.system?.members?.ids ?? []);
    if (!memberActorIds.length) return;

    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    const scene = game.scenes.get(sceneId);
    if (!scene) return;

    const otherGroupTokens = scene.tokens.filter(t => t.actorId && t.actorId !== actor.id && t.actor?.type === "group");

    for (const otherToken of otherGroupTokens) {
        const other = otherToken.actor; // acteur synthétique pour lire/écrire les Members
        const rawMembers = other.toObject().system?.members ?? [];
        if (!Array.isArray(rawMembers) || !rawMembers.length) continue;

        const filtered = rawMembers.filter(m => !memberActorIds.includes(getRawMemberId(m)));
        if (filtered.length !== rawMembers.length) {
            await other.update({ "system.members": filtered });
        }
    }
}

// ============================================================
// Fog PERSONNELLE par personnage. Chaque personnage possède UNE seule
// fog, valable pour toutes les expéditions : il la conserve et la fait
// évoluer au fil de ses explorations, quel que soit le groupe. Le token
// de Groupe sert uniquement à savoir QUI explore en ce moment (vision),
// il ne partitionne pas la fog.
//
// Clé de sauvegarde = "<characterId>". Un changement de personnage
// assigné sur un même compte joueur permute la fog (l'ancienne est
// sauvegardée sous son personnage, celle du nouveau est restaurée).
// ============================================================

// Partie « personnage » d'une clé (compat. anciennes clés "char:group").
const _charOf = (k) => (k == null ? null : String(k).split(":")[0]);

// Demande aux clients des membres d'un groupe (en ligne + regardant la scène)
// de persister leur fog maintenant. Débounce pour éviter le spam en déplacement.
const _commitDebounce = new Map();
function _commitObserversFog(groupActor) {
    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    const memberIds = Array.from(groupActor?.system?.members?.ids ?? []);
    for (const charId of memberIds) {
        const u = game.users.find(x => !x.isGM && x.character?.id === charId);
        if (!u?.active || u.viewedScene !== sceneId) continue;
        clearTimeout(_commitDebounce.get(u.id));
        _commitDebounce.set(u.id, setTimeout(() => {
            u.query("westmarch.fogCommit", {}).catch(() => {});
        }, 400));
    }
}

function resyncAllCharacterFog() {
    if (!game.user.isGM) return;
    game.users
        .filter(u => !u.isGM && u.character)
        .forEach(u => recomputeFogForCharacter(u.character.id));
}

async function recomputeFogForCharacter(characterId) {
    if (!characterId) return;
    if (!game.settings.get(MOD, "enableExpeditionMap")) return;

    const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
    if (!sceneId) return;
    const scene = game.scenes.get(sceneId);
    if (!scene) return;

    const user = game.users.find(u => !u.isGM && u.character?.id === characterId);
    if (!user) { console.log(`[CE] recomputeFog: aucun joueur non-GM avec le perso ${characterId}`); return; }
    if (!user.active) return;   // hors ligne → on ne peut pas piloter sa fog (limite Foundry)

    const newChar = characterId;

    // SOURCE DE VÉRITÉ = l'étiquette du document de fog du joueur (forChar), pas un
    // flag séparé. On demande à son client sa fog actuelle + à quel perso elle
    // appartient réellement, ce qui évite toute désynchronisation.
    let cur = null, oldChar = null;
    try {
        const res = await user.query("westmarch.fogCommit", {});
        if (res?.ok) {
            oldChar = res.forChar ?? null;
            if (res.explored !== undefined) cur = { explored: res.explored, positions: res.positions, timestamp: res.timestamp };
        }
    } catch (e) { console.warn("[CE] fogCommit (swap) échoué:", e); return; }

    console.log(`[CE] recomputeFog | user=${user.name} | docForChar=${oldChar} → newChar=${newChar}`);
    if (oldChar === newChar) return;   // la fog affichée appartient déjà au bon perso

    await swapFogForUserKey(scene, user, oldChar, newChar, cur);
}

async function swapFogForUserKey(scene, user, oldKey, newKey, currentSnapshot = null) {
    const oldChar = _charOf(oldKey);
    const newChar = _charOf(newKey);
    const savedByKey = foundry.utils.deepClone(user.getFlag(MOD, "fogByKey") ?? {});

    // Sauvegarde la fog courante (celle de l'ancien perso) sous sa clé. Le GM n'a
    // pas accès au FogExploration du joueur → l'instantané vient de la query
    // fogCommit (currentSnapshot) exécutée sur le client du joueur.
    if (currentSnapshot && oldChar) savedByKey[oldChar] = currentSnapshot;

    // Fog à restaurer pour le nouveau perso (repli sur d'anciennes clés "char:group").
    let saved = null;
    if (newChar) {
        saved = savedByKey[newChar] ?? null;
        if (!saved) {
            const legacy = Object.entries(savedByKey)
                .filter(([k]) => k.startsWith(`${newChar}:`))
                .map(([, v]) => v)
                .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
            if (legacy.length) saved = legacy[0];
        }
    }
    await user.setFlag(MOD, "fogByKey", savedByKey);
    console.log(`[CE] swapFog | ${oldChar} → ${newChar} | à restaurer: ${saved ? "OUI" : "NON (efface)"} | joueur en ligne: ${user.active}`);

    // Applique la fog du nouveau perso SUR LE CLIENT DU JOUEUR (il possède, lui,
    // son FogExploration). Hors-ligne : impossible maintenant (limite Foundry) —
    // la fog reste mémorisée sous fogByKey et sera appliquée à sa reconnexion.
    if (user.active) {
        try { await user.query("westmarch.fogSet", saved ? { fog: saved, charId: newChar, redraw: true } : { clear: true, charId: newChar, redraw: true }); }
        catch (e) { console.warn("[CE] fogSet (swap) échoué:", e); }
    }
}
