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
const K_CONTRASTCOL = "a11yContrastColor"; // String (couleur des contours)
const K_AVATARS  = "a11yPlayerAvatars";   // Boolean
const K_AUTOHIDE = "a11yAutoHide";        // Boolean
const K_COMPACT  = "a11yCompactControls"; // Boolean
const K_SHEETCOL = "a11ySheetColor";      // String ("" = couleur dnd5e par défaut)

const DEFAULT_BORDER = "#ffd54a";

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
    game.settings.register(MOD, K_CONTRASTCOL, {
        name: "Couleur des contours (fort contraste)", scope: "client", config: false,
        type: String, default: DEFAULT_BORDER, onChange: applyAccessibility
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
    game.settings.register(MOD, K_SHEETCOL, {
        name: "Couleur des fiches personnage", scope: "client", config: false,
        type: String, default: "", onChange: applyAccessibility
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
        <div class="scwm-a11y-row" style="padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.07);">
            <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0;font-weight:600;">
                <span>Couleur des contours</span>
                <span style="display:inline-flex;align-items:center;gap:6px;">
                    <input type="color" name="${K_CONTRASTCOL}" value="${_get(K_CONTRASTCOL) || DEFAULT_BORDER}"
                           style="width:42px;height:26px;padding:0;border:none;background:none;cursor:pointer;">
                    <a class="scwm-a11y-col-reset" style="font-size:.8em;color:#c9a227;cursor:pointer;">réinit.</a>
                </span>
            </label>
            <p style="margin:3px 0 0;font-size:.8em;color:#999;">Couleur des bordures et du contour de focus en mode fort contraste (jaune par défaut).</p>
        </div>
        <div class="scwm-a11y-row" style="padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.07);">
            <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0;font-weight:600;">
                <span>Couleur des fiches personnage</span>
                <span style="display:inline-flex;align-items:center;gap:6px;">
                    <input type="checkbox" name="${K_SHEETCOL}_on" ${_get(K_SHEETCOL) ? "checked" : ""}
                           title="Cocher pour remplacer le rouge par défaut" style="width:16px;height:16px;">
                    <input type="color" name="${K_SHEETCOL}" value="${_get(K_SHEETCOL) || "#e74c3c"}"
                           style="width:42px;height:26px;padding:0;border:none;background:none;cursor:pointer;">
                </span>
            </label>
            <p style="margin:3px 0 0;font-size:.8em;color:#999;">Remplace le rouge d'accent par défaut des fiches personnage dnd5e par la couleur choisie (coche la case pour activer ; décoche pour revenir au rouge d'origine).</p>
        </div>
        ${row(K_AVATARS,  "Avatars dans la liste des joueurs", "Affiche la miniature du portrait de chaque joueur à côté de son nom.")}
        ${row(K_AUTOHIDE, "Auto-masquage de l'interface", "Estompe contrôles, navigation, macros et liste des joueurs tant que la souris ne les survole pas.")}
        ${row(K_COMPACT,  "Contrôles de gauche compacts", "Réduit la taille des icônes de la barre d'outils de gauche.")}
    </div>`;

    await foundry.applications.api.DialogV2.wait({
        window:      { title: "Accessibilité", icon: "fas fa-universal-access" },
        position:    { width: 520 },
        rejectClose: false,
        content,
        render: () => {
            const root = document.getElementById(uid);
            root?.querySelector(".scwm-a11y-col-reset")?.addEventListener("click", (e) => {
                e.preventDefault();
                const inp = root.querySelector(`[name="${K_CONTRASTCOL}"]`);
                if (inp) inp.value = DEFAULT_BORDER;
            });
        },
        buttons: [
            {
                action: "save", default: true,
                label: "Enregistrer", icon: '<i class="fa-solid fa-save"></i>',
                callback: async (ev, btn) => {
                    const root = btn.form ?? document.getElementById(uid);
                    if (!root) return;
                    const sel = root.querySelector(`[name="${K_DALTON}"]`);
                    await game.settings.set(MOD, K_DALTON, sel?.value ?? "none");
                    const col = root.querySelector(`[name="${K_CONTRASTCOL}"]`);
                    await game.settings.set(MOD, K_CONTRASTCOL, col?.value || DEFAULT_BORDER);
                    const shOn  = root.querySelector(`[name="${K_SHEETCOL}_on"]`)?.checked;
                    const shCol = root.querySelector(`[name="${K_SHEETCOL}"]`)?.value || "";
                    await game.settings.set(MOD, K_SHEETCOL, shOn ? shCol : "");
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

// ── Daltonisation de la SCÈNE via un filtre PIXI ────────────
// Un filtre CSS url() sur le canvas WebGL de Foundry est ignoré par le
// navigateur. On applique donc un PIXI.ColorMatrixFilter sur le stage du
// canvas. La matrice est la daltonisation (correction) précalculée en une
// seule matrice linéaire : M = I + Shift·(I − Sim), où Sim simule la
// déficience et Shift redistribue l'information de couleur perdue vers des
// canaux perceptibles. Format PIXI : 4 lignes (R,G,B,A) × 5 colonnes
// (r, g, b, a, offset).
const DALTON_MATRIX = {
    protan: [
        1,       0,       0,     0, 0,
       -0.2549,  1.2549,  0,     0, 0,
        0.3031, -0.5451,  1.242, 0, 0,
        0,       0,       0,     1, 0
    ],
    deutan: [
        1,       0,       0,   0, 0,
       -0.4375,  1.4375,  0,   0, 0,
        0.2625, -0.5625,  1.3, 0, 0,
        0,       0,       0,   1, 0
    ],
    tritan: [
        1.05, -0.3825,  0.3325, 0, 0,
        0,     1.2345, -0.2345, 0, 0,
        0,     0,       1,      0, 0,
        0,     0,       0,      1, 0
    ]
};

// Applique (ou retire) le filtre de daltonisation sur le canvas de la scène.
function applyCanvasDaltonism() {
    const stage = canvas?.stage;
    const app   = canvas?.app;
    if (!stage || !app) return;   // canvas pas encore prêt

    // Retire notre éventuel filtre précédent.
    const others = (stage.filters ?? []).filter(f => !f?._scwmDalton);

    const mode = _get(K_DALTON) ?? "none";
    const matrix = DALTON_MATRIX[mode];
    if (!matrix) {                 // « none » ou valeur inconnue → on nettoie
        stage.filters = others.length ? others : null;
        return;
    }

    const CMF = globalThis.PIXI?.filters?.ColorMatrixFilter ?? globalThis.PIXI?.ColorMatrixFilter;
    if (!CMF) { console.warn(`[${MOD}] PIXI.ColorMatrixFilter indisponible : daltonisme non appliqué.`); return; }

    try {
        const f = new CMF();
        f.matrix = matrix.slice();
        f._scwmDalton = true;
        stage.filters = [...others, f];
        // Zone de filtre = tout l'écran de rendu (sinon le filtre suit le stage
        // qui se déplace/zoome et ne couvre pas le viewport).
        stage.filterArea = app.renderer.screen;
    } catch (e) {
        console.error(`[${MOD}] Application du filtre daltonisme :`, e);
    }
}

// ── Couleur d'accent des fiches personnage ──────────────────
// Surcharge la variable --dnd5e-color-red (rouge par défaut du système dnd5e)
// sur toutes les fiches personnage, via une feuille de style injectée. Vide
// = on laisse la couleur d'origine.
function applySheetColor() {
    const col = (_get(K_SHEETCOL) || "").trim();
    let el = document.getElementById("scwm-sheet-color");
    if (!col) { el?.remove(); return; }
    if (!el) { el = document.createElement("style"); el.id = "scwm-sheet-color"; document.head.appendChild(el); }
    el.textContent =
        `.dnd5e2.sheet.actor.character { --dnd5e-color-red: ${col} !important; }`;
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

    // Daltonisme : filtre PIXI sur la scène (voir applyCanvasDaltonism).
    applyCanvasDaltonism();

    body.classList.toggle("scwm-a11y-contrast", !!_get(K_CONTRAST));
    body.classList.toggle("scwm-a11y-autohide", !!_get(K_AUTOHIDE));
    body.classList.toggle("scwm-a11y-compact",  !!_get(K_COMPACT));

    // Couleur des contours du mode fort contraste (variable CSS lue par le CSS).
    body.style.setProperty("--scwm-a11y-border", _get(K_CONTRASTCOL) || DEFAULT_BORDER);

    // Couleur d'accent des fiches personnage dnd5e (surcharge --dnd5e-color-red).
    applySheetColor();

    try { decoratePlayers(document.getElementById("players")); } catch {}
}

// ── Hooks ───────────────────────────────────────────────────
export function AccessibilityHooks() {
    registerA11ySettings();
    registerA11yMenu();

    Hooks.once("ready", () => applyAccessibility());
    // Le stage du canvas est reconstruit à chaque (re)dessin de scène : on
    // réapplique alors le filtre de daltonisation.
    Hooks.on("canvasReady", () => applyCanvasDaltonism());
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
