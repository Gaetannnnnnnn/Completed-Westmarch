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

function partyPauseEnabled() {
    return game.settings.get(MOD, "enableParty") && game.settings.get(MOD, "enablePartyPause");
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

        // Détourne le pause natif : bouton + raccourci clavier passent tous
        // par game.togglePause. On le remplace pour ne jamais déclencher le
        // pause global, mais basculer la pause de la party du GM.
        if (game.togglePause && !game.togglePause._scwmPatched) {
            _origTogglePause = game.togglePause.bind(game);
            const patched = function () {
                togglePartyPause();
                return game.paused;
            };
            patched._scwmPatched = true;
            patched._scwmOrig = _origTogglePause;   // conservé au cas où
            game.togglePause = patched;
        }

        applyPartyPause();
    });

    // Filet de sécurité : si une pause GLOBALE s'active malgré tout (voie d'accès
    // autre que game.togglePause : macro, socket, module tiers…), on l'annule et
    // on bascule à la place la pause de la party du GM. Un seul GM (le GM actif)
    // agit, pour éviter des annulations multiples.
    Hooks.on("pauseGame", (paused) => {
        if (!partyPauseEnabled()) return;
        if (!paused) return;                 // seule l'ACTIVATION globale nous intéresse
        if (!game.user.isGM) return;
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;

        // Annule la pause globale (elle ne doit jamais rester active avec la
        // pause de party) puis bascule la pause de MA party.
        const toggle = _origTogglePause ?? ((v, o) => game.togglePause?._scwmOrig?.(v, o));
        try { toggle?.(false, { broadcast: true }); } catch (e) { console.warn("westmarch | partypause : annulation pause globale", e); }
        togglePartyPause();
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
