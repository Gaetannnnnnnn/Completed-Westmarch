// ============================================================
// map.js — Carte des expéditions : BROUILLARD MAISON par personnage
//
// Contrairement au brouillard natif de Foundry (une seule fog par compte,
// impossible à isoler par perso), on gère tout nous-mêmes :
//   - les zones révélées sont stockées PAR PERSONNAGE (flag exploredHexes,
//     un ensemble de clés de case hex "i.j") ;
//   - chaque client dessine son propre calque noir par-dessus la carte, avec
//     des trous aux cases explorées du PERSO qu'il joue → isolation parfaite ;
//   - le MJ révèle en déplaçant un token de GROUPE : les cases parcourues
//     (+ un rayon réglable) s'ajoutent aux persos MEMBRES du groupe.
//
// La vision/brouillard natifs de la scène sont désactivés (on les remplace).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const FLAG_EXPLORED = "exploredHexes";           // sur l'acteur personnage
const TEMPLATE_GROUP_NAME = "Token à copier et rennomer";

const enabled  = () => game.settings.get(MOD, "enableExpeditionMap");
const sceneId  = () => game.settings.get(MOD, "expeditionMapSceneId");
const onExpeditionCanvas = () => enabled() && sceneId() && canvas?.scene?.id === sceneId();

// Positions précédentes des tokens (pour tracer le trajet au déplacement).
const _prevCenter = new Map();

export function MapHooks() {

    Hooks.once("ready", async () => {
        // Expose la réinitialisation pour la console : game.modules.get("…").api.resetExpeditionFog()
        const mod = game.modules.get(MOD);
        if (mod) mod.api = { ...(mod.api ?? {}), resetExpeditionFog };
        if (!enabled() || !game.user.isGM) return;
        await ensureTemplateGroupActor();
        await removeLegacyAnchor();
        await disableNativeSceneFog();
    });

    // Mémorise la position AVANT déplacement (pour tracer le trajet).
    Hooks.on("preUpdateToken", (tokenDoc, changes) => {
        if (!game.user.isGM || !enabled()) return;
        if (!("x" in changes || "y" in changes)) return;
        if (tokenDoc.parent?.id !== sceneId() || tokenDoc.actor?.type !== "group") return;
        _prevCenter.set(tokenDoc.id, tokenCenter(tokenDoc));
    });

    // Déplacement d'un token de GROUPE → révèle les cases du trajet pour ses membres.
    Hooks.on("updateToken", async (tokenDoc, changes) => {
        if (!game.user.isGM || !enabled()) return;
        if (!("x" in changes || "y" in changes)) return;
        if (tokenDoc.parent?.id !== sceneId() || tokenDoc.actor?.type !== "group") return;
        await revealForGroupMove(tokenDoc);
    });

    // ---- Rendu du calque (tous les clients) ----
    Hooks.on("canvasReady", () => drawFog());
    Hooks.on("updateActor", (actor, changes) => {
        if (!foundry.utils.hasProperty(changes, `flags.${MOD}.${FLAG_EXPLORED}`)) return;
        if (actor.id === game.user.character?.id) drawFog();
    });
    Hooks.on("updateUser", (user, changes) => {
        if (user.id === game.user.id && "character" in changes) drawFog();
    });
}

// ============================================================
// Géométrie hex
// ============================================================
function tokenCenter(tokenDoc) {
    const w = (tokenDoc.width ?? 1) * canvas.grid.sizeX;
    const h = (tokenDoc.height ?? 1) * canvas.grid.sizeY;
    return { x: tokenDoc.x + w / 2, y: tokenDoc.y + h / 2 };
}

function hexKey(offset) { return `${offset.i}.${offset.j}`; }

// Voisins immédiats d'une case (échantillonne 6 directions autour du centre).
function neighborOffsets(offset) {
    const c = canvas.grid.getCenterPoint(offset);
    const r = canvas.grid.size;
    const out = [];
    for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        const off = canvas.grid.getOffset({ x: c.x + r * Math.cos(rad), y: c.y + r * Math.sin(rad) });
        out.push(off);
    }
    return out;
}

// Toutes les cases dans un rayon de `radius` anneaux autour d'une case (BFS).
function hexesWithinRadius(centerOffset, radius) {
    const seen = new Set([hexKey(centerOffset)]);
    const result = [centerOffset];
    let frontier = [centerOffset];
    for (let ring = 0; ring < radius; ring++) {
        const next = [];
        for (const o of frontier) {
            for (const n of neighborOffsets(o)) {
                const k = hexKey(n);
                if (!seen.has(k)) { seen.add(k); result.push(n); next.push(n); }
            }
        }
        frontier = next;
    }
    return result;
}

// Cases traversées par le déplacement (échantillonnage de la ligne) + rayon.
function revealedHexKeys(fromCenter, toCenter, radius) {
    const keys = new Set();
    const step = canvas.grid.size / 2;
    const dx = toCenter.x - fromCenter.x, dy = toCenter.y - fromCenter.y;
    const dist = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let s = 0; s <= n; s++) {
        const p = { x: fromCenter.x + (dx * s) / n, y: fromCenter.y + (dy * s) / n };
        const off = canvas.grid.getOffset(p);
        for (const h of hexesWithinRadius(off, radius)) keys.add(hexKey(h));
    }
    return [...keys];
}

// ============================================================
// Révélation (MJ)
// ============================================================
async function revealForGroupMove(tokenDoc) {
    const from = _prevCenter.get(tokenDoc.id) ?? tokenCenter(tokenDoc);
    const to = tokenCenter(tokenDoc);
    _prevCenter.delete(tokenDoc.id);

    const radius = Math.max(0, Number(game.settings.get(MOD, "expeditionRevealRadius")) || 0);
    const keys = revealedHexKeys(from, to, radius);
    if (!keys.length) return;

    const memberIds = Array.from(tokenDoc.actor?.system?.members?.ids ?? []);
    for (const charId of memberIds) {
        const actor = game.actors.get(charId);
        if (!actor) continue;
        const prev = new Set(actor.getFlag(MOD, FLAG_EXPLORED) ?? []);
        let changed = false;
        for (const k of keys) if (!prev.has(k)) { prev.add(k); changed = true; }
        if (changed) await actor.setFlag(MOD, FLAG_EXPLORED, [...prev]);
    }
    console.log(`[CE] révélation : ${keys.length} cases pour ${memberIds.length} membre(s)`);
}

// ============================================================
// Rendu du calque de brouillard (par client)
// ============================================================
let _fogLayer = null;

function clearFogLayer() {
    if (_fogLayer) { try { _fogLayer.destroy({ children: true }); } catch (e) {} _fogLayer = null; }
}

function drawFog() {
    clearFogLayer();
    if (!onExpeditionCanvas()) return;
    if (game.user.isGM) return;                       // le MJ voit toute la carte

    const char = game.user.character;
    const explored = new Set(char?.getFlag(MOD, FLAG_EXPLORED) ?? []);

    const d = canvas.dimensions;
    const g = new PIXI.Graphics();
    g.eventMode = "none";
    g.beginFill(0x000000, 1);
    g.drawRect(d.sceneX, d.sceneY, d.sceneWidth, d.sceneHeight);
    if (explored.size) {
        g.beginHole();
        for (const key of explored) {
            const [i, j] = key.split(".").map(Number);
            const verts = canvas.grid.getVertices({ i, j });
            if (verts?.length) g.drawPolygon(verts.flatMap(p => [p.x, p.y]));
        }
        g.endHole();
    }
    g.endFill();
    g.zIndex = 900;
    _fogLayer = g;
    (canvas.interface ?? canvas.stage).addChild(g);
}

// ============================================================
// Acteur Groupe « modèle » (à copier / renommer) — inchangé côté usage,
// sert juste à donner un token de groupe prêt (Members = PJ assignés).
// ============================================================
async function resolveTemplateFolderId() {
    const val = game.settings.get(MOD, "expeditionMapTemplateFolder");
    if (!val) return null;
    const looksLikeId = (s) => /^[A-Za-z0-9]{16}$/.test(s ?? "");
    const byId = game.folders?.get(val);
    if (byId?.type === "Actor") return byId.id;
    if (!looksLikeId(val)) {
        const byName = game.folders?.find(f => f.type === "Actor" && f.name === val);
        if (byName) return byName.id;
        const created = await Folder.create({ name: val, type: "Actor" });
        return created?.id ?? null;
    }
    return null;
}

async function ensureTemplateGroupActor() {
    let actor = game.actors.find(a => a.type === "group" && a.getFlag(MOD, "templateGroupToken") === true);
    if (!actor) {
        if (game.actors.find(a => a.type === "group" && a.name === TEMPLATE_GROUP_NAME)) return null;
        try {
            const folderId = await resolveTemplateFolderId();
            actor = await Actor.create({
                name: TEMPLATE_GROUP_NAME,
                type: "group",
                folder: folderId ?? null,
                flags: { [MOD]: { templateGroupToken: true } },
                prototypeToken: {
                    name: TEMPLATE_GROUP_NAME,
                    actorLink: false,
                    sight: { enabled: false },
                    disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
                    displayName: CONST.TOKEN_DISPLAY_MODES.HOVER
                }
            });
            console.log(`[${MOD}] Acteur Groupe modèle « ${TEMPLATE_GROUP_NAME} » créé.`);
        } catch (e) {
            console.warn(`[${MOD}] Création de l'acteur Groupe modèle échouée :`, e);
            return null;
        }
    }
    if (!actor) return null;

    const scene = sceneId() ? game.scenes.get(sceneId()) : null;
    if (scene && !scene.tokens.some(t => t.actorId === actor.id)) {
        try {
            const x = Math.round((scene.width ?? 1000) / 2);
            const y = Math.round((scene.height ?? 1000) / 2);
            const tokenDoc = await actor.getTokenDocument({ x, y });
            await scene.createEmbeddedDocuments("Token", [tokenDoc.toObject()]);
        } catch (e) { console.warn(`[${MOD}] Dépôt du token Groupe modèle échoué :`, e); }
    }
    return actor;
}

// Supprime l'ancien acteur « Ancre de vision » (plus nécessaire avec le fog maison).
async function removeLegacyAnchor() {
    const anchors = game.actors.filter(a => a.getFlag(MOD, "visionAnchor") === true);
    for (const a of anchors) {
        try { await a.delete(); console.log(`[${MOD}] Ancre de vision obsolète supprimée.`); }
        catch (e) { console.warn(`[${MOD}] Suppression ancre échouée :`, e); }
    }
}

// Désactive la vision/brouillard NATIFS sur la scène (on gère nous-mêmes).
async function disableNativeSceneFog() {
    const scene = sceneId() ? game.scenes.get(sceneId()) : null;
    if (!scene) return;
    const upd = {};
    if (scene.tokenVision) upd.tokenVision = false;
    if (scene.fog?.exploration) upd["fog.exploration"] = false;
    if (Object.keys(upd).length) {
        try { await scene.update(upd); console.log(`[${MOD}] Vision/brouillard natifs désactivés sur la scène de la carte.`); }
        catch (e) { console.warn(`[${MOD}] Désactivation vision native échouée :`, e); }
    }
}

// ============================================================
// API MJ (console) : réinitialiser les zones explorées
// ============================================================
export async function resetExpeditionFog() {
    if (!game.user.isGM) return;
    for (const a of game.actors.filter(a => a.type === "character")) {
        if (a.getFlag(MOD, FLAG_EXPLORED)) await a.unsetFlag(MOD, FLAG_EXPLORED);
    }
    drawFog();
    ui.notifications?.info("Brouillard d'expédition réinitialisé (toutes les zones explorées effacées).");
}
