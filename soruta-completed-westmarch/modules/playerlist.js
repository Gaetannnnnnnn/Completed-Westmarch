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

// ── Repli du panneau des joueurs vers la gauche (état mémorisé par navigateur) ──
const _isCollapsed = () => { try { return localStorage.getItem("scwm-players-collapsed") === "1"; } catch { return false; } };
function _applyCollapsed(v) { document.body.classList.toggle("scwm-players-collapsed", !!v); }
function _setCollapsed(v) { try { localStorage.setItem("scwm-players-collapsed", v ? "1" : "0"); } catch {} _applyCollapsed(v); }

// Poignée fixe (bas-gauche) pour rouvrir le panneau une fois replié — créée une fois.
function _ensureReopenHandle() {
    if (document.querySelector(".scwm-players-reopen")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "scwm-players-reopen";
    btn.title = "Afficher la liste des joueurs";
    btn.innerHTML = `<i class="fa-solid fa-users"></i><i class="fa-solid fa-chevron-right"></i>`;
    btn.addEventListener("click", () => _setCollapsed(false));
    (document.getElementById("interface") ?? document.body).appendChild(btn);
}

export function PlayerListHooks() {

    // ── Bouton « réduire » sur le panneau des joueurs (indépendant du mode compact) ──
    Hooks.on("renderPlayers", (app, html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;
        _ensureReopenHandle();
        _applyCollapsed(_isCollapsed());
        if (!root.querySelector(".scwm-players-collapse")) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "scwm-players-collapse";
            btn.title = "Réduire la liste des joueurs (vers la gauche)";
            btn.innerHTML = `<i class="fa-solid fa-chevron-left"></i>`;
            btn.addEventListener("click", (e) => { e.stopPropagation(); _setCollapsed(true); });
            root.insertBefore(btn, root.firstChild);
        }
    });

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
        bar.innerHTML = `<i class="fa-solid fa-search"></i>` +
            `<input type="text" placeholder="Rechercher un joueur…">`;
        // DANS la liste (le cadre du panneau est porté par .players-list),
        // en tête, épinglée (sticky) et pleine largeur opaque : les noms
        // défilent en dessous sans transparaître derrière.
        list.insertBefore(bar, list.firstChild);

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
