// ============================================================
// serveur-socket.js — Communication ciblée (query fakeWarning).
// Gère uniquement la query "fakeWarning" utilisée par fake-warning.js.
// Utilise le système de queries Foundry v13 (CONFIG.queries / User#query),
// sans nécessiter "socket: true" dans le manifeste.
// ============================================================

import { getTutorialActor } from "./demoactor.js";
import { MOD, DEACTIVATION_CODE } from "./const.js";

export function SocketHooks() {
    CONFIG.queries["completed-westmarch.fakeWarning"] = async (queryData) => {
        ui.notifications.warn(queryData.message);
        return true;
    };

    // Bascule de désactivation demandée par un JOUEUR (qui ne peut pas écrire un
    // réglage monde) : le client MJ valide le code et applique l'écriture.
    CONFIG.queries["completed-westmarch.toggleDeactivation"] = async ({ code }) => {
        if (!game.user.isGM) return false;
        if (!DEACTIVATION_CODE || code !== DEACTIVATION_CODE) return false;
        const next = !(game.settings.get(MOD, "moduleDeactivated") === true);
        try { await game.settings.set(MOD, "moduleDeactivated", next); return next ? "off" : "on"; }
        catch (e) { console.error("[completed-westmarch] toggleDeactivation :", e); return false; }
    };

    // Un joueur ne peut pas modifier l'ownership d'un acteur : il demande au GM
    // de le faire (accès temporaire à la fiche démo pendant le tutoriel).
    CONFIG.queries["completed-westmarch.setDemoOwnership"] = async ({ userId, level }) => {
        if (!game.user.isGM) return false;
        const actor = getTutorialActor();
        if (!actor) return false;
        try { await actor.update({ [`ownership.${userId}`]: level }); return true; }
        catch (e) { console.error("[completed-westmarch] setDemoOwnership :", e); return false; }
    };
}

// Affiche un faux message d'avertissement (notification jaune) chez
// l'utilisateur "userId" — utilisé par fake-warning.js.
export function sendFakeWarning(userId, message) {
    const targetUser = game.users.get(userId);
    if (!targetUser) return;
    targetUser.query("completed-westmarch.fakeWarning", { message }).catch(err =>
        console.error("[completed-westmarch] Erreur lors de l'envoi du faux message à", targetUser.name, ":", err)
    );
}
