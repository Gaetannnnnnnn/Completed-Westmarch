// ============================================================
// toolbar.js — Bouton WestMarch (joueurs + GM)
// ============================================================

import { MOD } from './const.js';
import { showTutorialSelector } from './welcome.js';

export function registerTutorielButton() {
    Hooks.on("getSceneControlButtons", (controls) => {
        // Le hook est toujours enregistré ; on vérifie le setting ICI (et non
        // à l'appel, à l'init) pour que l'activation/désactivation via la case
        // "Activé" du Tutoriel soit prise en compte au rechargement suivant,
        // sans dépendre de l'ordre d'initialisation.
        if (!game.settings.get(MOD, "tutoEnabled")) return;

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
