// ============================================================
// hotbar.js — Masquer la barre de macros (hotbar) pour les joueurs
//
// Deux réglages (Toolkit), indépendants :
//   - "enableHideHotbar"   : masque la hotbar pour les joueurs non-GM.
//   - "enableHideHotbarGM" : masque la hotbar pour les GM.
// Chaque utilisateur applique celui qui le concerne selon son rôle.
// Masquage via une classe sur <body> (robuste aux re-renders) + fallback
// direct sur l'élément. Live, sans rechargement.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

export function applyHotbarVisibility() {
    const hide = game.user.isGM
        ? !!game.settings.get(MOD, "enableHideHotbarGM")
        : !!game.settings.get(MOD, "enableHideHotbar");
    document.body.classList.toggle("scwm-hide-hotbar", hide);

    // Fallback direct (au cas où l'id DOM différerait) — réappliqué au render.
    const el = document.getElementById("hotbar") ?? ui.hotbar?.element ?? null;
    if (el) el.style.display = hide ? "none" : "";
}

export function HotbarHooks() {
    Hooks.on("ready", applyHotbarVisibility);
    // La hotbar se re-render (drag de macro, changement de page…) → réappliquer.
    Hooks.on("renderHotbar", applyHotbarVisibility);
}
