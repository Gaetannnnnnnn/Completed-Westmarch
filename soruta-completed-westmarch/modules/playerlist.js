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

        const lists = root.querySelectorAll(".players-list");
        if (!lists.length) return;

        // Cap de hauteur (~4 lignes) + défilement sur chaque liste.
        lists.forEach(l => l.classList.add("scwm-players-compact"));

        // Barre de recherche (une seule).
        if (root.querySelector(".scwm-player-search")) return;

        const bar = document.createElement("div");
        bar.className = "scwm-player-search";
        bar.innerHTML = `<i class="fas fa-search"></i>` +
            `<input type="text" placeholder="Rechercher un joueur…">`;
        lists[0].parentElement.insertBefore(bar, lists[0]);

        const input = bar.querySelector("input");
        input.addEventListener("input", () => {
            const q = input.value.trim().toLowerCase();
            root.querySelectorAll(".player").forEach(row => {
                const name = row.textContent.trim().toLowerCase();
                row.style.display = (!q || name.includes(q)) ? "" : "none";
            });
        });
        // Le clic dans le champ ne doit pas déclencher les actions de la liste.
        input.addEventListener("click", e => e.stopPropagation());
        input.addEventListener("pointerdown", e => e.stopPropagation());
    });
}
