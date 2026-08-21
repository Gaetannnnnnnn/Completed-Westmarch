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

    // Déclencheur : bouton dans le HUD du token du JOUEUR (celui qu'il possède,
    // donc le HUD s'ouvre). Il récolte la CIBLE ciblée (touche T) qui est à 0 PV.
    Hooks.on("renderTokenHUD", (hud, html) => injectHarvestHudButton(hud, html));

    // Boutons de la barre : Associations & nettoyage (MJ uniquement).
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!controls.westmarch) {
            controls.westmarch = { name: "westmarch", title: "WestMarch", icon: "fa-solid fa-hammer", layer: "tokens", tools: {} };
        }
        if (game.user.isGM) {
            controls.westmarch.tools.scwmHarvestConfig = {
                name: "scwmHarvestConfig", title: "Récolte — Associer les créatures aux RollTables", icon: "fa-solid fa-sitemap",
                button: true, visible: true, onChange: () => openHarvestConfig()
            };
            controls.westmarch.tools.scwmHarvestClean = {
                name: "scwmHarvestClean", title: "Nettoyer les taches de sang", icon: "fa-solid fa-trash",
                button: true, visible: true, onChange: () => cleanBloodStains()
            };
        }
    });

    // Bouton d'en-tête (fiche PNJ, MJ) : bloquer/débloquer la récolte de la créature.
    Hooks.on("renderApplicationV2", (app, element) => injectHarvestBlockButton(app, element));

    // Champ « Qté » (formule) injecté dans chaque ligne d'une RollTable (MJ).
    // IMPORTANT : on N'enveloppe PAS d'un test game.user.isGM ici — HarvestHooks
    // s'exécute à l'"init", où game.user.isGM n'est pas encore fiable, ce qui
    // sauterait l'enregistrement. La vérification MJ se fait DANS la fonction.
    // dnd5e remplace la fenêtre par RollTableSheet5e → hook renderRollTableSheet5e.
    for (const h of ["renderRollTableSheet5e", "renderRollTableSheet", "renderRollTableConfig"]) {
        Hooks.on(h, injectHarvestQtyFields);
    }

    // NB : la tache de sang est posée quand la dépouille est ENTIÈREMENT récoltée
    // (le token disparaît alors), pas à la mort — sinon elle serait cachée sous
    // le corps. Voir gmTake().
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
// La valeur stockée est un UUID (table de compendium) ou un id de monde ;
// on gère les deux (fromUuid couvre le compendium, game.tables.get le monde).
async function resolveTable(actor) {
    const maps = sc("harvestTables") ?? { byType: {}, byName: {} };
    const perActor = actor.getFlag?.(MOD, "harvestTableId");
    const byName = maps.byName?.[actor.name];
    const byType = maps.byType?.[typeOf(actor)];
    const id = perActor || byName || byType;
    if (!id) return null;
    return game.tables.get(id) ?? await fromUuid(id).catch(() => null);
}

// Récolte bloquée par le MJ sur cette créature (bouton d'en-tête de fiche).
const isHarvestBlocked = (actor) => actor?.getFlag(MOD, "harvestBlocked") === true;

// ============================================================
// Récolte — côté joueur (déclencheur)
// ============================================================
async function harvestTargeted(harvesterOverride = null, targetToken = null) {
    if (!enabled()) return;
    const target = targetToken ?? [...(game.user.targets ?? [])][0];
    if (!target) { ui.notifications?.warn("Ciblez d'abord une créature (touche T) avant de récolter."); return; }
    const tokenDoc = target.document;
    const actor = target.actor;
    if (!actor || actor.type !== "npc") { ui.notifications?.warn("Cette cible n'est pas une créature récoltable."); return; }
    if (!isDead(actor)) { ui.notifications?.warn(`${actor.name} n'est pas morte.`); return; }

    if (isHarvestBlocked(actor)) { ui.notifications?.info(`Il n'y a rien à récolter sur ${actor.name}.`); return; }

    const harvester = (harvesterOverride instanceof Actor ? harvesterOverride : null) ?? harvesterActor();

    // Déjà récoltée (butin généré) → on ouvre directement la fenêtre.
    if (tokenDoc.getFlag(MOD, "harvestGenerated")) { openLootWindow(tokenDoc.parent.id, tokenDoc.id, harvester?.id ?? null); return; }

    if (!await resolveTable(actor)) {
        ui.notifications?.warn(`Aucune table de récolte associée à ${actor.name} (le MJ doit l'associer).`);
        return;
    }

    // Jet de compétence du récolteur (fait localement, l'acteur lui appartient).
    // On utilise la MEILLEURE des trois compétences : Survie / Nature / Médecine.
    if (!harvester) { ui.notifications?.warn("Sélectionnez votre personnage (token) pour effectuer le jet de récolte."); return; }
    let skill = "sur", mod = -Infinity;
    for (const s of ["sur", "nat", "med"]) {
        const t = harvester.system?.skills?.[s]?.total;
        if (Number.isFinite(t) && t > mod) { mod = t; skill = s; }
    }
    if (!Number.isFinite(mod)) mod = 0;
    const roll = await new Roll("1d20 + @m", { m: mod }).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: harvester }), flavor: `Récolte — meilleur jet (${CONFIG.DND5E.skills[skill]?.label ?? skill})` });

    // Génération côté MJ (écriture sur la dépouille).
    const gm = game.users.activeGM;
    if (!gm) { ui.notifications?.warn("Aucun MJ connecté : la récolte nécessite un MJ en ligne."); return; }
    const res = await gm.query("westmarch.harvestGenerate", {
        sceneId: tokenDoc.parent.id, tokenId: tokenDoc.id, total: roll.total
    }).catch(() => null);
    if (!res?.ok) { ui.notifications?.warn(res?.msg ?? "Échec de la récolte."); return; }
    if (res.empty) { ui.notifications?.info(`Rien à récolter sur ${actor.name}.`); return; }
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
        if (isHarvestBlocked(actor)) return { ok: true, empty: true };

        const table = await resolveTable(actor);
        if (!table) return { ok: false, msg: "Aucune table associée." };

        const dc = Math.round((sc("harvestDcBase") || 10) + crOf(actor) * (sc("harvestDcPerCr") || 0));
        let draws = (total >= dc) ? (sc("harvestBaseDraws") || 2) + Math.floor((total - dc) / 5) : 1;
        draws = Math.max(1, draws);

        // La table peut avoir des résultats marqués « tirés » (DRAW RESULT manuel,
        // ou tirage sans remise) : roll() lèverait alors « no available results ».
        // On réinitialise cet état pour que la récolte pioche toujours. Best-effort
        // (échoue silencieusement sur une table de compendium verrouillée).
        try { if (table.results.some(r => r.drawn)) await table.resetResults(); } catch (e) {}

        const loot = [];
        for (let i = 0; i < draws; i++) {
            let results = [];
            try { ({ results } = await table.roll()); }
            catch (e) { console.warn(`[${MOD}] table.roll:`, e); continue; }
            for (const r of (results ?? [])) {
                const p = await parseResult(r);
                if (p.isNothing || p.qty <= 0) continue;          // « rien » : on n'ajoute pas de ligne
                const uuid = p.item?.uuid ?? null;
                const ex = loot.find(l => l.uuid === uuid && l.name === p.name);
                if (ex) ex.qty += p.qty; else loot.push({ uuid, name: p.name, img: p.img, qty: p.qty });
            }
        }

        // Aucun butin (uniquement des « rien ») → message + la dépouille disparaît.
        if (!loot.length) {
            await tokenDoc.delete().catch(() => {});
            return { ok: true, empty: true };
        }

        await tokenDoc.update({ [`flags.${MOD}.harvestGenerated`]: true, [`flags.${MOD}.harvestLoot`]: loot });
        return { ok: true, loot };
    } catch (e) { console.warn(`[${MOD}] harvestGenerate:`, e); return { ok: false, msg: "Erreur de génération." }; }
}

// Analyse un résultat de table. Renvoie { item, qty, name, img, isNothing }.
//  • Quantité : une formule/nombre en TÊTE du texte est lancée (ex. « 1d4 Dent »,
//    « 2 Dent », « 1d6+1 @UUID[…]{Écaille} »). Sans formule → 1.
//  • Item : lien de document du résultat, sinon lien @UUID trouvé dans le texte.
//  • « rien » : aucun item ET texte vide ou négatif (rien / nothing / - / aucun).
async function parseResult(r) {
    // Foundry v13/v14 : le « Result Name » est r.name (l'ancien r.text a disparu).
    // On lit le nom en priorité, puis l'éventuelle description pour un lien @UUID.
    let text = (r.name ?? r.text ?? "").trim();
    let qty = 1;
    // Priorité : formule saisie dans le champ « Qté » de la ligne (flag du résultat).
    const flagFormula = (r.getFlag?.(MOD, "harvestQty") ?? "").toString().trim();
    if (flagFormula) {
        try { qty = Math.max(0, Math.round((await new Roll(flagFormula).evaluate()).total)); } catch { qty = 1; }
    } else {
        // Sinon : formule en tête du nom (ex. « 1d4 Dent »).
        const m = text.match(/^\s*(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(?:[x×*]\s*)?/i);
        if (m) {
            try { qty = Math.max(0, Math.round((await new Roll(m[1]).evaluate()).total)); } catch { qty = 1; }
            text = text.slice(m[0].length).trim();
        }
    }
    let item = await resultToItem(r);
    if (!item) {
        const um = (text + " " + (r.description ?? "")).match(/@UUID\[([^\]]+)\]/);
        if (um) item = await fromUuid(um[1]).catch(() => null);
    }
    const cleaned = text.replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "$1").replace(/@UUID\[[^\]]+\]/g, "").trim();
    // « rien » = aucun item, aucune Qté saisie, ET nom vide ou négatif. Dès qu'une
    // Qté est configurée sur le résultat, le MJ veut du butin : jamais « rien ».
    const isNothing = !item && !flagFormula
        && (cleaned === "" || /^(rien|néant|nothing|none|aucun|-|x)\.?$/i.test(cleaned));
    return {
        item, qty,
        name: item?.name ?? (cleaned || r.name || r.text || "Butin"),
        img: item?.img ?? r.icon ?? r.img ?? "icons/svg/item-bag.svg",
        isNothing
    };
}

// Injecte un champ « Qté » (formule de récolte) dans chaque ligne de la fenêtre
// de configuration d'une RollTable. La valeur est enregistrée sur le résultat
// (flag harvestQty) et lue en priorité par parseResult.
function injectHarvestQtyFields(app, html) {
    try {
        const root = (html instanceof HTMLElement) ? html
            : (html?.[0] ?? (app?.element instanceof HTMLElement ? app.element : app?.element?.[0]) ?? null);
        if (!game.user?.isGM) return;
        const table = app?.document ?? app?.object;
        if (!root || !table?.results) return;

        const rows = root.querySelectorAll("tr[data-result-id]");
        console.log(`[${MOD}] injectHarvestQtyFields: ${rows.length} ligne(s) de résultat`);

        rows.forEach(tr => {
            if (tr.querySelector(".scwm-qty")) return;
            const result = table.results.get(tr.dataset.resultId);
            if (!result) return;
            // Cellule du NOM (« Details ») = premier <td> qui n'est pas l'image.
            const tds = [...tr.querySelectorAll("td")];
            const cell = tds.find(td => !td.classList.contains("image")) ?? tds[0] ?? tr;
            const val = String(result.getFlag(MOD, "harvestQty") ?? "").replace(/"/g, "&quot;");

            const wrap = document.createElement("span");
            wrap.className = "scwm-qty";
            wrap.style.cssText = "display:inline-flex;align-items:center;gap:4px;margin-left:12px;vertical-align:middle;";
            wrap.innerHTML = `<span style="opacity:.7;font-size:.85em;">Qté récolte</span>
                <input type="text" value="${val}" placeholder="1d4" style="width:60px;" title="Formule de quantité récoltée (ex. 1d4, 2). Vide = 1.">`;
            wrap.querySelector("input").addEventListener("change", (e) =>
                result.setFlag(MOD, "harvestQty", e.target.value.trim()));
            cell.appendChild(wrap);
        });
    } catch (e) { console.warn(`[${MOD}] injectHarvestQtyFields:`, e); }
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
        window: { title: `Récolter — ${tokenDoc.name}`, icon: "fa-solid fa-hand-holding-droplet" },
        position: { width: 420 },
        content: `<p style="margin:0 0 6px;font-size:.9em;">Choisissez ce que vous prenez. Ce qui reste demeure sur la dépouille pour les autres.</p>${rows}`,
        rejectClose: false,
        buttons: [
            { action: "take", label: "Prendre", icon: "fa-solid fa-hand-holding", default: true,
              callback: (ev, btn) => {
                  const out = [];
                  btn.form.querySelectorAll('input[name="take"]:checked').forEach(cb => {
                      const i = Number(cb.value);
                      const q = Math.max(0, Math.min(loot[i].qty, Number(btn.form.elements[`qty-${i}`]?.value) || 0));
                      if (q > 0) out.push({ index: i, qty: q });
                  });
                  return out;
              } },
            { action: "close", label: "Laisser", icon: "fa-solid fa-xmark", callback: () => null }
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
        const takenList = [];
        for (const t of (taken ?? [])) {
            const entry = loot[t.index];
            if (!entry) continue;
            const q = Math.max(0, Math.min(entry.qty, t.qty));
            if (q <= 0) continue;
            if (entry.uuid) {
                const item = await fromUuid(entry.uuid);
                if (item) { const obj = item.toObject(); if ("quantity" in (obj.system ?? {})) obj.system.quantity = q; toCreate.push(obj); }
            }
            takenList.push({ name: entry.name, img: entry.img, qty: q });
            entry.qty -= q;
        }
        if (harvester && toCreate.length) await harvester.createEmbeddedDocuments("Item", toCreate);

        // Message CHUCHOTÉ AUX MJ (aveugle) : trace de ce qui a été récolté.
        if (takenList.length) postHarvestLootWhisper(harvester, tokenDoc.name, takenList);

        const remaining = loot.filter(l => l.qty > 0);
        if (remaining.length) {
            await tokenDoc.update({ [`flags.${MOD}.harvestLoot`]: remaining });
            return { ok: true, emptied: false };
        }
        // Dépouille vidée → tache de sang à sa position exacte, PUIS suppression
        // du token (la tache apparaît là où était le corps, plus rien dessus).
        await placeBloodStain(tokenDoc);
        await tokenDoc.delete();
        return { ok: true, emptied: true };
    } catch (e) { console.warn(`[${MOD}] harvestTake:`, e); return { ok: false, msg: "Erreur de prise." }; }
}

// Message de butin CHUCHOTÉ aux MJ (aveugle) : qui a récolté quoi sur quelle
// dépouille. Créé côté MJ (dans gmTake), donc les joueurs ne le voient pas.
async function postHarvestLootWhisper(harvester, carcassName, takenList) {
    try {
        const who = harvester?.name ?? "Quelqu'un";
        const rows = takenList.map(l =>
            `<li style="display:flex;align-items:center;gap:6px;margin:2px 0;">
                <img src="${l.img}" width="20" height="20" style="border:none;flex:0 0 auto;">
                <span>${l.name}</span><span style="opacity:.7;">×${l.qty}</span>
            </li>`).join("");
        const content =
            `<div class="scwm-harvest-loot">
                <p style="margin:0 0 4px;"><i class="fa-solid fa-hand-holding-droplet"></i> <strong>${who}</strong> récolte sur <em>${carcassName}</em> :</p>
                <ul style="list-style:none;margin:0;padding:0;">${rows}</ul>
            </div>`;
        const gmIds = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
        await ChatMessage.create({
            content,
            whisper: gmIds,
            blind: true,
            speaker: harvester ? ChatMessage.getSpeaker({ actor: harvester }) : {},
            flags: { [MOD]: { harvestLootLog: true } }
        });
    } catch (e) { console.warn(`[${MOD}] postHarvestLootWhisper:`, e); }
}

// Images de sang fournies avec le module (posées au hasard si aucune image
// personnalisée n'est réglée).
const BUNDLED_BLOOD = [
    `modules/${MOD}/assets/blood/blood1.png`,
    `modules/${MOD}/assets/blood/blood2.png`
];

async function placeBloodStain(tokenDoc) {
    try {
        const scene = tokenDoc.parent;
        // Image personnalisée si réglée, sinon une des images fournies au hasard.
        const custom = sc("harvestBloodImage");
        const img = custom || BUNDLED_BLOOD[Math.floor(Math.random() * BUNDLED_BLOOD.length)];

        // Centre et taille = ceux du token (empreinte sur la grille). On garde
        // l'objet canvas si dispo (gère hex/échelle), sinon calcul par la grille.
        const t = tokenDoc.object;
        let cx, cy, w, h;
        if (t && Number.isFinite(t.center?.x)) {
            cx = t.center.x; cy = t.center.y; w = t.w; h = t.h;
        } else {
            w = tokenDoc.width * scene.grid.sizeX; h = tokenDoc.height * scene.grid.sizeY;
            cx = tokenDoc.x + w / 2; cy = tokenDoc.y + h / 2;
        }

        if (img) {
            // Centrée sur le token, un poil plus grande que l'empreinte.
            const scale = 1.1 + Math.random() * 0.15;
            const tw = w * scale, th = h * scale;
            await scene.createEmbeddedDocuments("Tile", [{
                texture: { src: img },
                x: cx - tw / 2, y: cy - th / 2,
                width: tw, height: th, rotation: Math.floor(Math.random() * 360),
                sort: -100, flags: { [MOD]: { bloodStain: true } }
            }]);
        } else {
            // Repli : éclaboussement procédural (flaque irrégulière + gouttes).
            const baseR = Math.max(w, h) / 2 * 1.15;
            await scene.createEmbeddedDocuments("Drawing", makeSplatterDrawings(cx, cy, baseR));
        }
    } catch (e) { console.warn(`[${MOD}] placeBloodStain:`, e); }
}

// Génère un éclaboussement de sang réaliste : une flaque centrale irrégulière
// (polygone déformé, un peu aplati) + quelques gouttes autour, teintes et
// opacités variées. Toutes marquées bloodStain pour le nettoyage.
function makeSplatterDrawings(cx, cy, baseR) {
    const rand = (a, b) => a + Math.random() * (b - a);
    const reds = ["#3d0808", "#4e0b0b", "#5c0d0d", "#6e1010", "#7a1414"];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const docs = [];

    // Flaque principale : polygone à rayon variable (aspect organique).
    const n = 20;
    const abs = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = baseR * rand(0.55, 1.05);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.82;            // légèrement aplati au sol
        abs.push([x, y]);
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    docs.push({
        shape: { type: "p", points: abs.flatMap(([x, y]) => [x - minX, y - minY]), width: maxX - minX, height: maxY - minY },
        x: minX, y: minY, fillType: 1, fillColor: pick(reds), fillAlpha: rand(0.62, 0.78), strokeWidth: 0,
        flags: { [MOD]: { bloodStain: true } }
    });

    // Gouttes projetées autour.
    const drops = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < drops; i++) {
        const a = rand(0, Math.PI * 2);
        const dist = baseR * rand(0.75, 1.7);
        const dw = baseR * rand(0.07, 0.26);
        const dh = dw * rand(0.7, 1.35);
        docs.push({
            shape: { type: "e", width: dw, height: dh },
            x: cx + Math.cos(a) * dist - dw / 2, y: cy + Math.sin(a) * dist * 0.82 - dh / 2,
            fillType: 1, fillColor: pick(reds), fillAlpha: rand(0.5, 0.75), strokeWidth: 0,
            flags: { [MOD]: { bloodStain: true } }
        });
    }
    return docs;
}

// Supprime toutes les taches de sang (tuiles + dessins marqués) de la scène active.
async function cleanBloodStains() {
    const scene = canvas.scene;
    if (!scene) { ui.notifications?.warn("Aucune scène active."); return; }
    const tileIds = scene.tiles.filter(t => t.getFlag(MOD, "bloodStain")).map(t => t.id);
    const drawIds = scene.drawings.filter(d => d.getFlag(MOD, "bloodStain")).map(d => d.id);
    const total = tileIds.length + drawIds.length;
    if (!total) { ui.notifications?.info("Aucune tache de sang sur cette scène."); return; }
    const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Nettoyer les taches de sang", icon: "fa-solid fa-broom" },
        content: `<p>Supprimer <strong>${total}</strong> tache(s) de sang de la scène « ${scene.name} » ?</p>`,
        rejectClose: false
    });
    if (!ok) return;
    try {
        if (tileIds.length) await scene.deleteEmbeddedDocuments("Tile", tileIds);
        if (drawIds.length) await scene.deleteEmbeddedDocuments("Drawing", drawIds);
        ui.notifications?.info(`${total} tache(s) de sang supprimée(s).`);
    } catch (e) { console.warn(`[${MOD}] cleanBloodStains:`, e); ui.notifications?.warn("Erreur lors du nettoyage (voir console)."); }
}

// ============================================================
// Bouton de récolte dans le HUD du token du joueur (haut, centré)
// Récolte la CIBLE (game.user.targets) qui est à 0 PV.
// ============================================================
function injectHarvestHudButton(hud, html) {
    try {
        if (!enabled()) return;
        const token = hud?.object;
        // On l'affiche sur un token que l'utilisateur possède (son PJ).
        if (!token?.actor?.isOwner) return;
        const root = (html instanceof HTMLElement) ? html : html?.[0];
        if (!root || root.querySelector(".scwm-harvest-hud")) return;

        const btn = document.createElement("div");
        btn.classList.add("control-icon", "scwm-harvest-hud");
        btn.dataset.tooltip = "Récolter la créature ciblée (à 0 PV)";
        btn.innerHTML = `<i class="fa-solid fa-hand-holding-droplet"></i>`;
        // Au-dessus du token, centré (pas sur les côtés).
        btn.style.cssText = "position:absolute; top:-52px; left:50%; transform:translateX(-50%); pointer-events:all;";
        btn.addEventListener("click", (e) => {
            e.preventDefault(); e.stopPropagation();
            // Récolteur = ce token ; cible = la créature ciblée (T).
            harvestTargeted(token.actor, null);
        });
        root.appendChild(btn);
    } catch (e) { console.warn(`[${MOD}] injectHarvestHudButton:`, e); }
}

// ============================================================
// Bouton d'en-tête (fiche PNJ, MJ) : bloquer/débloquer la récolte
// ============================================================
function injectHarvestBlockButton(app, element) {
    try {
        if (!enabled() || !game.user?.isGM) return;
        const actor = app?.document;
        if (!actor || !(actor instanceof Actor) || actor.type !== "npc") return;
        const root = (element instanceof HTMLElement) ? element : element?.[0];
        const header = root?.querySelector(".window-header");
        if (!header || header.querySelector(".scwm-harvest-block-btn")) return;

        const isBlocked = () => actor.getFlag(MOD, "harvestBlocked") === true;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("header-control", "icon", "fa-solid", "fa-sack-xmark", "scwm-harvest-block-btn");
        const refresh = () => {
            btn.style.color = isBlocked() ? "#e74c3c" : "";
            btn.dataset.tooltip = isBlocked()
                ? "Récolte bloquée (rien à looter) — cliquer pour réactiver"
                : "Bloquer la récolte (rien à looter sur cette créature)";
        };
        refresh();
        btn.addEventListener("click", async () => {
            await actor.setFlag(MOD, "harvestBlocked", !isBlocked());
            refresh();
        });

        const title = header.querySelector(".window-title");
        if (title) title.insertAdjacentElement("afterend", btn);
        else header.insertBefore(btn, header.querySelector(".close"));
    } catch (e) { console.warn(`[${MOD}] injectHarvestBlockButton:`, e); }
}

// ============================================================
// Fenêtre MJ : associer créatures ↔ RollTables
// ============================================================
async function openHarvestConfig() {
    if (!game.user.isGM) return;
    const DialogV2 = foundry.applications.api.DialogV2;
    const maps = foundry.utils.deepClone(sc("harvestTables") ?? { byType: {}, byName: {} });
    maps.byType ??= {}; maps.byName ??= {};

    // Tables du MONDE + tables de COMPENDIUM. On stocke l'UUID (uniforme) ;
    // la sélection reste compatible avec d'anciennes valeurs (id de monde nu).
    const tables = [...game.tables].map(t => ({ uuid: t.uuid, id: t.id, name: t.name, group: "Monde" }));
    for (const pack of game.packs) {
        if ((pack.metadata?.type ?? pack.documentName) !== "RollTable") continue;
        try {
            const idx = await pack.getIndex();
            for (const e of idx) tables.push({ uuid: e.uuid, id: e._id, name: e.name, group: pack.metadata?.label ?? "Compendium" });
        } catch (e) { /* pack illisible, on ignore */ }
    }
    tables.sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name));
    const tableOptions = (sel) => `<option value="">— aucune —</option>` +
        tables.map(t => {
            const on = (t.uuid === sel || t.id === sel) ? "selected" : "";
            const prefix = t.group === "Monde" ? "" : `[${t.group}] `;
            return `<option value="${t.uuid}" ${on}>${prefix}${t.name}</option>`;
        }).join("");

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
        window: { title: "Récolte — Associations créature ↔ RollTable", icon: "fa-solid fa-sitemap" },
        position: { width: 520 },
        content,
        rejectClose: false,
        buttons: [
            { action: "save", label: "Enregistrer", icon: "fa-solid fa-save", default: true,
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
            { action: "cancel", label: "Fermer", icon: "fa-solid fa-xmark", callback: () => {} }
        ]
    }).catch(() => {});
}
