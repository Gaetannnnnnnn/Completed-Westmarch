// ============================================================
// playerlist.js — Liste des joueurs compacte + recherche (Toolkit)
//
// Réglage "enablePlayerListCompact" : limite la liste des joueurs à
// environ 4 lignes (défilement au-delà) et ajoute une barre de
// recherche pour filtrer les joueurs par nom. Utile quand beaucoup de
// comptes joueurs encombrent la liste.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

export function PlayerListHooks() {
    Hooks.on("renderPlayers", (app, html) => {
        if (!game.settings.get(MOD, "enablePlayerListCompact")) return;

        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;

        // Conteneur défilant de la liste des joueurs (v13 : .players-list).
        const list = root.querySelector(".players-list")
            ?? root.querySelector("#players-active")
            ?? root;
        if (!list) return;

        // Cap de hauteur (~4 lignes) + défilement.
        list.classList.add("scwm-players-compact");

        // Barre de recherche épinglée EN HAUT de la liste (une seule).
        if (root.querySelector(".scwm-player-search")) return;

        const bar = document.createElement("div");
        bar.className = "scwm-player-search";
        bar.innerHTML = `<i class="fas fa-search"></i>` +
            `<input type="text" placeholder="Rechercher un joueur…">`;
        // Au-dessus de la liste (hors de la zone défilante) : les noms
        // défilent uniquement en dessous, jamais derrière la barre.
        list.parentElement.insertBefore(bar, list);

        const input = bar.querySelector("input");
        input.addEventListener("input", () => {
            const q = input.value.trim().toLowerCase();
            // Les lignes de joueur portent un data-user-id (robuste v13).
            root.querySelectorAll("[data-user-id]").forEach(row => {
                if (row.closest(".scwm-player-search")) return;
                const name = (row.textContent || "").trim().toLowerCase();
                row.style.display = (!q || name.includes(q)) ? "" : "none";
            });
        });
        // Le clic/focus dans le champ ne doit pas déclencher les actions de la liste.
        ["click", "pointerdown", "mousedown"].forEach(ev =>
            input.addEventListener(ev, e => e.stopPropagation()));
    });
}
