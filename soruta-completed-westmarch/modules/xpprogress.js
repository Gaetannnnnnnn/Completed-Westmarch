// ============================================================
// xpprogress.js — Progression par l'XP de base de D&D 5e
//
// Complète le système d'XP natif (quand le système d'étoiles est éteint) :
//   - un TABLEAU dynamique dans les réglages (niveau → palier, XP à gagner,
//     XP proposée par session, sessions et cumul), recalculé en direct ;
//   - des RÉGLAGES : objectif en MOIS réels pour atteindre le niveau max et
//     nombre de SESSIONS PAR SEMAINE ; le module en déduit le nombre de
//     sessions par niveau et l'XP par session de chaque niveau ;
//   - une XP PAR DÉFAUT éditable niveau par niveau, proposée dans « Clore la
//     session » selon le niveau moyen de la party ;
//   - des PLAGES de niveaux, chacune avec ses BONUS d'XP (nom + montant),
//     proposés (non cochés) dans « Clore la session » ;
//   - un NIVEAU MAX autorisé sur le serveur : au-delà, toute montée de niveau
//     est bloquée (MJ compris) et l'XP est plafonnée au palier de ce niveau.
//     Ce verrou s'applique aussi au système d'étoiles.
//
// Calcul : sessions totales = mois × (52 / 12) × sessions par semaine ;
// sessions par niveau = sessions totales ÷ (niveau max − 1) ;
// XP par session au niveau L = (palier L+1 − palier L) ÷ sessions par niveau.
// Pourquoi une XP « adaptée au niveau » : les paliers de D&D 5e ne sont pas
// réguliers (300 XP pour le niveau 2, 50 000 pour le 20). Une XP fixe ferait
// monter très vite au début et très lentement à la fin ; ici chaque niveau
// prend à peu près le même nombre de sessions.
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

// Clés de réglages dessinées par ce fichier dans la catégorie (le reste,
// xpProgEnabled, est une case à cocher classique).
export const XP_PROG_KEYS = new Set(["xpLevelCap", "xpMonthsToCap", "xpSessionsPerWeek", "xpDefaultOverrides", "xpBonusRanges"]);

// ============================================================
// Réglages
// ============================================================
export function registerXpProgressSettings() {
    const monde = (type, def, extra = {}) => ({ scope: "world", config: false, type, default: def, requiresReload: false, ...extra });
    game.settings.register(MOD, "xpProgEnabled", monde(Boolean, false, {
        name: "Progression par l'XP de base",
        hint: "Active le tableau ci-dessous dans « Clore la session » : XP proposée selon le niveau moyen de la party, et bonus de plage à cocher. Sans effet quand le système d'étoiles est actif."
    }));
    game.settings.register(MOD, "xpLevelCap",         monde(Number, DEFAUT.plafond, { name: "Niveau max autorisé sur le serveur" }));
    game.settings.register(MOD, "xpMonthsToCap",      monde(Number, DEFAUT.mois,       { name: "Mois réels pour atteindre le niveau max" }));
    game.settings.register(MOD, "xpSessionsPerWeek",  monde(Number, DEFAUT.parSemaine, { name: "Sessions par semaine" }));
    game.settings.register(MOD, "xpDefaultOverrides", monde(Array,  [],             { name: "XP par défaut, par niveau" }));
    game.settings.register(MOD, "xpBonusRanges",      monde(Array,  DEFAUT.plages,  { name: "Plages de niveaux et bonus d'XP" }));
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

// Sessions totales visées et sessions par niveau (calculées, jamais saisies).
export function sessionsVisees(r) { return normaliserMois(r.mois) * SEMAINES_PAR_MOIS * normaliserParSemaine(r.parSemaine); }
export function sessionsParNiveau(r) {
    const niveaux = normaliserPlafond(r.plafond) - 1;
    return niveaux > 0 ? sessionsVisees(r) / niveaux : 0;
}
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

// XP à gagner pour passer du niveau L au niveau L+1.
export function ecartNiveau(L) {
    if (L < 1 || L >= NIVEAU_MAX) return 0;
    return XP_SEUILS[L] - XP_SEUILS[L - 1];
}

// Arrondi « lisible » : 10, 50, 100 ou 500 selon l'ordre de grandeur.
export function arrondiXp(x) {
    if (!(x > 0)) return 0;
    const pas = x < 200 ? 10 : x < 2000 ? 50 : x < 20000 ? 100 : 500;
    return Math.max(pas, Math.round(x / pas) * pas);
}

// XP par session calculée pour un personnage de niveau L.
export function xpAuto(L, r) {
    const spl = sessionsParNiveau(r);
    return spl > 0 ? arrondiXp(ecartNiveau(L) / spl) : 0;
}

// Lignes du tableau + totaux. r = { plafond, mois, parSemaine, surcharges }.
export function calculerProgression(r) {
    const plafond = normaliserPlafond(r.plafond);
    const surcharges = normaliserSurcharges(r.surcharges);
    const sessionsParMois = SEMAINES_PAR_MOIS * normaliserParSemaine(r.parSemaine);
    let cumul = 0;
    const lignes = [];
    for (let L = 1; L < NIVEAU_MAX; L++) {
        const aGagner = ecartNiveau(L);
        const auto = xpAuto(L, r);
        const xpSession = surcharges[L - 1] > 0 ? surcharges[L - 1] : auto;
        const sessions = xpSession > 0 ? aGagner / xpSession : Infinity;
        const bloque = L >= plafond;
        if (!bloque) cumul += sessions;
        lignes.push({ niveau: L, seuil: XP_SEUILS[L - 1], aGagner, auto, surcharge: surcharges[L - 1],
            xpSession, sessions, cumul: bloque ? null : cumul, cumulMois: bloque ? null : cumul / sessionsParMois, bloque });
    }
    return {
        plafond, lignes,
        totalSessions: cumul, totalMois: cumul / sessionsParMois,
        objectifMois: normaliserMois(r.mois), objectifSessions: sessionsVisees(r), sessionsParNiveau: sessionsParNiveau(r)
    };
}

// XP par défaut proposée pour un niveau (0 au niveau max ou au-delà).
export function xpParDefaut(L, r) {
    const plafond = normaliserPlafond(r.plafond);
    L = borne(entier(L, 1), 1, NIVEAU_MAX);
    if (L >= plafond) return 0;
    const s = normaliserSurcharges(r.surcharges)[L - 1];
    return s > 0 ? s : xpAuto(L, r);
}

// XP maximale qu'un personnage peut détenir : le palier du niveau max,
// sans jamais retirer d'XP déjà acquise.
export function xpLimite(xpActuelle, plafond) {
    return Math.max(XP_SEUILS[normaliserPlafond(plafond) - 1], Number(xpActuelle) || 0);
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
        mois:       normaliserMois(lire("xpMonthsToCap", DEFAUT.mois)),
        parSemaine: normaliserParSemaine(lire("xpSessionsPerWeek", DEFAUT.parSemaine)),
        surcharges: normaliserSurcharges(lire("xpDefaultOverrides", [])),
        plages:     normaliserPlages(lire("xpBonusRanges", DEFAUT.plages))
    };
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
    // XP : plafonnée au palier du niveau max (sans retirer d'XP déjà acquise).
    Hooks.on("preUpdateActor", (actor, changes) => {
        if (!estPJ(actor)) return;
        const plafond = niveauMaxServeur();
        if (plafond >= NIVEAU_MAX) return;
        const plat = "system.details.xp.value";
        const nouvelle = foundry.utils.getProperty(changes, plat) ?? changes?.[plat];
        if (nouvelle === undefined || nouvelle === null) return;
        const limite = xpLimite(actor.system?.details?.xp?.value, plafond);
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
    return "";   // xpLevelCap, xpSessionsPerWeek, xpDefaultOverrides : dans le panneau
}

function panneauProgressionHtml() {
    const r = reglagesXp();
    const calc = calculerProgression(r);
    const lignes = calc.lignes.map(l => `
        <tr class="scwm-xpp-ligne" data-niveau="${l.niveau}" style="${l.bloque ? "opacity:.4;" : ""}">
            <td style="white-space:nowrap;padding:2px 4px 2px 0;">${l.niveau} → ${l.niveau + 1}${l.bloque ? ' <i class="fa-solid fa-lock" title="Au-delà du niveau max"></i>' : ""}</td>
            <td style="text-align:right;padding:2px 4px;">${nombreFr(l.seuil)}</td>
            <td style="text-align:right;padding:2px 4px;">${nombreFr(l.aGagner)}</td>
            <td style="padding:1px 4px;"><input type="number" min="0" step="10" class="scwm-xpp-surcharge"
                name="xpDefaultOverrides__${l.niveau - 1}" value="${l.surcharge > 0 ? l.surcharge : ""}"
                placeholder="${l.auto}" title="Vide = calcul automatique (${nombreFr(l.auto)} XP)"
                style="width:100%;box-sizing:border-box;text-align:right;"></td>
            <td class="scwm-xpp-sessions" style="text-align:right;padding:2px 4px;"></td>
            <td class="scwm-xpp-cumul" style="text-align:right;padding:2px 0 2px 4px;color:#aaa;"></td>
        </tr>`).join("");
    const th = (t, align = "right") => `<th style="text-align:${align};font-size:.72em;color:#888;font-weight:600;padding:0 4px 3px;">${t}</th>`;

    return `
    <div class="scwm-set scwm-xpp" data-key="xpMonthsToCap" style="${BLOC}">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:600;margin:0;">
            <span><i class="fa-solid fa-lock"></i> Niveau max autorisé sur le serveur</span>
            <select name="xpLevelCap" class="scwm-xpp-plafond" style="width:80px;">${optionsNiveaux(r.plafond)}</select>
        </label>
        <p style="${AIDE}">Arrivé à ce niveau, un personnage ne peut plus monter (MJ compris) et son XP s'arrête au palier de ce niveau. Vaut aussi pour le système d'étoiles. 20 = pas de verrou.</p>
    </div>

    <div class="scwm-set" style="${BLOC}">
        <label style="display:block;font-weight:600;margin:0 0 4px;">Rythme de progression</label>
        <div style="display:flex;align-items:center;gap:8px;">
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
        <p style="${AIDE}">Mois réels, pour un personnage qui joue à chaque session. 0,5 session par semaine = une toutes les deux semaines. Le nombre de sessions par niveau est calculé : sessions sur la période ÷ niveaux à gagner. L'XP par session de chaque niveau = XP à gagner pour ce niveau ÷ sessions par niveau.</p>
    </div>

    <div class="scwm-set" style="${BLOC}">
        <label style="display:block;font-weight:600;margin:0 0 2px;">XP par défaut proposée à la clôture de session</label>
        <p style="margin:0 0 6px;font-size:.8em;color:#999;">« Clore la session » propose l'XP de la ligne qui correspond au niveau moyen de la party. Le nombre grisé est le calcul automatique : tape un nombre pour l'imposer, vide la case pour revenir à l'automatique. Les colonnes Sessions et Mois montrent le résultat réel.</p>
        <table style="width:100%;border-collapse:collapse;font-size:.85em;">
            <thead><tr>${th("Niveau", "left")}${th("Palier")}${th("À gagner")}${th("XP / session")}${th("Sessions")}${th("Cumul (mois)")}</tr></thead>
            <tbody>${lignes}</tbody>
        </table>
        <div class="scwm-xpp-total" style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(201,162,39,0.4);font-weight:700;color:${OR};"></div>
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
        const surcharges = [...root.querySelectorAll(".scwm-xpp-surcharge")];

        const lireForm = () => ({
            plafond: normaliserPlafond(plafondSel.value),
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
                tr.querySelector(".scwm-xpp-sessions").textContent = Number.isFinite(l.sessions) ? nombreFr(l.sessions, 1) : "—";
                tr.querySelector(".scwm-xpp-cumul").textContent = l.cumulMois === null ? "🔒" : nombreFr(l.cumulMois, 1);
            }
            const calcul = q(".scwm-xpp-calcul");
            if (calcul) calcul.innerHTML = calc.plafond <= 1
                ? "Niveau max = 1 : aucune montée de niveau possible."
                : `≈ <strong>${nombreFr(calc.objectifSessions, 1)}</strong> sessions en ${nombreFr(calc.objectifMois, 1)} mois, soit <strong>${nombreFr(calc.sessionsParNiveau, 1)} sessions par niveau</strong> (calculé).`;
            const total = q(".scwm-xpp-total");
            if (total) total.textContent = calc.plafond <= 1 ? ""
                : `Niveau ${calc.plafond} atteint en ≈ ${nombreFr(calc.totalMois, 1)} mois (${nombreFr(calc.totalSessions, 1)} sessions)${Math.abs(calc.totalMois - calc.objectifMois) >= 0.5 ? ` — objectif : ${nombreFr(calc.objectifMois, 1)} mois` : ""}.`;
        };

        // Curseur ↔ champ numérique (le champ accepte au-delà du curseur).
        const lier = (curseur, champ, norme) => {
            curseur.addEventListener("input", () => { champ.value = String(norme(curseur.value)); redessiner(); });
            champ.addEventListener("input", () => { curseur.value = String(norme(champ.value)); redessiner(); });
            champ.addEventListener("change", () => { champ.value = String(norme(champ.value)); redessiner(); });
        };
        lier(mR, mN, normaliserMois);
        lier(sR, sN, normaliserParSemaine);
        plafondSel.addEventListener("change", redessiner);
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
        case "xpMonthsToCap": {
            const el = q('[name="xpMonthsToCap"]');
            return el ? normaliserMois(el.value) : undefined;
        }
        case "xpSessionsPerWeek": {
            const el = q('[name="xpSessionsPerWeek"]');
            return el ? normaliserParSemaine(el.value) : undefined;
        }
        case "xpDefaultOverrides": {
            if (!q(".scwm-xpp-surcharge")) return undefined;
            return Array.from({ length: NIVEAU_MAX - 1 }, (_, i) => {
                const el = q(`[name="xpDefaultOverrides__${i}"]`);
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
            Niveau moyen de la party : <strong>${nombreFr(prop.moyenne, 1)}</strong> (ligne ${prop.reference} du tableau)
            · XP proposée : <strong>${nombreFr(prop.xp)}</strong>${prop.reference >= plafond ? ` <span style="color:#e58f8f;">(niveau max ${plafond} atteint)</span>` : ""}
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
