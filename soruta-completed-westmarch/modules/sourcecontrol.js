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

// Découpe une liste saisie (virgules, points-virgules ou retours ligne).
function parseList(raw) {
    return String(raw ?? "")
        .split(/[,;\n]/)
        .map(s => s.trim())
        .filter(Boolean);
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

// Extrait les chaînes de source candidates d'un item (données de création).
function detectSources(data, item) {
    const out = [];
    const push = (v) => { if (v != null && String(v).trim()) out.push(String(v).trim()); };

    const sys = data?.system ?? item?.system ?? {};
    const src = sys.source;
    if (typeof src === "string") push(src);
    else if (src && typeof src === "object") { push(src.book); push(src.custom); }

    const flags = data?.flags ?? item?.flags ?? {};
    for (const ns of ["plutonium", "5etools", "srd5e"]) {
        const f = flags[ns];
        if (f && typeof f === "object") { push(f.source); push(f.book); }
    }
    // Dédoublonne.
    return [...new Set(out)];
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
        const allow = parseList(listRaw);

        // Liste vide pour ce rôle → aucune restriction (anti-verrouillage total).
        if (!allow.length) return;

        const sources = detectSources(data, item);
        const blockUnknown = game.settings.get(MOD, "sourceBlockUnknown");
        const exact = game.settings.get(MOD, "sourceMatchExact");

        let ok, label;
        if (!sources.length) {
            ok = !blockUnknown;                 // pas de source identifiable
            label = "source inconnue";
        } else {
            ok = sources.some(s => allow.some(a => entryMatches(s, a, exact)));
            label = sources.join(" / ");
        }

        if (!ok) {
            ui.notifications?.warn(
                `« ${item.name} » — source « ${label} » non autorisée sur le serveur. `
                + `Pour l'autoriser, ajoute-la à la liste des sources dans les réglages.`
            );
            console.warn(`[${MOD}] Source refusée : ${item.name} (${label}) — rôle ${isGM ? "MJ" : "joueur"}.`);
            return false;                       // bloque la création
        }
    });
}
