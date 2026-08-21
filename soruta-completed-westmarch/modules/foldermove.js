import { MOD } from "./const.js";
// ============================================================
// foldermove.js — Déplacement et duplication via le clic droit
// du sidebar Foundry VTT.
//
// Hooks corrects (v13, découverts par inspection de
// DocumentDirectory._createContextMenus) :
//  - Entrées : get${documentName}ContextOptions
//      → getSceneContextOptions, getActorContextOptions,
//        getItemContextOptions, getJournalEntryContextOptions
//  - Dossiers : getFolderContextOptions (tous types confondus,
//    on filtre par folder.type dans le callback)
//
// Ajoute "Déplacer vers…" et "Dupliquer vers…" sur les
// documents, et "Déplacer vers…" sur les dossiers. GM only.
// © 2026 Soruta — Tous droits réservés. Usage personnel autorisé. Redistribution et modification interdites.
// ============================================================

const FM_ENTRIES = [
    { hook: "getSceneContextOptions",        collection: () => game.scenes,  folderType: "Scene",        label: "Scènes"   },
    { hook: "getActorContextOptions",        collection: () => game.actors,  folderType: "Actor",        label: "Acteurs"  },
    { hook: "getItemContextOptions",         collection: () => game.items,   folderType: "Item",         label: "Objets"   },
    { hook: "getJournalEntryContextOptions", collection: () => game.journal, folderType: "JournalEntry", label: "Journaux" },
];

// ============================================================
// SECTION : Sélecteur de dossier
// ============================================================

async function openFolderPicker(folderType, title, excludeFolderId = null) {
    const uid     = `wm-fm-pick-${Date.now()}`;
    let   chosen  = false;

    // ---- Construction de l'arbre ----
    const all = game.folders
        .filter(f => f.type === folderType && f.id !== excludeFolderId)
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));

    function renderNode(folder, depth) {
        const children = all
            .filter(f => f.folder?.id === folder.id)
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
        const hasKids = children.length > 0;
        return `
            <li class="wm-fm-node" data-folder-id="${folder.id}"
                data-search-name="${folder.name.toLowerCase()}">
                <div class="wm-fm-row" style="
                    display:flex; align-items:center; gap:5px;
                    padding:5px 8px 5px ${8 + depth * 14}px;
                    border-radius:3px; user-select:none;">
                    <span class="wm-fm-toggle" style="
                        width:14px; text-align:center; font-size:9px; flex-shrink:0; color:#777;
                        ${hasKids ? "cursor:pointer;" : "visibility:hidden;"}">▶</span>
                    <span class="wm-fm-select" data-folder-id="${folder.id}" style="
                        display:flex; align-items:center; gap:6px; flex:1; cursor:pointer;">
                        <i class="fa-solid fa-folder" style="color:#c9a84c; font-size:11px; flex-shrink:0;"></i>
                        <span style="font-size:12px;">${folder.name}</span>
                    </span>
                </div>
                ${hasKids ? `
                <ul class="wm-fm-sub" style="display:none; margin:0; padding:0; list-style:none;">
                    ${children.map(c => renderNode(c, depth + 1)).join("")}
                </ul>` : ""}
            </li>`;
    }

    const roots    = all.filter(f => !f.folder)
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
    const treeHtml = roots.map(f => renderNode(f, 0)).join("");

    const content = `
        <div id="${uid}" style="display:flex; flex-direction:column; gap:8px;">
            <input class="wm-fm-search" type="text" placeholder="🔍 Rechercher un dossier…"
                style="width:100%; box-sizing:border-box; padding:5px 8px;
                       border:1px solid #555; border-radius:4px;
                       background:#111; color:#ddd; font-size:12px;">
            <div style="border:1px solid #444; border-radius:4px;
                        background:#1a1a1a; max-height:320px; overflow-y:auto;">
                <ul style="margin:0; padding:0; list-style:none;">
                    <li class="wm-fm-node" data-folder-id="" data-search-name="racine">
                        <div class="wm-fm-row" style="
                            display:flex; align-items:center; gap:5px; padding:5px 8px;
                            border-radius:3px; border-bottom:1px solid #2a2a2a; user-select:none;">
                            <span style="width:14px; flex-shrink:0;"></span>
                            <span class="wm-fm-select" data-folder-id="" style="
                                display:flex; align-items:center; gap:6px; flex:1; cursor:pointer;">
                                <i class="fa-solid fa-layer-group" style="color:#777; font-size:11px; flex-shrink:0;"></i>
                                <span style="font-size:12px; color:#999; font-style:italic;">Racine (sans dossier)</span>
                            </span>
                        </div>
                    </li>
                    ${treeHtml}
                </ul>
            </div>
            <div style="font-size:11px; color:#666; font-style:italic;">
                Cliquez sur un nom pour sélectionner · ▶ pour déplier
            </div>
        </div>`;

    await (foundry.applications.api.DialogV2 ?? DialogV2).wait({
        window: { title, resizable: false },
        position: { width: 370 },
        content,
        rejectClose: false,
        render: () => {
            const container = document.getElementById(uid);
            if (!container) return;
            const $c = $(container);

            // ---- Déplier / replier ----
            $c.find(".wm-fm-toggle").on("click", function(ev) {
                ev.stopPropagation();
                const $node = $(this).closest(".wm-fm-node");
                const $sub  = $node.children(".wm-fm-sub");
                const open  = $sub.is(":visible");
                $sub.slideToggle(120);
                $(this).css("transform", open ? "" : "rotate(90deg)")
                       .css("transition", "transform 0.15s");
            });

            // ---- Sélectionner + confirmer ----
            $c.find(".wm-fm-select")
                .on("mouseenter", function() { $(this).closest(".wm-fm-row").css("background", "rgba(255,255,255,0.06)"); })
                .on("mouseleave", function() { $(this).closest(".wm-fm-row").css("background", ""); })
                .on("click", function() {
                    const raw = $(this).data("folder-id");
                    chosen = (raw === "" || raw === undefined) ? null : raw;
                    $c.closest(".application, form")
                        .find("[data-action='confirm']").trigger("click");
                });

            // ---- Recherche ----
            $c.find(".wm-fm-search").on("input", function() {
                const q = this.value.trim().toLowerCase();
                if (!q) {
                    $c.find(".wm-fm-node").show();
                    $c.find(".wm-fm-sub").hide();
                    $c.find(".wm-fm-toggle").css("transform", "");
                    return;
                }
                $c.find(".wm-fm-node").hide();
                $c.find(".wm-fm-sub").show();
                $c.find(".wm-fm-node").each(function() {
                    const name = $(this).data("search-name") ?? "";
                    if (name.includes(q)) {
                        $(this).show();
                        $(this).parents(".wm-fm-node").show();
                    }
                });
                // La racine reste toujours visible
                $c.find('.wm-fm-node[data-folder-id=""]').show();
            });

            // Focus auto sur la recherche
            setTimeout(() => $c.find(".wm-fm-search").focus(), 60);
        },
        buttons: [
            { action: "confirm", label: "Confirmer", icon: '<i class="fa-solid fa-check"></i>', default: true, callback: () => {} },
            { action: "cancel",  label: "Annuler",   icon: '<i class="fa-solid fa-times"></i>', callback: () => { chosen = false; } },
        ]
    });

    return chosen;
}

// ============================================================
// SECTION : Hooks
// ============================================================

export function FolderMoveHooks() {

    // ---- Entrées (documents) ----
    for (const { hook, collection, folderType, label } of FM_ENTRIES) {
        Hooks.on(hook, (app, options) => {
            if (!game.settings.get(MOD, "enableFolderMove")) return;
            if (!game.user.isGM) return;

            options.push(
                {
                    name: "Déplacer vers…",
                    icon: '<i class="fa-solid fa-folder-open"></i>',
                    callback: async (li) => {
                        try {
                            const el    = (li instanceof HTMLElement) ? li : li?.[0];
                            const docId = el?.dataset?.entryId ?? el?.dataset?.documentId
                                       ?? $(li).attr("data-entry-id") ?? $(li).attr("data-document-id");
                            const doc   = collection().get(docId);
                            if (!doc) { console.warn("[FM] doc introuvable — docId:", docId); return; }
                            const folderId = await openFolderPicker(folderType, `Déplacer — ${doc.name}`);
                            if (folderId === false) return;
                            await doc.update({ folder: folderId });
                        } catch(e) {
                            console.error("[FM] Erreur déplacement doc :", e);
                            ui.notifications.error(`Foldermove : ${e.message}`);
                        }
                    }
                },
                {
                    name: "Dupliquer vers…",
                    icon: '<i class="fa-solid fa-copy"></i>',
                    callback: async (li) => {
                        try {
                            const el    = (li instanceof HTMLElement) ? li : li?.[0];
                            const docId = el?.dataset?.entryId ?? el?.dataset?.documentId
                                       ?? $(li).attr("data-entry-id") ?? $(li).attr("data-document-id");
                            const doc   = collection().get(docId);
                            if (!doc) { console.warn("[FM] doc introuvable — docId:", docId); return; }
                            const folderId = await openFolderPicker(folderType, `Dupliquer — ${doc.name}`);
                            if (folderId === false) return;
                            await doc.clone({ folder: folderId }, { save: true });
                        } catch(e) {
                            console.error("[FM] Erreur duplication doc :", e);
                            ui.notifications.error(`Foldermove : ${e.message}`);
                        }
                    }
                }
            );
        });
    }

    // ---- Dossiers (hook commun à tous les types) ----
    Hooks.on("getFolderContextOptions", (app, options) => {
        if (!game.settings.get(MOD, "enableFolderMove")) return;
        if (!game.user.isGM) return;

        options.push({
            name: "Déplacer vers…",
            icon: '<i class="fa-solid fa-folder-open"></i>',
            callback: async (li) => {
                try {
                    // En v13 le callback reçoit le <header> interne du dossier,
                    // pas le <li> — on remonte au parent portant data-folder-id.
                    const el      = (li instanceof HTMLElement) ? li : li?.[0];
                    const holder  = el?.closest?.("[data-folder-id]") ?? el;
                    const fId     = holder?.dataset?.folderId
                                 ?? holder?.dataset?.entryId
                                 ?? $(li).closest("[data-folder-id]").attr("data-folder-id");
                    const folder = game.folders.get(fId);
                    if (!folder) {
                        console.warn("[FM] dossier introuvable — fId:", fId, "holder:", holder);
                        return;
                    }
                    const destId = await openFolderPicker(folder.type, `Déplacer — ${folder.name}`, fId);
                    if (destId === false) return;
                    await folder.update({ folder: destId });
                } catch(e) {
                    console.error("[FM] Erreur déplacement dossier :", e);
                    ui.notifications.error(`Foldermove : ${e.message}`);
                }
            }
        });
    });
}
