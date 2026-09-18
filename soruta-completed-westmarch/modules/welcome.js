// ============================================================
// welcome.js — Fenêtre de bienvenue
// ============================================================

import { startTutorial, SECTION_LABELS, SECTION_ICONS, SETTING_KEYS, isSectionAvailable, SECTION_ESSENTIAL } from './tutorial.js';

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
        <div class="tuto-selector-toolbar" style="display:flex;gap:12px;justify-content:flex-end;margin:0 2px 6px;font-size:12px;">
            <a class="tuto-select-all"   style="color:#8fd19e;cursor:pointer;">Tout sélectionner</a>
            <span style="color:#555;">·</span>
            <a class="tuto-select-none"  style="color:#e58f8f;cursor:pointer;">Tout désélectionner</a>
        </div>
        <div class="tuto-section-list">${rows}</div>
        <p class="tuto-selector-warn" style="margin-top:10px;color:#e0a13a;font-size:12px;display:flex;gap:6px;align-items:flex-start;">
            <i class="fa-solid fa-triangle-exclamation" style="margin-top:2px;"></i>
            <span>Avant de commencer, <strong>fermez toutes les fiches et fenêtres ouvertes</strong> — le guide ouvre lui-même celles qu'il explique.</span>
        </p>
    </div>`;

    new Dialog({
        title:   "Guide — Choisir les sections",
        content,
        buttons: {
            start: {
                icon:     '<i class="fa-solid fa-play"></i>',
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
                icon:  '<i class="fa-solid fa-times"></i>',
                label: "Fermer"
            }
        },
        default: "start",
        render: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            if (!root) return;
            const setAll = (v) => root.querySelectorAll('[name="tuto-section"]').forEach(cb => { cb.checked = v; });
            root.querySelector(".tuto-select-all")?.addEventListener("click", (e) => { e.preventDefault(); setAll(true); });
            root.querySelector(".tuto-select-none")?.addEventListener("click", (e) => { e.preventDefault(); setAll(false); });
        }
    }, {
        width:   360,
        classes: ["dialog", "tuto-selector-dialog"]
    }).render(true);
}

// Sections déjà parcourues pendant cette session (pour la coche du menu).
const _doneSections = new Set();

/**
 * Parcours guidé : lance d'abord les sections ESSENTIELLES à la suite (comme
 * l'ancien tutoriel), puis ouvre le MENU pour les sections optionnelles.
 */
export function startEssentialsThenHub() {
    const essential = Object.entries(SECTION_LABELS)
        .filter(([k]) => isSectionAvailable(k) && SECTION_ESSENTIAL.has(k))
        .map(([k]) => k);
    if (!essential.length) { showTutorialHub(); return; }
    startTutorial(essential, () => {
        essential.forEach(k => _doneSections.add(k));
        showTutorialHub();
    });
}

/**
 * MENU du guide : liste les sections. On clique une section → on la fait → on
 * revient ici. On répète jusqu'à fermer (croix) ou « Ne plus afficher ».
 * C'est le mode recommandé : chacun ne fait que ce qui l'intéresse.
 */
export function showTutorialHub() {
    const entries = Object.entries(SECTION_LABELS).filter(([k]) => isSectionAvailable(k));

    const rowHtml = ([key, label]) => {
        const icon = SECTION_ICONS[key] ?? "fa-circle";
        const done = _doneSections.has(key);
        return `
        <button type="button" class="tuto-hub-row" data-section="${key}"
                style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;
                       padding:7px 10px;border-radius:5px;cursor:pointer;
                       border:1px solid rgba(201,162,39,0.25);
                       background:${done ? "rgba(143,209,158,0.08)" : "rgba(201,162,39,0.07)"};color:inherit;">
            <i class="fas ${icon}" style="width:18px;text-align:center;color:#c9a227;"></i>
            <span style="flex:1;">${label}</span>
            ${done
                ? '<i class="fa-solid fa-check" style="color:#8fd19e;"></i>'
                : '<i class="fa-solid fa-chevron-right" style="opacity:.4;"></i>'}
        </button>`;
    };

    const essential = entries.filter(([k]) => SECTION_ESSENTIAL.has(k));
    const optional  = entries.filter(([k]) => !SECTION_ESSENTIAL.has(k));

    const groupHtml = (title, sub, color, arr) => arr.length ? `
        <div style="margin-top:4px;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${color};margin:8px 2px 3px;font-weight:700;">
                ${title} <span style="opacity:.65;font-weight:400;text-transform:none;letter-spacing:0;">${sub}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">${arr.map(rowHtml).join("")}</div>
        </div>` : "";

    const content = `
    <div class="tuto-hub-body">
        <p style="margin:0 0 8px;font-size:13px;">
            Chaque section est courte, et tu <strong>reviens à ce menu</strong> après.
            Commence par les sections <strong style="color:#8fd19e;">à connaître</strong> ;
            le reste est optionnel. Ferme la fenêtre (croix) quand tu as fini.
        </p>
        <p style="margin:0 0 8px;color:#e0a13a;font-size:12px;display:flex;gap:6px;align-items:flex-start;">
            <i class="fa-solid fa-triangle-exclamation" style="margin-top:2px;"></i>
            <span>Ferme les fiches/fenêtres ouvertes avant : le guide ouvre lui-même celles qu'il explique.</span>
        </p>
        <div class="tuto-hub-list" style="max-height:52vh;overflow-y:auto;padding-right:4px;">
            ${(essential.length || optional.length)
                ? groupHtml("À connaître", "(essentiel)", "#8fd19e", essential)
                  + groupHtml("Optionnel", "(pour aller plus loin)", "#c9a227", optional)
                : '<p style="opacity:.7;">Aucune section disponible.</p>'}
        </div>
    </div>`;

    let dlg;
    dlg = new Dialog({
        title:   "Guide du serveur",
        content,
        buttons: {
            essentials: {
                icon:  '<i class="fa-solid fa-star"></i>',
                label: "Les essentiels",
                callback: () => startTutorial(essential.map(([k]) => k), () => {
                    essential.forEach(([k]) => _doneSections.add(k));
                    showTutorialHub();
                })
            },
            all: {
                icon:  '<i class="fa-solid fa-list-check"></i>',
                label: "Tout faire",
                callback: () => startTutorial(entries.map(([k]) => k), () => {
                    entries.forEach(([k]) => _doneSections.add(k));
                    showTutorialHub();
                })
            },
            hide: {
                icon:  '<i class="fa-solid fa-eye-slash"></i>',
                label: "Ne plus afficher à la connexion",
                callback: () => {
                    game.settings.set(MODULE, "hideWelcome", true);
                    ui.notifications.info("[Guide] La fenêtre d'accueil ne s'affichera plus. Bouton « ? » dans la barre WestMarch pour rouvrir le menu.");
                }
            },
            close: { icon: '<i class="fa-solid fa-times"></i>', label: "Fermer" }
        },
        default: "close",
        render: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            if (!root) return;
            root.querySelectorAll(".tuto-hub-row").forEach(btn => btn.addEventListener("click", () => {
                const key = btn.dataset.section;
                try { dlg.close(); } catch {}
                // Lance la section ; au retour (fin/croix/Échap), on rouvre le menu.
                startTutorial([key], () => { _doneSections.add(key); showTutorialHub(); });
            }));
        }
    }, {
        width:   420,
        classes: ["dialog", "tuto-hub-dialog"]
    });
    dlg.render(true);
}

/**
 * Affiche la fenêtre de bienvenue (appelable depuis le bouton toolbar).
 */
export function showWelcome() {
    const serverName = game.settings.get(MODULE, "serverName");

    const content = `
    <div class="tuto-welcome-body">
        <div class="tuto-welcome-icon">
            <i class="fa-solid fa-scroll"></i>
        </div>
        <h2 class="tuto-welcome-title">${serverName}</h2>
        <p class="tuto-welcome-text">
            Des fonctionnalités spéciales sont disponibles sur ce serveur.<br>
            On commence par <strong>l'essentiel</strong> (court), puis un <strong>menu</strong>
            vous laisse explorer le reste à votre rythme.
        </p>
        <p class="tuto-welcome-warn" style="margin-top:8px;color:#e0a13a;font-size:12px;">
            <i class="fa-solid fa-triangle-exclamation"></i>
            Fermez toutes les fiches et fenêtres ouvertes avant de commencer, pour le bon déroulement du guide.
        </p>
    </div>`;

    new Dialog({
        title:   "Bienvenue",
        content,
        buttons: {
            start: {
                icon:     '<i class="fa-solid fa-play"></i>',
                label:    "Commencer (l'essentiel puis le menu)",
                callback: () => startEssentialsThenHub()
            }
        },
        default: "start"
    }, {
        width:   460,
        classes: ["dialog", "tuto-welcome-dialog"]
    }).render(true);
}
