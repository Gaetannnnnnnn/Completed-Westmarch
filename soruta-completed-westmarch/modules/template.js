import { MOD } from "./const.js";
// ============================================================
// template.js — Snap des templates AoE à 0,1 ft
//
// Problème natif : quand on tire un template à la souris, Foundry
// calcule la distance en pixels puis la convertit en pieds — le
// résultat est un float à plusieurs décimales (ex. 15,37 ft).
// Cela s'affiche avec trop de précision et l'interactivité est
// "liquide" sans sensation de palliers.
//
// Ce patch :
//   1. Snape la distance au dixième de pied (0,1 ft) pendant le
//      drag LIVE (renderFlag asynchrone → Foundry ne voit qu'une
//      seule valeur par frame, après le snap).
//   2. Snape à la création (preCreateMeasuredTemplate) pour figer
//      la valeur finale au dixième.
//   3. Snape à la modification (preUpdateMeasuredTemplate) pour
//      que les edits manuels / resizes d'un template existant
//      restent aussi au dixième.
//
// Résultat : la taille s'incrémente par paliers de 0,1 ft pendant
// le tirage → affichage saccadé bien lisible, jamais de valeur
// au centième.
//
// Dépendance : lib-wrapper (pour le snap live uniquement).
// Sans lib-wrapper les snaps à la création et à la modification
// restent actifs.
// ============================================================

const _MODULE = MOD;

/**
 * Snape une distance au dixième de pied le plus proche.
 * Retourne la valeur inchangée si elle n'est pas un nombre fini positif.
 * @param {number} distance
 * @returns {number}
 */
function _snapToTenth(distance) {
    if (typeof distance !== "number" || !isFinite(distance) || distance <= 0) return distance;
    // Math.round(x * 10) / 10 — simple et fiable pour des distances de 0 à 200+ ft.
    return Math.round(distance * 10) / 10;
}

export function TemplateHooks() {

    // ── 1. Snap à la création ─────────────────────────────────────────────
    // Déclenché quand la souris est relâchée et que Foundry s'apprête à
    // persister le nouveau MeasuredTemplateDocument en base.
    Hooks.on("preCreateMeasuredTemplate", (doc, _data, _opts, _uid) => {
        if (!game.settings.get(_MODULE, "enableTemplateSnap")) return;
        const snapped = _snapToTenth(doc.distance);
        if (snapped !== doc.distance) doc.updateSource({ distance: snapped });
    });

    // ── 2. Snap à la modification ─────────────────────────────────────────
    // Couvre : édition manuelle de la distance dans la boîte de propriétés,
    // et tout resize d'un template existant (si Foundry en expose un).
    Hooks.on("preUpdateMeasuredTemplate", (_doc, changes, _opts, _uid) => {
        if (!game.settings.get(_MODULE, "enableTemplateSnap")) return;
        if (typeof changes.distance === "number") {
            changes.distance = _snapToTenth(changes.distance);
        }
    });

    // ── 3. Snap live pendant le drag (preview saccadé) ────────────────────
    // En Foundry V13, le point d'interception fiable N'EST PAS
    // TemplateLayer._onDragLeftMove (méthode absente ou non appelée dans le
    // flux V13). La bonne cible est MeasuredTemplate.prototype._refreshShape,
    // défini directement sur la classe et appelé AVANT que Foundry ne dessine
    // la forme (shape) et mette à jour l'étiquette de distance.
    //
    // Flux : drag souris → Foundry calcule distance brute → updateSource →
    //        renderFlags.set({refreshShape}) → _refreshShape() [← on snape ici]
    //        → dessin PIXI → _refreshText() [lit document.distance déjà snappé]
    //
    // On snape document.distance AVANT l'appel original : la forme ET le texte
    // utilisent donc directement la valeur snappée, sans double render.
    //
    // Guard isPreview : on ne touche que les templates en cours de placement,
    // pas les templates déjà posés sur la scène.
    if (game.modules.get("lib-wrapper")?.active) {
        try {
            libWrapper.register(
                _MODULE,
                "MeasuredTemplate.prototype._refreshShape",
                function (wrapped, ...args) {
                    if (game.settings.get(_MODULE, "enableTemplateSnap") && this.isPreview) {
                        const raw     = this.document.distance;
                        const snapped = _snapToTenth(raw);
                        if (Math.abs(snapped - raw) > 1e-9) {
                            // updateSource : mise à jour synchrone en mémoire,
                            // sans émettre d'événement ni déclencher de nouveau renderFlag.
                            this.document.updateSource({ distance: snapped });
                        }
                    }
                    return wrapped(...args);
                },
                "WRAPPER"
            );
            console.log("[toolkit] Snap template 0,1 ft — patch live actif (via _refreshShape).");
        } catch (e) {
            console.warn("[toolkit] Impossible de patcher MeasuredTemplate._refreshShape :", e);
            console.warn("[toolkit] Le snap au dixième restera actif à la création/modification uniquement.");
        }
    } else {
        console.warn(
            "[toolkit] lib-wrapper inactif : snap template live désactivé. " +
            "Le snap à la création et à la modification reste actif."
        );
    }
}
