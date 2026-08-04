// ============================================================
// connstats.js — Fenêtre d'infos de connexion (Toolkit)
//
// Réglage "enableConnStats" : au chargement du monde, affiche en haut
// au centre de l'écran une petite fenêtre indiquant :
//   - le temps de connexion / chargement (page → hook "ready") ;
//   - le nombre de modules actifs ("paquets" chargés) ;
//   - la durée MOYENNE de connexion, calculée sur l'historique local
//     (client) des dernières sessions.
// L'historique est stocké par client (scope "client") — la moyenne est
// donc propre à la machine de chaque utilisateur.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const HISTORY_MAX = 20;   // nombre de sessions gardées pour la moyenne

export function ConnStatsHooks() {
    Hooks.once("ready", () => {
        if (!game.settings.get(MOD, "enableConnStats")) return;

        // performance.now() = ms écoulées depuis le début du chargement de la
        // page (origine temporelle du document) → bonne mesure du temps total
        // de connexion + chargement du monde jusqu'à "ready".
        const loadMs = Math.round(performance.now());

        // Historique local pour la moyenne (on garde les N dernières).
        let history = game.settings.get(MOD, "connStatsHistory");
        if (!Array.isArray(history)) history = [];
        history = [...history, loadMs].slice(-HISTORY_MAX);
        game.settings.set(MOD, "connStatsHistory", history);

        const avgMs = Math.round(history.reduce((a, b) => a + b, 0) / history.length);

        // "Paquets" chargés = modules actifs.
        const activeModules = game.modules.filter(m => m.active).length;

        renderConnStats({ loadMs, avgMs, activeModules, samples: history.length });
    });
}

function fmtDuration(ms) {
    if (ms >= 1000) return (ms / 1000).toFixed(1) + " s";
    return ms + " ms";
}

function renderConnStats({ loadMs, avgMs, activeModules, samples }) {
    document.getElementById("scwm-connstats")?.remove();

    const box = document.createElement("div");
    box.id = "scwm-connstats";
    box.innerHTML = `
        <a class="scwm-connstats-close" title="Fermer"><i class="fas fa-times"></i></a>
        <div class="scwm-connstats-title"><i class="fas fa-plug"></i> Connexion</div>
        <div class="scwm-connstats-row"><span>Temps de chargement</span><b>${fmtDuration(loadMs)}</b></div>
        <div class="scwm-connstats-row"><span>Modules actifs</span><b>${activeModules}</b></div>
        <div class="scwm-connstats-row"><span>Moyenne (${samples} sess.)</span><b>${fmtDuration(avgMs)}</b></div>
    `;
    document.body.appendChild(box);

    box.querySelector(".scwm-connstats-close")?.addEventListener("click", () => box.remove());

    // Disparition automatique après 7 s (fondu), sauf si survolée.
    let timer = setTimeout(fadeOut, 7000);
    box.addEventListener("mouseenter", () => { clearTimeout(timer); box.classList.remove("scwm-connstats-hide"); });
    box.addEventListener("mouseleave", () => { timer = setTimeout(fadeOut, 3000); });

    function fadeOut() {
        box.classList.add("scwm-connstats-hide");
        setTimeout(() => box.remove(), 600);
    }
}
