// ============================================================
// descenrich.js — Mise en valeur des descriptions (carte de chat)
//
// Dans le « pavé » de description d'un sort/objet affiché dans le chat :
//   • colore les TYPES DE DÉGÂTS (feu, foudre, poison…), FR et EN, avec un
//     léger halo dégradé dans leur propre couleur ;
//   • souligne les TERMES DE JET (jet d'attaque au corps à corps / à distance,
//     jet de sauvegarde, jet/test de caractéristique, et équivalents anglais).
//
// Travaille UNIQUEMENT sur les nœuds de texte. Les types de dégâts sont souvent
// rendus par Plutonium (5etools) dans des liens de jet cliquables : on colore
// le mot sans toucher au clic (le jet lit sa formule dans les attributs). On
// évite boutons, décompositions de dés et en-têtes : le HTML n'est jamais cassé.
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
// Deux mises en valeur : les TYPES DE DÉGÂTS (couleur + halo) et les TERMES DE
// JET (soulignés) — jet d'attaque (corps à corps / à distance), jet de
// sauvegarde, jet/test de caractéristique, et leurs équivalents anglais.
// Frontières « Unicode » (lettres accentuées comprises) via lookbehind/lookahead.
const ABILITIES = "Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma"
    + "|Force|Dextérité|Sagesse|Charisme";   // Constitution/Intelligence communs
const KW_ALT =
    "jets?\\s+d['’]attaque(?:\\s+au\\s+corps\\s+à\\s+corps|\\s+à\\s+distance)?"
    + "|jets?\\s+de\\s+sauvegarde(?:\\s+de\\s+(?:" + ABILITIES + "))?"   // FR : carac après
    + "|(?:jets?|tests?)\\s+de\\s+caract[ée]ristique"
    + "|(?:melee\\s+|ranged\\s+)?attack\\s+rolls?"
    + "|(?:(?:" + ABILITIES + ")\\s+)?saving\\s+throws?"               // EN : carac avant
    + "|ability\\s+checks?";
const RE = new RegExp(
    "(?<kw>(?<![\\p{L}])(?:" + KW_ALT + ")(?![\\p{L}]))"
    + "|(?<dmg>(?<![\\p{L}])(?:" + DMG_ALT + ")(?![\\p{L}]))",
    "giu"
);

const SKIP_TAG = new Set(["BUTTON", "CODE", "KBD", "SELECT", "INPUT", "TEXTAREA", "H1", "H2", "H3", "H4", "H5"]);
// On n'exclut PAS les <a> : les types de dégâts vivent souvent dans des liens
// de jet 5etools (« a.roll-link-group ») — colorer le mot ne casse pas le clic.
const SKIP_CLASS = ["card-header", "dice-roll", "dice-formula", "dice-tooltip", "dice-result", "inline-roll", "scwm-dmg", "scwm-kw"];

function exclu(node, root) {
    let p = node.parentElement;
    const stop = root.parentElement;
    while (p && p !== stop) {
        if (SKIP_TAG.has(p.tagName)) return true;
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
        else span.className = "scwm-kw";   // terme de jet → souligné
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
    rattraperPrefixes(card);
}

// Quand Plutonium (5etools) rend « attack roll » ou « saving throw » dans un
// LIEN séparé, le mot qui le qualifie (melee/ranged, ou la caractéristique) est
// dans le nœud de texte voisin : on le rattache au soulignement.
const RATTRAP = [
    { term: /^attack\s+rolls?$/i, prefix: new RegExp("(?:melee|ranged|corps\\s+à\\s+corps|à\\s+distance)\\s*$", "iu") },
    { term: /^saving\s+throws?$/i, prefix: new RegExp("(?:" + ABILITIES + ")\\s*$", "iu") }
];

// Dernier nœud de texte situé AVANT `el` dans l'ordre du document, sous `root`.
function texteAmont(el, root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let prev = null, n;
    while ((n = tw.nextNode())) {
        const pos = el.compareDocumentPosition(n);
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) prev = n;
        else if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) continue;   // texte interne à el
        else break;                                                     // on a dépassé el
    }
    return prev;
}

function rattraperPrefixes(card) {
    card.querySelectorAll("span.scwm-kw").forEach(span => {
        const t = (span.textContent || "").trim();
        const rule = RATTRAP.find(r => r.term.test(t));
        if (!rule) return;
        const tn = texteAmont(span, card);
        if (!tn) return;
        const mm = tn.nodeValue.match(rule.prefix);
        if (!mm) return;
        const frag = document.createDocumentFragment();
        if (mm.index > 0) frag.appendChild(document.createTextNode(tn.nodeValue.slice(0, mm.index)));
        const s = document.createElement("span");
        s.className = "scwm-kw";
        s.textContent = mm[0];
        frag.appendChild(s);
        tn.parentNode.replaceChild(frag, tn);
    });
}

// Le contenu des cartes dnd5e/midi arrive APRÈS le rendu du message, et la
// DESCRIPTION n'est injectée dans .collapsible-content qu'au DÉPLIAGE. D'où un
// MutationObserver sur le log : à chaque changement dans une carte, on remet
// cette carte à « non traitée » pour la ré-enrichir (ré-enrichir est sans
// risque — le texte déjà coloré est dans des spans scwm-* exclus).
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

// Remet à zéro le garde-fou des cartes touchées par une série de mutations.
function invaliderCartes(records) {
    for (const r of records) {
        const t = r.target;
        const base = t?.nodeType === 1 ? t : t?.parentElement;
        const card = base?.closest?.(".chat-card");
        if (card && card.dataset.scwmEnriched) delete card.dataset.scwmEnriched;
    }
}

function observer(root) {
    if (!root) return;
    _root = root;
    traiterTout();
    if (_obs) return;
    _obs = new MutationObserver((records) => {
        if (!actif()) return;
        invaliderCartes(records);   // le dépliage injecte la description → ré-enrichir
        planifier();
    });
    _obs.observe(root, { childList: true, subtree: true });
}

export function DescEnrichHooks() {
    Hooks.on("renderChatLog", (log, html) => {
        try { observer(html instanceof HTMLElement ? html : html?.[0]); } catch (e) {}
    });
    const log = document.querySelector("#chat-log, .chat-log");
    if (log) observer(log);
}
