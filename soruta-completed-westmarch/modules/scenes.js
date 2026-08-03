import { MOD } from "./const.js";
import { partyFeatureEnabled } from './settings.js';
import { pullUserToScene } from './socket.js';

export function ScenesHooks() {
    Hooks.on('getSceneContextOptions', (html, contextMenu) => {
        contextMenu.push({
            name: "Go With Party",
            icon: '<i class="fa-solid fa-people-arrows"></i>',
            callback: li => {
                var destination = game.scenes.get(li.dataset.entryId ?? li.dataset.sceneId ?? li.dataset.documentId);
                GoWithParty(destination);
            },
            condition: li => game.user.isGM && partyFeatureEnabled("enableGoWithPartyScenes")
        });
    });
    Hooks.on('getSceneDirectoryEntryContextOptions', (html, contextMenu) => {
        contextMenu.push({
            name: "Go With Party",
            icon: '<i class="fa-solid fa-people-arrows"></i>',
            callback: li => {
                var destination = game.scenes.get(li.dataset.sceneId ?? li.dataset.entryId ?? li.dataset.documentId);
                GoWithParty(destination);
            },
            condition: li => game.user.isGM && partyFeatureEnabled("enableGoWithPartyScenes")
        });
    });
}

function GoWithParty(destination){
    if (!destination) {
        ui.notifications.warn("Scène de destination introuvable.");
        return;
    }
    // myPartyId doit être vérifié en plus de l'égalité stricte : sinon
    // deux utilisateurs sans party (tous deux à "undefined") matchent
    // entre eux par erreur, et se retrouvent téléportés à tort.
    const myPartyId = game.user.getFlag(MOD, "partyId");
    let count = 0;
    game.users.forEach(user => {
        const theirPartyId = user.getFlag(MOD, "partyId");
        if (myPartyId && theirPartyId === myPartyId) {
            count++;
            pullUserToScene(destination.id, user.id);
        }
    });
    ui.notifications.info(`Groupe téléporté vers ${destination.name} (${count} membre(s)).`);
}
