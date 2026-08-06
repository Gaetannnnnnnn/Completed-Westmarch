// ============================================================
// carnet.js — Logique principale du module carnet
//
// Deux onglets indépendants :
//   - Carnet (journal)     → flag "carnetNotes"    : [{id, title, content, linkedExpId?}]
//   - Expéditions          → flag "expeditions"    : [{id, name, startDate, endDate}]
//
// Lien optionnel : une note peut avoir linkedExpId → navigation vers l'onglet
// Expéditions + scroll sur l'expédition, et réciproquement.
//
// © 2026 Soruta — Tous droits réservés. Usage personnel autorisé.
// ============================================================

import { MOD } from "./const.js";
const MODULE = MOD;

// ================================================================
// EXPÉDITIONS — CRUD
// ================================================================

export function getExpeditions(actor) {
    return actor.getFlag(MODULE, "expeditions") ?? [];
}

export async function addExpedition(actor, startDate = null, name = "Nouvelle expédition") {
    const exps   = getExpeditions(actor);
    const newExp = {
        id:        foundry.utils.randomID(),
        name:      name || "Nouvelle expédition",
        startDate: startDate ?? null,
        endDate:   null,
        // GM qui a lancé l'expédition (pour le Casier). game.user est le GM
        // qui déclenche le bouton "Date Expédition".
        gmId:      game.user?.id ?? null
    };
    await actor.setFlag(MODULE, "expeditions", [...exps, newExp]);
    return newExp;
}

export async function closeExpedition(actor, expId, endDate) {
    const updated = getExpeditions(actor).map(e =>
        e.id === expId ? { ...e, endDate } : e
    );
    await actor.setFlag(MODULE, "expeditions", updated);
}

// ================================================================
// CARNET NOTES — CRUD
// ================================================================

export function getCarnetNotes(actor) {
    return actor.getFlag(MODULE, "carnetNotes") ?? [];
}

export async function addCarnetSection(actor) {
    const notes = getCarnetNotes(actor);
    const newSection = {
        id:    foundry.utils.randomID(),
        type:  "section",
        title: "Nouvelle section"
    };
    await actor.setFlag(MODULE, "carnetNotes", [...notes, newSection]);
    return newSection;
}

export async function addCarnetNote(actor, { title = "Nouvelle note", linkedExpId = null, prepend = true } = {}) {
    const notes   = getCarnetNotes(actor);
    const newNote = {
        id:          foundry.utils.randomID(),
        title,
        content:     "",
        linkedExpId: linkedExpId ?? null
    };
    const updated = prepend ? [newNote, ...notes] : [...notes, newNote];
    await actor.setFlag(MODULE, "carnetNotes", updated);
    return newNote;
}

// ================================================================
// DATES — game.time.calendar (Foundry v13 natif)
// ================================================================

export function getCurrentDate() {
    try {
        const cal = game.time?.calendar;
        if (cal) {
            const c = cal.timeToComponents(game.time.worldTime);
            return { day: c.dayOfMonth + 1, month: c.month, year: c.year };
        }
    } catch {}
    try {
        const sc = SimpleCalendar?.api?.currentDateTime?.();
        if (sc) return { day: sc.day, month: sc.month, year: sc.year };
    } catch {}
    return null;
}

function _getMonthName(month) {
    try {
        const cal = game.time?.calendar;
        if (cal?.months?.values) {
            const name = Array.from(cal.months.values)[month]?.name;
            if (name) return game.i18n.localize(name);
        }
    } catch {}
    return `Mois ${month + 1}`;
}

function _monthOptionsHtml(selectedMonth = 0) {
    try {
        const cal = game.time?.calendar;
        if (cal?.months?.values) {
            return Array.from(cal.months.values).map((m, i) => {
                const name = m?.name ? game.i18n.localize(m.name) : `Mois ${i + 1}`;
                return `<option value="${i}"${i === selectedMonth ? " selected" : ""}>${name}</option>`;
            }).join("");
        }
    } catch {}
    return Array.from({ length: 12 }, (_, i) =>
        `<option value="${i}"${i === selectedMonth ? " selected" : ""}>Mois ${i + 1}</option>`
    ).join("");
}

export function formatDate(dateObj) {
    if (!dateObj) return "—";
    try {
        if (typeof SimpleCalendar !== "undefined" && SimpleCalendar?.api?.formatDateTime)
            return SimpleCalendar.api.formatDateTime(dateObj);
    } catch {}
    return `${dateObj.day} ${_getMonthName(dateObj.month)} ${dateObj.year}`;
}

function _toTotalDays(date) {
    try {
        const cal = game.time?.calendar;
        if (cal?.months?.values) {
            const months      = Array.from(cal.months.values);
            const daysPerYear = months.reduce((s, m) => s + (m?.days ?? 30), 0) || 360;
            let total = (date.year ?? 1) * daysPerYear;
            for (let i = 0; i < (date.month ?? 0); i++) total += months[i]?.days ?? 30;
            return total + ((date.day ?? 1) - 1);
        }
    } catch {}
    return (date.year ?? 1) * 365 + (date.month ?? 0) * 30 + ((date.day ?? 1) - 1);
}

function dateDiff(start, end) {
    if (!start || !end) return null;
    try {
        const days = Math.abs(_toTotalDays(end) - _toTotalDays(start));
        if (isNaN(days)) return null;
        return `${days} jour${days !== 1 ? "s" : ""}`;
    } catch { return null; }
}

// ================================================================
// PARTY — lecture via flags westmarch
// ================================================================

/**
 * Retourne les acteurs PJ des joueurs appartenant à la party active du GM.
 * La party est identifiée par user.getFlag(MOD, "partyId") === GM.id.
 * Les GMs eux-mêmes sont exclus (ils n'ont généralement pas de PJ dans la party).
 */
function getPartyMembers() {
    try {
        const partyId = game.user.getFlag(MOD, "partyId");
        if (!partyId) return [];
        return game.users
            .filter(u => !u.isGM
                && u.getFlag(MOD, "partyId") === partyId
                && u.character)
            .map(u => u.character)
            .filter(Boolean);
    } catch { return []; }
}

// ================================================================
// BOUTON BARRE DE GAUCHE — crée ou clôture une expédition
// ================================================================

export function CarnetToolbarHooks() {
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM) return;
        if (!controls.westmarch) {
            controls.westmarch = {
                name: "westmarch", title: "WestMarch",
                icon: "fa-solid fa-hammer", layer: "tokens", tools: {}
            };
        }
        controls.westmarch.tools.carnetDate = {
            name:     "carnetDate",
            title:    "Date Expédition — Ouvrir / Clôturer",
            icon:     "fa-solid fa-calendar-plus",
            button:   true,
            onChange: () => onClickDateTM(),
            visible:  true
        };
    });
}

async function onClickDateTM() {
    const members = getPartyMembers();
    if (!members.length) {
        ui.notifications.warn(
            "[Carnet] Aucun PJ dans la party active. " +
            "Le GM doit d'abord créer une party (clic droit sur son nom dans la liste des joueurs)."
        );
        return;
    }

    // Y a-t-il au moins une expédition ouverte (début sans fin) parmi les membres ?
    const hasOpen = members.some(actor =>
        getExpeditions(actor).some(e => e.startDate && !e.endDate)
    );

    if (hasOpen) {
        await _closeExpDialog(members);
    } else {
        await _createExpDialog(members);
    }
}

// ── Helpers communs aux deux dialogs ──────────────────────────

function _dateDialogContent(currentDate, extraHtml = "") {
    const preDay  = currentDate?.day   ?? 1;
    const preMo   = currentDate?.month ?? 0;
    const preYear = currentDate?.year  ?? 1;

    const noCalWarning = !currentDate
        ? `<p style="margin:0 0 8px;font-size:11px;color:#e67e22;">
               <i class="fas fa-exclamation-triangle"></i>
               Calendrier non disponible — seule la date personnalisée est utilisable.
           </p>`
        : "";

    return { preDay, preMo, preYear, html: `
<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
    ${noCalWarning}
    ${extraHtml}
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 10px;
                   border-radius:5px;border:1px solid rgba(255,255,255,0.08);
                   background:rgba(255,255,255,0.03);">
        <input type="radio" name="carnet-tm-mode" id="carnet-tm-radio-current" value="current"
               ${currentDate ? "checked" : "disabled"} style="margin:0;flex-shrink:0;">
        <span>
            <span style="font-weight:600;">Date actuelle</span><br>
            <span style="font-size:11px;color:#aaa;">
                ${currentDate
                    ? `${preDay} ${_getMonthName(preMo)} ${preYear}`
                    : '<em>Calendrier non disponible</em>'}
            </span>
        </span>
    </label>
    <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px 10px;
                   border-radius:5px;border:1px solid rgba(255,255,255,0.08);
                   background:rgba(255,255,255,0.03);">
        <input type="radio" name="carnet-tm-mode" id="carnet-tm-radio-custom" value="custom"
               ${!currentDate ? "checked" : ""} style="margin:3px 0 0;flex-shrink:0;">
        <span style="flex:1;">
            <span style="font-weight:600;">Date personnalisée</span><br>
            <div style="display:flex;gap:6px;align-items:center;margin-top:6px;">
                <input type="number" id="carnet-tm-day"   min="1" max="31" value="${preDay}"  style="width:54px;">
                <select id="carnet-tm-month" style="flex:1;">${_monthOptionsHtml(preMo)}</select>
                <input type="number" id="carnet-tm-year"  value="${preYear}" style="width:72px;">
            </div>
        </span>
    </label>
</div>` };
}

function _wireCustomRadio() {
    ["carnet-tm-day", "carnet-tm-month", "carnet-tm-year"].forEach(id => {
        document.getElementById(id)?.addEventListener("focus", () => {
            const r = document.getElementById("carnet-tm-radio-custom");
            if (r) r.checked = true;
        });
    });
}

function _readDateFromDom(currentDate) {
    const mode = document.querySelector('[name="carnet-tm-mode"]:checked')?.value;
    if (mode === "current") return currentDate;
    return {
        day:   parseInt(document.getElementById("carnet-tm-day")?.value)   || 1,
        month: parseInt(document.getElementById("carnet-tm-month")?.value) || 0,
        year:  parseInt(document.getElementById("carnet-tm-year")?.value)  || 1
    };
}

function _readDateFromJQuery(html, currentDate) {
    const mode = html.find('[name="carnet-tm-mode"]:checked').val()
        ?? document.querySelector('[name="carnet-tm-mode"]:checked')?.value;
    if (mode === "current") return currentDate;
    return {
        day:   parseInt(html.find('#carnet-tm-day').val())   || 1,
        month: parseInt(html.find('#carnet-tm-month').val()) || 0,
        year:  parseInt(html.find('#carnet-tm-year').val())  || 1
    };
}

// ── Dialog générique : choisir une date ───────────────────────

async function _pickDateDialog(title) {
    const currentDate = getCurrentDate();
    const { html: content } = _dateDialogContent(currentDate);
    let resolvedDate = null;

    const DialogClass = foundry.applications.api?.DialogV2 ?? globalThis.DialogV2;

    if (DialogClass?.wait) {
        const action = await DialogClass.wait({
            window:      { title },
            position:    { width: 320 },
            content,
            rejectClose: false,
            render:      () => _wireCustomRadio(),
            buttons: [
                {
                    action:   "confirm",
                    label:    "Valider",
                    icon:     '<i class="fas fa-check"></i>',
                    default:  true,
                    callback: () => { resolvedDate = _readDateFromDom(currentDate); }
                },
                { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>' }
            ]
        });
        if (action !== "confirm") return null;
    } else {
        resolvedDate = await new Promise(resolve => {
            new Dialog({
                title,
                content,
                buttons: {
                    confirm: {
                        icon:  '<i class="fas fa-check"></i>',
                        label: "Valider",
                        callback: (html) => {
                            try   { resolve(_readDateFromJQuery(html, currentDate)); }
                            catch { resolve(null); }
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: "Annuler", callback: () => resolve(null) }
                },
                default: "confirm"
            }, { width: 320 }).render(true);
        });
    }
    return resolvedDate;
}

// ── Dialog : créer une nouvelle expédition ─────────────────────

async function _createExpDialog(members) {
    const currentDate = getCurrentDate();
    const { html: content } = _dateDialogContent(currentDate,
        `<p style="margin:0 0 6px;font-size:11px;color:#aaa;padding:0 2px;">
             <i class="fas fa-info-circle"></i>
             Crée une nouvelle expédition pour ${members.length} PJ de la party.
         </p>
         <div style="margin-bottom:2px;">
             <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">
                 Nom de l'expédition
             </label>
             <input id="carnet-exp-name" type="text" placeholder="Nouvelle expédition"
                    style="width:100%;box-sizing:border-box;"
                    value="">
         </div>`
    );

    let resolvedDate = null;
    let resolvedName = "Nouvelle expédition";
    const DialogClass = foundry.applications.api?.DialogV2 ?? globalThis.DialogV2;

    if (DialogClass?.wait) {
        const action = await DialogClass.wait({
            window:      { title: "Nouvelle expédition — Date de début" },
            position:    { width: 340 },
            content,
            rejectClose: false,
            render:      () => _wireCustomRadio(),
            buttons: [
                {
                    action:   "confirm",
                    label:    "Créer l'expédition",
                    icon:     '<i class="fas fa-calendar-plus"></i>',
                    default:  true,
                    callback: () => {
                        resolvedDate = _readDateFromDom(currentDate);
                        resolvedName = document.getElementById("carnet-exp-name")?.value?.trim()
                            || "Nouvelle expédition";
                    }
                },
                { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>' }
            ]
        });
        if (action !== "confirm" || !resolvedDate) return;
    } else {
        ({ date: resolvedDate, name: resolvedName } = await new Promise(resolve => {
            new Dialog({
                title:   "Nouvelle expédition — Date de début",
                content,
                buttons: {
                    confirm: {
                        icon:  '<i class="fas fa-calendar-plus"></i>',
                        label: "Créer l'expédition",
                        callback: (html) => {
                            try {
                                resolve({
                                    date: _readDateFromJQuery(html, currentDate),
                                    name: html.find("#carnet-exp-name").val()?.trim() || "Nouvelle expédition"
                                });
                            } catch { resolve({ date: null, name: "Nouvelle expédition" }); }
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: "Annuler", callback: () => resolve({ date: null, name: "" }) }
                },
                default: "confirm"
            }, { width: 340 }).render(true);
        }));
        if (!resolvedDate) return;
    }

    for (const actor of members) {
        await addExpedition(actor, resolvedDate, resolvedName);
    }
    ui.notifications.info(`[Carnet] Expédition "${resolvedName}" créée pour ${members.length} PJ.`);
}

// ── Dialog : clôturer les expéditions ouvertes ─────────────────

async function _closeExpDialog(members) {
    const currentDate = getCurrentDate();

    // Résumé des expéditions ouvertes
    const openListHtml = members
        .map(actor => {
            const open = getExpeditions(actor).find(e => e.startDate && !e.endDate);
            return open
                ? `<li>${actor.name} — <em>${open.name || "Expédition sans nom"}</em>`
                  + ` (début : ${formatDate(open.startDate)})</li>`
                : null;
        })
        .filter(Boolean)
        .join("");

    const extraHtml = `
        <div style="padding:8px 10px;border-radius:5px;
                    border:1px solid rgba(231,76,60,0.3);background:rgba(231,76,60,0.06);">
            <p style="margin:0 0 6px;font-size:11px;color:#aaa;font-weight:600;">
                <i class="fas fa-clock"></i> Expéditions en cours :
            </p>
            <ul style="margin:0;padding-left:18px;font-size:12px;">${openListHtml}</ul>
        </div>
        <p style="margin:0;font-size:11px;color:#aaa;padding:0 2px;">
            <i class="fas fa-flag-checkered"></i>
            Clôture les expéditions en cours pour chaque PJ de la party.
        </p>`;

    const { html: content } = _dateDialogContent(currentDate, extraHtml);

    let resolvedDate = null;
    const DialogClass = foundry.applications.api?.DialogV2 ?? globalThis.DialogV2;

    if (DialogClass?.wait) {
        const action = await DialogClass.wait({
            window:      { title: "Clôturer l'expédition en cours" },
            position:    { width: 360 },
            content,
            rejectClose: false,
            render:      () => _wireCustomRadio(),
            buttons: [
                {
                    action:   "confirm",
                    label:    "Clôturer",
                    icon:     '<i class="fas fa-flag-checkered"></i>',
                    default:  true,
                    callback: () => { resolvedDate = _readDateFromDom(currentDate); }
                },
                { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>' }
            ]
        });
        if (action !== "confirm" || !resolvedDate) return;
    } else {
        resolvedDate = await new Promise(resolve => {
            new Dialog({
                title:   "Clôturer l'expédition en cours",
                content,
                buttons: {
                    confirm: {
                        icon:  '<i class="fas fa-flag-checkered"></i>',
                        label: "Clôturer",
                        callback: (html) => {
                            try   { resolve(_readDateFromJQuery(html, currentDate)); }
                            catch { resolve(null); }
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: "Annuler", callback: () => resolve(null) }
                },
                default: "confirm"
            }, { width: 360 }).render(true);
        });
        if (!resolvedDate) return;
    }

    // Clôturer toutes les expéditions ouvertes de chaque membre
    let closedCount = 0;
    for (const actor of members) {
        const exps = getExpeditions(actor);
        if (!exps.some(e => e.startDate && !e.endDate)) continue;
        const updated = exps.map(e =>
            (e.startDate && !e.endDate) ? { ...e, endDate: resolvedDate } : e
        );
        await actor.setFlag(MODULE, "expeditions", updated);
        closedCount++;
    }
    ui.notifications.info(`[Carnet] Expédition clôturée pour ${closedCount} PJ.`);
}

// ================================================================
// BUILDER HTML — Onglet Carnet (notes indépendantes)
// ================================================================

// État de repliage persisté par acteur via localStorage
// Structure : Map<actorId, { notes: Set<id>, sections: Set<id> }>
const _collapseByActor = new Map();
let   _draggedItemId   = null;

/**
 * Retourne (et crée si besoin) l'état de repliage d'un acteur.
 * Charge depuis localStorage au premier accès pour cet acteur.
 */
function _getCollapse(actorId) {
    if (!_collapseByActor.has(actorId)) {
        let notes = new Set(), sections = new Set();
        try {
            const raw = localStorage.getItem(`carnet-collapse-${actorId}`);
            if (raw) {
                const p  = JSON.parse(raw);
                notes    = new Set(p.notes    ?? []);
                sections = new Set(p.sections ?? []);
            }
        } catch {}
        _collapseByActor.set(actorId, { notes, sections });
    }
    return _collapseByActor.get(actorId);
}

/** Sauvegarde l'état de repliage d'un acteur dans localStorage. */
function _saveCollapse(actorId) {
    try {
        const state = _collapseByActor.get(actorId);
        if (!state) return;
        localStorage.setItem(`carnet-collapse-${actorId}`, JSON.stringify({
            notes:    [...state.notes],
            sections: [...state.sections]
        }));
    } catch {}
}

export function buildJournalHtml(actor) {
    const items   = getCarnetNotes(actor); // peut contenir notes ET sections
    const canEdit = actor.isOwner;
    const exps    = getExpeditions(actor);

    const addBar = canEdit ? `
        <div class="carnet-add-bar">
            <button type="button" class="carnet-add-section" title="Ajouter une section">
                <i class="fas fa-folder-plus"></i> Section
            </button>
            <button type="button" class="carnet-add-note">
                <i class="fas fa-plus"></i> Note
            </button>
        </div>` : "";

    if (!items.length) {
        return `
        <div class="carnet-body">
            ${addBar}
            <div class="carnet-empty-state">
                <i class="fas fa-book-open"></i>
                <p>Aucune note dans le carnet.<br>
                   Utilisez les boutons ci-dessus pour rédiger votre première note.</p>
            </div>
        </div>`;
    }

    const collapse = _getCollapse(actor.id);

    // Calcule si une note est sous une section repliée
    let currentSectionCollapsed = false;
    const rendered = items.map(item => {
        // ── SECTION ─────────────────────────────────────────────
        if (item.type === "section") {
            currentSectionCollapsed = collapse.sections.has(item.id);
            const chevron = currentSectionCollapsed ? "fa-chevron-right" : "fa-chevron-down";
            const titleEsc = (item.title ?? "").replace(/"/g, "&quot;");
            return `
        <div class="carnet-section-header carnet-item" data-carnet-id="${item.id}" data-carnet-type="section">
            ${canEdit ? `<div class="carnet-drag-handle" draggable="true" title="Déplacer"><i class="fas fa-grip-vertical"></i></div>` : ""}
            <button type="button" class="carnet-toggle-section" data-section-id="${item.id}"
                    title="${currentSectionCollapsed ? "Déplier" : "Replier"}">
                <i class="fas ${chevron}"></i>
            </button>
            ${canEdit
                ? `<input class="carnet-section-title-input" type="text"
                          data-section-id="${item.id}"
                          value="${titleEsc}"
                          placeholder="Nom de la section">`
                : `<span class="carnet-section-title-label">${item.title || "Section"}</span>`}
            ${canEdit ? `
            <a class="carnet-del-section" data-section-id="${item.id}" title="Supprimer la section">
                <i class="fas fa-trash"></i>
            </a>` : ""}
        </div>`;
        }

        // ── NOTE ─────────────────────────────────────────────────
        const note        = item;
        const isCollapsed = collapse.notes.has(note.id);
        const hidden      = currentSectionCollapsed;
        const linkedExp   = note.linkedExpId ? exps.find(e => e.id === note.linkedExpId) : null;

        const linkBadge = linkedExp
            ? `<a class="carnet-go-exp" data-exp-id="${linkedExp.id}"
                  title="Voir l'expédition liée">
                   <i class="fas fa-calendar-alt"></i> ${linkedExp.name || "Expédition"}
               </a>
               ${canEdit ? `<a class="carnet-unlink-note" data-note-id="${note.id}"
                  title="Délier de l'expédition"
                  style="font-size:11px;color:#666;cursor:pointer;margin-left:4px;">
                   <i class="fas fa-unlink"></i>
               </a>` : ""}`
            : (canEdit
                ? `<a class="carnet-link-exp" data-note-id="${note.id}"
                      title="Lier cette note à une expédition">
                       <i class="fas fa-link"></i> Lier
                   </a>`
                : "");

        const noteHtml = note.content
            ? `<div class="carnet-note-content">${note.content}</div>`
            : `<p class="carnet-note-placeholder"><em>Note vide. Cliquez sur Modifier pour rédiger.</em></p>`;

        return `
        <div class="carnet-note-card carnet-item" data-carnet-id="${note.id}" data-carnet-type="note"
             data-note-id="${note.id}"${hidden ? ' style="display:none;"' : ''}>
            ${canEdit ? `<div class="carnet-drag-handle" draggable="true" title="Déplacer"><i class="fas fa-grip-vertical"></i></div>` : ""}
            <div class="carnet-note-inner">
                <div class="carnet-note-header">
                    <button type="button" class="carnet-toggle-note" data-note-id="${note.id}"
                            title="${isCollapsed ? "Déplier" : "Replier"}"
                            style="background:none;border:none;color:#8a7a65;cursor:pointer;
                                   padding:2px 6px 2px 0;font-size:11px;flex-shrink:0;">
                        <i class="fas fa-chevron-${isCollapsed ? "right" : "down"}"></i>
                    </button>
                    <div class="carnet-note-title-row" style="flex:1;min-width:0;">
                        ${canEdit
                            ? `<input class="carnet-note-title-input" type="text"
                                      data-note-id="${note.id}"
                                      value="${(note.title ?? "").replace(/"/g, "&quot;")}"
                                      placeholder="Titre de la note">`
                            : `<span class="carnet-note-title-label">${note.title || "Note sans titre"}</span>`}
                        <div class="carnet-note-actions-row">
                            ${linkBadge}
                            ${canEdit ? `
                            <a class="carnet-del-note" data-note-id="${note.id}" title="Supprimer">
                                <i class="fas fa-trash"></i>
                            </a>` : ""}
                        </div>
                    </div>
                </div>
                <div class="carnet-note-body"${isCollapsed ? ' style="display:none;"' : ''}>
                    <div class="carnet-note-display" data-note-id="${note.id}">
                        ${noteHtml}
                    </div>
                    ${canEdit ? `
                    <div class="carnet-edit-actions" data-note-id="${note.id}">
                        <button type="button" class="carnet-edit-note" data-note-id="${note.id}">
                            <i class="fas fa-pen"></i> Modifier
                        </button>
                    </div>` : ""}
                </div>
            </div>
        </div>`;
    });

    return `<div class="carnet-body">${addBar}${rendered.join("")}</div>`;
}

// ================================================================
// BUILDER HTML — Onglet Expéditions (indépendant)
// ================================================================

export function buildDowntimeHtml(actor) {
    const exps    = getExpeditions(actor);
    const notes   = getCarnetNotes(actor); // pour reverse-lookup des liens
    const isGM    = game.user.isGM;
    const canEdit = actor.isOwner;

    const addBar = isGM ? `
        <div class="carnet-add-bar">
            <button type="button" class="carnet-add-exp">
                <i class="fas fa-plus"></i> Nouvelle expédition
            </button>
        </div>` : "";

    if (!exps.length) {
        return `
        <div class="carnet-body">
            ${addBar}
            <div class="carnet-empty-state">
                <i class="fas fa-calendar-alt"></i>
                <p>Aucune expédition enregistrée.<br>
                   Le GM peut en créer une via le bouton <strong>Date Expédition</strong>
                   dans la barre de gauche, ou via le bouton ci-dessus.</p>
            </div>
        </div>`;
    }

    const dateBtns = (expId, field) => isGM ? `
        <div class="carnet-date-actions">
            <button type="button" class="carnet-date-btn"
                    data-exp-id="${expId}" data-field="${field}" data-action="set"
                    title="Définir à la date actuelle">
                <i class="fas fa-calendar-day"></i>
            </button>
            <button type="button" class="carnet-date-btn"
                    data-exp-id="${expId}" data-field="${field}" data-action="clear"
                    title="Effacer la date">
                <i class="fas fa-times"></i>
            </button>
        </div>` : "";

    const cards = exps.map(exp => {
        const isOpen      = !!(exp.startDate && !exp.endDate);
        const hasDates    = !!(exp.startDate);
        const startStr    = formatDate(exp.startDate);
        const endStr      = exp.endDate ? formatDate(exp.endDate) : null;
        const duration    = dateDiff(exp.startDate, exp.endDate);
        const statusClass = isOpen ? "open" : (hasDates ? "closed" : "pending");
        const statusLabel = isOpen ? "En cours" : (hasDates ? "Terminée" : "Planifiée");
        const statusIcon  = isOpen ? "fa-clock" : (hasDates ? "fa-check-circle" : "fa-hourglass-start");

        // Notes liées à cette expédition
        const linkedNotes = notes.filter(n => n.linkedExpId === exp.id);
        const noteLink = linkedNotes.length
            ? `<a class="carnet-go-note" data-note-id="${linkedNotes[0].id}"
                  title="Voir la note liée dans l'onglet Carnet"
                  style="font-size:11px;color:#9b59b6;text-decoration:none;white-space:nowrap;cursor:pointer;">
                   <i class="fas fa-book-open"></i>
                   ${linkedNotes.length === 1 ? "Note liée" : `${linkedNotes.length} notes liées`}
               </a>`
            : (canEdit
                ? `<a class="carnet-create-note" data-exp-id="${exp.id}" data-exp-name="${(exp.name ?? "").replace(/"/g, "&quot;")}"
                      title="Créer une note liée dans le Carnet"
                      style="font-size:11px;color:#666;text-decoration:none;white-space:nowrap;cursor:pointer;">
                       <i class="fas fa-plus"></i> Créer une note
                   </a>`
                : "");

        const nameField = canEdit
            ? `<input class="carnet-name-input" type="text"
                      data-exp-id="${exp.id}"
                      value="${(exp.name ?? "").replace(/"/g, "&quot;")}"
                      placeholder="Nom de l'expédition">`
            : `<span class="carnet-name-label">${exp.name || "Expédition sans nom"}</span>`;

        return `
        <div class="carnet-tm-card ${statusClass}" data-exp-id="${exp.id}">
            <div class="carnet-tm-stripe"></div>
            <div class="carnet-tm-content">

                <div class="carnet-tm-header">
                    <div class="carnet-tm-name-wrap">${nameField}</div>
                    <div class="carnet-tm-header-right">
                        <span class="carnet-badge ${statusClass}">
                            <i class="fas ${statusIcon}"></i> ${statusLabel}
                        </span>
                        ${noteLink}
                        ${isGM ? `
                        <a class="carnet-del-exp" data-exp-id="${exp.id}" title="Supprimer" style="cursor:pointer;">
                            <i class="fas fa-trash"></i>
                        </a>` : ""}
                    </div>
                </div>

                <div class="carnet-tm-dates">
                    <div class="carnet-date-block">
                        <span class="carnet-date-label"><i class="fas fa-play"></i> Début</span>
                        <span class="carnet-date-value${!exp.startDate ? " empty" : ""}">${startStr}</span>
                        ${dateBtns(exp.id, "startDate")}
                    </div>
                    <span class="carnet-dates-sep"><i class="fas fa-long-arrow-alt-right"></i></span>
                    <div class="carnet-date-block">
                        <span class="carnet-date-label"><i class="fas fa-flag-checkered"></i> Fin</span>
                        <span class="carnet-date-value${!exp.endDate ? " empty" : ""}">${endStr ?? "—"}</span>
                        ${dateBtns(exp.id, "endDate")}
                    </div>
                    ${duration ? `
                    <div class="carnet-date-block duration">
                        <span class="carnet-date-label"><i class="fas fa-hourglass-half"></i> Durée</span>
                        <span class="carnet-duration-value">${duration}</span>
                    </div>` : ""}
                </div>

            </div>
        </div>`;
    }).join("");

    return `<div class="carnet-body">${addBar}<div class="carnet-tm-cards">${cards}</div></div>`;
}

// ================================================================
// HELPERS — Sections collapse + Drag-and-drop
// ================================================================

/** Applique ou retire la visibilité sur toutes les notes sous une section donnée. */
function _applySectionCollapse(element, sectionId, collapsed) {
    const allItems = [...element.querySelectorAll('.carnet-item')];
    const idx = allItems.findIndex(el => el.dataset.carnetId === sectionId);
    if (idx === -1) return;
    for (let i = idx + 1; i < allItems.length; i++) {
        if (allItems[i].dataset.carnetType === "section") break;
        allItems[i].style.display = collapsed ? "none" : "";
    }
}

/**
 * Câble le drag-and-drop de réordonnancement sur tous les .carnet-item.
 *
 * Approche : draggable="true" est posé via JS sur la POIGNÉE (.carnet-drag-handle)
 * pour ne pas être interféré par dnd5e v3 (qui scanne [data-item-id] dans
 * _attachPartListeners). Les items utilisent désormais data-carnet-id au lieu
 * de data-item-id pour éviter que la fiche dnd5e les traite comme des items
 * d'inventaire et leur ajoute ses propres handlers dragstart.
 */
function _wireDragDrop(actor, element) {
    let _dragOverEl = null;

    const clearDragOver = () => {
        _dragOverEl?.classList.remove('carnet-drag-over-top', 'carnet-drag-over-bottom');
        _dragOverEl = null;
    };

    const items = [...element.querySelectorAll('.carnet-item')];
    console.log(`[Carnet] _wireDragDrop : ${items.length} carnet-item(s) trouvés`);

    items.forEach(item => {
        const handle = item.querySelector('.carnet-drag-handle');
        console.log(`[Carnet]   item carnet-id="${item.dataset.carnetId}" handle=`, handle, `draggable="${handle?.getAttribute('draggable')}"`);

        // ── SOURCE : la poignée initie le drag ────────────────────
        if (handle) {
            // On force draggable via JS au cas où le rendu HTML l'aurait retiré
            handle.setAttribute('draggable', 'true');
            console.log(`[Carnet]   → draggable forcé en JS sur handle`);

            handle.addEventListener('dragstart', e => {
                console.log("[Carnet] dragstart sur handle, carnet-id=", item.dataset.carnetId);
                // stopPropagation + stopImmediatePropagation pour bloquer
                // tout handler dnd5e enregistré en amont ou sur le même élément
                e.stopPropagation();
                e.stopImmediatePropagation();
                _draggedItemId = item.dataset.carnetId;
                item.classList.add('carnet-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', _draggedItemId);
                // Image ghost = l'item entier plutôt que la seule poignée
                try { e.dataTransfer.setDragImage(item, 20, 10); } catch {}
            });
        } else {
            console.warn("[Carnet]   ⚠ aucune poignée .carnet-drag-handle dans cet item");
        }

        // ── CIBLE : tous les items acceptent un dépôt ─────────────
        item.addEventListener('dragover', e => {
            if (!_draggedItemId) { console.log("[Carnet] dragover ignoré : pas de _draggedItemId"); return; }
            if (_draggedItemId === item.dataset.carnetId) return;
            e.preventDefault();
            e.stopPropagation(); // empêche le handler drop de la fiche dnd5e
            e.dataTransfer.dropEffect = 'move';
            clearDragOver();
            _dragOverEl = item;
            const rect  = item.getBoundingClientRect();
            const isTop = e.clientY < rect.top + rect.height / 2;
            item.classList.add(isTop ? 'carnet-drag-over-top' : 'carnet-drag-over-bottom');
        });

        item.addEventListener('dragleave', () => {
            if (_dragOverEl === item) clearDragOver();
        });

        item.addEventListener('drop', async e => {
            e.preventDefault();
            e.stopPropagation(); // empêche _onDrop de la fiche dnd5e
            if (!_draggedItemId || _draggedItemId === item.dataset.carnetId) {
                clearDragOver();
                return;
            }
            const rect         = item.getBoundingClientRect();
            const insertBefore = e.clientY < rect.top + rect.height / 2;
            clearDragOver();

            const notes     = getCarnetNotes(actor);
            const fromIdx   = notes.findIndex(n => n.id === _draggedItemId);
            if (fromIdx === -1) return;
            const moved     = notes[fromIdx];
            const without   = notes.filter((_, i) => i !== fromIdx);
            const targetIdx = without.findIndex(n => n.id === item.dataset.carnetId);
            if (targetIdx === -1) return;
            const insertAt  = insertBefore ? targetIdx : targetIdx + 1;
            without.splice(insertAt, 0, moved);
            await actor.setFlag(MODULE, "carnetNotes", without);
        });
    });

    element.addEventListener('dragend', () => {
        console.log("[Carnet] dragend — nettoyage");
        _draggedItemId = null;
        element.querySelectorAll('.carnet-dragging').forEach(el => el.classList.remove('carnet-dragging'));
        clearDragOver();
    });
}

// ================================================================
// CÂBLAGE — Onglet Carnet
// ================================================================

export function wireJournalTab(actor, element, sheet) {
    if (!(element instanceof Element)) {
        console.warn("[Carnet] wireJournalTab : element n'est pas un Element", element);
        return;
    }
    console.log("[Carnet] wireJournalTab appelé", { element, actor: actor?.name });

    // ── Ajouter une note / une section ───────────────────────────
    element.querySelectorAll('.carnet-add-note').forEach(btn => {
        btn.addEventListener('click', async () => { await addCarnetNote(actor); });
    });
    element.querySelectorAll('.carnet-add-section').forEach(btn => {
        btn.addEventListener('click', async () => { await addCarnetSection(actor); });
    });

    // ── Renommer une note ─────────────────────────────────────────
    element.querySelectorAll('.carnet-note-title-input').forEach(input => {
        input.addEventListener('change', async () => {
            const noteId  = input.dataset.noteId;
            const updated = getCarnetNotes(actor).map(n =>
                n.id === noteId ? { ...n, title: input.value.trim() || "Note sans titre" } : n
            );
            await actor.setFlag(MODULE, "carnetNotes", updated);
        });
    });

    // ── Renommer une section ──────────────────────────────────────
    element.querySelectorAll('.carnet-section-title-input').forEach(input => {
        input.addEventListener('change', async () => {
            const sectionId = input.dataset.sectionId;
            const updated   = getCarnetNotes(actor).map(n =>
                n.id === sectionId ? { ...n, title: input.value.trim() || "Section sans nom" } : n
            );
            await actor.setFlag(MODULE, "carnetNotes", updated);
        });
    });

    // ── Supprimer une section ─────────────────────────────────────
    element.querySelectorAll('.carnet-del-section').forEach(link => {
        link.addEventListener('click', async e => {
            e.preventDefault();
            const sectionId = link.dataset.sectionId;
            const section   = getCarnetNotes(actor).find(n => n.id === sectionId);
            const ok = await Dialog.confirm({
                title:   "Supprimer la section ?",
                content: `<p>Supprimer <strong>${section?.title ?? "cette section"}</strong> ?
                           Les notes qu'elle contient ne seront pas supprimées.</p>`,
                yes: () => true, no: () => false
            });
            if (!ok) return;
            await actor.setFlag(MODULE, "carnetNotes",
                getCarnetNotes(actor).filter(n => n.id !== sectionId)
            );
        });
    });

    // ── Replier / déplier une section ────────────────────────────
    element.querySelectorAll('.carnet-toggle-section').forEach(btn => {
        btn.addEventListener('click', () => {
            const sectionId    = btn.dataset.sectionId;
            const collapse     = _getCollapse(actor.id);
            const wasCollapsed = collapse.sections.has(sectionId);
            if (wasCollapsed) {
                collapse.sections.delete(sectionId);
            } else {
                collapse.sections.add(sectionId);
            }
            _saveCollapse(actor.id);
            _applySectionCollapse(element, sectionId, !wasCollapsed);
            const icon = btn.querySelector('i');
            icon?.classList.replace(
                wasCollapsed ? 'fa-chevron-right' : 'fa-chevron-down',
                wasCollapsed ? 'fa-chevron-down'  : 'fa-chevron-right'
            );
            btn.title = wasCollapsed ? 'Replier' : 'Déplier';
        });
    });

    // ── Modifier le contenu ───────────────────────────────────────
    element.querySelectorAll('.carnet-edit-note').forEach(btn => {
        btn.addEventListener('click', () => {
            initNoteEditor(actor, element, btn.dataset.noteId);
        });
    });

    // ── Supprimer une note ────────────────────────────────────────
    element.querySelectorAll('.carnet-del-note').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const noteId = link.dataset.noteId;
            const note   = getCarnetNotes(actor).find(n => n.id === noteId);
            const ok = await Dialog.confirm({
                title:   "Supprimer la note ?",
                content: `<p>Supprimer <strong>${note?.title ?? "cette note"}</strong> ? Cette action est irréversible.</p>`,
                yes: () => true, no: () => false
            });
            if (!ok) return;
            await actor.setFlag(MODULE, "carnetNotes",
                getCarnetNotes(actor).filter(n => n.id !== noteId)
            );
        });
    });

    // ── Replier / déplier une note individuelle ──────────────────
    element.querySelectorAll('.carnet-toggle-note').forEach(btn => {
        btn.addEventListener('click', () => {
            const noteId   = btn.dataset.noteId;
            const collapse = _getCollapse(actor.id);
            const card     = element.querySelector(`.carnet-note-card[data-note-id="${noteId}"]`);
            const body     = card?.querySelector('.carnet-note-body');
            const icon     = btn.querySelector('i');
            if (collapse.notes.has(noteId)) {
                collapse.notes.delete(noteId);
                if (body) body.style.display = '';
                btn.title = 'Replier';
                icon?.classList.replace('fa-chevron-right', 'fa-chevron-down');
            } else {
                collapse.notes.add(noteId);
                if (body) body.style.display = 'none';
                btn.title = 'Déplier';
                icon?.classList.replace('fa-chevron-down', 'fa-chevron-right');
            }
            _saveCollapse(actor.id);
        });
    });

    // ── Délier / lier une expédition ─────────────────────────────
    element.querySelectorAll('.carnet-unlink-note').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const noteId  = btn.dataset.noteId;
            const updated = getCarnetNotes(actor).map(n =>
                n.id === noteId ? { ...n, linkedExpId: null } : n
            );
            await actor.setFlag(MODULE, "carnetNotes", updated);
        });
    });
    element.querySelectorAll('.carnet-link-exp').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const noteId = link.dataset.noteId;
            await _linkNoteToExpDialog(actor, noteId, sheet);
        });
    });
    element.querySelectorAll('.carnet-go-exp').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const expId = link.dataset.expId;
            _navigateToTab(sheet, "carnet-downtime", `[data-exp-id="${expId}"]`);
        });
    });

    // ── Drag-and-drop pour réordonner ────────────────────────────
    if (actor.isOwner) _wireDragDrop(actor, element);
}

// ================================================================
// CÂBLAGE — Onglet Expéditions
// ================================================================

export function wireDowntimeTab(actor, element, sheet) {
    if (!(element instanceof Element)) return;

    // Ajouter une expédition
    element.querySelectorAll('.carnet-add-exp').forEach(btn => {
        btn.addEventListener('click', async () => {
            await addExpedition(actor, null);
        });
    });

    // Renommer une expédition
    element.querySelectorAll('.carnet-name-input').forEach(input => {
        input.addEventListener('change', async () => {
            const expId   = input.dataset.expId;
            const updated = getExpeditions(actor).map(ex =>
                ex.id === expId ? { ...ex, name: input.value.trim() || "Expédition sans nom" } : ex
            );
            await actor.setFlag(MODULE, "expeditions", updated);
        });
    });

    // Boutons date (set / clear)
    element.querySelectorAll('.carnet-date-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                const { expId, field, action } = btn.dataset;
                let newDate = null;
                if (action === "set") {
                    const label = field === "startDate" ? "Date de début" : "Date de fin";
                    newDate = await _pickDateDialog(label);
                    if (!newDate) return; // annulé
                }
                const updated = getExpeditions(actor).map(ex =>
                    ex.id === expId ? { ...ex, [field]: newDate } : ex
                );
                await actor.setFlag(MODULE, "expeditions", updated);
            } catch(err) {
                console.error("[Carnet] Erreur bouton date :", err);
            }
        });
    });

    // Supprimer une expédition
    element.querySelectorAll('.carnet-del-exp').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const expId = link.dataset.expId;
            const exp   = getExpeditions(actor).find(ex => ex.id === expId);
            const ok = await Dialog.confirm({
                title:   "Supprimer l'expédition ?",
                content: `<p>Supprimer <strong>${exp?.name ?? "cette expédition"}</strong> ? Cette action est irréversible.</p>`,
                yes: () => true, no: () => false
            });
            if (!ok) return;
            await actor.setFlag(MODULE, "expeditions",
                getExpeditions(actor).filter(ex => ex.id !== expId)
            );
        });
    });

    // Créer une note liée depuis l'onglet Expéditions
    element.querySelectorAll('.carnet-create-note').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const expId   = link.dataset.expId;
            const expName = link.dataset.expName;
            await addCarnetNote(actor, { title: expName || "Nouvelle note", linkedExpId: expId, prepend: true });
            // Naviguer vers l'onglet Carnet
            _navigateToTab(sheet, "carnet-journal", null);
        });
    });

    // Naviguer vers la note liée (onglet Carnet)
    element.querySelectorAll('.carnet-go-note').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const noteId = link.dataset.noteId;
            _navigateToTab(sheet, "carnet-journal", `[data-note-id="${noteId}"]`);
        });
    });
}

// ================================================================
// NAVIGATION ENTRE ONGLETS
// ================================================================

function _navigateToTab(sheet, tabName, scrollSelector) {
    if (!sheet) return;
    try {
        sheet.changeTab(tabName, "primary", { updatePosition: false });
        if (!scrollSelector) return;
        setTimeout(() => {
            const el = sheet.element?.querySelector?.(scrollSelector);
            if (!el) return;
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            el.classList.add("carnet-highlight");
            setTimeout(() => el.classList.remove("carnet-highlight"), 2000);
        }, 150);
    } catch(err) {
        console.error("[Carnet] Erreur navigation onglet :", err);
    }
}

// ================================================================
// PICKER — Lier une note à une expédition
// ================================================================

async function _linkNoteToExpDialog(actor, noteId, sheet) {
    const exps = getExpeditions(actor);
    if (!exps.length) {
        ui.notifications.warn("[Carnet] Aucune expédition à lier. Créez d'abord une expédition dans l'onglet Expéditions.");
        return;
    }

    const itemsHtml = exps.map(ex => {
        const isOpen      = !!(ex.startDate && !ex.endDate);
        const hasDates    = !!(ex.startDate);
        const statusLabel = isOpen ? "En cours" : (hasDates ? "Terminée" : "Planifiée");
        const statusIcon  = isOpen ? "fa-clock" : (hasDates ? "fa-check-circle" : "fa-hourglass-start");
        const statusColor = isOpen
            ? "background:rgba(46,204,113,0.18);color:#2ecc71;"
            : hasDates
                ? "background:rgba(52,152,219,0.18);color:#3498db;"
                : "background:rgba(241,196,15,0.18);color:#f1c40f;";
        const dateStr = ex.startDate ? formatDate(ex.startDate) : "Pas de date";

        return `
        <div class="carnet-picker-item" tabindex="0"
             data-id="${ex.id}"
             data-search="${(ex.name ?? "").toLowerCase()} ${dateStr.toLowerCase()}"
             style="display:flex;align-items:center;gap:12px;padding:10px 12px;
                    border-radius:6px;cursor:pointer;user-select:none;
                    border:2px solid transparent;
                    background:rgba(255,255,255,0.03);
                    transition:background 0.12s,border-color 0.12s;outline:none;">
            <div style="width:36px;height:36px;border-radius:50%;flex-shrink:0;
                        display:flex;align-items:center;justify-content:center;
                        background:rgba(155,89,182,0.15);">
                <i class="fas fa-route" style="color:#9b59b6;"></i>
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${ex.name || "Expédition sans nom"}
                </div>
                <div style="font-size:11px;color:#9b9b9b;margin-top:3px;display:flex;align-items:center;gap:6px;">
                    <span style="padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;${statusColor}">
                        <i class="fas ${statusIcon}" style="margin-right:3px;"></i>${statusLabel}
                    </span>
                    <span>${dateStr}</span>
                </div>
            </div>
            <div class="carnet-picker-check" style="flex-shrink:0;opacity:0;transition:opacity 0.12s;">
                <i class="fas fa-check-circle" style="color:#9b59b6;font-size:18px;"></i>
            </div>
        </div>`;
    }).join("");

    const content = `
<div style="display:flex;flex-direction:column;gap:8px;padding:2px 0;">
    <div style="position:relative;">
        <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
                                         color:#777;pointer-events:none;font-size:12px;"></i>
        <input type="text" id="carnet-exp-search"
               placeholder="Rechercher une expédition…"
               style="width:100%;box-sizing:border-box;padding:7px 10px 7px 32px;
                      background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);
                      border-radius:6px;color:inherit;font-size:13px;">
    </div>
    <div id="carnet-exp-list"
         style="display:flex;flex-direction:column;gap:3px;
                max-height:320px;overflow-y:auto;padding-right:2px;">
        ${itemsHtml}
    </div>
    <p id="carnet-exp-empty" style="display:none;text-align:center;
                                     color:#777;font-style:italic;padding:16px 0;margin:0;">
        Aucune expédition correspondante.
    </p>
</div>`;

    let selectedId = null;

    const DialogClass = foundry.applications.api?.DialogV2 ?? globalThis.DialogV2;

    if (DialogClass?.wait) {
        const action = await DialogClass.wait({
            window:      { title: "Lier à une expédition" },
            position:    { width: 420 },
            content,
            rejectClose: false,
            render: () => {
                const list        = document.getElementById("carnet-exp-list");
                const searchInput = document.getElementById("carnet-exp-search");
                const emptyMsg    = document.getElementById("carnet-exp-empty");

                const selectItem = (item) => {
                    list?.querySelectorAll(".carnet-picker-item").forEach(i => {
                        i.style.background  = "rgba(255,255,255,0.03)";
                        i.style.borderColor = "transparent";
                        i.querySelector(".carnet-picker-check").style.opacity = "0";
                    });
                    selectedId                  = item.dataset.id;
                    item.style.background       = "rgba(155,89,182,0.14)";
                    item.style.borderColor      = "rgba(155,89,182,0.45)";
                    item.querySelector(".carnet-picker-check").style.opacity = "1";
                };

                list?.querySelectorAll(".carnet-picker-item").forEach(item => {
                    item.addEventListener("click",  () => selectItem(item));
                    item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectItem(item); });
                    item.addEventListener("mouseenter", () => {
                        if (item.dataset.id !== selectedId)
                            item.style.background = "rgba(255,255,255,0.07)";
                    });
                    item.addEventListener("mouseleave", () => {
                        if (item.dataset.id !== selectedId)
                            item.style.background = "rgba(255,255,255,0.03)";
                    });
                });

                searchInput?.addEventListener("input", () => {
                    const q  = searchInput.value.toLowerCase().trim();
                    let hits = 0;
                    list?.querySelectorAll(".carnet-picker-item").forEach(item => {
                        const match = !q || item.dataset.search.includes(q);
                        item.style.display = match ? "" : "none";
                        if (match) hits++;
                    });
                    if (emptyMsg) emptyMsg.style.display = hits === 0 ? "" : "none";
                });

                setTimeout(() => searchInput?.focus(), 60);
            },
            buttons: [
                {
                    action:   "confirm",
                    label:    "Lier",
                    icon:     '<i class="fas fa-link"></i>',
                    default:  true,
                    callback: () => {} // selectedId mis à jour via click
                },
                { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>' }
            ]
        });
        if (action !== "confirm" || !selectedId) return;

    } else {
        // Fallback Dialog v1 — simple select
        const opts = exps.map(ex =>
            `<option value="${ex.id}">${ex.name || "Expédition sans nom"} — ${formatDate(ex.startDate)}</option>`
        ).join("");
        selectedId = await new Promise(resolve => {
            new Dialog({
                title:   "Lier à une expédition",
                content: `<div><select id="carnet-fb-sel" style="width:100%;">${opts}</select></div>`,
                buttons: {
                    confirm: { label: "Lier", callback: (html) => resolve(html.find('#carnet-fb-sel').val()) },
                    cancel:  { label: "Annuler", callback: () => resolve(null) }
                },
                default: "confirm"
            }, { width: 360 }).render(true);
        });
        if (!selectedId) return;
    }

    const updated = getCarnetNotes(actor).map(n =>
        n.id === noteId ? { ...n, linkedExpId: selectedId } : n
    );
    await actor.setFlag(MODULE, "carnetNotes", updated);
}

// ================================================================
// ÉDITEUR NOTES — contenteditable + barre d'outils (v1.1.6)
// ================================================================

const _TOOLBAR_BTNS = [
    { cmd: "bold",                label: "<strong>G</strong>", title: "Gras (Ctrl+B)" },
    { cmd: "italic",              label: "<em>I</em>",         title: "Italique (Ctrl+I)" },
    { cmd: "underline",           label: "<u>S</u>",           title: "Souligné (Ctrl+U)" },
    { cmd: "strikeThrough",       label: "<s>R</s>",           title: "Barré" },
    { sep: true },
    { cmd: "formatBlock", val: "h2", label: "T1",             title: "Titre" },
    { cmd: "formatBlock", val: "h3", label: "T2",             title: "Sous-titre" },
    { cmd: "formatBlock", val: "p",  label: "¶",              title: "Paragraphe normal" },
    { sep: true },
    { cmd: "insertUnorderedList", label: "•",                  title: "Liste à puces" },
    { cmd: "insertOrderedList",   label: "1.",                 title: "Liste numérotée" },
];

function _buildToolbar() {
    const sep = `<span style="width:1px;background:rgba(255,255,255,0.15);
                              margin:2px 4px;align-self:stretch;flex-shrink:0;"></span>`;

    const btns = _TOOLBAR_BTNS.map(b => {
        if (b.sep) return sep;
        return `<button type="button"
                    class="carnet-tb-btn"
                    data-cmd="${b.cmd}"
                    ${b.val ? `data-val="${b.val}"` : ""}
                    title="${b.title}"
                    style="min-width:26px;height:26px;padding:0 5px;border-radius:3px;
                           border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);
                           color:#ccc;font-size:12px;cursor:pointer;line-height:1;
                           display:inline-flex;align-items:center;justify-content:center;
                           transition:background .12s,border-color .12s,color .12s;">
                    ${b.label}
                </button>`;
    }).join("");

    const sizeSelect = `${sep}
        <select class="carnet-tb-size" title="Taille du texte sélectionné"
                style="height:26px;padding:0 5px;border-radius:3px;
                       border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.35);
                       color:#ccc;font-size:11px;cursor:pointer;outline:none;">
            <option value="">Taille…</option>
            <option value="2">Petite</option>
            <option value="3">Normale</option>
            <option value="4">Grande</option>
            <option value="5">Très grande</option>
        </select>`;

    return `<div class="carnet-editor-toolbar"
         style="display:flex;flex-wrap:wrap;align-items:center;gap:3px;
                padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.1);
                background:rgba(0,0,0,0.2);flex-shrink:0;">
        ${btns}${sizeSelect}
    </div>`;
}

// Met à jour l'état actif des boutons de la toolbar selon la sélection courante
function _updateToolbarState(editor) {
    const sel = window.getSelection();
    const inEditor = editor && sel?.rangeCount > 0
        && editor.contains(sel.getRangeAt(0).commonAncestorContainer);

    document.querySelectorAll('.carnet-tb-btn').forEach(btn => {
        const { cmd, val } = btn.dataset;
        let active = false;
        if (inEditor) {
            try {
                active = cmd === 'formatBlock'
                    ? document.queryCommandValue('formatBlock').toLowerCase() === (val ?? '').toLowerCase()
                    : document.queryCommandState(cmd);
            } catch(e) {}
        }
        if (active) {
            btn.style.background  = 'rgba(201,162,39,0.28)';
            btn.style.borderColor = 'rgba(201,162,39,0.55)';
            btn.style.color       = '#e8cc6a';
        } else {
            btn.style.background  = 'rgba(255,255,255,0.05)';
            btn.style.borderColor = 'rgba(255,255,255,0.12)';
            btn.style.color       = '#ccc';
        }
    });
}

function _wireToolbar(editor) {
    let _savedRange = null;

    // Sauvegarde la sélection dès que l'éditeur perd le focus
    // (permet de la restaurer après un clic sur le sélecteur de taille)
    editor?.addEventListener('blur', () => {
        const sel = window.getSelection();
        if (sel?.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            _savedRange = sel.getRangeAt(0).cloneRange();
        }
    });

    const updateState = () => _updateToolbarState(editor);

    // Boutons de formatage
    document.querySelectorAll('.carnet-tb-btn').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); // garde le focus sur l'éditeur
            const { cmd, val } = btn.dataset;
            document.execCommand(cmd, false, val ?? null);
            editor?.focus();
            setTimeout(updateState, 10);
        });
    });

    // Sélecteur de taille
    const sizeSelect = document.querySelector('.carnet-tb-size');
    if (sizeSelect) {
        sizeSelect.addEventListener('change', function () {
            const val = this.value;
            this.value = '';
            if (!val) return;
            // Restaure la sélection dans l'éditeur avant d'appliquer la commande
            editor?.focus();
            if (_savedRange) {
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(_savedRange);
                _savedRange = null;
            }
            document.execCommand('fontSize', false, val);
            setTimeout(updateState, 10);
        });
    }

    // Mise à jour de l'état à chaque changement de sélection, frappe ou clic
    document.addEventListener('selectionchange', updateState);
    editor?.addEventListener('keyup', updateState);
    editor?.addEventListener('mouseup', updateState);

    // Nettoyage quand le dialog est fermé (éditeur retiré du DOM)
    const _injectedStyle = document.getElementById('carnet-editor-style');
    const observer = new MutationObserver(() => {
        if (!document.contains(editor)) {
            document.removeEventListener('selectionchange', updateState);
            document.getElementById('carnet-editor-style')?.remove();
            observer.disconnect();
        }
    });
    if (editor) observer.observe(document.body, { childList: true, subtree: true });

    updateState();
}

async function initNoteEditor(actor, _container, noteId) {
    const note = getCarnetNotes(actor).find(n => n.id === noteId);
    if (!note) return;

    const stored = note.content ?? "";

    const editorContent = `
        <div style="display:flex;flex-direction:column;height:100%;">
            ${_buildToolbar()}
            <div id="carnet-note-editor"
                 contenteditable="true"
                 style="flex:1;overflow-y:auto;padding:10px 14px;min-height:280px;
                        outline:none;font-size:13px;line-height:1.7;color:#ccc;
                        background:rgba(0,0,0,0.12);"
            >${stored}</div>
        </div>`;

    const DialogClass = foundry.applications.api?.DialogV2 ?? null;

    if (DialogClass?.wait) {
        let savedContent = stored;

        const action = await DialogClass.wait({
            window:      { title: `✏ ${note.title ?? "Modifier la note"}` },
            position:    { width: 660, height: 560 },
            classes:     ["carnet-grimoire"],
            content:     editorContent,
            rejectClose: false,
            render: () => {
                const editor = document.getElementById("carnet-note-editor");

                // Injecte les règles CSS de l'éditeur dans <head> — DialogV2 sanitize
                // et supprime les balises <style> dans son contenu HTML, donc on
                // les injecte ici directement dans le document (bypass complet).
                if (!document.getElementById('carnet-editor-style')) {
                    const style = document.createElement('style');
                    style.id = 'carnet-editor-style';
                    style.textContent = `
                        #carnet-note-editor h2 {
                            font-size:1.55em;font-weight:700;
                            margin:.55em 0 .2em;color:#e8cc6a;line-height:1.25;
                        }
                        #carnet-note-editor h3 {
                            font-size:1.25em;font-weight:600;
                            margin:.45em 0 .2em;color:#c9a227;line-height:1.3;
                        }
                        #carnet-note-editor ul,
                        #carnet-note-editor ol { padding-left:1.5em;margin:.3em 0; }
                        #carnet-note-editor li  { margin:.15em 0; }
                        .carnet-tb-size option  { background:#1a1410; }
                    `;
                    document.head.appendChild(style);
                }

                _wireToolbar(editor);
                // Capture le contenu à chaque frappe — évite le bug où le callback
                // du bouton s'exécute après la fermeture du dialog (element retiré du DOM)
                editor?.addEventListener('input', () => { savedContent = editor.innerHTML; });
                setTimeout(() => {
                    if (!editor) return;
                    editor.focus();
                    // curseur à la fin
                    const range = document.createRange();
                    range.selectNodeContents(editor);
                    range.collapse(false);
                    window.getSelection()?.removeAllRanges();
                    window.getSelection()?.addRange(range);
                }, 60);
            },
            buttons: [
                {
                    action:   "save",
                    label:    "Sauvegarder",
                    icon:     '<i class="fas fa-save"></i>',
                    default:  true,
                    callback: () => {
                        // Fallback si l'input event n'a pas capturé (ex: premier clic sans frappe)
                        const editor = document.getElementById("carnet-note-editor");
                        if (editor) savedContent = editor.innerHTML;
                    }
                },
                { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>' }
            ]
        });

        if (action !== "save") return;

        const updated = getCarnetNotes(actor).map(n =>
            n.id === noteId ? { ...n, content: savedContent } : n
        );
        await actor.setFlag(MODULE, "carnetNotes", updated);

    } else {
        // ── Fallback Dialog v1 ─────────────────────────────────
        new Dialog({
            title:   `✏ ${note.title ?? "Modifier la note"}`,
            content: `<div style="padding:4px 0;">${editorContent}</div>`,
            buttons: {
                save: {
                    icon:  '<i class="fas fa-save"></i>',
                    label: "Sauvegarder",
                    callback: async (html) => {
                        const editor  = html[0]?.querySelector('#carnet-note-editor');
                        const content = editor ? editor.innerHTML : stored;
                        const updated = getCarnetNotes(actor).map(n =>
                            n.id === noteId ? { ...n, content } : n
                        );
                        await actor.setFlag(MODULE, "carnetNotes", updated);
                    }
                },
                cancel: { icon: '<i class="fas fa-times"></i>', label: "Annuler" }
            },
            default: "save",
            render: (html) => {
                const editor = html[0]?.querySelector('#carnet-note-editor');
                _wireToolbar(editor);
            }
        }, { width: 660, height: 540 }).render(true);
    }
}
