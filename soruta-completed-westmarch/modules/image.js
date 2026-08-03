import { MOD } from "./const.js";
import { partyFeatureEnabled } from './settings.js';

export function ImageHooks() {
    // En v13, getImagePopoutHeaderButtons n'est plus déclenché
    // On utilise renderApplicationV2 pour détecter les ImagePopout
    Hooks.on("renderApplicationV2", (application, element, context, options) => {
        // On cible uniquement les ImagePopout
        if (application.constructor.name !== "ImagePopout") return;
        // GM uniquement
        if (!game.user.isGM) return;
        if (!partyFeatureEnabled("enableShowParty")) return;

        // En v13, les boutons sont des <button class="header-control">
        // posés directement dans le <header class="window-header">,
        // pas dans un sous-conteneur ".window-controls".
        const header = element.querySelector(".window-header");
        if (!header) return;

        // Evite de dupliquer le bouton si déjà présent
        if (header.querySelector(".share-image-party")) return;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("header-control", "icon", "fa-solid", "fa-user", "share-image-party");
        btn.dataset.tooltip = "Show Party";
        btn.setAttribute("aria-label", "Show Party");
        btn.addEventListener("click", () => {
            const myPartyId = game.user.getFlag(MOD, "partyId");
            const users = game.users.filter(user =>
                user.id !== game.user.id &&
                user.getFlag(MOD, "partyId") === myPartyId
            );
            if (users.length > 0) {
                application.shareImage({ users: users.map(u => u.id) });
            } else {
                ui.notifications.warn("Aucun membre de la party connecté.");
            }
        });

        const closeBtn = header.querySelector('[data-action="close"]');
        if (closeBtn) {
            closeBtn.before(btn);
        } else {
            header.appendChild(btn);
        }
    });

    // Fallback : tant qu'ImagePopout n'est pas migré vers ApplicationV2
    // dans cette version de Foundry, renderApplicationV2 ci-dessus ne se
    // déclenche jamais pour lui. On couvre donc aussi l'ancien hook v1.
    Hooks.on("renderImagePopout", (application, html, data) => {
        if (!game.user.isGM) return;
        if (!partyFeatureEnabled("enableShowParty")) return;

        const header = $(html).find(".window-header");
        if (!header.length) return;
        if (header.find(".share-image-party").length) return;

        const btn = $(`<button type="button" class="header-control icon fa-solid fa-user share-image-party" data-tooltip="Show Party" aria-label="Show Party"></button>`);
        btn.on("click", () => {
            const myPartyId = game.user.getFlag(MOD, "partyId");
            const users = game.users.filter(user =>
                user.id !== game.user.id &&
                user.getFlag(MOD, "partyId") === myPartyId
            );
            if (users.length > 0) {
                application.shareImage({ users: users.map(u => u.id) });
            } else {
                ui.notifications.warn("Aucun membre de la party connecté.");
            }
        });

        const closeBtn = header.find('[data-action="close"]');
        if (closeBtn.length) {
            closeBtn.first().before(btn);
        } else {
            header.append(btn);
        }
    });
}