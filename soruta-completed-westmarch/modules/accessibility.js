// ============================================================
// accessibility.js — Accessibilité & confort d'interface
//
// Réimplémentation MAISON (aucune reprise de code tiers) de quelques
// idées d'ergonomie popularisées par des modules d'UI, orientées
// ACCESSIBILITÉ — notamment pour les joueurs daltoniens.
//
// Tous les réglages sont "client" (par utilisateur) : chaque joueur
// choisit ses propres options via une fenêtre « Accessibilité »
// accessible à tout le monde (restricted:false).
//
//   1. Daltonisme  — filtre de CORRECTION (daltonisation) appliqué à
//      l'interface et à la carte : protanopie / deutéranopie /
//      tritanopie. Redistribue l'information de couleur perdue vers des
//      canaux perceptibles (algorithme de daltonisation classique,
//      implémenté en filtre SVG feColorMatrix + feComposite).
//   2. Fort contraste — renforce texte, bordures et fonds de l'UI.
//   3. Avatars des joueurs — miniature du portrait dans la liste.
//   4. Auto-masquage — fond d'écran des contrôles/nav/macros/joueurs
//      estompés tant que la souris ne les survole pas.
//   5. Contrôles compacts — barre d'outils de gauche réduite.
//
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

// Clés de réglages (toutes "client").
const K_DALTON   = "a11yDaltonism";      // "none" | "protan" | "deutan" | "tritan"
const K_CONTRAST = "a11yContrast";        // Boolean
const K_AVATARS  = "a11yPlayerAvatars";   // Boolean
const K_AUTOHIDE = "a11yAutoHide";        // Boolean
const K_COMPACT  = "a11yCompactControls"; // Boolean

const DALTON_CHOICES = {
    none:   "Aucun (couleurs normales)",
    protan: "Protanopie (rouge)",
    deutan: "Deutéranopie (vert)",
    tritan: "Tritanopie (bleu)"
};

const _get = (k) => { try { return game.settings.get(MOD, k); } catch { return undefined; } };

// ── Réglages ────────────────────────────────────────────────
function registerA11ySettings() {
    game.settings.register(MOD, K_DALTON, {
        name: "Mode daltonisme", scope: "client", config: false,
        type: String, choices: DALTON_CHOICES, default: "none",
        onChange: applyAccessibility
    });
    game.settings.register(MOD, K_CONTRAST, {
        name: "Fort contraste", scope: "client", config: false,
        type: Boolean, default: false, onChange: applyAccessibility
    });
    game.settings.register(MOD, K_AVATARS, {
        name: "Avatars dans la liste des joueurs", scope: "client", config: false,
        type: Boolean, default: false, onChange: () => { applyAccessibility(); try { ui.players?.render(); } catch {} }
    });
    game.settings.register(MOD, K_AUTOHIDE, {
        name: "Auto-masquage de l'interface", scope: "client", config: false,
        type: Boolean, default: false, onChange: applyAccessibility
    });
    game.settings.register(MOD, K_COMPACT, {
        name: "Contrôles de gauche compacts", scope: "client", config: false,
        type: Boolean, default: false, onChange: applyAccessibility
    });
}

// ── Menu « Accessibilité » (visible par tous les joueurs) ────
function registerA11yMenu() {
    try {
        game.settings.registerMenu(MOD, "menu-accessibility", {
            name:  "Accessibilité",
            label: "Ouvrir",
            hint:  "Options personnelles : daltonisme, contraste, avatars, auto-masquage, contrôles compacts. Chaque joueur règle les siennes.",
            icon:  "fas fa-universal-access",
            type:  class extends foundry.applications.api.ApplicationV2 {
                static DEFAULT_OPTIONS = { id: "scwm-menu-accessibility", window: { title: "Accessibilité" } };
                async render() { openA11yDialog(); return this; }
                async close()  { return this; }
            },
            restricted: false
        });
    } catch (e) {
        console.warn(`[${MOD}] registerMenu « Accessibilité » échec :`, e);
    }
}

async function openA11yDialog() {
    const uid = "scwm-a11y-form";
    const dalton = _get(K_DALTON) ?? "none";
    const opts = Object.entries(DALTON_CHOICES)
        .map(([v, lbl]) => `<option value="${v}" ${dalton === v ? "selected" : ""}>${lbl}</option>`).join("");

    const row = (key, label, hint) => `
        <div class="scwm-a11y-row" style="padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.07);">
            <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;font-weight:600;margin:0;">
                <span>${label}</span>
                <input type="checkbox" name="${key}" ${_get(key) ? "checked" : ""} style="width:18px;height:18px;flex-shrink:0;">
            </label>
            <p style="margin:3px 0 0;font-size:.8em;color:#999;">${hint}</p>
        </div>`;

    const content = `
    <div id="${uid}" style="display:flex;flex-direction:column;max-height:62vh;overflow-y:auto;padding-right:4px;">
        <div style="display:flex;align-items:center;gap:8px;margin:0 0 8px;padding:7px 10px;
                    border:1px solid rgba(201,162,39,0.5);border-radius:5px;
                    background:linear-gradient(180deg,rgba(201,162,39,0.12),rgba(0,0,0,0.15));">
            <i class="fa-solid fa-universal-access" style="color:#c9a227;font-size:16px;"></i>
            <div style="font-size:.82em;line-height:1.4;color:#d8cfa8;">
                <strong>Options d'accessibilité</strong><br>
                Personnelles à ton compte : elles n'affectent que ton affichage.
            </div>
        </div>

        <div style="padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.07);">
            <label style="display:block;font-weight:600;margin:0 0 4px;">Mode daltonisme</label>
            <select name="${K_DALTON}" style="width:100%;">${opts}</select>
            <p style="margin:4px 0 0;font-size:.8em;color:#999;">
                Applique un filtre de correction des couleurs sur l'interface et la carte,
                pour mieux distinguer les teintes selon ton type de vision.
            </p>
        </div>

        ${row(K_CONTRAST, "Fort contraste", "Renforce le contraste du texte, des bordures et des fonds de l'interface.")}
        ${row(K_AVATARS,  "Avatars dans la liste des joueurs", "Affiche la miniature du portrait de chaque joueur à côté de son nom.")}
        ${row(K_AUTOHIDE, "Auto-masquage de l'interface", "Estompe contrôles, navigation, macros et liste des joueurs tant que la souris ne les survole pas.")}
        ${row(K_COMPACT,  "Contrôles de gauche compacts", "Réduit la taille des icônes de la barre d'outils de gauche.")}
    </div>`;

    await foundry.applications.api.DialogV2.wait({
        window:      { title: "Accessibilité", icon: "fas fa-universal-access" },
        position:    { width: 520 },
        rejectClose: false,
        content,
        buttons: [
            {
                action: "save", default: true,
                label: "Enregistrer", icon: '<i class="fa-solid fa-save"></i>',
                callback: async (ev, btn) => {
                    const root = btn.form ?? document.getElementById(uid);
                    if (!root) return;
                    const sel = root.querySelector(`[name="${K_DALTON}"]`);
                    await game.settings.set(MOD, K_DALTON, sel?.value ?? "none");
                    for (const k of [K_CONTRAST, K_AVATARS, K_AUTOHIDE, K_COMPACT]) {
                        const cb = root.querySelector(`[name="${k}"]`);
                        await game.settings.set(MOD, k, !!cb?.checked);
                    }
                    applyAccessibility();
                    try { ui.players?.render(); } catch {}
                }
            },
            { action: "close", label: "Fermer", icon: '<i class="fa-solid fa-xmark"></i>', callback: () => {} }
        ]
    });
}

// ── Filtres SVG de daltonisation ────────────────────────────
// Chaîne : (1) simulation de la déficience, (2) erreur = source − simulé,
// (3) redistribution de l'erreur vers des canaux perceptibles,
// (4) corrigé = source + erreur redistribuée.
const SVG_NS = "http://www.w3.org/2000/svg";

function _daltonFilter(id, simMatrix, shiftMatrix) {
    return `
    <filter id="${id}" color-interpolation-filters="linearRGB">
        <feColorMatrix type="matrix" in="SourceGraphic" result="sim" values="${simMatrix}"/>
        <feComposite in="SourceGraphic" in2="sim" operator="arithmetic"
                     k1="0" k2="1" k3="-1" k4="0" result="err"/>
        <feColorMatrix type="matrix" in="err" result="errshift" values="${shiftMatrix}"/>
        <feComposite in="SourceGraphic" in2="errshift" operator="arithmetic"
                     k1="0" k2="1" k3="1" k4="0"/>
    </filter>`;
}

// Matrices de SIMULATION (4×5 : R,G,B,A).
const SIM = {
    protan: "0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0",
    deutan: "0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0",
    tritan: "0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0"
};
// Redistribution de l'erreur (rouge-vert → bleu ; bleu → rouge-vert).
const SHIFT = {
    rg:    "0 0 0 0 0  0.7 1 0 0 0  0.7 0 1 0 0  0 0 0 1 0",
    tri:   "1 0 0.7 0 0  0 1 0.7 0 0  0 0 0 0 0  0 0 0 1 0"
};

function injectDaltonDefs() {
    if (document.getElementById("scwm-a11y-svg")) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.id = "scwm-a11y-svg";
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;");
    svg.innerHTML =
        _daltonFilter("scwm-dalton-protan", SIM.protan, SHIFT.rg) +
        _daltonFilter("scwm-dalton-deutan", SIM.deutan, SHIFT.rg) +
        _daltonFilter("scwm-dalton-tritan", SIM.tritan, SHIFT.tri);
    document.body.appendChild(svg);
}

// ── Avatars dans la liste des joueurs ───────────────────────
function decoratePlayers(root) {
    if (!_get(K_AVATARS)) return;
    const host = root instanceof HTMLElement ? root : document.getElementById("players");
    if (!host) return;
    host.querySelectorAll("[data-user-id]").forEach(row => {
        if (row.closest(".scwm-player-search")) return;
        if (row.querySelector(".scwm-player-avatar")) return;
        const uid = row.getAttribute("data-user-id");
        const user = game.users?.get(uid);
        if (!user) return;
        const src = user.character?.img || user.avatar || "icons/svg/mystery-man.svg";
        const img = document.createElement("img");
        img.className = "scwm-player-avatar";
        img.src = src;
        img.alt = "";
        // Insérer avant le nom (premier enfant utile de la ligne).
        const nameEl = row.querySelector(".player-name, .player-active, h3, .name") ?? row.firstElementChild;
        if (nameEl && nameEl.parentElement === row) row.insertBefore(img, nameEl);
        else row.insertBefore(img, row.firstChild);
    });
}

// ── Application des classes/état sur le <body> ──────────────
export function applyAccessibility() {
    const body = document.body;
    if (!body) return;
    injectDaltonDefs();

    const dalton = _get(K_DALTON) ?? "none";
    for (const m of ["protan", "deutan", "tritan"]) body.classList.toggle(`scwm-a11y-${m}`, dalton === m);

    body.classList.toggle("scwm-a11y-contrast", !!_get(K_CONTRAST));
    body.classList.toggle("scwm-a11y-autohide", !!_get(K_AUTOHIDE));
    body.classList.toggle("scwm-a11y-compact",  !!_get(K_COMPACT));

    try { decoratePlayers(document.getElementById("players")); } catch {}
}

// ── Hooks ───────────────────────────────────────────────────
export function AccessibilityHooks() {
    registerA11ySettings();
    registerA11yMenu();

    Hooks.once("ready", () => { injectDaltonDefs(); applyAccessibility(); });
    // Réappliquer après chaque rendu de la liste des joueurs (Foundry la
    // reconstruit à chaque changement de statut de connexion).
    Hooks.on("renderPlayers", (app, html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        applyAccessibility();
        decoratePlayers(root);
    });
    // La barre d'outils de gauche est reconstruite au changement de contrôle.
    Hooks.on("renderSceneControls", () => { if (_get(K_COMPACT) || _get(K_AUTOHIDE)) applyAccessibility(); });
}
