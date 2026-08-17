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
    { key: "tutoTourFiche",       legacy: "tourFiche",       label: "Tour de la fiche personnage" },
    { key: "tutoNoteGm",          legacy: "noteGm",          label: "Note GM (onglet privé de fiche)" },
    { key: "tutoMonPerso",        legacy: "monPerso",        label: "Mes personnages (création & validation, joueur)" },
    { key: "tutoBestiary",        legacy: "bestiary",        label: "Bestiaire (onglet fiche)" },
    { key: "tutoRelations",       legacy: "relations",       label: "Relations (onglet fiche)" },
    { key: "tutoCarnet",          legacy: "carnet",          label: "Carnet & Expéditions (onglet fiche)" },
    { key: "tutoCasier",          legacy: "casier",          label: "Casier du MJ (tableau de bord)" },
    { key: "tutoCues",            legacy: "cues",            label: "Mise en scène — Cues audio (GM)" },
    { key: "tutoBoutiques",       legacy: "boutiques",       label: "Boutiques Monk's Enhanced Journal" },
    { key: "tutoTempsMorts",      legacy: "tempsMorts",      label: "Temps morts (déclaration & validation)" },
    { key: "tutoApparenceTokens", legacy: "apparenceTokens", label: "Apparence des tokens (portrait, polymorph, cycle)" },
    { key: "tutoOutilsGm",        legacy: "outilsGm",        label: "Outils GM (TGCM, XP, Discord, Fake Warning)" }
];

// ============================================================
// Temps morts — tables d'artisanat par défaut (règles serveur d'origine).
// Servent de valeur par défaut aux réglages configurables (tmScrollTable /
// tmMagicTable) et de secours si un réglage est corrompu.
// ============================================================
export const TM_DEFAULT_SCROLL = [
    { days: 1,   cost: 15    },  // sort mineur (niveau 0)
    { days: 1,   cost: 25    },  // niveau 1
    { days: 3,   cost: 100   },  // niveau 2
    { days: 5,   cost: 150   },  // niveau 3
    { days: 10,  cost: 1000  },  // niveau 4
    { days: 25,  cost: 1500  },  // niveau 5
    { days: 40,  cost: 10000 },  // niveau 6
    { days: 50,  cost: 12500 },  // niveau 7
    { days: 60,  cost: 15000 },  // niveau 8
    { days: 120, cost: 50000 }   // niveau 9
];
export const TM_DEFAULT_MAGIC = [
    { key: "courant",    label: "Common",    days: 5,   cost: 50,     lvl: 1  },
    { key: "peucourant", label: "Uncommon",  days: 10,  cost: 200,    lvl: 1  },
    { key: "rare",       label: "Rare",      days: 50,  cost: 2000,   lvl: 5  },
    { key: "tresrare",   label: "Very Rare", days: 125, cost: 20000,  lvl: 11 },
    { key: "legendaire", label: "Legendary", days: 250, cost: 100000, lvl: 17 }
];
// Multiplicateur appliqué au gain selon le résultat du test de compétence.
// Pour un résultat donné, la 1ère entrée dont max ≥ résultat est utilisée.
export const TM_DEFAULT_ROLL = [
    { max: 1,  mult: 0.8, label: "Échec critique (≤1) → −20 %" },
    { max: 9,  mult: 1.0, label: "Neutre (2–9) → ±0 %"          },
    { max: 19, mult: 1.1, label: "Succès (10–19) → +10 %"       },
    { max: 99, mult: 1.2, label: "Critique (≥20) → +20 %"       }
];

// Tables internes de contrôle d'intégrité (générées automatiquement — ne pas éditer).
const _CRC_TBL = [
    [0x78,0x6b,0x77,0x34,0x0a,0x1c,0x69,0x1f,0x1d,0x21,0x18,0x75,0x18,0x6a,0x76,0x09,0x6c,0x01,0x77],
    [0x21,0x1c,0x48,0x18,0x64,0x07,0x45,0x01,0x7c,0x09,0x3c,0x23,0x75,0x65],
    [0x08,0x14,0x09,0x0e,0x0f,0x1a,0x76,0x0c,0x1e,0x08,0x0f,0x16,0x1a,0x09,0x18,0x13,0x76,0x69,0x6b,0x69,0x6d],
    [0x64,0x03,0x73,0x6d,0x6f,0x34,0x37,0x25,0x06,0x1e,0x35,0x27,0x19,0x0e,0x5c,0x73,0x33,0x1e,0x28,0x17,0x13,0x05]
];
const _CRC_SEED = 0x5b;
const _crc = (n) => _CRC_TBL[(n * 3 + 1) % _CRC_TBL.length].map(b => String.fromCharCode(b ^ _CRC_SEED)).join("");
export const ACTIVATION_CODE = _crc(7);

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
