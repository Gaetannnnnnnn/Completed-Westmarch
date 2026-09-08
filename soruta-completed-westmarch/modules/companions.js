// ============================================================
// companions.js — Compagnons évolutifs (resync sur le niveau du maître)
//
// COMPLÈTE l'activité « Summon » du système dnd5e (ne la remplace pas) :
// l'invocation/placement reste géré par le système ; ce module ne rejoue QUE
// le recalcul des STATS D'ACTEUR d'une créature liée à un maître, au changement
// de niveau de ce maître ou à la demande.
//
// Le lien vit dans un flag (survit aux tokens non liés via l'ActorDelta).
// Les profils par défaut sont livrés ici ; le MJ ajoute/surcharge via le réglage
// world "companionProfiles". Les formules sont évaluées avec Roll.safeEval
// (arithmétique pure, jamais d'eval) — champ réservé au MJ (confiance = MJ).
//
// ⚠️ CHEMINS system.* : centralisés dans PATHS ci-dessous. À VÉRIFIER en console
// sur une vraie créature de ta version dnd5e avant de se fier au module.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const enabled = () => game.settings.get(MOD, "enableCompanions");
const LINK = "companionLink";

// ------------------------------------------------------------
// Mapping des chemins système (à confirmer/adapter par version dnd5e)
// ------------------------------------------------------------
const PATHS = {
    acFlat:    "system.attributes.ac.flat",
    acCalc:    "system.attributes.ac.calc",
    hpMax:     "system.attributes.hp.max",
    hpValue:   "system.attributes.hp.value",
    hpFormula: "system.attributes.hp.formula",
    classLevels: (classId) => `system.classes.${classId}.levels`,   // (info : on lit via master.classes)
};

// ------------------------------------------------------------
// Profils par défaut (livrés dans le module). Le réglage MJ surcharge/ajoute.
// @level = niveau de la classe de référence (ou niveau total), @pb = maîtrise
// du maître, @master.* = rollData du maître, autres @ = rollData du compagnon.
// ------------------------------------------------------------
const DEFAULT_PROFILES = {
    "beast-of-the-land": {
        label: "Bête de la terre (Rôdeur)", classId: "ranger", minLevel: 3,
        fields: {
            "system.attributes.ac.flat": "13 + @master.abilities.wis.mod",
            "system.attributes.hp.max":  "5 + 5 * @level",
        },
    },
    "beast-of-the-sea": {
        label: "Bête de la mer (Rôdeur)", classId: "ranger", minLevel: 3,
        fields: {
            "system.attributes.ac.flat": "13 + @master.abilities.wis.mod",
            "system.attributes.hp.max":  "5 + 5 * @level",
        },
    },
    "beast-of-the-sky": {
        label: "Bête du ciel (Rôdeur)", classId: "ranger", minLevel: 3,
        fields: {
            "system.attributes.ac.flat": "14 + @master.abilities.wis.mod",
            "system.attributes.hp.max":  "4 + 4 * @level",
        },
    },
};

// Profils effectifs = défauts + surcharges/ajouts du MJ.
function allProfiles() {
    const overrides = game.settings.get(MOD, "companionProfiles");
    return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_PROFILES),
        (overrides && typeof overrides === "object") ? overrides : {}, { inplace: false });
}
function getProfile(id) { return allProfiles()[id] ?? null; }

// ------------------------------------------------------------
// Lien créature ↔ maître
// ------------------------------------------------------------
function getLink(actor) { return actor?.getFlag?.(MOD, LINK) ?? null; }
const hasLink = (actor) => !!getLink(actor)?.masterUuid;

// ------------------------------------------------------------
// Évaluation des formules
// ------------------------------------------------------------
function buildData(master, companion, classId) {
    const lvl = classId
        ? (master.classes?.[classId]?.system?.levels ?? master.system?.classes?.[classId]?.levels ?? 0)
        : (master.system?.details?.level ?? 0);
    return {
        ...(companion.getRollData?.() ?? {}),
        master: master.getRollData?.() ?? {},
        level: lvl,
        pb: master.system?.attributes?.prof ?? 0,
    };
}

// Retourne { dice:true, str } si la formule contient des dés (écrite telle quelle),
// sinon { value:Number } (arithmétique pure via safeEval).
function evalFormula(formula, data) {
    const replaced = Roll.replaceFormulaData(String(formula ?? ""), data, { missing: "0" });
    if (/\dd\d/i.test(replaced)) return { dice: true, str: replaced };
    try { return { value: Roll.safeEval(replaced) }; }
    catch (e) { console.warn(`[${MOD}] Formule invalide « ${formula} » →`, e); return { value: null }; }
}

// ------------------------------------------------------------
// Calcul + application de la resync sur UNE créature
// ------------------------------------------------------------
function computeUpdate(companion, link) {
    const profile = getProfile(link.profile);
    if (!profile) return null;
    const master = link._master;                        // injecté par applyResync (déjà résolu)
    const classId = link.classId || profile.classId || null;
    const data = buildData(master, companion, classId);
    const level = data.level;

    const update = {};
    const values = {};          // snapshot des valeurs écrites (flag applied)
    for (const [path, formula] of Object.entries(profile.fields ?? {})) {
        const r = evalFormula(formula, data);
        if (r.dice) {
            // Dés (ex. dés de vie) → chaîne dans hp.formula, pas d'évaluation.
            update[PATHS.hpFormula] = r.str;
            values[PATHS.hpFormula] = r.str;
            continue;
        }
        if (r.value == null) continue;
        update[path] = r.value;
        values[path] = r.value;
        // CA « flat » : il faut aussi forcer le mode de calcul.
        if (path === PATHS.acFlat) update[PATHS.acCalc] = "flat";
    }
    return { update, values, level };
}

// Applique la resync (écriture). force = ignore les modifs manuelles.
// Retourne { ok, msg }.
async function applyResync(companion, { force = false } = {}) {
    try {
        if (!companion) return { ok: false, msg: "Créature introuvable." };
        const link = getLink(companion);
        if (!link?.masterUuid) return { ok: false, msg: "Cette créature n'est pas liée à un maître." };
        const master = await fromUuid(link.masterUuid).catch(() => null);
        if (!master) return { ok: false, msg: "Maître introuvable (UUID)." };

        const res = computeUpdate(companion, { ...link, _master: master });
        if (!res) return { ok: false, msg: "Profil inconnu." };

        const prevValues = link.applied?.values ?? {};
        const finalUpdate = {};
        for (const [path, val] of Object.entries(res.update)) {
            // Respect des modifs manuelles : en resync AUTO (non forcée), on ne
            // réécrit pas un champ que quelqu'un a changé depuis notre dernière écriture.
            if (!force && path in prevValues) {
                const current = foundry.utils.getProperty(companion, path);
                if (current !== prevValues[path]) continue;   // modifié à la main → on laisse
            }
            finalUpdate[path] = val;
        }

        // Gain de PV : si hp.max augmente, on ajoute la différence aux PV courants.
        if (PATHS.hpMax in finalUpdate) {
            const oldMax = Number(prevValues[PATHS.hpMax] ?? foundry.utils.getProperty(companion, PATHS.hpMax) ?? 0);
            const newMax = Number(finalUpdate[PATHS.hpMax]);
            const curVal = Number(foundry.utils.getProperty(companion, PATHS.hpValue) ?? oldMax);
            const gained = Math.max(0, newMax - oldMax);
            finalUpdate[PATHS.hpValue] = Math.min(newMax, (Number.isFinite(curVal) ? curVal : newMax) + gained);
        }

        finalUpdate[`flags.${MOD}.${LINK}.applied`] = { level: res.level, values: res.values };
        finalUpdate[`flags.${MOD}.${LINK}.desynced`] = false;
        await companion.update(finalUpdate);
        return { ok: true, level: res.level };
    } catch (e) {
        console.warn(`[${MOD}] applyResync :`, e);
        return { ok: false, msg: "Erreur pendant la resynchronisation." };
    }
}

// ------------------------------------------------------------
// Entrée : resync d'une créature (gère les permissions via un MJ actif)
// ------------------------------------------------------------
async function resyncCompanion(companion, { force = false } = {}) {
    if (!companion) return;
    if (companion.isOwner && game.user.isGM) return void await applyResync(companion, { force });
    if (companion.isOwner) return void await applyResync(companion, { force });   // joueur propriétaire
    const gm = game.users.activeGM;
    if (!gm) {
        // Aucun MJ : on marque la créature désynchronisée (rejeu au prochain ready MJ).
        try { await companion.setFlag(MOD, `${LINK}.desynced`, true); } catch (e) {}
        ui.notifications?.warn("Aucun MJ connecté : la resynchronisation sera rejouée quand un MJ se connectera.");
        return;
    }
    await gm.query("westmarch.companionResync", { actorUuid: companion.uuid, force }).catch(() => null);
}

// MJ : traite la requête de resync (écrit sur l'acteur/token).
async function gmCompanionResync({ actorUuid, force }) {
    const companion = await fromUuid(actorUuid).catch(() => null);
    if (!companion) return { ok: false, msg: "Créature introuvable." };
    return await applyResync(companion, { force: !!force });
}

// ------------------------------------------------------------
// Resync de TOUS les compagnons d'un maître (world + tokens de toutes les scènes)
// ------------------------------------------------------------
function companionsOfMaster(masterUuid) {
    const seen = new Set();
    const out = [];
    const push = (a) => { if (a && !seen.has(a.uuid)) { seen.add(a.uuid); out.push(a); } };
    for (const a of game.actors ?? []) if (getLink(a)?.masterUuid === masterUuid) push(a);
    for (const scene of game.scenes ?? []) {
        for (const t of scene.tokens ?? []) {
            const a = t.actor;
            if (a && getLink(a)?.masterUuid === masterUuid) push(a);
        }
    }
    return out;
}

async function resyncForMaster(master, { force = false } = {}) {
    if (!master?.uuid) return;
    const list = companionsOfMaster(master.uuid);
    for (const c of list) {
        const link = getLink(c);
        if (!force && link?.auto === false) continue;   // seulement les liens automatiques
        await resyncCompanion(c, { force });
    }
    if (list.length) console.log(`[${MOD}] compagnons : ${list.length} resync pour ${master.name}`);
}

// ============================================================
// Hooks
// ============================================================
export function CompanionHooks() {
    // Expose une API/macro : game.modules.get(MOD).api.resyncCompanion(actor)
    Hooks.once("ready", () => {
        const mod = game.modules.get(MOD);
        if (mod) mod.api = { ...(mod.api ?? {}),
            resyncCompanion: (actor, opts) => resyncCompanion(actor, opts ?? {}),
            resyncForMaster: (master, opts) => resyncForMaster(master, opts ?? {}) };
    });

    if (!enabled()) return;

    // Requête MJ (permissions West Marches).
    CONFIG.queries["westmarch.companionResync"] = gmCompanionResync;

    // Déclencheur AUTO : montée de niveau du maître (item de classe → levels).
    // system.details.level est dérivé : on écoute l'item class, point de vérité.
    Hooks.on("updateItem", (item, changes) => {
        if (!enabled() || !game.user.isGM) return;
        if (item.type !== "class") return;
        if (!foundry.utils.hasProperty(changes, "system.levels")) return;
        const master = item.parent;
        if (master) resyncForMaster(master, { force: false });
    });

    // Créature fraîchement posée portant un lien → resync (auto).
    Hooks.on("createToken", (tokenDoc) => {
        if (!enabled()) return;
        const a = tokenDoc.actor;
        if (a && getLink(a)?.auto !== false && hasLink(a)) resyncCompanion(a, { force: false });
    });

    // Rejeu des créatures marquées désynchronisées (aucun MJ au moment voulu).
    Hooks.once("ready", () => {
        if (!enabled() || !game.user.isGM) return;
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;
        for (const a of game.actors ?? []) if (getLink(a)?.desynced) resyncCompanion(a, { force: false });
        for (const scene of game.scenes ?? [])
            for (const t of scene.tokens ?? []) if (getLink(t.actor)?.desynced) resyncCompanion(t.actor, { force: false });
    });

    // Bouton d'en-tête sur la fiche PNJ (MJ) : lier / resynchroniser.
    Hooks.on("renderApplicationV2", (app, element) => {
        try {
            if (!enabled() || !game.user?.isGM) return;
            const actor = app?.document;
            if (!actor || !(actor instanceof Actor) || actor.type !== "npc") return;
            const root = (element instanceof HTMLElement) ? element : element?.[0];
            const header = root?.querySelector(".window-header");
            if (!header || header.querySelector(".scwm-companion-btn")) return;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.classList.add("header-control", "icon", "fa-solid", "fa-dna", "scwm-companion-btn");
            btn.dataset.tooltip = hasLink(actor) ? "Compagnon évolutif (lié) — configurer" : "Compagnon évolutif — lier à un maître";
            btn.style.color = hasLink(actor) ? "#7fd1a0" : "";
            btn.addEventListener("click", () => openCompanionDialog(actor));
            const title = header.querySelector(".window-title");
            if (title) title.insertAdjacentElement("afterend", btn);
            else header.insertBefore(btn, header.querySelector(".close"));
        } catch (e) { console.warn(`[${MOD}] bouton compagnon :`, e); }
    });
}

// ============================================================
// Dialog : lier / configurer un compagnon (MJ)
// ============================================================
async function openCompanionDialog(companion) {
    const DialogV2 = foundry.applications.api.DialogV2;
    const link = getLink(companion) ?? {};
    const profiles = allProfiles();

    // Maîtres candidats : tous les personnages (PJ).
    const masters = (game.actors ?? []).filter(a => a.type === "character")
        .sort((a, b) => a.name.localeCompare(b.name));
    const curMaster = link.masterUuid ? await fromUuid(link.masterUuid).catch(() => null) : null;
    const masterOpts = `<option value="">— aucun —</option>` + masters.map(m =>
        `<option value="${m.uuid}" ${curMaster?.uuid === m.uuid ? "selected" : ""}>${m.name}</option>`).join("");
    const profileOpts = Object.entries(profiles)
        .sort((a, b) => (a[1].label ?? a[0]).localeCompare(b[1].label ?? b[0], "fr", { sensitivity: "base" }))
        .map(([id, p]) => `<option value="${id}" ${link.profile === id ? "selected" : ""}>${p.label ?? id}</option>`).join("");

    const content = `
    <div style="display:flex;flex-direction:column;gap:8px;">
        <label>Maître (PJ)
            <select name="master" style="width:100%;">${masterOpts}</select></label>
        <label>Profil
            <select name="profile" style="width:100%;">${profileOpts}</select></label>
        <label>Classe de référence (override, optionnel)
            <input type="text" name="classId" value="${link.classId ?? ""}" placeholder="ex. ranger — vide = celle du profil / niveau total" style="width:100%;"></label>
        <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" name="auto" ${link.auto === false ? "" : "checked"}> Resynchroniser automatiquement à la montée de niveau du maître</label>
        <p style="font-size:.8em;color:#999;margin:2px 0 0;">Les stats sont recalculées via le profil (CA, PV…). Complète l'activité « Summon » du système : maîtrise, attaques et DD restent gérés par elle.</p>
    </div>`;

    await DialogV2.wait({
        window: { title: `Compagnon évolutif — ${companion.name}`, icon: "fa-solid fa-dna" },
        position: { width: 460 },
        content,
        rejectClose: false,
        buttons: [
            { action: "save", label: "Enregistrer & resync", icon: "fa-solid fa-save", default: true,
              callback: async (ev, btn) => {
                  const f = btn.form;
                  const masterUuid = f.elements.master.value || null;
                  if (!masterUuid) { ui.notifications?.warn("Choisissez un maître."); return; }
                  const newLink = {
                      masterUuid,
                      profile: f.elements.profile.value,
                      classId: f.elements.classId.value.trim() || null,
                      auto: f.elements.auto.checked,
                      applied: link.applied ?? null,
                      desynced: false,
                  };
                  await companion.setFlag(MOD, LINK, newLink);
                  const r = await applyResync(companion, { force: true });
                  ui.notifications?.[r.ok ? "info" : "warn"](r.ok ? `Compagnon resynchronisé (niveau ${r.level}).` : (r.msg ?? "Échec."));
              } },
            { action: "unlink", label: "Délier", icon: "fa-solid fa-link-slash",
              callback: async () => { await companion.unsetFlag(MOD, LINK); ui.notifications?.info("Compagnon délié."); } },
            { action: "resync", label: "Resync (forcé)", icon: "fa-solid fa-rotate",
              callback: async () => { const r = await applyResync(companion, { force: true }); ui.notifications?.[r.ok ? "info" : "warn"](r.msg ?? `Resynchronisé (niveau ${r.level}).`); } },
            { action: "cancel", label: "Fermer", icon: "fa-solid fa-xmark", callback: () => {} },
        ],
    }).catch(() => {});
}

// Éditeur JSON des profils ajoutés/surchargés par le MJ (réglage world).
export async function openProfilesEditor() {
    const DialogV2 = foundry.applications.api.DialogV2;
    const current = game.settings.get(MOD, "companionProfiles") ?? {};
    const defaultsJson = foundry.utils.escapeHTML(JSON.stringify(DEFAULT_PROFILES, null, 2));
    const content = `
        <details open style="margin-bottom:8px;">
            <summary style="cursor:pointer;font-weight:600;">Profils par défaut (livrés avec le module — lecture seule)</summary>
            <p style="font-size:.8em;color:#999;margin:4px 0;">Toujours actifs. Copie-en un dans la zone ci-dessous et modifie-le pour le surcharger, ou crée un nouvel identifiant.</p>
            <pre style="max-height:180px;overflow:auto;background:rgba(0,0,0,.25);padding:6px;border-radius:5px;font-size:.8em;">${defaultsJson}</pre>
        </details>
        <p style="font-size:.85em;color:#999;margin:0 0 4px;">Tes profils ajoutés/surchargés (JSON) — un identifiant identique à un profil par défaut le remplace :</p>
        <textarea name="json" rows="12" style="width:100%;font-family:monospace;">${foundry.utils.escapeHTML(JSON.stringify(current, null, 2))}</textarea>`;
    await DialogV2.wait({
        window: { title: "Profils de compagnons", icon: "fa-solid fa-sliders" },
        position: { width: 560 },
        content,
        rejectClose: false,
        buttons: [
            { action: "save", label: "Enregistrer", icon: "fa-solid fa-save", default: true,
              callback: async (ev, btn) => {
                  try {
                      const obj = JSON.parse(btn.form.elements.json.value || "{}");
                      await game.settings.set(MOD, "companionProfiles", obj);
                      ui.notifications?.info("Profils enregistrés.");
                  } catch (e) { ui.notifications?.error("JSON invalide : " + e.message); }
              } },
            { action: "cancel", label: "Annuler", icon: "fa-solid fa-xmark", callback: () => {} },
        ],
    }).catch(() => {});
}

// ------------------------------------------------------------
// Menu de réglages : bouton « Éditer les profils » dans les settings du module.
// ------------------------------------------------------------
const _FormBase = foundry.appv1?.api?.FormApplication ?? globalThis.FormApplication
    ?? foundry.applications.api.ApplicationV2;
export class CompanionProfilesMenu extends _FormBase {
    render() { try { openProfilesEditor(); } catch (e) { console.warn(`[${MOD}] menu profils :`, e); } try { this.close?.(); } catch (e) {} return this; }
    async _updateObject() {}
    getData() { return {}; }
}
