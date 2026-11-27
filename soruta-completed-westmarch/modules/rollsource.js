// ============================================================
// rollsource.js — Provenance des termes d'un jet au survol (v1)
//
// Dans la décomposition d'un jet affichée dans le chat (ex. « 1d20 + 3 + 2 »),
// chaque bonus/dé devient survolable : l'info-bulle montre sa PROVENANCE
// quand dnd5e l'a renseignée dans le « flavor » du terme (caractéristique,
// maîtrise, type de dégâts…).
//
// v1 : on exploite uniquement les flavors déjà présents (robuste, aucune
// dépendance aux entrailles de dnd5e). Les termes non étiquetés (dés, modif
// de dégâts…) restent nus — ils seront enrichis en v2 via les hooks de jet.
// On ne modifie QUE l'affichage de la formule, jamais le résultat du jet.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const provenanceActive = () => {
    try { return !!game.settings.get(MOD, "enableRollProvenance"); } catch { return false; }
};

function estOperateur(t) {
    if (t?.constructor?.name === "OperatorTerm") return true;
    const OT = foundry.dice?.terms?.OperatorTerm;
    return !!(OT && t instanceof OT);
}

// Reconstruit la formule en enveloppant chaque terme non-opérateur d'un span
// porteur d'une info-bulle (son flavor). Les nombres/dés affichés ne changent pas.
function formuleAvecProvenance(roll) {
    const bouts = [];
    for (const t of (roll?.terms ?? [])) {
        const expr = t?.expression ?? "";
        if (estOperateur(t)) { bouts.push(esc(expr)); continue; }
        const flavor = t?.flavor || t?.options?.flavor || "";
        bouts.push(flavor
            ? `<span class="scwm-rs" data-tooltip="${esc(flavor)}">${esc(expr)}</span>`
            : `<span class="scwm-rs scwm-rs-nu">${esc(expr)}</span>`);
    }
    return bouts.join(" ");
}

// Applique la provenance sur un message (idempotent via data-scwm-rs).
function traiterMessage(message, el) {
    if (!message?.rolls?.length || !el) return;
    const blocs = el.querySelectorAll(".dice-roll");
    message.rolls.forEach((roll, i) => {
        const f = blocs[i]?.querySelector?.(".dice-formula");
        if (f && !f.dataset.scwmRs) { f.dataset.scwmRs = "1"; f.innerHTML = formuleAvecProvenance(roll); }
    });
}

// Balaye tout le log (le contenu des cartes dnd5e/midi arrive APRÈS le rendu
// du message, d'où l'observer ci-dessous plutôt que renderChatMessageHTML).
let _root = null, _obs = null, _planif = false;
function traiterTout() {
    if (!provenanceActive()) return;
    const root = _root ?? document.querySelector("#chat-log, .chat-log");
    root?.querySelectorAll?.(".chat-message").forEach(el => {
        const m = game.messages?.get(el.dataset?.messageId);
        if (m) traiterMessage(m, el);
    });
}
function planifier() {
    if (_planif) return; _planif = true;
    requestAnimationFrame(() => { _planif = false; try { traiterTout(); } catch (e) {} });
}
export const balayerProvenance = () => { try { traiterTout(); } catch (e) {} };

function observer(root) {
    if (!root) return;
    _root = root;
    traiterTout();
    if (_obs) return;
    _obs = new MutationObserver(() => { if (provenanceActive()) planifier(); });
    _obs.observe(root, { childList: true, subtree: true });
}

export function RollSourceHooks() {
    Hooks.on("renderChatLog", (log, html) => {
        try { observer(html instanceof HTMLElement ? html : html?.[0]); } catch (e) {}
    });
    const log = document.querySelector("#chat-log, .chat-log");
    if (log) observer(log);           // log déjà rendu (activation à chaud)
}
