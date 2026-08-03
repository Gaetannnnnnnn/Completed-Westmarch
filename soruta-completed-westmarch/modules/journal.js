import { MOD } from "./const.js";
import { pullUserToScene } from './socket.js';

export function JournalHooks() {
    Hooks.on("renderJournalEntrySheet", (sheet, html, data) => renderJournalEntrySheet(sheet, html, data));
}

function renderJournalEntrySheet(sheet, html, data) {
    const sceneLinks = $(html).find(".content-link[data-type='Scene']");
    if (sceneLinks.length === 0) return;

    const menuItems = [
        {
            name: "Go Alone",
            icon: '<i class="fa-solid fa-person-walking"></i>',
            callback: async (el) => {
                const uuid = el.data("uuid");
                const scene = await fromUuid(uuid);
                pullUserToScene(scene.id, game.user.id);
            }
        },
        {
            name: "Go With Party",
            icon: '<i class="fa-solid fa-people-arrows"></i>',
            callback: async (el) => {
                const uuid = el.data("uuid");
                const scene = await fromUuid(uuid);
                const partyId = game.user.getFlag(MOD, "partyId");
                game.users.forEach(user => {
                    // partyId doit être vérifié en plus de l'égalité stricte :
                    // sinon deux utilisateurs sans party (tous deux à
                    // "undefined") matchent entre eux par erreur.
                    if (partyId && user.getFlag(MOD, "partyId") === partyId) {
                        pullUserToScene(scene.id, user.id);
                    }
                });
                ui.notifications.info(`Groupe téléporté vers ${scene.name}`);
            }
        }
    ];

    new ContextMenu($(html), ".content-link[data-type='Scene']", menuItems);
}