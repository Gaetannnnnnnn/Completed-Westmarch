// ============================================================
// i18n.js — Langue du module.
//
// Le texte source du module est en français ; chaque texte affiché passe par
// tl("texte français", ...valeurs). La langue suit le réglage « Langue » de
// Foundry de chaque utilisateur, sauf si l'utilisateur a choisi une langue
// dans le réglage « Langue du module » (auto / English / Français) :
//   - français (fr, fr-FR…) → le texte d'origine ;
//   - toute autre langue    → l'anglais (dictionnaire i18n-en.js).
// Un texte absent du dictionnaire reste affiché tel quel (jamais d'erreur).
// Les valeurs {0}, {1}… sont remplacées dans l'ordre par les arguments.
// © 2026 Soruta.
// ============================================================

import EN from "./i18n-en.js";

const MOD_ID = "soruta-completed-westmarch";
const CLE_CHOIX = "moduleLanguage";

// Choix de l'utilisateur pour la langue du MODULE (réglage client) :
// "auto" = suivre la langue de Foundry, "fr" ou "en" = forcer.
// Lu aussi avant l'initialisation du jeu, dans le stockage local du navigateur
// où Foundry range les réglages client.
function choixModule() {
    try {
        const v = globalThis.game?.settings?.settings?.has?.(`${MOD_ID}.${CLE_CHOIX}`)
            ? globalThis.game.settings.get(MOD_ID, CLE_CHOIX) : null;
        if (v) return String(v);
    } catch { /* */ }
    try {
        const brut = globalThis.localStorage?.getItem(`${MOD_ID}.${CLE_CHOIX}`);
        if (brut) { try { return String(JSON.parse(brut)); } catch { return String(brut); } }
    } catch { /* */ }
    return "auto";
}

// Langue utilisée par le module : le choix forcé s'il y en a un, sinon la
// langue de Foundry (réglage client « core.language » avant l'initialisation).
export function langue() {
    const c = choixModule();
    if (c === "fr" || c === "en") return c;
    try { const l = globalThis.game?.i18n?.lang; if (l) return String(l); } catch { /* */ }
    try {
        const v = globalThis.localStorage?.getItem("core.language");
        if (v) { try { return String(JSON.parse(v)); } catch { return String(v); } }
    } catch { /* */ }
    return "en";
}

export const estFr = () => langue().toLowerCase().startsWith("fr");

/** Texte traduit. `fr` est le texte français d'origine. */
export function tl(fr, ...valeurs) {
    let s = estFr() ? fr : (EN[fr] ?? fr);
    if (valeurs.length) {
        s = String(s).replace(/\{(\d+)\}/g, (m, i) => {
            const v = valeurs[Number(i)];
            return v === undefined || v === null ? "" : String(v);
        });
    }
    return s;
}

/** Locale pour les dates et les nombres. */
export const locale = () => (estFr() ? "fr-FR" : "en-US");

/** Vrai si `nom` est le texte `fr` dans l'une des deux langues
 *  (dossiers et documents créés par le module, quel que soit le MJ). */
export function memeNom(nom, fr) {
    return nom === fr || (EN[fr] !== undefined && nom === EN[fr]);
}

/** Les deux formes d'un nom, pour une recherche. */
export const nomsPossibles = (fr) => (EN[fr] && EN[fr] !== fr ? [fr, EN[fr]] : [fr]);

/** Réglage client « Langue du module » (enregistré au tout début de l'init,
 *  même sans licence, pour rester accessible). */
export function registerLangueSetting() {
    game.settings.register(MOD_ID, CLE_CHOIX, {
        name: "Module language / Langue du module",
        hint: "Language of Soruta — Completed Westmarch for you only. Automatic = the Foundry language. — Langue du module pour toi seulement. Automatique = la langue de Foundry.",
        scope: "client", config: true, type: String, requiresReload: true,
        choices: { auto: "Automatic / Automatique", en: "English", fr: "Français" },
        default: "auto"
    });
}
