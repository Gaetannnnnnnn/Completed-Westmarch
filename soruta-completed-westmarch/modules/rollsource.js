// ============================================================
// rollsource.js — Source des dégâts (v3)
//
// dnd5e étiquette déjà les termes du JET D'ATTAQUE (+7 Force, +6 Maîtrise…)
// dans sa décomposition native, mais PAS ceux des JETS DE DÉGÂTS. On comble ce
// manque : dans la formule d'un jet de dégâts, chaque dé reçoit son TYPE de
// dégâts (tranchant, feu…) et le bonus plat reçoit la CARACTÉRISTIQUE dont il
// vient (quand sa valeur correspond au modificateur de l'arme).
//
//   Ex. « 1d12 + 7 »  →  « 1d12 tranchant + 7 Force »
//       « 2d6 »       →  « 2d6 feu »
//
// On ne touche PAS au jet d'attaque (déjà étiqueté par dnd5e) ni au nom de
// l'objet (déjà affiché en en-tête de la carte). Reconstruction fiable à partir
// du type du jet (roll.options.type) et du modificateur de caractéristique de
// l'acteur. Limite : quand plusieurs effets empilent des dés dans un seul jet,
// le type reste correct mais on ne distingue pas l'aptitude d'origine.
//
// N'altère que l'affichage, jamais le résultat. © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const sourceActive = () => {
    try { return !!game.settings.get(MOD, "enableRollProvenance"); } catch { return false; }
};

function estOperateur(t) {
    if (t?.constructor?.name === "OperatorTerm") return true;
    const OT = foundry.dice?.terms?.OperatorTerm;
    return !!(OT && t instanceof OT);
}

function estDe(t) {
    if (t?.faces != null || t?.denomination != null) return true;
    if (/Die$/.test(t?.constructor?.name || "")) return true;
    return /^\s*\d*\s*[dD]\s*\d+/.test(t?.expression || "");
}

// Clé de caractéristique de l'objet à l'origine du jet (str, dex…).
function abilityDe(item) {
    return item?.abilityMod || item?.system?.ability || null;
}
function labelAbility(k) {
    const a = CONFIG?.DND5E?.abilities?.[k];
    return a?.label || a?.abbreviation || k || "";
}
function labelType(t) {
    const d = CONFIG?.DND5E?.damageTypes?.[t] || CONFIG?.DND5E?.healingTypes?.[t];
    return d?.label || t || "";
}

const tag = (txt) => txt ? `<span class="scwm-src-tag">${esc(txt)}</span>` : "";

// Reconstruit la formule d'un jet de DÉGÂTS avec les étiquettes de source.
function formuleDegats(roll, actor, abilityKey) {
    const typeLbl = roll?.options?.type ? labelType(roll.options.type) : "";
    const mod = (actor && abilityKey)
        ? Number(actor.system?.abilities?.[abilityKey]?.mod)
        : null;
    const bouts = [];
    for (const t of (roll?.terms ?? [])) {
        const expr = t?.expression ?? "";
        if (estOperateur(t)) { bouts.push(esc(expr)); continue; }
        if (estDe(t)) {
            bouts.push(esc(expr) + tag(typeLbl));                  // dé → type de dégâts
        } else if (mod != null && abilityKey && Number(expr) === mod) {
            bouts.push(esc(expr) + tag(labelAbility(abilityKey))); // bonus plat → caractéristique
        } else {
            bouts.push(esc(expr));                                  // bonus inconnu → nu
        }
    }
    return bouts.join("");
}

// Annote les jets de DÉGÂTS d'un message (laisse l'attaque à dnd5e). Idempotent.
function traiterMessage(message, el) {
    if (!message?.rolls?.length || !el) return;
    let item = null, actor = null;
    try { item = message.getAssociatedItem?.(); } catch (e) {}
    try { actor = message.getAssociatedActor?.(); } catch (e) {}
    const abilityKey = abilityDe(item);
    const blocs = el.querySelectorAll(".dice-roll");
    message.rolls.forEach((roll, i) => {
        if (!roll?.options?.type) return;                 // pas un jet de dégâts → on laisse dnd5e
        const f = blocs[i]?.querySelector?.(".dice-formula");
        if (f && !f.dataset.scwmSrc) {
            f.dataset.scwmSrc = "1";
            f.innerHTML = formuleDegats(roll, actor, abilityKey);
        }
    });
}

// Le contenu des cartes dnd5e/midi arrive APRÈS le rendu du message, d'où un
// MutationObserver sur le log plutôt que renderChatMessageHTML.
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
