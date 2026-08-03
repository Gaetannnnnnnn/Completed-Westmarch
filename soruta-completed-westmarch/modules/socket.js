// ============================================================
// socket.js — Communication ciblée entre clients pour déplacer un
// utilisateur précis vers une scène.
//
// Historique : ancienne version basée sur le socket CORE "pullToScene"
// (game.socket.emit("pullToScene", ...)) — cassé en Foundry v13 (le
// serveur ne lit plus le userId et ne relaie jamais à l'émetteur).
// On est alors passés à un canal personnalisé "module.westmarch", MAIS
// Foundry exige que le manifeste déclare "socket": true pour autoriser
// un canal de module — ce qui n'a jamais été fait, donc AUCUN message
// n'a jamais pu être délivré depuis cette migration (ni "Go With Party",
// ni le faux message de maintenance), peu importe le cache navigateur.
//
// Plutôt que de modifier module.json (règle du projet : ne jamais y
// toucher), on utilise le système de "queries" de Foundry v13
// (CONFIG.queries / User#query), conçu justement pour cibler UN client
// précis sans nécessiter cette déclaration de manifeste.
// ============================================================

export function SocketHooks() {
    // Chaque client (GM et joueurs) doit enregistrer ces handlers : n'importe
    // lequel peut être la cible d'une query envoyée par un autre client.
    CONFIG.queries["westmarch.pullToScene"] = async (queryData) => {
        const scene = game.scenes.get(queryData.sceneId);
        if (scene) scene.view();
        return true;
    };

}

// Déplace l'utilisateur "userId" vers la scène "sceneId". Si c'est
// nous-mêmes, on change directement notre scène (pas besoin de query).
export function pullUserToScene(sceneId, userId) {
    if (userId === game.user.id) {
        const scene = game.scenes.get(sceneId);
        if (scene) scene.view();
        return;
    }
    const targetUser = game.users.get(userId);
    if (!targetUser) return;
    targetUser.query("westmarch.pullToScene", { sceneId }).catch(err =>
        console.error("[WestMarch] Erreur lors du déplacement de", targetUser.name, ":", err)
    );
}

