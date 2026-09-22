import { MOD } from "./const.js";
// ============================================================
// polymorph.js — DEUX systèmes de transformation distincts :
//   • Wild Shape (aptitude de druide)   — préréglage dnd5e "wildshape"
//   • Polymorphie (sort)                — préréglage dnd5e "polymorph"
//
// On s'appuie sur le MOTEUR DE TRANSFORMATION intégré à dnd5e
// (Actor#transformInto + TransformationSetting + revertOriginalForm), qui
// applique fidèlement les règles PHB 2024 : PV, PV temporaires, retour à la
// forme d'origine à 0 PV, quelles stats sont gardées ou remplacées,
// conservation de la concentration, etc. L'acteur transformé temporaire créé
// par dnd5e est nettoyé automatiquement au retour (revertOriginalForm) et sa
// fiche n'est pas ouverte (renderSheet:false).
//
// Deux listes de formes SÉPARÉES, stockées sur l'acteur :
//   - flag "westmarch.wildShapeForms" : [{ actorId, label }]  (bêtes du druide)
//   - flag "westmarch.polymorphForms" : [{ actorId, label }]  (cibles Polymorphie)
//
// Limites de FP (challenge rating) appliquées de façon stricte :
//   - Wild Shape : FP max selon le niveau de druide (1/4 au niv.2, 1/2 au
//     niv.4, 1 au niv.8) ; Cercle de la Lune : jusqu'à niveau de druide / 3.
//   - Polymorphie : FP de la bête ≤ niveau (ou FP) de la cible.
//   Un joueur est bloqué au-delà ; un MJ peut passer outre après confirmation.
//
// © 2026 Soruta — Tous droits réservés. Usage personnel autorisé. Redistribution et modification interdites.
// ============================================================

const WS_FLAG   = "wildShapeForms";
const POLY_FLAG = "polymorphForms";

// ── Accès au moteur de transformation dnd5e ─────────────────
function transformAvailable() {
    return !!(CONFIG.DND5E?.transformation?.presets && dnd5e?.dataModels?.settings?.TransformationSetting);
}

// Construit un TransformationSetting à partir d'un préréglage dnd5e
// ("wildshape" ou "polymorph"). On convertit les Set en tableaux pour le
// modèle de données.
function buildSettings(presetKey) {
    const preset = CONFIG.DND5E.transformation.presets[presetKey];
    const s = preset?.settings ?? {};
    const src = {
        keep:       [...(s.keep       ?? [])],
        merge:      [...(s.merge      ?? [])],
        effects:    [...(s.effects    ?? [])],
        spellLists: [...(s.spellLists ?? [])],
        other:      [...(s.other      ?? [])],
        tempFormula: s.tempFormula ?? "",
        minimumAC:   s.minimumAC ?? ""
    };
    return new dnd5e.dataModels.settings.TransformationSetting(src);
}

// ── Limites de FP (challenge rating) ────────────────────────
const _druidLevels = (actor) => Number(actor.system?.classes?.druid?.levels ?? 0);
const _isMoonDruid = (actor) => actor.items.some(i =>
    i.type === "subclass" && /moon|lune/i.test(`${i.system?.identifier ?? ""} ${i.name ?? ""}`));

// FP max pour Wild Shape selon les règles PHB 2024.
function maxCrWildShape(actor) {
    const lvl = _druidLevels(actor);
    let cr = lvl >= 8 ? 1 : lvl >= 4 ? 0.5 : lvl >= 2 ? 0.25 : 0;
    if (_isMoonDruid(actor)) cr = Math.max(cr, Math.floor(lvl / 3));   // Cercle de la Lune
    return cr;
}

// FP max pour Polymorphie : niveau (ou FP) de la CIBLE.
function maxCrPolymorph(actor) {
    const lvl = Number(actor.system?.details?.level ?? 0);
    if (lvl > 0) return lvl;
    return Number(actor.system?.details?.cr ?? 0);
}

const _beastCr = (beast) => Number(beast.system?.details?.cr ?? 0);

// Formate une FP pour affichage (0.25 → « 1/4 »).
function fmtCr(cr) {
    if (cr === 0.125) return "1/8";
    if (cr === 0.25)  return "1/4";
    if (cr === 0.5)   return "1/2";
    return String(cr);
}

// ── Transformation ──────────────────────────────────────────
async function doTransform(tokenDoc, beast, kind) {
    const actor = tokenDoc.actor;
    if (!actor) return;
    if (!transformAvailable()) {
        ui.notifications.error("Le moteur de transformation dnd5e est indisponible sur cette version.");
        return;
    }

    // Vérification de la FP (configurable : appliquée ou non, stricte ou non).
    const enforce = game.settings.get(MOD, "transformEnforceCr") !== false;
    const strict  = game.settings.get(MOD, "transformStrictCr") !== false;
    if (enforce) {
        const beastCr = _beastCr(beast);
        const max = kind === "wildshape" ? maxCrWildShape(actor) : maxCrPolymorph(actor);
        const label = kind === "wildshape" ? "Wild Shape" : "Polymorphie";
        if (max != null && beastCr > max) {
            const msg = `${beast.name} a une FP de ${fmtCr(beastCr)}, au-dessus de la limite ${label} (${fmtCr(max)}).`;
            if (!strict) {
                ui.notifications.warn(msg);   // avertissement seul, on continue
            } else if (!game.user.isGM) {
                ui.notifications.warn(msg + " Transformation refusée.");
                return;
            } else {
                const ok = await foundry.applications.api.DialogV2.confirm({
                    window:  { title: "FP dépassée" },
                    content: `<p>${msg}</p><p>Autoriser quand même (MJ) ?</p>`
                });
                if (!ok) return;
            }
        }
    }

    try {
        const settings = buildSettings(kind === "wildshape" ? "wildshape" : "polymorph");
        const result = await actor.transformInto(beast, settings, { renderSheet: false });
        if (!result && !game.user.isGM) {
            ui.notifications.warn("Transformation impossible : le MJ doit activer « Autoriser la métamorphose » dans les réglages du système dnd5e.");
        }
    } catch (e) {
        console.error(`[${MOD}] transformInto échec :`, e);
        ui.notifications.error("Échec de la transformation (voir la console F12).");
    }
}

async function doRevert(tokenDoc) {
    const actor = tokenDoc.actor;
    if (!actor) return;
    try {
        if (typeof actor.revertOriginalForm === "function") await actor.revertOriginalForm();
        else ui.notifications.warn("Retour à la forme normale indisponible sur cette version dnd5e.");
    } catch (e) {
        console.error(`[${MOD}] revertOriginalForm échec :`, e);
        ui.notifications.error("Échec du retour à la forme normale (voir la console F12).");
    }
}

// ── Dialogue de choix de forme ──────────────────────────────
async function openTransformDialog(tokenDoc, forms, kind) {
    const actor = tokenDoc.actor;
    const valid = forms.map(f => ({ ...f, actor: game.actors.get(f.actorId) })).filter(f => f.actor);
    if (!valid.length) {
        ui.notifications.warn("Aucune forme disponible (acteurs configurés introuvables).");
        return;
    }
    const title = kind === "wildshape" ? "Wild Shape — choisir une forme" : "Polymorphie — choisir une forme";
    const max   = kind === "wildshape" ? maxCrWildShape(actor) : maxCrPolymorph(actor);

    const rows = valid.map((f, i) => {
        const a = f.actor;
        const img = a.prototypeToken?.texture?.src || a.img || "icons/svg/mystery-man.svg";
        const cr = _beastCr(a);
        const over = max != null && cr > max;
        return `
            <label class="wm-poly-form-label" style="display:flex; align-items:center; gap:10px; padding:6px 8px; border-radius:4px; cursor:pointer; border:1px solid transparent; margin-bottom:4px; ${over ? "opacity:.55;" : ""}">
                <input type="radio" name="wm-poly-form" id="wm-poly-opt-${i}" value="${i}" ${i === 0 ? "checked" : ""}>
                <img src="${img}" style="width:36px; height:36px; object-fit:cover; border-radius:4px; border:1px solid #555; flex-shrink:0;">
                <span style="flex:1; font-size:13px;">${f.label || a.name}</span>
                <span style="font-size:11px; ${over ? "color:#e58f8f;" : "opacity:.6;"}">FP ${fmtCr(cr)}${over ? " ⚠" : ""}</span>
            </label>`;
    }).join("");

    const hint = max != null
        ? `<div style="font-size:11px;opacity:.7;margin:0 2px 6px;">Limite ${kind === "wildshape" ? "Wild Shape" : "Polymorphie"} : FP ${fmtCr(max)}. ⚠ = au-dessus.</div>`
        : "";

    let sel = 0;
    await foundry.applications.api.DialogV2.wait({
        window:   { title, resizable: false },
        position: { width: 360 },
        content:  `<div style="padding:6px 2px;">${hint}${rows}</div>`,
        rejectClose: false,
        render: () => {
            const root = document.getElementById("wm-poly-opt-0")?.closest(".application, .dialog, form") ?? document.body;
            root.querySelectorAll('[name="wm-poly-form"]').forEach(r =>
                r.addEventListener("change", () => { sel = parseInt(r.value); }));
        },
        buttons: [
            {
                action: "transform", default: true,
                label: kind === "wildshape" ? "Se transformer" : "Métamorphoser",
                icon: `<i class="fa-solid ${kind === "wildshape" ? "fa-paw" : "fa-hat-wizard"}"></i>`,
                callback: async () => { const c = valid[sel]; if (c) await doTransform(tokenDoc, c.actor, kind); }
            },
            { action: "cancel", label: "Annuler", icon: '<i class="fa-solid fa-times"></i>' }
        ]
    });
}

export function PolymorphHooks() {

    // ── Boutons de transformation sous le HUD du token ──────────
    Hooks.on("renderTokenHUD", (hud, html) => {
        if (!game.settings.get(MOD, "enablePolymorph")) return;
        const token = hud.object;
        const actor = token?.actor;
        if (!actor) return;
        if (!game.user.isGM && !actor.isOwner) return;

        const isPoly    = !!actor.getFlag("dnd5e", "isPolymorphed");
        const wsForms   = actor.getFlag(MOD, WS_FLAG)   ?? [];
        const polyForms = actor.getFlag(MOD, POLY_FLAG) ?? [];

        const buttons = [];
        if (isPoly) {
            buttons.push(`<div class="control-icon westmarch-revert" title="Reprendre la forme normale" style="cursor:pointer;"><i class="fa-solid fa-user"></i></div>`);
        } else {
            if (wsForms.length)   buttons.push(`<div class="control-icon westmarch-wildshape" title="Wild Shape" style="cursor:pointer;"><i class="fa-solid fa-paw"></i></div>`);
            if (polyForms.length) buttons.push(`<div class="control-icon westmarch-polymorph" title="Polymorphie" style="cursor:pointer;"><i class="fa-solid fa-hat-wizard"></i></div>`);
        }
        if (!buttons.length) return;

        const bar = $(`
            <div class="westmarch-polymorph-bar" style="position:absolute; bottom:-44px; left:50%; transform:translateX(-50%); display:flex; gap:4px; pointer-events:auto; white-space:nowrap; z-index:1;">
                ${buttons.join("")}
            </div>`);

        bar.find(".westmarch-wildshape").on("click", () => openTransformDialog(token.document, wsForms, "wildshape"));
        bar.find(".westmarch-polymorph").on("click", () => openTransformDialog(token.document, polyForms, "polymorph"));
        bar.find(".westmarch-revert").on("click", () => doRevert(token.document));

        $(html).append(bar);
    });

    // ── Configuration des deux listes de formes (config du token) ──
    Hooks.on("renderPrototypeTokenConfig", (app, html) => {
        if (!game.settings.get(MOD, "enablePolymorph")) return;
        if (!game.user.isGM) return;
        const actor = app.document?.parent ?? app.object?.actor ?? app.actor;
        if (!actor) return;

        const tab = $(html).find(".tab[data-tab='appearance']");
        const host = tab.length ? tab : $(html);
        host.append(makeFormSection(actor, WS_FLAG,   "Formes Wild Shape (WestMarch)"));
        host.append(makeFormSection(actor, POLY_FLAG, "Formes Polymorphie (WestMarch)"));
    });
}

// Construit une section de configuration (recherche + ajout + liste) pour une
// liste de formes donnée (flagKey). Réutilisée pour Wild Shape et Polymorphie.
function makeFormSection(actor, flagKey, legend) {
    const saved = actor.getFlag(MOD, flagKey) ?? [];
    const section = $(`
        <fieldset style="margin-top:12px; border:1px solid #555; padding:8px 12px; border-radius:4px;">
            <legend style="font-weight:bold; font-size:13px;">${legend}</legend>
            <div class="wm-poly-form-list" style="margin-bottom:8px;"></div>
            <div style="display:flex; gap:6px; align-items:center; margin-bottom:4px;">
                <input type="text" class="wm-poly-search-input" placeholder="Rechercher un acteur…" style="flex:1; height:28px; font-size:12px; padding:0 6px;" autocomplete="off">
                <input type="text" class="wm-poly-label-input" placeholder="Label (optionnel)" style="width:130px; height:28px; font-size:12px; padding:0 6px;">
                <button type="button" class="wm-poly-add-btn" title="Ajouter cette forme" style="height:28px; padding:0 10px; flex-shrink:0;"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div class="wm-poly-search-results" style="display:none; max-height:120px; overflow-y:auto; border:1px solid #555; border-radius:3px; background:#1a1a1a; margin-bottom:4px;"></div>
        </fieldset>`);

    const renderForms = (list) => {
        const el = section.find(".wm-poly-form-list").empty();
        if (!list.length) { el.append(`<div style="opacity:0.6; font-size:12px; font-style:italic;">Aucune forme configurée.</div>`); return; }
        list.forEach((f, i) => {
            const a = game.actors.get(f.actorId);
            const name = a?.name ?? `(introuvable : ${f.actorId})`;
            const cr = a ? fmtCr(_beastCr(a)) : "?";
            const disp = f.label ? `${f.label} <span style="opacity:0.5;">(${name})</span>` : name;
            const img = a?.prototypeToken?.texture?.src || a?.img || "icons/svg/mystery-man.svg";
            section.find(".wm-poly-form-list").append($(`
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <img src="${img}" style="width:28px; height:28px; object-fit:cover; border-radius:3px; border:1px solid #555; flex-shrink:0;">
                    <span style="flex:1; font-size:12px;">${disp}</span>
                    <span style="font-size:11px; opacity:.6;">FP ${cr}</span>
                    <div class="wm-poly-remove" data-index="${i}" style="cursor:pointer; color:#c55; padding:2px 6px; flex-shrink:0;" title="Supprimer"><i class="fa-solid fa-trash" style="font-size:11px;"></i></div>
                </div>`));
        });
    };
    renderForms(saved);

    let pendingActorId = null;
    section.find(".wm-poly-search-input").on("input", function () {
        const q = this.value.trim().toLowerCase();
        pendingActorId = null;
        const res = section.find(".wm-poly-search-results");
        if (!q) { res.hide().empty(); return; }
        const matches = game.actors.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8);
        if (!matches.length) { res.hide().empty(); return; }
        res.empty();
        matches.forEach(a => {
            const thumb = a.prototypeToken?.texture?.src || a.img || "icons/svg/mystery-man.svg";
            const row = $(`<div class="wm-poly-actor-result" data-id="${a.id}" style="padding:4px 8px; cursor:pointer; font-size:12px; border-bottom:1px solid #2a2a2a; display:flex; align-items:center; gap:6px;"><img src="${thumb}" style="width:20px; height:20px; object-fit:cover; border-radius:2px; flex-shrink:0;"><span>${a.name}</span></div>`);
            row.on("mouseenter", function () { $(this).css("background", "#2a2a2a"); });
            row.on("mouseleave", function () { $(this).css("background", ""); });
            row.on("mousedown", function () { pendingActorId = a.id; section.find(".wm-poly-search-input").val(a.name); res.hide().empty(); });
            res.append(row);
        });
        res.show();
    });
    section.find(".wm-poly-search-input").on("blur", function () {
        setTimeout(() => section.find(".wm-poly-search-results").hide(), 200);
    });

    section.find(".wm-poly-add-btn").on("click", async () => {
        if (!pendingActorId) { ui.notifications.warn("Sélectionnez un acteur dans la liste de suggestions."); return; }
        const label = section.find(".wm-poly-label-input").val().trim();
        const current = actor.getFlag(MOD, flagKey) ?? [];
        const updated = [...current, { actorId: pendingActorId, label }];
        await actor.setFlag(MOD, flagKey, updated);
        renderForms(updated);
        section.find(".wm-poly-search-input").val("");
        section.find(".wm-poly-label-input").val("");
        pendingActorId = null;
    });
    section.on("click", ".wm-poly-remove", async (ev) => {
        const index = parseInt($(ev.currentTarget).data("index"));
        const current = actor.getFlag(MOD, flagKey) ?? [];
        current.splice(index, 1);
        await actor.setFlag(MOD, flagKey, [...current]);
        renderForms(current);
    });

    return section;
}
