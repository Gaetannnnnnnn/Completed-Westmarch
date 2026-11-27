// ============================================================
// skipequip.js — Auto-skip de la fenêtre d'équipement de classe
//
// À l'import d'une classe (Plutonium), une fenêtre « EquipmentApp »
// (« Equipment—<Classe> ») propose l'équipement de départ. Avec l'option
// « Bloquer l'import d'équipement de classe » cochée, on clique
// automatiquement son bouton « Skip » pour passer à la suite sans ajouter
// d'équipement. On ne ferme jamais la fenêtre de force (ça romprait la chaîne
// d'import) : on clique le bouton prévu à cet effet.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const actif = () => { try { return !!game.settings.get(MOD, "blockClassEquipment"); } catch { return false; } };

function boutonSkip(root) {
    return [...root.querySelectorAll("button")].find(b => {
        const t = (b.textContent || "").trim().toLowerCase();
        return t === "skip" || t === "ignorer" || t === "passer" || b.dataset?.action === "skip";
    });
}

export function SkipEquipHooks() {
    // Foundry émet « render<NomDeClasse> » → ici « renderEquipmentApp ».
    Hooks.on("renderEquipmentApp", (app, html) => {
        try {
            if (!actif()) return;
            const root = html instanceof HTMLElement
                ? html
                : (html?.[0] ?? (app?.element instanceof HTMLElement ? app.element : app?.element?.[0]));
            if (!root || root.dataset.scwmEquipSkip) return;
            root.dataset.scwmEquipSkip = "1";
            const clic = () => { const b = boutonSkip(root); if (b) { b.click(); return true; } return false; };
            if (!clic()) requestAnimationFrame(() => { try { clic(); } catch (e) {} });   // bouton pas encore prêt
        } catch (e) { /* non bloquant */ }
    });
}
