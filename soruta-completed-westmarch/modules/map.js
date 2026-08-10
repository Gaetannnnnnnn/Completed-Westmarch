import { MOD } from "./const.js";
// ============================================================
// map.js — Logique du module autonome MOD,
// indépendant de westmarch (settings + flags namespacés
// MOD).
// ============================================================

export function MapHooks() {

    Hooks.on("updateActor", (actor, changes, options, userId) => {
        if (!game.settings.get(MOD, "enableExpeditionMap")) return;
        if (actor.type !== "group") return;
        if (!changes.system?.members) return;

        syncGroupVisionOwnership(actor);
        if (isActorOnExpeditionScene(actor)) {
            enforceGroupExclusivity(actor);
            // Un changement de Members peut faire basculer le "groupe actuel"
            // de n'importe quel personnage actuellement assigné à un joueur
            // (ajouté/retiré de ce Groupe) → on recalcule pour tout le monde.
            resyncAllCharacterFog();
        }
    });

    Hooks.once("ready", async () => {
        if (!game.user.isGM) return;
        if (!game.settings.get(MOD, "enableExpeditionMap")) return;

        // Acteur/token Groupe « modèle » (bons paramètres, à copier/renommer).
        await ensureTemplateGroupActor();

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
        if (!("character" in changes)) return;
        if (!game.user.isGM) return;

        const sceneId = game.settings.get(MOD, "expeditionMapSceneId");
        const scene = sceneId ? game.scenes.get(sceneId) : null;

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
}

// ============================================================
// Crée (une seule fois) un acteur Groupe « modèle » avec les bons
// paramètres de token pour la carte des expéditions — token NON LIÉ
// (Members stockés dans le delta du token) et VISION activée — puis en
// pose un exemplaire sur la scène configurée. Le GM n'a plus qu'à le
// copier / renommer et régler ses Members.
// ============================================================
const TEMPLATE_GROUP_NAME = "Token à copier et rennomer";

async function ensureTemplateGroupActor() {
    if (!game.user.isGM) return null;

    let actor = game.actors.find(a => a.type === "group" && a.getFlag(MOD, "templateGroupToken") === true);
    if (!actor) {
        // Ne recrée pas si un acteur du même nom existe déjà (posé à la main).
        if (game.actors.find(a => a.type === "group" && a.name === TEMPLATE_GROUP_NAME)) return null;
        try {
            actor = await Actor.create({
                name: TEMPLATE_GROUP_NAME,
                type: "group",
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

    // Si aucun joueur n'est actuellement Member ET que le module n'en a jamais
    // géré sur cet acteur, on ne touche à rien : groupes de ville, tokens
    // décoratifs, etc. restent intacts (default Observer préservé).
    const previouslyAutoOwned = baseActor.getFlag(MOD, "autoOwners") ?? [];
    if (targetUserIds.length === 0 && previouslyAutoOwned.length === 0) return;

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

    if (toGrant.length === 0 && toRevoke.length === 0) return;

    // IMPORTANT : update({ ownership: fullObject }) fait un MERGE dans Foundry v13 —
    // les clés absentes du nouvel objet NE sont PAS supprimées de la base.
    // On doit utiliser la syntaxe "ownership.-=userId" pour supprimer explicitement
    // une entrée, et "ownership.userId" pour ajouter/modifier.
    const updateData = { [`flags.${MOD}.autoOwners`]: targetUserIds };
    for (const userId of toGrant) {
        updateData[`ownership.${userId}`] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    }
    for (const userId of toRevoke) {
        updateData[`ownership.-=${userId}`] = null;
    }

    await baseActor.update(updateData);
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
// Fog par personnage ET par groupe actuel. Un même personnage qui
// change de Groupe (nouvelle expédition, même sans changer de
// personnage assigné) doit voir sa fog se ré-isoler : l'exploration
// faite avec le Groupe A ne doit pas rester visible une fois rejoint
// le Groupe B, sinon les deux Groupes "interfèrent" sur la carte.
//
// Clé de sauvegarde = "<characterId>:<groupActorId>" (pas de groupe
// trouvé => pas de clé => fog vide, comme un personnage qui n'a
// encore rejoint aucune expédition).
// ============================================================

function findGroupIdForCharacter(characterId, scene) {
    if (!characterId) return null;
    for (const token of scene.tokens) {
        if (!token.actorId) continue;
        // Utilise l'acteur synthétique pour lire les Members (token non-lié).
        const actor = token.actor;
        if (!actor || actor.type !== "group") continue;
        const ids = Array.from(actor.system?.members?.ids ?? []);
        if (ids.includes(characterId)) return actor.id; // actor.id = id de l'acteur de base
    }
    return null;
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

    const newGroupId = findGroupIdForCharacter(characterId, scene);
    const newKey = newGroupId ? `${characterId}:${newGroupId}` : null;

    const rawFlag = user.getFlag(MOD, "activeFogKey");
    console.log(`[CE] recomputeFog | user=${user.name} | rawFlag=${JSON.stringify(rawFlag)} | newKey=${newKey}`);

    if (rawFlag === undefined) {
        console.log(`[CE] → première init, on pose la clé sans swap`);
        await user.setFlag(MOD, "activeFogKey", newKey);
        return;
    }

    const oldKey = rawFlag ?? null;
    if (oldKey === newKey) { console.log(`[CE] → clés identiques, rien à faire`); return; }

    console.log(`[CE] → SWAP fog: oldKey=${oldKey} → newKey=${newKey}`);
    await swapFogForUserKey(scene, user, oldKey, newKey);
    await user.setFlag(MOD, "activeFogKey", newKey);
}

async function swapFogForUserKey(scene, user, oldKey, newKey) {
    const fogCollection = game.collections.get("FogExploration");
    const fogDoc = fogCollection.find(f => f.scene === scene.id && f.user === user.id);
    console.log(`[CE] swapFog | fogDoc trouvé: ${!!fogDoc} | oldKey=${oldKey} | newKey=${newKey}`);

    if (fogDoc && oldKey) {
        const savedByKey = foundry.utils.deepClone(user.getFlag(MOD, "fogByKey") ?? {});
        savedByKey[oldKey] = {
            explored: fogDoc.explored,
            positions: fogDoc.positions,
            timestamp: fogDoc.timestamp
        };
        await user.setFlag(MOD, "fogByKey", savedByKey);
        console.log(`[CE] → fog sauvegardée sous ${oldKey}`);
    }

    const savedByKey = user.getFlag(MOD, "fogByKey") ?? {};
    const saved = newKey ? savedByKey[newKey] : null;
    console.log(`[CE] → fog restaurée pour ${newKey}: ${saved ? "OUI" : "NON (suppression)"}`);

    if (fogDoc) {
        if (saved) {
            await fogDoc.update({
                explored: saved.explored,
                positions: saved.positions,
                timestamp: saved.timestamp
            });
        } else {
            await fogDoc.delete();
        }
    } else if (saved) {
        await foundry.documents.FogExploration.create({
            scene: scene.id,
            user: user.id,
            explored: saved.explored,
            positions: saved.positions,
            timestamp: saved.timestamp
        });
    }
}
