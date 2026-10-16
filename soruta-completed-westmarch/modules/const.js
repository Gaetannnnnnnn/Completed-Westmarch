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
    { key: "tutoCarteExpedition", legacy: "carteExpedition", label: "Carte des expéditions (brouillard maison, GM)" },
    { key: "tutoCues",            legacy: "cues",            label: "Mise en scène — Cues audio (GM)" },
    { key: "tutoBoutiques",       legacy: "boutiques",       label: "Boutiques Monk's Enhanced Journal" },
    { key: "tutoTempsMorts",      legacy: "tempsMorts",      label: "Temps morts (déclaration & validation)" },
    { key: "tutoApparenceTokens", legacy: "apparenceTokens", label: "Apparence des tokens (portrait, polymorph, cycle)" },
    { key: "tutoOutilsGm",        legacy: "outilsGm",        label: "Outils GM (TGCM, XP, Discord, Fake Warning)" },
    { key: "tutoAccessibilite",   legacy: "accessibilite",   label: "Accessibilité (daltonisme, contraste…)" },
    { key: "tutoEchange",         legacy: "echange",         label: "Échange entre joueurs" },
    { key: "tutoTransformation",  legacy: "transformation",  label: "Transformations (Wild Shape / Polymorphie)" },
    { key: "tutoCompagnons",      legacy: "compagnons",      label: "Compagnons évolutifs (GM)" },
    { key: "tutoPantheon",        legacy: "pantheon",        label: "Panthéons (Dieux de Faerûn)" }
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

// Graine d'obfuscation du code de désactivation ci-dessous. (L'ancien code
// d'activation obfusqué a été retiré : la licence est désormais validée par le
// serveur, voir licence.js.)
const _CRC_SEED = 0x5b;

// Code de DÉSACTIVATION (kill-switch discret dans la fenêtre « À propos »,
// visible par tous mais actionnable uniquement par le MJ qui connaît le code).
// Réversible : ressaisir le même code réactive le module. Obfusqué (XOR seed)
// comme le code d'activation — dissuasif seulement.
// ⟵ Octets ci-dessous = forme obfusquée du code choisi par le MJ (vide = inerte).
const _dob = (bytes) => bytes.map(b => String.fromCharCode(b ^ _CRC_SEED)).join("");
export const DEACTIVATION_CODE = _dob([0x08,0x14,0x09,0x0e,0x0f,0x1a,0x76,0x0c,0x1e,0x08,0x0f,0x16,0x1a,0x09,0x18,0x13]);

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
