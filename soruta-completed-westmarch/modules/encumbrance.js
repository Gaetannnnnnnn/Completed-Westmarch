import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
import { badgeActif } from "./gere.js";
// ============================================================
// encumbrance.js — Pénalités de poids (vitesse) aux 3 paliers de la fiche
//
// La barre d'encombrement de la fiche dnd5e a 3 paliers, calculés par le
// système (attributes.encumbrance.thresholds) :
//   1. encumbered          (5 × Force, règle variante 2014)
//   2. heavilyEncumbered   (10 × Force)
//   3. maximum             (15 × Force = capacité de transport)
// (multipliés selon la taille et Powerful Build, comme dnd5e.)
//
// Quand le poids porté DÉPASSE un palier, la vitesse de déplacement (tous
// les modes : marche, nage, escalade, vol…) suit la règle réglée pour ce
// palier : soit un FACTEUR (« 2/3 », « 0,5 », « 50% », « 0 »), soit un
// PLAFOND en distance (« 5ft », « 1,5m » : la vitesse ne peut pas dépasser
// cette valeur). Arrondi vers le bas à la case (5 ft / 1,5 m).
//
// Défauts = règles 2024 (PHB 2024, capacité de transport) : aucune pénalité
// aux paliers 1 et 2 ; au-delà de la capacité (15 × Force), on ne fait plus
// que traîner / pousser la charge, vitesse 5 ft maximum.
//
// Pendant que la fonction est active, les réductions de vitesse propres à
// dnd5e (−10 / −20 ft, plafond 5 ft) sont neutralisées pour ne pas se
// cumuler ; les icônes de statut dnd5e restent (information).
//
// Réglages (Toolkit) : enableEncumbrancePenalty (désactivé par défaut),
// encPenalty1, encPenalty2, encPenalty3.
// Calcul en mémoire, rien n'est écrit sur la fiche.
// © 2026 Soruta.
// ============================================================

const actif = () => { try { return game.settings.get(MOD, "enableEncumbrancePenalty") === true; } catch { return false; } };

// « 2/3 », « 0,5 », « 1 », « 50% » → { facteur } entre 0 et 1 ;
// « 5ft », « 5 ft », « 1,5m » → { plafond, unite } (vitesse max.) ; sinon défaut.
const PIEDS_PAR_M = 10 / 3; // 1,5 m = 5 ft (grille D&D)
export function lireRegle(txt, defaut = { facteur: 1 }) {
    const t = String(txt ?? "").trim().toLowerCase().replace(",", ".").replace(/\s+/g, "");
    if (!t) return defaut;
    const d = t.match(/^(\d+(?:\.\d+)?)(ft|pieds?|m)$/);
    if (d) return { plafond: Number(d[1]), unite: d[2] === "m" ? "m" : "ft" };
    let v;
    if (/^\d+(\.\d+)?%$/.test(t)) v = Number(t.slice(0, -1)) / 100;
    else if (/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(t)) { const [x, y] = t.split("/").map(Number); v = y ? x / y : NaN; }
    else v = Number(t);
    return Number.isFinite(v) ? { facteur: Math.min(1, Math.max(0, v)) } : defaut;
}
// Plafond converti dans l'unité de la fiche.
function plafondEn(regle, unites) {
    const enM = unites === "m" || unites === "km";
    if (regle.unite === "m") return enM ? regle.plafond : regle.plafond * PIEDS_PAR_M;
    return enM ? regle.plafond / PIEDS_PAR_M : regle.plafond;
}
const regles = () => {
    const g = (k, d) => { try { return game.settings.get(MOD, k); } catch { return d; } };
    return [["encPenalty1", "1", { facteur: 1 }], ["encPenalty2", "1", { facteur: 1 }], ["encPenalty3", "5ft", { plafond: 5, unite: "ft" }]]
        .map(([k, d, def]) => { const brut = String(g(k, d) ?? "").trim(); return { ...lireRegle(brut, def), brut }; });
};
const sansEffet = (r) => !("plafond" in r) && r.facteur >= 1;

// Palier dépassé : 0 (aucun) à 3.
export function palierDepasse(enc) {
    if (!enc?.thresholds) return 0;
    const v = Number(enc.value) || 0, t = enc.thresholds;
    if (Number.isFinite(t.maximum) && v > t.maximum) return 3;
    if (Number.isFinite(t.heavilyEncumbered) && v > t.heavilyEncumbered) return 2;
    if (Number.isFinite(t.encumbered) && v > t.encumbered) return 1;
    return 0;
}

// Ce que la fonction a changé sur l'acteur (pour l'afficher au survol).
const MODIFS = new WeakMap();
export const penaliteDe = (actor) => (actor?.system ? MODIFS.get(actor.system) ?? null : null);

function appliquer(actor) {
    const sys = actor?.system;
    MODIFS.delete(sys ?? {});
    if (!actif() || !sys || actor.type !== "character") return;
    const enc = sys.attributes?.encumbrance;
    const mv = sys.attributes?.movement;
    if (!enc || !mv) return;
    const palier = palierDepasse(enc);
    if (!palier) return;
    const regle = regles()[palier - 1];
    if (sansEffet(regle)) return;
    const pas = (mv.units === "m" || mv.units === "km") ? 1.5 : 5;
    const avant = {};
    let max = 0;
    // dnd5e 6 : movement.speeds.{walk, fly…} ; versions antérieures : movement.{walk, fly…}.
    const table = (mv.speeds && typeof mv.speeds === "object") ? mv.speeds : mv;
    for (const type of Object.keys(CONFIG.DND5E?.movementTypes ?? { walk: 1 })) {
        const v = Number(table[type]);
        if (!Number.isFinite(v) || v <= 0) continue;
        avant[type] = v;
        const cible = ("plafond" in regle) ? Math.min(v, plafondEn(regle, mv.units)) : v * regle.facteur;
        const n = Math.floor(cible / pas + 1e-9) * pas;
        table[type] = Math.max(0, Math.min(v, n));
        max = Math.max(max, table[type]);
    }
    if ("max" in mv) mv.max = max;
    if ("speed" in mv && "walk" in avant) mv.speed = table.walk;
    MODIFS.set(sys, { palier, regle, avant, poids: enc.value, seuil: palier === 3 ? enc.thresholds.maximum : palier === 2 ? enc.thresholds.heavilyEncumbered : enc.thresholds.encumbered });
}

// Neutralise / rétablit les réductions de vitesse propres à dnd5e.
let _origine = null;
export function synchroniserDnd5e() {
    const sr = CONFIG.DND5E?.encumbrance?.speedReduction;
    if (!sr) return;
    if (!_origine) _origine = foundry.utils.deepClone(sr);
    if (actif()) {
        for (const k of ["encumbered", "heavilyEncumbered"]) for (const u of Object.keys(sr[k] ?? {})) sr[k][u] = 0;
        for (const u of Object.keys(sr.exceedingCarryingCapacity ?? {})) sr.exceedingCarryingCapacity[u] = Infinity;
    } else {
        foundry.utils.mergeObject(sr, foundry.utils.deepClone(_origine));
    }
}
export function rafraichirActeurs() {
    synchroniserDnd5e();
    for (const a of game.actors ?? []) {
        if (a.type !== "character") continue;
        try { a.reset(); if (a.sheet?.rendered) a.sheet.render(); } catch { /* */ }
    }
}

// ---------- Bulle « règles utilisées » sur la barre d'encombrement ----------
const nomModule = () => game.modules?.get?.(MOD)?.title || "Soruta — Completed Westmarch";
const nombre = (n) => { const v = Math.round(Number(n) * 10) / 10; try { return v.toLocaleString(game.i18n?.lang || undefined); } catch { return String(v); } };
function texteRegle(r) {
    if ("plafond" in r) return r.plafond <= 0 ? tl("ne peut plus bouger") : tl("vitesse {0} {1} maximum", nombre(r.plafond), r.unite);
    if (r.facteur >= 1) return tl("aucune pénalité");
    if (r.facteur <= 0) return tl("ne peut plus bouger");
    const lisible = /^\d+([.,]\d+)?(\/\d+([.,]\d+)?|%)?$/.test(r.brut.replace(/\s+/g, "")) ? r.brut.replace(/\s+/g, "") : nombre(r.facteur);
    return tl("vitesse × {0}", lisible);
}
function uniteSeuils(enc) {
    if (enc?.units && enc.units !== "Items") {
        const lbl = CONFIG.DND5E?.weightUnits?.[enc.units]?.abbreviation;
        return lbl ? game.i18n.localize(lbl) : enc.units;
    }
    try { return game.settings.get("dnd5e", "metricWeightUnits") ? "kg" : "lb"; } catch { return "lb"; }
}
export function bulleRegles(actor) {
    const e = (t) => foundry.utils.escapeHTML(String(t ?? ""));
    const enc = actor?.system?.attributes?.encumbrance;
    const t = enc?.thresholds ?? {};
    const u = uniteSeuils(enc);
    const rs = regles();
    const palier = palierDepasse(enc);
    const lignes = [
        [1, tl("1er palier"), t.encumbered],
        [2, tl("2e palier"), t.heavilyEncumbered],
        [3, tl("3e palier (capacité)"), t.maximum]
    ].map(([n, nom, seuil]) => {
        const txt = `${e(nom)} : ${e(tl("au-delà de {0} {1}", nombre(seuil), u))} → ${e(texteRegle(rs[n - 1]))}`;
        return n === palier ? `<br>▶ <strong>${txt}</strong>` : `<br>• ${txt}`;
    }).join("");
    const m = penaliteDe(actor);
    let etat;
    if (!palier) etat = tl("Poids porté : {0} {1}, aucun palier dépassé.", nombre(enc?.value), u);
    else if (!m) etat = tl("Poids porté : {0} {1}, palier {2} dépassé : aucune pénalité.", nombre(enc?.value), u, palier);
    else {
        const mv = actor.system.attributes.movement;
        const table = (mv.speeds && typeof mv.speeds === "object") ? mv.speeds : mv;
        const unite = mv.units || "ft";
        const vit = Object.entries(m.avant).map(([type, v]) => {
            const lbl = CONFIG.DND5E?.movementTypes?.[type];
            const nom = typeof lbl === "string" ? game.i18n.localize(lbl) : (lbl?.label ? game.i18n.localize(lbl.label) : type);
            return `${nom} ${nombre(v)} → ${nombre(table[type])} ${unite}`;
        }).join(", ");
        etat = tl("Poids porté : {0} {1}, palier {2} dépassé. Vitesse : {3}.", nombre(enc?.value), u, palier, vit);
    }
    return `<strong>${e(tl("Pénalités de poids — {0}", nomModule()))}</strong>`
        + `<br><em>${e(tl("Règles utilisées pour cette fiche :"))}</em>${lignes}`
        + `<br><br>${e(etat)}`
        + `<br><small>${e(tl("Arrondi à la case. Remplace les réductions de vitesse de dnd5e (−10 / −20 ft)."))}</small>`;
}
function ajouterBulle(app, html) {
    try {
        if (!actif() || !badgeActif()) return;
        const actor = app?.document ?? app?.actor;
        if (!(actor instanceof Actor) || actor.type !== "character") return;
        const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element);
        if (!root?.querySelectorAll) return;
        root.querySelectorAll(".encumbrance").forEach(bloc => {
            if (bloc.parentElement?.closest(".encumbrance") || bloc.querySelector(".scwm-enc-regles")) return;
            const cible = bloc.querySelector(".meter .label") ?? bloc.querySelector(".meter") ?? bloc;
            const i = document.createElement("i");
            const penalise = !!penaliteDe(actor);
            i.className = "fa-solid fa-gears scwm-enc-regles";
            i.tabIndex = 0;
            i.dataset.tooltipHtml = bulleRegles(actor);
            i.dataset.tooltipDirection = "UP";
            i.setAttribute("aria-label", tl("Pénalités de poids — règles utilisées"));
            i.style.cssText = `color:${penalise ? "#e06c5a" : "#c9a227"};font-size:.85em;margin-left:6px;opacity:.9;cursor:help;pointer-events:auto;position:relative;z-index:2;`;
            cible.appendChild(i);
        });
    } catch { /* jamais bloquant pour la fiche */ }
}

export function EncumbranceHooks() {
    Hooks.on("renderActorSheetV2", ajouterBulle);
    Hooks.on("renderActorSheet", ajouterBulle);
    Hooks.once("ready", () => { try { synchroniserDnd5e(); if (actif()) rafraichirActeurs(); } catch (e) { journal.avert(tl("[{0}] Pénalités de poids :", MOD), e); } });
    // Après le calcul dnd5e de l'acteur (vitesses comprises).
    const cible = "CONFIG.Actor.documentClass.prototype.prepareDerivedData";
    const apres = function (wrapped, ...args) {
        const r = wrapped(...args);
        try { appliquer(this); } catch (e) { journal.avert(tl("[{0}] Pénalités de poids :", MOD), e); }
        return r;
    };
    try {
        if (game.modules.get("lib-wrapper")?.active && globalThis.libWrapper) {
            libWrapper.register(MOD, cible, apres, "WRAPPER");
        } else {
            const proto = CONFIG.Actor.documentClass.prototype;
            const original = proto.prepareDerivedData;
            if (typeof original !== "function") return;
            proto.prepareDerivedData = function (...args) { return apres.call(this, original.bind(this), ...args); };
        }
    } catch (e) {
        journal.erreur(tl("[{0}] Pénalités de poids : impossible de s'insérer dans dnd5e.", MOD), e);
    }
}
