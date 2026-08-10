// ============================================================
// welcome.js — Fenêtre de bienvenue
// ============================================================

import { startTutorial, SECTION_LABELS, SECTION_ICONS, SETTING_KEYS, isSectionAvailable } from './tutorial.js';

import { MOD } from "./const.js";
const MODULE = MOD;

/**
 * Affiche la fenêtre de bienvenue uniquement si l'utilisateur
 * n'a pas choisi "Ne plus afficher".
 */
export function showWelcomeIfNeeded() {
    if (!game.settings.get(MODULE, "tutoEnabled")) return;
    if (!game.settings.get(MODULE, "showWelcome")) return;  // GM a désactivé pour tout le monde
    if (game.settings.get(MODULE, "hideWelcome"))  return;  // cet utilisateur a cliqué "Ne plus afficher"
    showWelcome();
}

/**
 * Affiche le sélecteur de sections (bouton toolbar).
 * Permet de choisir quelles parties du tutoriel revoir.
 */
export function showTutorialSelector() {
    const rows = Object.entries(SECTION_LABELS)
        .filter(([key]) => isSectionAvailable(key))
        .map(([key, label]) => {
            const checked = game.settings.get(MODULE, SETTING_KEYS[key]) ? "checked" : "";
            const icon    = SECTION_ICONS[key] ?? "fa-circle";
            return `
        <label class="tuto-section-row">
            <input type="checkbox" name="tuto-section" value="${key}" ${checked}>
            <i class="fas ${icon}"></i>
            <span>${label}</span>
        </label>`;
        }).join("");

    const content = `
    <div class="tuto-selector-body">
        <p class="tuto-selector-hint">Choisissez les sections à revoir :</p>
        <div class="tuto-section-list">${rows}</div>
        <p class="tuto-selector-warn" style="margin-top:10px;color:#e0a13a;font-size:12px;display:flex;gap:6px;align-items:flex-start;">
            <i class="fas fa-triangle-exclamation" style="margin-top:2px;"></i>
            <span>Avant de commencer, <strong>fermez toutes les fiches et fenêtres ouvertes</strong> — le guide ouvre lui-même celles qu'il explique.</span>
        </p>
    </div>`;

    new Dialog({
        title:   "Guide — Choisir les sections",
        content,
        buttons: {
            start: {
                icon:     '<i class="fas fa-play"></i>',
                label:    "Commencer",
                callback: (html) => {
                    const selected = [...html.find('[name="tuto-section"]:checked')]
                        .map(el => el.value);
                    if (!selected.length) {
                        ui.notifications.warn("[Tutoriel] Sélectionnez au moins une section.");
                        return;
                    }
                    startTutorial(selected);
                }
            },
            close: {
                icon:  '<i class="fas fa-times"></i>',
                label: "Fermer"
            }
        },
        default: "start"
    }, {
        width:   360,
        classes: ["dialog", "tuto-selector-dialog"]
    }).render(true);
}

/**
 * Affiche la fenêtre de bienvenue (appelable depuis le bouton toolbar).
 */
export function showWelcome() {
    const serverName = game.settings.get(MODULE, "serverName");

    const content = `
    <div class="tuto-welcome-body">
        <div class="tuto-welcome-icon">
            <i class="fas fa-scroll"></i>
        </div>
        <h2 class="tuto-welcome-title">${serverName}</h2>
        <p class="tuto-welcome-text">
            Des fonctionnalités spéciales sont disponibles sur ce serveur.<br>
            Souhaitez-vous faire un tour guidé de l'interface ?
        </p>
        <p class="tuto-welcome-warn" style="margin-top:8px;color:#e0a13a;font-size:12px;">
            <i class="fas fa-triangle-exclamation"></i>
            Fermez toutes les fiches et fenêtres ouvertes avant de commencer, pour le bon déroulement du guide.
        </p>
    </div>`;

    new Dialog({
        title:   "Bienvenue",
        content,
        buttons: {
            start: {
                icon:     '<i class="fas fa-play"></i>',
                label:    "Commencer le tutoriel",
                callback: () => startTutorial()
            },
            later: {
                icon:     '<i class="fas fa-clock"></i>',
                label:    "Plus tard",
                callback: () => {}
            }
        },
        default: "start"
    }, {
        width:   460,
        classes: ["dialog", "tuto-welcome-dialog"]
    }).render(true);
}
