// ============================================================
// toolbar.js — Bouton WestMarch (joueurs + GM)
// ============================================================

import { showTutorialSelector } from './welcome.js';

export function registerTutorielButton() {
    Hooks.on("getSceneControlButtons", (controls) => {
        // Accessible aux joueurs ET au GM — crée le groupe si absent
        // (pour les joueurs, aucun module GM ne crée le groupe WestMarch)
        if (!controls.westmarch) {
            controls.westmarch = {
                name:  "westmarch",
                title: "WestMarch",
                icon:  "fa-solid fa-hammer",
                layer: "tokens",
                tools: {}
            };
        }

        controls.westmarch.tools.tutoriel = {
            name:     "tutoriel",
            title:    "Ouvrir le guide / tutoriel",
            icon:     "fa-solid fa-circle-question",
            button:   true,
            onChange: () => showTutorialSelector(),
            visible:  true
        };
    });
}
