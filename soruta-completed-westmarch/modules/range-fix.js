import { MOD } from "./const.js";
/**
 * @file        modules/range-fix.js
 * @module      midi-range-fix
 * @version     1.5.9
 * @author      Soruta (Discord : s0ruta)
 * @license     © 2026 Soruta — Tous droits réservés.
 *              Usage personnel autorisé. Toute redistribution, modification
 *              ou usage commercial est strictement interdit sans autorisation écrite.
 *
 * @description Patch de canvas.grid.measurePath pour corriger les portées midi-qol.
 *
 *   PROBLÈME
 *   --------
 *   Midi-qol mesure la portée depuis plusieurs coins de l'attaquant vers plusieurs
 *   coins de la cible, puis prend la distance minimale. Cette approche surestime
 *   la distance pour les tokens Large+ hors-grille : ex. PJ Medium vs Brown Bear
 *   Large donnait 6.9 ft au lieu de ~0 ft bord→bord, bloquant des attaques valides.
 *
 *   SOLUTION : mesure bord→bord
 *   ---------------------------
 *   1. Calculer le centre géométrique de chaque token (_boundsCenter).
 *   2. Trouver le point le plus proche sur la bounding box de l'attaquant depuis
 *      le centre de la cible (_nearestEllipsePoint) → "bord attaquant".
 *   3. Trouver le point le plus proche sur la bounding box de la cible depuis
 *      le centre de l'attaquant (_nearestEllipsePoint) → "bord cible".
 *   4. Mesurer la distance entre ces deux points via le prototype Foundry
 *      (_protoCall) sans passer par le getter de l'instance (évite la récursion).
 *   5. Ajouter rangeAdjust (défaut 2.5 ft) à cette distance bord→bord.
 *      Midi-qol compare ensuite result.distance ≤ weapon_range, ce qui revient à :
 *        bord→bord ≤ weapon_range − rangeAdjust
 *      Exemple (adjust = 2.5) :
 *        arme  5 ft → portée depuis bord ≤  2.5 ft (demi-case Medium)
 *        arme 10 ft → portée depuis bord ≤  7.5 ft
 *        arme 15 ft → portée depuis bord ≤ 12.5 ft
 *
 *   DÉTECTION DES TOKENS
 *   ---------------------
 *   Double méthode, dans l'ordre :
 *   1. Bounds-check avec PAD 8 px sur les waypoints passés par midi-qol.
 *   2. Fallback : token contrôlé (canvas.tokens.controlled[0]) + cible désignée
 *      (game.user.targets) — couvre les cas où midi-qol passe des coordonnées
 *      hors-bounds (coin de token, unités de grille vs pixels, token hors-grille).
 *
 *   PERSISTANCE DU PATCH — triple couche
 *   --------------------------------------
 *   Midi-qol ou libWrapper peut appeler Object.defineProperty(canvas.grid,
 *   'measurePath', { value: fn }) pendant le workflow d'attaque, détruisant
 *   notre getter/setter. Trois couches de défense :
 *   1. _ourPatch en portée MODULE (référence stable, marquée par Symbol _PATCH_MARK).
 *   2. Object.defineProperty getter/setter (résiste aux assignments simples =).
 *   3. Hook dnd5e.preUseItem : réinstalle avant chaque attaque.
 *   4. Polling setInterval 2s : détecte et réinstalle si le descripteur est écrasé.
 *
 *   ANTI-RÉCURSION
 *   --------------
 *   _trueOriginal (midi-qol) rappelle canvas.grid.measurePath en interne → notre
 *   getter → _ourPatch → boucle infinie. Garde _reentering + _protoCall (prototype
 *   direct) court-circuitent immédiatement tout appel rentrant.
 */

const _MODULE     = MOD;
const _PATCH_MARK = Symbol("midiRangeFix"); // identifie _ourPatch sans comparer le code

console.log("[midi-range-fix] v1.5.9 chargé.");

// Référence stable à la version "originale" (midi-qol) à appeler en fallback.
let _trueOriginal = null;
let _pollInterval = null;

// Référence à la fonction ORIGINALE Foundry de _getWaypointLabelContext.
// Sauvegardée une seule fois (avant tout patch). Permet de toujours wrapper
// l'original et non notre propre patch (évite le double-wrapping à chaque canvasReady).
let _rulerOrigFn = null;

// Garde de ré-entrance : _trueOriginal (midi-qol) appelle canvas.grid.measurePath
// en interne, ce qui déclenche à nouveau notre getter → récursion infinie.
// Quand _reentering = true, on court-circuite vers le prototype directement
// (qui ne passe PAS par le getter de l'instance).
let _reentering = false;

// Flag actif uniquement pendant un workflow midi-qol (dnd5e.preUseItem).
// Permet au fallback de _ourPatch de s'activer UNIQUEMENT pour les
// vrais checks de portée, pas pour les mesures génériques de la règle.
let _inMidiWorkflow = false;

function _protoCall(waypoints, options) {
    return Object.getPrototypeOf(canvas.grid)?.measurePath?.call(canvas.grid, waypoints, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// _ourPatch : portée MODULE obligatoire pour que la référence soit stable.
// Ne pas déplacer à l'intérieur d'une fonction — les comparaisons === en dépendent.
// ─────────────────────────────────────────────────────────────────────────────
function _ourPatch(waypoints, options) {
    // Garde de ré-entrance : si _protoCall déclenche canvas.grid.measurePath en interne,
    // on court-circuite immédiatement vers le prototype pour éviter toute boucle.
    if (_reentering) return _protoCall(waypoints, options);

    try {
        if (!waypoints || waypoints.length !== 2) {
            return _protoCall(waypoints, options);
        }

        const [src, tgt] = waypoints;

        // Méthode 1 : identifier les tokens depuis les coordonnées des waypoints.
        // PAD = 8 px de tolérance pour les points de bord ou les systèmes de
        // coordonnées légèrement décalés (ex. midi-qol passant le coin du token).
        const PAD = 8;
        function _tokenAtPt(pt, exclude) {
            return canvas.tokens.placeables.find(t => {
                if (!t.actor || !t.bounds || t === exclude) return false;
                const b = t.bounds;
                return pt.x >= b.x - PAD && pt.x <= b.x + b.width  + PAD
                    && pt.y >= b.y - PAD && pt.y <= b.y + b.height + PAD;
            }) ?? null;
        }

        let attacker = _tokenAtPt(src, null);
        let target   = attacker ? _tokenAtPt(tgt, attacker) : null;

        // Méthode 2 : fallback sur le token contrôlé + la cible désignée.
        // Couvre les cas où midi-qol passe des coordonnées hors-bounds
        // (ex. coin du token, système de coordonnées différent, token hors-grille).
        // IMPORTANT : uniquement pendant un workflow midi-qol actif (_inMidiWorkflow).
        // Sans ce garde, le fallback intercepte aussi les mesures génériques de la
        // règle (ray.A sur token → tgt sur sol → fallback → bord→bord figé).
        if (!attacker || !target) {
            if (!_inMidiWorkflow) return _protoCall(waypoints, options);
            attacker = canvas.tokens.controlled[0] ?? null;
            target   = [...(game.user?.targets ?? [])][0] ?? null;
            if (!attacker || !target || attacker === target) {
                return _protoCall(waypoints, options);
            }
        }

        // Mesure bord→bord via le PROTOTYPE (stable, sans re-call midi-qol).
        // On n'utilise pas _trueOriginal ici : midi-qol rappelle canvas.grid.measurePath
        // en interne avec ses propres points (coins), ce qui produisait des distances
        // incohérentes (6/10/11 ft en se déplaçant légèrement).
        const attackerCenter = _boundsCenter(attacker);
        const targetCenter   = _boundsCenter(target);
        const attackerBorder = _nearestEllipsePoint(targetCenter,   attacker);
        const targetBorder   = _nearestEllipsePoint(attackerCenter, target);

        _reentering = true;
        let result;
        try {
            // Options vides : identique à _patchRulerLabel, pour que les deux
            // calculs donnent exactement la même distance (évite les modificateurs
            // de coût midi-qol qui pourraient décaler la valeur).
            result = _protoCall([attackerBorder, targetBorder], {});
        } finally {
            _reentering = false;
        }

        // On ajoute l'ajustement à la distance bord→bord.
        // Midi-qol compare result.distance ≤ weapon_range, soit :
        //   bord→bord ≤ weapon_range − adjust
        // Ex. (adjust=2.5) : arme 5ft → portée depuis bord ≤ 2.5ft
        //                     arme 10ft → portée depuis bord ≤ 7.5ft
        if (result && typeof result.distance === "number") {
            const adjust = game.settings.get(_MODULE, "rangeAdjust") ?? 2.5;
            const raw    = result.distance + adjust;

            // On retourne la valeur exacte bord→bord + adjust en primitif number.
            // Note : midi-qol peut appeler .toNearest(grid) sur cette valeur pour
            // l'affichage du message jaune, ce qui arrondit la valeur affichée.
            // La comparaison de portée interne à midi-qol utilise le primitif brut,
            // donc le blocage est correct (5.26 > 5 → bloqué).
            result.distance = raw;

            console.log(`[midi-range-fix] bord→bord=${result.distance.toFixed(2)} + ${adjust} = ${raw.toFixed(2)} ft`);
        }
        return result;

    } catch(err) {
        _reentering = false;
        console.warn("[midi-range-fix] Erreur dans measurePath, fallback proto :", err);
        return _protoCall(waypoints, options);
    }
}
_ourPatch[_PATCH_MARK] = true; // marque pour identification fiable

// ─────────────────────────────────────────────────────────────────────────────
// Patch de l'affichage de la règle (ruler label)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patche Ruler.prototype._getWaypointLabelContext pour afficher
 * bord→bord + rangeAdjust dans l'étiquette de la règle.
 *
 * La règle calcule waypoint.measurement.distance indépendamment de measurePath.
 * Le patch s'applique uniquement quand un token est contrôlé ET une cible est
 * désignée — pour ne pas altérer les mesures génériques sur la carte.
 *
 * Ce patch est posé sur le PROTOTYPE (une seule fois par session), pas sur
 * l'instance : pas besoin de le réinstaller après un changement de scène.
 */
function _patchRulerLabel() {
    const ruler = canvas.controls?.ruler;
    if (!ruler) return;
    const RulerClass = ruler.constructor;
    if (!RulerClass?.prototype?._getWaypointLabelContext) {
        console.warn("[midi-range-fix] _getWaypointLabelContext introuvable sur Ruler — patch ruler annulé.");
        return;
    }

    // Sauvegarder la fonction ORIGINALE Foundry (une seule fois, avant tout patch).
    // __origFn est défini par nos patches 1.5.5+.
    // Pour les patches antérieurs (≤ 1.5.4, sans __origFn) ou pour la première
    // application, on utilise la fonction courante directement.
    // Si c'est un vieux patch à nous, double-wrapping acceptable :
    // le patch extérieur (1.5.5) gagne sur le contexte final.
    if (!_rulerOrigFn) {
        const currentFn = RulerClass.prototype._getWaypointLabelContext;
        _rulerOrigFn = currentFn?.__origFn ?? currentFn;
    }
    if (!_rulerOrigFn) {
        console.warn("[midi-range-fix] Impossible de récupérer _getWaypointLabelContext original.");
        return;
    }

    // Construire et (ré)appliquer le patch, toujours sur _rulerOrigFn.
    // Pas de guard _PATCH_MARK ici : on réapplique à chaque canvasReady pour
    // garantir que la version la plus récente du code est active.
    const _orig = _rulerOrigFn;
    function _rulerPatch(waypoint, state) {
        const context = _orig.call(this, waypoint, state);
        if (!context?.distance) return context;

        const ray = waypoint.ray;
        if (!ray?.A || !ray?.B) return context;

        // ── Mode règle manuelle ──
        // Vérifier que les deux extrémités du ray tombent dans les bounds d'un token.
        // Tolérance 8 px pour les points de bord.

        const PAD = 8;
        // Parmi tous les tokens dont le point est dans les bounds (+ PAD),
        // retourne celui dont le CENTRE est le plus proche du point.
        // Évite de capturer un token adjacent au lieu du token visé.
        function _tokenAt(pt, exclude) {
            let best = null, bestDist = Infinity;
            for (const t of (canvas.tokens?.placeables ?? [])) {
                if (!t.actor || !t.bounds || t === exclude) continue;
                const b = t.bounds;
                if (pt.x < b.x - PAD || pt.x > b.x + b.width  + PAD) continue;
                if (pt.y < b.y - PAD || pt.y > b.y + b.height + PAD) continue;
                const cx = b.x + b.width  / 2;
                const cy = b.y + b.height / 2;
                const d  = (pt.x - cx) ** 2 + (pt.y - cy) ** 2;
                if (d < bestDist) { bestDist = d; best = t; }
            }
            return best;
        }

        const srcToken = _tokenAt(ray.A, null);
        if (!srcToken) return context;
        const tgtToken = _tokenAt(ray.B, srcToken);
        if (!tgtToken || tgtToken === srcToken) return context;

        // Recalculer bord→bord exactement comme _ourPatch le fait pour midi-qol,
        // indépendamment de l'endroit où l'utilisateur a commencé à tirer la règle
        // (centre, bord, n'importe où dans le token).
        const srcCenter = _boundsCenter(srcToken);
        const tgtCenter = _boundsCenter(tgtToken);
        const srcBorder = _nearestEllipsePoint(tgtCenter, srcToken);
        const tgtBorder = _nearestEllipsePoint(srcCenter, tgtToken);

        // Distance bord→bord : calcul euclidien DIRECT en pixels converti en ft.
        // On évite _protoCall ici : la mesure via grille (Chebyshev) arrondit les
        // coordonnées de l'ellipse et annule la différence vs le rectangle.
        // Le calcul euclidien reflète exactement la distance visuelle à l'écran.
        const dx_px   = tgtBorder.x - srcBorder.x;
        const dy_px   = tgtBorder.y - srcBorder.y;
        const dist_px = Math.sqrt(dx_px * dx_px + dy_px * dy_px);
        const gs      = canvas.scene?.grid?.size     ?? canvas.grid?.size     ?? 100;
        const gd      = canvas.scene?.grid?.distance ?? canvas.grid?.distance ?? 5;
        const rawDist = dist_px * (gd / gs);

        // DIAGNOSTIC — visible dans la console Foundry (F12).
        // Vérifier : srcBorder et tgtBorder doivent être sur l'ELLIPSE de leur token,
        // pas sur le coin du rectangle. Pour des tokens carrés (cercles), la distance
        // du border au centre doit être exactement égale au rayon (b.width/2).
        console.debug(
            `[midi-range-fix] ruler ellipse | ${srcToken.name} → ${tgtToken.name}`,
            `\n  srcBounds:  x=${srcToken.bounds.x} y=${srcToken.bounds.y} w=${srcToken.bounds.width} h=${srcToken.bounds.height}`,
            `\n  tgtBounds:  x=${tgtToken.bounds.x} y=${tgtToken.bounds.y} w=${tgtToken.bounds.width} h=${tgtToken.bounds.height}`,
            `\n  srcCenter:  (${srcCenter.x.toFixed(1)}, ${srcCenter.y.toFixed(1)})`,
            `\n  tgtCenter:  (${tgtCenter.x.toFixed(1)}, ${tgtCenter.y.toFixed(1)})`,
            `\n  srcBorder:  (${srcBorder.x.toFixed(1)}, ${srcBorder.y.toFixed(1)})  rayon_src=${Math.hypot(srcBorder.x-srcCenter.x, srcBorder.y-srcCenter.y).toFixed(1)} (attendu ${(srcToken.bounds.width/2).toFixed(1)})`,
            `\n  tgtBorder:  (${tgtBorder.x.toFixed(1)}, ${tgtBorder.y.toFixed(1)})  rayon_tgt=${Math.hypot(tgtBorder.x-tgtCenter.x, tgtBorder.y-tgtCenter.y).toFixed(1)} (attendu ${(tgtToken.bounds.width/2).toFixed(1)})`,
            `\n  dist_px=${dist_px.toFixed(2)}  rawDist=${rawDist.toFixed(3)} ft  gs=${gs} gd=${gd}`,
        );

        // Distance native Foundry (curseur→curseur) : on utilise _protoCall
        // avec _reentering = true pour court-circuiter _ourPatch.
        // NE PAS utiliser waypoint.measurement.distance : _ourPatch l'a déjà
        // remplacé par bord→bord + adjust quand les deux extrémités tombent
        // sur des tokens → valeur figée sur la distance bord→bord.
        _reentering = true;
        let nativeDist;
        try {
            nativeDist = _protoCall([ray.A, ray.B], {})?.distance ?? rawDist;
        } finally {
            _reentering = false;
        }

        // Affiche : "(bord→bord + adjust) ft — natif ft"
        // La 1ère valeur est ce que midi-qol compare à la portée d'arme :
        //   bord→bord + adjust ≤ portée → attaque valide
        // Ex. tokens qui se touchent (bord=0, adjust=2.5) → "2,50 ft — X ft"
        // Ex. à 2.5ft de bord (adjust=2.5) → "5,00 ft — X ft" (exactement à portée)
        const adjust  = game.settings.get(_MODULE, "rangeAdjust") ?? 2.5;
        // -0.5 : correction d'affichage pour la règle uniquement (pas le check midi-qol).
        const adjDist = rawDist + adjust - 0.5;
        const fmt   = (n) => parseFloat(n.toFixed(2)).toLocaleString(game.i18n.lang);
        const units = context.distance.units ?? canvas.scene?.grid?.units ?? "ft";
        // Foundry ajoute `units` UNE FOIS après total → on insère l'unité sur la
        // 1ère valeur manuellement ; Foundry la rattachera au natif.
        // Résultat : "5,00 ft — 16,40 ft"
        context.distance.total = `${fmt(adjDist)} ${units} — ${fmt(nativeDist)}`;

        return context;
    }
    _rulerPatch[_PATCH_MARK] = true;
    _rulerPatch.__origFn     = _rulerOrigFn; // pour récupérer l'original si re-chargement

    RulerClass.prototype._getWaypointLabelContext = _rulerPatch;
    console.log("[midi-range-fix] Patch ruler label (ré)appliqué — ellipse actif.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks publics
// ─────────────────────────────────────────────────────────────────────────────
export function RangeFixHooks() {
    // canvasReady : patch initial après chaque chargement de scène.
    // setTimeout(0) : laisse les handlers canvasReady de midi-qol s'exécuter en premier.
    Hooks.on("canvasReady", () => {
        if (!game.modules.get("midi-qol")?.active) return;
        if (!game.settings.get(MOD, "rangeFixEnabled")) return;
        _stopPoll();
        setTimeout(() => {
            _installPatch();
            _startPoll();
            _patchRulerLabel(); // prototype patch, idempotent grâce au _PATCH_MARK
        }, 0);
    });

    // dnd5e.preUseItem : réinstalle juste avant chaque utilisation d'item,
    // et active le flag _inMidiWorkflow pour autoriser le fallback dans _ourPatch.
    // Le flag est remis à false après 500 ms (le check de portée midi-qol est
    // synchrone ou quasi-synchrone par rapport au hook).
    Hooks.on("dnd5e.preUseItem", () => {
        if (!canvas?.grid) return;
        if (!game.modules.get("midi-qol")?.active) return;
        if (!game.settings.get(MOD, "rangeFixEnabled")) return;
        _ensurePatch();
        _inMidiWorkflow = true;
        setTimeout(() => { _inMidiWorkflow = false; }, 500);
    });

    // canvasInit : arrête le polling (canvas en cours de démontage).
    Hooks.on("canvasInit", _stopPoll);
}

// ─────────────────────────────────────────────────────────────────────────────
// Gestion du patch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Installe le getter/setter sur canvas.grid.measurePath.
 * Capture la fonction actuelle (midi-qol) comme _trueOriginal si nécessaire.
 */
function _installPatch() {
    if (!canvas?.grid) return;

    // Lire la valeur actuelle via le descripteur (pas via le getter s'il est déjà le nôtre).
    const current = _readCurrentFn();

    // Mettre à jour _trueOriginal uniquement si la valeur courante n'est pas notre patch.
    if (current && !current[_PATCH_MARK]) {
        _trueOriginal = typeof current.bind === "function" ? current.bind(canvas.grid) : current;
    }

    if (!_trueOriginal || _trueOriginal[_PATCH_MARK]) {
        console.warn("[midi-range-fix] Impossible de trouver un fallback valide — patch annulé.");
        return;
    }

    try {
        Object.defineProperty(canvas.grid, "measurePath", {
            get: () => _ourPatch,
            set: (newFn) => {
                // Ignorer les réassignations à notre propre fonction (restauration circulaire).
                if (typeof newFn === "function" && !newFn[_PATCH_MARK]) {
                    _trueOriginal = newFn.bind(canvas.grid);
                }
            },
            configurable: true,
            enumerable:   true,
        });
        console.log("[midi-range-fix] Patch bord→bord actif.");
    } catch(e) {
        console.warn("[midi-range-fix] Object.defineProperty échoué, assignment direct :", e);
        try { canvas.grid.measurePath = _ourPatch; } catch {}
    }
}

/**
 * Vérifie si notre patch est toujours actif. Réinstalle si le descripteur est
 * devenu un value descriptor (remplacement via Object.defineProperty tiers).
 */
function _ensurePatch() {
    if (!canvas?.grid) return;
    if (_isPatchActive()) return;
    // Patch perdu → mettre à jour _trueOriginal et réinstaller.
    const current = _readCurrentFn();
    if (current && !current[_PATCH_MARK]) {
        _trueOriginal = typeof current.bind === "function" ? current.bind(canvas.grid) : current;
    }
    _installPatch();
    console.log("[midi-range-fix] Patch réinstallé (écrasement détecté).");
}

/**
 * Notre patch est actif si le descripteur de propriété est un accessor (get)
 * dont le getter retourne une fonction marquée _PATCH_MARK, ou si la valeur
 * directe est marquée _PATCH_MARK.
 */
function _isPatchActive() {
    const desc = Object.getOwnPropertyDescriptor(canvas.grid, "measurePath");
    if (!desc) return false;
    if (desc.get)   return desc.get()[_PATCH_MARK] === true;
    if (desc.value) return desc.value[_PATCH_MARK] === true;
    return false;
}

/**
 * Lit la fonction réellement assignée à canvas.grid.measurePath sans passer
 * par notre getter (on utilise le descripteur brut ou le prototype).
 */
function _readCurrentFn() {
    if (!canvas?.grid) return null;
    const desc = Object.getOwnPropertyDescriptor(canvas.grid, "measurePath");
    if (desc?.value) return desc.value;
    // Descripteur accessor : si c'est notre getter, on lit le prototype à la place.
    if (desc?.get) {
        const fromGetter = desc.get();
        if (fromGetter?.[_PATCH_MARK]) {
            // Notre getter est déjà là → lire le prototype pour le fallback d'origine.
            return Object.getPrototypeOf(canvas.grid)?.measurePath ?? null;
        }
        return fromGetter;
    }
    // Pas de propriété propre → lire le prototype.
    return Object.getPrototypeOf(canvas.grid)?.measurePath ?? null;
}

function _startPoll() {
    _pollInterval = setInterval(() => {
        if (!canvas?.grid) return;
        _ensurePatch();
    }, 2000);
}

function _stopPoll() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}

/**
 * Centre géométrique d'un token basé sur ses bounds pixel.
 * Contrairement à token.center qui renvoie le centre de la première case,
 * cette fonction renvoie le vrai centre de l'ensemble du token.
 */
function _boundsCenter(token) {
    const b = token.bounds;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Retourne le point le plus proche sur l'ELLIPSE du token depuis src.
 *
 * Les tokens Foundry sont affichés comme des cercles/ellipses (portrait rond),
 * pas comme des rectangles. Utiliser la bounding box sur-estimait la distance
 * en approche diagonale d'un grand token (coin du rectangle > bord de l'ellipse).
 *
 * Méthode : on normalise le vecteur src→centre dans l'espace de l'ellipse
 * (÷ demi-axes), puis on le ramène sur le bord de l'ellipse (× demi-axes).
 * Exact pour les tokens carrés (cercle). Approximation correcte sinon.
 *
 * Cas limite : src au centre → on retourne le bord droit (distance = 0 de
 * toute façon, cas non rencontré en pratique).
 */
function _nearestEllipsePoint(src, token) {
    const b  = token.bounds;
    const cx = b.x + b.width  / 2;
    const cy = b.y + b.height / 2;
    const rx = b.width  / 2;
    const ry = b.height / 2;

    const dx = src.x - cx;
    const dy = src.y - cy;

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
        return { x: cx + rx, y: cy };
    }

    // Normaliser dans l'espace de l'ellipse, projeter sur le bord
    const nx   = dx / rx;
    const ny   = dy / ry;
    const nlen = Math.sqrt(nx * nx + ny * ny);
    return {
        x: cx + (nx / nlen) * rx,
        y: cy + (ny / nlen) * ry,
    };
}
