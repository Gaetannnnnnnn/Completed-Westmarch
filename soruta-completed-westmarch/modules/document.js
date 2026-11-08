import { MOD } from "./const.js";
export function DocumentHooks() {
    Hooks.on("renderDocumentOwnershipConfig", (app, html, data) => {
        try { if (game.settings.get(MOD, "enableOwnershipScroll") === false) return; } catch {}
        const container = $(html).find(".window-content.standard-form");

        container.css({
            "max-height": "70vh",
            "overflow-y": "auto"
        });
    });
}