// ============================================================
// relations.js — Système de relations entre acteurs
//
// Stockage  : flag scope MOD → "list" sur chaque acteur
//             [ { id, targetId, targetName, targetImg,
//                 type, level(-3→+3), note, lastPosition, secret } ]
// Interface : onglet "Relations" injecté dans la fiche acteur
// Auto-det. : canvasReady / createToken / updateToken (GM only)
// © 2026 Soruta — Tous droits réservés. Usage personnel autorisé. Redistribution et modification interdites.
// ============================================================

import { MOD } from "./const.js";
export const MODULE = MOD;

// ---- État de session ---------------------------------------

const _expanded   = new Set();  // IDs de relations dont les notes sont ouvertes
const _activeActs = new Set();  // IDs d'acteurs avec le tab Relations actif
let   _noteTimer  = null;       // Debounce auto-save notes
let   _scanning   = false;      // Guard anti-doublon scan
let   _sightTimer = null;       // Debounce sightRefresh

// ---- Icônes de niveau (-3 → +3) ----------------------------

const LEVEL_CFG = {
    "-3": { icon: "fa-skull",       color: "#8b0000", label: "Haine totale" },
    "-2": { icon: "fa-fire",        color: "#e74c3c", label: "Hostilité"    },
    "-1": { icon: "fa-thumbs-down", color: "#e67e22", label: "Méfiance"     },
     "0": { icon: "fa-minus",       color: "#888888", label: "Neutre"       },
     "1": { icon: "fa-thumbs-up",   color: "#a8d5a2", label: "Sympathie"    },
     "2": { icon: "fa-star",        color: "#27ae60", label: "Amitié"       },
     "3": { icon: "fa-heart",       color: "#e91e8c", label: "Loyauté"      },
};

function levelIcon(level) {
    const cfg = LEVEL_CFG[String(level ?? 0)] ?? LEVEL_CFG["0"];
    return `<i class="fas ${cfg.icon} rel-level-icon" style="color:${cfg.color};" title="${cfg.label} (${level > 0 ? "+" : ""}${level ?? 0})"></i>`;
}

function levelSelector(currentLevel, canEdit) {
    const cur = LEVEL_CFG[String(currentLevel ?? 0)] ?? LEVEL_CFG["0"];
    if (!canEdit) return `<div class="rel-level">${levelIcon(currentLevel)}</div>`;
    // Trier explicitement -3→+3 (Object.entries met les clés entières positives en premier en JS)
    const btns = Object.entries(LEVEL_CFG).sort(([a],[b]) => parseInt(a) - parseInt(b)).map(([lvl, cfg]) => {
        const active  = parseInt(lvl) === (currentLevel ?? 0);
        const color   = active ? `style="color:${cfg.color};"` : "";
        const classes = `rel-level-btn${active ? " active" : ""}`;
        return `<a class="${classes}" data-level="${lvl}" title="${cfg.label}">
            <i class="fas ${cfg.icon}" ${color}></i>
        </a>`;
    }).join("");
    return `<div class="rel-level-selector">
        <span class="rel-level-label" style="color:${cur.color};">${cur.label}</span>
        ${btns}
    </div>`;
}

// ---- CRUD --------------------------------------------------

function relList(actor) {
    return actor.getFlag(MOD, "relationsList") ?? [];
}

// {render: false} → jamais de re-render depuis l'onglet (DOM géré manuellement)
async function relSave(actor, list) {
    await actor.update({ [`flags.${MOD}.relationsList`]: list }, { render: false });
}

// Retourne le nouvel objet relation (ou null si doublon)
async function relAdd(actor, data) {
    const list = relList(actor);
    if (list.some(r => r.targetId === data.targetId)) return null;
    const targetActor = game.actors.get(data.targetId);
    const rel = {
        id: foundry.utils.randomID(12),
        revealed: !(targetActor?.getFlag(MOD, "anonymous") ?? false),
        note: "", lastPosition: game.scenes.current?.name ?? "",
        secret: false, ...data
    };
    list.push(rel);
    await relSave(actor, list);
    return rel;
}

async function relUpdate(actor, id, patch) {
    await relSave(actor, relList(actor).map(r => r.id === id ? { ...r, ...patch } : r));
}

async function relDelete(actor, id) {
    await relSave(actor, relList(actor).filter(r => r.id !== id));
}

// ---- Helpers acteurs ---------------------------------------

// Remonte l'arbre de dossiers pour savoir si actor est sous folderId
function isInFolder(actor, folderId) {
    if (!folderId) return false;
    let f = actor.folder;
    while (f) {
        if (f.id === folderId) return true;
        f = f.folder;
    }
    return false;
}

function isInPJFolder(actor)        { return isInFolder(actor, game.settings.get(MOD, "relationsFolderPJ")); }
function isInPNJFolder(actor)       { return isInFolder(actor, game.settings.get(MOD, "relationsFolderPNJ")); }
function isInCreaturesFolder(actor) { return isInFolder(actor, game.settings.get(MOD, "relationsFolderCreatures")); }

// Acteurs disponibles pour une nouvelle relation
// (dossiers "PJ" et "PNJ", excluant soi-même et les déjà-liés)
function availableActors(actor) {
    const existing = new Set(relList(actor).map(r => r.targetId));
    return game.actors
        .filter(a => ((isInPJFolder(a) && a.type === "character") || isInPNJFolder(a))
                  && a.id !== actor.id
                  && !existing.has(a.id))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- HTML onglet -------------------------------------------

export function buildRowHtml(r, actor, canEdit) {
    const target   = game.actors.get(r.targetId);
    const revealed = r.revealed ?? true;
    const img      = target?.img  ?? r.targetImg  ?? "icons/svg/mystery-man.svg";
    const name     = revealed ? (target?.name ?? r.targetName ?? "Inconnu") : "Inconnu";
    const open   = _expanded.has(r.id);
    return `
    <div class="rel-row" data-rel-id="${r.id}">
        <div class="rel-header">
            <img class="rel-avatar" src="${img}" alt="${name}">
            <span class="rel-name">${name}</span>
            ${levelSelector(r.level ?? 0, canEdit)}
            <div class="rel-btns">
                ${game.user.isGM && target ? `<a class="rel-open-sheet" data-target-id="${r.targetId}" title="Ouvrir la fiche"><i class="fas fa-external-link-alt"></i></a>` : ""}
                <a class="rel-toggle" title="Notes"><i class="fas fa-chevron-${open ? "up" : "down"}"></i></a>
                ${canEdit ? `<a class="rel-delete" title="Supprimer"><i class="fas fa-trash"></i></a>` : ""}
            </div>
        </div>
        <div class="rel-notes"${open ? "" : ' style="display:none;"'}>
            ${canEdit ? `
            <div class="rel-lastpos-row">
                <label class="rel-field-label"><i class="fas fa-map-marker-alt"></i> Dernière position</label>
                <input class="rel-lastpos-input" type="text" data-rel-id="${r.id}"
                    value="${r.lastPosition ?? ""}" placeholder="Scène, lieu…">
            </div>
            <textarea class="rel-note-input" data-rel-id="${r.id}"
                placeholder="Notes sur cette relation…">${r.note ?? ""}</textarea>
            ` : `
            <div class="rel-lastpos-row rel-readonly">
                <i class="fas fa-map-marker-alt"></i>
                <span>${r.lastPosition || "<em>Position inconnue</em>"}</span>
            </div>
            <p class="rel-note-ro">${r.note || "<em>Aucune note.</em>"}</p>
            `}
        </div>
    </div>`;
}

export function emptyStateHtml() {
    return `<div class="rel-empty">
        <i class="fas fa-heart-broken"></i>
        <span>Aucune relation enregistrée.</span>
    </div>`;
}

export function buildTabHtml(actor) {
    const isGM    = game.user.isGM;
    const canEdit = isGM || actor.isOwner;
    const rels    = relList(actor);

    // Grouper : Joueurs (dossier "PJ"), PNJ (dossier "PNJ")
    const pjRels  = rels.filter(r => { const a = game.actors.get(r.targetId); return a && isInPJFolder(a) && a.type === "character"; });
    const pnjRels = rels.filter(r => { const a = game.actors.get(r.targetId); return a && isInPNJFolder(a); });

    // ---- Styles inline (contournement cache CSS Foundry) ----
    const S = {
        // Conteneur titre
        titleBar: `display:flex;align-items:center;justify-content:space-between;` +
                  `padding:8px 12px 6px;flex-shrink:0;` +
                  `border-bottom:1px solid rgba(255,255,255,0.07);`,
        // Texte "♥ Relations"
        title:    `display:flex;align-items:center;gap:6px;` +
                  `font-size:12px;font-weight:700;text-transform:uppercase;` +
                  `letter-spacing:0.06em;color:#ccc;`,
        // Bouton "+ Ajouter"
        addBtn:   `display:flex;align-items:center;gap:5px;` +
                  `padding:3px 9px;` +
                  `background:rgba(255,255,255,0.04);` +
                  `border:1px solid rgba(255,255,255,0.1);border-radius:4px;` +
                  `color:#aaa;font-size:11px;cursor:pointer;white-space:nowrap;` +
                  `transition:background 0.12s,color 0.12s;`,
        // Barre de recherche
        searchBar:`display:flex;align-items:center;gap:6px;` +
                  `padding:5px 10px;flex-shrink:0;` +
                  `border-bottom:1px solid rgba(255,255,255,0.06);`,
        wrap:     `flex:1;display:flex;align-items:center;gap:6px;` +
                  `background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);` +
                  `border-radius:4px;padding:4px 8px;`,
        srchIcon: `color:#555;font-size:11px;flex-shrink:0;`,
        srchInput:`flex:1;background:transparent;border:none;box-shadow:none;outline:none;` +
                  `color:#bbb;font-size:11px;padding:0;min-width:0;font-family:inherit;`,
        clear:    `display:none;color:#444;font-size:10px;cursor:pointer;padding:2px 3px;`,
        // En-tête de section
        secHdr:   `display:flex;align-items:center;gap:6px;` +
                  `padding:4px 12px;flex-shrink:0;` +
                  `font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.09em;` +
                  `color:#666;background:rgba(0,0,0,0.3);` +
                  `border-top:1px solid #1e1e1e;border-bottom:1px solid #1e1e1e;`,
        secCount: `color:#444;font-weight:400;font-size:10px;`,
    };

    function sectionHdr(label, count) {
        return `<div style="${S.secHdr}">${label}<span style="${S.secCount}">${count}</span></div>`;
    }

    let listContent;
    if (!rels.length) {
        listContent = emptyStateHtml(isGM);
    } else {
        listContent =
            (pjRels.length  ? sectionHdr("Joueurs", pjRels.length)  + pjRels.map( r => buildRowHtml(r, actor, canEdit)).join("") : "") +
            (pnjRels.length ? sectionHdr("PNJ",     pnjRels.length) + pnjRels.map(r => buildRowHtml(r, actor, canEdit)).join("") : "");
    }

    return `
    <div class="rel-tab" data-actor-id="${actor.id}">

        <div style="${S.titleBar}">
            <span style="${S.title}">
                <i class="fas fa-heart" style="color:#e91e8c;font-size:11px;"></i>
                Relations
            </span>
            ${isGM ? `<a class="rel-add-btn">
                <i class="fas fa-plus" style="font-size:10px;"></i> Ajouter
            </a>` : ""}
        </div>

        <div style="${S.searchBar}">
            <div class="rel-search-wrap" style="${S.wrap}">
                <i class="fas fa-search" style="${S.srchIcon}"></i>
                <input class="rel-search-input" type="text"
                    placeholder="Rechercher une relation…" style="${S.srchInput}">
                <a class="rel-search-clear" style="${S.clear}" title="Effacer">
                    <i class="fas fa-times"></i>
                </a>
            </div>
        </div>

        <div class="rel-list">
            ${listContent}
        </div>
    </div>`;
}

// ---- Picker acteur (dialog ajout) --------------------------

function buildPickerHtml(pj, uid) {
    const actors = availableActors(pj);
    const joueurs = actors.filter(a => isInPJFolder(a) && a.type === "character");
    const pnjs    = actors.filter(a => isInPNJFolder(a));

    function actorRow(a) {
        return `<div class="rel-picker-actor" data-actor-id="${a.id}" data-name="${a.name.toLowerCase()}">
            <img src="${a.img ?? "icons/svg/mystery-man.svg"}" alt="${a.name}">
            <span>${a.name}</span>
        </div>`;
    }

    function section(title, list, key) {
        if (!list.length) return "";
        return `
        <div class="rel-picker-section">
            <div class="rel-picker-section-hdr" data-key="${key}">
                <i class="fas fa-chevron-down"></i>
                <span>${title}</span>
                <small>(${list.length})</small>
            </div>
            <div class="rel-picker-section-body" data-key="${key}">
                ${list.map(actorRow).join("")}
            </div>
        </div>`;
    }

    return `
    <div id="${uid}" style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
        <input class="rel-picker-search" type="text" placeholder="🔍 Rechercher un personnage…"
            style="width:100%;box-sizing:border-box;padding:5px 8px;
                   border:1px solid #555;border-radius:4px;background:#111;color:#ddd;font-size:12px;">
        <div class="rel-picker-list">
            ${section("Joueurs", joueurs, "pj")}
            ${section("PNJ",     pnjs,    "pnj")}
            ${!joueurs.length && !pnjs.length
                ? '<p style="color:#666;font-style:italic;font-size:12px;text-align:center;padding:12px 0;">Aucun personnage disponible.</p>'
                : ""}
        </div>
        <hr style="border-color:#333;margin:0;">
        <label style="font-size:12px;color:#aaa;">Niveau d'affinité
            <div style="display:flex;align-items:center;gap:10px;margin-top:6px;">
                <span style="font-size:11px;color:#e74c3c;flex-shrink:0;">Hostile</span>
                <input id="${uid}-level" type="range" min="-3" max="3" step="1" value="0" style="flex:1;">
                <span style="font-size:11px;color:#4caf50;flex-shrink:0;">Allié</span>
                <span id="${uid}-lvlval" style="min-width:28px;text-align:center;
                    font-size:14px;font-weight:bold;color:#ddd;">0</span>
            </div>
        </label>
    </div>`;
}

async function openAddDialog(actor) {
    const uid = `rel-add-${Date.now()}`;
    let selectedActorId = null;
    let result = null;

    await foundry.applications.api.DialogV2.wait({
        window: { title: "Nouvelle relation" },
        position: { width: 400 },
        rejectClose: false,
        content: buildPickerHtml(actor, uid),
        render: () => {
            const d = document.getElementById(uid);
            if (!d) return;

            // Sélection d'un acteur
            d.querySelectorAll(".rel-picker-actor").forEach(el => {
                el.addEventListener("click", () => {
                    d.querySelectorAll(".rel-picker-actor").forEach(e => e.classList.remove("selected"));
                    el.classList.add("selected");
                    selectedActorId = el.dataset.actorId;
                });
            });

            // Déplier / replier sections
            d.querySelectorAll(".rel-picker-section-hdr").forEach(hdr => {
                hdr.addEventListener("click", () => {
                    const key  = hdr.dataset.key;
                    const body = d.querySelector(`.rel-picker-section-body[data-key="${key}"]`);
                    const icon = hdr.querySelector("i");
                    const open = body.style.display !== "none";
                    body.style.display = open ? "none" : "";
                    icon.classList.toggle("fa-chevron-down", open);
                    icon.classList.toggle("fa-chevron-up",  !open);
                });
            });

            // Recherche
            d.querySelector(".rel-picker-search").addEventListener("input", function () {
                const q = this.value.trim().toLowerCase();
                d.querySelectorAll(".rel-picker-actor").forEach(el => {
                    const match = !q || el.dataset.name.includes(q);
                    el.style.display = match ? "" : "none";
                });
                // Afficher les sections qui ont encore des résultats visibles
                d.querySelectorAll(".rel-picker-section").forEach(sec => {
                    const anyVisible = [...sec.querySelectorAll(".rel-picker-actor")]
                        .some(e => e.style.display !== "none");
                    sec.style.display = anyVisible ? "" : "none";
                });
            });

            // Slider niveau
            const slider = d.querySelector(`#${uid}-level`);
            const lvlVal = d.querySelector(`#${uid}-lvlval`);
            slider.addEventListener("input", () => {
                const v = parseInt(slider.value);
                lvlVal.textContent = (v > 0 ? "+" : "") + v;
            });

            setTimeout(() => d.querySelector(".rel-picker-search")?.focus(), 60);
        },
        buttons: [
            {
                action: "confirm", default: true,
                label: "Ajouter", icon: '<i class="fas fa-check"></i>',
                callback: () => {
                    if (!selectedActorId) return;
                    const d = document.getElementById(uid);
                    if (!d) return;
                    const target = game.actors.get(selectedActorId);
                    result = {
                        targetId:   selectedActorId,
                        targetName: target?.name ?? "Inconnu",
                        targetImg:  target?.img  ?? "",
                        level:  parseInt(d.querySelector(`#${uid}-level`).value) || 0,
                        lastPosition: game.scenes.current?.name ?? "",
                    };
                }
            },
            { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>', callback: () => {} }
        ]
    });

    return result;
}

// ---- Dialog modification -----------------------------------

async function openEditDialog(actor, rel) {
    const uid = `rel-edit-${Date.now()}`;
    let result = null;

    await foundry.applications.api.DialogV2.wait({
        window: { title: `Modifier — ${rel.targetName}` },
        position: { width: 360 },
        rejectClose: false,
        content: `
        <div id="${uid}" style="display:flex;flex-direction:column;gap:12px;padding:4px 0;">
            <div style="display:flex;align-items:center;gap:10px;padding:6px 8px;
                background:#1a1a1a;border-radius:6px;border:1px solid #333;">
                <img src="${rel.targetImg || "icons/svg/mystery-man.svg"}"
                    style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid #444;">
                <strong style="font-size:13px;">${rel.targetName}</strong>
            </div>
            <label style="font-size:12px;color:#aaa;">Type de relation
                <input id="${uid}-type" type="text" value="${rel.type ?? ""}"
                    placeholder="Allié, Ennemi, Famille…"
                    style="margin-top:4px;display:block;width:100%;box-sizing:border-box;
                        background:#1a1a1a;color:#ddd;border:1px solid #555;
                        border-radius:4px;padding:5px 8px;font-size:12px;">
            </label>
            <label style="font-size:12px;color:#aaa;">Niveau d'affinité
                <div style="display:flex;align-items:center;gap:10px;margin-top:6px;">
                    <span style="font-size:11px;color:#e74c3c;flex-shrink:0;">Hostile</span>
                    <input id="${uid}-level" type="range" min="-3" max="3" step="1"
                        value="${rel.level ?? 0}" style="flex:1;">
                    <span style="font-size:11px;color:#4caf50;flex-shrink:0;">Allié</span>
                    <span id="${uid}-lvlval" style="min-width:28px;text-align:center;
                        font-size:14px;font-weight:bold;color:#ddd;">
                        ${(rel.level ?? 0) > 0 ? "+" : ""}${rel.level ?? 0}
                    </span>
                </div>
            </label>
            <label style="font-size:12px;color:#aaa;display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input id="${uid}-secret" type="checkbox"${rel.secret ? " checked" : ""}> Secret (GM uniquement)
            </label>
        </div>`,
        render: () => {
            const d = document.getElementById(uid);
            if (!d) return;
            d.querySelector(`#${uid}-level`).addEventListener("input", function () {
                const v = parseInt(this.value);
                d.querySelector(`#${uid}-lvlval`).textContent = (v > 0 ? "+" : "") + v;
            });
        },
        buttons: [
            {
                action: "confirm", default: true,
                label: "Modifier", icon: '<i class="fas fa-check"></i>',
                callback: () => {
                    const d = document.getElementById(uid);
                    if (!d) return;
                    result = {
                        type:   d.querySelector(`#${uid}-type`).value.trim(),
                        level:  parseInt(d.querySelector(`#${uid}-level`).value) || 0,
                        secret: d.querySelector(`#${uid}-secret`).checked,
                    };
                }
            },
            { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>', callback: () => {} }
        ]
    });

    return result;
}

// ---- Helpers -----------------------------------------------

function _autoResize(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
}

// ---- Événements de l'onglet --------------------------------

export function wireTab(actor, $html) {
    const $tab = $html.find(".rel-tab");
    if (!$tab.length) return;

    // Resize textareas déjà visibles (sections ouvertes depuis _expanded)
    $tab.find(".rel-note-input").each((_, el) => _autoResize(el));

    const canEdit = game.user.isGM || actor.isOwner;

    // Clic sur la ligne → ouvrir le portrait
    $tab.on("click", ".rel-header", function (e) {
        if ($(e.target).closest("a, input, .rel-level-btn, .rel-btns").length) return;
        const relId  = String($(this).closest(".rel-row").data("rel-id"));
        const rel    = relList(actor).find(r => r.id === relId);
        if (!rel) return;
        const target = game.actors.get(rel.targetId);
        const img    = target?.img  ?? rel.targetImg  ?? "icons/svg/mystery-man.svg";
        const name   = target?.name ?? rel.targetName ?? "Inconnu";
        new ImagePopout(img, { title: name }).render(true);
    });

    // Ajouter — DOM uniquement, pas de re-render
    $tab.on("click", ".rel-add-btn", async () => {
        const data = await openAddDialog(actor);
        if (!data) return;
        const rel = await relAdd(actor, data);
        if (!rel) return;
        $tab.find(".rel-empty").remove();
        $tab.find(".rel-list").append(buildRowHtml(rel, actor, canEdit));
    });

    // Déplier / replier notes
    $tab.on("click", ".rel-toggle", function () {
        const $row   = $(this).closest(".rel-row");
        const relId  = String($row.data("rel-id"));
        const $notes = $row.find(".rel-notes");
        const $icon  = $(this).find("i");
        if ($notes.is(":visible")) {
            _expanded.delete(relId);
            $notes.slideUp(150);
            $icon.removeClass("fa-chevron-up").addClass("fa-chevron-down");
        } else {
            _expanded.add(relId);
            $notes.slideDown(150, function () {
                $(this).find(".rel-note-input").each((_, el) => _autoResize(el));
            });
            $icon.removeClass("fa-chevron-down").addClass("fa-chevron-up");
        }
    });

    // Changer le niveau directement depuis les icônes inline
    $tab.on("click", ".rel-level-btn", async function () {
        const $btn  = $(this);
        const relId = String($btn.closest(".rel-row").data("rel-id"));
        const level = parseInt($btn.data("level"));
        const cfg   = LEVEL_CFG[String(level)];
        // Mise à jour optimiste du DOM (évite le flash avant re-render)
        const $sel  = $btn.closest(".rel-level-selector");
        $sel.find(".rel-level-btn").removeClass("active").find("i").css("color", "");
        $btn.addClass("active").find("i").css("color", cfg.color);
        $sel.find(".rel-level-label").text(cfg.label).css("color", cfg.color);
        await relUpdate(actor, relId, { level });
    });

    // Ouvrir la fiche de l'acteur cible (GM uniquement)
    $tab.on("click", ".rel-open-sheet", function (e) {
        e.stopPropagation();
        const targetId = $(this).data("target-id");
        game.actors.get(String(targetId))?.sheet?.render(true);
    });

    // Supprimer — DOM uniquement, pas de re-render
    $tab.on("click", ".rel-delete", async function () {
        const $row  = $(this).closest(".rel-row");
        const relId = String($row.data("rel-id"));
        const rel   = relList(actor).find(r => r.id === relId);
        if (!rel) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Supprimer la relation" },
            content: `<p>Supprimer la relation avec <strong>${rel.targetName}</strong> ?<br>
                      <small style="color:#999;">Cette action est irréversible.</small></p>`,
        });
        if (!ok) return;
        _expanded.delete(relId);
        $row.remove();
        await relDelete(actor, relId);
        // Afficher l'état vide si plus aucune ligne
        if (!$tab.find(".rel-row").length) {
            $tab.find(".rel-list").html(emptyStateHtml(game.user.isGM));
        }
    });

    // Auto-save dernière position
    $tab.on("blur", ".rel-lastpos-input", async function () {
        const relId = String($(this).data("rel-id"));
        await relUpdate(actor, relId, { lastPosition: this.value.trim() });
    });

    // Auto-save note (debounce + blur immédiat)
    $tab.on("input", ".rel-note-input", function () {
        _autoResize(this);
        clearTimeout(_noteTimer);
        const relId = String($(this).data("rel-id"));
        const val   = this.value;
        _noteTimer  = setTimeout(() => relUpdate(actor, relId, { note: val }), 1200);
    });

    $tab.on("blur", ".rel-note-input", async function () {
        clearTimeout(_noteTimer);
        const relId = String($(this).data("rel-id"));
        await relUpdate(actor, relId, { note: this.value });
    });

    // Recherche en temps réel
    $tab.on("input", ".rel-search-input", function () {
        const q = this.value.trim().toLowerCase();
        $tab.find(".rel-search-clear").toggle(!!q);
        let visible = 0;
        $tab.find(".rel-row").each(function () {
            const match = !q || $(this).find(".rel-name").text().toLowerCase().includes(q);
            $(this).toggle(match);
            if (match) visible++;
        });
        // Message "aucun résultat" si des lignes existent mais aucune ne correspond
        $tab.find(".rel-no-results").remove();
        if (q && $tab.find(".rel-row").length && !visible) {
            $tab.find(".rel-list").append(
                `<div class="rel-no-results rel-empty">
                    <i class="fas fa-search"></i>
                    <span>Aucune relation trouvée.</span>
                </div>`
            );
        }
    });

    $tab.on("click", ".rel-search-clear", function (e) {
        e.stopPropagation();
        $tab.find(".rel-search-input").val("").trigger("input");
    });
}

// ---- Détection automatique (GM only) -----------------------

async function scanVisibleTokens() {
    if (!game.settings.get(MOD, "relationsEnabled")) return;
    if (game.user.isGM) return;  // scan côté joueur uniquement
    if (_scanning) return;
    _scanning = true;

    try {
        const tokens    = canvas.tokens?.placeables ?? [];
        const sceneName = game.scenes.current?.name ?? "";

        // Token du joueur présent sur la scène (cherche parmi ses acteurs PJ)
        // Logique inversée : token d'abord → acteur ensuite, pour gérer les WM multi-persos
        const myToken = tokens.find(t =>
            t.actor?.type === "character" &&
            t.actor?.isOwner &&
            isInPJFolder(t.actor)
        );
        if (!myToken) return;
        const myActor = myToken.actor;

        const existing = new Set(relList(myActor).map(r => r.targetId));

        // Tokens présents sur la scène (PJ = character dans dossier PJ, PNJ = dossier PNJ)
        const toAdd = tokens.filter(t =>
            t.actor?.id &&
            t.actor.id !== myActor.id &&
            ((isInPJFolder(t.actor) && t.actor.type === "character") || isInPNJFolder(t.actor)) &&
            !existing.has(t.actor.id) &&
            !(t.actor.getFlag(MOD, "excludedFromRelations") ?? false)
        );

        if (!toAdd.length) return;

        const newRels = toAdd.map(t => ({
            id:           foundry.utils.randomID(12),
            targetId:     t.actor.id,
            targetName:   t.actor.name,
            targetImg:    t.actor.img ?? "",
            type:         "",
            level:        0,
            note:         "",
            lastPosition: sceneName,
            secret:       false,
            revealed:     !(t.actor.getFlag(MOD, "anonymous") ?? false),
        }));

        await myActor.setFlag(MOD, "relationsList", [...relList(myActor), ...newRels]);
    } finally {
        _scanning = false;
    }
}

// ---- Anonymisation (GM only) --------------------------------

// PJs présents sur la scène active (party courante)
function currentScenePJs() {
    return (canvas.tokens?.placeables ?? [])
        .filter(t => t.actor?.type === "character" && t.actor.id)
        .map(t => t.actor)
        .filter((a, i, arr) => arr.findIndex(b => b.id === a.id) === i);
}

// Révèle nom + portrait aux PJs de la scène qui ont déjà cet acteur dans leurs relations
async function revealRelationsToParty(actorId) {
    if (!game.user.isGM) return;
    for (const pj of currentScenePJs()) {
        const list = relList(pj);
        if (!list.some(r => r.targetId === actorId)) continue;
        await pj.update({ [`flags.${MOD}.relationsList`]: list.map(r =>
            r.targetId === actorId ? { ...r, revealed: true } : r
        )});
    }
}

// Masque nom + portrait pour les PJs de la scène qui ont cet acteur dans leurs relations
async function anonymizeRelations(actorId) {
    if (!game.user.isGM) return;
    for (const pj of currentScenePJs()) {
        const list = relList(pj);
        if (!list.some(r => r.targetId === actorId)) continue;
        await pj.update({ [`flags.${MOD}.relationsList`]: list.map(r =>
            r.targetId === actorId ? { ...r, revealed: false } : r
        )});
    }
}

// Retire définitivement cet acteur de TOUTES les listes de relations (tous les acteurs du monde)
async function removeFromAllRelations(actorId) {
    if (!game.user.isGM) return;
    for (const actor of game.actors ?? []) {
        const list = relList(actor);
        if (!list.some(r => r.targetId === actorId)) continue;
        await actor.setFlag(MOD, "relationsList", list.filter(r => r.targetId !== actorId));
    }
}

// ---- Export ------------------------------------------------

export function RelationsHooks() {
    // Scan initial — sight déjà calculé au moment de canvasReady
    Hooks.on("canvasReady", () => scanVisibleTokens());
    // sightRefresh couvre les scènes avec vision active
    Hooks.on("sightRefresh", () => {
        clearTimeout(_sightTimer);
        _sightTimer = setTimeout(() => scanVisibleTokens(), 500);
    });
    // createToken couvre les scènes sans vision (sightRefresh ne tire pas)
    Hooks.on("createToken", () => {
        clearTimeout(_sightTimer);
        _sightTimer = setTimeout(() => scanVisibleTokens(), 300);
    });

    // Boutons en-tête : Anonyme, Révéler, Retirer (Relations + Bestiaire) — GM uniquement
    Hooks.on("renderApplicationV2", (app, element) => {
        if (!game.user.isGM) return;
        if (!app.document || !(app.document instanceof Actor)) return;
        const actor = app.document;
        const header = element.querySelector(".window-header");
        if (!header || header.querySelector(".scwm-exclude-btn")) return;
        const id = actor.id;

        // ── Toggle "Anonyme" ──────────────────────────────────────
        const isAnon = () => !!(actor.getFlag(MOD, "anonymous") ?? false);
        const btnAnon = document.createElement("button");
        btnAnon.type = "button";
        btnAnon.classList.add("header-control", "icon", "fa-solid", "fa-eye-slash", "scwm-anon-btn");
        const refreshAnon = () => {
            btnAnon.style.color     = isAnon() ? "#e74c3c" : "";
            btnAnon.dataset.tooltip = isAnon() ? "Anonyme — cliquer pour désactiver" : "Rendre anonyme";
        };
        refreshAnon();
        btnAnon.addEventListener("click", async () => {
            await actor.setFlag(MOD, "anonymous", !isAnon());
            refreshAnon();
        });

        // ── Bouton "Révéler à la party" ───────────────────────────
        const btnReveal = document.createElement("button");
        btnReveal.type = "button";
        btnReveal.classList.add("header-control", "icon", "fa-solid", "fa-eye", "scwm-reveal-btn");
        btnReveal.dataset.tooltip = "Révéler à la party";
        btnReveal.addEventListener("click", () => Hooks.callAll("scwm:revealToParty", id));

        // ── Toggle "Retirer des Relations ET du Bestiaire" ────────
        // Un seul bouton gère les deux flags + les deux suppressions
        const isExcluded = () =>
            !!(actor.getFlag(MOD, "excludedFromRelations") ?? false) ||
            !!(actor.getFlag(MOD,  "excludedFromBestiary")  ?? false);
        const btnExclude = document.createElement("button");
        btnExclude.type = "button";
        btnExclude.classList.add("header-control", "icon", "fa-solid", "fa-ban", "scwm-exclude-btn");
        const refreshExclude = () => {
            btnExclude.style.color     = isExcluded() ? "#e74c3c" : "";
            btnExclude.dataset.tooltip = isExcluded()
                ? "Exclu Relations & Bestiaire — cliquer pour réactiver"
                : "Retirer des Relations & du Bestiaire";
        };
        refreshExclude();
        btnExclude.addEventListener("click", async () => {
            const nowExcluded = !isExcluded();
            await actor.setFlag(MOD, "excludedFromRelations", nowExcluded);
            await actor.setFlag(MOD,  "excludedFromBestiary",  nowExcluded);
            if (nowExcluded) {
                Hooks.callAll("scwm:removeFromRelations", id);
                Hooks.callAll("scwm:removeFromBestiary",  id);
            }
            refreshExclude();
        });

        // Position : ordre visuel Exclu | Révéler | Anonyme
        const title = header.querySelector(".window-title");
        if (title) {
            title.insertAdjacentElement("afterend", btnAnon);
            title.insertAdjacentElement("afterend", btnReveal);
            title.insertAdjacentElement("afterend", btnExclude);
        } else {
            const close = header.querySelector(".close");
            header.insertBefore(btnAnon,    close);
            header.insertBefore(btnReveal,  btnAnon);
            header.insertBefore(btnExclude, btnReveal);
        }
    });

    // Répondre aux hooks inter-modules
    Hooks.on("scwm:revealToParty",       actorId => revealRelationsToParty(actorId));
    Hooks.on("scwm:anonymize",           actorId => anonymizeRelations(actorId));
    Hooks.on("scwm:removeFromRelations", actorId => removeFromAllRelations(actorId));
}
