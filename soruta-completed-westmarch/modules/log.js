// ============================================================
// log.js — Journal du module dans la console du navigateur (F12)
//
// Toutes les sorties du module passent par ici :
//   journal.debug(...)  : détails de fonctionnement, affichés SEULEMENT en
//                         mode verbeux (réglage « Mode verbeux », par joueur) ;
//   journal.info(...)   : informations utiles, mode verbeux seulement ;
//   journal.avert(...)  : un petit problème contourné (console seulement) ;
//   journal.erreur(...) : une vraie erreur ;
//   journal.critique(...) : une fonction cassée ou un conflit (un autre module
//                         ou une mise à jour de Foundry passe par-dessus).
// Erreurs et problèmes critiques s'affichent toujours dans la console avec la
// mention « → contacter le propriétaire du module », ET sont envoyés dans le
// log Discord (réglage « Problèmes du module ») avec la même mention.
//
// En plus, les erreurs non rattrapées venant des fichiers du module sont
// interceptées et réécrites au même format (voir surveillerErreurs).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const PREFIXE = "[Completed Westmarch]";
export const INVITATION = "https://discord.com/invite/sbHSVXDeMJ";
export const CONTACT = `→ contacter le propriétaire du module : ouvre un ticket sur le Discord Althéia (${INVITATION}) en copiant ce message, plutôt qu'un message privé.`;
const STYLE = "color:#c9a227;font-weight:bold;";

export function verbeux() {
    try { return game.settings.get(MOD, "verboseMode") === true; } catch { return false; }
}

// Retire un éventuel préfixe « [soruta-completed-westmarch] » déjà présent.
function sansPrefixe(args) {
    if (typeof args[0] === "string") {
        const s = args[0].replace(/^\s*\[(soruta-completed-westmarch|completed-westmarch|WestMarch|westmarch)\]\s*/i, "");
        return [s, ...args.slice(1)];
    }
    return args;
}

// ---- Relais des problèmes importants vers le log Discord -------------------
// discordlog.js branche ici sa fonction d'envoi (definirRelais). Seuls les
// vrais problèmes du module y partent : erreurs (journal.erreur), conflits /
// fonctions cassées (journal.critique) et erreurs non rattrapées.
let _relais = null;
export function definirRelais(fn) { _relais = typeof fn === "function" ? fn : null; }

// Derniers problèmes de la session (affichés par le diagnostic).
export const problemesRecents = [];
const _envoyes = new Map();          // message → heure d'envoi (anti-répétition)
let _nbEnvois = 0;
const MAX_ENVOIS = 15, REPETITION_MS = 10 * 60 * 1000;

function texteDe(a) {
    const morceaux = [], details = [];
    for (const x of a) {
        if (x instanceof Error) {
            morceaux.push(`${x.name}: ${x.message}`);
            const ligne = String(x.stack ?? "").split("\n").find(l => l.includes(`/modules/${MOD}/`));
            if (ligne) details.push(ligne.trim().replace(/^at\s+/, "").replace(/https?:\/\/[^/]+/, ""));
        } else if (x && typeof x === "object") {
            try { morceaux.push(JSON.stringify(x).slice(0, 200)); } catch { morceaux.push(String(x)); }
        } else morceaux.push(String(x));
    }
    return { texte: morceaux.join(" ").replace(/\s+/g, " ").trim(), detail: details.join(" | ") };
}

function signaler(niveau, a) {
    const { texte, detail } = texteDe(sansPrefixe(a));
    problemesRecents.unshift({ quand: new Date().toLocaleTimeString("fr-FR"), niveau, texte, detail });
    problemesRecents.length = Math.min(problemesRecents.length, 20);
    if (!_relais) return;
    const cle = texte.slice(0, 300), maintenant = Date.now();
    if (_nbEnvois >= MAX_ENVOIS || (_envoyes.get(cle) ?? 0) > maintenant - REPETITION_MS) return;
    _envoyes.set(cle, maintenant); _nbEnvois++;
    try { _relais({ niveau, texte, detail }); } catch { /* jamais de boucle d'erreur */ }
}

export const journal = {
    debug: (...a) => { if (verbeux()) console.debug(`%c${PREFIXE}`, STYLE, ...sansPrefixe(a)); },
    info:  (...a) => { if (verbeux()) console.info(`%c${PREFIXE}`, STYLE, ...sansPrefixe(a)); },
    // Problème contourné, sans gravité : console seulement.
    avert: (...a) => { console.warn(`%c${PREFIXE}`, STYLE, ...sansPrefixe(a)); },
    // Vraie erreur : console + log Discord avec la mention de contact.
    erreur: (...a) => { console.error(`%c${PREFIXE}`, STYLE, ...sansPrefixe(a), `\n${CONTACT}`); signaler("erreur", a); },
    // Fonction cassée / conflit (un autre module ou une mise à jour passe par-dessus) :
    // console + log Discord avec la mention de contact.
    critique: (...a) => { console.error(`%c${PREFIXE}`, STYLE, ...sansPrefixe(a), `\n${CONTACT}`); signaler("conflit", a); },
    // Sans relais Discord (utilisé par l'envoi Discord lui-même, pour éviter une boucle).
    erreurLocale: (...a) => { console.error(`%c${PREFIXE}`, STYLE, ...sansPrefixe(a), `\n${CONTACT}`); }
};

export function registerLogSettings() {
    game.settings.register(MOD, "verboseMode", {
        name: "Mode verbeux (journal détaillé)",
        hint: "Affiche dans la console du navigateur (F12) le détail de ce que fait le module. Utile pour signaler un problème. Les erreurs s'affichent toujours, même sans ce mode.",
        scope: "client", config: false, type: Boolean, default: false
    });
}

// Erreurs non rattrapées provenant des fichiers du module : réécrites au
// format du journal (avec la mention de contact). L'erreur d'origine reste
// affichée par le navigateur.
let _surveille = false;
export function surveillerErreurs() {
    if (_surveille) return;
    _surveille = true;
    const duModule = (pile) => typeof pile === "string" && pile.includes(`/modules/${MOD}/`);
    window.addEventListener("error", (ev) => {
        const pile = ev.error?.stack ?? ev.filename ?? "";
        if (duModule(pile) || duModule(ev.filename)) journal.erreur("Erreur inattendue :", ev.error ?? ev.message);
    });
    window.addEventListener("unhandledrejection", (ev) => {
        const r = ev.reason;
        if (duModule(r?.stack)) journal.erreur("Erreur inattendue (promesse) :", r);
    });
}
