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
        await applyState(actor, { notify: false });
        return;
    }
    if (cur > stored) {
        // Le niveau a monté (bouton de base utilisé) : on soustrait les seuils
        // franchis, le surplus est reporté, et on nettoie l'état « prêt ».
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
        await applyState(actor, { notify: false });
    } else if (cur < stored) {
        try { await actor.setFlag(MOD, "starsLevel", cur); } catch {}
        await applyState(actor, { notify: false });
    }
}

// ── Synchronise l'état « prêt à monter » ────────────────────
// Met à jour pendingLevelUp + l'XP native pour que le BOUTON de montée de
// niveau dnd5e s'active quand le seuil d'étoiles est atteint (XP mise à
// value=max), et se désactive sinon (value=0). L'affichage XP natif est
// masqué sur la fiche : ces valeurs ne servent qu'à piloter le bouton.
// notify=true → whisper MJ + joueur une seule fois au passage « prêt ».
async function applyState(actor, { notify = false } = {}) {
    if (!isTrackedActor(actor) || !actor.isOwner) return;

    const cur       = charLevel(actor);
    const stars     = getStars(actor);
    const threshold = thresholdForLevel(cur);
    const ready     = Number.isFinite(threshold) && stars >= threshold;
    const notified  = actor.getFlag(MOD, "starsReadyNotified") === true;

    const patch = {};
    if ((actor.getFlag(MOD, "pendingLevelUp") === true) !== ready) {
        patch[`flags.${MOD}.pendingLevelUp`] = ready;
    }
    if (ready && !notified)  patch[`flags.${MOD}.starsReadyNotified`] = true;
    if (!ready && notified)  patch[`flags.${MOD}.starsReadyNotified`] = false;

    // Pilotage du bouton de montée de niveau natif (si progression par XP).
    const xp = actor.system?.details?.xp;
    const max = Number(xp?.max) || 0;
    if (max > 0) {
        const target = ready ? max : 0;
        if ((Number(xp?.value) || 0) !== target) patch["system.details.xp.value"] = target;
    }

    if (Object.keys(patch).length) {
        try { await actor.update(patch); } catch (e) { console.warn(`[${MOD}] applyState`, e); }
    }

    if (ready && !notified && notify) {
        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
        const owner = game.users.find(u => u.character?.id === actor.id && !u.isGM);
        try {
            ChatMessage.create({
                whisper: gmIds, speaker: { alias: "Système d'étoiles" },
                content: `⭐ <strong>${actor.name}</strong> a atteint le seuil d'étoiles : <strong>prêt à monter de niveau ${cur + 1}</strong>.`
            });
            if (owner) ChatMessage.create({
                whisper: [owner.id], speaker: { alias: "Système d'étoiles" },
                content: `⭐ Tu as assez d'étoiles pour passer <strong>niveau ${cur + 1}</strong> ! Le MJ va valider ta montée de niveau.`
            });
        } catch {}
    }
}

// ── Attribution d'étoiles (clôture de session) ──────────────
export async function awardStars(actor, n) {
    if (!starXpEnabled() || !isTrackedActor(actor)) return;
    n = Math.max(0, Math.round(Number(n) || 0));
    if (!n) return;
    const cur = charLevel(actor);
    try {
        await actor.update({
            [`flags.${MOD}.stars`]:      getStars(actor) + n,
            [`flags.${MOD}.starsLevel`]: actor.getFlag(MOD, "starsLevel") ?? cur
        });
    } catch (e) { console.warn(`[${MOD}] awardStars`, e); return; }
    await applyState(actor, { notify: true });
}

// ── Édition directe du compteur (MJ, sur la fiche) ──────────
export async function setStars(actor, n) {
    if (!starXpEnabled() || !isTrackedActor(actor)) return;
    if (!game.user.isGM) return;
    n = Math.max(0, Math.round(Number(n) || 0));
    const cur = charLevel(actor);
    try {
        await actor.update({
            [`flags.${MOD}.stars`]:      n,
            [`flags.${MOD}.starsLevel`]: actor.getFlag(MOD, "starsLevel") ?? cur
        });
    } catch (e) { console.warn(`[${MOD}] setStars`, e); return; }
    await applyState(actor, { notify: true });
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
// Le MJ voit des contrôles d'édition (− / champ / +) ; les joueurs voient
// seulement leur progression.
function starWidgetHtml(actor) {
    const { level, stars, threshold, ready, max } = progressFor(actor);
    const isGM = game.user.isGM;

    if (max) {
        return `<div class="scwm-starxp"><span class="scwm-starxp-stars">★</span>
            <span class="scwm-starxp-text">Niveau maximum</span></div>`;
    }

    if (isGM) {
        // Champ éditable seul : « [n] / seuil ★ » (pas de −/+, pas de texte final).
        return `<div class="scwm-starxp ${ready ? "is-ready" : ""}" title="Étoiles (modifiable par le MJ)">
            <span class="scwm-star-edit">
                <input type="number" class="scwm-star-num" min="0" step="1" value="${stars}">
                <span class="scwm-star-slash">/ ${threshold} ★</span>
            </span>
        </div>`;
    }

    // Joueur : pastille soignée avec étoile dorée.
    return `<div class="scwm-starxp scwm-starxp-player ${ready ? "is-ready" : ""}" title="Étoiles vers le niveau suivant">
        <i class="fa-solid fa-star scwm-starxp-ico"></i>
        ${ready
            ? `<span class="scwm-starxp-ready">Prêt à monter !</span>`
            : `<span class="scwm-starxp-count"><strong>${stars}</strong><span class="scwm-starxp-sep">/</span>${threshold}</span>`}
    </div>`;
}

// CSS injecté en JS (fiable quel que soit l'hébergement — cf. chat.js).
const STARXP_CSS = `
.scwm-starxp {
    display: inline-flex; align-items: center; gap: 6px;
    width: fit-content; max-width: 100%; align-self: flex-start;
    padding: 3px 6px; border-radius: 5px;
    background: rgba(230,190,60,0.07);
    border: 1px solid rgba(230,190,60,0.28);
    font-size: 12px; line-height: 1.2;
}
.scwm-starxp .scwm-starxp-stars { color: #e6be3c; letter-spacing: 1px; font-size: 13px; }
.scwm-starxp .scwm-starxp-text  { font-weight: 600; }
/* Pastille joueur — plus grande et plus soignée */
.scwm-starxp.scwm-starxp-player { padding: 4px 11px; font-size: 15px; gap: 7px; }
.scwm-starxp .scwm-starxp-ico { color: #a8863a; font-size: 14px; }
.scwm-starxp .scwm-starxp-count { font-weight: 600; }
.scwm-starxp .scwm-starxp-count strong { font-size: 17px; }
.scwm-starxp .scwm-starxp-sep { opacity: .55; margin: 0 3px; }
.scwm-starxp .scwm-starxp-ready { font-weight: 700; }
.scwm-starxp.is-ready {
    background: rgba(120,200,120,0.18); border-color: rgba(120,200,120,0.6);
    animation: scwm-starxp-pulse 1.6s ease-in-out infinite;
}
.scwm-starxp.is-ready .scwm-starxp-text { color: #6ec06e; }
@keyframes scwm-starxp-pulse { 0%,100%{ box-shadow:0 0 0 rgba(120,200,120,0); } 50%{ box-shadow:0 0 6px rgba(120,200,120,0.5); } }
/* Contrôles d'édition MJ */
.scwm-starxp .scwm-star-edit { display:inline-flex; align-items:center; gap:3px; }
.scwm-starxp .scwm-star-dec,
.scwm-starxp .scwm-star-inc {
    width:20px; height:20px; line-height:1; padding:0; flex:0 0 auto;
    border:1px solid rgba(230,190,60,0.5); border-radius:4px; cursor:pointer;
    background:rgba(230,190,60,0.15); color:#e6be3c; font-weight:700;
}
.scwm-starxp .scwm-star-num {
    width:42px; text-align:center; padding:1px 2px; box-sizing:border-box;
    background:rgba(0,0,0,0.25); border:1px solid rgba(230,190,60,0.4); border-radius:4px; color:#f2ead4;
}
.scwm-starxp .scwm-star-slash { color:#e6be3c; }
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
    // Emplacement de l'XP native dnd5e (character-header.hbs) :
    //   div.xp-label (« valeur / max ») + div.xp-bar (barre de progression).
    // On place le compteur d'étoiles À LA PLACE de ce bloc, puis on masque
    // l'XP native. À défaut (autres fiches), on retombe sur des repères larges.
    // Le compteur se place juste après .xp-label (qui contient le bouton ⬆ de
    // montée de niveau) → « ⬆  ★ 0/1 ». Le texte 0/300 et la barre sont masqués.
    const xpAnchor =
        root.querySelector(".xp-label") ||
        root.querySelector(".xp-bar") ||
        root.querySelector('input[name="system.details.xp.value"]')?.closest(".xp, .meter, .form-group, li, div") ||
        root.querySelector(".header-details .xp");

    if (xpAnchor) {
        xpAnchor.insertAdjacentElement("afterend", node);   // le widget prend la place de l'XP
    } else {
        const header = root.querySelector(".sheet-header .right, .sheet-header, .window-content .header, header");
        if (header) header.appendChild(node);
        else root.prepend(node);
    }

    // Masque l'affichage d'XP natif (valeur/max « 0 / 300 » + barre de
    // progression), SANS toucher aux boutons (montée de niveau, repos…).
    hideNativeXp(root, node);

    // Champ éditable MJ → écrit le compteur d'étoiles.
    if (game.user.isGM) {
        const numEl  = node.querySelector(".scwm-star-num");
        const commit = (v) => setStars(actor, v);
        numEl?.addEventListener("change", () => commit(numEl.value));
        // Empêche la touche Entrée de soumettre/fermer la fiche.
        numEl?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(numEl.value); } });
    }
}

// Masque l'XP native SANS toucher au bouton de montée de niveau.
// IMPORTANT : le bouton ⬆ (Plutonium : .imp-cls__btn-sheet-level-up) est PLACÉ
// À L'INTÉRIEUR de .xp-label. On garde donc .xp-label affiché (pour le bouton)
// et on masque seulement son TEXTE (valeur / séparateur / max). On masque aussi
// la barre de progression .xp-bar (qui, elle, ne contient pas le bouton).
function hideNativeXp(root, keep) {
    root.querySelectorAll(".xp-label").forEach(lbl => {
        lbl.style.display = "";   // annule un éventuel display:none posé avant → garde le bouton ⬆
        lbl.querySelectorAll(".value, .separator, .max").forEach(el => { el.style.display = "none"; });
    });
    root.querySelectorAll(".xp-bar").forEach(el => { el.style.display = "none"; });
    root.querySelectorAll('input[name="system.details.xp.value"], input[name="system.details.xp.max"]').forEach(el => { el.style.display = "none"; });
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
