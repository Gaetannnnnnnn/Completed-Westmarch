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
const MOIS_MIN = 1, MOIS_MAX = 120, MOIS_CURSEUR_MAX = 60, MOIS_PAS = 0.5;
const SEMAINE_MIN = 0.25, SEMAINE_MAX = 7, SEMAINE_PAS = 0.25;
const XP_SESSION_MAX = 1000000;

// Clés de réglages dessinées par ce fichier dans la catégorie (le reste,
// xpProgEnabled, est une case à cocher classique).
export const XP_PROG_KEYS = new Set(["xpLevelCap", "xpPerSession", "xpThresholdMode", "xpMonthsToCap", "xpSessionsPerWeek", "xpStepOverrides", "xpBonusRanges"]);
const CLES_PALIERS = ["xpProgEnabled", "xpLevelCap", "xpPerSession", "xpThresholdMode", "xpMonthsToCap", "xpSessionsPerWeek", "xpStepOverrides"];

// ============================================================
// Réglages
// ============================================================
export function registerXpProgressSettings() {
    const monde = (type, def, extra = {}) => ({ scope: "world", config: false, type, default: def, requiresReload: false, ...extra });
    game.settings.register(MOD, "xpProgEnabled", monde(Boolean, false, {
        name: "Progression par l'XP de base",
        hint: "Remplace les paliers d'XP de D&D par les paliers calculés ci-dessous (la fiche les utilise pour la montée de niveau) et propose l'XP par session, avec les bonus de plage, dans « Clore la session ». Sans effet quand le système d'étoiles est actif."
    }));
    game.settings.register(MOD, "xpLevelCap",        monde(Number, DEFAUT.plafond,    { name: "Niveau max autorisé sur le serveur" }));
    game.settings.register(MOD, "xpPerSession",      monde(Number, DEFAUT.xpSession,  { name: "XP par session" }));
    game.settings.register(MOD, "xpThresholdMode",   monde(String, DEFAUT.mode,       { name: "Paliers de niveau (D&D ou objectif en mois)" }));
    game.settings.register(MOD, "xpMonthsToCap",     monde(Number, DEFAUT.mois,       { name: "Mois réels pour atteindre le niveau max" }));
    game.settings.register(MOD, "xpSessionsPerWeek", monde(Number, DEFAUT.parSemaine, { name: "Sessions par semaine" }));
    game.settings.register(MOD, "xpStepOverrides",   monde(Array,  [],                { name: "XP pour monter, par niveau (surcharges)" }));
    game.settings.register(MOD, "xpBonusRanges",     monde(Array,  DEFAUT.plages,     { name: "Plages de niveaux et bonus d'XP" }));
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
// 19 entrées (niveau 1 → 19) ; 0 = automatique.
export function normaliserSurcharges(raw) {
    const src = Array.isArray(raw) ? raw : [];
    return Array.from({ length: NIVEAU_MAX - 1 }, (_, i) => Math.max(0, entier(src[i], 0)));
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
                montant: Math.max(0, entier(b?.montant, 0))
            }))
            .filter(b => b.label && b.montant > 0);
        return { id: String(p.id || `p${i}`), min, max, bonus };
    });
}

// Arrondi « lisible » : 10, 50, 100 ou 500 selon l'ordre de grandeur.
export function arrondiXp(x) {
    if (!(x > 0)) return 0;
    const pas = x < 200 ? 10 : x < 2000 ? 50 : x < 20000 ? 100 : 500;
    return Math.max(pas, Math.round(x / pas) * pas);
}

// Facteur appliqué aux paliers de D&D : 1 en mode « D&D » ; en mode
// « Objectif », XP totale visée (sessions × XP par session) ÷ palier D&D du
// niveau max.
export function facteurPaliers(r) {
    if (normaliserMode(r.mode) !== "objectif") return 1;
    const plafond = normaliserPlafond(r.plafond);
    if (plafond <= 1) return 1;
    return sessionsVisees(r) * normaliserXpSession(r.xpSession) / XP_SEUILS[plafond - 1];
}
// XP pour monter de chaque niveau (1→2 … 19→20), calculée (sans surcharge).
export function ecartsAuto(r) {
    const k = facteurPaliers(r);
    return Array.from({ length: NIVEAU_MAX - 1 }, (_, i) => {
        const ecart = XP_SEUILS[i + 1] - XP_SEUILS[i];
        return k === 1 ? ecart : arrondiXp(ecart * k);
    });
}
// XP pour monter de chaque niveau, surcharges comprises.
export function ecarts(r) {
    const auto = ecartsAuto(r);
    return normaliserSurcharges(r.surcharges).map((s, i) => s > 0 ? s : auto[i]);
}
// Paliers : index i = XP totale pour être niveau i+1 (même forme que dnd5e).
export function paliers(r) {
    const out = [0];
    for (const e of ecarts(r)) out.push(out.at(-1) + e);
    return out;
}

// Lignes du tableau + totaux. r = { plafond, xpSession, mois, parSemaine, surcharges }.
export function calculerProgression(r) {
    const plafond = normaliserPlafond(r.plafond);
    const xpSession = normaliserXpSession(r.xpSession);
    const surcharges = normaliserSurcharges(r.surcharges);
    const autos = ecartsAuto(r);
    const seuils = paliers(r);
    const sessionsParMois = SEMAINES_PAR_MOIS * normaliserParSemaine(r.parSemaine);
    let cumul = 0;
    const lignes = [];
    for (let L = 1; L < NIVEAU_MAX; L++) {
        const aGagner = seuils[L] - seuils[L - 1];
        const sessions = aGagner / xpSession;
        const bloque = L >= plafond;
        if (!bloque) cumul += sessions;
        lignes.push({ niveau: L, seuil: seuils[L - 1], aGagner, auto: autos[L - 1], surcharge: surcharges[L - 1], standard: XP_SEUILS[L] - XP_SEUILS[L - 1],
            sessions, cumul: bloque ? null : cumul, cumulMois: bloque ? null : cumul / sessionsParMois, bloque });
    }
    return {
        plafond, lignes, xpSession, seuils, mode: normaliserMode(r.mode), facteur: facteurPaliers(r),
        totalSessions: cumul, totalMois: cumul / sessionsParMois,
        objectifMois: normaliserMois(r.mois), objectifSessions: sessionsVisees(r)
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
    const bas = nouveaux[L - 1], haut = L < NIVEAU_MAX ? nouveaux[L] : Infinity;
    if (xp >= bas && xp < haut) return null;                      // déjà dans le bon palier
    if (L >= NIVEAU_MAX) return bas;
    const aBas = anciens[L - 1], aHaut = anciens[L];
    const frac = (xp >= aBas && xp < aHaut) ? (xp - aBas) / (aHaut - aBas) : 0;
    return Math.round(bas + Math.min(frac, 0.99) * (haut - bas));
}

// Plages contenant le niveau de référence (arrondi du niveau moyen).
export function plagesPour(niveau, plages) {
    const n = borne(entier(niveau, 1), 1, NIVEAU_MAX);
    return normaliserPlages(plages).filter(p => n >= p.min && n <= p.max);
}

export const nombreFr = (n, dec = 0) =>
    Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: dec });

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
        surcharges: normaliserSurcharges(lire("xpStepOverrides", [])),
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

// Recale l'XP des PJ de joueurs sur les paliers en vigueur (MJ).
export async function recalerXpDesPJ() {
    const nouveaux = seuilsActifs();
    let n = 0;
    for (const a of game.actors ?? []) {
        if (a.type !== "character" || !a.hasPlayerOwner) continue;
        const v = xpRecalee(a.system?.details?.xp?.value, a.system?.details?.level, nouveaux);
        if (v === null) continue;
        await a.update({ "system.details.xp.value": v });
        n++;
    }
    return n;
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
    ui.notifications?.warn(`Niveau max du serveur : ${plafond}. Montée de niveau impossible`
        + (game.user?.isGM ? " (réglable dans Paramètres → Progression XP)." : "."));
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
    return "";   // xpLevelCap, xpPerSession, xpSessionsPerWeek, xpStepOverrides : dans le panneau
}

function panneauProgressionHtml() {
    const r = reglagesXp();
    const calc = calculerProgression(r);
    const lignes = calc.lignes.map(l => `
        <tr class="scwm-xpp-ligne" data-niveau="${l.niveau}" style="${l.bloque ? "opacity:.4;" : ""}">
            <td style="white-space:nowrap;padding:2px 4px 2px 0;">${l.niveau} → ${l.niveau + 1}${l.bloque ? ' <i class="fa-solid fa-lock" title="Au-delà du niveau max"></i>' : ""}</td>
            <td class="scwm-xpp-palier" style="text-align:right;padding:2px 4px;">${nombreFr(calc.seuils[l.niveau])}</td>
            <td style="padding:1px 4px;"><input type="number" min="0" step="50" class="scwm-xpp-surcharge"
                name="xpStepOverrides__${l.niveau - 1}" value="${l.surcharge > 0 ? l.surcharge : ""}"
                placeholder="${l.auto}" title="Vide = calcul automatique (${nombreFr(l.auto)} XP)"
                style="width:100%;box-sizing:border-box;text-align:right;"></td>
            <td class="scwm-xpp-sessions" style="text-align:right;padding:2px 4px;"></td>
            <td class="scwm-xpp-cumul" style="text-align:right;padding:2px 4px;color:#aaa;"></td>
            <td style="text-align:right;padding:2px 0 2px 4px;color:#777;" title="Palier de D&D 5e pour comparaison">${nombreFr(XP_SEUILS[l.niveau])}</td>
        </tr>`).join("");
    const th = (t, align = "right", title = "") => `<th style="text-align:${align};font-size:.72em;color:#888;font-weight:600;padding:0 4px 3px;" ${title ? `title="${title}"` : ""}>${t}</th>`;

    return `
    <div class="scwm-set scwm-xpp" data-key="xpMonthsToCap" style="${BLOC}">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:600;margin:0;">
            <span><i class="fa-solid fa-lock"></i> Niveau max autorisé sur le serveur</span>
            <select name="xpLevelCap" class="scwm-xpp-plafond" style="width:90px;">${optionsNiveaux(r.plafond)}</select>
        </label>
        <p style="${AIDE}">Arrivé à ce niveau, un personnage ne peut plus monter (MJ compris) et son XP s'arrête au palier de ce niveau. Vaut aussi pour le système d'étoiles. 20 = pas de verrou.</p>
    </div>

    <div class="scwm-set" style="${BLOC}">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:600;margin:0;">
            <span>XP par session</span>
            <span><input type="number" name="xpPerSession" class="scwm-xpp-xp" min="1" step="1" value="${r.xpSession}" style="width:90px;text-align:right;"> XP</span>
        </label>
        <p style="${AIDE}">L'XP gagnée à chaque session. C'est l'XP proposée par défaut dans « Clore la session » (le MJ peut toujours la changer au moment de clore), et la base du calcul du rythme.</p>
    </div>

    <div class="scwm-set" style="${BLOC}">
        <label style="display:block;font-weight:600;margin:0 0 4px;">Paliers et rythme</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:2px 0;">
            <input type="radio" name="xpThresholdMode" class="scwm-xpp-mode" value="dnd" ${r.mode === "dnd" ? "checked" : ""}>
            <span><strong>Paliers officiels de D&amp;D</strong> <span style="opacity:.7;font-size:.85em;">(par défaut) — le module montre le temps qu'il faut</span></span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:2px 0 6px;">
            <input type="radio" name="xpThresholdMode" class="scwm-xpp-mode" value="objectif" ${r.mode === "objectif" ? "checked" : ""}>
            <span><strong>Paliers ajustés à un objectif en mois</strong> <span style="opacity:.7;font-size:.85em;">— même courbe que D&amp;D, mise à l'échelle</span></span>
        </label>
        <div class="scwm-xpp-ligne-mois" style="display:flex;align-items:center;gap:8px;">
            <span style="flex:0 0 190px;font-size:.85em;">Niveau max atteint en</span>
            <input type="range" class="scwm-xpp-mois" min="${MOIS_MIN}" max="${MOIS_CURSEUR_MAX}" step="${MOIS_PAS}" value="${Math.min(r.mois, MOIS_CURSEUR_MAX)}" style="flex:1 1 auto;">
            <input type="number" name="xpMonthsToCap" class="scwm-xpp-mois-n" min="${MOIS_MIN}" max="${MOIS_MAX}" step="${MOIS_PAS}" value="${r.mois}" style="width:64px;">
            <span style="font-size:.85em;">mois</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <span style="flex:0 0 190px;font-size:.85em;">Sessions par semaine</span>
            <input type="range" class="scwm-xpp-semaine" min="${SEMAINE_MIN}" max="${SEMAINE_MAX}" step="${SEMAINE_PAS}" value="${r.parSemaine}" style="flex:1 1 auto;">
            <input type="number" name="xpSessionsPerWeek" class="scwm-xpp-semaine-n" min="${SEMAINE_MIN}" max="${SEMAINE_MAX}" step="${SEMAINE_PAS}" value="${r.parSemaine}" style="width:64px;">
            <span style="font-size:.85em;">/ sem.</span>
        </div>
        <div class="scwm-xpp-calcul" style="margin-top:6px;padding:5px 8px;border-left:3px solid ${OR};background:rgba(201,162,39,0.08);font-size:.88em;"></div>
        <p style="${AIDE}">Mois réels, pour un personnage qui joue à chaque session (0,5 par semaine = une toutes les deux semaines). Dans les deux cas, chaque niveau demande un nombre de sessions différent : peu au début, beaucoup à la fin, comme dans D&amp;D.</p>
    </div>

    <div class="scwm-set" style="${BLOC}">
        <label style="display:block;font-weight:600;margin:0 0 2px;">Paliers d'XP</label>
        <p style="margin:0 0 6px;font-size:.8em;color:#999;">Les paliers en vigueur sur la fiche quand la progression est activée : le bouton de montée de niveau s'active quand l'XP atteint le palier. Le nombre grisé de « XP pour monter » est la valeur automatique (D&amp;D ou mise à l'échelle) : tape un nombre pour l'imposer à ce niveau, vide la case pour revenir à l'automatique.</p>
        <table style="width:100%;border-collapse:collapse;font-size:.85em;">
            <thead><tr>${th("Niveau", "left")}${th("Palier (XP totale)", "right", "XP totale à atteindre pour passer au niveau suivant")}${th("XP pour monter")}${th("Sessions")}${th("Cumul (mois)")}${th("D&amp;D", "right", "Palier de D&D 5e, pour comparaison")}</tr></thead>
            <tbody>${lignes}</tbody>
        </table>
        <div class="scwm-xpp-total" style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(201,162,39,0.4);font-weight:700;color:${OR};"></div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:flex-start;">
            <button type="button" class="scwm-xpp-recaler" style="flex:0 0 auto;padding:3px 10px;${BTN_AJOUT}"><i class="fa-solid fa-scale-balanced"></i> Recaler l'XP des PJ</button>
            <span style="font-size:.8em;color:#999;">Les PJ existants ont une XP comptée sur l'ancien barème. « Recaler » la ramène sur les paliers <strong>enregistrés</strong>, en gardant leur niveau et leur progression dans le niveau. Enregistre d'abord tes réglages.</span>
        </div>
    </div>`;
}

function ligneBonusHtml(b = {}) {
    return `<div class="scwm-xpb-bonus" data-id="${esc(b.id || "")}" style="display:flex;gap:4px;margin:3px 0;">
        <input type="text" class="scwm-xpb-label" value="${esc(b.label || "")}" placeholder="Nom du bonus (ex. Boss vaincu)" style="flex:1 1 auto;min-width:0;">
        <span style="align-self:center;">+</span>
        <input type="number" class="scwm-xpb-montant" min="0" step="10" value="${b.montant || ""}" placeholder="0" style="width:80px;text-align:right;">
        <span style="align-self:center;font-size:.85em;">XP</span>
        <button type="button" class="scwm-xpb-suppr-bonus" title="Retirer ce bonus" style="${BTN_SUPPR}"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function plageHtml(p = { min: 1, max: NIVEAU_MAX, bonus: [] }) {
    return `<div class="scwm-xpb-plage" data-id="${esc(p.id || "")}"
                 style="margin:6px 0;padding:6px 8px;border:1px solid rgba(201,162,39,0.3);border-radius:5px;background:rgba(0,0,0,0.12);">
        <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-weight:600;">Niveau moyen de</span>
            <select class="scwm-xpb-min" style="width:60px;">${optionsNiveaux(p.min)}</select>
            <span style="font-weight:600;">à</span>
            <select class="scwm-xpb-max" style="width:60px;">${optionsNiveaux(p.max)}</select>
            <span style="flex:1 1 auto;"></span>
            <button type="button" class="scwm-xpb-suppr-plage" title="Supprimer la plage" style="${BTN_SUPPR}"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="scwm-xpb-liste">${(p.bonus ?? []).map(ligneBonusHtml).join("")}</div>
        <button type="button" class="scwm-xpb-ajout-bonus" style="margin-top:2px;padding:2px 8px;font-size:.85em;${BTN_AJOUT}">
            <i class="fa-solid fa-plus"></i> Ajouter un bonus</button>
    </div>`;
}

function panneauPlagesHtml() {
    const plages = reglagesXp().plages;
    return `<div class="scwm-set scwm-xpb" data-key="xpBonusRanges" style="${BLOC}">
        <label style="display:block;font-weight:600;margin:0 0 2px;">Plages de niveaux et bonus d'XP</label>
        <p style="margin:0 0 4px;font-size:.8em;color:#999;">À la clôture de session, le niveau moyen de la party (arrondi) désigne la ou les plages concernées. Leurs bonus sont proposés en cases à cocher, non cochées : le MJ choisit ceux qui s'appliquent, et chacun s'ajoute à l'XP de tous les PJ.</p>
        <div class="scwm-xpb-plages">${plages.map(plageHtml).join("")}</div>
        <button type="button" class="scwm-xpb-ajout-plage" style="margin-top:4px;padding:3px 10px;${BTN_AJOUT}">
            <i class="fa-solid fa-plus"></i> Ajouter une plage</button>
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
        const surcharges = [...root.querySelectorAll(".scwm-xpp-surcharge")];

        const lireForm = () => ({
            plafond: normaliserPlafond(plafondSel.value),
            xpSession: normaliserXpSession(xN.value),
            mode: mode(),
            mois: normaliserMois(mN.value),
            parSemaine: normaliserParSemaine(sN.value),
            surcharges: surcharges.map(i => i.value === "" ? 0 : Math.max(0, Math.round(Number(i.value) || 0)))
        });

        const redessiner = () => {
            const calc = calculerProgression(lireForm());
            for (const l of calc.lignes) {
                const tr = root.querySelector(`.scwm-xpp-ligne[data-niveau="${l.niveau}"]`);
                if (!tr) continue;
                tr.style.opacity = l.bloque ? ".4" : "";
                const inp = tr.querySelector(".scwm-xpp-surcharge");
                if (inp) { inp.placeholder = String(l.auto); inp.title = `Vide = calcul automatique (${nombreFr(l.auto)} XP)`; }
                tr.querySelector(".scwm-xpp-palier").textContent = nombreFr(calc.seuils[l.niveau]);
                tr.querySelector(".scwm-xpp-sessions").textContent = l.sessions > 0 && l.sessions < 0.1 ? "< 0,1" : nombreFr(l.sessions, 1);
                tr.querySelector(".scwm-xpp-cumul").textContent = l.cumulMois === null ? "🔒" : nombreFr(l.cumulMois, 1);
            }
            if (ligneMois) { ligneMois.style.opacity = calc.mode === "objectif" ? "" : ".4"; ligneMois.querySelectorAll("input").forEach(i => i.disabled = calc.mode !== "objectif"); }
            const calcul = q(".scwm-xpp-calcul");
            if (calcul) calcul.innerHTML = calc.plafond <= 1
                ? "Niveau max = 1 : aucune montée de niveau possible."
                : calc.mode === "objectif"
                    ? `Objectif ${nombreFr(calc.objectifMois, 1)} mois ≈ <strong>${nombreFr(calc.objectifSessions, 1)} sessions</strong> à ${nombreFr(calc.xpSession)} XP → paliers de D&amp;D × <strong>${nombreFr(calc.facteur, 3)}</strong> (niveau ${calc.plafond} à ${nombreFr(calc.seuils[calc.plafond - 1])} XP au lieu de ${nombreFr(XP_SEUILS[calc.plafond - 1])}).`
                    : `Paliers officiels de D&amp;D : à ${nombreFr(calc.xpSession)} XP par session, il faut <strong>${nombreFr(calc.totalSessions, 1)} sessions</strong>, soit <strong>≈ ${nombreFr(calc.totalMois, 1)} mois</strong>, pour atteindre le niveau ${calc.plafond}.`;
            const total = q(".scwm-xpp-total");
            if (total) total.textContent = calc.plafond <= 1 ? ""
                : `Niveau ${calc.plafond} atteint à ${nombreFr(calc.seuils[calc.plafond - 1])} XP, en ≈ ${nombreFr(calc.totalMois, 1)} mois (${nombreFr(calc.totalSessions, 1)} sessions)${calc.mode === "objectif" && Math.abs(calc.totalMois - calc.objectifMois) >= 0.5 ? ` — objectif : ${nombreFr(calc.objectifMois, 1)} mois` : ""}.`;
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
            const ok = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Recaler l'XP des PJ" },
                content: `<p>Ramène l'XP de tous les personnages de joueurs sur les paliers <strong>enregistrés</strong>${xpProgEnabled() ? "" : " (progression désactivée : paliers de D&amp;D)"}, en gardant leur niveau et leur progression dans le niveau.</p><p>Les PJ déjà dans le bon palier ne sont pas touchés.</p>`
            });
            if (!ok) return;
            const n = await recalerXpDesPJ();
            ui.notifications?.info(`XP recalée pour ${n} personnage(s).`);
        });
        surcharges.forEach(i => i.addEventListener("input", redessiner));
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
        case "xpStepOverrides": {
            if (!q(".scwm-xpp-surcharge")) return undefined;
            return Array.from({ length: NIVEAU_MAX - 1 }, (_, i) => {
                const el = q(`[name="xpStepOverrides__${i}"]`);
                return el && el.value !== "" ? Math.max(0, Math.round(Number(el.value) || 0)) : 0;
            });
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
                    montant: b.querySelector(".scwm-xpb-montant")?.value
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
                <span style="opacity:0.6;font-size:0.85em;">(XP actuel : ${nombreFr(pc.currentXp)})</span>
                ${bloque ? `<span style="color:#e58f8f;font-size:.85em;"> <i class="fa-solid fa-lock"></i> niveau max</span>` : ""}
            </label>
            <input type="number" min="0" step="1" class="scwm-xp-pc" data-actor-id="${esc(pc.actorId)}"
                   ${bloque ? 'data-au-max="1"' : ""} value="${bloque ? 0 : prop.xp}" style="width:90px;">
        </div>`;
    }).join("");

    const bonus = prop.bonus.length ? `
        <div class="scwm-xp-bonus-box" style="margin:6px 0 8px;">
            <div style="font-weight:bold;margin-bottom:3px;">Bonus d'XP (plage ${esc(prop.bonus[0].plage)}${new Set(prop.bonus.map(b => b.plage)).size > 1 ? "…" : ""})</div>
            ${prop.bonus.map(b => `
            <label style="display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer;">
                <input type="checkbox" class="scwm-xp-bonus" data-label="${esc(b.label)}" data-montant="${b.montant}">
                <span style="flex:1;">${esc(b.label)}</span>
                <span style="opacity:.8;">+${nombreFr(b.montant)} XP</span>
            </label>`).join("")}
        </div>` : "";

    return `
        <div class="scwm-xp-prog" data-moyenne="${prop.moyenne}" style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(201,162,39,0.35);border-radius:5px;font-size:.88em;">
            Niveau moyen de la party : <strong>${nombreFr(prop.moyenne, 1)}</strong>
            · XP par session : <strong>${nombreFr(prop.xp)}</strong>${prop.reference >= plafond ? ` <span style="color:#e58f8f;">(niveau max ${plafond} atteint)</span>` : ""}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <label style="flex:1;font-weight:bold;">XP pour tous</label>
            <input type="number" min="0" step="1" class="scwm-xp-all" value="${prop.xp}" style="width:90px;">
        </div>
        ${bonus}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--color-border-light-tertiary,#bbb);">
            <span style="flex:1;opacity:.8;">Total par PJ</span>
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
    return `${parts.join(" · ")} = **${nombreFr(total)} XP** par PJ (niveau moyen ${nombreFr(d.moyenne, 1)})`;
}
