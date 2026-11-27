// ============================================================
// rollsource.js — Source d'un jet (v2)
//
// Sous chaque bloc de dés d'une carte de chat, un petit libellé indique DE QUOI
// vient le jet : l'arme, le sort ou l'aptitude qui l'a déclenché (image + nom).
// La décomposition des bonus (caractéristique, maîtrise…) est déjà fournie
// nativement par dnd5e, donc on ne double plus avec un survol.
//
// Source fiable : message.getAssociatedItem() — l'objet à l'origine du jet.
//   • Un même message peut porter plusieurs jets (attaque + dégâts tranchants +
//     dégâts de feu d'une arme à propriété) : ils partagent le même objet source.
//   • On ne peut PAS attribuer un dé isolé à une aptitude différente quand
//     plusieurs effets empilent leurs dés dans un seul jet (le système fusionne
//     sans conserver l'origine dé par dé). On étiquette donc au niveau du jet.
//   • Un jet sans objet (sauvegarde ou test de caractéristique brut) n'a pas de
//     source : aucun libellé n'est ajouté.
//
// N'altère que l'affichage, jamais le résultat. © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { tl } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const sourceActive = () => {
    try { return !!game.settings.get(MOD, "enableRollProvenance"); } catch { return false; }
};

// Icône de repli selon le type d'objet dnd5e (si l'objet n'a pas d'image).
function iconeType(type) {
    const map = {
        weapon: "fa-gavel", spell: "fa-wand-magic-sparkles", feat: "fa-star",
        consumable: "fa-flask", equipment: "fa-shield-halved", tool: "fa-screwdriver-wrench"
    };
    return `<i class="fa-solid ${map[type] || "fa-dice-d20"} scwm-src-ic"></i>`;
}

// Libellé source : vignette (image de l'objet) + nom.
function tagSource(item) {
    const nom = esc(item?.name || "");
    if (!nom) return "";
    const vignette = item?.img
        ? `<img class="scwm-src-img" src="${esc(item.img)}" alt="">`
        : iconeType(item?.type);
    return `<div class="scwm-src" data-tooltip="${esc(tl("Source du jet"))}">${vignette}<span>${nom}</span></div>`;
}

// Étiquette chaque bloc de dés d'un message avec sa source (idempotent).
function traiterMessage(message, el) {
    if (!message?.rolls?.length || !el) return;
    let item = null;
    try { item = message.getAssociatedItem?.(); } catch (e) { item = null; }
    if (!item) return;                       // jet sans objet source → rien
    const html = tagSource(item);
    if (!html) return;
    el.querySelectorAll(".dice-roll").forEach(bloc => {
        if (bloc.dataset.scwmSrc) return;
        const f = bloc.querySelector(".dice-formula");
        if (!f) return;
        bloc.dataset.scwmSrc = "1";
        f.insertAdjacentHTML("afterend", html);
    });
}

// Balaye tout le log (le contenu des cartes dnd5e/midi arrive APRÈS le rendu
// du message, d'où l'observer plutôt que renderChatMessageHTML).
let _root = null, _obs = null, _planif = false;
function traiterTout() {
    if (!sourceActive()) return;
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
    _obs = new MutationObserver(() => { if (sourceActive()) planifier(); });
    _obs.observe(root, { childList: true, subtree: true });
}

export function RollSourceHooks() {
    Hooks.on("renderChatLog", (log, html) => {
        try { observer(html instanceof HTMLElement ? html : html?.[0]); } catch (e) {}
    });
    const log = document.querySelector("#chat-log, .chat-log");
    if (log) observer(log);           // log déjà rendu (activation à chaud)
}
