// ============================================================
// hotbar.js — Masquer la barre de macros (hotbar) pour les joueurs
//
// Réglage "enableHideHotbar" (Toolkit) : quand activé, la barre de macros
// est masquée pour les utilisateurs non-GM. Le GM la conserve toujours.
// Masquage via une classe sur <body> (robuste aux re-renders) + fallback
// direct sur l'élément. Live, sans rechargement.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

export function applyHotbarVisibility() {
    const hide = !!game.settings.get(MOD, "enableHideHotbar") && !game.user.isGM;
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
