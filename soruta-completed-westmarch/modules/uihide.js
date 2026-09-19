// ============================================================
// uihide.js — Masquage d'éléments d'interface (par rôle)
//
// Un panneau (réglages MJ) liste ce qui est présent sur l'interface : les icônes
// de la barre d'outils de gauche (groupes + outils, y compris ceux du module) et
// les grandes zones (barre de macros, joueurs, navigation…). Deux colonnes de
// cases : « Joueurs » et « GM ». Chaque client masque ce qui est coché POUR SON
// rôle, via une feuille de style injectée. Réglage « monde » (le MJ décide pour
// tout le serveur). © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const STYLE_ID = "scwm-ui-hide-style";

function getHidden() {
    const v = game.settings.get(MOD, "hiddenUi");
    const o = (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
    return {
        players: Array.isArray(o.players) ? o.players : [],
        gm:      Array.isArray(o.gm)      ? o.gm      : []
    };
}

// Grandes zones fixes, toujours proposées.
const FIXED_TARGETS = [
    { key: "region:hotbar",     label: "Barre de macros (hotbar)",           sel: "#hotbar" },
    { key: "region:macrolist",  label: "Macros seulement (garder la barre)", sel: "#hotbar #macro-list, #hotbar #action-bar" },
    { key: "region:players",    label: "Liste des joueurs",                  sel: "#players" },
    { key: "region:navigation", label: "Navigation des scènes",              sel: "#navigation, #scene-navigation" },
    { key: "region:controls",   label: "Barre d'outils de gauche (entière)", sel: "#scene-controls, #controls" },
    { key: "region:sidebar",    label: "Barre latérale (sidebar)",           sel: "#sidebar" },
    { key: "region:logo",       label: "Logo Foundry",                       sel: "#logo" },
];

const cssEsc = (s) => String(s).replace(/["\\]/g, "\\$&");

function selectorFor(key) {
    const fixed = FIXED_TARGETS.find(t => t.key === key);
    if (fixed) return fixed.sel;
    if (key.startsWith("tool:")) {
        const n = cssEsc(key.slice(5));
        return `#scene-controls [data-tool="${n}"], #controls [data-tool="${n}"]`;
    }
    if (key.startsWith("control:")) {
        const n = cssEsc(key.slice(8));
        return `#scene-controls [data-control="${n}"], #controls [data-control="${n}"]`;
    }
    if (key.startsWith("sidebar:")) {
        const n = cssEsc(key.slice(8));
        // On masque l'onglet ET son éventuel conteneur (<li>) pour ne pas laisser
        // de trou dans la barre de droite.
        return `#sidebar-tabs [data-tab="${n}"], #sidebar nav [data-tab="${n}"], `
             + `#sidebar [data-action="tab"][data-tab="${n}"], `
             + `#sidebar-tabs li:has([data-tab="${n}"]), #sidebar nav li:has([data-tab="${n}"])`;
    }
    return null;
}

// (Ré)injecte la feuille de style de masquage selon le RÔLE du client courant.
export function applyUiHiding() {
    const h = getHidden();
    const keys = game.user?.isGM ? h.gm : h.players;
    const rules = keys.map(selectorFor).filter(Boolean)
        .map(s => `${s}{display:none !important;}`).join("\n");
    let style = document.getElementById(STYLE_ID);
    if (!style) { style = document.createElement("style"); style.id = STYLE_ID; document.head.appendChild(style); }
    style.textContent = rules;
}

// Onglets de la barre latérale de droite (Chat, Combats, Acteurs, Journaux…),
// détectés directement dans le DOM.
function scanSidebar() {
    const out = []; const seen = new Set();
    for (const el of document.querySelectorAll('#sidebar-tabs [data-tab], #sidebar nav [data-tab]')) {
        const name = el.dataset.tab;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const label = el.dataset.tooltip || el.getAttribute("aria-label") || el.title || name;
        const icon  = el.querySelector("i")?.className || "fa-solid fa-window-maximize";
        out.push({ key: `sidebar:${name}`, label, icon });
    }
    return out;
}

// Éléments détectés sur la barre d'outils via ui.controls (groupes + outils).
function scanControls() {
    const out = [];
    const controls = ui.controls?.controls ?? {};
    for (const [cname, c] of Object.entries(controls)) {
        if (!cname) continue;
        out.push({ key: `control:${cname}`, label: c.title || cname, icon: c.icon || "fa-solid fa-square", group: null });
        for (const [tname, t] of Object.entries(c.tools ?? {})) {
            if (!tname) continue;
            out.push({ key: `tool:${tname}`, label: t.title || tname, icon: t.icon || "fa-solid fa-wrench", group: c.title || cname });
        }
    }
    return out;
}

const _esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const COLW = "46px";

function rowHtml(entry, hPlayers, hGm) {
    const pc = hPlayers.has(entry.key) ? "checked" : "";
    const gc = hGm.has(entry.key) ? "checked" : "";
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;">
        <span style="flex:0 0 ${COLW};text-align:center;">
            <input type="checkbox" class="scwm-uihide-cb" data-role="players" value="${_esc(entry.key)}" ${pc} style="margin:0;">
        </span>
        <span style="flex:0 0 ${COLW};text-align:center;">
            <input type="checkbox" class="scwm-uihide-cb" data-role="gm" value="${_esc(entry.key)}" ${gc} style="margin:0;">
        </span>
        <i class="${_esc(entry.icon)}" style="width:16px;text-align:center;opacity:.85;"></i>
        <span style="flex:1;min-width:0;">${_esc(entry.label)}</span>
    </div>`;
}

function headerRow() {
    return `<div style="display:flex;align-items:flex-end;gap:6px;padding:2px 4px;border-bottom:1px solid rgba(255,255,255,.15);position:sticky;top:0;background:var(--color-bg,#1c1c22);z-index:1;">
        <span style="flex:0 0 ${COLW};text-align:center;font-size:10px;font-weight:700;color:#8fd19e;">Joueurs</span>
        <span style="flex:0 0 ${COLW};text-align:center;font-size:10px;font-weight:700;color:#e8cc6a;">GM</span>
        <span style="flex:1;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#9a8b70;">Élément</span>
    </div>`;
}

// Ouvre le panneau de masquage.
export async function openUiHideDialog() {
    const DialogV2 = foundry.applications.api.DialogV2;
    const h = getHidden();
    const hPlayers = new Set(h.players);
    const hGm      = new Set(h.gm);

    const sidebarTabs = scanSidebar();
    const detected = scanControls();
    const groups = new Map();
    const groupButtons = [];
    for (const e of detected) {
        if (e.key.startsWith("control:")) groupButtons.push(e);
        else { const g = e.group || "Autres"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); }
    }

    const subHeader = (title) => `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9a8b70;margin:8px 0 2px;">${_esc(title)}</div>`;
    const rows = (arr) => arr.map(e => rowHtml(e, hPlayers, hGm)).join("");

    const toolSections = [...groups.entries()]
        .map(([g, arr]) => subHeader(`Outils — ${g}`) + rows(arr)).join("");

    const content = `
        <div style="display:flex;flex-direction:column;max-height:60vh;overflow-y:auto;padding-right:4px;">
            <p style="margin:0 0 6px;font-size:.85em;color:#aaa;font-style:italic;">
                Coche pour masquer l'élément, colonne <b style="color:#8fd19e;">Joueurs</b> et/ou
                <b style="color:#e8cc6a;">GM</b>. Seuls les groupes/outils actuellement chargés sont
                listés — ouvre un groupe d'outils si tu ne le vois pas.
            </p>
            ${headerRow()}
            ${subHeader("Grandes zones")}
            ${rows(FIXED_TARGETS)}
            ${sidebarTabs.length ? subHeader("Barre latérale — onglets") + rows(sidebarTabs) : ""}
            ${groupButtons.length ? subHeader("Barre d'outils — groupes") + rows(groupButtons) : ""}
            ${toolSections}
        </div>`;

    await DialogV2.wait({
        window: { title: "Masquer des éléments d'interface", icon: "fa-solid fa-eye-slash" },
        position: { width: 520 },
        rejectClose: false,
        content,
        buttons: [
            {
                action: "save", default: true, label: "Appliquer", icon: '<i class="fa-solid fa-check"></i>',
                callback: async (ev, btn) => {
                    const root = btn.form ?? btn.closest?.(".application") ?? document;
                    const players = [...root.querySelectorAll('.scwm-uihide-cb[data-role="players"]')].filter(cb => cb.checked).map(cb => cb.value);
                    const gm      = [...root.querySelectorAll('.scwm-uihide-cb[data-role="gm"]')].filter(cb => cb.checked).map(cb => cb.value);
                    await game.settings.set(MOD, "hiddenUi", { players, gm });
                    applyUiHiding();
                    ui.notifications?.info("Masquage d'interface mis à jour.");
                }
            },
            { action: "reset", label: "Tout réafficher", icon: '<i class="fa-solid fa-eye"></i>',
              callback: async () => { await game.settings.set(MOD, "hiddenUi", { players: [], gm: [] }); applyUiHiding(); ui.notifications?.info("Interface réaffichée."); } },
            { action: "close", label: "Fermer", icon: '<i class="fa-solid fa-xmark"></i>', callback: () => {} }
        ]
    }).catch(() => {});
}

export function UiHideHooks() {
    Hooks.once("ready", () => applyUiHiding());
    Hooks.on("renderSceneControls", () => applyUiHiding());
    Hooks.on("renderHotbar", () => applyUiHiding());
    Hooks.on("renderPlayers", () => applyUiHiding());
}
