import { MOD } from "./const.js";
import { tl } from "./i18n.js";
// ============================================================
// alert.js — Don « Alert » (Vigilant) : échange d'initiative
//
// Règle (PHB 2024, Alert → Initiative Swap) : juste après avoir lancé
// l'initiative, vous pouvez échanger votre initiative avec celle d'un allié
// consentant du même combat. Impossible si vous ou l'allié êtes neutralisé
// (Incapacitated).
//
// Mise en œuvre : pour les comptes MJ, un bouton « échanger » apparaît dans
// le suivi de combat sur la ligne de chaque personnage de joueur qui a le don Alert et
// une initiative. Le MJ choisit un autre joueur du combat (initiative déjà
// lancée, non neutralisé) ; les deux initiatives sont échangées et un
// message l'annonce dans le chat. Le bouton reste disponible ensuite (grisé)
// en cas d'erreur, avec confirmation.
//
// Don reconnu : objet « feat » d'identifiant « alert », ou nommé « Alert » /
// « Vigilant ». Réglage : enableAlertSwap (Modifications ciblées → Features).
// © 2026 Soruta.
// ============================================================

const actif = () => { try { return game.settings.get(MOD, "enableAlertSwap") === true; } catch { return false; } };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FLAG = "alertSwapUsed";

// États qui rendent neutralisé (Incapacitated) dans dnd5e.
const NEUTRALISANTS = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];

export function aLeDonAlert(actor) {
    return !!actor?.items?.some?.(i => i.type === "feat" && (
        i.system?.identifier === "alert" || /^(alert|vigilant)$/i.test(String(i.name ?? "").trim())));
}
export function estNeutralise(actor) {
    const st = actor?.statuses;
    return !!st && NEUTRALISANTS.some(s => st.has?.(s));
}

// Combat parent d'un combattant (plusieurs combats peuvent tourner en parallèle).
function combatDe(combatantId) {
    for (const c of game.combats?.combats ?? game.combats ?? []) if (c.combatants?.get?.(combatantId)) return c;
    return null;
}

// Partenaires possibles : les autres JOUEURS du même combat (combattants
// dont l'acteur appartient à un joueur), initiative déjà lancée.
const estJoueur = (c) => !!(c.actor?.hasPlayerOwner ?? c.hasPlayer);
export function alliesPossibles(combat, source) {
    return [...(combat?.combatants ?? [])].filter(c =>
        c.id !== source.id && estJoueur(c) && c.initiative !== null && c.initiative !== undefined);
}

export async function echangerInitiative(combat, a, b) {
    const ia = a.initiative, ib = b.initiative;
    await combat.updateEmbeddedDocuments("Combatant", [
        { _id: a.id, initiative: ib, [`flags.${MOD}.${FLAG}`]: true },
        { _id: b.id, initiative: ia }
    ]);
    try {
        await ChatMessage.create({
            speaker: { alias: tl("Suivi de combat") },
            content: `${tl("<i class=\"fa-solid fa-right-left\"></i> <strong>{0}</strong> (Vigilant) échange son initiative avec <strong>{1}</strong> : {2} ↔ {3}.", esc(a.name), esc(b.name), ia, ib)}`
        });
    } catch {}
}

async function ouvrirEchange(combatantId) {
    const combat = combatDe(combatantId);
    const source = combat?.combatants.get(combatantId);
    if (!combat || !source) return;
    if (source.initiative === null || source.initiative === undefined) {
        ui.notifications?.warn(tl("{0} n'a pas encore lancé son initiative.", source.name)); return;
    }
    if (estNeutralise(source.actor)) {
        ui.notifications?.warn(tl("{0} est neutralisé : l'échange d'initiative est impossible.", source.name)); return;
    }
    if (source.getFlag?.(MOD, FLAG)) {
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: tl("Échange d'initiative") },
            content: `<p>${tl("{0} a déjà échangé son initiative dans ce combat. Échanger à nouveau ?", esc(source.name))}</p>`
        });
        if (!ok) return;
    }
    const allies = alliesPossibles(combat, source);
    if (!allies.length) { ui.notifications?.info(tl("Aucun autre joueur avec une initiative dans ce combat.")); return; }
    const uid = `scwm-alert-${source.id}`;
    const lignes = allies.map(c => {
        const neutr = estNeutralise(c.actor);
        return `<label style="display:flex;align-items:center;gap:8px;padding:3px 0;${neutr ? "opacity:.45;" : "cursor:pointer;"}">
            <input type="radio" name="allie" value="${c.id}" ${neutr ? "disabled" : ""}>
            <img src="${esc(c.img ?? c.token?.texture?.src ?? "icons/svg/mystery-man.svg")}" style="width:28px;height:28px;border:none;object-fit:cover;">
            <span style="flex:1;">${esc(c.name)}${neutr ? ` ${tl("<em>(neutralisé)</em>")}` : ""}</span>
            <strong>${c.initiative}</strong></label>`;
    }).join("");
    let choisi = null;
    await foundry.applications.api.DialogV2.wait({
        window: { title: `Vigilant — ${source.name} (initiative ${source.initiative})`, icon: "fa-solid fa-right-left" },
        position: { width: 380 },
        rejectClose: false,
        content: `<div id="${uid}"><p style="margin:0 0 6px;">${tl("Échanger l'initiative de <strong>{0}</strong> avec :", esc(source.name))}</p>${lignes}</div>`,
        buttons: [
            { action: "ok", label: tl("Échanger"), icon: "fa-solid fa-right-left", default: true,
              callback: () => { choisi = document.querySelector(`#${uid} input[name="allie"]:checked`)?.value ?? null; } },
            { action: "cancel", label: tl("Annuler"), icon: "fa-solid fa-xmark" }
        ]
    });
    const cible = choisi ? combat.combatants.get(choisi) : null;
    if (cible) await echangerInitiative(combat, source, cible);
}

export function AlertHooks() {
    Hooks.on("renderCombatTracker", (app, html) => {
        if (!game.user?.isGM || !actif()) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;
        root.querySelectorAll("li.combatant[data-combatant-id]").forEach(li => {
            const id = li.dataset.combatantId;
            const c = combatDe(id)?.combatants.get(id);
            if (!c || !estJoueur(c) || !aLeDonAlert(c.actor) || c.initiative === null || c.initiative === undefined) return;
            if (li.querySelector(".scwm-alert-swap")) return;
            const utilise = !!c.getFlag?.(MOD, FLAG);
            const btn = document.createElement("a");
            btn.className = "combatant-control scwm-alert-swap";
            btn.dataset.tooltip = utilise ? tl("Vigilant : initiative déjà échangée (cliquer pour échanger à nouveau)") : tl("Vigilant : échanger l'initiative avec un autre joueur");
            btn.setAttribute("aria-label", tl("Échanger l'initiative"));
            btn.innerHTML = `<i class="fa-solid fa-right-left"></i>`;
            btn.style.cssText = `color:${utilise ? "#888" : "#e0b84a"};${utilise ? "opacity:.6;" : ""}margin-right:2px;cursor:pointer;`;
            btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); ouvrirEchange(id); });
            btn.addEventListener("dblclick", (ev) => ev.stopPropagation());
            const hote = li.querySelector(".combatant-controls") ?? li.querySelector(".token-initiative");
            if (!hote) return;
            if (hote.classList.contains("token-initiative")) hote.prepend(btn); else hote.appendChild(btn);
        });
    });
}
