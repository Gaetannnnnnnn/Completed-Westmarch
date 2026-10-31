// ============================================================
// homebrew.js — Adresse du contenu homebrew pour Plutonium
//
// Le module fournit la source homebrew 5etools « West Marches - Contenu
// personnalisé » (homebrew/westmarch-perso.json), avec le background
// « Origine personnalisée ». Foundry sert les fichiers des modules : chaque
// serveur a donc sa propre adresse pour ce fichier.
//
// Ce fichier ajoute dans les réglages du module un menu « Contenu homebrew
// (Plutonium) », ouvert à tous (restricted:false), qui affiche l'adresse
// calculée pour CE serveur (origine du navigateur + préfixe de route de
// Foundry) avec un bouton pour la copier, et rappelle comment l'ajouter.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";

const HOMEBREW_PATH = `modules/${MOD}/homebrew/westmarch-perso.json`;

/** Adresse complète du fichier homebrew sur le serveur courant. getRoute
 *  ajoute le préfixe de route de Foundry s'il y en a un (ex. /foundry/). */
export function homebrewUrl() {
    const route = foundry.utils?.getRoute?.(HOMEBREW_PATH) ?? `/${HOMEBREW_PATH}`;
    return new URL(route, window.location.origin).href;
}

async function copyText(text) {
    if (game.clipboard?.copyPlainText) return game.clipboard.copyPlainText(text);
    return navigator.clipboard.writeText(text);
}

export async function openHomebrewDialog() {
    const url = homebrewUrl();
    const esc = foundry.utils.escapeHTML;
    const content = `
    <div style="display:flex;flex-direction:column;gap:10px;padding:2px 0;">
        <p style="margin:0;">${tl("Le background « Origine personnalisée » du serveur est fourni comme source homebrew pour Plutonium. Ajoute cette adresse dans Plutonium pour l'avoir à la création de personnage :")}</p>
        <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" readonly value="${esc(url)}" class="scwm-hb-url"
                   style="flex:1;font-family:monospace;font-size:12px;">
            <button type="button" class="scwm-hb-copy" style="flex:0 0 auto;width:auto;">
                <i class="fa-solid fa-copy"></i> ${tl("Copier")}
            </button>
        </div>
        <p style="margin:0;font-size:.85em;color:#999;">${tl("Cette adresse est propre à ce serveur : elle est calculée automatiquement. Elle reste valable après les mises à jour du module.")}</p>
    </div>`;

    await foundry.applications.api.DialogV2.wait({
        window:      { title: tl("Contenu homebrew (Plutonium)"), icon: "fa-solid fa-link" },
        position:    { width: 560 },
        rejectClose: false,
        content,
        render: () => {
            const input = document.querySelector(".scwm-hb-url");
            input?.addEventListener("focus", () => input.select());
            document.querySelector(".scwm-hb-copy")?.addEventListener("click", async (e) => {
                e.preventDefault();
                try {
                    await copyText(url);
                    ui.notifications.info(tl("Adresse copiée dans le presse-papiers."));
                } catch (err) {
                    journal.avert(tl("[{0}] Copie de l'adresse homebrew impossible", MOD), err);
                    ui.notifications.warn(tl("Copie impossible : sélectionne l'adresse et copie-la à la main (Ctrl+C)."));
                }
            });
        },
        buttons: [{ action: "close", label: tl("Fermer"), icon: '<i class="fa-solid fa-xmark"></i>', default: true }]
    });
}

export function HomebrewHooks() {
    try {
        game.settings.registerMenu(MOD, "menu-homebrew", {
            name:  tl("Contenu homebrew (Plutonium)"),
            label: tl("Voir l'adresse"),
            hint:  tl("Adresse de la source homebrew du serveur (background « Origine personnalisée ») à ajouter dans Plutonium. Calculée pour ce serveur."),
            icon:  "fas fa-link",
            type:  class extends foundry.applications.api.ApplicationV2 {
                static DEFAULT_OPTIONS = { id: "scwm-menu-homebrew", window: { title: tl("Contenu homebrew (Plutonium)") } };
                async render() { openHomebrewDialog(); return this; }
                async close()  { return this; }
            },
            restricted: false
        });
    } catch (e) {
        journal.critique(tl("[{0}] registerMenu « Contenu homebrew » échec :", MOD), e);
    }
}
