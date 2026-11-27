// ============================================================
// descenrich.js — Mise en valeur des descriptions (carte de chat)
//
// Dans le « pavé » de description d'un sort/objet affiché dans le chat :
//   • colore les TYPES DE DÉGÂTS (feu orange, foudre bleu électrique,
//     poison vert…), en FR et EN ;
//   • met en GRAS les mots-clés (jet d'attaque, jet de sauvegarde, test de
//     caractéristique…) et les DÉS (1d8, 2d6…).
//
// Travaille UNIQUEMENT sur les nœuds de texte, en évitant les liens, les
// boutons de jet, les décompositions de dés et les en-têtes : le HTML
// d'origine n'est jamais cassé, et rien de ce qui est cliquable n'est touché.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const actif = () => { try { return !!game.settings.get(MOD, "enableDescHighlight"); } catch { return false; } };

// Mot (FR/EN) → type de dégâts canonique (classe CSS).
const DMG = {
    fire: "fire", feu: "fire",
    cold: "cold", froid: "cold",
    lightning: "lightning", foudre: "lightning",
    thunder: "thunder", tonnerre: "thunder",
    acid: "acid", acide: "acid",
    poison: "poison",
    necrotic: "necrotic", "nécrotique": "necrotic", necrotique: "necrotic",
    radiant: "radiant",
    psychic: "psychic", psychique: "psychic",
    bludgeoning: "phys", contondant: "phys",
    piercing: "phys", perforant: "phys",
    slashing: "phys", tranchant: "phys"
    // « force » volontairement exclu : trop ambigu avec la caractéristique Force.
};

const DMG_ALT = Object.keys(DMG).join("|");
// Un seul passage : dés | mots-clés | types de dégâts. Frontières « Unicode »
// (lettres accentuées comprises) via lookbehind/lookahead.
const RE = new RegExp(
    "(?<dice>(?<![\\p{L}\\p{N}])\\d+\\s?[dD]\\s?\\d+(?![\\p{L}\\p{N}]))"
    + "|(?<kw>(?<![\\p{L}])(?:jet\\s+d['’]attaque|jets?\\s+de\\s+sauvegarde|jet\\s+de\\s+caract[ée]ristique|attack\\s+rolls?|saving\\s+throws?|ability\\s+checks?)(?![\\p{L}]))"
    + "|(?<dmg>(?<![\\p{L}])(?:" + DMG_ALT + ")(?![\\p{L}]))",
    "giu"
);

const SKIP_TAG = new Set(["A", "BUTTON", "CODE", "KBD", "SELECT", "INPUT", "TEXTAREA", "H1", "H2", "H3", "H4", "H5"]);
const SKIP_CLASS = ["card-header", "dice-roll", "dice-formula", "dice-tooltip", "dice-result", "inline-roll", "scwm-dmg", "scwm-kw"];

function exclu(node, root) {
    let p = node.parentElement;
    const stop = root.parentElement;
    while (p && p !== stop) {
        if (SKIP_TAG.has(p.tagName)) return true;
        if (p.dataset && p.dataset.action) return true;
        const cl = p.classList;
        if (cl && SKIP_CLASS.some(c => cl.contains(c))) return true;
        p = p.parentElement;
    }
    return false;
}

function traiter(tn) {
    const txt = tn.nodeValue;
    RE.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = RE.exec(txt))) {
        frag ??= document.createDocumentFragment();
        if (m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
        const span = document.createElement("span");
        span.textContent = m[0];
        if (m.groups.dmg) span.className = "scwm-dmg scwm-dmg-" + (DMG[m[0].toLowerCase()] ?? "phys");
        else span.className = "scwm-kw";   // dés + mots-clés
        frag.appendChild(span);
        last = m.index + m[0].length;
        if (RE.lastIndex === m.index) RE.lastIndex++;   // garde anti-boucle
    }
    if (frag) {
        if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
        tn.parentNode.replaceChild(frag, tn);
    }
}

function enrichir(card) {
    if (card.dataset.scwmEnriched) return;
    card.dataset.scwmEnriched = "1";
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() && !exclu(n, card))
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const tn of nodes) traiter(tn);
}

// Le contenu des cartes dnd5e/midi arrive APRÈS le rendu du message, d'où un
// MutationObserver sur le log (comme chat.js) plutôt que renderChatMessageHTML.
let _root = null, _obs = null, _planif = false;
function traiterTout() {
    if (!actif()) return;
    (_root ?? document).querySelectorAll?.(".chat-card").forEach(enrichir);
}
function planifier() {
    if (_planif) return; _planif = true;
    requestAnimationFrame(() => { _planif = false; try { traiterTout(); } catch (e) {} });
}
export const balayerDescriptions = () => { try { traiterTout(); } catch (e) {} };

function observer(root) {
    if (!root) return;
    _root = root;
    traiterTout();
    if (_obs) return;
    _obs = new MutationObserver(() => { if (actif()) planifier(); });
    _obs.observe(root, { childList: true, subtree: true });
}

export function DescEnrichHooks() {
    Hooks.on("renderChatLog", (log, html) => {
        try { observer(html instanceof HTMLElement ? html : html?.[0]); } catch (e) {}
    });
    const log = document.querySelector("#chat-log, .chat-log");
    if (log) observer(log);
}
