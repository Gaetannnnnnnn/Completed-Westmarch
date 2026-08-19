// ============================================================
// partypause.js — Pause de party (remplace le pause global natif)
//
// Réglage "enablePartyPause" : au lieu du pause global de Foundry (qui
// touche toute la table), chaque GM met SA propre party en pause.
//   - Détourne game.togglePause (bouton + raccourci) vers un pause de
//     party ; le pause global n'est jamais réellement déclenché.
//   - Masque l'indicateur "PAUSED" natif.
//   - Affiche un bandeau "Pause" aux membres de la party concernée et
//     bloque le déplacement de leurs tokens (non-GM) tant que c'est en
//     pause. Une autre party n'est jamais affectée.
// État partagé via un réglage de monde "partyPauseState" (mapping
// partyId -> true), synchronisé sur tous les clients (onChange).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

// Référence vers le vrai game.togglePause (avant patch), pour pouvoir annuler
// une éventuelle pause globale dans le filet de sécurité.
let _origTogglePause = null;

// Anti-double-bascule : la barre espace peut atteindre à la fois notre écouteur
// de capture ET game.togglePause détourné. On ignore une 2e bascule rapprochée.
let _lastToggle = 0;

// Écouteur clavier (capture) : intercepte la barre espace de pause.
function _onPauseKey(ev) {
    if (!partyPauseEnabled()) return;
    if (!game.user.isGM) return;                 // seuls les GM mettent en pause
    if (ev.code !== "Space" && ev.key !== " ") return;
    if (ev.repeat) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    // Ne pas voler l'espace pendant une saisie de texte.
    const t = ev.target;
    const tag = t?.tagName;
    if (t?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    ev.preventDefault();
    ev.stopImmediatePropagation();

    // Échappatoire : si une pause GLOBALE traîne (le pause de party la remplace),
    // on la lève d'abord plutôt que de basculer la party — sinon elle resterait
    // coincée puisqu'on intercepte l'espace.
    if (game.paused) {
        const toggle = _origTogglePause ?? game.togglePause?._scwmOrig;
        try { toggle?.(false, { broadcast: true }); } catch {}
        return;
    }
    togglePartyPause();
}

function partyPauseEnabled() {
    return game.settings.get(MOD, "enableParty") && game.settings.get(MOD, "enablePartyPause");
}

// Annule une pause GLOBALE résiduelle (seul le GM « primaire » agit). Le pause de
// party remplace le pause global : ce dernier ne doit jamais rester au démarrage.
function clearResidualGlobalPause() {
    if (!partyPauseEnabled()) return;
    if (!game.user.isGM || !game.paused) return;
    const activeGM = game.users.activeGM;
    if (activeGM && activeGM.id !== game.user.id) return;   // laisse le GM primaire s'en charger
    try {
        const unpause = _origTogglePause ?? game.togglePause?._scwmOrig;
        unpause?.(false, { broadcast: true });
        console.log("westmarch | partypause : pause globale résiduelle annulée");
    } catch (e) { console.warn("westmarch | partypause : nettoyage pause globale", e); }
}

// Id de party de l'utilisateur courant (repli : son propre id s'il est GM
// sans party assignée — cohérent avec combat.js).
function myPartyId() {
    return game.user.getFlag(MOD, "partyId") ?? (game.user.isGM ? game.user.id : undefined);
}

function pauseState() {
    const s = game.settings.get(MOD, "partyPauseState");
    return (s && typeof s === "object") ? s : {};
}

function isMyPartyPaused() {
    const pid = myPartyId();
    if (!pid) return false;
    return pauseState()[pid] === true;
}

export function PartyPauseHooks() {
    Hooks.once("ready", () => {
        if (!partyPauseEnabled()) return;

        // (1) Détourne game.togglePause : couvre le bouton de pause, les macros
        //     et tout appel programmatique. On bascule la pause de party au lieu
        //     du pause global.
        if (game.togglePause && !game.togglePause._scwmPatched) {
            _origTogglePause = game.togglePause.bind(game);
            const patched = function () {
                togglePartyPause();
                return game.paused;
            };
            patched._scwmPatched = true;
            patched._scwmOrig = _origTogglePause;
            game.togglePause = patched;
        }

        // (2) Intercepte la BARRE ESPACE en phase de capture, AVANT le
        //     KeyboardManager de Foundry. Selon la version, la touche de pause
        //     ne passe pas toujours par game.togglePause : on garantit ainsi que
        //     le pause global n'est jamais déclenché. L'anti-double-bascule de
        //     togglePartyPause évite tout conflit si les deux voies se cumulent.
        window.addEventListener("keydown", _onPauseKey, true);

        // Nettoyage d'une pause GLOBALE résiduelle (démarrage sur un monde laissé
        // en pause) : le pause de party la remplace, elle ne doit pas subsister.
        // Foundry peut restaurer l'état "en pause" APRÈS "ready" → on nettoie tout
        // de suite ET on re-vérifie peu après pour rattraper une pause tardive.
        clearResidualGlobalPause();
        setTimeout(clearResidualGlobalPause, 1500);
        setTimeout(clearResidualGlobalPause, 4000);

        applyPartyPause();
    });

    // Filet de sécurité : si une pause GLOBALE s'active malgré tout (voie d'accès
    // non couverte : socket serveur, module tiers…), le GM actif l'annule. On ne
    // touche PAS à l'état de party ici (éviter les doubles-bascules).
    Hooks.on("pauseGame", (paused) => {
        if (!partyPauseEnabled()) return;
        if (!paused) return;                 // seule l'ACTIVATION globale nous intéresse
        if (!game.user.isGM) return;
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;
        const toggle = _origTogglePause ?? ((v, o) => game.togglePause?._scwmOrig?.(v, o));
        try { toggle?.(false, { broadcast: true }); } catch (e) { console.warn("westmarch | partypause : annulation pause globale", e); }
    });

    // Ré-applique si l'utilisateur change de party (il rejoint/quitte).
    Hooks.on("updateUser", (user, changes) => {
        if (user.id !== game.user.id) return;
        if (foundry.utils.hasProperty(changes, `flags.${MOD}.partyId`)) applyPartyPause();
    });

    // Le banner natif #pause est re-rendu par le cœur (cssClass basé sur
    // game.paused, donc masqué). On ré-affirme notre état de party juste après.
    Hooks.on("renderGamePause", () => applyPartyPause());

    // Blocage du déplacement pendant la pause de party (non-GM uniquement).
    Hooks.on("preUpdateToken", (tokenDoc, changes, options, userId) => {
        if (game.userId !== userId) return;
        if (game.user.isGM) return;
        if (!partyPauseEnabled()) return;
        if (!("x" in changes) && !("y" in changes)) return;
        if (!tokenDoc.actor?.isOwner) return;
        if (!isMyPartyPaused()) return;
        ui.notifications?.warn("La partie est en pause.");
        return false;
    });
}

// GM : bascule l'état de pause de SA party (écrit le réglage de monde ;
// onChange → applyPartyPause() sur tous les clients).
async function togglePartyPause() {
    if (!game.user.isGM) return;   // seuls les GM peuvent mettre en pause
    // Anti-double-bascule (capture clavier + game.togglePause peuvent coïncider).
    const now = Date.now();
    if (now - _lastToggle < 150) return;
    _lastToggle = now;
    const pid = myPartyId();
    if (!pid) return;
    const s = foundry.utils.deepClone(pauseState());
    if (s[pid] === true) delete s[pid];
    else s[pid] = true;
    await game.settings.set(MOD, "partyPauseState", s);
}

// Applique l'affichage sur CE client selon l'état de sa party. On réutilise le
// banner natif #pause (« Game Paused ») : mêmes styles que Foundry, et les
// modules qui l'habillent (glow bleu de Monk, etc.) s'appliquent tels quels.
export function applyPartyPause() {
    const on = partyPauseEnabled() && isMyPartyPaused();
    // Le banner natif est visible via la classe "paused" sur #pause.
    const el = document.getElementById("pause");
    if (el) el.classList.toggle("paused", on);
    // Marqueur pour d'éventuels styles maison / compat modules.
    document.body.classList.toggle("scwm-party-paused", on);
}
