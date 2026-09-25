// ============================================================
// starxp.js — Système d'XP par étoiles (WestMarch)
//
// Remplace l'XP chiffrée par un compteur d'étoiles. À la clôture de
// session, le MJ attribue 1 à 3 étoiles selon la difficulté (dans la
// même fenêtre « Clore la session » qui servait à l'XP). Chaque niveau
// a un coût en étoiles, réglé dans un tableau (Paramètres → Système
// d'étoiles) qui affiche le TOTAL (= nombre de sessions).
//
// - Report des étoiles excédentaires au niveau suivant.
// - Au seuil atteint : le PJ est marqué « prêt à monter » et passe par
//   la validation MJ existante (flag pendingLevelUp + whisper MJ).
// - Sur la fiche PJ, le champ d'XP est remplacé par un compteur
//   d'étoiles jusqu'au prochain niveau.
// - Toute la fonctionnalité est désactivable en un clic (enableStarXp).
//
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const MAX_LEVEL   = 20;
const DEFAULT_STARS = 3;   // coût par défaut d'un niveau (éditable)

// ── État global : la fonctionnalité est-elle active ? ──
export function starXpEnabled() {
    try { return game.settings.get(MOD, "enableStarXp") === true; }
    catch { return false; }
}

// ── Table niveau → étoiles ──────────────────────────────────
// Renvoie un tableau de 19 nombres : index i = étoiles pour passer du
// niveau (i+1) au niveau (i+2). Toujours normalisé à 19 entrées.
export function starLevelTable() {
    let raw = [];
    try { raw = game.settings.get(MOD, "starXpLevels"); } catch {}
    if (!Array.isArray(raw)) raw = [];
    const out = [];
    for (let i = 0; i < MAX_LEVEL - 1; i++) {
        const n = Math.max(0, Math.round(Number(raw[i]) || 0));
        out.push(n > 0 ? n : DEFAULT_STARS);
    }
    return out;
}

// Étoiles nécessaires pour passer du niveau L au niveau L+1.
export function thresholdForLevel(L) {
    L = Math.round(Number(L) || 1);
    if (L < 1) L = 1;
    if (L >= MAX_LEVEL) return Infinity;
    return starLevelTable()[L - 1];
}

// Total d'étoiles pour aller du niveau 1 au niveau 20 (= nb de sessions).
export function totalStars(table = starLevelTable()) {
    return table.reduce((a, b) => a + (Number(b) || 0), 0);
}

// ── Lecture des données d'un acteur ─────────────────────────
function charLevel(actor) {
    return Math.max(1, Math.min(MAX_LEVEL, Number(actor?.system?.details?.level) || 1));
}
function getStars(actor) {
    return Math.max(0, Number(actor?.getFlag(MOD, "stars")) || 0);
}

// Un PJ concerné par le système : un personnage joueur.
function isTrackedActor(actor) {
    return actor?.type === "character";
}

// ── Réconciliation (report au changement de niveau) ─────────
// Compare le niveau courant au dernier niveau connu (flag starsLevel).
// Si le niveau a monté, on soustrait les seuils franchis (le surplus est
// reporté) et on nettoie l'état « prêt à monter ». Idempotent : n'écrit
// que si quelque chose change. N'agit que si on peut modifier l'acteur.
export async function reconcile(actor) {
    if (!starXpEnabled() || !isTrackedActor(actor)) return;
    if (!actor.isOwner) return;   // seul un propriétaire (ou MJ) écrit

    const cur    = charLevel(actor);
    const stored = actor.getFlag(MOD, "starsLevel");

    if (stored == null) {
        try { await actor.setFlag(MOD, "starsLevel", cur); } catch {}
        return;
    }
    if (cur > stored) {
        let stars = getStars(actor);
        for (let L = stored; L < cur; L++) {
            const t = thresholdForLevel(L);
            if (Number.isFinite(t)) stars -= t;
        }
        stars = Math.max(0, stars);
        try {
            await actor.update({
                [`flags.${MOD}.stars`]:              stars,
                [`flags.${MOD}.starsLevel`]:         cur,
                [`flags.${MOD}.pendingLevelUp`]:     false,
                [`flags.${MOD}.starsReadyNotified`]: false
            });
        } catch {}
    } else if (cur < stored) {
        try { await actor.setFlag(MOD, "starsLevel", cur); } catch {}
    }
}

// ── Attribution d'étoiles (contexte MJ, à la clôture de session) ──
// Ajoute `n` étoiles à l'acteur. Si le seuil du niveau courant est
// atteint et qu'on ne l'a pas déjà signalé, marque « prêt à monter »
// (pendingLevelUp) et prévient les MJ + le joueur par whisper.
export async function awardStars(actor, n) {
    if (!starXpEnabled() || !isTrackedActor(actor)) return;
    n = Math.max(0, Math.round(Number(n) || 0));
    if (!n) return;

    const cur   = charLevel(actor);
    const stars = getStars(actor) + n;
    const patch = {
        [`flags.${MOD}.stars`]:      stars,
        [`flags.${MOD}.starsLevel`]: actor.getFlag(MOD, "starsLevel") ?? cur
    };

    const threshold = thresholdForLevel(cur);
    const reached   = Number.isFinite(threshold) && stars >= threshold;
    const notified  = actor.getFlag(MOD, "starsReadyNotified") === true;

    if (reached && !notified) {
        patch[`flags.${MOD}.pendingLevelUp`]     = true;
        patch[`flags.${MOD}.starsReadyNotified`] = true;
    }

    try { await actor.update(patch); } catch (e) { console.warn(`[${MOD}] awardStars`, e); }

    if (reached && !notified) {
        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
        const owner = game.users.find(u => u.character?.id === actor.id && !u.isGM);
        try {
            ChatMessage.create({
                whisper: gmIds,
                speaker: { alias: "Système d'étoiles" },
                content: `⭐ <strong>${actor.name}</strong> a atteint le seuil d'étoiles : <strong>prêt à monter de niveau ${cur + 1}</strong>.`
            });
            if (owner) ChatMessage.create({
                whisper: [owner.id],
                speaker: { alias: "Système d'étoiles" },
                content: `⭐ Tu as assez d'étoiles pour passer <strong>niveau ${cur + 1}</strong> ! Le MJ va valider ta montée de niveau.`
            });
        } catch {}
    }
}

// ── Progression pour la fiche / le rapport ──────────────────
// { level, stars, threshold, ready, max } pour un acteur donné.
export function progressFor(actor) {
    const level     = charLevel(actor);
    const stars     = getStars(actor);
    const threshold = thresholdForLevel(level);
    const max       = level >= MAX_LEVEL;
    return { level, stars, threshold, ready: !max && stars >= threshold, max };
}

// ── Widget de fiche (remplace l'affichage d'XP) ─────────────
function starWidgetHtml(actor) {
    const { level, stars, threshold, ready, max } = progressFor(actor);
    if (max) {
        return `<div class="scwm-starxp" title="Niveau maximum atteint">
            <span class="scwm-starxp-stars">${"★".repeat(3)}</span>
            <span class="scwm-starxp-text">Niveau maximum</span>
        </div>`;
    }
    // Jusqu'à 12 étoiles dessinées (au-delà on n'affiche que le compte).
    const drawn = threshold <= 12
        ? `<span class="scwm-starxp-stars">${
              "★".repeat(Math.min(stars, threshold)) +
              "☆".repeat(Math.max(0, threshold - stars))
          }${stars > threshold ? ` +${stars - threshold}` : ""}</span>`
        : "";
    const label = ready
        ? `Prêt à monter niveau ${level + 1} !`
        : `${stars} / ${threshold} ★ avant niveau ${level + 1}`;
    return `<div class="scwm-starxp ${ready ? "is-ready" : ""}" title="Étoiles vers le niveau suivant">
        ${drawn}
        <span class="scwm-starxp-text">${label}</span>
    </div>`;
}

// CSS injecté en JS (fiable quel que soit l'hébergement — cf. chat.js).
const STARXP_CSS = `
.scwm-starxp {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 3px 6px; border-radius: 5px;
    background: rgba(230,190,60,0.12);
    border: 1px solid rgba(230,190,60,0.45);
    font-size: 12px; line-height: 1.2;
}
.scwm-starxp .scwm-starxp-stars { color: #e6be3c; letter-spacing: 1px; font-size: 13px; }
.scwm-starxp .scwm-starxp-text  { font-weight: 600; }
.scwm-starxp.is-ready {
    background: rgba(120,200,120,0.18); border-color: rgba(120,200,120,0.6);
    animation: scwm-starxp-pulse 1.6s ease-in-out infinite;
}
.scwm-starxp.is-ready .scwm-starxp-text { color: #6ec06e; }
@keyframes scwm-starxp-pulse { 0%,100%{ box-shadow:0 0 0 rgba(120,200,120,0); } 50%{ box-shadow:0 0 6px rgba(120,200,120,0.5); } }
/* Masque l'affichage d'XP natif sur les fiches où on a injecté le widget. */
.app.sheet:has(.scwm-starxp) .xp-bar,
.app.sheet:has(.scwm-starxp) [data-action="setXP"],
.sheet:has(.scwm-starxp) .header-details .xp,
.sheet:has(.scwm-starxp) input[name="system.details.xp.value"] {
    display: none !important;
}
`;

function ensureStarCss() {
    let st = document.getElementById("scwm-starxp-style");
    if (!st) { st = document.createElement("style"); st.id = "scwm-starxp-style"; document.head.appendChild(st); }
    if (st.textContent !== STARXP_CSS) st.textContent = STARXP_CSS;
}

// Injecte le widget dans une fiche PJ rendue, en remplaçant/masquant l'XP.
function injectWidget(app, root) {
    if (!starXpEnabled()) return;
    const actor = app?.document ?? app?.actor;
    if (!isTrackedActor(actor)) return;
    if (!root || root.querySelector(".scwm-starxp")) return;   // déjà injecté

    // Réconciliation (report au changement de niveau) au moment de l'ouverture.
    reconcile(actor);

    const widget = document.createElement("div");
    widget.innerHTML = starWidgetHtml(actor);
    const node = widget.firstElementChild;
    if (!node) return;

    // On cherche l'emplacement de l'XP natif ; à défaut, on pose le widget
    // près du niveau, puis en dernier recours dans l'en-tête de la fiche.
    const xpAnchor =
        root.querySelector(".xp-bar") ||
        root.querySelector('input[name="system.details.xp.value"]')?.closest(".xp, .meter, .form-group, li, div") ||
        root.querySelector(".header-details .xp") ||
        root.querySelector('[data-action="setXP"]');

    if (xpAnchor?.parentElement) {
        xpAnchor.parentElement.insertBefore(node, xpAnchor);
    } else {
        const header = root.querySelector(".sheet-header, .window-content .header, header");
        if (header) header.appendChild(node);
        else root.prepend(node);
    }
}

export function StarXpHooks() {
    ensureStarCss();

    // Injection dans les fiches d'acteur (native dnd5e ET Tidy5e : les deux
    // émettent renderActorSheetV2 en v13). On tente les deux hooks.
    const onRender = (app, html) => {
        try {
            const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element?.[0] ?? app?.element);
            injectWidget(app, root);
        } catch (e) { console.warn(`[${MOD}] widget étoiles`, e); }
    };
    Hooks.on("renderActorSheetV2", onRender);
    Hooks.on("renderActorSheet",   onRender);

    // Réconciliation quand le niveau change (ajout/retrait d'une classe, etc.).
    const recon = (doc) => {
        try {
            const actor = doc?.documentName === "Actor" ? doc : doc?.parent;
            if (actor?.documentName === "Actor") reconcile(actor);
        } catch {}
    };
    Hooks.on("updateActor", (actor) => recon(actor));
    Hooks.on("createItem",  (item)  => recon(item));
    Hooks.on("updateItem",  (item)  => recon(item));
    Hooks.on("deleteItem",  (item)  => recon(item));
}

// ── Intégration à la fenêtre « Clore la session » ───────────
// Bloc de sélection 1–3 étoiles (appliqué à toute la party).
export function starAwardBlockHtml(pcs) {
    const names = (pcs ?? []).map(p => p.name).join(", ");
    const stars = [1, 2, 3].map(n =>
        `<button type="button" class="scwm-star-pick" data-n="${n}"
            style="background:none;border:none;cursor:pointer;font-size:26px;line-height:1;padding:0 2px;color:#bbb;">★</button>`
    ).join("");
    return `
    <div class="scwm-star-award" style="margin-bottom:10px;">
        <p style="margin:0 0 4px;font-weight:bold;">Étoiles de la session (difficulté)</p>
        <p style="margin:0 0 6px;font-size:.82em;color:#aaa;">Attribuées à toute la party${names ? ` : ${names}` : ""}.</p>
        <div class="scwm-star-row" style="display:flex;align-items:center;gap:6px;">
            ${stars}
            <span class="scwm-star-count" style="margin-left:8px;font-weight:600;">1 étoile</span>
        </div>
        <input type="hidden" class="scwm-star-value" value="1">
    </div>`;
}

// Câble le sélecteur d'étoiles (surbrillance + valeur). À appeler après rendu.
export function wireStarAwardBlock(root) {
    const box = root?.querySelector(".scwm-star-award");
    if (!box) return;
    const value = box.querySelector(".scwm-star-value");
    const count = box.querySelector(".scwm-star-count");
    const picks = [...box.querySelectorAll(".scwm-star-pick")];
    const paint = (n) => {
        picks.forEach(b => { b.style.color = Number(b.dataset.n) <= n ? "#e6be3c" : "#bbb"; });
        if (count) count.textContent = `${n} étoile${n > 1 ? "s" : ""}`;
        if (value) value.value = String(n);
    };
    picks.forEach(b => b.addEventListener("click", (e) => { e.preventDefault(); paint(Number(b.dataset.n)); }));
    paint(1);
}

export function readStarAward(root) {
    const v = root?.querySelector(".scwm-star-award .scwm-star-value")?.value;
    const n = Math.max(1, Math.min(3, Math.round(Number(v) || 1)));
    return n;
}
