// ============================================================
// bestiary.js — Bestiaire personnel par personnage
//
// Stockage : flag scope MOD → "list" sur chaque acteur PJ
//            [ { id, targetId, targetName, targetImg,
//                hostility(-2→+2), note, firstScene } ]
// Interface : onglet "Bestiaire" sur la fiche personnage (PJ uniquement)
// Auto-det. : canvasReady / createToken / updateToken (GM only)
//             → acteurs du dossier "Creatures" (et sous-dossiers)
// © 2026 Soruta — Tous droits réservés. Usage personnel autorisé. Redistribution et modification interdites.
// ============================================================

import { MOD } from "./const.js";
export const MODULE = MOD;

// ---- État de session ---------------------------------------

const _expanded  = new Set();   // IDs d'entrées dont les notes sont ouvertes
let   _noteTimer = null;        // Debounce auto-save notes
let   _scanning  = false;       // Guard anti-doublon scan
let   _sightTimer = null;       // Debounce sightRefresh

// ---- Niveaux d'hostilité (-2 → +2) -------------------------

const HOSTILITY_CFG = {
    "-2": { icon: "fa-skull",              color: "#8b0000", label: "Très hostile" },
    "-1": { icon: "fa-fire",               color: "#e74c3c", label: "Hostile"      },
     "0": { icon: "fa-question",           color: "#888888", label: "Inconnue"     },
     "1": { icon: "fa-eye",                color: "#a8d5a2", label: "Observée"     },
     "2": { icon: "fa-handshake",          color: "#27ae60", label: "Amicale"      },
};

function hostilityIcon(h) {
    const cfg = HOSTILITY_CFG[String(h ?? 0)] ?? HOSTILITY_CFG["0"];
    return `<i class="fas ${cfg.icon}" style="color:${cfg.color};" title="${cfg.label}"></i>`;
}

function hostilitySelector(current, canEdit) {
    const cur = HOSTILITY_CFG[String(current ?? 0)] ?? HOSTILITY_CFG["0"];
    if (!canEdit) return `<div class="bst-hostility">${hostilityIcon(current)}</div>`;
    const btns = Object.entries(HOSTILITY_CFG)
        .sort(([a],[b]) => parseInt(a) - parseInt(b))
        .map(([h, cfg]) => {
            const active = parseInt(h) === (current ?? 0);
            const col    = active ? `style="color:${cfg.color};"` : "";
            return `<a class="bst-h-btn${active ? " active" : ""}" data-hostility="${h}" title="${cfg.label}">
                <i class="fas ${cfg.icon}" ${col}></i>
            </a>`;
        }).join("");
    return `<div class="bst-hostility-selector">
        <span class="bst-h-label" style="color:${cur.color};">${cur.label}</span>
        ${btns}
    </div>`;
}

// ---- CRUD --------------------------------------------------

function beastList(actor) {
    return actor.getFlag(MOD, "bestiaryList") ?? [];
}

async function beastSave(actor, list) {
    await actor.update({ [`flags.${MOD}.bestiaryList`]: list }, { render: false });
}

async function beastUpdate(actor, id, patch) {
    await beastSave(actor, beastList(actor).map(e => e.id === id ? { ...e, ...patch } : e));
}

async function beastDelete(actor, id) {
    await beastSave(actor, beastList(actor).filter(e => e.id !== id));
}

// ---- Helpers dossiers --------------------------------------

function isInFolder(actor, folderId) {
    if (!folderId) return false;
    let f = actor.folder;
    while (f) {
        if (f.id === folderId) return true;
        f = f.folder;
    }
    return false;
}
function isInPJFolder(actor) { return isInFolder(actor, game.settings.get(MOD, "bestiaryFolderPJ")); }

// Créatures disponibles pour ajout manuel (compendium en priorité, sinon dossier monde)
async function availableCreatures(actor) {
    const existing = new Set(beastList(actor).map(e => e.targetId));
    const packId   = game.settings.get(MOD, "bestiaryPackCreatures");
    if (packId) {
        const pack = game.packs.get(packId);
        if (pack) {
            const docs = await pack.getDocuments();
            return docs
                .filter(a => !existing.has(a.id))
                .sort((a, b) => a.name.localeCompare(b.name));
        }
    }
    // Fallback : dossier monde (legacy)
    const folderId = game.settings.get(MOD, "bestiaryFolderCreatures");
    return game.actors
        .filter(a => isInFolder(a, folderId) && !existing.has(a.id))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// Retourne true si le token est une créature (compendium ou dossier monde)
function isCreatureToken(token) {
    if (!token.actor?.id) return false;
    // Tokens non-liés issus du compendium → actor.pack est renseigné
    const packId = game.settings.get(MOD, "bestiaryPackCreatures");
    if (packId && token.actor.pack === packId) return true;
    // Fallback : acteurs monde dans le dossier creatures (legacy)
    const folderId = game.settings.get(MOD, "bestiaryFolderCreatures");
    if (folderId && isInFolder(token.actor, folderId)) return true;
    return false;
}

// ---- HTML onglet -------------------------------------------

function emptyStateHtml() {
    return `<div class="bst-empty">
        <i class="fas fa-dragon"></i>
        <span>Aucune créature répertoriée.</span>
    </div>`;
}

function buildRowHtml(entry, actor, canEdit) {
    const target   = game.actors.get(entry.targetId);
    const revealed = entry.revealed ?? true;
    const img      = target?.img  ?? entry.targetImg  ?? "icons/svg/mystery-man.svg";
    const name     = revealed ? (target?.name ?? entry.targetName ?? "Inconnue") : "Inconnue";
    const open   = _expanded.has(entry.id);

    return `
    <div class="bst-row" data-bst-id="${entry.id}">
        <div class="bst-row-header">
            <img class="bst-avatar" src="${img}" alt="${name}">
            <span class="bst-name">${name}</span>
            ${hostilitySelector(entry.hostility ?? 0, canEdit)}
            <div class="bst-btns">
                ${game.user.isGM && target ? `<a class="bst-open-sheet" data-target-id="${entry.targetId}" title="Ouvrir la fiche"><i class="fas fa-external-link-alt"></i></a>` : ""}
                <a class="bst-toggle" title="Notes"><i class="fas fa-chevron-${open ? "up" : "down"}"></i></a>
                ${canEdit ? `<a class="bst-delete" title="Retirer du bestiaire"><i class="fas fa-trash"></i></a>` : ""}
            </div>
        </div>
        <div class="bst-notes"${open ? "" : ' style="display:none;"'}>
            <div class="bst-scene-row">
                <i class="fas fa-map-marker-alt"></i>
                <span class="bst-field-label">Première rencontre :</span>
                ${canEdit
                    ? `<input class="bst-scene-input" type="text" data-bst-id="${entry.id}"
                           value="${entry.firstScene ?? ""}" placeholder="Scène, lieu…">`
                    : `<span class="bst-scene-value">${entry.firstScene || "<em>Inconnue</em>"}</span>`
                }
            </div>
            ${canEdit ? `
            <textarea class="bst-note-input" data-bst-id="${entry.id}"
                placeholder="Notes sur cette créature…">${entry.note ?? ""}</textarea>
            ` : `
            <p class="bst-note-ro">${entry.note || "<em>Aucune note.</em>"}</p>
            `}
        </div>
    </div>`;
}

export function buildTabHtml(actor) {
    const isGM    = game.user.isGM;
    const canEdit = isGM || actor.isOwner;

    // Tri : plus hostile en premier, puis alphabétique
    const list = beastList(actor).slice().sort((a, b) => {
        const hDiff = (a.hostility ?? 0) - (b.hostility ?? 0);
        return hDiff !== 0 ? hDiff : (a.targetName ?? "").localeCompare(b.targetName ?? "");
    });

    // Styles inline — contournement cache CSS Foundry
    const S = {
        titleBar:  `display:flex;align-items:center;justify-content:space-between;padding:8px 12px 6px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.07);`,
        title:     `display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#ccc;`,
        addBtn:    `display:flex;align-items:center;gap:5px;padding:3px 9px;` +
                   `background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:4px;` +
                   `color:#aaa;font-size:11px;cursor:pointer;white-space:nowrap;transition:background 0.12s,color 0.12s;`,
        searchBar: `display:flex;align-items:center;gap:6px;padding:5px 10px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.06);`,
        wrap:      `flex:1;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:4px 8px;`,
        srchIcon:  `color:#555;font-size:11px;flex-shrink:0;`,
        srchInput: `flex:1;background:transparent;border:none;box-shadow:none;outline:none;color:#bbb;font-size:11px;padding:0;min-width:0;font-family:inherit;`,
        clear:     `display:none;color:#444;font-size:10px;cursor:pointer;padding:2px 3px;`,
    };

    const rows = list.map(e => buildRowHtml(e, actor, canEdit)).join("");

    return `
    <div class="bst-tab" data-actor-id="${actor.id}">
        <div style="${S.titleBar}">
            <span style="${S.title}">
                <i class="fas fa-dragon" style="color:#e07b39;font-size:11px;"></i>
                Bestiaire
            </span>
            ${isGM ? `<a class="bst-add-btn" style="${S.addBtn}">
                <i class="fas fa-plus" style="font-size:10px;"></i> Ajouter
            </a>` : ""}
        </div>
        <div style="${S.searchBar}">
            <div class="bst-search-wrap" style="${S.wrap}">
                <i class="fas fa-search" style="${S.srchIcon}"></i>
                <input class="bst-search-input" type="text"
                    placeholder="Rechercher une créature…" style="${S.srchInput}">
                <a class="bst-search-clear" style="${S.clear}" title="Effacer">
                    <i class="fas fa-times"></i>
                </a>
            </div>
        </div>
        <div class="bst-list">
            ${rows || emptyStateHtml()}
        </div>
    </div>`;
}

// ---- Dialog ajout manuel (GM only) -------------------------

function buildCreaturePickerHtml(creatures, uid) {
    const rows = creatures.map(a => `
        <div class="bst-picker-actor" data-actor-id="${a.id}" data-name="${a.name.toLowerCase()}">
            <img src="${a.img ?? "icons/svg/mystery-man.svg"}" alt="${a.name}">
            <span>${a.name}</span>
        </div>`).join("");

    return `
    <div id="${uid}" style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
        <input class="bst-picker-search" type="text" placeholder="🔍 Rechercher une créature…"
            style="width:100%;box-sizing:border-box;padding:5px 8px;
                   border:1px solid #555;border-radius:4px;background:#111;color:#ddd;font-size:12px;">
        <div class="bst-picker-list" style="max-height:280px;overflow-y:auto;">
            ${rows || `<p style="color:#666;font-style:italic;font-size:12px;text-align:center;padding:12px 0;">
                Aucune créature disponible.</p>`}
        </div>
    </div>`;
}

async function openAddDialog(actor) {
    const uid       = `bst-add-${Date.now()}`;
    const creatures = await availableCreatures(actor);
    // Index par ID pour retrouver nom/img dans le callback de confirmation
    const creaturesById = new Map(creatures.map(c => [c.id, c]));
    let selectedId  = null;
    let result      = null;

    await foundry.applications.api.DialogV2.wait({
        window:      { title: "Ajouter au bestiaire" },
        position:    { width: 360 },
        rejectClose: false,
        content:     buildCreaturePickerHtml(creatures, uid),
        render: () => {
            const d = document.getElementById(uid);
            if (!d) return;

            // Sélection d'une créature
            d.querySelectorAll(".bst-picker-actor").forEach(el => {
                el.addEventListener("click", () => {
                    d.querySelectorAll(".bst-picker-actor").forEach(e => e.classList.remove("selected"));
                    el.classList.add("selected");
                    selectedId = el.dataset.actorId;
                });
            });

            // Recherche en temps réel
            d.querySelector(".bst-picker-search")?.addEventListener("input", function () {
                const q = this.value.trim().toLowerCase();
                d.querySelectorAll(".bst-picker-actor").forEach(el => {
                    el.style.display = (!q || el.dataset.name.includes(q)) ? "" : "none";
                });
            });

            setTimeout(() => d.querySelector(".bst-picker-search")?.focus(), 60);
        },
        buttons: [
            {
                action: "confirm", default: true,
                label: "Ajouter", icon: '<i class="fas fa-check"></i>',
                callback: () => {
                    if (!selectedId) return;
                    // Acteur monde ou acteur compendium (retrouvé via l'index du dialog)
                    const target = game.actors.get(selectedId) ?? creaturesById.get(selectedId);
                    result = {
                        targetId:   selectedId,
                        targetName: target?.name ?? "Inconnue",
                        targetImg:  target?.img  ?? "",
                        hostility:  0,
                        note:       "",
                        firstScene: game.scenes.current?.name ?? "",
                        revealed:   !(target?.getFlag?.(MOD, "anonymous") ?? false),
                    };
                }
            },
            { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>', callback: () => {} }
        ]
    });

    return result;
}

// ---- Événements de l'onglet --------------------------------

function _autoResize(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
}

export function wireTab(actor, $html) {
    const $tab = $html.find(".bst-tab");
    if (!$tab.length) return;

    // Resize textareas déjà visibles (sections ouvertes depuis _expanded)
    $tab.find(".bst-note-input").each((_, el) => _autoResize(el));

    // Clic sur la ligne → ouvrir le portrait
    $tab.on("click", ".bst-row-header", function (e) {
        if ($(e.target).closest("a, input, .bst-h-btn, .bst-btns").length) return;
        const bstId  = String($(this).closest(".bst-row").data("bst-id"));
        const entry  = beastList(actor).find(en => en.id === bstId);
        if (!entry) return;
        const target = game.actors.get(entry.targetId);
        const img    = target?.img  ?? entry.targetImg  ?? "icons/svg/mystery-man.svg";
        const name   = target?.name ?? entry.targetName ?? "Inconnue";
        new ImagePopout(img, { title: name }).render(true);
    });

    // Ajouter manuellement (GM uniquement)
    $tab.on("click", ".bst-add-btn", async () => {
        const data = await openAddDialog(actor);
        if (!data) return;
        const list = beastList(actor);
        if (list.some(e => e.targetId === data.targetId)) return; // doublon
        const entry = { id: foundry.utils.randomID(12), ...data };
        await beastSave(actor, [...list, entry]);
        $tab.find(".bst-empty").remove();
        $tab.find(".bst-list").append(buildRowHtml(entry, actor, true));
    });

    // Déplier / replier notes
    $tab.on("click", ".bst-toggle", function () {
        const $row   = $(this).closest(".bst-row");
        const id     = String($row.data("bst-id"));
        const $notes = $row.find(".bst-notes");
        const $icon  = $(this).find("i");
        if ($notes.is(":visible")) {
            _expanded.delete(id);
            $notes.slideUp(150);
            $icon.removeClass("fa-chevron-up").addClass("fa-chevron-down");
        } else {
            _expanded.add(id);
            $notes.slideDown(150, function () {
                $(this).find(".bst-note-input").each((_, el) => _autoResize(el));
            });
            $icon.removeClass("fa-chevron-down").addClass("fa-chevron-up");
        }
    });

    // Changer l'hostilité (optimiste)
    $tab.on("click", ".bst-h-btn", async function () {
        const $btn = $(this);
        const id   = String($btn.closest(".bst-row").data("bst-id"));
        const h    = parseInt($btn.data("hostility"));
        const cfg  = HOSTILITY_CFG[String(h)];
        const $sel = $btn.closest(".bst-hostility-selector");
        $sel.find(".bst-h-btn").removeClass("active").find("i").css("color", "");
        $btn.addClass("active").find("i").css("color", cfg.color);
        $sel.find(".bst-h-label").text(cfg.label).css("color", cfg.color);
        await beastUpdate(actor, id, { hostility: h });
    });

    // Ouvrir la fiche de la créature (GM uniquement)
    $tab.on("click", ".bst-open-sheet", function (e) {
        e.stopPropagation();
        const targetId = $(this).data("target-id");
        game.actors.get(String(targetId))?.sheet?.render(true);
    });

    // Supprimer avec confirmation
    $tab.on("click", ".bst-delete", async function () {
        const $row  = $(this).closest(".bst-row");
        const id    = String($row.data("bst-id"));
        const entry = beastList(actor).find(e => e.id === id);
        if (!entry) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Retirer du bestiaire" },
            content: `<p>Retirer <strong>${entry.targetName}</strong> du bestiaire ?<br>
                      <small style="color:#999;">Cette action est irréversible.</small></p>`,
        });
        if (!ok) return;
        _expanded.delete(id);
        $row.remove();
        await beastDelete(actor, id);
        if (!$tab.find(".bst-row").length) {
            $tab.find(".bst-list").html(emptyStateHtml());
        }
    });

    // Auto-save première rencontre
    $tab.on("blur", ".bst-scene-input", async function () {
        await beastUpdate(actor, String($(this).data("bst-id")), { firstScene: this.value.trim() });
    });

    // Auto-save note (debounce + blur immédiat)
    $tab.on("input", ".bst-note-input", function () {
        _autoResize(this);
        clearTimeout(_noteTimer);
        const id  = String($(this).data("bst-id"));
        const val = this.value;
        _noteTimer = setTimeout(() => beastUpdate(actor, id, { note: val }), 1200);
    });
    $tab.on("blur", ".bst-note-input", async function () {
        clearTimeout(_noteTimer);
        await beastUpdate(actor, String($(this).data("bst-id")), { note: this.value });
    });

    // Recherche en temps réel
    $tab.on("input", ".bst-search-input", function () {
        const q = this.value.trim().toLowerCase();
        $tab.find(".bst-search-clear").toggle(!!q);
        let visible = 0;
        $tab.find(".bst-row").each(function () {
            const match = !q || $(this).find(".bst-name").text().toLowerCase().includes(q);
            $(this).toggle(match);
            if (match) visible++;
        });
        $tab.find(".bst-no-results").remove();
        if (q && $tab.find(".bst-row").length && !visible) {
            $tab.find(".bst-list").append(
                `<div class="bst-no-results bst-empty">
                    <i class="fas fa-search"></i>
                    <span>Aucune créature trouvée.</span>
                </div>`
            );
        }
    });

    $tab.on("click", ".bst-search-clear", function (e) {
        e.stopPropagation();
        $tab.find(".bst-search-input").val("").trigger("input");
    });
}

// ---- Détection automatique (GM only) -----------------------

async function scanVisibleTokens() {
    if (!game.settings.get(MOD, "bestiaryEnabled")) return;
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

        const existing = new Set(beastList(myActor).map(e => e.targetId));

        // Créatures présentes sur la scène (compendium ou dossier monde)
        // seenIds déduplique les tokens qui partagent le même acteur de base (ex: 5 Knights)
        const seenIds = new Set();
        const toAdd = tokens.filter(t => {
            if (!t.actor?.id) return false;
            if (t.actor.id === myActor.id) return false;
            if (!isCreatureToken(t)) return false;
            if (existing.has(t.actor.id)) return false;
            if (seenIds.has(t.actor.id)) return false;
            if (t.actor.getFlag(MOD, "excludedFromBestiary") ?? false) return false;
            seenIds.add(t.actor.id);
            return true;
        });

        if (!toAdd.length) return;

        const newEntries = toAdd.map(t => ({
            id:         foundry.utils.randomID(12),
            targetId:   t.actor.id,
            targetName: t.actor.name,
            targetImg:  t.actor.img ?? "",
            hostility:  0,
            note:       "",
            firstScene: sceneName,
            revealed:   !(t.actor.getFlag(MOD, "anonymous") ?? false),
        }));

        await myActor.update(
            { [`flags.${MOD}.bestiaryList`]: [...beastList(myActor), ...newEntries] },
            { render: false }
        );
    } finally {
        _scanning = false;
    }
}

// ---- Anonymisation (GM only) --------------------------------

function currentScenePJs() {
    return (canvas.tokens?.placeables ?? [])
        .filter(t => t.actor?.type === "character" && t.actor.id)
        .map(t => t.actor)
        .filter((a, i, arr) => arr.findIndex(b => b.id === a.id) === i);
}

async function revealBestiaryToParty(actorId) {
    if (!game.user.isGM) return;
    for (const pj of currentScenePJs()) {
        const list = beastList(pj);
        if (!list.some(e => e.targetId === actorId)) continue;
        await pj.update({ [`flags.${MOD}.bestiaryList`]: list.map(e =>
            e.targetId === actorId ? { ...e, revealed: true } : e
        )});
    }
}

async function anonymizeBestiary(actorId) {
    if (!game.user.isGM) return;
    for (const pj of currentScenePJs()) {
        const list = beastList(pj);
        if (!list.some(e => e.targetId === actorId)) continue;
        await pj.update({ [`flags.${MOD}.bestiaryList`]: list.map(e =>
            e.targetId === actorId ? { ...e, revealed: false } : e
        )});
    }
}

// Retire définitivement cet acteur de TOUS les bestiaires du monde
async function removeFromAllBestiary(actorId) {
    if (!game.user.isGM) return;
    for (const actor of game.actors ?? []) {
        const list = beastList(actor);
        if (!list.some(e => e.targetId === actorId)) continue;
        await actor.setFlag(MOD, "bestiaryList", list.filter(e => e.targetId !== actorId));
    }
}

export function BestiaryHooks() {
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

    // Boutons en-tête : Anonyme + Révéler en fallback si Relations n'est pas actif
    // (le bouton "Retirer" unifié est injecté par le module Relations)
    Hooks.on("renderApplicationV2", (app, element) => {
        if (!game.user.isGM) return;
        if (!app.document || !(app.document instanceof Actor)) return;
        const actor = app.document;
        const header = element.querySelector(".window-header");
        if (!header || header.querySelector(".ashara-reveal-btn")) return;
        const id = actor.id;

        // Relations inactif : injecter Anonyme + Révéler + bouton Exclure
        const isAnon = () => !!(actor.getFlag(MOD, "anonymous") ?? false);
        const btnAnon = document.createElement("button");
        btnAnon.type = "button";
        btnAnon.classList.add("header-control", "icon", "fa-solid", "fa-eye-slash", "ashara-anon-btn");
        const refreshAnon = () => {
            btnAnon.style.color     = isAnon() ? "#e74c3c" : "";
            btnAnon.dataset.tooltip = isAnon() ? "Anonyme — cliquer pour désactiver" : "Rendre anonyme";
        };
        refreshAnon();
        btnAnon.addEventListener("click", async () => {
            await actor.setFlag(MOD, "anonymous", !isAnon());
            refreshAnon();
        });

        const btnReveal = document.createElement("button");
        btnReveal.type = "button";
        btnReveal.classList.add("header-control", "icon", "fa-solid", "fa-eye", "ashara-reveal-btn");
        btnReveal.dataset.tooltip = "Révéler à la party";
        btnReveal.addEventListener("click", () => Hooks.callAll("ashara:revealToParty", id));

        const isExcluded = () =>
            !!(actor.getFlag(MOD, "excludedFromRelations") ?? false) ||
            !!(actor.getFlag(MOD,             "excludedFromBestiary")  ?? false);
        const btnExclude = document.createElement("button");
        btnExclude.type = "button";
        btnExclude.classList.add("header-control", "icon", "fa-solid", "fa-ban", "ashara-exclude-btn");
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
            await actor.setFlag(MOD,             "excludedFromBestiary",  nowExcluded);
            if (nowExcluded) {
                Hooks.callAll("ashara:removeFromRelations", id);
                Hooks.callAll("ashara:removeFromBestiary",  id);
            }
            refreshExclude();
        });

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

    // Répondre aux hooks (appels depuis les boutons, quel que soit le module émetteur)
    Hooks.on("ashara:revealToParty",       actorId => revealBestiaryToParty(actorId));
    Hooks.on("ashara:anonymize",           actorId => anonymizeBestiary(actorId));
    Hooks.on("ashara:removeFromBestiary",  actorId => removeFromAllBestiary(actorId));
}
