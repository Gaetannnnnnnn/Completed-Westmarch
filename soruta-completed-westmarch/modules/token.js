import { MOD } from "./const.js";
// ============================================================
// token.js — Apparences multiples pour le token (GM uniquement)
// Le GM importe une image de personnage + une image de bordure
// (avec centre transparent), centre/zoome le perso derrière la
// bordure, et le tout est fusionné en un seul fichier token.
// ============================================================

const CANVAS_SIZE = 400;

// Normalise une entrée de la liste (compat avec les anciens formats :
// simple chaîne de chemin, ou objet {src, ring}).
function normalizeEntry(entry) {
    if (typeof entry === "string") {
        return { src: entry, ring: null };
    }
    return {
        src: entry.src,
        ring: entry.ring ?? null
    };
}

async function ensureUploadFolder() {
    try {
        await FilePicker.createDirectory("data", "westmarch-tokens");
    } catch (e) {
        // Le dossier existe déjà : on ignore l'erreur
    }
}

// Crée le popup d'import d'une apparence (image perso + bordure,
// avec cadrage à la souris). Appelle onConfirm({src, ring}) si validé.
function openImportPopup(onConfirm) {
    const state = {
        charImg: null,
        borderImg: null,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        clipPct: 100,
        dragging: false,
        lastX: 0,
        lastY: 0
    };

    // Pas de fond plein écran qui capte les clics : la popup est une fenêtre
    // flottante normale. Cliquer ailleurs (canevas du jeu, fenêtre Parcourir
    // de Foundry, etc.) ne l'annule plus — elle reste ouverte derrière/à
    // côté tant qu'on ne clique pas sur "Annuler" ou "Créer".
    const overlay = $(`
        <div class="westmarch-import-overlay" style="position:fixed; inset:0; pointer-events:none; z-index:9999; display:flex; align-items:center; justify-content:center;">
            <div class="westmarch-import-popup" style="pointer-events:auto; background:#1f1f1f; border:1px solid #555; border-radius:6px; padding:16px; width:380px; color:#eee; font-size:13px; box-shadow:0 4px 20px rgba(0,0,0,0.6);">
                <h3 style="margin:0 0 10px; font-size:15px;">Importer un token</h3>

                <div style="display:flex; justify-content:center; margin-bottom:10px;">
                    <canvas class="westmarch-import-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" style="width:220px; height:220px; border:1px solid #555; border-radius:4px; cursor:move; background-image: linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%), linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%); background-size: 16px 16px; background-position: 0 0, 8px 8px; background-color:#666;"></canvas>
                </div>

                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                    <i class="fas fa-search" style="opacity:0.7;" title="Zoom du personnage"></i>
                    <input type="range" class="westmarch-zoom-slider" min="20" max="400" value="100" style="flex:1;">
                    <button type="button" class="westmarch-reset-frame" title="Réinitialiser le cadrage"><i class="fas fa-rotate-left"></i></button>
                </div>

                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                    <i class="fas fa-circle-notch" style="opacity:0.7;" title="Taille de la découpe"></i>
                    <input type="range" class="westmarch-clip-slider" min="40" max="100" value="100" style="flex:1;">
                </div>

                <div style="margin-bottom:8px;">
                    <div style="font-weight:bold; margin-bottom:4px;">Image du personnage</div>
                    <div style="display:flex; gap:6px;">
                        <button type="button" class="westmarch-pick-char-browse" style="flex:1;"><i class="fas fa-folder-open"></i> Parcourir</button>
                        <button type="button" class="westmarch-pick-char-upload" style="flex:1;"><i class="fas fa-upload"></i> Importer (PC)</button>
                        <input type="file" class="westmarch-char-file-input" accept="image/*" style="display:none;">
                    </div>
                </div>

                <div style="margin-bottom:12px;">
                    <div style="font-weight:bold; margin-bottom:4px;">Bordure du token</div>
                    <div style="display:flex; gap:6px;">
                        <button type="button" class="westmarch-pick-border-browse" style="flex:1;"><i class="fas fa-folder-open"></i> Parcourir</button>
                        <button type="button" class="westmarch-pick-border-upload" style="flex:1;"><i class="fas fa-upload"></i> Importer (PC)</button>
                        <input type="file" class="westmarch-border-file-input" accept="image/*" style="display:none;">
                    </div>
                </div>

                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button type="button" class="westmarch-import-cancel">Annuler</button>
                    <button type="button" class="westmarch-import-confirm" disabled>Créer</button>
                </div>
            </div>
        </div>
    `);

    const canvas = overlay.find(".westmarch-import-canvas")[0];
    const ctx = canvas.getContext("2d");

    const redraw = () => {
        // clearRect seul (pas de quadrillage dessiné dans le canvas) : le
        // quadrillage n'est qu'un repère visuel CSS (voir background-image
        // sur l'élément <canvas>). Si on le dessinait ici, il finirait dans
        // le PNG exporté par toBlob() et créerait un fond carré gris autour
        // du token rond au lieu d'une vraie transparence.
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        if (state.charImg) {
            ctx.save();
            // Découpe l'image du perso en cercle avant de la dessiner, pour
            // qu'elle ne puisse jamais dépasser du cadre rond dans les coins
            // (même si la bordure a des coins transparents et qu'on zoome/
            // déplace le perso au-delà du cercle).
            // Le rayon de découpe est ajustable (curseur "Taille de la
            // découpe") car la bordure importée n'a pas forcément un anneau
            // qui va jusqu'au bord du canvas — sinon le perso dépasse du
            // cadre visible.
            const clipRadius = (CANVAS_SIZE / 2) * (state.clipPct / 100);
            ctx.beginPath();
            ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, clipRadius, 0, Math.PI * 2);
            ctx.clip();

            ctx.translate(CANVAS_SIZE / 2 + state.offsetX, CANVAS_SIZE / 2 + state.offsetY);
            ctx.scale(state.scale, state.scale);
            ctx.drawImage(state.charImg, -state.charImg.width / 2, -state.charImg.height / 2);
            ctx.restore();
        }
        if (state.borderImg) {
            ctx.drawImage(state.borderImg, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }

        overlay.find(".westmarch-import-confirm").prop("disabled", !state.charImg);
    };

    const loadImage = (path, target) => {
        const img = new Image();
        img.onload = () => {
            state[target] = img;
            if (target === "charImg") {
                state.offsetX = 0;
                state.offsetY = 0;
                state.scale = 1;
                overlay.find(".westmarch-zoom-slider").val(100);
            }
            redraw();
        };
        img.onerror = () => ui.notifications.error("Impossible de charger l'image sélectionnée.");
        img.src = path;
    };

    // ---- Sélection des images (parcourir / upload) ----
    const wireImagePicker = (browseSel, uploadSel, inputSel, target) => {
        overlay.find(browseSel).on("click", () => {
            // Depuis le passage à une popup non-modale (overlay en
            // pointer-events:none), le FilePicker s'ouvre normalement
            // au-dessus du jeu sans avoir besoin de forcer son z-index.
            const fp = new FilePicker({ type: "image", callback: (path) => loadImage(path, target) });
            fp.browse();
        });
        overlay.find(uploadSel).on("click", () => overlay.find(inputSel).trigger("click"));
        overlay.find(inputSel).on("change", async (ev) => {
            const file = ev.target.files?.[0];
            if (!file) return;
            try {
                await ensureUploadFolder();
                const result = await FilePicker.upload("data", "westmarch-tokens", file);
                if (result?.path) loadImage(result.path, target);
            } catch (err) {
                console.error("[WestMarch] Erreur upload :", err);
                ui.notifications.error("Erreur lors de l'upload de l'image (voir console).");
            }
        });
    };

    wireImagePicker(".westmarch-pick-char-browse", ".westmarch-pick-char-upload", ".westmarch-char-file-input", "charImg");
    wireImagePicker(".westmarch-pick-border-browse", ".westmarch-pick-border-upload", ".westmarch-border-file-input", "borderImg");

    // ---- Cadrage : déplacement à la souris ----
    const pixelRatio = () => CANVAS_SIZE / canvas.clientWidth;

    canvas.addEventListener("pointerdown", (ev) => {
        state.dragging = true;
        state.lastX = ev.clientX;
        state.lastY = ev.clientY;
    });
    const _onPointerMove = (ev) => {
        if (!state.dragging) return;
        const ratio = pixelRatio();
        state.offsetX += (ev.clientX - state.lastX) * ratio;
        state.offsetY += (ev.clientY - state.lastY) * ratio;
        state.lastX = ev.clientX;
        state.lastY = ev.clientY;
        redraw();
    };
    const _onPointerUp = () => { state.dragging = false; };
    window.addEventListener("pointermove", _onPointerMove);
    window.addEventListener("pointerup",   _onPointerUp);

    // ---- Cadrage : zoom (molette + slider) ----
    canvas.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const delta = ev.deltaY > 0 ? -10 : 10;
        const slider = overlay.find(".westmarch-zoom-slider");
        const newVal = Math.min(400, Math.max(20, parseInt(slider.val()) + delta));
        slider.val(newVal);
        state.scale = newVal / 100;
        redraw();
    });
    overlay.find(".westmarch-zoom-slider").on("input", (ev) => {
        state.scale = parseInt(ev.target.value) / 100;
        redraw();
    });

    overlay.find(".westmarch-clip-slider").on("input", (ev) => {
        state.clipPct = parseInt(ev.target.value);
        redraw();
    });

    overlay.find(".westmarch-reset-frame").on("click", () => {
        state.offsetX = 0;
        state.offsetY = 0;
        state.scale = 1;
        overlay.find(".westmarch-zoom-slider").val(100);
        redraw();
    });

    // ---- Fermeture / validation ----
    const cleanup = () => {
        overlay.remove();
        window.removeEventListener("pointermove", _onPointerMove);
        window.removeEventListener("pointerup",   _onPointerUp);
    };

    overlay.find(".westmarch-import-cancel").on("click", cleanup);

    overlay.find(".westmarch-import-confirm").on("click", () => {
        if (!state.charImg) return;
        canvas.toBlob(async (blob) => {
            if (!blob) {
                ui.notifications.error("Erreur lors de la génération de l'image.");
                return;
            }
            try {
                await ensureUploadFolder();
                const file = new File([blob], `token-${Date.now()}.png`, { type: "image/png" });
                const result = await FilePicker.upload("data", "westmarch-tokens", file);
                if (result?.path) {
                    onConfirm({ src: result.path, ring: null });
                    cleanup();
                }
            } catch (err) {
                console.error("[WestMarch] Erreur création token :", err);
                ui.notifications.error("Erreur lors de la création du token (voir console).");
            }
        }, "image/png");
    });

    redraw();
    $(document.body).append(overlay);
}

export function TokenHooks() {

    // ============================================================
    // SECTION : Autorise l'ouverture du HUD du token (clic droit) pour
    // tout le monde, pas seulement le propriétaire.
    // - Par défaut, Foundry empêche un joueur non-propriétaire d'ouvrir
    //   le HUD d'un token (clic droit ignoré) — c'est pour ça que le
    //   bouton "Voir le portrait" plus bas n'apparaissait jamais pour un
    //   token qui n'est pas le sien : le HUD ne s'ouvrait même pas.
    // - On patch (via libWrapper) le clic droit pour qu'il ouvre toujours
    //   le HUD, peu importe le propriétaire.
    // - Sans danger pour les autres icônes du HUD : chacune vérifie déjà
    //   elle-même la permission nécessaire avant de s'afficher ou d'agir
    //   (ex. "Apparence suivante" plus bas vérifie actor.isOwner ; les
    //   icônes natives de Foundry comme les effets de statut ne
    //   s'affichent déjà que pour le propriétaire/GM dans le template du
    //   HUD lui-même).
    // ============================================================
    if (game.modules.get("lib-wrapper")?.active) {
        try {
            libWrapper.register(MOD, "CONFIG.Token.objectClass.prototype._onClickRight2", function (wrapped, ...args) {
                if (this.isOwner || game.user.isGM) return wrapped(...args);
                canvas.hud.token.bind(this);
            }, "MIXED");
        } catch (e) {
            console.warn("[WestMarch] Impossible de patcher l'ouverture du HUD token (libWrapper) :", e);
        }
    } else {
        console.warn("[WestMarch] libWrapper n'est pas actif : le bouton 'Voir le portrait' ne sera utilisable que par le propriétaire du token et le GM.");
    }

    // ============================================================
    // SECTION : Bouton "Image suivante" dans le HUD du token
    // - Tout le monde peut cycler sur son propre token
    // - Les apparences sont stockées sur l'acteur (prototype token)
    // ============================================================
    Hooks.on("renderTokenHUD", (hud, html, data) => {
        if (!game.settings.get(MOD, "enableTokenAppearance")) return;
        const token = hud.object;
        if (!token) return;

        const actor = token.actor;
        if (!actor) return;
        if (!game.user.isGM && !actor.isOwner) return;

        const rawImages = actor.getFlag(MOD, "images");
        if (!rawImages || rawImages.length < 2) return;
        const entries = rawImages.map(normalizeEntry);

        const btn = $(`
            <div class="control-icon westmarch-next-image" title="Apparence suivante">
                <i class="fas fa-chevron-right"></i>
            </div>
        `);

        btn.click(async () => {
            const currentImg = token.document.texture.src;
            const currentIndex = entries.findIndex(e => e.src === currentImg);
            const nextIndex = (currentIndex + 1) % entries.length;
            const next = entries[nextIndex];

            const updateData = { "texture.src": next.src };
            if (next.ring?.enabled) {
                updateData["ring.enabled"] = true;
                updateData["ring.colors.ring"] = next.ring.colors?.ring ?? "#ffffff";
                updateData["ring.colors.background"] = next.ring.colors?.background ?? "#000000";
            } else {
                updateData["ring.enabled"] = false;
            }

            await token.document.update(updateData);
        });

        $(html).find(".col.right").append(btn);
    });

    // ============================================================
    // SECTION : Bouton "Voir le portrait" dans le HUD du token
    // - Affiche en grand l'image liée à la fiche du personnage (le
    //   portrait de l'acteur), indépendamment de l'apparence du token.
    // - Visible par tous les joueurs (pas seulement le propriétaire),
    //   sur n'importe quel token dont le HUD peut être ouvert.
    // ============================================================
    Hooks.on("renderTokenHUD", (hud, html, data) => {
        if (!game.settings.get(MOD, "enableTokenPortraitButton")) return;
        const token = hud.object;
        if (!token) return;

        const actor = token.actor;
        if (!actor) return;

        const btn = $(`
            <div class="control-icon westmarch-show-portrait" title="Voir le portrait">
                <i class="fas fa-image"></i>
            </div>
        `);

        btn.click(() => {
            new ImagePopout(actor.img, { title: actor.name }).render(true);
        });

        $(html).find(".col.right").append(btn);
    });

    // ============================================================
    // SECTION : Pour un joueur non-propriétaire (et non-GM), le HUD du
    // token ne doit montrer QUE le bouton "Voir le portrait".
    // - Les autres icônes (apparence suivante, effets de statut, cible,
    //   élévation, visibilité, icônes ajoutées par des modules tiers
    //   comme Monk's TokenBar...) ainsi que les barres de vie/ressource
    //   donnent des informations sur un token qu'on ne possède pas —
    //   exactement ce qu'on veut éviter en autorisant l'ouverture du HUD
    //   pour tout le monde (voir le patch libWrapper plus haut).
    // - setTimeout(0) : on nettoie après que TOUS les hooks
    //   "renderTokenHUD" (les nôtres ci-dessus, et ceux des modules
    //   tiers) aient fini d'ajouter leurs propres icônes, peu importe
    //   l'ordre d'enregistrement.
    // ============================================================
    Hooks.on("renderTokenHUD", (hud, html, data) => {
        if (!game.settings.get(MOD, "enableTokenPortraitButton")) return;
        const token = hud.object;
        if (!token) return;
        if (game.user.isGM || token.isOwner) return;

        setTimeout(() => {
            const root = $(html);
            root.find(".control-icon").not(".westmarch-show-portrait").remove();
            root.find(".col.middle").remove();
        }, 0);
    });

    // ============================================================
    // SECTION : Gestion de la liste d'apparences dans le prototype token
    // - GM uniquement
    // - Accessible via l'onglet "Jeton" de la fiche du personnage
    // - Les apparences sont stockées sur l'acteur, donc permanentes
    //   pour tous les tokens posés depuis cette fiche
    // ============================================================
    Hooks.on("renderPrototypeTokenConfig", (app, html, data) => {
        if (!game.settings.get(MOD, "enableTokenAppearance")) return;
        if (!game.user.isGM) return;

        // En v13 l'acteur est accessible via app.document.parent
        const actor = app.document?.parent ?? app.object?.actor ?? app.actor;
        if (!actor) {
            console.warn("[WestMarch] renderPrototypeTokenConfig : acteur introuvable", app);
            return;
        }

        const rawImages = actor.getFlag(MOD, "images") ?? [];

        const section = $(`
            <fieldset style="margin-top: 12px; border: 1px solid #555; padding: 8px 12px; border-radius: 4px;">
                <legend style="font-weight: bold; font-size: 13px;">Apparences (WestMarch)</legend>
                <div class="westmarch-image-list" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;"></div>
                <div style="display: flex; gap: 6px;">
                    <button type="button" class="westmarch-add-image" style="flex:1;">
                        <i class="fas fa-plus"></i> Importer un token
                    </button>
                </div>
            </fieldset>
        `);

        const renderImages = (rawImgs) => {
            const list = section.find(".westmarch-image-list");
            list.empty();
            rawImgs.map(normalizeEntry).forEach((entry, index) => {
                const borderColor = entry.ring?.enabled ? (entry.ring.colors?.ring ?? "#ffffff") : "#555";
                const thumb = $(`
                    <div style="position:relative; width:48px; height:48px;">
                        <img class="westmarch-thumb-image" data-src="${entry.src}" src="${entry.src}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; border:2px solid ${borderColor}; cursor:pointer;" title="Cliquer pour voir en grand"/>
                        <div class="westmarch-remove-image" data-index="${index}" style="position:absolute;top:-4px;right:-4px;background:#c00;color:#fff;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;">✕</div>
                    </div>
                `);
                list.append(thumb);
            });
        };

        renderImages(rawImages);

        section.find(".westmarch-add-image").click(() => {
            openImportPopup(async (entry) => {
                const current = actor.getFlag(MOD, "images") ?? [];
                const updated = [...current, entry];
                await actor.setFlag(MOD, "images", updated);
                renderImages(updated);
            });
        });

        section.on("click", ".westmarch-remove-image", async (ev) => {
            const index = parseInt($(ev.currentTarget).data("index"));
            const current = actor.getFlag(MOD, "images") ?? [];
            current.splice(index, 1);
            await actor.setFlag(MOD, "images", [...current]);
            renderImages(current);
        });

        // Clic sur une miniature : affiche l'image de cette apparence en grand.
        section.on("click", ".westmarch-thumb-image", (ev) => {
            const src = $(ev.currentTarget).data("src");
            if (src) new ImagePopout(src, { title: actor.name }).render(true);
        });

        const tab = $(html).find(".tab[data-tab='appearance']");
        (tab.length ? tab : $(html)).append(section);
    });
}
