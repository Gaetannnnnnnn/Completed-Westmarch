import { MOD } from "./const.js";
// ============================================================
// combat.js — Combat lié à la party plutôt qu'à la scène
// - Le combat garde une scène valide (celle de création) pour que l'ajout
//   de combattants fonctionne en v13/v14 ; ce qui l'isole, c'est un FLAG
//   « partyId » posé à la création, pas la scène.
// - Chaque client voit dans son tracker le combat de SA propre party, que
//   les parties jouent sur la MÊME scène ou sur des scènes DIFFÉRENTES
//   (override du getter CombatTracker#viewed, par client — voir plus bas).
// - Du coup, si plusieurs parties jouent en parallèle (plusieurs GM, un
//   par party), les combats ne se mélangent jamais : un GM ne voit pas le
//   combat géré par un autre GM.
// ============================================================

import { partyFeatureEnabled } from './settings.js';
import { registerSoundFilter } from './audio.js';

// Mémorise, pour le combat en cours de changement de tour, la position de
// la caméra d'un joueur hors-party AVANT que Foundry ne la déplace
// automatiquement (voir preUpdateCombat / updateCombat plus bas).
let savedViewPosition = null;

// Mémorise le DERNIER combat ayant changé de round/tour/état "started",
// avec l'heure de ce changement — utilisé uniquement pour rattacher un
// son de thème de combat (voir le filtre audio.js plus bas) au bon
// combat, sans deviner via un pointeur global peu fiable (game.combat).
let lastCombatSoundEvent = null;

// Mémorise le dernier onglet de la sidebar autre que "combat" : Foundry
// force l'onglet Combat au premier plan pour TOUT LE MONDE dès qu'un
// combat démarre, sans notion de party. On s'en sert pour y revenir si
// ce combat n'est pas le nôtre.
let lastNonCombatTab = "chat";

// Renvoie true si CE combat appartient à la party de l'utilisateur courant
// (ou si le combat n'est pas tagué / le système est désactivé — dans ce
// cas on ne filtre jamais, par sécurité).
function isMyCombat(combat) {
    if (!partyFeatureEnabled("enableCombatParty")) return true;
    if (!combat) return true;

    // Pas de cas particulier pour le GM : sur une table à plusieurs GM
    // (un par party), un GM doit être traité comme un joueur de sa propre
    // party — sinon il verrait aussi les combats gérés par les autres GM.
    const combatPartyId = combat.getFlag?.(MOD, "partyId");
    if (!combatPartyId) return true;

    // Un GM qui n'a jamais lancé "Create Party" n'a pas de partyId flag
    // posé sur lui-même (seul son combat est tagué avec son propre id, en
    // repli, à la création - voir preCreateCombat) : on applique le même
    // repli ici, sinon ce GM ne reconnaîtrait plus son propre combat
    // comme étant le sien.
    const myPartyId = game.user.getFlag(MOD, "partyId") ?? (game.user.isGM ? game.user.id : undefined);
    return combatPartyId === myPartyId;
}

// ============================================================
// Override du combat « affiché » par le tracker, PAR CLIENT.
// ------------------------------------------------------------
// Foundry n'a qu'UN seul combat « viewed » à la fois (celui actif sur la
// scène vue) : dès qu'une party démarre son combat, le tracker de TOUT LE
// MONDE bascule dessus → les parties se mélangent. `viewed` est un getter
// en lecture seule sans setter public, et il n'existe aucune API pour
// forcer un combat précis. On enveloppe donc le getter sur le prototype de
// base `CombatTracker` (CombatTracker5e de dnd5e ne le redéfinit pas) pour
// que CHAQUE client voie le combat de SA propre party, quelle que soit la
// scène (même scène ou scènes différentes — pas de mélange). Idempotent.
function installTrackerViewOverride() {
    try {
        const proto = foundry?.applications?.sidebar?.tabs?.CombatTracker?.prototype;
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto, "viewed");
        if (!desc?.get || desc.get.__scwmWrapped) return;
        const orig = desc.get;
        const wrapped = function () {
            const native = orig.call(this);
            try {
                if (!partyFeatureEnabled("enableCombatParty")) return native;
                // Déjà sur un combat qui est le nôtre → on n'y touche pas
                // (laisse fonctionner le défilement entre nos propres combats).
                if (native && isMyCombat(native)) return native;
                // Sinon, on bascule sur NOTRE combat (priorité : démarré, puis
                // actif, puis le premier) parmi tous les combats de la table.
                const mine = (game.combats?.contents ?? []).filter(c => isMyCombat(c) && c.getFlag?.(MOD, "partyId"));
                if (!mine.length) return native;
                return mine.find(c => c.started) ?? mine.find(c => c.active) ?? mine[0];
            } catch (e) { return native; }
        };
        wrapped.__scwmWrapped = true;
        Object.defineProperty(proto, "viewed", { ...desc, get: wrapped });
    } catch (e) { console.warn(`[${MOD}] Override tracker.viewed échoué :`, e); }
}

// Trouve (ou crée) le combat de MA party sur une scène donnée, puis y ajoute
// le combattant décrit par `data`. Utilisé pour aiguiller un token ajouté au
// combat d'un AUTRE GM vers le nôtre (voir preCreateCombatant plus bas).
async function routeCombatantToMyCombat(sceneId, data) {
    try {
        const myPartyId = game.user.getFlag(MOD, "partyId") ?? game.user.id;
        let mine = (game.combats?.contents ?? []).find(c =>
            c.getFlag(MOD, "partyId") === myPartyId && (c.scene?.id ?? null) === (sceneId ?? null));
        if (!mine) {
            // active:false → on ne vole pas le combat actif de l'autre GM ;
            // l'affichage de NOTRE combat est assuré par l'override de `viewed`.
            mine = await Combat.create({
                scene: sceneId ?? null,
                active: false,
                [`flags.${MOD}.partyId`]: myPartyId
            });
        }
        if (!mine) return;
        // Pas de doublon si le token est déjà dans notre combat.
        if (data?.tokenId && mine.combatants.some(cb => cb.tokenId === data.tokenId)) return;
        await mine.createEmbeddedDocuments("Combatant", [data]);
    } catch (e) { console.error(`[${MOD}] Aiguillage combattant échoué :`, e); }
}

export function CombatHooks() {

    // Chaque client affiche le combat de SA party (voir ci-dessus).
    installTrackerViewOverride();

    // ============================================================
    // SECTION : Aiguillage des combattants vers le combat de SA party.
    // Sur une scène PARTAGÉE par plusieurs GM, le clic droit « Entrer en
    // combat » d'un token l'ajoute au combat ACTIF de la scène — qui peut
    // être celui d'un AUTRE GM (c'est le cas vécu : le token partait dans le
    // combat de l'autre MJ). On intercepte la création du combattant : si
    // elle vise un combat qui n'est pas le nôtre, on l'ANNULE et on recrée le
    // combattant dans NOTRE combat de party sur cette scène (créé au besoin).
    // La re-création vise alors notre propre combat → isMyCombat vrai → pas
    // de boucle.
    // ============================================================
    Hooks.on("preCreateCombatant", (combatant, data, options, userId) => {
        if (!partyFeatureEnabled("enableCombatParty")) return;
        if (game.userId !== userId) return;        // uniquement le client initiateur
        const target = combatant.parent;           // le combat visé par Foundry
        if (!target) return;
        if (isMyCombat(target)) return;            // déjà notre combat → on laisse

        // Combat visé appartenant à une autre party → on redirige.
        const payload = combatant.toObject();
        delete payload._id;
        const sceneId = payload.sceneId ?? target.scene?.id ?? canvas?.scene?.id ?? null;
        routeCombatantToMyCombat(sceneId, payload);
        return false;                              // annule l'ajout au combat étranger
    });


    // ============================================================
    // SECTION : Tague le combat avec la party de son créateur, dès sa
    // création (GM uniquement). Le filtrage par party se fait via le FLAG,
    // pas via la scène → on garde une scène valide pour que l'ajout de
    // combattants fonctionne normalement (forcer scene:null le cassait en
    // Foundry v13/v14 : « il faut lier une scène au combat »).
    // ============================================================
    Hooks.on("preCreateCombat", (combat, data, options, userId) => {
        if (!partyFeatureEnabled("enableCombatParty")) return;
        if (!game.user.isGM) return;

        // Un GM qui a créé sa party a partyId == son propre id (voir
        // "Create Party" dans player.js). S'il n'a pas encore de party
        // assignée, on le tague tout de même avec son propre id : ça
        // reste cohérent et permet de filtrer dès qu'il en crée une.
        const partyId = game.user.getFlag(MOD, "partyId") ?? game.user.id;

        // Scène : on conserve celle de création ; à défaut, la scène vue par
        // le GM (combat fonctionnel, combattants ajoutables). On traite "" et
        // null comme « absent » pour que le repli s'applique vraiment — sinon
        // un combat « sans scène » reste bloqué à un seul exemplaire.
        const pick = (...v) => v.find(x => x != null && x !== "") ?? null;
        const scene = pick(combat.scene?.id, data?.scene, game.user.viewedScene, canvas?.scene?.id);

        combat.updateSource({
            scene,
            [`flags.${MOD}.partyId`]: partyId
        });
    });

    // ============================================================
    // SECTION : Filtrage du tracker de combat par party
    // - Un joueur ne voit le combat affiché que s'il appartient à sa
    //   propre party (sinon, message "aucun combat" à la place).
    // - Un combat non tagué (créé avant l'activation du setting, ou
    //   par un GM sans système de party) n'est jamais filtré.
    // - S'applique aussi au GM : sur une table à plusieurs GM (un par
    //   party), chaque GM ne doit voir que le(s) combat(s) de sa propre
    //   party, pas ceux gérés par un autre GM.
    // - On vide TOUT le contenu rendu (sans cibler de classe CSS
    //   précise, dont on n'était pas sûr) : plus robuste, ne dépend
    //   pas de la structure interne exacte du template Foundry.
    // ============================================================
    Hooks.on("renderCombatTracker", (tracker, html, data) => {
        if (!partyFeatureEnabled("enableCombatParty")) return;

        // Aucune des "valeurs uniques" essayées (data.combat, game.combat,
        // tracker.viewed) ne s'est avérée fiable pour savoir quel combat
        // correspond à CE rendu précis dès que plusieurs combats tournent
        // en parallèle (un par party, puisqu'aucun n'est lié à une scène) :
        // tantôt ça laissait fuiter les combattants d'un combat étranger,
        // tantôt ça coinçait un joueur sur "Aucun combat" alors que son
        // propre combat existe bien. On filtre donc ligne par ligne : pour
        // chaque <li class="combatant" data-combatant-id="...">, on
        // retrouve sans ambiguïté son combat parent en cherchant son id
        // parmi tous les combats de la table.
        const root = $(html);
        const rows = root.find("li.combatant[data-combatant-id]");

        if (root.is("ol.combat-tracker") || rows.length) {
            let kept = 0;
            rows.each(function () {
                const combatantId = this.dataset.combatantId;
                let combat = null;
                for (const c of (game.combats?.combats ?? [])) {
                    if (c.combatants.get(combatantId)) { combat = c; break; }
                }
                if (combat && !isMyCombat(combat)) {
                    $(this).remove();
                } else {
                    kept++;
                }
            });

            if (kept === 0) {
                root.empty().append(
                    `<p style="padding:8px; opacity:0.7; font-style:italic;">Aucun combat en cours pour votre party.</p>`
                );
            }
        }

        // Le bandeau ("header", Round X + boutons) n'est volontairement
        // pas modifié : il n'expose pas d'identifiant de combat exploitable
        // et ne révèle de toute façon que le numéro de round (pas les
        // combattants ni leur état) — fuite mineure jugée acceptable plutôt
        // que de risquer de re-coincer un joueur sur son propre combat.

        // Pour le changement d'onglet et la fermeture du popup ci-dessous,
        // on ne se fie qu'à l'existence ou non d'un combat À NOUS : s'il en
        // existe un, on ne déloge jamais ce joueur de son tracker, même si
        // un combat étranger tourne aussi en parallèle.
        const combats = game.combats?.combats ?? [];
        const hasOwn = combats.some(c => isMyCombat(c));
        const hasForeign = combats.some(c => !isMyCombat(c));
        if (hasOwn || !hasForeign) return;

        // Foundry vient de forcer l'onglet "Combat" au premier plan pour
        // ce joueur (comportement natif, déclenché au démarrage/maj du
        // combat). Comme ce n'est pas son combat, on le renvoie sur
        // l'onglet où il était avant, plutôt que de le laisser coincé
        // devant ce message.
        if (ui.sidebar?.activeTab === "combat") {
            ui.sidebar.activateTab(lastNonCombatTab);
        }

        // Cause réelle du popup non-fermable : le module "Monk's Combat
        // Details" (indépendant de westmarch) fait apparaître automatiquement
        // le tracker de combat dans une fenêtre flottante ("popout") pour
        // TOUT LE MONDE dès qu'un combat démarre (réglage "opencombat" =
        // "everyone" par défaut, sans notion de party). Ce popout est en
        // fait la MÊME instance d'application que le tracker de la sidebar
        // — c'est pour ça qu'il affiche aussi notre message "Aucun combat
        // en cours pour votre party.". Il ne se referme tout seul que
        // quand TOUS les combats de la table sont terminés (pas juste le
        // nôtre), donc un joueur hors-party peut rester coincé avec ce
        // popup pendant toute la durée du combat d'une autre party.
        // Comme ce n'est pas notre combat, on le referme nous-mêmes, juste
        // après son ouverture (avec le même garde-fou anti-collision que
        // Monk's Combat Details utilise lui-même : ne pas fermer une
        // fenêtre déjà en train de se fermer ou de se (re)dessiner).
        if (tracker.isPopout) {
            setTimeout(() => {
                const states = tracker.constructor?.RENDER_STATES;
                if (states && [states.CLOSING, states.RENDERING].includes(tracker.state)) return;
                tracker.close();
            }, 50);
        }
    });

    // Garde la trace du dernier onglet "normal" (chat, items, etc.) pour
    // pouvoir y renvoyer un joueur hors-party qu'on vient d'éjecter de
    // l'onglet Combat.
    Hooks.on("changeSidebarTab", (app) => {
        const tabName = app?.tabName ?? app?.options?.id;
        if (tabName && tabName !== "combat") lastNonCombatTab = tabName;
    });

    // ============================================================
    // SECTION : Empêche le pan automatique de la caméra (et le tracking
    // visuel du combattant actif) de toucher les joueurs hors-party.
    // - Foundry pan/centre la caméra de TOUS les clients qui regardent
    //   la scène à chaque changement de tour, sans notion de party.
    // - On mémorise la position de la caméra juste avant ce changement
    //   (preUpdateCombat), puis on la restaure juste après (updateCombat),
    //   une fois que le pan automatique de Foundry s'est déjà produit.
    // - Best-effort : si Foundry verrouille aussi le déplacement du
    //   token lui-même (pas juste la caméra), ce correctif ne suffira
    //   pas — à vérifier en jeu.
    // ============================================================
    Hooks.on("preUpdateCombat", (combat, changes, options, userId) => {
        if (!("turn" in changes) && !("round" in changes)) return;
        if (isMyCombat(combat)) return;

        savedViewPosition = canvas?.ready && canvas.scene?._viewPosition
            ? { ...canvas.scene._viewPosition }
            : null;
    });

    Hooks.on("updateCombat", (combat, changes, options, userId) => {
        if (!savedViewPosition) return;
        if (!("turn" in changes) && !("round" in changes)) return;

        const pos = savedViewPosition;
        savedViewPosition = null;
        if (isMyCombat(combat)) return;

        // Laisse Foundry terminer son pan automatique avant de restaurer
        // la vue précédente du joueur (sans animation, pour que ça ne
        // "saute" pas visiblement deux fois).
        setTimeout(() => {
            if (canvas?.ready) canvas.animatePan({ ...pos, duration: 0 });
        }, 50);
    });

    // Mémorise le combat à l'origine du dernier changement de round/tour/
    // démarrage, pour le filtre de son de thème de combat (audio.js,
    // section plus bas) — sans dépendre de game.combat (pointeur global
    // peu fiable dès que plusieurs combats tournent en parallèle).
    Hooks.on("updateCombat", (combat, changes) => {
        if (("turn" in changes) || ("round" in changes) || ("started" in changes)) {
            lastCombatSoundEvent = { combat, time: Date.now() };
        }
    });

    // ============================================================
    // SECTION : Coupe le son de thème de combat (audio.js) — début de
    // combat / changement de tour — quand il provient d'un combat qui
    // n'est pas le nôtre. Foundry le diffuse à toute la table via le
    // thème choisi (réglage client "core.combatTheme", CONFIG.Combat.
    // sounds), sans aucune notion de party.
    // - On ne sait pas reconnaître ce son par son seul chemin (il dépend
    //   du thème choisi par CE client) : on vérifie donc qu'il fait bien
    //   partie des sons du thème actif, puis on le rattache au combat
    //   dont un changement de round/tour/démarrage vient de se produire
    //   (lastCombatSoundEvent ci-dessus), borné à 2 secondes pour éviter
    //   de couper un son de thème rejoué plus tard sans rapport (macro,
    //   etc.).
    // ============================================================
    function themeContainsSound(obj, src) {
        if (!obj || typeof obj !== "object") return false;
        for (const v of Object.values(obj)) {
            if (typeof v === "string" && v === src) return true;
            if (v && typeof v === "object" && themeContainsSound(v, src)) return true;
        }
        return false;
    }

    registerSoundFilter((src) => {
        if (!partyFeatureEnabled("enableCombatParty")) return false;
        if (!src || !lastCombatSoundEvent) return false;
        if (Date.now() - lastCombatSoundEvent.time > 2000) return false;

        const themeKey = game.settings.get("core", "combatTheme");
        const theme = CONFIG.Combat?.sounds?.[themeKey];
        if (!theme || !themeContainsSound(theme, src)) return false;

        return !isMyCombat(lastCombatSoundEvent.combat);
    });

    // ============================================================
    // SECTION : Blocage de mouvement hors tour (natif, sans Monk's
    // TokenBar).
    // - Objectif : pendant le combat de SA party, un joueur ne peut
    //   déplacer son token que quand c'est son tour. Le combat d'une
    //   AUTRE party ne doit jamais bloquer nos joueurs.
    // - Foundry, par défaut, ne verrouille pas du tout le mouvement des
    //   joueurs en combat : c'est justement ce que TokenBar ajoutait.
    //   On le réimplémente ici, en le scopant à la party.
    // - Mise en œuvre : on veto la mise à jour de position (x/y) du token
    //   dans "preUpdateToken", uniquement sur le client qui initie le
    //   déplacement (game.userId === userId), donc AVANT tout envoi au
    //   serveur. Couvre le glisser-déposer, la règle de mesure et les
    //   déplacements au clavier (tous passent par ce hook).
    // - Règle exacte :
    //     * on ne regarde QUE les combats démarrés appartenant à notre
    //       party (isMyCombat) — un combat étranger est ignoré ;
    //     * si le token déplacé est un combattant de l'un d'eux, il ne
    //       peut bouger que si c'est le combattant actif de ce combat ;
    //       sinon on bloque ;
    //     * un token qui n'est combattant d'aucun de nos combats démarrés
    //       n'est jamais bloqué (il ne participe pas au combat).
    // - Le GM n'est jamais bloqué.
    // ============================================================
    let lastTurnLockWarn = 0;
    Hooks.on("preUpdateToken", (tokenDoc, changes, options, userId) => {
        // On ne bloque que sur le client qui initie réellement le déplacement.
        if (game.userId !== userId) return;
        if (game.user.isGM) return;
        if (!partyFeatureEnabled("enableCombatParty")) return;
        if (!game.settings.get(MOD, "enableCombatTurnLock")) return;

        // Uniquement les vrais changements de position.
        if (!("x" in changes) && !("y" in changes)) return;

        // Seulement les tokens que le joueur possède.
        if (!tokenDoc.actor?.isOwner) return;

        // Combats démarrés appartenant à MA party (les autres sont ignorés).
        const myStarted = (game.combats?.combats ?? []).filter(c => c.started && isMyCombat(c));
        if (!myStarted.length) return;

        let isCombatantHere = false;
        for (const combat of myStarted) {
            const combatant = combat.combatants.find(cb => cb.tokenId === tokenDoc.id);
            if (!combatant) continue;
            isCombatantHere = true;
            // C'est le combattant actif de ce combat → déplacement autorisé.
            if (combat.combatant?.tokenId === tokenDoc.id) return;
        }

        // Le token ne participe à aucun de nos combats démarrés → on laisse.
        if (!isCombatantHere) return;

        // Sinon : c'est un combat de notre party, ce token y participe, mais
        // ce n'est pas son tour → on bloque le déplacement.
        const now = Date.now();
        if (now - lastTurnLockWarn > 2000) {
            lastTurnLockWarn = now;
            ui.notifications?.warn("Ce n'est pas encore votre tour de jouer.");
        }
        return false;
    });
}
