// ============================================================
// creationlevel.js — Niveaux de création des personnages
//
// Le MJ définit une liste de niveaux proposés à la création (1, 3, 5…). Chaque
// niveau au-dessus du premier porte un critère de déblocage : il faut que le
// joueur possède déjà N personnage(s) — ses plus hauts niveaux — ayant atteint
// un certain niveau. À la création, le joueur choisit parmi les niveaux
// débloqués ; les autres apparaissent grisés avec leur critère.
//
// Au choix « niveau K » : la fiche reçoit l'XP du seuil de K (table dnd5e) et
// un drapeau creationLevel = K (plafond enregistré, vérifiable à la validation).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { tl } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Liste configurée : [{ level, nb, req }]. nb=0 → toujours disponible.
export function niveauxConfig() {
    let v;
    try { v = game.settings.get(MOD, "creationLevels"); } catch { v = null; }
    if (!Array.isArray(v) || !v.length) v = [{ level: 1, nb: 0, req: 0 }];
    return v.map(e => ({
        level: Math.max(1, Math.min(20, Number(e.level) || 1)),
        nb: Math.max(0, Number(e.nb) || 0),
        req: Math.max(1, Math.min(20, Number(e.req) || 1))
    })).sort((a, b) => a.level - b.level);
}

const niveauActeur = (a) => Number(a?.system?.details?.level) || 0;

function persosDe(userId) {
    const u = game.users?.get(userId);
    if (!u) return [];
    return (game.actors ?? []).filter(a => a.type === "character" && a.testUserPermission?.(u, "OWNER"));
}

// Niveaux débloqués pour un joueur : [{ level, nb, req, unlocked }].
// Critère « les plus hauts niveaux » : il suffit de compter les persos ≥ req.
export function niveauxDebloques(userId) {
    const persos = persosDe(userId);
    return niveauxConfig().map(e => {
        let unlocked = true;
        if (e.nb > 0) unlocked = persos.filter(a => niveauActeur(a) >= e.req).length >= e.nb;
        return { ...e, unlocked };
    });
}

export function critereTexte(e) {
    if (!e.nb) return tl("toujours disponible");
    return (e.nb === 1)
        ? tl("nécessite 1 personnage de niveau {0}", e.req)
        : tl("nécessite {0} personnages de niveau {1}", e.nb, e.req);
}

export function niveauMaxDebloque(userId) {
    return niveauxDebloques(userId).filter(e => e.unlocked).reduce((m, e) => Math.max(m, e.level), 1);
}

// Le niveau demandé est-il actuellement débloqué pour ce joueur ?
export function niveauAutorise(userId, level) {
    return niveauxDebloques(userId).some(e => e.level === Number(level) && e.unlocked);
}

// <select> pour la fenêtre de demande (verrouillés = option désactivée + critère).
export function selectNiveauHtml(userId) {
    const liste = niveauxDebloques(userId);
    const premierDispo = liste.find(e => e.unlocked)?.level;
    const options = liste.map(e => {
        const lbl = e.unlocked ? tl("Niveau {0}", e.level) : `${tl("Niveau {0}", e.level)} — ${critereTexte(e)}`;
        const sel = e.unlocked && e.level === premierDispo ? "selected" : "";
        return `<option value="${e.level}" ${e.unlocked ? "" : "disabled"} ${sel}>${esc(lbl)}</option>`;
    }).join("");
    return `<div class="form-group"><label>${tl("Niveau de création")}</label>
        <select name="cv-level">${options}</select></div>`;
}

// XP du seuil d'un niveau (table dnd5e, repli sur la table standard 5e).
export function xpPourNiveau(level) {
    const t = CONFIG?.DND5E?.CHARACTER_EXP_LEVELS;
    const i = Math.max(0, Math.min(19, Number(level) - 1));
    if (Array.isArray(t) && t[i] != null) return Number(t[i]) || 0;
    const std = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
        85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
    return std[i] || 0;
}

// Fenêtre MJ : configuration des niveaux de création (lignes niveau / critère).
export async function ouvrirConfigNiveaux() {
    if (!game.user.isGM) return;
    const uid = foundry.utils.randomID();
    const ligne = (e = { level: 1, nb: 0, req: 1 }) => `
        <div class="scwm-cl-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0;">
            <label style="margin:0;">${tl("Niveau")} <input type="number" min="1" max="20" class="scwm-cl-level" value="${e.level}" style="width:4em;"></label>
            <span style="opacity:.6;">${tl("si")}</span>
            <input type="number" min="0" max="20" class="scwm-cl-nb" value="${e.nb}" style="width:4em;" title="${tl("Nombre de personnages requis (0 = toujours disponible)")}">
            <span>${tl("perso(s) ≥ niv.")}</span>
            <input type="number" min="1" max="20" class="scwm-cl-req" value="${e.req}" style="width:4em;">
            <button type="button" class="scwm-cl-del" title="${tl("Supprimer")}" style="margin-left:auto;"><i class="fa-solid fa-trash"></i></button>
        </div>`;
    const content = `<div id="${uid}" class="scwm-cl-config">
        <p style="opacity:.8;font-size:.9em;">${tl("Niveaux proposés à la création. Pour un niveau conditionnel, indiquez combien de personnages du joueur (ses plus hauts niveaux) doivent atteindre quel niveau. « 0 perso » = toujours disponible.")}</p>
        <div class="scwm-cl-rows">${niveauxConfig().map(ligne).join("")}</div>
        <button type="button" class="scwm-cl-add" style="margin-top:8px;"><i class="fa-solid fa-plus"></i> ${tl("Ajouter un niveau")}</button>
    </div>`;

    const res = await foundry.applications.api.DialogV2.wait({
        window: { title: tl("Niveaux de création"), icon: "fa-solid fa-ranking-star" },
        content,
        render: (ev, dlg) => {
            try {
                const root = dlg?.element ?? dlg;
                const rows = root.querySelector(".scwm-cl-rows");
                root.querySelector(".scwm-cl-add")?.addEventListener("click", () => rows?.insertAdjacentHTML("beforeend", ligne()));
                root.addEventListener("click", (e) => { const b = e.target.closest?.(".scwm-cl-del"); if (b) b.closest(".scwm-cl-row")?.remove(); });
            } catch (e) {}
        },
        buttons: [
            {
                action: "save", label: tl("Enregistrer"), icon: "fa-solid fa-floppy-disk", default: true,
                callback: (ev, btn) => {
                    const root = btn.form ?? btn.closest(".window-content") ?? document.getElementById(uid);
                    return [...root.querySelectorAll(".scwm-cl-row")].map(r => ({
                        level: Math.max(1, Math.min(20, Number(r.querySelector(".scwm-cl-level")?.value) || 1)),
                        nb: Math.max(0, Number(r.querySelector(".scwm-cl-nb")?.value) || 0),
                        req: Math.max(1, Math.min(20, Number(r.querySelector(".scwm-cl-req")?.value) || 1))
                    }));
                }
            },
            { action: "cancel", label: tl("Annuler"), icon: "fa-solid fa-xmark" }
        ],
        rejectClose: false
    }).catch(() => null);

    if (!Array.isArray(res)) return;
    const map = new Map();
    for (const e of res) map.set(e.level, e);           // dédoublonne par niveau
    const arr = [...map.values()].sort((a, b) => a.level - b.level);
    if (!arr.length) arr.push({ level: 1, nb: 0, req: 1 });
    await game.settings.set(MOD, "creationLevels", arr);
    ui.notifications?.info(tl("Niveaux de création enregistrés."));
}
