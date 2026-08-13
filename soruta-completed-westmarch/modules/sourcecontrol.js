// ============================================================
// sourcecontrol.js — Contrôle des sources (livres/extensions) autorisées
//
// But : réglementer QUELS livres D&D (Plutonium / 5etools : Xanathar,
// Tal'Dorei, etc.) peuvent être ajoutés à une fiche PJ. On ne cherche PAS
// à identifier le module auteur (Foundry ne l'expose pas), mais la SOURCE
// du contenu ajouté (system.source + flags Plutonium) — ce qui couvre
// n'importe quelle méthode d'ajout (import Plutonium, glisser-déposer,
// création manuelle).
//
// Deux listes blanches distinctes : une pour les joueurs, une pour le MJ.
// Contenu dont la source n'est pas autorisée → bloqué + avertissement.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const on = () => game.settings.get(MOD, "enableSourceControl");

// Normalise un mot-clé (repli d'accents + minuscules + alphanum. seulement).
const _slug = (s) => String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");

// Mots-clés de type → types d'items dnd5e. « objet » couvre tout le matériel.
const TYPE_ALIASES = {
    race: ["race"],
    classe: ["class"], class: ["class"],
    sousclasse: ["subclass"], subclass: ["subclass"],
    don: ["feat"], feat: ["feat"], aptitude: ["feat"],
    sort: ["spell"], spell: ["spell"], sortilege: ["spell"],
    historique: ["background"], background: ["background"],
    objet: ["weapon", "equipment", "consumable", "tool", "loot", "container"],
    item: ["weapon", "equipment", "consumable", "tool", "loot", "container"],
    equipement: ["weapon", "equipment", "consumable", "tool", "loot", "container"]
};

// Parse une liste de règles. Séparateur d'entrées : « ; » ou retour ligne.
// Chaque entrée : « Source »  (tous types)  ou  « Source : type1, type2 »
// (uniquement ces types). Sans « : », les virgules séparent plusieurs sources
// (rétro-compatible avec l'ancienne liste par virgules).
function parseRules(raw) {
    const rules = [];
    const entries = String(raw ?? "").split(/[;\n]/).map(s => s.trim()).filter(Boolean);
    for (const entry of entries) {
        const ci = entry.indexOf(":");
        if (ci === -1) {
            for (const src of entry.split(",").map(s => s.trim()).filter(Boolean)) {
                rules.push({ source: src, types: null });   // null = tous types
            }
        } else {
            const src = entry.slice(0, ci).trim();
            if (!src) continue;
            const types = new Set();
            for (const t of entry.slice(ci + 1).split(",").map(s => s.trim()).filter(Boolean)) {
                (TYPE_ALIASES[_slug(t)] ?? [_slug(t)]).forEach(x => types.add(x));
            }
            rules.push({ source: src, types: types.size ? types : null });
        }
    }
    return rules;
}

// Normalise pour comparaison souple : minuscules, sans espaces ni ponctuation.
const _norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Une entrée de liste correspond-elle à une source détectée ?
//  - exact (défaut) : égalité stricte après normalisation → « PHB » n'attrape
//    PAS « XPHB » (PHB 2024), les sources proches ne sont jamais confondues.
//  - souple : inclusion dans un sens ou l'autre (« xanathar » ↔ « Xanathar's Guide »).
function entryMatches(sourceStr, entry, exact) {
    const c = _norm(sourceStr), e = _norm(entry);
    if (!c || !e) return false;
    return exact ? c === e : (c.includes(e) || e.includes(c));
}

// Extrait les valeurs candidates d'un item, séparées par champ :
//  - books : le livre/source (champ « Book », Custom Label, flags)
//  - ids   : l'identifiant précis (champ « Identifier » = system.identifier)
function detectSources(data, item) {
    const books = [], ids = [];
    const add = (arr, v) => { if (v != null && String(v).trim()) arr.push(String(v).trim()); };

    const sys = data?.system ?? item?.system ?? {};
    const src = sys.source;
    if (typeof src === "string") add(books, src);
    else if (src && typeof src === "object") { add(books, src.book); add(books, src.custom); }

    const flags = data?.flags ?? item?.flags ?? {};
    for (const ns of ["plutonium", "5etools", "srd5e"]) {
        const f = flags[ns];
        if (f && typeof f === "object") { add(books, f.source); add(books, f.book); }
    }

    add(ids, sys.identifier);
    if (src && typeof src === "object") add(ids, src.identifier);

    return { books: [...new Set(books)], ids: [...new Set(ids)] };
}

// Valeurs à comparer selon le champ choisi dans les réglages.
function candidatesForField(det) {
    switch (game.settings.get(MOD, "sourceMatchField")) {
        case "identifier": return det.ids;
        case "both":       return [...det.books, ...det.ids];
        default:           return det.books;   // "book"
    }
}

export function SourceControlHooks() {
    // À la création d'un item SUR UNE FICHE PJ : vérifie la source.
    Hooks.on("preCreateItem", (item, data, options, userId) => {
        if (!on()) return;
        const actor = item.parent;
        if (!actor || actor.type !== "character") return;   // seulement les fiches PJ

        // Le rôle est celui du client initiateur (les hooks preCreate sont locaux).
        const isGM = game.user.isGM;
        const listRaw = isGM
            ? game.settings.get(MOD, "sourceAllowGm")
            : game.settings.get(MOD, "sourceAllowPlayers");
        const rules = parseRules(listRaw);

        // Liste vide pour ce rôle → aucune restriction (anti-verrouillage total).
        if (!rules.length) return;

        const sources = candidatesForField(detectSources(data, item));
        const type = item.type;
        const blockUnknown = game.settings.get(MOD, "sourceBlockUnknown");
        const exact = game.settings.get(MOD, "sourceMatchExact");

        // Pas de source identifiable → selon l'option.
        if (!sources.length) {
            if (!blockUnknown) return;
            ui.notifications?.warn(`« ${item.name} » — source non identifiable, contenu refusé sur le serveur.`);
            console.warn(`[${MOD}] Source inconnue refusée : ${item.name} — rôle ${isGM ? "MJ" : "joueur"}.`);
            return false;
        }

        // Règles dont la SOURCE correspond à ce contenu.
        const srcRules = rules.filter(r => sources.some(s => entryMatches(s, r.source, exact)));
        const label = sources.join(" / ");

        if (!srcRules.length) {
            // Source pas du tout autorisée.
            ui.notifications?.warn(
                `« ${item.name} » — source « ${label} » non autorisée sur le serveur. `
                + `Pour l'autoriser, ajoute-la à la liste des sources dans les réglages.`
            );
            console.warn(`[${MOD}] Source refusée : ${item.name} (${label}) — rôle ${isGM ? "MJ" : "joueur"}.`);
            return false;
        }

        // Source autorisée : le TYPE de ce contenu est-il permis pour cette source ?
        const typeOk = srcRules.some(r => r.types === null || r.types.has(type));
        if (!typeOk) {
            ui.notifications?.warn(
                `« ${item.name} » — les contenus de type « ${type} » de la source « ${label} » `
                + `ne sont pas autorisés sur le serveur.`
            );
            console.warn(`[${MOD}] Type refusé : ${item.name} (${type} / ${label}) — rôle ${isGM ? "MJ" : "joueur"}.`);
            return false;
        }
    });
}
