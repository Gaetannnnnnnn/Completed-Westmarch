import { MOD } from "./const.js";
import { ReloadChat } from './chat.js';
import { startSessionLog } from './session.js';
import { partyFeatureEnabled } from './settings.js';

var appPlayerList = undefined;

export function PlayerHooks() {

    // ============================================================
    // SECTION : Rendu de la liste des joueurs
    // - Ajoute le scroll
    // - Ajoute le bouton refresh
    // - Regroupe les joueurs par party avec séparateurs colorés
    // ============================================================
    Hooks.on("renderPlayers", (app, html, data) => {
        appPlayerList = app;

        // Scroll sur la liste
        $(html).find('.players-list').addClass('scrollable');

        // Bouton refresh
        $(html).find('.players-mode').after(`<i class="fa-solid fa-arrows-rotate" style="float: right;"></i>`);
        $(html).find('.fa-arrows-rotate').click((event) => { 
            event.stopPropagation();
            appPlayerList.render();
        });

        // Regroupement visuel des joueurs par party
        if (!partyFeatureEnabled("enablePlayerGrouping")) return;
        $(html).find('.player.gm').each((index, gmElement) => {
            var user = game.users.get(gmElement.dataset.userId);
            if(user.getFlag(MOD, 'partyId') === user.id) { 
                gmElement.insertAdjacentHTML('beforebegin', '<hr style="margin: 0px; border: 1px solid '+ getComputedStyle(gmElement).getPropertyValue("--player-color").trim()+'"/>');

                var firstElement = gmElement;
                $(html).find('.player').each((index, playerElement) => {
                    if(playerElement.dataset.userId !== gmElement.dataset.userId 
                        && game.users.get(gmElement.dataset.userId).getFlag(MOD, 'partyId') == game.users.get(playerElement.dataset.userId).getFlag(MOD, 'partyId')
                    ) {
                        let clone = playerElement.cloneNode(true);
                        if(firstElement == gmElement)
                            firstElement = clone;
                        gmElement.insertAdjacentElement('afterend', clone);
                        playerElement.remove();
                    }
                });
                firstElement.insertAdjacentHTML('afterend', '<hr style="margin: 0px; border: 1px solid '+getComputedStyle(gmElement).getPropertyValue("--player-color").trim()+'"/>');
            }
        });
    });

    // ============================================================
    // SECTION : Menu contextuel (clic droit) sur un joueur
    // ============================================================
    Hooks.on('getUserContextOptions', (html, contextMenu) => {

        // ---- Créer une party (GM uniquement, sur soi-même) ----
        contextMenu.push({
            name: "Create Party",
            icon: '<i class="fa-solid fa-users"></i>',
            callback: li => {
                game.user.setFlag(MOD, "partyId", game.user.id).then(() => {
                    if (partyFeatureEnabled("enableSessionLog")) startSessionLog(game.user.id);
                    ReloadChat();
                    appPlayerList.render();
                });
            },
            condition: li => game.settings.get(MOD, "enableParty") && game.users.get(li.dataset.userId).isGM && game.user.id == li.dataset.userId && game.user.id != game.user.getFlag(MOD, 'partyId')
        });

        // ---- Rejoindre la party d'un GM ----
        contextMenu.push({
            name: "Join Party",
            icon: '<i class="fa-solid fa-user-plus"></i>',
            callback: li => {
                game.user.setFlag(MOD, "partyId", li.dataset.userId).then(() => {
                    ReloadChat();
                    appPlayerList.render();
                });
            },
            condition: li => game.settings.get(MOD, "enableParty") && game.users.get(li.dataset.userId).isGM && game.users.get(li.dataset.userId).getFlag(MOD, 'partyId') == li.dataset.userId && game.user.id != li.dataset.userId
        });

        // ---- Quitter sa party (dissout la party si c'est le GM chef) ----
        contextMenu.push({
            name: "Leave Party",
            icon: '<i class="fa-solid fa-user-minus"></i>',
            callback: li => {
                if(game.user.isGM && game.user.id == game.user.getFlag(MOD, 'partyId')) {
                    game.users.forEach(user => {
                        if(user.getFlag(MOD, "partyId") == game.user.id) {
                            user.unsetFlag(MOD, "partyId");
                        }
                    });
                }
                game.user.unsetFlag(MOD, "partyId").then(() => {
                    ReloadChat();
                    appPlayerList.render();
                });
            },
            condition: li => game.settings.get(MOD, "enableParty") && game.user.id == li.dataset.userId && game.users.get(li.dataset.userId).getFlag(MOD, 'partyId')
        });

        // ---- Expulser un joueur de la party (GM uniquement) ----
        contextMenu.push({
            name: "Kick Party",
            icon: '<i class="fa-solid fa-users-slash"></i>',
            callback: li => {
                game.users.get(li.dataset.userId).unsetFlag(MOD, "partyId").then(() => {
                    ReloadChat();
                    appPlayerList.render();
                });
            },
            condition: li => game.settings.get(MOD, "enableParty") && game.user.isGM && game.users.get(li.dataset.userId).getFlag(MOD, 'partyId') && game.user.id != li.dataset.userId
        });

        // ---- Inviter un joueur dans sa party (GM uniquement) ----
        contextMenu.push({
            name: "Invite Party",
            icon: '<i class="fa-solid fa-user-tag"></i>',
            callback: li => {
                game.users.get(li.dataset.userId).setFlag(MOD, "partyId", game.user.getFlag(MOD, 'partyId')).then(() => {
                    ReloadChat();
                    appPlayerList.render();
                });
            },
            condition: li => game.settings.get(MOD, "enableParty") && game.user.isGM && game.users.get(li.dataset.userId).getFlag(MOD, 'partyId') != game.user.getFlag(MOD, 'partyId') && game.user.id != li.dataset.userId
        });

        // ---- Rejoindre la scène d'un membre de sa party ----
        contextMenu.push({
            name: "Join Scene",
            icon: '<i class="fa-solid fa-door-open"></i>',
            callback: async li => {
                const targetUser = game.users.get(li.dataset.userId);
                const targetSceneId = targetUser.viewedScene;
                if (!targetSceneId) {
                    ui.notifications.warn("Ce joueur n'est sur aucune scène.");
                    return;
                }

                // Le socket "pullToScene" de Foundry v13 ne filtre plus par
                // userId (il déplace tous les autres clients connectés, et
                // n'est jamais reçu par l'émetteur lui-même). On change donc
                // directement notre propre scène, sans passer par le socket.
                const scene = game.scenes.get(targetSceneId);
                if (!scene) {
                    ui.notifications.warn("Scène introuvable.");
                    return;
                }
                scene.view();
            },
            condition: li => {
                if (!partyFeatureEnabled("enableJoinScene")) return false;
                const targetUser = game.users.get(li.dataset.userId);
                if (!targetUser) return false;
                if (targetUser.id === game.user.id) return false;
                // Un GM peut rejoindre la scène de n'importe quel autre GM
                if (game.user.isGM && targetUser.isGM) return true;
                // Sinon : même party, cible non-GM uniquement
                if (targetUser.isGM) return false;
                const myParty = game.user.getFlag(MOD, 'partyId');
                if (!myParty) return false;
                return targetUser.getFlag(MOD, 'partyId') === myParty;
            }
        });
    });
}