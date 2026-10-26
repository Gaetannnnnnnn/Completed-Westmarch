import { MOD, TM_DEFAULT_SCROLL, TM_DEFAULT_MAGIC, TM_DEFAULT_ROLL } from "./const.js";
import { journal } from "./log.js";
import { Dialog } from "./compat.js";
import { commonPackCraft } from "./settings.js";
import { tl } from "./i18n.js";
// ============================================================
// tm.js — Temps morts : déclaration joueur + validation GM
//
// Côté joueur : bouton sablier dans le header de sa fiche perso
//   → fenêtre pour déclarer compétence, maîtrise/expertise/tools,
//   dates de début/fin et test de compétence optionnel (grisé si < 5 j)
//
// Côté GM : bouton dans le groupe WestMarch de la barre de gauche
//   → fenêtre pré-remplie depuis les déclarations joueurs
//   → le GM valide et applique en un clic
// ============================================================

// ============================================================
// Règles configurables (valeurs / formules / tables) — voir settings.js
// ============================================================
const TM_MATH = { max: Math.max, min: Math.min, floor: Math.floor, ceil: Math.ceil,
                  round: Math.round, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt };

function tmNum(key, def) {
    const n = game.settings.get(MOD, key);
    return Number.isFinite(n) ? n : def;
}

// Évalue une formule GM (chaîne). Vide/invalide -> fallback().
function tmEval(formula, vars, fallback) {
    const f = (formula ?? "").toString().trim();
    if (!f) return fallback();
    try {
        const scope = { ...TM_MATH, ...vars };
        const names = Object.keys(scope);
        const fn = new Function(...names, `"use strict"; return (${f});`);
        const r = fn(...names.map(n => scope[n]));
        return Number.isFinite(r) ? r : fallback();
    } catch (e) {
        journal.avert(tl("[TM] Formule invalide, valeur par défaut utilisée :"), formula, e);
        return fallback();
    }
}

function getScrollTable() {
    const t = game.settings.get(MOD, "tmScrollTable");
    return (Array.isArray(t) && t.length) ? t : TM_DEFAULT_SCROLL;
}
function getMagicTable() {
    const t = game.settings.get(MOD, "tmMagicTable");
    return (Array.isArray(t) && t.length) ? t : TM_DEFAULT_MAGIC;
}
function getRollTable() {
    const t = game.settings.get(MOD, "tmRollTable");
    return (Array.isArray(t) && t.length) ? t : TM_DEFAULT_ROLL;
}
// Multiplicateur configuré pour un résultat de test donné (1ère entrée dont max ≥ résultat).
function getRollMultiplier(rollResult) {
    const sorted = [...getRollTable()].sort((a, b) => (a.max ?? 0) - (b.max ?? 0));
    for (const e of sorted) if (rollResult <= (e.max ?? 0)) return Number(e.mult ?? 1);
    return Number(sorted[sorted.length - 1]?.mult ?? 1);
}
// Libellé de pourcentage à partir d'un multiplicateur (ex. 1.1 → "+10 %").
function multPctLabel(mult) {
    const pct = Math.round((mult - 1) * 100);
    return `${pct >= 0 ? "+" : ""}${pct} %`;
}

export function TmHooks() {
    if (!game.settings.get(MOD, "tmEnabled")) return;

    // La fenêtre GM des temps morts s'ouvre désormais depuis le Casier
    // (bouton « Temps morts ») — plus d'icône dédiée dans la barre WestMarch.

    // ---- Bouton déclaration TM sur la fiche perso (ApplicationV2, joueurs) ----
    Hooks.on("renderApplicationV2", (app, element) => {
        if (game.user.isGM) return;
        if (!app.document || !(app.document instanceof Actor)) return;
        if (app.document.type !== "character") return;
        if (!app.document.isOwner) return;

        const header = element.querySelector(".window-header");
        if (!header || header.querySelector(".westmarch-tm-declare")) return;

        const actor    = app.document;
        const tmFlag   = actor.getFlag(MOD, "tm");
        const items    = tmFlagItems(tmFlag);
        const declared = tmFlag?.declared ?? false;
        const hasCraft = items.some(i => i.type === "craft");

        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("header-control", "icon", "fa-solid", "fa-hourglass-half", "westmarch-tm-declare");
        btn.setAttribute("aria-label", tl("Temps mort"));

        if (declared && items.length > 0) {
            const summary = items.map(i => i.type === "craft" ? `🔨 ${i.craftName || "craft"}` : i.choiceLabel).join(", ");
            btn.dataset.tooltip = tl("TM déclaré ({0} activité{1}) : {2}", items.length, items.length > 1 ? "s" : "", summary);
            btn.style.color = "#2ecc71";
        } else if (items.length > 0) {
            const summary = items.map(i => i.type === "craft" ? `🔨 ${i.craftName || "craft"}` : i.choiceLabel).join(", ");
            btn.dataset.tooltip = tl("TM ({0}) : {1} — cliquer pour déclarer", items.length, summary);
            btn.style.color = hasCraft ? "#3498db" : "#e67e22";
        } else {
            btn.dataset.tooltip = tl("Déclarer mon activité TM");
        }

        btn.addEventListener("click", () => openDeclarationDialog(actor));

        const closeBtn = header.querySelector('[data-action="close"]');
        if (closeBtn) closeBtn.before(btn); else header.appendChild(btn);
    });

}

// ============================================================
// Utilitaires communs
// ============================================================

// Normalise le flag TM en tableau d'items.
// Ancien format (objet plat avec .type) → [flag]
// Nouveau format (.items array) → flag.items
// Pas de flag → []
function tmFlagItems(flag) {
    if (!flag) return [];
    if (Array.isArray(flag.items)) return flag.items;
    if (flag.type) return [flag];
    return [];
}

function buildSkillOptionsHtml(selectedId = null) {
    return Object.entries(CONFIG.DND5E.skills)
        .map(([id, data]) => ({
            id,
            label: game.i18n.localize(data.label),
            abilityAbbr: (game.i18n.localize(
                CONFIG.DND5E.abilities[data.ability]?.abbreviation ?? data.ability
            ) ?? data.ability).toUpperCase()
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(s => `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${s.label} (${s.abilityAbbr})</option>`)
        .join("");
}

function buildMonthOptionsHtml(selectedMonth = 0) {
    const cal = game.time?.calendar;
    if (!cal?.months?.values) {
        return `<option value="${selectedMonth}">${tl("Mois {0}", selectedMonth + 1)}</option>`;
    }
    return Array.from(cal.months.values).map((m, i) => {
        const name = game.i18n.localize(m?.name ?? `Mois ${i + 1}`);
        return `<option value="${i}"${i === selectedMonth ? " selected" : ""}>${name}</option>`;
    }).join("");
}

function getAbilityLabel(skillId) {
    const abilityId = CONFIG.DND5E.skills[skillId]?.ability ?? "int";
    return game.i18n.localize(CONFIG.DND5E.abilities[abilityId]?.label ?? abilityId);
}

function getMonthName(monthIndex) {
    const cal = game.time?.calendar;
    if (!cal?.months?.values) return `Mois ${monthIndex + 1}`;
    return game.i18n.localize(cal.months.values[monthIndex]?.name ?? `Mois ${monthIndex + 1}`);
}

function getPlayerActors() {
    // Inclut les acteurs dont le dossier (ou un ancêtre) s'appelle "PJ",
    // pour gérer les sous-dossiers de PJ (ex. PJ/Groupe1, PJ/Groupe2…).
    function isInPjFolder(actor) {
        let folder = actor.folder;
        while (folder) {
            if (folder.name === "PJ") return true;
            folder = folder.folder; // dossier parent
        }
        return false;
    }
    const owned = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    // Priorité aux PJ rangés dans un dossier "PJ" ; à défaut (aucun dossier
    // "PJ" configuré), on prend tous les personnages possédés par un joueur.
    const inPj = owned.filter(isInPjFolder);
    return (inPj.length ? inPj : owned).sort((a, b) => a.name.localeCompare(b.name));
}

function getActorOwners(actor) {
    return game.users.filter(u => !u.isGM && actor.ownership[u.id] === 3);
}

function getProfLevel(actor, skillId) {
    const s = actor.system.skills?.[skillId];
    return s?.prof?.multiplier ?? s?.proficient ?? 0;
}

function calcDailyRate(actor, skillId, hasMaitrise, hasExpertise, hasTools) {
    const abilityId  = CONFIG.DND5E.skills[skillId]?.ability ?? "int";
    const abilityMod = actor.system.abilities[abilityId]?.mod ?? 0;
    const base  = tmNum("tmSkillBase", 1);
    const mod   = (game.settings.get(MOD, "tmAddAbilityMod") !== false) ? abilityMod : 0;
    const bonus = hasTools     ? tmNum("tmBonusTools", 4)
                : hasExpertise ? tmNum("tmBonusExpertise", 4)
                : hasMaitrise  ? tmNum("tmBonusMaitrise", 2)
                : 0;
    const vars  = { base, mod, bonus,
                    maitrise: hasMaitrise ? 1 : 0,
                    expertise: hasExpertise ? 1 : 0,
                    tools: hasTools ? 1 : 0 };
    return tmEval(game.settings.get(MOD, "tmSkillFormula"), vars, () => Math.max(0, base + mod + bonus));
}

// Convertit une date du calendrier en nombre total de jours depuis l'an 0
// (pour calculer des différences). month0 = 0-indexé, day = 1-indexé.
function calDateToTotalDays(year, month0, day) {
    const cal    = game.time?.calendar;
    const months = cal?.months?.values ? Array.from(cal.months.values) : [];
    const daysPerYear = months.reduce((s, m) => s + (m?.days ?? 30), 0) || 360;

    let total = year * daysPerYear;
    for (let i = 0; i < month0; i++) {
        total += months[i]?.days ?? 30;
    }
    return total + (day - 1); // day est 1-indexé
}

function getDaysFromDates(sDay, sMonth, sYear, eDay, eMonth, eYear) {
    const start = calDateToTotalDays(sYear, sMonth, sDay);
    const end   = calDateToTotalDays(eYear, eMonth, eDay);
    return Math.max(1, end - start + 1);
}

function getCurrentCalDate() {
    try {
        const cal = game.time?.calendar;
        if (!cal) return null;
        const c = cal.timeToComponents(game.time.worldTime);
        return { day: c.dayOfMonth + 1, month: c.month, year: c.year };
    } catch(e) {
        return null;
    }
}

// ============================================================
// Blocs HTML réutilisables
// ============================================================

function skillRowHtml(idPrefix, selectedSkillId) {
    const abilityLabel = getAbilityLabel(selectedSkillId ?? Object.keys(CONFIG.DND5E.skills)[0]);
    return `
<div style="display:flex; gap:6px; align-items:center;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Compétence :")}</label>
    <select name="tm-skill-${idPrefix}" style="flex:1;">${buildSkillOptionsHtml(selectedSkillId)}</select>
</div>
<div class="tm-ability-${idPrefix}" style="font-size:0.85em; color:#888; margin-left:96px; margin-top:-2px;">
    ${tl("Caractéristique : {0}", abilityLabel)}
</div>`;
}

// Noms d'outils connus du perso (items de type "tool"), pour proposer des
// suggestions dans le champ « Outil utilisé ». Best-effort, jamais bloquant.
function getActorToolNames(actor) {
    try {
        return (actor?.items ?? [])
            .filter(i => i.type === "tool")
            .map(i => i.name)
            .filter(Boolean);
    } catch (e) { return []; }
}

// Ligne « Outil utilisé » — masquée par défaut, révélée quand « Tools » est coché.
// On demande QUEL outil est employé (au lieu d'afficher la compétence).
function toolRowHtml(idPrefix, actor) {
    const tools   = getActorToolNames(actor);
    const listId  = `tm-tools-datalist-${idPrefix}`;
    const options = tools.map(n => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("");
    return `
<div class="tm-tool-row-${idPrefix}" style="display:none; flex-direction:column; gap:2px;">
    <div style="display:flex; gap:6px; align-items:center;">
        <label style="min-width:90px; white-space:nowrap;">${tl("Outil utilisé :")}</label>
        <input type="text" name="tm-tool-${idPrefix}" list="${listId}"
               placeholder="${tl("ex. Outils de forgeron")}" style="flex:1;">
        <datalist id="${listId}">${options}</datalist>
    </div>
    <div style="font-size:0.82em; color:#888; margin-left:96px; margin-top:-1px;">
        ${tl("La compétence choisie ci-dessus ne sert alors qu'à la caractéristique associée.")}
    </div>
</div>`;
}

function profRowHtml(idPrefix, hasMaitrise, hasExpertise, hasTools) {
    const profBlocked  = hasTools;
    const toolsBlocked = hasMaitrise || hasExpertise;
    const expBlocked   = profBlocked || !hasMaitrise;

    const profOp  = profBlocked  ? "0.4" : "1";
    const toolsOp = toolsBlocked ? "0.4" : "1";

    return `
<div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; opacity:${profOp};">
        <input type="checkbox" name="tm-maitrise-${idPrefix}"
               ${hasMaitrise && !hasTools ? "checked" : ""}
               ${profBlocked ? "disabled" : ""} style="margin:0;">
        ${tl("Maîtrise <em style=\"color:#888;\">(+{0} po/j)</em>", tmNum("tmBonusMaitrise", 2))}
    </label>
    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; opacity:${profOp};">
        <input type="checkbox" name="tm-expertise-${idPrefix}"
               ${hasExpertise && !hasTools ? "checked" : ""}
               ${expBlocked ? "disabled" : ""} style="margin:0;">
        ${tl("Expertise <em style=\"color:#888;\">(+{0} po/j)</em>", tmNum("tmBonusExpertise", 4))}
    </label>
    <span style="color:#888; font-style:italic;">${tl("ou")}</span>
    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; opacity:${toolsOp};">
        <input type="checkbox" name="tm-tools-${idPrefix}"
               ${hasTools ? "checked" : ""}
               ${toolsBlocked ? "disabled" : ""} style="margin:0;">
        ${tl("Tools <em style=\"color:#888;\">(+{0} po/j)</em>", tmNum("tmBonusTools", 4))}
    </label>
</div>`;
}

function previewHtml(idPrefix) {
    return `<div class="tm-preview-${idPrefix}" style="color:#888; font-style:italic; font-size:0.9em;">—</div>`;
}

function dateAndRollHtml(idPrefix, sDay, sMonth, sYear, eDay, eMonth, eYear, preDoRoll) {
    const days         = getDaysFromDates(sDay, sMonth, sYear, eDay, eMonth, eYear);
    const tooFew       = days < tmNum("tmRollMinDays", 5);
    const rollDisabled = tooFew ? " disabled" : "";
    const rollChecked  = preDoRoll && !tooFew ? " checked" : "";
    const rollOpacity  = tooFew ? " opacity:0.4;" : "";
    return `
<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Date début :")}</label>
    <input type="number" name="tm-sday-${idPrefix}" value="${sDay}" min="1" max="30" style="width:50px;">
    <select name="tm-smonth-${idPrefix}">${buildMonthOptionsHtml(sMonth)}</select>
    <input type="number" name="tm-syear-${idPrefix}" value="${sYear}" min="1" style="width:70px;">
</div>
<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Date fin :")}</label>
    <input type="number" name="tm-eday-${idPrefix}" value="${eDay}" min="1" max="30" style="width:50px;">
    <select name="tm-emonth-${idPrefix}">${buildMonthOptionsHtml(eMonth)}</select>
    <input type="number" name="tm-eyear-${idPrefix}" value="${eYear}" min="1" style="width:70px;">
</div>
<div class="tm-daycount-${idPrefix}" style="font-size:0.85em; color:#888; margin-left:96px; margin-top:-2px;">
    ${tl("→ {0} jour{1}", days, days > 1 ? "s" : "")}
</div>
<div class="tm-d20-row-${idPrefix}" style="display:flex; gap:6px; align-items:center;${rollOpacity}">
    <input type="checkbox" name="tm-roll-${idPrefix}"${rollChecked}${rollDisabled} style="margin:0;">
    <label style="margin:0;">${tl("Test de compétence <em style=\"color:#888;\">(≥ {0} jours requis)</em>", tmNum("tmRollMinDays", 5))}</label>
</div>
<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Bonus au jet :")}</label>
    <input type="text" name="tm-bonus-${idPrefix}" value="" placeholder="+10, 1d6…" style="width:80px;">
    <input type="text" name="tm-bonus-src-${idPrefix}" value="" placeholder="${tl("Provenance du bonus…")}" style="flex:1;">
</div>`;
}

// ============================================================
// Câblage dynamique (dates, d20, proficiencies, preview)
// ============================================================

function wireControls(html, actor, idPrefix) {

    function getDays() {
        const sDay   = Math.max(1, parseInt(html.find(`[name="tm-sday-${idPrefix}"]`).val())   || 1);
        const sMonth = parseInt(html.find(`[name="tm-smonth-${idPrefix}"]`).val()) || 0;
        const sYear  = Math.max(1, parseInt(html.find(`[name="tm-syear-${idPrefix}"]`).val())  || 1);
        const eDay   = Math.max(1, parseInt(html.find(`[name="tm-eday-${idPrefix}"]`).val())   || 1);
        const eMonth = parseInt(html.find(`[name="tm-emonth-${idPrefix}"]`).val()) || 0;
        const eYear  = Math.max(1, parseInt(html.find(`[name="tm-eyear-${idPrefix}"]`).val())  || 1);
        return getDaysFromDates(sDay, sMonth, sYear, eDay, eMonth, eYear);
    }

    function refreshDayCount() {
        const days = getDays();
        html.find(`.tm-daycount-${idPrefix}`).text(`→ ${days} jour${days > 1 ? "s" : ""}`);
    }

    function refreshD20() {
        const tooFew = getDays() < tmNum("tmRollMinDays", 5);
        const d20box = html.find(`[name="tm-roll-${idPrefix}"]`);
        d20box.prop("disabled", tooFew);
        if (tooFew) d20box.prop("checked", false);
        html.find(`.tm-d20-row-${idPrefix}`).css("opacity", tooFew ? "0.4" : "1");
    }

    function refreshPreview() {
        const skillId      = html.find(`[name="tm-skill-${idPrefix}"]`).val();
        const hasMaitrise  = html.find(`[name="tm-maitrise-${idPrefix}"]`).prop("checked");
        const hasExpertise = html.find(`[name="tm-expertise-${idPrefix}"]`).prop("checked");
        const hasTools     = html.find(`[name="tm-tools-${idPrefix}"]`).prop("checked");
        const days         = getDays();
        const rate         = calcDailyRate(actor, skillId, hasMaitrise, hasExpertise, hasTools);
        const bonusRaw     = html.find(`[name="tm-bonus-${idPrefix}"]`).val()?.trim() ?? "";
        const bonusSrc     = html.find(`[name="tm-bonus-src-${idPrefix}"]`).val()?.trim() ?? "";
        const bonusPart    = bonusRaw ? ` · bonus jet : ${bonusRaw}${bonusSrc ? ` (${bonusSrc})` : ""}` : "";
        html.find(`.tm-preview-${idPrefix}`)
            .text(tl("≈ {0} po/jour → {1} po sur {2} jour{3}{4}", rate, Math.round(rate * days), days, days > 1 ? "s" : "", bonusPart));
    }

    function refreshAbility() {
        const skillId = html.find(`[name="tm-skill-${idPrefix}"]`).val();
        html.find(`.tm-ability-${idPrefix}`).text(tl("Caractéristique : {0}", getAbilityLabel(skillId)));
    }

    function refreshProf() {
        const hasMaitrise  = html.find(`[name="tm-maitrise-${idPrefix}"]`).prop("checked");
        const hasExpertise = html.find(`[name="tm-expertise-${idPrefix}"]`).prop("checked");
        const hasTools     = html.find(`[name="tm-tools-${idPrefix}"]`).prop("checked");
        const profBlocked  = hasTools;
        const toolsBlocked = hasMaitrise || hasExpertise;

        html.find(`[name="tm-maitrise-${idPrefix}"]`)
            .prop("disabled", profBlocked)
            .closest("label").css("opacity", profBlocked ? "0.4" : "1");

        html.find(`[name="tm-expertise-${idPrefix}"]`)
            .prop("disabled", profBlocked || !hasMaitrise)
            .closest("label").css("opacity", profBlocked ? "0.4" : "1");

        html.find(`[name="tm-tools-${idPrefix}"]`)
            .prop("disabled", toolsBlocked)
            .closest("label").css("opacity", toolsBlocked ? "0.4" : "1");

        // Révèle le champ « Outil utilisé » uniquement quand Tools est actif.
        html.find(`.tm-tool-row-${idPrefix}`).css("display", hasTools ? "flex" : "none");
    }

    // Changement de compétence → caractéristique + maîtrise/expertise auto
    html.find(`[name="tm-skill-${idPrefix}"]`).on("change", () => {
        const skillId   = html.find(`[name="tm-skill-${idPrefix}"]`).val();
        const profLevel = getProfLevel(actor, skillId);
        html.find(`[name="tm-maitrise-${idPrefix}"]`).prop("checked", profLevel >= 1);
        html.find(`[name="tm-expertise-${idPrefix}"]`).prop("checked", profLevel >= 2);
        if (profLevel >= 1) html.find(`[name="tm-tools-${idPrefix}"]`).prop("checked", false);
        refreshAbility();
        refreshProf();
        refreshPreview();
    });

    // Décocher maîtrise → décoche aussi expertise
    html.find(`[name="tm-maitrise-${idPrefix}"]`).on("change", () => {
        if (!html.find(`[name="tm-maitrise-${idPrefix}"]`).prop("checked"))
            html.find(`[name="tm-expertise-${idPrefix}"]`).prop("checked", false);
        refreshProf();
        refreshPreview();
    });

    html.find(`[name="tm-expertise-${idPrefix}"]`).on("change", () => { refreshProf(); refreshPreview(); });

    // Cocher Tools → décoche maîtrise et expertise
    html.find(`[name="tm-tools-${idPrefix}"]`).on("change", () => {
        if (html.find(`[name="tm-tools-${idPrefix}"]`).prop("checked")) {
            html.find(`[name="tm-maitrise-${idPrefix}"]`).prop("checked", false);
            html.find(`[name="tm-expertise-${idPrefix}"]`).prop("checked", false);
        }
        refreshProf();
        refreshPreview();
    });

    // Changement de date → recalcule tout
    const dateFields = [
        `[name="tm-sday-${idPrefix}"]`, `[name="tm-smonth-${idPrefix}"]`, `[name="tm-syear-${idPrefix}"]`,
        `[name="tm-eday-${idPrefix}"]`, `[name="tm-emonth-${idPrefix}"]`, `[name="tm-eyear-${idPrefix}"]`
    ].join(", ");
    html.find(dateFields).on("change input", () => { refreshDayCount(); refreshD20(); refreshPreview(); });
    html.find(`[name="tm-bonus-${idPrefix}"], [name="tm-bonus-src-${idPrefix}"]`).on("change input", refreshPreview);

    // État initial
    refreshAbility();
    refreshProf();
    refreshDayCount();
    refreshD20();
    refreshPreview();
}

// ============================================================
// Tables de craft (règles serveur — Fabriquer un objet)
// ============================================================

// Tables déplacées vers les réglages configurables : getScrollTable() / getMagicTable().

function getCraftStats(craftType, price, scrollLevel, rarity, singleUse) {
    let totalDays = 0, cost = 0;
    if (craftType === "nonmagique") {
        const div       = tmNum("tmCraftNonMagicCostDiv", 2);
        const daysPerGp = tmNum("tmCraftNonMagicDaysPerGp", 10);
        const vars      = { price, div, daysPerGp };
        cost      = Math.floor(tmEval(game.settings.get(MOD, "tmCraftNonMagicCostFormula"), vars, () => price / div));
        totalDays = Math.ceil(tmEval(game.settings.get(MOD, "tmCraftNonMagicDaysFormula"), vars, () => Math.ceil(price / daysPerGp)));
    } else if (craftType === "parchemin") {
        const table = getScrollTable();
        const row   = table[Math.min(Math.max(scrollLevel, 0), table.length - 1)] ?? { days: 0, cost: 0 };
        totalDays = row.days;
        cost      = row.cost;
    } else if (craftType === "magique") {
        const table  = getMagicTable();
        const row    = table.find(r => r.key === rarity) ?? table[0] ?? { days: 0, cost: 0 };
        const factor = tmNum("tmSingleUseFactor", 0.5);
        totalDays = singleUse ? Math.ceil(row.days * factor) : row.days;
        cost      = singleUse ? Math.ceil(row.cost * factor) : row.cost;
    }
    return { totalDays, cost };
}

// Déduit un coût en PO en convertissant au besoin PP, PA et PC.
// Toutes les devises sont ramenées en cuivres, le coût est soustrait,
// puis le reste est redistribué de façon optimale (PP → PO → PA → PC).
// L'électrum (EP) est absorbé dans la valeur totale et non restitué.
// Retourne true si le paiement était complet, false si fonds insuffisants.
async function deductGoldCost(actor, costGP) {
    const cur = actor.system.currency ?? {};
    const pp  = cur.pp ?? 0;
    const gp  = cur.gp ?? 0;
    const ep  = cur.ep ?? 0;  // 1 ep = 0,5 po = 50 pc
    const sp  = cur.sp ?? 0;
    const cp  = cur.cp ?? 0;

    // Total en cuivres (base commune)
    const totalCP = pp * 1000 + gp * 100 + ep * 50 + sp * 10 + cp;
    const costCP  = Math.round(costGP * 100);
    const enough  = totalCP >= costCP;
    const leftCP  = Math.max(0, totalCP - costCP);

    // Redistribution optimale PP → PO → PA → PC (EP converti)
    const newPP = Math.floor(leftCP / 1000);
    const newGP = Math.floor((leftCP % 1000) / 100);
    const newSP = Math.floor((leftCP % 100)  / 10);
    const newCP = leftCP % 10;

    await actor.update({
        "system.currency.pp": newPP,
        "system.currency.gp": newGP,
        "system.currency.ep": 0,
        "system.currency.sp": newSP,
        "system.currency.cp": newCP
    });
    return enough;
}

// Ajoute automatiquement l'objet fabriqué à la fiche, en le cherchant PAR NOM
// dans le compendium configuré (setting tmCraftPack). Retourne le nom de l'objet
// ajouté, ou null si aucun compendium n'est réglé / objet introuvable / erreur.
function _normName(s) {
    return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
async function grantCraftedItem(actor, craftName, craftUuid) {
    try {
        // 1) Objet EXACT choisi dans le compendium (uuid).
        if (craftUuid) {
            const doc = await fromUuid(craftUuid);
            if (doc) {
                const data = doc.toObject();
                delete data._id;
                await actor.createEmbeddedDocuments("Item", [data]);
                return doc.name;
            }
        }

        // 2) Repli : recherche par nom dans le compendium configuré.
        const coll = commonPackCraft();
        if (!coll) return null;
        const pack = game.packs.get(coll);
        if (!pack || pack.documentName !== "Item") return null;

        const index = await pack.getIndex();
        const target = _normName(craftName);
        if (!target) return null;

        let entry = index.find(e => _normName(e.name) === target)
                 ?? index.find(e => _normName(e.name).includes(target) || target.includes(_normName(e.name)));
        if (!entry) return null;

        const doc = await pack.getDocument(entry._id);
        if (!doc) return null;
        const data = doc.toObject();
        delete data._id;
        await actor.createEmbeddedDocuments("Item", [data]);
        return doc.name;
    } catch (e) {
        journal.avert(tl("[TM] Ajout de l'objet craft échoué :"), e);
        return null;
    }
}

// Sélecteur d'objets (barre de recherche) lié au compendium craftable configuré.
// Retourne { uuid, name, priceGp } ou null.
async function pickCraftItem() {
    const coll = commonPackCraft();
    if (!coll) { ui.notifications?.warn(tl("Aucun compendium d'objets craftables configuré (réglages → Temps morts).")); return null; }
    const pack = game.packs.get(coll);
    if (!pack || pack.documentName !== "Item") { ui.notifications?.warn(tl("Le compendium configuré n'est pas un compendium d'objets.")); return null; }

    const index = await pack.getIndex({ fields: ["system.price.value", "system.price.denomination"] });
    const denomFactor = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };
    const entries = [...index].map(e => {
        const v = e.system?.price?.value;
        const d = e.system?.price?.denomination ?? "gp";
        return {
            uuid: `Compendium.${pack.collection}.Item.${e._id}`,
            name: e.name ?? tl("Objet"),
            priceGp: (v != null) ? v * (denomFactor[d] ?? 1) : null
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    return await new Promise(resolve => {
        const rows = entries.map((e, i) =>
            `<div class="tm-pick-row" data-i="${i}" style="padding:4px 6px; cursor:pointer; border-bottom:1px solid rgba(128,128,128,0.2);">
                ${esc(e.name)}${e.priceGp != null ? ` <span style="color:#888;">${tl("— {0} po", Math.round(e.priceGp))}</span>` : ""}
            </div>`).join("") || `<p style="opacity:.7; padding:8px;">${tl("Ce compendium ne contient aucun objet.")}</p>`;

        const content = `
            <input type="text" class="tm-pick-search" placeholder="Rechercher un objet…" style="width:100%; margin-bottom:6px;">
            <div class="tm-pick-list" style="max-height:340px; overflow:auto; border:1px solid rgba(128,128,128,0.3); border-radius:4px;">${rows}</div>`;

        let done = false;
        const finish = (val) => { if (!done) { done = true; resolve(val); } };

        const dlg = new Dialog({
            title: tl("{0} — choisir un objet", pack.title ?? pack.metadata?.label ?? "Compendium"),
            content,
            buttons: { cancel: { icon: '<i class="fa-solid fa-times"></i>', label: tl("Annuler"), callback: () => finish(null) } },
            default: "cancel",
            render: (html) => {
                const root = html[0] ?? html;
                const search = root.querySelector(".tm-pick-search");
                search?.addEventListener("input", () => {
                    const q = _normName(search.value);
                    root.querySelectorAll(".tm-pick-row").forEach(r => {
                        const e = entries[+r.dataset.i];
                        r.style.display = _normName(e.name).includes(q) ? "" : "none";
                    });
                });
                root.querySelectorAll(".tm-pick-row").forEach(r =>
                    r.addEventListener("click", () => { finish(entries[+r.dataset.i]); dlg.close(); }));
                setTimeout(() => search?.focus(), 50);
            },
            close: () => finish(null)
        }, { width: 440, height: 480, resizable: true });
        dlg.render(true);
    });
}

function craftTypeLabel(ct) {
    if (ct === "nonmagique") return tl("Non-magique");
    if (ct === "parchemin")  return tl("Parchemin");
    if (ct === "magique")    return tl("Objet magique");
    return ct ?? "—";
}

// Retourne une courte description du craft : type/rareté + coût
function craftInfoStr(item) {
    const type = item.craftType ?? "nonmagique";
    const cost = item.craftCost ?? 0;
    if (type === "parchemin") {
        const levels = [tl("Sort mineur"), "Niv. 1", "Niv. 2", "Niv. 3", "Niv. 4",
                        "Niv. 5",    "Niv. 6", "Niv. 7", "Niv. 8", "Niv. 9"];
        return `Parchemin ${levels[item.craftScrollLevel ?? 0] ?? "?"} — ${cost} po`;
    }
    if (type === "magique") {
        const row    = getMagicTable().find(r => r.key === item.craftRarity) ?? getMagicTable()[0];
        const label  = item.craftSingleUse ? `${row.label} (usage unique)` : row.label;
        return `${label} — ${cost} po`;
    }
    // nonmagique
    return tl("Non-magique — {0} po", cost);
}

// ============================================================
// Formulaire craft — joueur
// ============================================================

function craftDeclFormHtml(id, craftType, craftName, price, scrollLevel, rarity, singleUse, daysAlready, sDay, sMonth, sYear, eDay, eMonth, eYear, craftUuid = "") {
    const scrollOptions = [
        tl("Sort mineur"), tl("Niveau 1"), tl("Niveau 2"), tl("Niveau 3"), tl("Niveau 4"),
        tl("Niveau 5"),    tl("Niveau 6"), tl("Niveau 7"), tl("Niveau 8"), tl("Niveau 9")
    ].map((l, i) => `<option value="${i}"${i === scrollLevel ? " selected" : ""}>${l}</option>`).join("");

    const rarityOptions = getMagicTable().map(r =>
        `<option value="${r.key}"${r.key === rarity ? " selected" : ""}>${tl("{0} (≥ niv. {1})", r.label, r.lvl)}</option>`
    ).join("");

    const { totalDays, cost } = getCraftStats(craftType, price, scrollLevel, rarity, singleUse);
    const workDays  = getDaysFromDates(sDay, sMonth, sYear, eDay, eMonth, eYear);
    const newTotal  = daysAlready + workDays;
    const remaining = Math.max(0, totalDays - newTotal);
    const prevStr   = remaining === 0
        ? tl("Coût : {0} po · Durée : {1} j → ✅ Terminé !", cost, totalDays)
        : tl("Coût : {0} po · Durée : {1} j · Ce TM : {2} j → {3} j restants", cost, totalDays, workDays, remaining);

    return `
<div style="display:flex; gap:6px; align-items:center;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Type :")}</label>
    <select name="tm-craft-type-${id}" style="flex:1;">
        <option value="nonmagique"${craftType === "nonmagique" ? " selected" : ""}>${tl("Non-magique")}</option>
        <option value="parchemin" ${craftType === "parchemin"  ? " selected" : ""}>${tl("Parchemin de sort")}</option>
        <option value="magique"   ${craftType === "magique"    ? " selected" : ""}>${tl("Objet magique")}</option>
    </select>
</div>
<div style="display:flex; gap:6px; align-items:center;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Nom :")}</label>
    <input type="text" name="tm-craft-name-${id}" value="${craftName}" placeholder="${tl("Choisir un objet…")}" style="flex:1; cursor:pointer;" readonly title="${tl("Cliquez sur l'icône livre pour choisir un objet du compendium")}">
    <input type="hidden" name="tm-craft-uuid-${id}" value="${craftUuid ?? ""}">
    <button type="button" class="tm-craft-pick-${id}" title="${tl("Choisir dans le compendium des objets craftables")}" style="flex:0 0 auto; width:30px;"><i class="fa-solid fa-book"></i></button>
</div>
<div class="tm-craft-param-nonmagique-${id}" style="display:${craftType === "nonmagique" ? "flex" : "none"}; gap:6px; align-items:center;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Prix d'achat :")}</label>
    <input type="number" name="tm-craft-price-${id}" value="${price}" min="1" style="width:80px;"> ${tl("po")}
</div>
<div class="tm-craft-param-parchemin-${id}" style="display:${craftType === "parchemin" ? "flex" : "none"}; gap:6px; align-items:center;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Niveau sort :")}</label>
    <select name="tm-craft-scroll-${id}">${scrollOptions}</select>
</div>
<div class="tm-craft-param-magique-${id}" style="display:${craftType === "magique" ? "flex" : "none"}; gap:6px; align-items:center; flex-wrap:wrap;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Rareté :")}</label>
    <select name="tm-craft-rarity-${id}" style="flex:1;">${rarityOptions}</select>
    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
        <input type="checkbox" name="tm-craft-single-${id}"${singleUse ? " checked" : ""}> ${tl("Usage unique (÷2)")}
    </label>
</div>
<div style="display:flex; gap:6px; align-items:center;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Déjà fait :")}</label>
    <input type="number" name="tm-craft-done-${id}" value="${daysAlready}" min="0" style="width:60px;"> j
    <span style="color:#888; font-size:0.85em;">${tl("sur {0} j total", totalDays)}</span>
</div>
<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:4px;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Date début :")}</label>
    <input type="number" name="tm-craft-sday-${id}" value="${sDay}" min="1" max="30" style="width:50px;">
    <select name="tm-craft-smonth-${id}">${buildMonthOptionsHtml(sMonth)}</select>
    <input type="number" name="tm-craft-syear-${id}" value="${sYear}" min="1" style="width:70px;">
</div>
<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
    <label style="min-width:90px; white-space:nowrap;">${tl("Date fin :")}</label>
    <input type="number" name="tm-craft-eday-${id}" value="${eDay}" min="1" max="30" style="width:50px;">
    <select name="tm-craft-emonth-${id}">${buildMonthOptionsHtml(eMonth)}</select>
    <input type="number" name="tm-craft-eyear-${id}" value="${eYear}" min="1" style="width:70px;">
</div>
<div class="tm-craft-daycount-${id}" style="font-size:0.85em; color:#888; margin-left:96px; margin-top:-2px;">
    ${tl("→ {0} jour{1}", workDays, workDays > 1 ? "s" : "")}
</div>
<div class="tm-craft-preview-${id}" style="color:#888; font-style:italic; font-size:0.9em;">${prevStr}</div>`;
}

function wireCraftControls(html, idPrefix) {
    function getDays() {
        const sDay   = Math.max(1, parseInt(html.find(`[name="tm-craft-sday-${idPrefix}"]`).val())   || 1);
        const sMonth = parseInt(html.find(`[name="tm-craft-smonth-${idPrefix}"]`).val()) || 0;
        const sYear  = Math.max(1, parseInt(html.find(`[name="tm-craft-syear-${idPrefix}"]`).val())  || 1);
        const eDay   = Math.max(1, parseInt(html.find(`[name="tm-craft-eday-${idPrefix}"]`).val())   || 1);
        const eMonth = parseInt(html.find(`[name="tm-craft-emonth-${idPrefix}"]`).val()) || 0;
        const eYear  = Math.max(1, parseInt(html.find(`[name="tm-craft-eyear-${idPrefix}"]`).val())  || 1);
        return getDaysFromDates(sDay, sMonth, sYear, eDay, eMonth, eYear);
    }

    function getParams() {
        const craftType   = html.find(`[name="tm-craft-type-${idPrefix}"]`).val()  ?? "nonmagique";
        const price       = Math.max(1, parseInt(html.find(`[name="tm-craft-price-${idPrefix}"]`).val())  || 1);
        const scrollLvl   = parseInt(html.find(`[name="tm-craft-scroll-${idPrefix}"]`).val()) || 0;
        const rarity      = html.find(`[name="tm-craft-rarity-${idPrefix}"]`).val() ?? "courant";
        const singleUse   = html.find(`[name="tm-craft-single-${idPrefix}"]`).prop("checked");
        const daysAlready = Math.max(0, parseInt(html.find(`[name="tm-craft-done-${idPrefix}"]`).val()) || 0);
        return { craftType, price, scrollLvl, rarity, singleUse, daysAlready };
    }

    function refreshTypeVisibility() {
        const { craftType } = getParams();
        html.find(`.tm-craft-param-nonmagique-${idPrefix}`).css("display", craftType === "nonmagique" ? "flex" : "none");
        html.find(`.tm-craft-param-parchemin-${idPrefix}`).css("display",  craftType === "parchemin"  ? "flex" : "none");
        html.find(`.tm-craft-param-magique-${idPrefix}`).css("display",    craftType === "magique"    ? "flex" : "none");
    }

    function refreshPreview() {
        const { craftType, price, scrollLvl, rarity, singleUse, daysAlready } = getParams();
        const workDays  = getDays();
        const { totalDays, cost } = getCraftStats(craftType, price, scrollLvl, rarity, singleUse);
        const newTotal  = daysAlready + workDays;
        const remaining = Math.max(0, totalDays - newTotal);

        html.find(`.tm-craft-daycount-${idPrefix}`).text(`→ ${workDays} jour${workDays > 1 ? "s" : ""}`);
        html.find(`.tm-craft-param-nonmagique-${idPrefix}`).find(`[name="tm-craft-done-${idPrefix}"]`);

        let preview = tl("Coût : {0} po · Durée : {1} j", cost, totalDays);
        if (daysAlready > 0) preview += ` ${tl("· Déjà fait : {0} j", daysAlready)}`;
        preview += ` ${tl("· Ce TM : {0} j", workDays)}`;
        preview += remaining === 0 ? ` ${tl("→ ✅ Terminé !")}` : ` → ${remaining} j restants`;
        html.find(`.tm-craft-preview-${idPrefix}`).text(preview);

        // Mise à jour du "sur X j total" à côté du champ Déjà fait
        html.find(`[name="tm-craft-done-${idPrefix}"]`).closest("div").find("span").text(tl("sur {0} j total", totalDays));
    }

    // Bouton « choisir dans le compendium » : remplit nom, uuid et prix.
    // Ouverture du sélecteur de compendium : via le bouton livre OU un clic
    // direct sur le champ (en lecture seule, il ne sert qu'à afficher le choix).
    const openPicker = async () => {
        const picked = await pickCraftItem();
        if (!picked) return;
        html.find(`[name="tm-craft-name-${idPrefix}"]`).val(picked.name);
        html.find(`[name="tm-craft-uuid-${idPrefix}"]`).val(picked.uuid);
        if (picked.priceGp != null) {
            html.find(`[name="tm-craft-type-${idPrefix}"]`).val("nonmagique");
            html.find(`[name="tm-craft-price-${idPrefix}"]`).val(Math.max(1, Math.round(picked.priceGp)));
            refreshTypeVisibility();
        }
        refreshPreview();
    };
    html.find(`.tm-craft-pick-${idPrefix}`).on("click", openPicker);
    html.find(`[name="tm-craft-name-${idPrefix}"]`).on("click", openPicker);

    html.find(`[name="tm-craft-type-${idPrefix}"]`).on("change", () => { refreshTypeVisibility(); refreshPreview(); });
    html.find(`[name="tm-craft-price-${idPrefix}"], [name="tm-craft-scroll-${idPrefix}"], [name="tm-craft-rarity-${idPrefix}"], [name="tm-craft-single-${idPrefix}"], [name="tm-craft-done-${idPrefix}"]`)
        .on("change input", refreshPreview);
    const dateFields = [
        `[name="tm-craft-sday-${idPrefix}"]`, `[name="tm-craft-smonth-${idPrefix}"]`, `[name="tm-craft-syear-${idPrefix}"]`,
        `[name="tm-craft-eday-${idPrefix}"]`, `[name="tm-craft-emonth-${idPrefix}"]`, `[name="tm-craft-eyear-${idPrefix}"]`
    ].join(", ");
    html.find(dateFields).on("change input", refreshPreview);

    refreshTypeVisibility();
    refreshPreview();
}

// ============================================================
// Déclaration joueur — système de TM
// ============================================================

async function openDeclarationDialog(actor) {
    const existing = actor.getFlag(MOD, "tm");

    // Charger le TM (rétrocompat ancien format plat)
    let cartItems;
    if (existing?.items) {
        cartItems = existing.items.map(i => ({ ...i }));
    } else if (existing?.type) {
        cartItems = [{ ...existing }];
    } else {
        cartItems = [];
    }

    const today      = getCurrentCalDate() ?? { day: 1, month: 0, year: 1 };
    const firstSkill = Object.keys(CONFIG.DND5E.skills).sort()[0];
    // Si craft en cours non déclaré → pré-remplir le champ "déjà fait"
    const ongoingCraft = !existing?.declared
        ? cartItems.find(i => i.type === "craft" && (i.craftDaysAlready ?? 0) > 0)
        : null;

    function cartHtml(items) {
        if (items.length === 0)
            return `${tl("<em style=\"color:#888; font-size:0.9em;\">TM vide — ajoutez au moins une activité.</em>")}`;
        return items.map((item, i) => {
            const label = item.type === "craft"
                ? `${tl("🔨 <strong>{0}</strong> — {1} — {2} ({3} j) · <em>{4} po</em>", item.craftName || "Craft", craftTypeLabel(item.craftType), item.dateRangeLabel ?? "?", item.days ?? "?", item.craftCost ?? "?")}`
                  + ((item.craftDaysAlready ?? 0) > 0 ? ` ${tl("· {0}/{1} j déjà faits", item.craftDaysAlready, item.craftTotalDays)}` : "")
                : `<strong>${item.choiceLabel ?? item.skillId}</strong> — ${item.dateRangeLabel ?? "?"} (${item.days ?? "?"} j)`;
            return `<div class="tm-cart-item" style="display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid #eee; font-size:0.9em; gap:8px;">
                <span style="flex:1;">${label}</span>
                <button type="button" class="tm-remove-item" data-index="${i}"
                        style="background:none; border:none; color:#e74c3c; cursor:pointer; padding:0 4px; font-size:1.1em; flex-shrink:0;">×</button>
            </div>`;
        }).join("");
    }

    await (foundry.applications.api.DialogV2 ?? DialogV2).wait({
        window: { title: `Temps mort — ${actor.name}`, resizable: true },
        position: { width: 720 },
        content: `
<div style="display:flex; gap:0; align-items:stretch; min-height:380px; max-height:74vh; overflow-y:auto;">

    <!-- GUIDE GAUCHE -->
    <div style="width:175px; flex-shrink:0; background:#1e2235; color:#d0d4e8; border-radius:4px 0 0 4px;
                padding:14px 12px; display:flex; flex-direction:column; gap:10px; font-size:0.88em; line-height:1.45;">
        <div style="font-weight:bold; font-size:1em; color:#fff; letter-spacing:0.03em; margin-bottom:2px;">
            ${tl("📋 Déclarer un TM")}
        </div>
        <div style="border-top:1px solid #3a4060; padding-top:8px; display:flex; flex-direction:column; gap:8px;">

            <div>
                <div style="color:#7eb8f7; font-weight:bold; margin-bottom:2px;">${tl("① Type d'activité")}</div>
                <div style="color:#b0b8d0;">${tl("Choisis <em>Gain de compétence</em> ou <em>🔨 Craft</em>.")}</div>
            </div>

            <div>
                <div style="color:#7eb8f7; font-weight:bold; margin-bottom:2px;">${tl("② Remplis les détails")}</div>
                <div style="color:#b0b8d0;">${tl("Compétence, maîtrise / expertise, dates de début et de fin.")}</div>
            </div>

            <div>
                <div style="color:#7eb8f7; font-weight:bold; margin-bottom:2px;">${tl("③ Ajouter l'activité")}</div>
                <div style="color:#b0b8d0;">${tl("Clique sur le bouton :")}</div>
                <div style="margin-top:4px; background:#2980b9; color:#fff; border-radius:3px;
                            padding:3px 7px; font-weight:bold; font-size:0.93em; display:inline-block;">
                    ${tl("+ Ajouter au TM")}
                </div>
                <div style="color:#9098b0; margin-top:4px; font-size:0.9em;">${tl("Répète les étapes ①②③ pour chaque activité.")}</div>
            </div>

            <div style="border-top:1px solid #3a4060; padding-top:8px;">
                <div style="color:#7eb8f7; font-weight:bold; margin-bottom:2px;">${tl("④ Finaliser")}</div>
                <div style="color:#b0b8d0;">${tl("Quand ton TM est complet, clique sur :")}</div>
                <div style="margin-top:4px; background:#27ae60; color:#fff; border-radius:3px;
                            padding:3px 7px; font-weight:bold; font-size:0.93em; display:inline-block;">
                    ${tl("✔ Déclarer le TM")}
                </div>
                <div style="color:#9098b0; margin-top:4px; font-size:0.9em;">${tl("Le GM recevra ta déclaration.")}</div>
            </div>

        </div>
    </div>

    <!-- FORMULAIRE DROITE -->
    <div style="flex:1; display:flex; flex-direction:column; gap:8px; padding:4px 0 4px 14px; min-width:0;">
        <!-- PANIER -->
        <div style="background:#f5f5f5; border:1px solid #ddd; border-radius:4px; padding:8px; color:#222;">
            <div style="font-weight:bold; margin-bottom:4px; font-size:0.95em;">
                🛒 TM — <span id="tm-cart-count">${tl("{0} activité{1}", cartItems.length, cartItems.length !== 1 ? "s" : "")}</span>
            </div>
            <div id="tm-cart-display">${cartHtml(cartItems)}</div>
        </div>
        <hr style="margin:2px 0;">
        <!-- FORMULAIRE D'AJOUT -->
        <div style="font-size:0.8em; font-weight:bold; color:#666; text-transform:uppercase; letter-spacing:0.04em;">${tl("Ajouter une activité")}</div>
        <div style="display:flex; gap:20px; padding:4px 0 6px; border-bottom:1px solid #ddd;">
            <label style="cursor:pointer; display:flex; align-items:center; gap:6px; font-weight:bold;">
                <input type="radio" name="tm-type-decl" value="gain" checked> ${tl("Gain de compétence")}
            </label>
            <label style="cursor:pointer; display:flex; align-items:center; gap:6px; font-weight:bold;">
                <input type="radio" name="tm-type-decl" value="craft"> 🔨 Craft
            </label>
        </div>
        <div class="tm-section-gain-decl" style="display:flex; flex-direction:column; gap:8px;">
            ${skillRowHtml("decl", firstSkill)}
            ${profRowHtml("decl", false, false, false)}
            ${toolRowHtml("decl", actor)}
            ${dateAndRollHtml("decl", today.day, today.month, today.year, today.day, today.month, today.year, false)}
            ${previewHtml("decl")}
        </div>
        <div class="tm-section-craft-decl" style="display:none; flex-direction:column; gap:8px;">
            ${craftDeclFormHtml("decl", "nonmagique", ongoingCraft?.craftName ?? "", ongoingCraft?.craftPrice ?? 50, ongoingCraft?.craftScrollLevel ?? 0, ongoingCraft?.craftRarity ?? "courant", ongoingCraft?.craftSingleUse ?? false, ongoingCraft?.craftDaysAlready ?? 0, today.day, today.month, today.year, today.day, today.month, today.year, ongoingCraft?.craftUuid ?? "")}
        </div>
        <button type="button" id="tm-add-to-cart"
                style="padding:6px 12px; background:#2980b9; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:0.95em;">
            ${tl("+ Ajouter au TM")}
        </button>
        <div style="margin-top:8px; font-size:0.8em; color:#888; font-style:italic; border-top:1px solid #e0e0e0; padding-top:6px;">
            ${tl("📖 Pour en savoir plus sur les règles de temps morts, rendez-vous dans l'onglet <strong>Journal → Temps Morts</strong>.")}
        </div>
    </div>

</div>`,
        rejectClose: false,
        render: () => {
            // Ne pas utiliser l'argument — son type varie (HTMLElement, Event, string…) selon les builds v13.
            // On accède au DOM directement par ID unique ; garanti disponible quand render() est appelé.
            const rootEl = document.getElementById("tm-add-to-cart")
                ?.closest(".application, .dialog, form") ?? document.body;
            const $html = $(rootEl);

            wireControls($html, actor, "decl");
            wireCraftControls($html, "decl");

            $html.find('[name="tm-type-decl"]').on("change", function () {
                const isCraft = this.value === "craft";
                $html.find(".tm-section-gain-decl").css("display", isCraft ? "none" : "flex");
                $html.find(".tm-section-craft-decl").css("display", isCraft ? "flex" : "none");
            });

            function refreshCart() {
                $html.find("#tm-cart-display").html(cartHtml(cartItems));
                $html.find("#tm-cart-count").text(tl("{0} activité{1}", cartItems.length, cartItems.length !== 1 ? "s" : ""));
                $html.find(".tm-remove-item").on("click", async function () {
                    cartItems.splice(parseInt(this.dataset.index), 1);
                    if (cartItems.length === 0) await actor.unsetFlag(MOD, "tm");
                    else await actor.setFlag(MOD, "tm", { declared: false, items: cartItems });
                    refreshCart();
                });
            }
            refreshCart();

            $html.find("#tm-add-to-cart").on("click", async () => {
                const type = $html.find('[name="tm-type-decl"]:checked').val() ?? "gain";

                if (type === "craft") {
                    const craftType   = $html.find('[name="tm-craft-type-decl"]').val();
                    const craftName   = ($html.find('[name="tm-craft-name-decl"]').val() ?? "").trim() || craftTypeLabel(craftType);
                    const craftUuid   = ($html.find('[name="tm-craft-uuid-decl"]').val() ?? "").trim();
                    const price       = Math.max(1, parseInt($html.find('[name="tm-craft-price-decl"]').val())  || 1);
                    const scrollLevel = parseInt($html.find('[name="tm-craft-scroll-decl"]').val())             || 0;
                    const rarity      = $html.find('[name="tm-craft-rarity-decl"]').val()                      ?? "courant";
                    const singleUse   = $html.find('[name="tm-craft-single-decl"]').prop("checked");
                    const daysAlready = Math.max(0, parseInt($html.find('[name="tm-craft-done-decl"]').val())   || 0);
                    const sDay   = Math.max(1, parseInt($html.find('[name="tm-craft-sday-decl"]').val())   || 1);
                    const sMonth = parseInt($html.find('[name="tm-craft-smonth-decl"]').val())             || 0;
                    const sYear  = Math.max(1, parseInt($html.find('[name="tm-craft-syear-decl"]').val())  || 1);
                    const eDay   = Math.max(1, parseInt($html.find('[name="tm-craft-eday-decl"]').val())   || 1);
                    const eMonth = parseInt($html.find('[name="tm-craft-emonth-decl"]').val())             || 0;
                    const eYear  = Math.max(1, parseInt($html.find('[name="tm-craft-eyear-decl"]').val())  || 1);
                    const days            = getDaysFromDates(sDay, sMonth, sYear, eDay, eMonth, eYear);
                    const dateRangeLabel  = `${sDay} ${getMonthName(sMonth)} → ${eDay} ${getMonthName(eMonth)}`;
                    const { totalDays, cost } = getCraftStats(craftType, price, scrollLevel, rarity, singleUse);

                    cartItems.push({
                        type: "craft",
                        craftType, craftName, craftUuid, craftTotalDays: totalDays, craftCost: cost,
                        craftDaysAlready: daysAlready,
                        craftPrice: price, craftScrollLevel: scrollLevel,
                        craftRarity: rarity, craftSingleUse: singleUse,
                        choiceLabel: `🔨 ${craftName}`,
                        startDay: sDay, startMonth: sMonth, startYear: sYear,
                        endDay: eDay, endMonth: eMonth, endYear: eYear,
                        days, dateRangeLabel
                    });

                } else {
                    const skillId      = $html.find('[name="tm-skill-decl"]').val();
                    const hasMaitrise  = $html.find('[name="tm-maitrise-decl"]').prop("checked");
                    const hasExpertise = $html.find('[name="tm-expertise-decl"]').prop("checked");
                    const hasTools     = $html.find('[name="tm-tools-decl"]').prop("checked");
                    const toolName     = ($html.find('[name="tm-tool-decl"]').val() ?? "").trim();
                    const doRoll       = $html.find('[name="tm-roll-decl"]').prop("checked");
                    const bonusRoll    = ($html.find('[name="tm-bonus-decl"]').val() ?? "").trim();
                    const bonusSrc     = ($html.find('[name="tm-bonus-src-decl"]').val() ?? "").trim();
                    const sDay   = Math.max(1, parseInt($html.find('[name="tm-sday-decl"]').val())   || 1);
                    const sMonth = parseInt($html.find('[name="tm-smonth-decl"]').val())             || 0;
                    const sYear  = Math.max(1, parseInt($html.find('[name="tm-syear-decl"]').val())  || 1);
                    const eDay   = Math.max(1, parseInt($html.find('[name="tm-eday-decl"]').val())   || 1);
                    const eMonth = parseInt($html.find('[name="tm-emonth-decl"]').val())             || 0;
                    const eYear  = Math.max(1, parseInt($html.find('[name="tm-eyear-decl"]').val())  || 1);
                    const days           = getDaysFromDates(sDay, sMonth, sYear, eDay, eMonth, eYear);
                    const dateRangeLabel = `${sDay} ${getMonthName(sMonth)} → ${eDay} ${getMonthName(eMonth)}`;
                    const sc             = CONFIG.DND5E.skills[skillId];
                    const skillLabel     = game.i18n.localize(sc?.label ?? skillId);
                    // Si outil : le libellé de l'activité est le nom de l'outil, pas la compétence.
                    const choiceLabel    = (hasTools && toolName) ? `🛠️ ${toolName}` : skillLabel;
                    const abilityId      = sc?.ability ?? "int";

                    cartItems.push({
                        type: "gain",
                        skillId, choiceLabel, abilityId,
                        hasMaitrise, hasExpertise, hasTools, toolName, doRoll,
                        bonusRoll, bonusSrc,
                        startDay: sDay, startMonth: sMonth, startYear: sYear,
                        endDay: eDay, endMonth: eMonth, endYear: eYear,
                        days, dateRangeLabel
                    });
                }

                await actor.setFlag(MOD, "tm", { declared: false, items: cartItems });
                refreshCart();
            });
        },
        buttons: [
            {
                action: "declare",
                label: tl("Déclarer le TM"),
                icon: '<i class="fa-solid fa-check"></i>',
                default: true,
                callback: async (event, button, dialog) => {
                    if (cartItems.length === 0) {
                        ui.notifications.warn(tl("Le TM est vide. Ajoutez au moins une activité."));
                        return false; // empêche la fermeture du dialogue
                    }
                    await actor.setFlag(MOD, "tm", {
                        declared: true,
                        items: cartItems.map(i => ({ ...i, declared: true }))
                    });
                    notifyTmDeclared();
                    ui.notifications.info(tl("TM déclaré : {0} activité{1}.", cartItems.length, cartItems.length !== 1 ? "s" : ""));
                }
            },
            {
                action: "cancel",
                label: tl("Annuler"),
                icon: '<i class="fa-solid fa-times"></i>'
            }
        ]
    });
}

// ============================================================
// Dialogue GM — construction des lignes (multi-items)
// ============================================================

function buildActorRow(actor, startUnchecked = false) {
    const flag  = actor.getFlag(MOD, "tm");
    const items = tmFlagItems(flag);
    const id    = actor.id;

    const isDeclared = flag?.declared ?? false;
    const count      = items.length;

    const statusBadge = isDeclared && count > 0
        ? `<span style="color:#2ecc71; font-size:0.85em; margin-left:6px;">${tl("✓ {0} activité{1} déclarée{2}", count, count > 1 ? "s" : "", count > 1 ? "s" : "")}</span>`
        : count > 0
            ? `<span style="color:#e67e22; font-size:0.85em; margin-left:6px;">${tl("(non déclaré)")}</span>`
            : `<span style="color:#888; font-size:0.85em; margin-left:6px;">${tl("(aucune déclaration)")}</span>`;

    const itemsHtml = items.map(item => {
        if (item.type === "craft") {
            const daysAlready = item.craftDaysAlready ?? 0;
            const totalDays   = item.craftTotalDays   ?? 0;
            const workDays    = item.days              ?? 0;
            const newTotal    = daysAlready + workDays;
            const complete    = newTotal >= totalDays;
            const remaining   = Math.max(0, totalDays - newTotal);
            const progressStr = complete
                ? `<span style="color:#2ecc71; font-weight:bold;">${tl("✅ Terminé après ce TM")}</span>`
                : `${tl("{0}/{1} j — <strong>{2} j restant{3}</strong>", newTotal, totalDays, remaining, remaining > 1 ? "s" : "")}`;
            return `<div style="font-size:0.9em; padding:4px 0 4px 4px; border-top:1px solid #eee;">
                <div>🔨 <strong>${item.craftName || "—"}</strong> <span style="color:#888;">— ${craftTypeLabel(item.craftType)}</span></div>
                <div style="color:#888;">${tl("Coût : <strong>{0} po</strong> · Durée : {1} j · {2} ({3} j ce TM)", item.craftCost ?? "?", totalDays, item.dateRangeLabel ?? "", workDays)}</div>
                <div>${progressStr}</div>
            </div>`;
        } else {
            const profStr = item.hasTools ? " [Tools]" : item.hasExpertise ? " [Expertise]" : item.hasMaitrise ? tl(" [Maîtrise]") : "";
            const rate    = item.skillId ? calcDailyRate(actor, item.skillId, item.hasMaitrise, item.hasExpertise, item.hasTools) : 0;
            const est     = rate * (item.days ?? 0);
            return `<div style="font-size:0.9em; padding:4px 0 4px 4px; border-top:1px solid #eee;">
                <div><strong>${item.choiceLabel ?? item.skillId}</strong>${profStr} — ${item.dateRangeLabel ?? ""} (${item.days ?? "?"} j)</div>
                <div style="color:#888;">${tl("≈ {0} po/j → ~{1} po{2}", rate, est, item.doRoll ? tl(" · test d20 demandé") : tl(" · pas de jet"))}</div>
            </div>`;
        }
    }).join("") || `<div style="color:#888; font-size:0.9em; font-style:italic; padding-top:4px;">${tl("Aucune activité déclarée.")}</div>`;

    return `
<div class="tm-actor-row" data-actor-id="${id}"
     style="border:1px solid #ccc; border-radius:4px; padding:8px; margin-bottom:8px;">
    <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
        <input type="checkbox" name="tm-active-${id}" ${startUnchecked ? "" : "checked"} style="margin:0;">
        <a class="tm-actor-name" data-actor-id="${id}"
           style="cursor:pointer; font-weight:bold; text-decoration:underline;">${actor.name}</a>${statusBadge}
        <div style="margin-left:auto; display:flex; gap:4px;">
            <button type="button" class="tm-edit-btn" data-actor-id="${id}"
                    style="padding:2px 8px; font-size:0.8em; color:#3498db; background:none; border:1px solid #3498db; border-radius:3px; cursor:pointer;">
                ${tl("Modifier")}
            </button>
            <button type="button" class="tm-refuse-btn" data-actor-id="${id}"
                    style="padding:2px 8px; font-size:0.8em; color:#e74c3c; background:none; border:1px solid #e74c3c; border-radius:3px; cursor:pointer;">
                ${tl("Refuser")}
            </button>
        </div>
    </div>
    <div class="tm-controls-${id}" style="opacity:${startUnchecked ? "0.4" : "1"};">
        ${itemsHtml}
    </div>
</div>`;
}

// ============================================================
// Dialogue GM — ouverture
// ============================================================

function _downtimeData() {
    const allActors  = getPlayerActors();
    return {
        allActors,
        declared:   allActors.filter(a =>  a.getFlag(MOD, "tm")?.declared),
        undeclared: allActors.filter(a => !a.getFlag(MOD, "tm")?.declared)
    };
}

export function downtimeHasActors() { return getPlayerActors().length > 0; }

// Contenu du panneau des temps morts (sans les boutons de dialogue). Réutilisé
// par la fenêtre GM ET par l'onglet Temps morts du Casier. expanded=true → la
// liste est déjà déroulée (cas Casier, pas de case « Afficher la liste »).
export function downtimeContentHtml(expanded = false) {
    const { allActors, declared, undeclared } = _downtimeData();
    if (allActors.length === 0) return `<p style="opacity:.75; font-style:italic; padding:8px;">${tl("Aucun personnage joueur trouvé.")}</p>`;
    const showAllByDefault = declared.length === 0;

    const headerHtml = `
<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px;">
    ${declared.length === 0
        ? `<span style="color:#e67e22;">${tl("<em>Aucune déclaration reçue.</em>")}</span>`
        : `<span>${tl("<strong>{0}</strong> déclaration{1} reçue{2}.", declared.length, declared.length > 1 ? "s" : "", declared.length > 1 ? "s" : "")}</span>`}
    ${expanded ? "" : `<label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
        <input type="checkbox" id="tm-show-list" style="margin:0;"> ${tl("Afficher la liste{0}", declared.length > 0 ? ` (${declared.length})` : "")}
    </label>`}
    ${!showAllByDefault && undeclared.length > 0
        ? `<label style="cursor:pointer; color:#888; display:flex; align-items:center; gap:5px;">
               <input type="checkbox" id="tm-show-undeclared" style="margin:0;">${tl("{0} sans déclaration", undeclared.length)}
           </label>`
        : ""}
</div>`;

    return `
<div>
    ${headerHtml}
    <div id="tm-actor-list" style="display:${expanded ? "block" : "none"};">
        <input id="tm-search" type="text" placeholder="Rechercher un personnage…"
               style="width:100%; box-sizing:border-box; margin-bottom:6px; padding:4px 8px; border:1px solid #ccc; border-radius:4px;">
        <div id="tm-actor-scroll" style="max-height:${expanded ? "none" : "55vh"}; overflow-y:${expanded ? "visible" : "auto"}; padding-right:4px;">
            ${(showAllByDefault ? allActors : declared).map(a => buildActorRow(a, true)).join("")}
            ${!showAllByDefault && undeclared.length > 0
                ? `<div class="tm-undeclared-group" style="display:none;">${undeclared.map(a => buildActorRow(a, true)).join("")}</div>`
                : ""}
        </div>
    </div>
</div>`;
}

// Câble les écouteurs du panneau des temps morts sur un conteneur donné.
export function wireDowntime(rootEl) {
    const { allActors } = _downtimeData();
    const $html = $(rootEl);

    $html.find("#tm-show-list").on("change", function () {
        $html.find("#tm-actor-list").css("display", this.checked ? "block" : "none");
        if (this.checked) $html.find("#tm-search").trigger("focus");
    });
    $html.find("#tm-search").on("input", function () {
        const q = this.value.trim().toLowerCase();
        $html.find(".tm-actor-row").each(function () {
            const name = $(this).find(".tm-actor-name").text().toLowerCase();
            $(this).toggle(!q || name.includes(q));
        });
    });
    $html.find("#tm-show-undeclared").on("change", function () {
        $html.find(".tm-undeclared-group").css("display", this.checked ? "block" : "none");
    });
    for (const actor of allActors) {
        const id = actor.id;
        $html.find(`[name="tm-active-${id}"]`).on("change", function () {
            $html.find(`.tm-controls-${id}`).css("opacity", this.checked ? "1" : "0.4");
        });
    }
    $html.find(".tm-actor-name").on("click", function () {
        const actor = game.actors.get(this.dataset.actorId);
        if (actor) actor.sheet.render(true);
    });
    $html.find(".tm-edit-btn").on("click", function () {
        const actor = game.actors.get(this.dataset.actorId);
        if (actor) openDeclarationDialog(actor);
    });
    $html.find(".tm-refuse-btn").on("click", async function () {
        const actorId = this.dataset.actorId;
        const actor   = game.actors.get(actorId);
        if (!actor) return;
        await actor.unsetFlag(MOD, "tm");
        const owners = getActorOwners(actor);
        if (owners.length > 0) {
            ChatMessage.create({
                content: tl("❌ Votre demande de temps mort a été refusée par le MJ."),
                whisper: owners.map(u => u.id),
                speaker: { alias: "WestMarch — Temps morts" }
            });
        }
        $html.find(`[data-actor-id="${actorId}"].tm-actor-row`).css("opacity", "0.4");
        $html.find(`[name="tm-active-${actorId}"]`).prop("checked", false);
        $html.find(`.tm-controls-${actorId}`).css("opacity", "0.4");
        this.textContent = tl("Refusé");
        this.disabled = true;
        this.style.color = "#888";
        this.style.borderColor = "#888";
        ui.notifications.info(tl("Demande TM refusée pour {0}.", actor.name));
    });
}

// Applique les gains à partir d'un conteneur (fenêtre ou onglet Casier).
export async function applyDowntimeFromRoot(rootEl) {
    const { allActors } = _downtimeData();
    await applyDowntimeGains($(rootEl), allActors);
}

// ============================================================
// Calcul et application des gains
// ============================================================

async function applyDowntimeGains($html, actors) {
    const lines        = [];
    const discordLines = [];

    for (const actor of actors) {
        const id = actor.id;
        if (!$html.find(`[name="tm-active-${id}"]`).prop("checked")) continue;

        const flag  = actor.getFlag(MOD, "tm");
        const items = tmFlagItems(flag);
        if (items.length === 0) continue;

        const owners     = getActorOwners(actor);
        const playerName = owners.find(u => !u.isGM)?.name ?? owners[0]?.name ?? "?";
        const gmName     = game.user.name;

        const remainingItems = []; // crafts incomplets qui persistent

        for (const item of items) {

            // ================================================================
            // Branche craft
            // ================================================================
            if (item.type === "craft") {
                const daysAlready   = item.craftDaysAlready ?? 0;
                const workDays      = item.days             ?? 0;
                const totalDays     = item.craftTotalDays   ?? 0;
                const craftName     = item.craftName        ?? "?";
                const dateLabel     = item.dateRangeLabel   ?? "";
                const craftCost     = item.craftCost        ?? 0;
                const infoStr       = craftInfoStr(item);
                const newTotal      = daysAlready + workDays;
                const complete      = newTotal >= totalDays;
                const remaining     = Math.max(0, totalDays - newTotal);
                const isFirstPeriod = daysAlready === 0;

                // Déduire le coût au premier TM — convertit PP/PA/PC si PO insuffisants
                if (isFirstPeriod && craftCost > 0) {
                    await deductGoldCost(actor, craftCost);
                }

                // Message privé joueur
                if (owners.length > 0) {
                    let msgContent;
                    if (complete) {
                        msgContent = `${tl("🔨 Craft terminé pour <strong>{0}</strong> : <strong>{1}</strong>", actor.name, craftName)} <span style="color:#888;">(${infoStr})</span> ${tl("— {0} ({1} j) → ✅ Objet créé !", dateLabel, workDays)}`;
                    } else if (isFirstPeriod) {
                        msgContent = `${tl("🔨 Craft démarré pour <strong>{0}</strong> : <strong>{1}</strong>", actor.name, craftName)} <span style="color:#888;">(${infoStr})</span> ${tl("— {0} ({1} j) → {2}/{3} j — <strong>{4} j restant{5}</strong>", dateLabel, workDays, newTotal, totalDays, remaining, remaining > 1 ? "s" : "")}`
                            + `<br><span style="color:#e67e22;">${tl("⚠️ Le coût de <strong>{0} po</strong> a été retiré de votre bourse.", craftCost)}</span>`;
                    } else {
                        msgContent = `${tl("🔨 Craft en cours pour <strong>{0}</strong> : <strong>{1}</strong>", actor.name, craftName)} <span style="color:#888;">(${infoStr})</span> ${tl("— {0} ({1} j) → {2}/{3} j — <strong>{4} j restant{5}</strong>", dateLabel, workDays, newTotal, totalDays, remaining, remaining > 1 ? "s" : "")}`;
                    }
                    ChatMessage.create({
                        content: msgContent,
                        whisper: owners.map(u => u.id),
                        speaker: { alias: "WestMarch — Temps morts" }
                    });
                }

                // Craft terminé : ajout automatique de l'objet depuis le
                // compendium configuré (objet choisi via uuid, sinon par nom).
                if (complete) {
                    const granted = await grantCraftedItem(actor, craftName, item.craftUuid);
                    ChatMessage.create({
                        content: granted
                            ? `${tl("✅ <strong>{0}</strong> a terminé son craft : <strong>{1}</strong> ({2}). L'objet <em>{3}</em> a été <strong>ajouté à sa fiche</strong>. Coût de {4} po déjà retiré.", actor.name, craftName, infoStr, granted, craftCost)}`
                            : `${tl("✅ <strong>{0}</strong> a terminé son craft : <strong>{1}</strong> ({2}). Coût de {3} po déjà retiré.", actor.name, craftName, infoStr, craftCost)}`,
                        whisper: ChatMessage.getWhisperRecipients("GM"),
                        speaker: { alias: "WestMarch — Temps morts" }
                    });
                }

                if (!complete) {
                    remainingItems.push({ ...item, craftDaysAlready: newTotal, declared: false });
                }

                const line = complete
                    ? `${tl("<strong>{0}</strong> — 🔨 <strong>{1}</strong> ({2}) — {3} ({4} j) → ✅ <strong>Terminé !</strong>", actor.name, craftName, infoStr, dateLabel, workDays)}`
                    : `${tl("<strong>{0}</strong> — 🔨 <strong>{1}</strong> ({2}) — {3} ({4} j) → {5}/{6} j ({7} restants)", actor.name, craftName, infoStr, dateLabel, workDays, newTotal, totalDays, remaining)}`;
                const discordLine = complete
                    ? tl("**{0}** ({1}) — 🔨 **{2}** ({3}) — {4} ({5} j) → Terminé ! (par {6})", actor.name, playerName, craftName, infoStr, dateLabel, workDays, gmName)
                    : tl("**{0}** ({1}) — 🔨 **{2}** ({3}) — {4} ({5} j) → {6}/{7} j, {8} j restant{9} (par {10})", actor.name, playerName, craftName, infoStr, dateLabel, workDays, newTotal, totalDays, remaining, remaining > 1 ? "s" : "", gmName);
                lines.push(line);
                discordLines.push(discordLine);

            // ================================================================
            // Branche gain
            // ================================================================
            } else {
                const skillId      = item.skillId;
                const hasMaitrise  = item.hasMaitrise  ?? false;
                const hasExpertise = item.hasExpertise ?? false;
                const hasTools     = item.hasTools     ?? false;
                const doRoll       = item.doRoll       ?? false;
                const sDay   = item.startDay   ?? 1;
                const sMonth = item.startMonth ?? 0;
                const sYear  = item.startYear  ?? 1;
                const eDay   = item.endDay     ?? 1;
                const eMonth = item.endMonth   ?? 0;
                const eYear  = item.endYear    ?? 1;
                const days   = item.days ?? getDaysFromDates(sDay, sMonth, sYear, eDay, eMonth, eYear);

                const toolName     = (item.toolName ?? "").trim();
                // Si outil : on affiche le NOM de l'outil à la place de la compétence.
                const activityName = (hasTools && toolName)
                    ? toolName
                    : game.i18n.localize(CONFIG.DND5E.skills[skillId]?.label ?? skillId);
                const profStr      = (hasTools && toolName) ? " (outil)"
                                   : hasTools     ? " [Tools]"
                                   : hasExpertise ? " [Expertise]"
                                   : hasMaitrise  ? tl(" [Maîtrise]") : "";
                const dailyRate    = calcDailyRate(actor, skillId, hasMaitrise, hasExpertise, hasTools);
                const dateLabel    = item.dateRangeLabel ?? `${sDay} ${getMonthName(sMonth)} → ${eDay} ${getMonthName(eMonth)}`;
                let total = dailyRate * days, rollResult = null;

                if (doRoll && days >= tmNum("tmRollMinDays", 5)) {
                    const abilityId  = CONFIG.DND5E.skills[skillId]?.ability ?? "int";
                    const abilityMod = actor.system.abilities[abilityId]?.mod ?? 0;
                    const prof       = actor.system.attributes?.prof ?? 2;
                    const checkMod   = abilityMod + (hasExpertise ? prof * 2 : (hasMaitrise || hasTools) ? prof : 0);
                    const roll = await new Roll("1d20 + @mod", { mod: checkMod }).evaluate();
                    const d20Raw = roll.dice[0]?.results[0]?.result ?? (roll.total - checkMod);

                    // Reliable Talent (Roublard niv. 11) : si maîtrisé dans la compétence,
                    // le d20 ne peut pas être inférieur à 10.
                    const isProficient = hasMaitrise || hasExpertise || hasTools;
                    const hasReliableTalent = game.settings.get(MOD, "tmReliableTalent")
                        && isProficient && actor.items.some(i => {
                            const n = i.name.toLowerCase();
                            return n.includes("reliable talent") || n.includes("talent fiable");
                        });
                    const effectiveD20 = (hasReliableTalent && d20Raw < 10) ? 10 : d20Raw;
                    rollResult = effectiveD20 + checkMod;

                    // Bonus au jet optionnel (valeur fixe ou expression de dés).
                    const bonusRoll = (item.bonusRoll ?? "").toString().trim();
                    const bonusSrc  = (item.bonusSrc  ?? "").toString().trim();
                    if (bonusRoll) {
                        try {
                            const bR = await new Roll(bonusRoll).evaluate();
                            rollResult += bR.total ?? 0;
                            await bR.toMessage({
                                speaker: { alias: `Temps mort — ${actor.name}` },
                                flavor: tl("Bonus au test{0}", bonusSrc ? ` (${bonusSrc})` : "")
                            });
                        } catch (e) {
                            const flat = parseInt(bonusRoll);
                            if (!isNaN(flat)) rollResult += flat;
                        }
                    }

                    const mult = getRollMultiplier(rollResult);
                    total = total * mult;
                    const abilityAbbr = game.i18n.localize(
                        CONFIG.DND5E.abilities[abilityId]?.abbreviation ?? abilityId
                    ).toUpperCase();
                    await roll.toMessage({
                        speaker: { alias: `Temps mort — ${actor.name}` },
                        flavor: tl("Test de compétence : {0} ({1}) — {2} j", activityName, abilityAbbr, days)
                    });
                }

                const totalGP = Math.floor(total);
                const totalSP = Math.round((total - totalGP) * 10);
                const gainStr = totalSP > 0 ? `+${totalGP} po ${totalSP} pa` : `+${totalGP} po`;

                const currencyUpdate = {};
                if (totalGP > 0) currencyUpdate["system.currency.gp"] = (actor.system.currency?.gp ?? 0) + totalGP;
                if (totalSP > 0) currencyUpdate["system.currency.sp"] = (actor.system.currency?.sp ?? 0) + totalSP;
                if (Object.keys(currencyUpdate).length > 0) await actor.update(currencyUpdate);

                if (owners.length > 0) {
                    const pctStr = rollResult === null ? ""
                        : ` (test : ${rollResult} → ${multPctLabel(getRollMultiplier(rollResult))})`;
                    ChatMessage.create({
                        content: `<span style="color:#000;">${tl("🕰️ Temps mort appliqué pour <strong>{0}</strong> :", actor.name)} `
                               + `${tl("{0}{1}, {2} — {3} j ({4} po/j){5} → <strong>{6}</strong>", activityName, profStr, dateLabel, days, dailyRate, pctStr, gainStr)}</span>`,
                        whisper: owners.map(u => u.id),
                        speaker: { alias: "WestMarch — Temps morts" }
                    });
                }

                let line        = `${tl("<strong>{0}</strong> — {1}{2} — {3} ({4} j, {5} po/j)", actor.name, activityName, profStr, dateLabel, days, dailyRate)}`;
                let discordLine = `**${actor.name}** (${playerName}) — ${activityName}${profStr} — ${dateLabel} (${days} j, ${dailyRate} po/j)`;
                if (rollResult !== null) {
                    const pct = multPctLabel(getRollMultiplier(rollResult));
                    line        += ` → test : ${rollResult} (${pct})`;
                    discordLine += ` → test : ${rollResult} (${pct})`;
                }
                line        += ` = <strong>${gainStr}</strong>`;
                discordLine += tl(" = **{0}** (par {1})", gainStr, gmName);
                lines.push(line);
                discordLines.push(discordLine);
            }
        }

        // Mettre à jour ou effacer le flag
        if (remainingItems.length > 0) {
            await actor.setFlag(MOD, "tm", { declared: false, items: remainingItems });
        } else {
            await actor.unsetFlag(MOD, "tm");
        }
    }

    if (lines.length === 0) { ui.notifications.info(tl("Aucun personnage traité.")); return; }

    ChatMessage.create({
        content: `<div style="color:#000;"><p style="margin:0 0 4px; font-weight:bold;">${tl("Résumé des temps morts")}</p><ul style="margin:0; padding-left:16px;">${lines.map(l => `<li>${l}</li>`).join("")}</ul></div>`,
        whisper: ChatMessage.getWhisperRecipients("GM"),
        speaker: { alias: "WestMarch — Temps morts" }
    });

    const webhookUrl = game.settings.get(MOD, "tmWebhookUrl");
    if (webhookUrl) {
        fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: tl("🕰️ **Résumé des temps morts**\n{0}", discordLines.map(l => `• ${l}`).join("\n"))
            })
        }).catch(err => journal.erreur("westmarch | Webhook TM Discord :", err));
    }

    ui.notifications.info(tl("Temps morts appliqués : {0} activité{1}.", lines.length, lines.length > 1 ? "s" : ""));
}

// ============================================================
// Notification Discord immédiate — envoyée dès qu'un joueur déclare son TM
// ============================================================

function notifyTmDeclared() {
    const webhookUrl = game.settings.get(MOD, "tmWebhookUrl");
    if (!webhookUrl) return;

    const pending = game.actors.filter(a =>
        a.type === "character" &&
        a.hasPlayerOwner &&
        a.getFlag(MOD, "tm")?.declared
    );
    if (pending.length === 0) return;

    fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            content: `${tl("⏳ **{0} temps mort{1} en attente** de validation GM.", pending.length, pending.length > 1 ? "s" : "")}
`
                   + pending.map(a => `• ${a.name}`).join("\n")
        })
    }).catch(err => journal.erreur(tl("westmarch | Webhook TM déclaration :"), err));
}
