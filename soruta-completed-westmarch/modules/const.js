// ============================================================
// const.js — Constantes partagées du module fusionné
// Soruta — Completed Westmarch
// © 2026 Soruta.
// ============================================================

// Identifiant unique du module fusionné. Sert de namespace pour TOUS les
// settings et TOUS les flags (après migration depuis les anciens modules).
export const MOD = "soruta-completed-westmarch";

// Toggles de sections du tutoriel (clé de setting = "tuto" + Capitalized).
// Partagé entre settings.js (enregistrement) et tutorial.js (filtrage).
export const TUTO_TOGGLES = [
    { key: "tutoBarreWestmarch",  legacy: "barreWestmarch",  label: "Barre WestMarch (navigation & groupe)" },
    { key: "tutoBestiary",        legacy: "bestiary",        label: "Bestiaire (onglet fiche)" },
    { key: "tutoRelations",       legacy: "relations",       label: "Relations (onglet fiche)" },
    { key: "tutoCarnet",          legacy: "carnet",          label: "Carnet & Expéditions (onglet fiche)" },
    { key: "tutoBoutiques",       legacy: "boutiques",       label: "Boutiques Monk's Enhanced Journal" },
    { key: "tutoTempsMorts",      legacy: "tempsMorts",      label: "Temps morts (déclaration & validation)" },
    { key: "tutoApparenceTokens", legacy: "apparenceTokens", label: "Apparence des tokens (portrait, polymorph, cycle)" },
    { key: "tutoOutilsGm",        legacy: "outilsGm",        label: "Outils GM (TGCM, XP, Discord, Fake Warning)" }
];

// Anciens identifiants de module, conservés uniquement pour la migration
// automatique des données existantes (voir migration.js).
export const LEGACY_IDS = [
    "westmarch",
    "westmarch-ashara",
    "toolkit",
    "ashara-relations",
    "ashara-bestiary",
    "carnet",
    "carte-expeditions",
    "midi-range-fix",
    "tutoriel"
];
