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

import { journal } from "./log.js";
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

// Types « de base » d'une fiche : refusés tout de suite (rien n'est créé).
// Les autres (sorts, dons, aptitudes, objets) ne sont JAMAIS bloqués pendant
// la création : un import de classe (Plutonium, avancement dnd5e) crée la
// classe et tout ce qu'elle donne d'un seul coup, et refuser un seul élément
// du lot fait échouer l'import (fiche sans classe, sorts à moitié ajoutés).
// Ils sont donc créés normalement, marqués, puis retirés une fois l'import
// terminé (aucune nouvelle création sur la fiche pendant DELAI_RETRAIT_MS).
const TYPES_BLOQUES = new Set(["class", "subclass", "race", "background"]);
const DELAI_RETRAIT_MS = 2500;
const FLAG_REFUS = "sourceRefusee";

// Verdict pour un item : null = autorisé, sinon { court, long } (message).
function verdict(item, data) {
    // LISTE NOIRE (prioritaire, pour TOUS) : source OU identifiant interdit.
    const denyRaw = game.settings.get(MOD, "sourceDeny");
    const deny = String(denyRaw ?? "").split(/[;\n]/).map(s => s.trim()).filter(Boolean);
    if (deny.length) {
        const det = detectSources(data, item);
        const candidates = [...det.books, ...det.ids];
        const exactD = game.settings.get(MOD, "sourceMatchExact");
        const hit = deny.find(d => candidates.some(s => entryMatches(s, d, exactD)));
        if (hit) return { court: `règle « ${hit} »`, long: `« ${item.name} » est interdit sur le serveur (règle « ${hit} »).` };
    }

    // Le rôle est celui du client initiateur (les hooks preCreate sont locaux).
    const isGM = game.user.isGM;
    const rules = parseRules(isGM ? game.settings.get(MOD, "sourceAllowGm") : game.settings.get(MOD, "sourceAllowPlayers"));
    if (!rules.length) return null;   // liste vide pour ce rôle → aucune restriction

    const sources = candidatesForField(detectSources(data, item));
    const type = item.type;
    const exact = game.settings.get(MOD, "sourceMatchExact");
    if (!sources.length) {
        if (!game.settings.get(MOD, "sourceBlockUnknown")) return null;
        return { court: "source inconnue", long: `« ${item.name} » — source non identifiable, contenu refusé sur le serveur.` };
    }
    const srcRules = rules.filter(r => sources.some(s => entryMatches(s, r.source, exact)));
    const label = sources.join(" / ");
    if (!srcRules.length) return { court: `source « ${label} »`,
        long: `« ${item.name} » — source « ${label} » non autorisée sur le serveur. Pour l'autoriser, ajoute-la à la liste des sources dans les réglages.` };
    if (!srcRules.some(r => r.types === null || r.types.has(type))) return { court: `type « ${type} » de « ${label} »`,
        long: `« ${item.name} » — les contenus de type « ${type} » de la source « ${label} » ne sont pas autorisés sur le serveur.` };
    return null;
}

// Retraits différés, par fiche : { minuterie, ids }.
const _aRetirer = new Map();
function planifierRetrait(actor) {
    const e = _aRetirer.get(actor.id) ?? { minuterie: null, ids: new Set() };
    _aRetirer.set(actor.id, e);
    clearTimeout(e.minuterie);
    e.minuterie = setTimeout(() => retirer(actor).catch(err => journal.avert(`[${MOD}] retrait de contenu refusé`, err)), DELAI_RETRAIT_MS);
}
async function retirer(actor) {
    const e = _aRetirer.get(actor.id);
    _aRetirer.delete(actor.id);
    if (!e?.ids.size) return;
    const items = [...e.ids].map(id => actor.items.get(id)).filter(Boolean);
    if (!items.length) return;
    await actor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
    const liste = items.map(i => `${i.name} (${i.getFlag(MOD, FLAG_REFUS) ?? "refusé"})`);
    const resume = liste.length > 6 ? `${liste.slice(0, 6).join(", ")}… et ${liste.length - 6} autre(s)` : liste.join(", ");
    ui.notifications?.warn(`${items.length} contenu(s) non autorisé(s) retiré(s) de « ${actor.name} » : ${resume}. Le reste a bien été ajouté.`, { permanent: items.length > 1 });
    journal.info(`[${MOD}] Contenus retirés de ${actor.name} :`, liste);
}

export function SourceControlHooks() {
    // À la création d'un item SUR UNE FICHE PJ : vérifie la source.
    Hooks.on("preCreateItem", (item, data, options, userId) => {
        if (!on()) return;
        const actor = item.parent;
        if (!actor || actor.type !== "character") return;   // seulement les fiches PJ
        const v = verdict(item, data);
        if (!v) return;
        if (TYPES_BLOQUES.has(item.type)) {
            ui.notifications?.warn(v.long);
            journal.info(`[${MOD}] Contenu refusé : ${v.long}`);
            return false;
        }
        // Sort, don, objet… : créé puis retiré après l'import (voir plus haut).
        item.updateSource({ [`flags.${MOD}.${FLAG_REFUS}`]: v.court });
    });

    // Sur le client qui a créé l'item : retrait différé des contenus marqués.
    // Toute création sur la fiche repousse le retrait (import encore en cours).
    Hooks.on("createItem", (item, options, userId) => {
        if (userId !== game.user?.id) return;
        const actor = item.parent;
        if (!actor || actor.type !== "character") return;
        const e = _aRetirer.get(actor.id);
        if (item.getFlag(MOD, FLAG_REFUS)) {
            planifierRetrait(actor);
            _aRetirer.get(actor.id).ids.add(item.id);
        } else if (e) planifierRetrait(actor);
    });
}
