// ============================================================
// serveur-socket.js — Communication ciblée (query fakeWarning).
// Gère uniquement la query "fakeWarning" utilisée par fake-warning.js.
// Utilise le système de queries Foundry v13 (CONFIG.queries / User#query),
// sans nécessiter "socket: true" dans le manifeste.
// ============================================================

export function SocketHooks() {
    CONFIG.queries["completed-westmarch.fakeWarning"] = async (queryData) => {
        ui.notifications.warn(queryData.message);
        return true;
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
