// ============================================================
// harvest.js — Récolte (harvest) sur les créatures mortes
//
// Principe : on cible une créature MORTE et on utilise l'outil « Récolter ».
// Le module tire UNE FOIS sur une RollTable (fournie et associée par le MJ) pour
// générer le « tas » de butin de la dépouille, puis ouvre une fenêtre de butin.
// Le joueur prend ce qu'il veut ; ce qui reste demeure sur la dépouille pour les
// autres. Dépouille entièrement vidée → token supprimé + tache de sang.
// La dépouille POURRIT avec le temps (frais → en décomposition → pourri) ; l'état
// s'affiche au survol du token.
//
// Le module NE FOURNIT PAS de tables : le MJ crée ses RollTables et les associe
// aux créatures (par type ou par nom) via la fenêtre « Associations » (WestMarch).
//
// Les écritures sur les tokens/créatures passent par un GM (queries v13), car les
// joueurs n'ont pas les droits d'éditer une dépouille.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const enabled = () => game.settings.get(MOD, "enableHarvest");
const sc = (k) => game.settings.get(MOD, k);

// ------------------------------------------------------------
export function HarvestHooks() {
    // Nettoyage : retire d'éventuelles aptitudes « Récolter » créées par une
    // ancienne version (le déclencheur est désormais le bouton de la barre).
    Hooks.once("ready", () => cleanupHarvestFeatures());

    if (!enabled()) return;

    // Queries traitées par le MJ (écriture sur la dépouille + distribution).
    CONFIG.queries["westmarch.harvestGenerate"] = gmGenerate;
    CONFIG.queries["westmarch.harvestTake"]     = gmTake;

    // Boutons : Récolter (tous) + Associations & État de dépouille (MJ).
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!controls.westmarch) {
            controls.westmarch = { name: "westmarch", title: "WestMarch", icon: "fa-solid fa-hammer", layer: "tokens", tools: {} };
        }
        controls.westmarch.tools.scwmHarvest = {
            name: "scwmHarvest", title: "Récolter la créature ciblée", icon: "fas fa-hand-holding-medical",
            button: true, visible: true, onChange: () => harvestTargeted()
        };
        if (game.user.isGM) {
            controls.westmarch.tools.scwmHarvestState = {
                name: "scwmHarvestState", title: "Récolte — Régler l'état de la dépouille sélectionnée",
                icon: "fas fa-droplet", button: true, visible: true, onChange: () => openStateDialog()
            };
            controls.westmarch.tools.scwmHarvestConfig = {
                name: "scwmHarvestConfig", title: "Récolte — Associer les créatures aux RollTables", icon: "fas fa-sitemap",
                button: true, visible: true, onChange: () => openHarvestConfig()
            };
        }
    });

    // État de pourriture au survol du token.
    Hooks.on("hoverToken", (token, hovered) => drawRotLabel(token, hovered));
}

// ============================================================
// Utilitaires créature
// ============================================================
const crOf   = (actor) => Number(actor?.system?.details?.cr ?? 0) || 0;
const typeOf = (actor) => actor?.system?.details?.type?.value ?? "";
const isDead = (actor) => (actor?.system?.attributes?.hp?.value ?? 1) <= 0;

// TokenDocument d'un token sur une scène.
function getTokenDoc(sceneId, tokenId) {
    const scene = game.scenes.get(sceneId);
    return scene?.tokens?.get(tokenId) ?? null;
}

// Résout la RollTable associée : flag sur l'acteur → nom → type.
function resolveTable(actor) {
    const maps = sc("harvestTables") ?? { byType: {}, byName: {} };
    const perActor = actor.getFlag?.(MOD, "harvestTableId");
    const byName = maps.byName?.[actor.name];
    const byType = maps.byType?.[typeOf(actor)];
    const id = perActor || byName || byType;
    return id ? game.tables.get(id) : null;
}

// État MANUEL de la dépouille. Défaut : fraîche — sauf morts-vivants → pourrie.
// États : "fresh" (butin complet), "damaged" (butin réduit), "rotten" (rien).
const STATE_LABELS = { fresh: "Dépouille fraîche", damaged: "Dépouille abîmée", rotten: "Pourrie (rien à récolter)" };
const STATE_COLORS = { fresh: "#8fd19e", damaged: "#e0a13a", rotten: "#e58f8f" };

function harvestState(actor, tokenDoc) {
    const explicit = tokenDoc?.getFlag(MOD, "harvestState");
    if (explicit) return explicit;
    return typeOf(actor) === "undead" ? "rotten" : "fresh";   // défaut selon le type
}

// ============================================================
// Récolte — côté joueur (déclencheur)
// ============================================================
async function harvestTargeted(harvesterOverride = null) {
    if (!enabled()) return;
    const target = [...(game.user.targets ?? [])][0];
    if (!target) { ui.notifications?.warn("Ciblez d'abord une créature (touche T) avant de récolter."); return; }
    const tokenDoc = target.document;
    const actor = target.actor;
    if (!actor || actor.type !== "npc") { ui.notifications?.warn("Cette cible n'est pas une créature récoltable."); return; }
    if (!isDead(actor)) { ui.notifications?.warn(`${actor.name} n'est pas morte.`); return; }

    const state = harvestState(actor, tokenDoc);
    if (state === "rotten") { ui.notifications?.warn(`${actor.name} est pourrie : plus rien à récolter.`); return; }

    const harvester = (harvesterOverride instanceof Actor ? harvesterOverride : null) ?? harvesterActor();

    // Déjà récoltée (butin généré) → on ouvre directement la fenêtre.
    if (tokenDoc.getFlag(MOD, "harvestGenerated")) { openLootWindow(tokenDoc.parent.id, tokenDoc.id, harvester?.id ?? null); return; }

    if (!resolveTable(actor)) {
        ui.notifications?.warn(`Aucune table de récolte associée à ${actor.name} (le MJ doit l'associer).`);
        return;
    }

    // Jet de compétence du récolteur (fait localement, l'acteur lui appartient).
    if (!harvester) { ui.notifications?.warn("Sélectionnez votre personnage (token) pour effectuer le jet de récolte."); return; }
    const skill = sc("harvestSkill") || "sur";
    const mod = harvester.system?.skills?.[skill]?.total ?? 0;
    const roll = await new Roll("1d20 + @m", { m: mod }).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: harvester }), flavor: `Récolte — jet de ${CONFIG.DND5E.skills[skill]?.label ?? skill}` });

    // Génération côté MJ (écriture sur la dépouille).
    const gm = game.users.activeGM;
    if (!gm) { ui.notifications?.warn("Aucun MJ connecté : la récolte nécessite un MJ en ligne."); return; }
    const res = await gm.query("westmarch.harvestGenerate", {
        sceneId: tokenDoc.parent.id, tokenId: tokenDoc.id, total: roll.total
    }).catch(() => null);
    if (!res?.ok) { ui.notifications?.warn(res?.msg ?? "Échec de la récolte."); return; }
    openLootWindow(tokenDoc.parent.id, tokenDoc.id, harvester?.id ?? null);
}

// Nettoie les aptitudes « Récolter » créées par une ancienne version.
async function cleanupHarvestFeatures() {
    if (!game.user.isGM) return;
    for (const a of game.actors) {
        const it = a.items?.filter(i => i.getFlag(MOD, "harvestFeature") === true) ?? [];
        if (it.length) { try { await a.deleteEmbeddedDocuments("Item", it.map(i => i.id)); } catch (e) {} }
    }
}

function harvesterActor() {
    return canvas.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
}

// ============================================================
// Génération du butin — côté MJ (query)
// ============================================================
async function gmGenerate({ sceneId, tokenId, total }) {
    try {
        const tokenDoc = getTokenDoc(sceneId, tokenId);
        const actor = tokenDoc?.actor;
        if (!tokenDoc || !actor) return { ok: false, msg: "Dépouille introuvable." };
        if (tokenDoc.getFlag(MOD, "harvestGenerated")) return { ok: true };

        const state = harvestState(actor, tokenDoc);
        if (state === "rotten") return { ok: false, msg: "Dépouille pourrie : rien à récolter." };

        const table = resolveTable(actor);
        if (!table) return { ok: false, msg: "Aucune table associée." };

        const dc = Math.round((sc("harvestDcBase") || 10) + crOf(actor) * (sc("harvestDcPerCr") || 0));
        let draws = (total >= dc) ? (sc("harvestBaseDraws") || 2) + Math.floor((total - dc) / 5) : 1;
        if (state === "damaged") draws = Math.max(1, Math.floor(draws / 2));   // abîmée = butin réduit
        draws = Math.max(1, draws);

        const loot = [];
        for (let i = 0; i < draws; i++) {
            const { results } = await table.roll();
            for (const r of (results ?? [])) {
                const item = await resultToItem(r);
                const entry = item
                    ? { uuid: item.uuid, name: item.name, img: item.img, qty: 1 }
                    : { uuid: null, name: r.text ?? r.name ?? "Objet", img: r.icon ?? r.img ?? "icons/svg/item-bag.svg", qty: 1 };
                const ex = loot.find(l => l.uuid === entry.uuid && l.name === entry.name);
                if (ex) ex.qty += 1; else loot.push(entry);
            }
        }

        await tokenDoc.update({ [`flags.${MOD}.harvestGenerated`]: true, [`flags.${MOD}.harvestLoot`]: loot });
        return { ok: true, loot };
    } catch (e) { console.warn(`[${MOD}] harvestGenerate:`, e); return { ok: false, msg: "Erreur de génération." }; }
}

async function resultToItem(result) {
    try {
        if (result.documentUuid) return await fromUuid(result.documentUuid);
        const coll = result.documentCollection, id = result.documentId;
        if (!coll || !id) return null;
        if (coll === "Item") return game.items.get(id) ?? null;
        const pack = game.packs.get(coll);
        return pack ? await pack.getDocument(id) : null;
    } catch (e) { return null; }
}

// ============================================================
// Fenêtre de butin
// ============================================================
async function openLootWindow(sceneId, tokenId, harvesterId = null) {
    const tokenDoc = getTokenDoc(sceneId, tokenId);
    if (!tokenDoc) return;
    const loot = tokenDoc.getFlag(MOD, "harvestLoot") ?? [];
    if (!loot.length) { ui.notifications?.info("Cette dépouille ne contient plus rien."); return; }

    const rows = loot.map((l, i) => `
        <label style="display:flex;align-items:center;gap:8px;padding:4px 2px;border-bottom:1px solid rgba(255,255,255,.06);">
            <input type="checkbox" name="take" value="${i}" checked>
            <img src="${l.img}" width="28" height="28" style="border:none;flex:0 0 auto;">
            <span style="flex:1 1 auto;">${l.name}</span>
            <input type="number" name="qty-${i}" value="${l.qty}" min="0" max="${l.qty}" style="width:56px;"> / ${l.qty}
        </label>`).join("");

    const DialogV2 = foundry.applications.api.DialogV2;
    const picked = await DialogV2.wait({
        window: { title: `Récolter — ${tokenDoc.name}`, icon: "fas fa-hand-holding-medical" },
        position: { width: 420 },
        content: `<p style="margin:0 0 6px;font-size:.9em;">Choisissez ce que vous prenez. Ce qui reste demeure sur la dépouille pour les autres.</p>${rows}`,
        rejectClose: false,
        buttons: [
            { action: "take", label: "Prendre", icon: "fas fa-hand-holding", default: true,
              callback: (ev, btn) => {
                  const out = [];
                  btn.form.querySelectorAll('input[name="take"]:checked').forEach(cb => {
                      const i = Number(cb.value);
                      const q = Math.max(0, Math.min(loot[i].qty, Number(btn.form.elements[`qty-${i}`]?.value) || 0));
                      if (q > 0) out.push({ index: i, qty: q });
                  });
                  return out;
              } },
            { action: "close", label: "Laisser", icon: "fas fa-xmark", callback: () => null }
        ]
    }).catch(() => null);

    if (!picked || !picked.length) return;

    const harvester = (harvesterId ? game.actors.get(harvesterId) : null) ?? harvesterActor();
    const gm = game.users.activeGM;
    if (!gm) { ui.notifications?.warn("Aucun MJ connecté."); return; }
    const res = await gm.query("westmarch.harvestTake", {
        sceneId, tokenId, taken: picked, harvesterActorId: harvester?.id ?? null
    }).catch(() => null);
    if (!res?.ok) { ui.notifications?.warn(res?.msg ?? "Échec de la prise."); return; }
    if (res.emptied) ui.notifications?.info(`${tokenDoc.name} a été entièrement récoltée.`);
    else ui.notifications?.info("Butin récolté.");
}

// ============================================================
// Prise du butin — côté MJ (query)
// ============================================================
async function gmTake({ sceneId, tokenId, taken, harvesterActorId }) {
    try {
        const tokenDoc = getTokenDoc(sceneId, tokenId);
        if (!tokenDoc) return { ok: false, msg: "Dépouille introuvable." };
        const loot = foundry.utils.deepClone(tokenDoc.getFlag(MOD, "harvestLoot") ?? []);
        const harvester = harvesterActorId ? game.actors.get(harvesterActorId) : null;

        const toCreate = [];
        for (const t of (taken ?? [])) {
            const entry = loot[t.index];
            if (!entry) continue;
            const q = Math.max(0, Math.min(entry.qty, t.qty));
            if (q <= 0) continue;
            if (entry.uuid) {
                const item = await fromUuid(entry.uuid);
                if (item) { const obj = item.toObject(); if ("quantity" in (obj.system ?? {})) obj.system.quantity = q; toCreate.push(obj); }
            }
            entry.qty -= q;
        }
        if (harvester && toCreate.length) await harvester.createEmbeddedDocuments("Item", toCreate);

        const remaining = loot.filter(l => l.qty > 0);
        if (remaining.length) {
            await tokenDoc.update({ [`flags.${MOD}.harvestLoot`]: remaining });
            return { ok: true, emptied: false };
        }
        // Dépouille vidée → tache de sang + suppression.
        await placeBloodStain(tokenDoc);
        await tokenDoc.delete();
        return { ok: true, emptied: true };
    } catch (e) { console.warn(`[${MOD}] harvestTake:`, e); return { ok: false, msg: "Erreur de prise." }; }
}

async function placeBloodStain(tokenDoc) {
    try {
        const scene = tokenDoc.parent;
        const img = sc("harvestBloodImage");
        const w = tokenDoc.width * scene.grid.sizeX, h = tokenDoc.height * scene.grid.sizeY;
        if (img) {
            await scene.createEmbeddedDocuments("Tile", [{
                texture: { src: img }, x: tokenDoc.x, y: tokenDoc.y, width: w, height: h,
                sort: -100, flags: { [MOD]: { bloodStain: true } }
            }]);
        } else {
            // Repli : un dessin rouge semi-transparent.
            await scene.createEmbeddedDocuments("Drawing", [{
                shape: { type: "e", width: w, height: h }, x: tokenDoc.x, y: tokenDoc.y,
                fillType: 1, fillColor: "#6b0f0f", fillAlpha: 0.5, strokeWidth: 0,
                flags: { [MOD]: { bloodStain: true } }
            }]);
        }
    } catch (e) { console.warn(`[${MOD}] placeBloodStain:`, e); }
}

// ============================================================
// État de la dépouille au survol
// ============================================================
const _rotLabels = new Map();

function drawRotLabel(token, hovered) {
    const prev = _rotLabels.get(token.id);
    if (prev) { try { prev.destroy(); } catch (e) {} _rotLabels.delete(token.id); }
    if (!hovered || !enabled()) return;
    const actor = token.actor;
    if (!actor || actor.type !== "npc" || !isDead(actor)) return;

    const state = harvestState(actor, token.document);
    const has = !!token.document.getFlag(MOD, "harvestGenerated") || !!resolveTable(actor);
    const text = (STATE_LABELS[state] ?? state) + (has || state === "rotten" ? "" : " — pas de table");
    const color = STATE_COLORS[state] ?? "#ffffff";

    const style = new PIXI.TextStyle({ fontFamily: "Signika, sans-serif", fontSize: 14, fill: color, stroke: "#000000", strokeThickness: 3 });
    const label = new PIXI.Text(text, style);
    label.anchor.set(0.5, 1);
    label.position.set(token.w / 2, -4);
    label.eventMode = "none";
    token.addChild(label);
    _rotLabels.set(token.id, label);
}

// ============================================================
// MJ : régler l'état de la dépouille sélectionnée
// ============================================================
async function openStateDialog() {
    if (!game.user.isGM) return;
    const token = canvas.tokens?.controlled?.[0] ?? [...(game.user.targets ?? [])][0];
    if (!token) { ui.notifications?.warn("Sélectionnez (ou ciblez) le token de la dépouille."); return; }
    const actor = token.actor;
    if (!actor || actor.type !== "npc") { ui.notifications?.warn("Ce n'est pas une créature."); return; }

    const cur = harvestState(actor, token.document);
    const DialogV2 = foundry.applications.api.DialogV2;
    const choice = await DialogV2.wait({
        window: { title: `État de la dépouille — ${token.document.name}`, icon: "fas fa-droplet" },
        content: `<p>État actuel : <strong>${STATE_LABELS[cur]}</strong>${token.document.getFlag(MOD, "harvestState") ? "" : " (par défaut)"}.</p>
                  <p style="font-size:.85em;color:#999;">Fraîche = butin complet · Abîmée = butin réduit · Pourrie = rien à récolter.<br>Par défaut, les morts-vivants sont « pourris ».</p>`,
        rejectClose: false,
        buttons: [
            { action: "fresh",   label: "Fraîche",  icon: "fas fa-leaf",     callback: () => "fresh" },
            { action: "damaged", label: "Abîmée",   icon: "fas fa-bandage",  callback: () => "damaged" },
            { action: "rotten",  label: "Pourrie",  icon: "fas fa-skull",    callback: () => "rotten" },
            { action: "cancel",  label: "Annuler",  icon: "fas fa-xmark",    callback: () => null }
        ]
    }).catch(() => null);
    if (!choice) return;
    await token.document.setFlag(MOD, "harvestState", choice);
    ui.notifications?.info(`Dépouille réglée sur « ${STATE_LABELS[choice]} ».`);
}

// ============================================================
// Fenêtre MJ : associer créatures ↔ RollTables
// ============================================================
async function openHarvestConfig() {
    if (!game.user.isGM) return;
    const DialogV2 = foundry.applications.api.DialogV2;
    const maps = foundry.utils.deepClone(sc("harvestTables") ?? { byType: {}, byName: {} });
    maps.byType ??= {}; maps.byName ??= {};

    const tables = [...game.tables].sort((a, b) => a.name.localeCompare(b.name));
    const tableOptions = (sel) => `<option value="">— aucune —</option>` +
        tables.map(t => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${t.name}</option>`).join("");

    const types = CONFIG.DND5E?.creatureTypes ?? {};
    const typeRows = Object.entries(types).map(([k, v]) => {
        const label = game.i18n.localize(v?.label ?? v ?? k);
        return `<label style="display:flex;align-items:center;gap:8px;padding:2px 0;">
            <span style="flex:0 0 130px;">${label}</span>
            <select name="type-${k}" style="flex:1;">${tableOptions(maps.byType[k])}</select>
        </label>`;
    }).join("");

    const nameEntries = Object.entries(maps.byName);
    const nameRows = nameEntries.map(([name, id], i) => `
        <div style="display:flex;gap:6px;align-items:center;padding:2px 0;">
            <input type="text" name="nname-${i}" value="${name}" style="flex:0 0 130px;">
            <select name="nid-${i}" style="flex:1;">${tableOptions(id)}</select>
        </div>`).join("");
    const emptyName = `
        <div style="display:flex;gap:6px;align-items:center;padding:2px 0;">
            <input type="text" name="nname-new" placeholder="Nom exact de la créature" style="flex:0 0 130px;">
            <select name="nid-new" style="flex:1;">${tableOptions("")}</select>
        </div>`;

    const content = `
    <div style="display:flex;flex-direction:column;gap:12px;max-height:60vh;overflow:auto;">
        <div>
            <div style="font-weight:700;margin-bottom:4px;">Par type de créature</div>
            <div style="font-size:.8em;color:#999;margin-bottom:4px;">Table par défaut selon le type dnd5e de la créature.</div>
            ${typeRows || "<em>Aucun type.</em>"}
        </div>
        <div>
            <div style="font-weight:700;margin-bottom:4px;">Par nom précis (prioritaire)</div>
            <div style="font-size:.8em;color:#999;margin-bottom:4px;">Prime sur le type. Nom exact de l'acteur (ex. « Loup »).</div>
            ${nameRows}${emptyName}
        </div>
    </div>`;

    await DialogV2.wait({
        window: { title: "Récolte — Associations créature ↔ RollTable", icon: "fas fa-sitemap" },
        position: { width: 520 },
        content,
        rejectClose: false,
        buttons: [
            { action: "save", label: "Enregistrer", icon: "fas fa-save", default: true,
              callback: async (ev, btn) => {
                  const out = { byType: {}, byName: {} };
                  for (const k of Object.keys(types)) {
                      const v = btn.form.elements[`type-${k}`]?.value;
                      if (v) out.byType[k] = v;
                  }
                  nameEntries.forEach(([, ], i) => {
                      const n = (btn.form.elements[`nname-${i}`]?.value ?? "").trim();
                      const id = btn.form.elements[`nid-${i}`]?.value;
                      if (n && id) out.byName[n] = id;
                  });
                  const nn = (btn.form.elements["nname-new"]?.value ?? "").trim();
                  const nid = btn.form.elements["nid-new"]?.value;
                  if (nn && nid) out.byName[nn] = nid;
                  await game.settings.set(MOD, "harvestTables", out);
                  ui.notifications?.info("Associations de récolte enregistrées.");
              } },
            { action: "cancel", label: "Fermer", icon: "fas fa-xmark", callback: () => {} }
        ]
    }).catch(() => {});
}
