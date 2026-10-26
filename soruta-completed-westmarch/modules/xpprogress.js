// ============================================================
// xpprogress.js — Progression par l'XP de base de D&D 5e
//
// Complète le système d'XP natif (quand le système d'étoiles est éteint) :
//   - une XP PAR SESSION unique (ex. 500), réglée par le staff : c'est l'XP
//     proposée par défaut dans « Clore la session » ;
//   - des PALIERS de niveau, au choix :
//       · « D&D » (par défaut) : les paliers officiels de D&D 5e ; le module
//         affiche combien de sessions et de mois réels il faut, avec l'XP par
//         session et le nombre de SESSIONS PAR SEMAINE réglés ;
//       · « Objectif » : un objectif en MOIS RÉELS pour atteindre le niveau
//         max ; les paliers de D&D sont mis à l'échelle pour l'atteindre, en
//         gardant leurs proportions (premiers niveaux rapides, derniers longs :
//         le nombre de sessions varie d'un niveau à l'autre) ;
//     chaque niveau reste modifiable dans le tableau. Les paliers en vigueur
//     REMPLACENT ceux du système dnd5e (CONFIG.DND5E.CHARACTER_EXP_LEVELS)
//     quand la progression est activée ;
//   - des PLAGES de niveaux, chacune avec ses BONUS d'XP (nom + montant),
//     proposés (non cochés) dans « Clore la session » ;
//   - un NIVEAU MAX autorisé sur le serveur : au-delà, toute montée de niveau
//     est bloquée (MJ compris) et l'XP est plafonnée au palier de ce niveau.
//     Ce verrou s'applique aussi au système d'étoiles.
//
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { tl, locale } from "./i18n.js";

// Paliers d'XP de D&D 5e : index i = XP totale pour être niveau i+1.
export const XP_SEUILS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
    85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
export const NIVEAU_MAX = 20;

export const SEMAINES_PAR_MOIS = 52 / 12;
const DEFAUT = {
    plafond: NIVEAU_MAX,   // niveau max autorisé (20 = aucun verrou)
    xpSession: 500,        // XP donnée par session (proposée à la clôture)
    mode: "dnd",           // paliers : "dnd" (officiels) ou "objectif" (mis à l'échelle)
    mois: 12,              // mois réels visés pour atteindre le niveau max
    parSemaine: 1,         // sessions par semaine
    plages: [
        { id: "p1", min: 1,  max: 4,  bonus: [] },
        { id: "p2", min: 5,  max: 10, bonus: [] },
        { id: "p3", min: 11, max: 16, bonus: [] },
        { id: "p4", min: 17, max: 20, bonus: [] }
    ]
};
const MOIS_MIN = 1, MOIS_MAX = 120, MOIS_CURSEUR_MAX = 120, MOIS_PAS = 0.5;
const SEMAINE_MIN = 0.25, SEMAINE_MAX = 7, SEMAINE_PAS = 0.25;
const XP_SESSION_MAX = 1000000;

// Clés de réglages dessinées par ce fichier dans la catégorie (le reste,
// xpProgEnabled, est une case à cocher classique).
export const XP_PROG_KEYS = new Set(["xpLevelCap", "xpPerSession", "xpThresholdMode", "xpMonthsToCap", "xpSessionsPerWeek", "xpGrowthOverrides", "xpBonusRanges"]);
const CLES_PALIERS = ["xpProgEnabled", "xpLevelCap", "xpPerSession", "xpThresholdMode", "xpMonthsToCap", "xpSessionsPerWeek", "xpGrowthOverrides", "xpBonusRanges"];

// ============================================================
// Réglages
// ============================================================
export function registerXpProgressSettings() {
    const monde = (type, def, extra = {}) => ({ scope: "world", config: false, type, default: def, requiresReload: false, ...extra });
    game.settings.register(MOD, "xpProgEnabled", monde(Boolean, false, {
        name: tl("Progression par l'XP de base"),
        hint: tl("Remplace les paliers d'XP de D&D par les paliers calculés ci-dessous (la fiche les utilise pour la montée de niveau) et propose l'XP par session, avec les bonus de plage, dans « Clore la session ». Sans effet quand le système d'étoiles est actif.")
    }));
    game.settings.register(MOD, "xpLevelCap",        monde(Number, DEFAUT.plafond,    { name: tl("Niveau max autorisé sur le serveur") }));
    game.settings.register(MOD, "xpPerSession",      monde(Number, DEFAUT.xpSession,  { name: tl("XP par session") }));
    game.settings.register(MOD, "xpThresholdMode",   monde(String, DEFAUT.mode,       { name: tl("Paliers de niveau (D&D ou objectif en mois)") }));
    game.settings.register(MOD, "xpMonthsToCap",     monde(Number, DEFAUT.mois,       { name: tl("Mois réels pour atteindre le niveau max") }));
    game.settings.register(MOD, "xpSessionsPerWeek", monde(Number, DEFAUT.parSemaine, { name: tl("Sessions par semaine") }));
    // Paliers sur lesquels l'XP des PJ est actuellement comptée (vide = D&D).
    // Mis à jour par « Recaler l'XP des PJ ».
    game.settings.register(MOD, "xpCalibration",     monde(Array,  [],                { name: tl("Paliers de référence de l'XP des PJ") }));
    game.settings.register(MOD, "xpGrowthOverrides", monde(Array,  [],                { name: tl("Hausse d'XP par niveau, en % (surcharges)") }));
    game.settings.register(MOD, "xpBonusRanges",     monde(Array,  DEFAUT.plages,     { name: tl("Plages de niveaux et bonus d'XP") }));
}

// ============================================================
// Calculs (fonctions pures : testables sans Foundry)
// ============================================================
const borne = (v, min, max) => Math.min(max, Math.max(min, v));
const entier = (v, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : def; };

export function normaliserPlafond(v) { return borne(entier(v, NIVEAU_MAX), 1, NIVEAU_MAX); }
const pas = (v, def, p, min, max) => {
    const n = Number(String(v ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return def;
    return borne(Math.round(n / p) * p, min, max);
};
export const normaliserMois = (v) => pas(v, DEFAUT.mois, MOIS_PAS, MOIS_MIN, MOIS_MAX);
export const normaliserParSemaine = (v) => pas(v, DEFAUT.parSemaine, SEMAINE_PAS, SEMAINE_MIN, SEMAINE_MAX);
export const normaliserXpSession = (v) => pas(v, DEFAUT.xpSession, 1, 1, XP_SESSION_MAX);
export const normaliserMode = (v) => (v === "objectif" ? "objectif" : "dnd");

// Sessions totales visées et sessions par niveau (calculées, jamais saisies).
export function sessionsVisees(r) { return normaliserMois(r.mois) * SEMAINES_PAR_MOIS * normaliserParSemaine(r.parSemaine); }
// Courbe des paliers (réglage xpGrowthOverrides), 19 entrées (niveau 1 → 19) :
//   - entrée 0 : XP pour monter du niveau 1 (« base » de la courbe, en XP ;
//     null = 300 comme D&D) ;
//   - entrées 1 → 18 : hausse de l'XP pour monter, en %, par rapport au
//     niveau précédent (null = hausse de D&D 5e).
// Le tableau des réglages édite indifféremment l'XP ou le % : l'un est
// recalculé à partir de l'autre.
export const BASE_MIN = 10, BASE_MAX = 1000000;
export function normaliserHausses(raw) {
    const src = Array.isArray(raw) ? raw : [];
    return Array.from({ length: NIVEAU_MAX - 1 }, (_, i) => {
        const v = src[i];
        if (v === null || v === undefined || v === "") return null;
        const n = Number(String(v).replace(",", "."));
        if (!Number.isFinite(n)) return null;
        if (i === 0) return Math.round(borne(n, BASE_MIN, BASE_MAX));
        return Math.round(borne(n, -90, 1000) * 100) / 100;
    });
}
export function normaliserPlages(raw) {
    const src = Array.isArray(raw) ? raw : DEFAUT.plages;
    return src.filter(p => p && typeof p === "object").map((p, i) => {
        let min = borne(entier(p.min, 1), 1, NIVEAU_MAX);
        let max = borne(entier(p.max, NIVEAU_MAX), 1, NIVEAU_MAX);
        if (max < min) [min, max] = [max, min];
        const bonus = (Array.isArray(p.bonus) ? p.bonus : [])
            .map((b, j) => ({
                id: String(b?.id || `b${i}-${j}`),
                label: String(b?.label ?? "").trim().slice(0, 80),
                montant: Math.max(0, entier(b?.montant, 0)),
                // Récurrence THÉORIQUE : « environ 1 fois toutes les N sessions »
                // (0 = non compté). Sert seulement aux calculs du module.
                tous: Math.max(0, Math.round((Number(String(b?.tous ?? 0).replace(",", ".")) || 0) * 10) / 10)
            }))
            .filter(b => b.label && b.montant > 0);
        return { id: String(p.id || `p${i}`), min, max, bonus };
    });
}

// Arrondi « lisible » : 10, 50 ou 100 selon l'ordre de grandeur (assez fin pour
// respecter les pourcentages choisis).
export function arrondiXp(x) {
    if (!(x > 0)) return 0;
    const pas = x < 1000 ? 10 : x < 10000 ? 50 : 100;
    return Math.max(pas, Math.round(x / pas) * pas);
}

// XP pour monter de chaque niveau dans D&D 5e, et hausse en % d'un niveau à l'autre.
export const ECARTS_DND = Array.from({ length: NIVEAU_MAX - 1 }, (_, i) => XP_SEUILS[i + 1] - XP_SEUILS[i]);
export const HAUSSES_DND = ECARTS_DND.map((e, i) => i === 0 ? null : (e / ECARTS_DND[i - 1] - 1) * 100);

// Forme de la courbe : on part des 300 XP du niveau 1 et on applique, niveau
// par niveau, la hausse choisie (ou celle de D&D).
export function forme(r) {
    const h = normaliserHausses(r.hausses);
    const out = [h[0] ?? ECARTS_DND[0]];
    for (let i = 1; i < NIVEAU_MAX - 1; i++) {
        const sansSurcharge = h[i] === null && out[i - 1] === ECARTS_DND[i - 1];
        out.push(sansSurcharge ? ECARTS_DND[i] : out[i - 1] * (1 + (h[i] ?? HAUSSES_DND[i]) / 100));
    }
    return out;
}

// XP moyenne gagnée par session pour un personnage du niveau L (1 → 19) :
// XP par session + bonus des plages de ce niveau, chacun divisé par sa
// récurrence théorique (« 1 fois toutes les N sessions »). Purement théorique.
export function xpMoyenneParNiveau(r) {
    const base = normaliserXpSession(r.xpSession);
    const plages = normaliserPlages(r.plages ?? []);
    return Array.from({ length: NIVEAU_MAX - 1 }, (_, i) => {
        const L = i + 1;
        let x = base;
        for (const p of plages) {
            if (L < p.min || L > p.max) continue;
            for (const b of p.bonus) if (b.tous > 0) x += b.montant / b.tous;
        }
        return x;
    });
}

// Facteur appliqué à la forme : 1 en mode « D&D » ; en mode « Objectif »,
// choisi pour que la somme des sessions jusqu'au niveau max (XP pour monter ÷
// XP moyenne par session) égale les sessions de la période visée.
export function facteurPaliers(r) {
    if (normaliserMode(r.mode) !== "objectif") return 1;
    const plafond = normaliserPlafond(r.plafond);
    if (plafond <= 1) return 1;
    const f = forme(r), moy = xpMoyenneParNiveau(r);
    let somme = 0;
    for (let i = 0; i < plafond - 1; i++) somme += f[i] / moy[i];
    return somme > 0 ? sessionsVisees(r) / somme : 1;
}
// XP pour monter de chaque niveau (1→2 … 19→20).
export function ecarts(r) {
    const k = facteurPaliers(r);
    return forme(r).map((x, i) => (k === 1 && x === ECARTS_DND[i]) ? x : arrondiXp(x * k));
}
// Paliers : index i = XP totale pour être niveau i+1 (même forme que dnd5e).
export function paliers(r) {
    const out = [0];
    for (const e of ecarts(r)) out.push(out.at(-1) + e);
    return out;
}

// Lignes du tableau + totaux. r = { plafond, xpSession, mode, mois, parSemaine, hausses, plages }.
export function calculerProgression(r) {
    const plafond = normaliserPlafond(r.plafond);
    const xpSession = normaliserXpSession(r.xpSession);
    const hausses = normaliserHausses(r.hausses);
    const moy = xpMoyenneParNiveau(r);
    const ec = ecarts(r);
    const seuils = paliers(r);
    const sessionsParMois = SEMAINES_PAR_MOIS * normaliserParSemaine(r.parSemaine);
    let cumul = 0;
    const lignes = [];
    for (let L = 1; L < NIVEAU_MAX; L++) {
        const i = L - 1;
        const aGagner = ec[i];
        const sessions = aGagner / moy[i];
        const bloque = L >= plafond;
        if (!bloque) cumul += sessions;
        lignes.push({
            niveau: L, seuil: seuils[i], aGagner,
            hausse: i === 0 ? null : (ec[i] / ec[i - 1] - 1) * 100,     // hausse réelle (après arrondi)
            hausseDnd: HAUSSES_DND[i], hausseSurcharge: hausses[i],
            xpMoyenne: moy[i], sessions, cumul: bloque ? null : cumul, cumulMois: bloque ? null : cumul / sessionsParMois, bloque
        });
    }
    return {
        plafond, lignes, xpSession, seuils, mode: normaliserMode(r.mode), facteur: facteurPaliers(r),
        totalSessions: cumul, totalMois: cumul / sessionsParMois,
        objectifMois: normaliserMois(r.mois), objectifSessions: sessionsVisees(r),
        avecBonus: moy.some(x => x > xpSession)
    };
}

// XP par défaut proposée à la clôture (0 au niveau max ou au-delà).
export function xpParDefaut(L, r) {
    L = borne(entier(L, 1), 1, NIVEAU_MAX);
    return L >= normaliserPlafond(r.plafond) ? 0 : normaliserXpSession(r.xpSession);
}

// XP maximale qu'un personnage peut détenir : le palier du niveau max,
// sans jamais retirer d'XP déjà acquise.
export function xpLimite(xpActuelle, plafond, seuils = XP_SEUILS) {
    return Math.max(seuils[normaliserPlafond(plafond) - 1], Number(xpActuelle) || 0);
}

// Recalage d'une XP comptée sur l'ancien barème vers les nouveaux paliers, en
// gardant le niveau et la progression dans le niveau. null = rien à changer.
export function xpRecalee(xp, niveau, nouveaux, anciens = XP_SEUILS) {
    const L = borne(entier(niveau, 1), 1, NIVEAU_MAX);
    xp = Number(xp) || 0;
    let v;
    if (L >= NIVEAU_MAX) v = nouveaux[L - 1];
    else {
        const aBas = anciens[L - 1], aHaut = anciens[L];
        const frac = aHaut > aBas ? borne((xp - aBas) / (aHaut - aBas), 0, 0.99) : 0;
        v = Math.round(nouveaux[L - 1] + frac * (nouveaux[L] - nouveaux[L - 1]));
    }
    return v === Math.round(xp) ? null : v;
}

// Plages contenant le niveau de référence (arrondi du niveau moyen).
export function plagesPour(niveau, plages) {
    const n = borne(entier(niveau, 1), 1, NIVEAU_MAX);
    return normaliserPlages(plages).filter(p => n >= p.min && n <= p.max);
}

export const nombreFr = (n, dec = 0) =>
    Number(n).toLocaleString(locale(), { minimumFractionDigits: 0, maximumFractionDigits: dec });

// ============================================================
// Lecture des réglages du monde
// ============================================================
const lire = (k, def) => { try { return game.settings.get(MOD, k); } catch { return def; } };

export function xpProgEnabled() { return lire("xpProgEnabled", false) === true; }
export function niveauMaxServeur() { return normaliserPlafond(lire("xpLevelCap", NIVEAU_MAX)); }
export function reglagesXp() {
    return {
        plafond:    niveauMaxServeur(),
        xpSession:  normaliserXpSession(lire("xpPerSession", DEFAUT.xpSession)),
        mode:       normaliserMode(lire("xpThresholdMode", DEFAUT.mode)),
        mois:       normaliserMois(lire("xpMonthsToCap", DEFAUT.mois)),
        parSemaine: normaliserParSemaine(lire("xpSessionsPerWeek", DEFAUT.parSemaine)),
        hausses:    normaliserHausses(lire("xpGrowthOverrides", [])),
        plages:     normaliserPlages(lire("xpBonusRanges", DEFAUT.plages))
    };
}
// Paliers en vigueur : calculés si la progression est active, sinon ceux de D&D.
export function seuilsActifs() { return xpProgEnabled() ? paliers(reglagesXp()) : XP_SEUILS; }

// ---- Paliers appliqués au système dnd5e ----
let _seuilsDnd = null;   // table d'origine du système, gardée pour la restaurer
export function appliquerPaliersDnd() {
    const cfg = globalThis.CONFIG?.DND5E;
    if (!cfg || !Array.isArray(cfg.CHARACTER_EXP_LEVELS)) return false;
    _seuilsDnd ??= [...cfg.CHARACTER_EXP_LEVELS];
    const cible = xpProgEnabled() ? paliers(reglagesXp()) : _seuilsDnd;
    if (JSON.stringify(cfg.CHARACTER_EXP_LEVELS) === JSON.stringify(cible)) return false;
    cfg.CHARACTER_EXP_LEVELS = [...cible];
    // Recalcule l'XP « max » des personnages et rafraîchit les fiches ouvertes.
    for (const a of game.actors ?? []) {
        if (a.type !== "character") continue;
        try { a.reset(); if (a.sheet?.rendered) a.sheet.render(); } catch {}
    }
    return true;
}

// Paliers sur lesquels l'XP des PJ est comptée aujourd'hui.
export function paliersDeReference() {
    const c = lire("xpCalibration", []);
    return Array.isArray(c) && c.length === NIVEAU_MAX ? c.map(Number) : XP_SEUILS;
}
const memesPaliers = (a, b) => a.length === b.length && a.every((x, i) => Number(x) === Number(b[i]));

// Aperçu du recalage : [{ actor, nom, niveau, avant, apres }] pour les PJ à modifier.
export function apercuRecalage() {
    const anciens = paliersDeReference(), nouveaux = seuilsActifs();
    const out = [];
    if (memesPaliers(anciens, nouveaux)) return { anciens, nouveaux, changements: out, identiques: true };
    for (const a of game.actors ?? []) {
        if (a.type !== "character" || !a.hasPlayerOwner) continue;
        const avant = Number(a.system?.details?.xp?.value) || 0;
        const niveau = Number(a.system?.details?.level) || 1;
        const v = xpRecalee(avant, niveau, nouveaux, anciens);
        if (v !== null) out.push({ actor: a, nom: a.name, niveau, avant, apres: v });
    }
    return { anciens, nouveaux, changements: out, identiques: false };
}

// Recale l'XP des PJ de joueurs sur les paliers en vigueur, puis retient ces
// paliers comme nouvelle référence (MJ).
export async function recalerXpDesPJ() {
    const { nouveaux, changements } = apercuRecalage();
    for (const c of changements) await c.actor.update({ "system.details.xp.value": c.apres });
    await game.settings.set(MOD, "xpCalibration", [...nouveaux]);
    return changements.length;
}

// Données pour « Clore la session » à partir des acteurs de la party.
export function propositionSession(actors) {
    const niveaux = (actors ?? []).map(a => Number(a?.system?.details?.level) || 1);
    if (!niveaux.length) return null;
    const moyenne = niveaux.reduce((a, b) => a + b, 0) / niveaux.length;
    const reference = borne(Math.round(moyenne), 1, NIVEAU_MAX);
    const r = reglagesXp();
    const bonus = plagesPour(reference, r.plages).flatMap(p =>
        p.bonus.map(b => ({ ...b, plage: `${p.min}–${p.max}` })));
    return { moyenne, reference, plafond: r.plafond, xp: xpParDefaut(reference, r), bonus };
}

// ============================================================
// Verrou du niveau max (s'applique à tous, MJ compris)
// ============================================================
const estPJ = (actor) => actor?.type === "character" && actor.hasPlayerOwner;

function avertirPlafond(plafond) {
    ui.notifications?.warn(tl("Niveau max du serveur : {0}. Montée de niveau impossible", plafond)
        + (game.user?.isGM ? tl(" (réglable dans Paramètres → Progression XP).") : "."));
}

export function XpProgressHooks() {
    // Paliers calculés appliqués au système dnd5e (tous les clients), puis
    // réappliqués à chaque changement de réglage concerné.
    Hooks.once("setup", () => appliquerPaliersDnd());
    Hooks.once("ready", () => appliquerPaliersDnd());
    Hooks.on("updateSetting", (st) => {
        if (CLES_PALIERS.some(k => st?.key === `${MOD}.${k}`)) appliquerPaliersDnd();
    });

    // XP : plafonnée au palier du niveau max (sans retirer d'XP déjà acquise).
    Hooks.on("preUpdateActor", (actor, changes) => {
        if (!estPJ(actor)) return;
        const plafond = niveauMaxServeur();
        if (plafond >= NIVEAU_MAX) return;
        const plat = "system.details.xp.value";
        const nouvelle = foundry.utils.getProperty(changes, plat) ?? changes?.[plat];
        if (nouvelle === undefined || nouvelle === null) return;
        const limite = xpLimite(actor.system?.details?.xp?.value, plafond, seuilsActifs());
        if (Number(nouvelle) <= limite) return;
        if (plat in changes) changes[plat] = limite;
        else foundry.utils.setProperty(changes, plat, limite);
    });

    // Niveau de classe : augmentation au-delà du niveau max refusée.
    Hooks.on("preUpdateItem", (item, changes) => {
        if (item.type !== "class" || !estPJ(item.parent)) return;
        const plafond = niveauMaxServeur();
        if (plafond >= NIVEAU_MAX) return;
        const nouveau = foundry.utils.getProperty(changes, "system.levels") ?? changes?.["system.levels"];
        if (nouveau === undefined) return;
        const avant = Number(item.system?.levels) || 0;
        if (Number(nouveau) <= avant) return;   // baisser un niveau reste possible
        const total = (Number(item.parent.system?.details?.level) || 0) - avant + Number(nouveau);
        if (total > plafond) { avertirPlafond(plafond); return false; }
    });

    // Nouvelle classe (multiclasse) qui ferait dépasser le niveau max.
    Hooks.on("preCreateItem", (item, data) => {
        if ((item.type ?? data?.type) !== "class" || !estPJ(item.parent)) return;
        const plafond = niveauMaxServeur();
        if (plafond >= NIVEAU_MAX) return;
        const ajout = Number(item.system?.levels ?? data?.system?.levels ?? 1) || 1;
        const total = (Number(item.parent.system?.details?.level) || 0) + ajout;
        if (total > plafond) { avertirPlafond(plafond); return false; }
    });
}

// ============================================================
// Interface des réglages
// ============================================================
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BLOC = "padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.06);";
const AIDE = "margin:3px 0 0;font-size:.8em;color:#999;";
const OR = "#c9a227";
const BTN_AJOUT = `border-radius:4px;cursor:pointer;border:1px solid rgba(201,162,39,0.4);background:rgba(201,162,39,0.12);color:${OR};`;
const BTN_SUPPR = "flex:0 0 auto;width:28px;border-radius:4px;cursor:pointer;border:1px solid rgba(192,57,43,0.4);background:rgba(192,57,43,0.12);color:#e58f8f;";

const optionsNiveaux = (sel) => Array.from({ length: NIVEAU_MAX }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${n === sel ? "selected" : ""}>${n}</option>`).join("");

// Renvoie le HTML d'une clé gérée ici, "" si elle est dessinée par une autre,
// ou null si la clé n'est pas à nous.
export function xpProgControlHtml(key) {
    if (!XP_PROG_KEYS.has(key)) return null;
    if (key === "xpMonthsToCap") return panneauProgressionHtml();
    if (key === "xpBonusRanges") return panneauPlagesHtml();
    return "";   // xpLevelCap, xpPerSession, xpSessionsPerWeek, xpGrowthOverrides : dans le panneau
}

function panneauProgressionHtml() {
    const r = reglagesXp();
    const calc = calculerProgression(r);
    const pct = (v) => v === null || v === undefined ? "" : String(Math.round(v * 100) / 100);
    const lignes = calc.lignes.map(l => `
        <tr class="scwm-xpp-ligne" data-niveau="${l.niveau}" style="${l.bloque ? "opacity:.4;" : ""}">
            <td style="white-space:nowrap;padding:2px 4px 2px 0;">${l.niveau} → ${l.niveau + 1}${l.bloque ? ' <i class="fa-solid fa-lock" title="Au-delà du niveau max"></i>' : ""}</td>
            <td class="scwm-xpp-palier" style="text-align:right;padding:2px 4px;" title="${tl("Palier de D&amp;D 5e : {0} XP", nombreFr(XP_SEUILS[l.niveau]))}">${nombreFr(calc.seuils[l.niveau])}</td>
            <td style="padding:1px 4px;"><input type="number" step="10" min="${BASE_MIN}" class="scwm-xpp-montee" data-i="${l.niveau - 1}" value="${l.aGagner}"
                title="${tl("XP pour monter au niveau suivant. Modifier ce nombre recalcule la hausse % de la ligne ; les niveaux suivants gardent leur XP.")}"
                style="width:100%;box-sizing:border-box;text-align:right;"></td>
            <td style="padding:1px 4px;">${l.niveau === 1 ? `<input type="hidden" class="scwm-xpp-hausse" name="xpGrowthOverrides__0" value="${pct(l.hausseSurcharge)}"><span style="display:block;text-align:center;opacity:.5;">—</span>` : `<input type="number" step="1" min="-90" max="1000" class="scwm-xpp-hausse"
                name="xpGrowthOverrides__${l.niveau - 1}" value="${pct(l.hausseSurcharge)}"
                placeholder="${pct(l.hausseDnd)}" title="${tl("Hausse de l'XP pour monter par rapport au niveau précédent. Vide = hausse de D&amp;D ({0} %).", nombreFr(l.hausseDnd, 1))}"
                style="width:100%;box-sizing:border-box;text-align:right;">`}</td>
            <td class="scwm-xpp-moy" style="text-align:right;padding:2px 4px;"></td>
            <td class="scwm-xpp-sessions" style="text-align:right;padding:2px 4px;"></td>
            <td class="scwm-xpp-cumul" style="text-align:right;padding:2px 0 2px 4px;color:#aaa;"></td>
        </tr>`).join("");
    const th = (t, align = "right", title = "") => `<th style="text-align:${align};font-size:.72em;color:#888;font-weight:600;padding:0 4px 3px;" ${title ? `title="${title}"` : ""}>${t}</th>`;

    return `
    <div class="scwm-set scwm-xpp" data-key="xpMonthsToCap" style="${BLOC}">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:600;margin:0;">
            <span>${tl("<i class=\"fa-solid fa-lock\"></i> Niveau max autorisé sur le serveur")}</span>
            <select name="xpLevelCap" class="scwm-xpp-plafond" style="width:90px;">${optionsNiveaux(r.plafond)}</select>
        </label>
        <p style="${AIDE}">${tl("Arrivé à ce niveau, un personnage ne peut plus monter (MJ compris) et son XP s'arrête au palier de ce niveau. Vaut aussi pour le système d'étoiles. 20 = pas de verrou.")}</p>
    </div>

    <div class="scwm-set" style="${BLOC}">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:600;margin:0;">
            <span>${tl("XP par session")}</span>
            <span><input type="number" name="xpPerSession" class="scwm-xpp-xp" min="1" step="1" value="${r.xpSession}" style="width:90px;text-align:right;"> XP</span>
        </label>
        <p style="${AIDE}">${tl("L'XP gagnée à chaque session. C'est l'XP proposée par défaut dans « Clore la session » (le MJ peut toujours la changer au moment de clore), et la base du calcul du rythme.")}</p>
    </div>

    <div class="scwm-set" style="${BLOC}">
        <label style="display:block;font-weight:600;margin:0 0 4px;">${tl("Paliers et rythme")}</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:2px 0;">
            <input type="radio" name="xpThresholdMode" class="scwm-xpp-mode" value="dnd" ${r.mode === "dnd" ? "checked" : ""}>
            <span>${tl("<strong>Paliers officiels de D&amp;D</strong>")} <span style="opacity:.7;font-size:.85em;">${tl("(par défaut) — le module montre le temps qu'il faut")}</span></span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:2px 0 6px;">
            <input type="radio" name="xpThresholdMode" class="scwm-xpp-mode" value="objectif" ${r.mode === "objectif" ? "checked" : ""}>
            <span>${tl("<strong>Paliers ajustés à un objectif en mois</strong>")} <span style="opacity:.7;font-size:.85em;">${tl("— même courbe que D&amp;D, mise à l'échelle")}</span></span>
        </label>
        <div class="scwm-xpp-ligne-mois" style="display:flex;align-items:center;gap:8px;">
            <span style="flex:0 0 190px;font-size:.85em;">${tl("Niveau max atteint en")}</span>
            <input type="range" class="scwm-xpp-mois" min="${MOIS_MIN}" max="${MOIS_CURSEUR_MAX}" step="${MOIS_PAS}" value="${Math.min(r.mois, MOIS_CURSEUR_MAX)}" style="flex:1 1 auto;">
            <input type="number" name="xpMonthsToCap" class="scwm-xpp-mois-n" min="${MOIS_MIN}" max="${MOIS_MAX}" step="${MOIS_PAS}" value="${r.mois}" style="width:64px;">
            <span style="font-size:.85em;">${tl("mois")}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <span style="flex:0 0 190px;font-size:.85em;">${tl("Sessions par semaine")}</span>
            <input type="range" class="scwm-xpp-semaine" min="${SEMAINE_MIN}" max="${SEMAINE_MAX}" step="${SEMAINE_PAS}" value="${r.parSemaine}" style="flex:1 1 auto;">
            <input type="number" name="xpSessionsPerWeek" class="scwm-xpp-semaine-n" min="${SEMAINE_MIN}" max="${SEMAINE_MAX}" step="${SEMAINE_PAS}" value="${r.parSemaine}" style="width:64px;">
            <span style="font-size:.85em;">${tl("/ sem.")}</span>
        </div>
        <div class="scwm-xpp-calcul" style="margin-top:6px;padding:5px 8px;border-left:3px solid ${OR};background:rgba(201,162,39,0.08);font-size:.88em;"></div>
        <p style="${AIDE}">${tl("Mois réels, pour un personnage qui joue à chaque session (0,5 par semaine = une toutes les deux semaines). Dans les deux cas, chaque niveau demande un nombre de sessions différent : peu au début, beaucoup à la fin, comme dans D&amp;D.")}</p>
    </div>

    <div class="scwm-set" style="${BLOC}">
        <label style="display:block;font-weight:600;margin:0 0 2px;">${tl("Paliers d'XP")}</label>
        <p style="margin:0 0 6px;font-size:.8em;color:#999;">${tl("Les paliers en vigueur sur la fiche quand la progression est activée : le bouton de montée de niveau s'active quand l'XP atteint le palier. « XP pour monter » et « Hausse % » sont liées : change l'un, l'autre se recalcule. Modifier l'XP d'un niveau ne change pas l'XP des niveaux suivants ; modifier un % décale les niveaux suivants (ils gardent leur %). En mode objectif, la durée totale est fixe : les autres niveaux s'ajustent pour la respecter. Dans la colonne %, le nombre grisé est la hausse de D&amp;D : vide la case pour y revenir. « XP moy. / sess. » ajoute à l'XP par session les bonus de la plage, selon leur récurrence théorique.")}</p>
        <table style="width:100%;border-collapse:collapse;font-size:.85em;">
            <thead><tr>${th(tl("Niveau"), "left")}${th(tl("Palier"), "right", tl("XP totale à atteindre pour passer au niveau suivant (survol : palier de D&D)"))}${th(tl("XP pour monter"))}${th(tl("Hausse %"), "right", tl("Hausse de l'XP pour monter par rapport au niveau précédent"))}${th("XP moy. / sess.", "right", tl("XP par session + bonus de la plage selon leur récurrence théorique"))}${th(tl("Sessions"))}${th(tl("Cumul (mois)"))}</tr></thead>
            <tbody>${lignes}</tbody>
        </table>
        <div class="scwm-xpp-total" style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(201,162,39,0.4);font-weight:700;color:${OR};"></div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:flex-start;">
            <button type="button" class="scwm-xpp-recaler" style="flex:0 0 auto;padding:3px 10px;${BTN_AJOUT}">${tl("<i class=\"fa-solid fa-scale-balanced\"></i> Recaler l'XP des PJ")}</button>
            <span style="font-size:.8em;color:#999;">${tl("Après un changement de paliers, l'XP des PJ est encore comptée sur les anciens. « Recaler » la convertit vers les paliers <strong>enregistrés</strong>, en gardant leur niveau et leur progression dans le niveau. Une liste des changements s'affiche avant de valider.")}</span>
        </div>
    </div>`;
}

function ligneBonusHtml(b = {}) {
    return `<div class="scwm-xpb-bonus" data-id="${esc(b.id || "")}" style="display:flex;gap:4px;margin:3px 0;">
        <input type="text" class="scwm-xpb-label" value="${esc(b.label || "")}" placeholder="${tl("Nom du bonus (ex. Boss vaincu)")}" style="flex:1 1 auto;min-width:0;">
        <span style="align-self:center;">+</span>
        <input type="number" class="scwm-xpb-montant" min="0" step="10" value="${b.montant || ""}" placeholder="0" style="width:80px;text-align:right;">
        <span style="align-self:center;font-size:.85em;">${tl("XP, ≈ 1 fois /")} </span>
        <input type="number" class="scwm-xpb-tous" min="0" step="0.5" value="${b.tous || ""}" placeholder="—" title="${tl("Récurrence théorique : environ une fois toutes les N sessions. Sert uniquement aux calculs de durée du module ; vide ou 0 = non compté.")}" style="width:56px;text-align:right;">
        <span style="align-self:center;font-size:.85em;">${tl("sess.")}</span>
        <button type="button" class="scwm-xpb-suppr-bonus" title="${tl("Retirer ce bonus")}" style="${BTN_SUPPR}"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function plageHtml(p = { min: 1, max: NIVEAU_MAX, bonus: [] }) {
    return `<div class="scwm-xpb-plage" data-id="${esc(p.id || "")}"
                 style="margin:6px 0;padding:6px 8px;border:1px solid rgba(201,162,39,0.3);border-radius:5px;background:rgba(0,0,0,0.12);">
        <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-weight:600;">${tl("Niveau moyen de")}</span>
            <select class="scwm-xpb-min" style="width:60px;">${optionsNiveaux(p.min)}</select>
            <span style="font-weight:600;">${tl("à")}</span>
            <select class="scwm-xpb-max" style="width:60px;">${optionsNiveaux(p.max)}</select>
            <span style="flex:1 1 auto;"></span>
            <button type="button" class="scwm-xpb-suppr-plage" title="${tl("Supprimer la plage")}" style="${BTN_SUPPR}"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="scwm-xpb-liste">${(p.bonus ?? []).map(ligneBonusHtml).join("")}</div>
        <button type="button" class="scwm-xpb-ajout-bonus" style="margin-top:2px;padding:2px 8px;font-size:.85em;${BTN_AJOUT}">
            ${tl("<i class=\"fa-solid fa-plus\"></i> Ajouter un bonus")}</button>
    </div>`;
}

function panneauPlagesHtml() {
    const plages = reglagesXp().plages;
    return `<div class="scwm-set scwm-xpb" data-key="xpBonusRanges" style="${BLOC}">
        <label style="display:block;font-weight:600;margin:0 0 2px;">${tl("Plages de niveaux et bonus d'XP")}</label>
        <p style="margin:0 0 4px;font-size:.8em;color:#999;">${tl("À la clôture de session, le niveau moyen de la party (arrondi) désigne la ou les plages concernées. Leurs bonus sont proposés en cases à cocher, non cochées : le MJ choisit ceux qui s'appliquent, et chacun s'ajoute à l'XP de tous les PJ. La récurrence (« ≈ 1 fois toutes les N sessions ») sert uniquement aux calculs de durée du tableau ; elle n'impose rien aux MJ.")}</p>
        <div class="scwm-xpb-plages">${plages.map(plageHtml).join("")}</div>
        <button type="button" class="scwm-xpb-ajout-plage" style="margin-top:4px;padding:3px 10px;${BTN_AJOUT}">
            ${tl("<i class=\"fa-solid fa-plus\"></i> Ajouter une plage")}</button>
    </div>`;
}

// Câblage : curseurs liés, tableau recalculé en direct, ajout/retrait de plages.
export function wireXpProg(root) {
    if (!root) return;
    const q = (s) => root.querySelector(s);

    const plafondSel = q(".scwm-xpp-plafond");
    if (plafondSel) {
        const mR = q(".scwm-xpp-mois"), mN = q(".scwm-xpp-mois-n");
        const sR = q(".scwm-xpp-semaine"), sN = q(".scwm-xpp-semaine-n");
        const xN = q(".scwm-xpp-xp");
        const modes = [...root.querySelectorAll(".scwm-xpp-mode")];
        const ligneMois = q(".scwm-xpp-ligne-mois");
        const mode = () => normaliserMode(modes.find(m => m.checked)?.value);
        const hausses = [...root.querySelectorAll(".scwm-xpp-hausse")];
        const lireHausses = () => {
            const out = Array(NIVEAU_MAX - 1).fill(null);
            hausses.forEach(i => { const k = Number(i.name.split("__")[1]); out[k] = i.value === "" ? null : i.value; });
            return out;
        };
        // Case « Progression par l'XP de base » de la même fenêtre (si présente).
        const xpProgEnabledForm = () => { const c = root.querySelector('[name="xpProgEnabled"]'); return c ? c.checked : null; };
        const lireForm = () => ({
            plafond: normaliserPlafond(plafondSel.value),
            xpSession: normaliserXpSession(xN.value),
            mode: mode(),
            mois: normaliserMois(mN.value),
            parSemaine: normaliserParSemaine(sN.value),
            hausses: lireHausses(),
            plages: q(".scwm-xpb") ? readXpProg("xpBonusRanges", root) : reglagesXp().plages
        });

        const redessiner = () => {
            const calc = calculerProgression(lireForm());
            for (const l of calc.lignes) {
                const tr = root.querySelector(`.scwm-xpp-ligne[data-niveau="${l.niveau}"]`);
                if (!tr) continue;
                tr.style.opacity = l.bloque ? ".4" : "";
                tr.querySelector(".scwm-xpp-palier").textContent = nombreFr(calc.seuils[l.niveau]);
                const xpIn = tr.querySelector(".scwm-xpp-montee");
                if (xpIn && xpIn !== document.activeElement) xpIn.value = String(l.aGagner);
                const inp = tr.querySelector('.scwm-xpp-hausse:not([type="hidden"])');
                if (inp && inp.value === "") inp.placeholder = String(Math.round(l.hausseDnd * 10) / 10);
                if (inp) inp.title = tl("Hausse réelle après arrondi : {0} %. Vide = hausse de D&D ({1} %).", nombreFr(l.hausse, 1), nombreFr(l.hausseDnd, 1));
                const moy = tr.querySelector(".scwm-xpp-moy");
                moy.textContent = nombreFr(l.xpMoyenne);
                moy.style.color = l.xpMoyenne > calc.xpSession ? OR : "";
                tr.querySelector(".scwm-xpp-sessions").textContent = l.sessions > 0 && l.sessions < 0.1 ? "< 0,1" : nombreFr(l.sessions, 1);
                tr.querySelector(".scwm-xpp-cumul").textContent = l.cumulMois === null ? "🔒" : nombreFr(l.cumulMois, 1);
            }
            if (ligneMois) { ligneMois.style.opacity = calc.mode === "objectif" ? "" : ".4"; ligneMois.querySelectorAll("input").forEach(i => i.disabled = calc.mode !== "objectif"); }
            const calcul = q(".scwm-xpp-calcul");
            if (calcul) calcul.innerHTML = calc.plafond <= 1
                ? tl("Niveau max = 1 : aucune montée de niveau possible.")
                : calc.mode === "objectif"
                    ? `${tl("Objectif {0} mois ≈ <strong>{1} sessions</strong> à {2} XP{3} → courbe × <strong>{4}</strong> (niveau {5} à {6} XP).", nombreFr(calc.objectifMois, 1), nombreFr(calc.objectifSessions, 1), nombreFr(calc.xpSession), calc.avecBonus ? " + bonus" : "", nombreFr(calc.facteur, 3), calc.plafond, nombreFr(calc.seuils[calc.plafond - 1]))}`
                    : `${tl("Paliers de D&amp;D{0} : à {1} XP par session{2}, il faut <strong>{3} sessions</strong>, soit <strong>≈ {4} mois</strong>, pour atteindre le niveau {5}.", hausses.some(i => i.value !== "") ? tl(" (hausses modifiées)") : "", nombreFr(calc.xpSession), calc.avecBonus ? " + bonus" : "", nombreFr(calc.totalSessions, 1), nombreFr(calc.totalMois, 1), calc.plafond)}`;
            const total = q(".scwm-xpp-total");
            if (total) total.textContent = calc.plafond <= 1 ? ""
                : tl("Niveau {0} atteint à {1} XP, en ≈ {2} mois ({3} sessions){4}.", calc.plafond, nombreFr(calc.seuils[calc.plafond - 1]), nombreFr(calc.totalMois, 1), nombreFr(calc.totalSessions, 1), calc.mode === "objectif" && Math.abs(calc.totalMois - calc.objectifMois) >= 0.5 ? ` — objectif : ${nombreFr(calc.objectifMois, 1)} mois` : "");
        };

        // Curseur ↔ champ numérique (le champ accepte au-delà du curseur).
        const lier = (curseur, champ, norme) => {
            curseur.addEventListener("input", () => { champ.value = String(norme(curseur.value)); redessiner(); });
            champ.addEventListener("input", () => { curseur.value = String(norme(champ.value)); redessiner(); });
            champ.addEventListener("change", () => { champ.value = String(norme(champ.value)); redessiner(); });
        };
        lier(mR, mN, normaliserMois);
        lier(sR, sN, normaliserParSemaine);
        xN.addEventListener("input", redessiner);
        modes.forEach(m => m.addEventListener("change", redessiner));
        xN.addEventListener("change", () => { xN.value = String(normaliserXpSession(xN.value)); redessiner(); });
        plafondSel.addEventListener("change", redessiner);
        q(".scwm-xpp-recaler")?.addEventListener("click", async (e) => {
            e.preventDefault();
            const ap = apercuRecalage();
            // Réglages affichés ≠ réglages enregistrés ?
            const affiches = (xpProgEnabledForm() ?? xpProgEnabled()) ? paliers(lireForm()) : XP_SEUILS;
            const nonEnregistre = !memesPaliers(affiches, ap.nouveaux);
            const alerte = nonEnregistre
                ? `<p style="color:#e0a96d;">${tl("<i class=\"fa-solid fa-triangle-exclamation\"></i> Les paliers affichés ne sont <strong>pas encore enregistrés</strong>. Le recalage utilise les paliers <strong>enregistrés</strong> : clique d'abord sur « Enregistrer », puis rouvre cette fenêtre.")}</p>` : "";
            const source = !xpProgEnabled() ? tl("paliers officiels de D&amp;D (progression désactivée)")
                : memesPaliers(ap.nouveaux, XP_SEUILS) ? tl("paliers officiels de D&amp;D") : tl("paliers de la progression (enregistrés)");
            if (ap.identiques || !ap.changements.length) {
                await foundry.applications.api.DialogV2.prompt({
                    window: { title: tl("Recaler l'XP des PJ") },
                    content: `${alerte}<p>${tl("Rien à recaler : {0}", ap.identiques
                        ? tl("l'XP des PJ est déjà comptée sur les {0}.", source)
                        : tl("tous les PJ sont déjà au bon endroit sur les paliers en vigueur."))}</p>`,
                    ok: { label: tl("Fermer") }
                });
                return;
            }
            const lignes = ap.changements.map(c => `<tr><td>${esc(c.nom)}</td><td style="text-align:center;">${c.niveau}</td><td style="text-align:right;">${nombreFr(c.avant)}</td><td style="text-align:center;">→</td><td style="text-align:right;"><strong>${nombreFr(c.apres)}</strong></td></tr>`).join("");
            const ok = await foundry.applications.api.DialogV2.confirm({
                window: { title: tl("Recaler l'XP des PJ") },
                position: { width: 460 },
                content: `${alerte}<p>${tl("L'XP des PJ passe des paliers de référence actuels aux {0}, en gardant leur niveau et leur progression dans le niveau :", source)}</p>
                    <div style="max-height:300px;overflow-y:auto;"><table style="width:100%;font-size:.9em;"><thead><tr><th style="text-align:left;">${tl("PJ")}</th><th>${tl("Niv.")}</th><th style="text-align:right;">${tl("Avant")}</th><th></th><th style="text-align:right;">${tl("Après")}</th></tr></thead><tbody>${lignes}</tbody></table></div>`
            });
            if (!ok) return;
            const n = await recalerXpDesPJ();
            ui.notifications?.info(tl("XP recalée pour {0} personnage(s).", n));
        });
        hausses.forEach(i => i.addEventListener("input", redessiner));

        // « XP pour monter » modifiée → hausse % recalculée : la ligne prend
        // l'XP tapée, la ligne suivante garde son XP (son % est ajusté).
        const champHausse = (i) => root.querySelector(`[name="xpGrowthOverrides__${i}"]`);
        const ecrireHausse = (i, v) => {
            const c = champHausse(i);
            if (!c) return;
            c.value = v === null ? "" : String(i === 0 ? Math.round(v) : Math.round(borne(v, -90, 1000) * 100) / 100);
        };
        root.querySelectorAll(".scwm-xpp-montee").forEach(xpIn => xpIn.addEventListener("change", () => {
            const i = Number(xpIn.dataset.i);
            const r = lireForm();
            const k = facteurPaliers(r) || 1;
            const f = forme(r);
            const tape = Number(String(xpIn.value).replace(",", "."));
            if (!(tape > 0)) { redessiner(); return; }
            // Valeur sur la courbe (avant mise à l'échelle). En mode objectif, la
            // durée totale est fixe : on résout pour que la ligne tombe sur la
            // valeur tapée APRÈS remise à l'échelle (les autres niveaux s'ajustent).
            let cible = tape / k;
            const plafond = normaliserPlafond(r.plafond);
            if (normaliserMode(r.mode) === "objectif" && i < plafond - 1) {
                const moy = xpMoyenneParNiveau(r);
                let autres = 0;
                for (let j = 0; j < plafond - 1; j++) if (j !== i) autres += f[j] / moy[j];
                const reste = sessionsVisees(r) - tape / moy[i];
                if (!(reste > 0) || !(autres > 0)) {
                    ui.notifications?.warn(tl("Impossible : {0} XP pour ce seul niveau dépasse la durée de l'objectif. Augmente le nombre de mois ou baisse cette valeur.", nombreFr(tape)));
                    redessiner();
                    return;
                }
                cible = tape * autres / reste;
            }
            cible = Math.max(BASE_MIN, cible);
            const suivante = f[i + 1];                     // XP du niveau suivant, à conserver
            if (i === 0) ecrireHausse(0, cible);
            else ecrireHausse(i, (cible / f[i - 1] - 1) * 100);
            if (suivante !== undefined) {
                // Recalcule la forme avec la nouvelle valeur pour viser exactement la suivante.
                const f2 = forme(lireForm());
                ecrireHausse(i + 1, (suivante / f2[i] - 1) * 100);
            }
            xpIn.value = String(tape);
            redessiner();
        }));
        // Bonus (nom, montant, récurrence, plages) : recalcul en direct aussi.
        const boxBonus = q(".scwm-xpb");
        if (boxBonus) {
            boxBonus.addEventListener("input", redessiner);
            boxBonus.addEventListener("change", redessiner);
            boxBonus.addEventListener("click", () => setTimeout(redessiner, 0));
        }
        redessiner();
    }

    const box = q(".scwm-xpb");
    if (box) {
        box.addEventListener("click", (e) => {
            const cible = e.target.closest?.("button");
            if (!cible || !box.contains(cible)) return;
            if (cible.classList.contains("scwm-xpb-ajout-plage")) {
                e.preventDefault();
                box.querySelector(".scwm-xpb-plages")?.insertAdjacentHTML("beforeend", plageHtml({ id: foundry.utils.randomID(), min: 1, max: NIVEAU_MAX, bonus: [] }));
            } else if (cible.classList.contains("scwm-xpb-ajout-bonus")) {
                e.preventDefault();
                const liste = cible.closest(".scwm-xpb-plage")?.querySelector(".scwm-xpb-liste");
                liste?.insertAdjacentHTML("beforeend", ligneBonusHtml({ id: foundry.utils.randomID() }));
                liste?.querySelector(".scwm-xpb-bonus:last-child .scwm-xpb-label")?.focus();
            } else if (cible.classList.contains("scwm-xpb-suppr-bonus")) {
                e.preventDefault();
                cible.closest(".scwm-xpb-bonus")?.remove();
            } else if (cible.classList.contains("scwm-xpb-suppr-plage")) {
                e.preventDefault();
                cible.closest(".scwm-xpb-plage")?.remove();
            }
        });
    }
}

// Valeur à enregistrer pour une clé gérée ici (undefined = rien à lire).
export function readXpProg(key, root) {
    if (!root) return undefined;
    const q = (s) => root.querySelector(s);
    switch (key) {
        case "xpLevelCap": {
            const el = q('[name="xpLevelCap"]');
            return el ? normaliserPlafond(el.value) : undefined;
        }
        case "xpPerSession": {
            const el = q('[name="xpPerSession"]');
            return el ? normaliserXpSession(el.value) : undefined;
        }
        case "xpThresholdMode": {
            const els = [...root.querySelectorAll('[name="xpThresholdMode"]')];
            return els.length ? normaliserMode(els.find(e => e.checked)?.value) : undefined;
        }
        case "xpMonthsToCap": {
            const el = q('[name="xpMonthsToCap"]');
            return el ? normaliserMois(el.value) : undefined;
        }
        case "xpSessionsPerWeek": {
            const el = q('[name="xpSessionsPerWeek"]');
            return el ? normaliserParSemaine(el.value) : undefined;
        }
        case "xpGrowthOverrides": {
            const els = [...root.querySelectorAll(".scwm-xpp-hausse")];
            if (!els.length) return undefined;
            const out = Array(NIVEAU_MAX - 1).fill(null);
            els.forEach(i => { const k = Number(i.name.split("__")[1]); out[k] = i.value === "" ? null : i.value; });
            return normaliserHausses(out);
        }
        case "xpBonusRanges": {
            const box = q(".scwm-xpb");
            if (!box) return undefined;
            return normaliserPlages([...box.querySelectorAll(".scwm-xpb-plage")].map(p => ({
                id: p.dataset.id || foundry.utils.randomID(),
                min: p.querySelector(".scwm-xpb-min")?.value,
                max: p.querySelector(".scwm-xpb-max")?.value,
                bonus: [...p.querySelectorAll(".scwm-xpb-bonus")].map(b => ({
                    id: b.dataset.id || foundry.utils.randomID(),
                    label: b.querySelector(".scwm-xpb-label")?.value,
                    montant: b.querySelector(".scwm-xpb-montant")?.value,
                    tous: b.querySelector(".scwm-xpb-tous")?.value
                }))
            })));
        }
    }
    return undefined;
}

// ============================================================
// Bloc « Clore la session »
// ============================================================
// pcs : [{ actorId, name, currentXp }] ; actors : acteurs correspondants.
export function blocClotureHtml(pcs, actors) {
    const prop = propositionSession(actors);
    if (!prop) return null;
    const plafond = prop.plafond;
    const auMax = new Set(actors.filter(a => (Number(a?.system?.details?.level) || 1) >= plafond).map(a => a.id));

    const lignes = pcs.map(pc => {
        const bloque = auMax.has(pc.actorId);
        return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
            <label style="flex:1;">${esc(pc.name)}
                <span style="opacity:0.6;font-size:0.85em;">${tl("(XP actuel : {0})", nombreFr(pc.currentXp))}</span>
                ${bloque ? `<span style="color:#e58f8f;font-size:.85em;"> ${tl("<i class=\"fa-solid fa-lock\"></i> niveau max")}</span>` : ""}
            </label>
            <input type="number" min="0" step="1" class="scwm-xp-pc" data-actor-id="${esc(pc.actorId)}"
                   ${bloque ? 'data-au-max="1"' : ""} value="${bloque ? 0 : prop.xp}" style="width:90px;">
        </div>`;
    }).join("");

    const bonus = prop.bonus.length ? `
        <div class="scwm-xp-bonus-box" style="margin:6px 0 8px;">
            <div style="font-weight:bold;margin-bottom:3px;">${tl("Bonus d'XP (plage {0}{1})", esc(prop.bonus[0].plage), new Set(prop.bonus.map(b => b.plage)).size > 1 ? "…" : "")}</div>
            ${prop.bonus.map(b => `
            <label style="display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer;">
                <input type="checkbox" class="scwm-xp-bonus" data-label="${esc(b.label)}" data-montant="${b.montant}">
                <span style="flex:1;">${esc(b.label)}</span>
                <span style="opacity:.8;">+${nombreFr(b.montant)} XP</span>
            </label>`).join("")}
        </div>` : "";

    return `
        <div class="scwm-xp-prog" data-moyenne="${prop.moyenne}" style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(201,162,39,0.35);border-radius:5px;font-size:.88em;">
            ${tl("Niveau moyen de la party : <strong>{0}</strong>\n            · XP par session : <strong>{1}</strong>{2}", nombreFr(prop.moyenne, 1), nombreFr(prop.xp), prop.reference >= plafond ? ` <span style="color:#e58f8f;">${tl("(niveau max {0} atteint)", plafond)}</span>` : "")}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <label style="flex:1;font-weight:bold;">${tl("XP pour tous")}</label>
            <input type="number" min="0" step="1" class="scwm-xp-all" value="${prop.xp}" style="width:90px;">
        </div>
        ${bonus}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--color-border-light-tertiary,#bbb);">
            <span style="flex:1;opacity:.8;">${tl("Total par PJ")}</span>
            <strong class="scwm-xp-total">${nombreFr(prop.xp)}</strong>
        </div>
        ${lignes}`;
}

// « XP pour tous » + bonus cochés → recopiés dans chaque PJ (sauf au niveau max).
export function wireBlocCloture(root) {
    const all = root?.querySelector(".scwm-xp-all");
    if (!all || !root.querySelector(".scwm-xp-prog")) return false;
    const maj = () => {
        const base = Math.max(0, Math.round(Number(all.value) || 0));
        const bonus = [...root.querySelectorAll(".scwm-xp-bonus:checked")].reduce((s, c) => s + (Number(c.dataset.montant) || 0), 0);
        const total = base + bonus;
        root.querySelectorAll(".scwm-xp-pc").forEach(i => { if (!i.dataset.auMax) i.value = String(total); });
        const t = root.querySelector(".scwm-xp-total");
        if (t) t.textContent = nombreFr(total);
    };
    all.addEventListener("input", maj);
    root.querySelectorAll(".scwm-xp-bonus").forEach(c => c.addEventListener("change", maj));
    return true;
}

// Détail pour le rapport : base, bonus cochés, niveau moyen.
export function lireDetailCloture(root) {
    const box = root?.querySelector(".scwm-xp-prog");
    if (!box) return null;
    return {
        moyenne: Number(box.dataset.moyenne) || 0,
        base: Math.max(0, Math.round(Number(root.querySelector(".scwm-xp-all")?.value) || 0)),
        bonus: [...root.querySelectorAll(".scwm-xp-bonus:checked")]
            .map(c => ({ label: c.dataset.label, montant: Number(c.dataset.montant) || 0 }))
    };
}

// Ligne de rapport Discord.
export function texteDetailRapport(d) {
    if (!d) return "";
    const parts = [`Base ${nombreFr(d.base)}`, ...(d.bonus ?? []).map(b => `${b.label} +${nombreFr(b.montant)}`)];
    const total = d.base + (d.bonus ?? []).reduce((s, b) => s + b.montant, 0);
    return tl("{0} = **{1} XP** par PJ (niveau moyen {2})", parts.join(" · "), nombreFr(total), nombreFr(d.moyenne, 1));
}
