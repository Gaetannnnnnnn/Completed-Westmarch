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

// --- Géométrie des Régions (Foundry v14) : centre + translation des formes ---
const _plain = (s) => (typeof s?.toObject === "function") ? s.toObject() : foundry.utils.deepClone(s);

// Boîte englobante → centre de l'ensemble des formes d'une région. null si vide.
function _shapesCenter(shapes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const raw of (shapes ?? [])) {
        const o = _plain(raw);
        let x0, y0, x1, y1;
        if (o.type === "rectangle") { x0 = o.x; y0 = o.y; x1 = o.x + (o.width ?? 0); y1 = o.y + (o.height ?? 0); }
        else if (o.type === "circle") { x0 = o.x - o.radius; y0 = o.y - o.radius; x1 = o.x + o.radius; y1 = o.y + o.radius; }
        else if (o.type === "ellipse") { x0 = o.x - (o.radiusX ?? 0); y0 = o.y - (o.radiusY ?? 0); x1 = o.x + (o.radiusX ?? 0); y1 = o.y + (o.radiusY ?? 0); }
        else if (o.type === "polygon") {
            const p = o.points ?? [];
            for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0 ?? Infinity, p[i]); x1 = Math.max(x1 ?? -Infinity, p[i]); y0 = Math.min(y0 ?? Infinity, p[i + 1]); y1 = Math.max(y1 ?? -Infinity, p[i + 1]); }
        } else continue;
        minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    }
    if (!isFinite(minX)) return null;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// Décale toutes les formes d'une région de (dx, dy). Retourne un tableau simple.
function _translateShapes(shapes, dx, dy) {
    return (shapes ?? []).map(raw => {
        const o = _plain(raw);
        if (o.type === "polygon") o.points = (o.points ?? []).map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
        else { o.x = (o.x ?? 0) + dx; o.y = (o.y ?? 0) + dy; }
        return o;
    });
}

export function TemplateHooks() {

    // ── Gabarits qui SUIVENT le token (suivi de position) ────────────────
    // À la création, si un token est sélectionné, on attache le gabarit à lui
    // (offset conservé). Ses déplacements réécrivent la position du gabarit.
    const _driverIsMe = () => {
        const driver = game.users.find(u => u.isGM && u.active);
        return driver && driver.id === game.user.id;
    };

    Hooks.on("preCreateMeasuredTemplate", (doc) => {
        if (!game.settings.get(_MODULE, "enableFollowTemplates")) return;
        // Attache UNIQUEMENT si le point de départ est SUR un token. Sinon, gabarit
        // libre normal — on peut donc toujours poser un gabarit ailleurs, même s'il
        // y a des tokens sur la map.
        const token = canvas.tokens?.placeables?.find(t => t.bounds?.contains?.(doc.x, doc.y));
        if (!token) return;
        // Recentré pile sur le token → écart nul.
        doc.updateSource({ x: token.center.x, y: token.center.y });
        doc.updateSource({ [`flags.${_MODULE}.attached`]: { tokenId: token.id, dx: 0, dy: 0 } });
    });

    Hooks.on("updateToken", async (tokenDoc, changes) => {
        if (!game.settings.get(_MODULE, "enableFollowTemplates")) return;
        if (!("x" in changes || "y" in changes)) return;
        if (!_driverIsMe()) return;                       // un seul client écrit
        const scene = tokenDoc.parent;
        if (!scene) return;
        // Position d'arrivée (dans `changes` : tokenDoc.x peut encore être l'ancienne).
        const nx = Number.isFinite(changes.x) ? changes.x : tokenDoc.x;
        const ny = Number.isFinite(changes.y) ? changes.y : tokenDoc.y;
        const gs = scene.grid.size;
        const cx = nx + (tokenDoc.width ?? 1) * gs / 2;
        const cy = ny + (tokenDoc.height ?? 1) * gs / 2;
        const updates = scene.templates
            .filter(t => t.getFlag(_MODULE, "attached")?.tokenId === tokenDoc.id)
            .map(t => { const f = t.getFlag(_MODULE, "attached"); return { _id: t.id, x: cx + f.dx, y: cy + f.dy }; });
        if (updates.length) await scene.updateEmbeddedDocuments("MeasuredTemplate", updates);
    });

    // Nettoyage : le token supprimé emporte ses gabarits attachés.
    Hooks.on("deleteToken", async (tokenDoc) => {
        if (!_driverIsMe()) return;
        const scene = tokenDoc.parent;
        if (!scene) return;
        const ids = scene.templates
            .filter(t => t.getFlag(_MODULE, "attached")?.tokenId === tokenDoc.id)
            .map(t => t.id);
        if (ids.length) await scene.deleteEmbeddedDocuments("MeasuredTemplate", ids);
        // Régions attachées (v14 : les zones AoE sont des Régions, pas des gabarits).
        const rids = [...(scene.regions ?? [])]
            .filter(r => r.getFlag(_MODULE, "attached")?.tokenId === tokenDoc.id)
            .map(r => r.id);
        if (rids.length) await scene.deleteEmbeddedDocuments("Region", rids);
    });

    // ── RÉGIONS qui suivent le token (Foundry v14 : les zones AoE sont des Régions) ──
    Hooks.on("preCreateRegion", (doc) => {
        if (!game.settings.get(_MODULE, "enableFollowTemplates")) return;
        const shapes = doc.shapes ?? [];
        const c = _shapesCenter(shapes);
        if (!c) return;
        // Attache UNIQUEMENT si le centre de la zone est SUR un token (sinon libre).
        const token = canvas.tokens?.placeables?.find(t => t.bounds?.contains?.(c.x, c.y));
        if (!token) return;
        // Recentre les formes pile sur le token, puis marque l'attache.
        const dx = token.center.x - c.x, dy = token.center.y - c.y;
        doc.updateSource({ shapes: _translateShapes(shapes, dx, dy), [`flags.${_MODULE}.attached`]: { tokenId: token.id } });
    });

    Hooks.on("updateToken", async (tokenDoc, changes) => {
        if (!game.settings.get(_MODULE, "enableFollowTemplates")) return;
        if (!("x" in changes || "y" in changes)) return;
        if (!_driverIsMe()) return;
        const scene = tokenDoc.parent;
        if (!scene?.regions) return;
        const nx = Number.isFinite(changes.x) ? changes.x : tokenDoc.x;
        const ny = Number.isFinite(changes.y) ? changes.y : tokenDoc.y;
        const gs = scene.grid.size;
        const cx = nx + (tokenDoc.width ?? 1) * gs / 2;
        const cy = ny + (tokenDoc.height ?? 1) * gs / 2;
        const updates = [];
        for (const region of scene.regions) {
            if (region.getFlag(_MODULE, "attached")?.tokenId !== tokenDoc.id) continue;
            const c = _shapesCenter(region.shapes);
            if (!c) continue;
            updates.push({ _id: region.id, shapes: _translateShapes(region.shapes, cx - c.x, cy - c.y) });
        }
        if (updates.length) await scene.updateEmbeddedDocuments("Region", updates);
    });

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
