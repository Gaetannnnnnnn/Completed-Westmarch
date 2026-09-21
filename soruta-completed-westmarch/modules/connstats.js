// ============================================================
// connstats.js — Fenêtre d'infos de connexion (Toolkit)
//
// Réglage "enableConnStats" : au chargement du monde, affiche en haut
// au centre de l'écran une petite fenêtre indiquant :
//   - le temps de connexion / chargement (page → hook "ready") ;
//   - le nombre de modules actifs ("paquets" chargés) ;
//   - le nombre d'assets et de documents chargés ;
//   - la durée MOYENNE de connexion (historique local) ;
//   - le TEMPS TOTAL cumulé passé sur le serveur (temps de jeu).
//
// Ces infos sont aussi consultables À TOUT MOMENT via le bouton
// « Infos de connexion » dans les réglages du module (visible par tous
// les joueurs). Les données sont stockées par client (scope "client").
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const HISTORY_MAX = 20;   // nombre de sessions gardées pour la moyenne

// État de session (module-level) pour un recalcul à la demande.
let _loadMs   = 0;
let _history  = [];
let _totalMs  = 0;   // total cumulé stocké (hors session en cours)
let _lastTick = 0;   // horodatage du dernier flush (0 = pas encore démarré)

export function ConnStatsHooks() {
    // Bouton « Infos de connexion » dans les réglages — visible par TOUS
    // (seulement si la fonctionnalité est activée : sinon rien à afficher).
    if (game.settings.get(MOD, "enableConnStats")) registerConnStatsMenu();

    Hooks.once("ready", () => {
        if (!game.settings.get(MOD, "enableConnStats")) return;

        // performance.now() = ms depuis le début du chargement de la page →
        // bonne mesure du temps de connexion + chargement jusqu'à "ready".
        _loadMs = Math.round(performance.now());

        // Historique local pour la moyenne (on garde les N dernières).
        let history = game.settings.get(MOD, "connStatsHistory");
        if (!Array.isArray(history)) history = [];
        history = [...history, _loadMs].slice(-HISTORY_MAX);
        _history = history;
        game.settings.set(MOD, "connStatsHistory", history);

        // Temps TOTAL cumulé passé connecté (temps de jeu), par client. On
        // accumule dans un réglage client (localStorage) toutes les 30 s + à la
        // fermeture de l'onglet, pour ne rien perdre même en fermeture brutale.
        _totalMs  = Number(game.settings.get(MOD, "connStatsTotalMs")) || 0;
        _lastTick = Date.now();
        const flushTotal = () => {
            const now = Date.now();
            _totalMs += now - _lastTick;
            _lastTick = now;
            try { game.settings.set(MOD, "connStatsTotalMs", _totalMs); } catch (e) {}
        };
        const ticker = setInterval(flushTotal, 30000);
        window.addEventListener("beforeunload", () => { clearInterval(ticker); flushTotal(); });

        renderConnStats(computeConnStats());
    });
}

// Rassemble les valeurs courantes (recalculées à la volée).
function computeConnStats() {
    const activeModules = game.modules.filter(m => m.active).length;

    let assetCount = 0;
    try { assetCount = performance.getEntriesByType("resource").length; } catch (e) {}

    const DOC_EXCLUDE = new Set(["ChatMessage", "Setting", "User", "Folder", "Combat"]);
    let docCount = 0;
    try {
        for (const c of game.collections) {
            if (DOC_EXCLUDE.has(c.documentName)) continue;
            docCount += c.size;
        }
    } catch (e) {}

    const avgMs = _history.length
        ? Math.round(_history.reduce((a, b) => a + b, 0) / _history.length)
        : _loadMs;

    // Total = cumulé stocké + session en cours (si démarrée).
    const totalMs = _totalMs + (_lastTick ? Date.now() - _lastTick : 0);

    return { loadMs: _loadMs, avgMs, activeModules, assetCount, docCount, samples: _history.length, totalMs };
}

// Ouvre (ou ré-ouvre) la fenêtre d'infos — utilisé par le bouton des réglages.
export function openConnStats() {
    renderConnStats(computeConnStats(), { persistent: true });
}

function registerConnStatsMenu() {
    try {
        game.settings.registerMenu(MOD, "menu-connstats", {
            name:  "Infos de connexion",
            label: "Afficher",
            hint:  "Affiche le temps de chargement, les modules actifs, la moyenne et le temps total passé sur le serveur.",
            icon:  "fas fa-plug",
            type:  class extends foundry.applications.api.ApplicationV2 {
                static DEFAULT_OPTIONS = { id: "scwm-menu-connstats", window: { title: "Infos de connexion" } };
                async render() { openConnStats(); return this; }
                async close()  { return this; }
            },
            restricted: false   // visible par tout le monde (joueurs inclus)
        });
    } catch (e) {
        console.warn(`[${MOD}] registerMenu « Infos de connexion » échec :`, e);
    }
}

function fmtDuration(ms) {
    if (ms >= 1000) return (ms / 1000).toFixed(1) + " s";
    return ms + " ms";
}

// Durée longue « temps de jeu » : j / h / min (ex. « 3 j 5 h », « 2 h 14 min »).
function fmtPlaytime(ms) {
    const totalMin = Math.floor(ms / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (d > 0) return `${d} j ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    if (m > 0) return `${m} min`;
    return "< 1 min";
}

function renderConnStats({ loadMs, avgMs, activeModules, assetCount, docCount, samples, totalMs }, { persistent = false } = {}) {
    document.getElementById("scwm-connstats")?.remove();

    const box = document.createElement("div");
    box.id = "scwm-connstats";
    box.innerHTML = `
        <a class="scwm-connstats-close" title="Fermer"><i class="fa-solid fa-times"></i></a>
        <div class="scwm-connstats-title"><i class="fa-solid fa-plug"></i> Connexion</div>
        <div class="scwm-connstats-row"><span>Temps de chargement</span><b>${fmtDuration(loadMs)}</b></div>
        <div class="scwm-connstats-row"><span>Modules actifs</span><b>${activeModules}</b></div>
        <div class="scwm-connstats-row"><span>Assets chargés</span><b>${assetCount}</b></div>
        <div class="scwm-connstats-row"><span>Documents chargés</span><b>${docCount}</b></div>
        <div class="scwm-connstats-row"><span>Moyenne (${samples} sess.)</span><b>${fmtDuration(avgMs)}</b></div>
        <div class="scwm-connstats-row"><span>Temps total sur le serveur</span><b>${fmtPlaytime(totalMs)}</b></div>
    `;
    document.body.appendChild(box);

    box.querySelector(".scwm-connstats-close")?.addEventListener("click", () => box.remove());

    // Ouverte manuellement (réglages) : reste affichée jusqu'à clic sur ✕.
    // Ouverte au chargement : disparaît automatiquement après 7 s (sauf survol).
    if (persistent) return;

    let timer = setTimeout(fadeOut, 7000);
    box.addEventListener("mouseenter", () => { clearTimeout(timer); box.classList.remove("scwm-connstats-hide"); });
    box.addEventListener("mouseleave", () => { timer = setTimeout(fadeOut, 3000); });

    function fadeOut() {
        box.classList.add("scwm-connstats-hide");
        setTimeout(() => box.remove(), 600);
    }
}
