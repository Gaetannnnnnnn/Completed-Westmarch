import { MOD } from "./const.js";
// ============================================================
// polymorph.js — Transformation de token (Wild Shape / Polymorph)
// Permet au GM de configurer des "formes polymorphes" (acteurs
// existants) sur un acteur. Un bouton en bas du HUD du token
// permet de transformer le token pour qu'il représente l'acteur
// de la forme choisie, et de le rétablir d'un clic.
//
// Données stockées :
//  - flag acteur  "westmarch.polymorphForms"     : [{ actorId, label }]
//  - flag token   "westmarch.polymorphOriginal"  : { actorId, actorLink,
//                                                    name, textureSrc,
//                                                    width, height }
//
// Comportement :
//  - Le flag polymorphOriginal est posé sur le token de scène (pas sur
//    l'acteur), ce qui le rend indépendant des changements d'actorId.
//  - La sauvegarde n'écrase pas une valeur existante : si on transforme
//    à nouveau depuis une forme intermédiaire, l'état PC original est
//    conservé.
//  - Seul le propriétaire du token (ou un GM) peut voir/utiliser les
//    boutons de transformation.
//
// © 2026 Soruta — Tous droits réservés. Usage personnel autorisé. Redistribution et modification interdites.
// ============================================================

// Transforme le token vers l'acteur bête donné.
// Sauvegarde l'état original dans un flag du token de scène avant
// toute modification, de façon atomique (une seule opération update).
// Après transformation, les PV courants et max du PJ sont transférés
// sur l'acteur synthétique de la bête (instance non liée du token).
async function applyTransform(tokenDoc, beastActor) {
    const alreadySaved = !!tokenDoc.getFlag(MOD, "polymorphOriginal");
    const pt = beastActor.prototypeToken;

    // Lire les PV du PJ AVANT de changer l'actorId.
    const pcActor   = tokenDoc.actor;
    const pcHpValue = pcActor?.system?.attributes?.hp?.value ?? null;
    const pcHpMax   = pcActor?.system?.attributes?.hp?.max   ?? null;

    const updateData = {
        actorId:       beastActor.id,
        actorLink:     false,
        name:          pt?.name || beastActor.name,
        "texture.src": pt?.texture?.src || beastActor.img || "",
        width:         pt?.width  ?? 1,
        height:        pt?.height ?? 1
    };

    // Ne mémorise l'état original que s'il ne l'est pas déjà (sécurité
    // en cas de double-clic ou de re-transformation depuis la bête).
    if (!alreadySaved) {
        updateData["flags.toolkit.polymorphOriginal"] = {
            actorId:    tokenDoc.actorId,
            actorLink:  tokenDoc.actorLink,
            name:       tokenDoc.name,
            textureSrc: tokenDoc.texture?.src ?? "",
            width:      tokenDoc.width,
            height:     tokenDoc.height
        };
    }

    await tokenDoc.update(updateData);

    // Applique les PV du PJ via tokenDoc.delta (ActorDelta en v13).
    // tokenDoc.actor.update() en v13 risque de modifier le base actor dans
    // game.actors ; delta.update() cible uniquement ce token.
    if (pcHpValue !== null || pcHpMax !== null) {
        const delta = tokenDoc.delta;
        if (delta) {
            const hpUpdate = {};
            if (pcHpValue !== null) hpUpdate["system.attributes.hp.value"] = pcHpValue;
            if (pcHpMax   !== null) hpUpdate["system.attributes.hp.max"]   = pcHpMax;
            await delta.update(hpUpdate);
        }
    }
}

// Rétablit le token dans son état PC d'origine à partir du flag sauvegardé.
async function revertTransform(tokenDoc) {
    const saved = tokenDoc.getFlag(MOD, "polymorphOriginal");
    if (!saved) return;

    await tokenDoc.update({
        actorId:       saved.actorId,
        actorLink:     saved.actorLink,
        name:          saved.name,
        "texture.src": saved.textureSrc,
        width:         saved.width,
        height:        saved.height
    });
    // Supprime le flag de sauvegarde après restauration réussie.
    await tokenDoc.unsetFlag(MOD, "polymorphOriginal");
}

// Affiche le dialogue de sélection de forme et déclenche la transformation.
async function openTransformDialog(tokenDoc, forms) {
    // Filtre les formes dont l'acteur n'existe plus dans le monde.
    const valid = forms
        .map(f => ({ ...f, actor: game.actors.get(f.actorId) }))
        .filter(f => f.actor);

    if (!valid.length) {
        ui.notifications.warn("[WestMarch] Aucune forme disponible (les acteurs configurés sont introuvables).");
        return;
    }

    const optionsHtml = valid.map((f, i) => {
        const img = f.actor.prototypeToken?.texture?.src || f.actor.img || "icons/svg/mystery-man.svg";
        const label = f.label || f.actor.name;
        return `
            <label class="wm-poly-form-label" style="
                display:flex; align-items:center; gap:10px;
                padding:6px 8px; border-radius:4px; cursor:pointer;
                border:1px solid transparent; margin-bottom:4px;
            ">
                <input type="radio" name="wm-poly-form" id="wm-poly-opt-${i}" value="${i}" ${i === 0 ? "checked" : ""}>
                <img src="${img}" style="width:36px; height:36px; object-fit:cover; border-radius:4px; border:1px solid #555; flex-shrink:0;">
                <span style="font-size:13px;">${label}</span>
            </label>
        `;
    }).join("");

    const content = `<div style="padding:6px 2px;">${optionsHtml}</div>`;

    let selectedFormIndex = 0;

    await (foundry.applications.api.DialogV2 ?? DialogV2).wait({
        window: { title: "Transformation", resizable: false },
        position: { width: 340 },
        content,
        rejectClose: false,
        render: () => {
            // Ignore l'argument (type variable selon les builds v13).
            // On retrouve le conteneur via l'id du premier radio.
            const rootEl = document.getElementById("wm-poly-opt-0")
                ?.closest(".application, .dialog, form") ?? document.body;
            const $root = $(rootEl);

            // Highlight au survol
            $root.find(".wm-poly-form-label")
                .on("mouseenter", function() { $(this).css({ background: "rgba(255,255,255,0.05)", borderColor: "#666" }); })
                .on("mouseleave", function() { $(this).css({ background: "", borderColor: "transparent" }); });

            $root.find('[name="wm-poly-form"]').on("change", function() {
                selectedFormIndex = parseInt(this.value);
            });
        },
        buttons: [
            {
                action: "transform",
                label: "Transformer",
                icon: '<i class="fas fa-paw"></i>',
                default: true,
                callback: async () => {
                    const chosen = valid[selectedFormIndex];
                    if (chosen) await applyTransform(tokenDoc, chosen.actor);
                }
            },
            { action: "cancel", label: "Annuler", icon: '<i class="fas fa-times"></i>' }
        ]
    });
}

export function PolymorphHooks() {

    // ============================================================
    // SECTION : Barre de transformation en bas du HUD du token
    // ============================================================
    Hooks.on("renderTokenHUD", (hud, html, data) => {
        if (!game.settings.get(MOD, "enablePolymorph")) return;
        const token = hud.object;
        if (!token) return;
        const actor = token.actor;
        if (!actor) return;
        if (!game.user.isGM && !actor.isOwner) return;

        // Les formes sont sur l'acteur original ; le flag transformé est sur
        // le token de scène. Après transformation, actor = bête (pas de forms),
        // mais le flag polymorphOriginal est toujours lisible sur le token doc.
        const forms         = actor.getFlag(MOD, "polymorphForms") ?? [];
        const isTransformed = !!token.document.getFlag(MOD, "polymorphOriginal");

        // Rien à afficher si pas de formes configurées ET pas en cours de
        // transformation.
        if (!forms.length && !isTransformed) return;

        const buttons = [];
        if (forms.length) {
            buttons.push(`
                <div class="control-icon westmarch-poly-transform"
                    title="Transformer (Wild Shape / Polymorph)"
                    style="cursor:pointer;">
                    <i class="fas fa-paw"></i>
                </div>
            `);
        }
        if (isTransformed) {
            buttons.push(`
                <div class="control-icon westmarch-poly-revert"
                    title="Rétablir la forme originale"
                    style="cursor:pointer;">
                    <i class="fas fa-user"></i>
                </div>
            `);
        }

        // Barre positionnée en absolu sous le HUD standard.
        const bar = $(`
            <div class="westmarch-polymorph-bar" style="
                position: absolute;
                bottom: -44px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                gap: 4px;
                pointer-events: auto;
                white-space: nowrap;
                z-index: 1;
            ">
                ${buttons.join("")}
            </div>
        `);

        if (forms.length) {
            bar.find(".westmarch-poly-transform").on("click", async () => {
                await openTransformDialog(token.document, forms);
            });
        }
        if (isTransformed) {
            bar.find(".westmarch-poly-revert").on("click", async () => {
                await revertTransform(token.document);
            });
        }

        $(html).append(bar);
    });

    // ============================================================
    // SECTION : Configuration des formes dans la config du prototype token
    // GM uniquement — section ajoutée sous les sections existantes
    // ============================================================
    Hooks.on("renderPrototypeTokenConfig", (app, html, data) => {
        if (!game.settings.get(MOD, "enablePolymorph")) return;
        if (!game.user.isGM) return;

        // Compatibilité v13 : app.document?.parent (PC/NPC lié), app.actor (NPC direct).
        const actor = app.document?.parent ?? app.object?.actor ?? app.actor;
        if (!actor) return;

        const savedForms = actor.getFlag(MOD, "polymorphForms") ?? [];

        const section = $(`
            <fieldset style="margin-top:12px; border:1px solid #555; padding:8px 12px; border-radius:4px;">
                <legend style="font-weight:bold; font-size:13px;">Formes polymorphes (WestMarch)</legend>
                <div class="wm-poly-form-list" style="margin-bottom:8px;"></div>
                <div style="display:flex; gap:6px; align-items:center; margin-bottom:4px;">
                    <input type="text" class="wm-poly-search-input"
                        placeholder="Rechercher un acteur…"
                        style="flex:1; height:28px; font-size:12px; padding:0 6px;"
                        autocomplete="off">
                    <input type="text" class="wm-poly-label-input"
                        placeholder="Label (optionnel)"
                        style="width:130px; height:28px; font-size:12px; padding:0 6px;">
                    <button type="button" class="wm-poly-add-btn"
                        title="Ajouter cette forme"
                        style="height:28px; padding:0 10px; flex-shrink:0;">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <div class="wm-poly-search-results" style="
                    display:none; max-height:120px; overflow-y:auto;
                    border:1px solid #555; border-radius:3px;
                    background:#1a1a1a; margin-bottom:4px;
                "></div>
            </fieldset>
        `);

        // ---- Rendu de la liste des formes configurées ----
        const renderForms = (list) => {
            const el = section.find(".wm-poly-form-list");
            el.empty();
            if (!list.length) {
                el.append(`<div style="opacity:0.6; font-size:12px; font-style:italic; margin-bottom:4px;">Aucune forme configurée.</div>`);
                return;
            }
            list.forEach((f, i) => {
                const a = game.actors.get(f.actorId);
                const actorName = a?.name ?? `(introuvable : ${f.actorId})`;
                const displayLabel = f.label
                    ? `${f.label} <span style="opacity:0.5;">(${actorName})</span>`
                    : actorName;
                const img = a?.prototypeToken?.texture?.src || a?.img || "icons/svg/mystery-man.svg";
                const row = $(`
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                        <img src="${img}" style="width:28px; height:28px; object-fit:cover; border-radius:3px; border:1px solid #555; flex-shrink:0;">
                        <span style="flex:1; font-size:12px;">${displayLabel}</span>
                        <div class="wm-poly-remove" data-index="${i}"
                            style="cursor:pointer; color:#c55; padding:2px 6px; border-radius:3px; flex-shrink:0;"
                            title="Supprimer cette forme">
                            <i class="fas fa-trash" style="font-size:11px;"></i>
                        </div>
                    </div>
                `);
                el.append(row);
            });
        };

        renderForms(savedForms);

        // ---- Recherche d'acteur en live avec dropdown ----
        let pendingActorId = null;

        section.find(".wm-poly-search-input").on("input", function () {
            const q = this.value.trim().toLowerCase();
            pendingActorId = null;
            const resultsEl = section.find(".wm-poly-search-results");
            if (!q) { resultsEl.hide().empty(); return; }

            const matches = game.actors.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8);
            if (!matches.length) { resultsEl.hide().empty(); return; }

            resultsEl.empty();
            matches.forEach(a => {
                const thumb = a.prototypeToken?.texture?.src || a.img || "icons/svg/mystery-man.svg";
                const row = $(`
                    <div class="wm-poly-actor-result" data-id="${a.id}" style="
                        padding:4px 8px; cursor:pointer; font-size:12px;
                        border-bottom:1px solid #2a2a2a;
                        display:flex; align-items:center; gap:6px;">
                        <img src="${thumb}" style="width:20px; height:20px; object-fit:cover; border-radius:2px; flex-shrink:0;">
                        <span>${a.name}</span>
                    </div>
                `);
                row.on("mouseenter", function() { $(this).css("background", "#2a2a2a"); });
                row.on("mouseleave", function() { $(this).css("background", ""); });
                row.on("mousedown", function() {
                    // mousedown avant blur : on capture l'id avant que l'input perde le focus.
                    pendingActorId = a.id;
                    section.find(".wm-poly-search-input").val(a.name);
                    resultsEl.hide().empty();
                });
                resultsEl.append(row);
            });
            resultsEl.show();
        });

        // Ferme le dropdown quand l'input perd le focus (délai pour laisser
        // le mousedown ci-dessus s'exécuter avant).
        section.find(".wm-poly-search-input").on("blur", function() {
            setTimeout(() => section.find(".wm-poly-search-results").hide(), 200);
        });

        // ---- Ajouter une forme ----
        section.find(".wm-poly-add-btn").on("click", async () => {
            if (!pendingActorId) {
                ui.notifications.warn("[WestMarch] Sélectionnez un acteur dans la liste de suggestions.");
                return;
            }
            const label = section.find(".wm-poly-label-input").val().trim();
            const current = actor.getFlag(MOD, "polymorphForms") ?? [];
            const updated = [...current, { actorId: pendingActorId, label }];
            await actor.setFlag(MOD, "polymorphForms", updated);
            renderForms(updated);
            section.find(".wm-poly-search-input").val("");
            section.find(".wm-poly-label-input").val("");
            pendingActorId = null;
        });

        // ---- Supprimer une forme ----
        section.on("click", ".wm-poly-remove", async (ev) => {
            const index = parseInt($(ev.currentTarget).data("index"));
            const current = actor.getFlag(MOD, "polymorphForms") ?? [];
            current.splice(index, 1);
            await actor.setFlag(MOD, "polymorphForms", [...current]);
            renderForms(current);
        });

        const tab = $(html).find(".tab[data-tab='appearance']");
        (tab.length ? tab : $(html)).append(section);
    });
}
