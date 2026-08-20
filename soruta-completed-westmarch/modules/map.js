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
    // Zones toujours éclairées modifiées → tous les clients redessinent.
    Hooks.on("updateSetting", (setting) => {
        if (setting?.key === `${MOD}.expeditionRevealedZones`) drawFog();
    });

    // ---- Duplication d'un token/acteur de groupe modèle → fenêtre de renommage ----
    // Le modèle porte le flag templateGroupToken. Sa COPIE le porte aussi : on la
    // détecte (il existe alors 2+ acteurs avec ce flag), on propose un renommage,
    // et on retire le flag de la copie (elle devient un vrai groupe d'expédition).
    Hooks.on("createActor", async (actor, options, userId) => {
        if (!game.user.isGM || userId !== game.user.id) return;
        if (actor.type !== "group") return;
        if (actor.getFlag(MOD, "templateGroupToken") !== true) return;
        const templates = game.actors.filter(a => a.type === "group" && a.getFlag(MOD, "templateGroupToken") === true);
        if (templates.length <= 1) return;   // c'est le modèle unique (créé par le module)
        await promptRenameGroup(actor);       // c'est une copie du modèle
    });

    // ---- Bouton MJ : réinitialiser le brouillard (onglet WestMarch) ----
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM || !enabled()) return;
        if (!controls.westmarch) {
            controls.westmarch = { name: "westmarch", title: "WestMarch", icon: "fa-solid fa-hammer", layer: "tokens", tools: {} };
        }
        controls.westmarch.tools.scwmFogReset = {
            name: "scwmFogReset",
            title: "Carte d'expédition — Réinitialiser le brouillard",
            icon: "fas fa-eraser",
            button: true,
            visible: true,
            onChange: () => openFogResetDialog()
        };
        controls.westmarch.tools.scwmLightZone = {
            name: "scwmLightZone",
            title: "Carte d'expédition — Éclairer une zone (villes) : clic gauche = éclairer, clic droit = masquer",
            icon: "fas fa-city",
            toggle: true,
            active: _paintMode,
            visible: true,
            onChange: (event, active) => setPaintMode(active)
        };
    });

    // Écouteur de peinture (une fois par canvas prêt).
    Hooks.on("canvasReady", () => {
        const view = canvas?.app?.view;
        if (!view) return;
        view.removeEventListener("pointerdown", onPaintPointerDown, true);
        view.addEventListener("pointerdown", onPaintPointerDown, true);
    });
}

// ============================================================
// Zones toujours éclairées (villes) — peinture MJ
// ============================================================
let _paintMode = false;

function setPaintMode(on) {
    _paintMode = !!on;
    ui.notifications?.info(_paintMode
        ? "Éclairage permanent : clic GAUCHE = éclairer une case, clic DROIT = masquer."
        : "Éclairage permanent désactivé.");
    drawFog();   // (ré)affiche le repère des zones éclairées côté MJ
}

function globalZones() {
    const z = game.settings.get(MOD, "expeditionRevealedZones");
    return Array.isArray(z) ? z : [];
}

async function onPaintPointerDown(ev) {
    if (!_paintMode || !game.user.isGM) return;
    if (!onExpeditionCanvas()) return;
    if (ev.button !== 0 && ev.button !== 2) return;
    ev.preventDefault();
    ev.stopPropagation();

    const rect = canvas.app.view.getBoundingClientRect();
    const world = canvas.stage.toLocal(new PIXI.Point(ev.clientX - rect.left, ev.clientY - rect.top));
    const key = hexKey(canvas.grid.getOffset(world));

    const set = new Set(globalZones());
    if (ev.button === 0) set.add(key); else set.delete(key);   // gauche éclaire, droit masque
    await game.settings.set(MOD, "expeditionRevealedZones", [...set]);
    // Le hook updateSetting n'existe pas partout → on redessine directement + broadcast implicite
    drawFog();
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

function drawHexInto(g, key) {
    const [i, j] = key.split(".").map(Number);
    const verts = canvas.grid.getVertices({ i, j });
    if (verts?.length) g.drawPolygon(verts.flatMap(p => [p.x, p.y]));
}

function drawFog() {
    clearFogLayer();
    if (!onExpeditionCanvas()) return;
    const zones = globalZones();

    // Le MJ voit toute la carte : on lui montre juste un repère (jaune pâle) des
    // zones éclairées en permanence (villes), pour savoir ce qui est marqué.
    if (game.user.isGM) {
        if (!zones.length) return;
        const g = new PIXI.Graphics();
        g.eventMode = "none";
        g.beginFill(0xffcc00, 0.15);
        for (const key of zones) drawHexInto(g, key);
        g.endFill();
        g.zIndex = 900;
        _fogLayer = g;
        (canvas.interface ?? canvas.stage).addChild(g);
        return;
    }

    // Joueur : noir partout, trous aux cases explorées de son perso + villes globales.
    const char = game.user.character;
    const explored = new Set(char?.getFlag(MOD, FLAG_EXPLORED) ?? []);
    for (const z of zones) explored.add(z);   // zones toujours éclairées, visibles par tous

    const d = canvas.dimensions;
    const g = new PIXI.Graphics();
    g.eventMode = "none";
    g.beginFill(0x000000, 1);
    g.drawRect(d.sceneX, d.sceneY, d.sceneWidth, d.sceneHeight);
    if (explored.size) {
        g.beginHole();
        for (const key of explored) drawHexInto(g, key);
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
// Réinitialisation du brouillard
// ============================================================
const _esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function resetOneCharFog(actorId) {
    if (!game.user.isGM) return;
    const actor = game.actors.get(actorId);
    if (actor?.getFlag(MOD, FLAG_EXPLORED)) await actor.unsetFlag(MOD, FLAG_EXPLORED);
    drawFog();
}

// API console : game.modules.get("soruta-completed-westmarch").api.resetExpeditionFog()
export async function resetExpeditionFog() {
    if (!game.user.isGM) return;
    for (const a of game.actors.filter(a => a.type === "character")) {
        if (a.getFlag(MOD, FLAG_EXPLORED)) await a.unsetFlag(MOD, FLAG_EXPLORED);
    }
    drawFog();
}

// Renomme un groupe fraîchement dupliqué : applique le nom à la fiche (acteur)
// ET au prototype token, puis retire le flag « modèle » de la copie.
async function promptRenameGroup(actor) {
    const DialogV2 = foundry.applications.api.DialogV2;
    const suggested = actor.name?.replace(/\s*\(Copy\)\s*$/i, "").replace(/\s*\(copie\)\s*$/i, "") ?? "";

    const name = await DialogV2.wait({
        window: { title: "Nommer le groupe d'expédition", icon: "fas fa-flag" },
        position: { width: 420 },
        content: `<p style="margin:0 0 6px;">Nom du nouveau groupe (appliqué à la fiche et au prototype token) :</p>
                  <input type="text" name="scwm-gname" style="width:100%;" value="${_esc(suggested)}" placeholder="Nom du groupe" autofocus>`,
        rejectClose: false,
        buttons: [
            { action: "ok", label: "Renommer", icon: "fas fa-check", default: true,
              callback: (ev, btn) => (btn.form.elements["scwm-gname"]?.value ?? "").trim() },
            { action: "skip", label: "Garder tel quel", icon: "fas fa-xmark", callback: () => null }
        ]
    }).catch(() => null);

    const update = { [`flags.${MOD}.-=templateGroupToken`]: null };   // la copie n'est plus un « modèle »
    if (name) { update.name = name; update["prototypeToken.name"] = name; }
    try { await actor.update(update); }
    catch (e) { console.warn(`[${MOD}] Renommage du groupe échoué :`, e); }
}

async function openFogResetDialog() {
    if (!game.user.isGM) return;
    const DialogV2 = foundry.applications.api.DialogV2;

    const chars = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner)
        .sort((a, b) => a.name.localeCompare(b.name));
    const options = chars.length
        ? chars.map(a => `<option value="${a.id}">${_esc(a.name)}</option>`).join("")
        : `<option value="">(aucun personnage joueur)</option>`;

    const content = `
    <div style="display:flex;flex-direction:column;gap:10px;">
        <p style="margin:0;">Réinitialise le brouillard d'exploration de la carte des expéditions.</p>
        <div>
            <label style="font-weight:600;">Personnage :</label>
            <select name="scwm-fog-char" style="width:100%;">${options}</select>
        </div>
        <p style="margin:0;font-size:.85em;color:#c0392b;">
            <i class="fas fa-triangle-exclamation"></i> Action <strong>irréversible</strong> : les zones explorées effacées ne peuvent pas être récupérées.
        </p>
    </div>`;

    const action = await DialogV2.wait({
        window: { title: "Réinitialiser le brouillard d'expédition", icon: "fas fa-eraser" },
        position: { width: 460 },
        content,
        rejectClose: false,
        buttons: [
            { action: "one", label: "Réinitialiser CE personnage", icon: "fas fa-user",
              callback: (ev, btn) => ({ type: "one", id: btn.form.elements["scwm-fog-char"]?.value }) },
            { action: "all", label: "Réinitialiser TOUT LE MONDE", icon: "fas fa-triangle-exclamation",
              callback: () => ({ type: "all" }) },
            { action: "cancel", label: "Annuler", icon: "fas fa-xmark", callback: () => null }
        ]
    }).catch(() => null);
    if (!action) return;

    // ---- Un seul personnage ----
    if (action.type === "one") {
        const actor = game.actors.get(action.id);
        if (!actor) { ui.notifications?.warn("Aucun personnage sélectionné."); return; }
        const ok = await DialogV2.confirm({
            window: { title: "Confirmer" },
            content: `<p>Effacer toutes les zones explorées de <strong>${_esc(actor.name)}</strong> ?</p>
                      <p style="color:#c0392b;">Ce joueur reverra sa carte entièrement noire jusqu'à ré-exploration. Irréversible.</p>`,
            rejectClose: false
        }).catch(() => false);
        if (ok) { await resetOneCharFog(action.id); ui.notifications?.info(`Brouillard réinitialisé pour ${actor.name}.`); }
        return;
    }

    // ---- Tout le monde : plusieurs avertissements + confirmation à taper ----
    const w1 = await DialogV2.confirm({
        window: { title: "⚠️ Réinitialiser TOUT LE MONDE" },
        content: `<p>Tu es sur le point d'effacer le brouillard exploré de <strong>TOUS les personnages</strong> du serveur.</p>
                  <p style="color:#c0392b;">Chaque joueur reverra la carte <strong>entièrement noire</strong> jusqu'à ce qu'elle soit ré-explorée.</p>`,
        rejectClose: false
    }).catch(() => false);
    if (!w1) return;

    const w2 = await DialogV2.confirm({
        window: { title: "⚠️ Action DÉFINITIVE" },
        content: `<p style="color:#c0392b;font-weight:700;">Cette action est irréversible et NON annulable.</p>
                  <p>Toute la progression d'exploration de la campagne sera perdue pour l'ensemble des personnages.</p>
                  <p>Veux-tu vraiment continuer ?</p>`,
        rejectClose: false
    }).catch(() => false);
    if (!w2) return;

    const typed = await DialogV2.wait({
        window: { title: "Confirmation finale" },
        content: `<p>Pour confirmer la réinitialisation <strong>totale</strong>, tape <code>RESET</code> ci-dessous :</p>
                  <input type="text" name="scwm-confirm" style="width:100%;" placeholder="RESET" autofocus>`,
        rejectClose: false,
        buttons: [
            { action: "ok", label: "Réinitialiser TOUT", icon: "fas fa-eraser", default: true,
              callback: (ev, btn) => (btn.form.elements["scwm-confirm"]?.value ?? "").trim() },
            { action: "cancel", label: "Annuler", icon: "fas fa-xmark", callback: () => null }
        ]
    }).catch(() => null);

    if (typed !== "RESET") { ui.notifications?.warn("Réinitialisation annulée (confirmation incorrecte)."); return; }

    await resetExpeditionFog();
    ui.notifications?.info("Brouillard d'expédition réinitialisé pour tout le monde.");
}
