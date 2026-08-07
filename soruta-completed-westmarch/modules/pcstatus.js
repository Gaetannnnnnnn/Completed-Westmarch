// ============================================================
// pcstatus.js — Statut de disponibilité des PJ
//
// Affiche, à droite de chaque personnage dans le répertoire des Acteurs,
// un badge « Disponible » ou « En expédition ». Le statut est ENTIÈREMENT
// DÉDUIT des expéditions du personnage (flag "expeditions" du Carnet) :
//   - au moins une expédition ouverte (date de début, pas de date de fin)
//     → « En expédition »
//   - sinon → « Disponible »
// Aucune saisie manuelle, aucun stockage supplémentaire.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { getExpeditions } from "./carnet.js";

// Un PJ est « en expédition » s'il a au moins une expédition ouverte.
function isOnExpedition(actor) {
    try {
        return getExpeditions(actor).some(e => e && e.startDate && !e.endDate);
    } catch { return false; }
}

function statusFor(actor) {
    return isOnExpedition(actor)
        ? { key: "expedition", label: "En expédition", icon: "fa-person-hiking" }
        : { key: "available",  label: "Disponible",    icon: "fa-circle-check" };
}

// Construit le badge DOM.
function makeBadge(actor) {
    const s = statusFor(actor);
    const span = document.createElement("span");
    span.className = `scwm-pc-status scwm-pc-status-${s.key}`;
    span.title = s.label;
    span.innerHTML = `<i class="fa-solid ${s.icon}"></i><span class="scwm-pc-status-label">${s.label}</span>`;
    return span;
}

// Injecte le badge sur chaque ligne de PJ du répertoire des Acteurs.
function injectBadges(rootEl) {
    if (!game.settings.get(MOD, "enablePcStatus")) return;
    const items = rootEl.querySelectorAll("li.directory-item[data-entry-id], li.directory-item[data-document-id]");
    for (const li of items) {
        const id = li.dataset.entryId ?? li.dataset.documentId;
        const actor = game.actors?.get(id);
        if (!actor || actor.type !== "character") continue;

        // Nettoyage d'un éventuel badge précédent (re-render).
        li.querySelector(":scope > .scwm-pc-status")?.remove();

        const badge = makeBadge(actor);
        // Placé en fin de ligne ; le CSS le pousse à droite (margin-left:auto).
        const nameEl = li.querySelector(".entry-name, .document-name");
        (nameEl?.parentElement ?? li).appendChild(badge);
    }
}

export function PcStatusHooks() {
    // v13 : html peut être un HTMLElement (ApplicationV2) ou du jQuery.
    Hooks.on("renderActorDirectory", (app, html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (root) injectBadges(root);
    });

    // Rafraîchir le répertoire quand les expéditions d'un acteur changent.
    Hooks.on("updateActor", (actor, changes) => {
        if (!game.settings.get(MOD, "enablePcStatus")) return;
        const flags = changes?.flags?.[MOD];
        if (flags && Object.prototype.hasOwnProperty.call(flags, "expeditions")) {
            ui.actors?.render();
        }
    });
}
