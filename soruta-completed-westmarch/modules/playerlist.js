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

let _toggleBtn = null;
function _refreshToggle() {
    if (!_toggleBtn) return;
    const c = _isCollapsed();
    _toggleBtn.innerHTML = c
        ? `<i class="fa-solid fa-users"></i><i class="fa-solid fa-angle-right"></i>`
        : `<i class="fa-solid fa-angle-left"></i>`;
    _toggleBtn.title = c ? "Afficher la liste des joueurs" : "Réduire la liste des joueurs";
    _toggleBtn.classList.toggle("is-collapsed", c);
}

// Positionne le bouton au CENTRE-GAUCHE du panneau des joueurs (dans la
// gouttière laissée par le décalage de #players), et non plus au coin bas où
// il recouvrait « Clore la session ». Le repère vertical reste le même que le
// panneau soit déplié ou replié (le repli ne fait que translater #players sur
// l'axe X), donc le bouton ne saute pas.
function _position() {
    if (!_toggleBtn) return;
    const p = document.getElementById("players");
    if (!p) return;
    const r = p.getBoundingClientRect();
    if (!r.height) return;
    // Juste AU-DESSUS du panneau (sur la carte), aligné à son bord gauche :
    // ne chevauche ni les noms, ni « Clore la session », ni le bord de l'écran.
    _toggleBtn.style.top    = `${Math.max(2, r.top - 26)}px`;
    _toggleBtn.style.bottom = "auto";
    _toggleBtn.style.left   = _isCollapsed() ? "2px" : `${Math.max(2, r.left)}px`;
}

function _setCollapsed(v) {
    try { localStorage.setItem("scwm-players-collapsed", v ? "1" : "0"); } catch {}
    _applyCollapsed(v);
    _refreshToggle();
    _position();
}
// Un SEUL bouton fixe (indépendant du survol du panneau) qui replie/déplie.
function _ensureToggle() {
    if (_toggleBtn && document.contains(_toggleBtn)) return;
    _toggleBtn = document.createElement("button");
    _toggleBtn.type = "button";
    _toggleBtn.className = "scwm-players-toggle";
    _toggleBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); _setCollapsed(!_isCollapsed()); });
    (document.getElementById("interface") ?? document.body).appendChild(_toggleBtn);
    // Recalage quand le panneau change de taille (survol, resize).
    const p = document.getElementById("players");
    if (p) { p.addEventListener("mouseenter", _position); p.addEventListener("mouseleave", _position); }
    window.addEventListener("resize", _position);
    _refreshToggle();
}

export function PlayerListHooks() {

    // ── Repli du panneau des joueurs (bouton fixe, indépendant du mode compact) ──
    Hooks.once("ready", () => { _ensureToggle(); _applyCollapsed(_isCollapsed()); _refreshToggle(); setTimeout(_position, 60); });
    Hooks.on("renderPlayers", () => { _ensureToggle(); _applyCollapsed(_isCollapsed()); _refreshToggle(); setTimeout(_position, 0); });

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
