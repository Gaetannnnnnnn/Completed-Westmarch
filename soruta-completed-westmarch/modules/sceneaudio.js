// ============================================================
// sceneaudio.js — Mise en scène : gestionnaire de cues audio
//
// Un GESTIONNAIRE central (bouton dans la barre WestMarch, GM) où le MJ
// prépare des « cues » audio. Chaque cue = un son + ses réglages + un
// DÉCLENCHEUR :
//   • Manuel          — joué à la main (bouton du gestionnaire ou du token) ;
//   • Révélation      — quand le token lié perd son invisibilité GM ;
//   • Début de combat — au démarrage d'un combat.
//
// Les cues sont stockés au NIVEAU DU MONDE (réglage sceneCuesList), pas sur
// le token : supprimer le token ne perd pas la préparation, elle reste dans
// le gestionnaire (le token n'est qu'un lien réactivable).
//
// Depuis le HUD d'un token, on peut déclencher les cues qui lui sont liés
// (« activer ce qui a été préparé »).
//
// Diffusion à tous les clients via les queries de Foundry v13 (pas de
// "socket" dans le manifeste). Lecture LOCALE sur chaque client, à la
// seconde demandée → faible latence. Préchargement au chargement de la scène.
// Feature 100 % autonome. © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { Dialog } from "./compat.js";
import { tl, memeNom } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const rid = () => foundry.utils.randomID();

export const CUE_TRIGGERS = {
    manual:      tl("Manuel (bouton)"),
    reveal:      tl("Révélation du token lié (invisibilité GM retirée)"),
    combatStart: tl("Début de combat")
};

// ============================================================
// AUDIO — lecture locale (chaque client) + diffusion (queries)
// ============================================================
const _cache  = new Map();   // path -> Sound (préchargé)
const _active = new Set();   // Sounds en cours

function _audio() { return foundry.audio ?? {}; }

async function _getSound(path) {
    if (_cache.has(path)) return _cache.get(path);
    const { Sound } = _audio();
    let sound = null;
    if (Sound) {
        const ctx = game.audio?.music ?? game.audio?.environment ?? undefined;
        sound = new Sound(path, ctx ? { context: ctx } : {});
        try { await sound.load(); }
        catch (e) { journal.erreur(tl("[{0}] Chargement audio échoué : {1}", MOD, path), e); }
    }
    _cache.set(path, sound);
    return sound;
}

export async function playCueLocal({ path, offset = 0, volume = 0.8, fade = 0, loop = false } = {}) {
    if (!path) return;
    try {
        const { Sound, AudioHelper } = _audio();
        if (Sound) {
            const sound = await _getSound(path);
            if (!sound) return;
            try { if (sound.playing) await sound.stop(); } catch {}
            await sound.play({
                offset: Number(offset) || 0,
                volume: Number.isFinite(+volume) ? +volume : 0.8,
                loop:   !!loop,
                fade:   Number(fade) || 0
            });
            _active.add(sound);
        } else {
            const AH = AudioHelper ?? globalThis.AudioHelper;
            const s = await AH?.play({ src: path, volume, loop, autoplay: true });
            if (s) _active.add(s);
        }
    } catch (e) {
        journal.erreur(tl("[{0}] Lecture du cue audio échouée :", MOD), e);
    }
}

export async function stopAllCuesLocal(fade = 300) {
    for (const s of _active) {
        try { await s.stop({ fade }); } catch { try { s.stop(); } catch {} }
    }
    _active.clear();
}

// Destinataires d'un cue : les membres de la PARTY du GM (comme le reste du
// module, via le flag partyId). L'émetteur (le GM) est toujours inclus.
// Retourne null si le système de Party est désactivé → diffusion à tous.
function _partyUserIds() {
    if (!game.settings.get(MOD, "enableParty")) return null;   // pas de party → tous
    const myParty = game.user.getFlag(MOD, "partyId");
    const ids = new Set([game.user.id]);                       // toujours l'émetteur
    if (myParty) {
        for (const u of game.users) {
            if (u.active && u.getFlag(MOD, "partyId") === myParty) ids.add(u.id);
        }
    }
    return ids;
}

// Diffuse une action aux clients de la party (émetteur inclus). Chaque client
// lit le son en local, donc restreindre les destinataires = son par party.
function _broadcast(action, data = {}) {
    if (action === "play") playCueLocal(data);
    else if (action === "stop") stopAllCuesLocal(data.fade);

    const recips = _partyUserIds();   // null = tous
    for (const u of game.users) {
        if (u.id === game.user.id || !u.active) continue;
        if (recips && !recips.has(u.id)) continue;
        u.query(`westmarch.sceneCue.${action}`, data).catch(e =>
            journal.avert(`[${MOD}] cue → ${u.name} :`, e));
    }
}

// Joue un cue (objet complet) pour tout le monde.
function playCueForAll(cue) {
    if (!cue?.path) { ui.notifications?.warn(tl("Ce cue n'a pas de fichier audio.")); return; }
    _broadcast("play", { path: cue.path, offset: cue.offset, volume: cue.volume, fade: cue.fade, loop: cue.loop });
}

// ============================================================
// DONNÉES — liste centrale des cues (réglage monde)
// ============================================================
function getCues() {
    const l = game.settings.get(MOD, "sceneCuesList");
    return Array.isArray(l) ? l : [];
}
async function saveCues(list) {
    await game.settings.set(MOD, "sceneCuesList", list);
}
function getCue(id) { return getCues().find(c => c.id === id) ?? null; }

function newCue() {
    return {
        id: rid(),
        name: tl("Nouveau cue"),
        path: "", offset: 0,
        volume: Number(game.settings.get(MOD, "sceneCuesDefaultVolume")) || 0.8,
        fade: 0, loop: false,
        trigger: "manual",
        tokenId: "", tokenName: "", sceneId: ""
    };
}

async function upsertCue(cue) {
    const list = getCues();
    const i = list.findIndex(c => c.id === cue.id);
    if (i >= 0) list[i] = cue; else list.push(cue);
    await saveCues(list);
}
async function deleteCue(id) {
    await saveCues(getCues().filter(c => c.id !== id));
}

// ---- Sections & organisation (la liste mélange cues et sections) ----
function newSection() {
    return { id: rid(), type: "section", title: tl("Nouvelle section"), collapsed: false };
}
async function addItem(item) {
    const list = getCues();
    list.push(item);
    await saveCues(list);
}
async function deleteItem(id) {
    await saveCues(getCues().filter(c => c.id !== id));
}
async function moveItem(id, dir) {
    const list = getCues();
    const i = list.findIndex(c => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await saveCues(list);
}
async function setCollapsed(id, collapsed) {
    const list = getCues();
    const it = list.find(c => c.id === id);
    if (!it) return;
    it.collapsed = collapsed;
    await saveCues(list);
}
async function patchItem(id, patch) {
    const list = getCues();
    const it = list.find(c => c.id === id);
    if (!it) return;
    Object.assign(it, patch);
    await saveCues(list);
}

// Cues liés à un token précis (par id de token sur la scène).
function cuesForToken(tokenId) {
    return getCues().filter(c => c.type !== "section" && c.tokenId && c.tokenId === tokenId);
}

// ============================================================
// GESTIONNAIRE (ApplicationV2)
// ============================================================
class SceneCuesApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id:       "scwm-scenecues",
        classes:  ["scwm-scenecues"],
        window:   { title: tl("Cues audio — Mise en scène"), icon: "fa-solid fa-clapperboard", resizable: true },
        position: { width: 640, height: 620 }
    };

    async _renderHTML() { return this.#buildHTML(); }
    _replaceHTML(result, content) { content.innerHTML = result; this.#wire(content); }

    #buildHTML() {
        const items = getCues();
        let html = "";
        let sectionCollapsed = false;   // les cues sous une section repliée sont masqués
        for (const it of items) {
            if (it.type === "section") {
                sectionCollapsed = !!it.collapsed;
                html += this.#section(it);
            } else {
                if (sectionCollapsed) continue;   // caché sous une section repliée
                html += this.#card(it);
            }
        }
        if (!html) html = `<p class="scwm-cue-empty">${tl("Aucun cue préparé. Cliquez sur « Nouveau cue » pour commencer.")}</p>`;

        return `
        <div class="scwm-cue-manager">
            <div class="scwm-cue-toolbar">
                <button type="button" class="scwm-cue-add">${tl("<i class=\"fa-solid fa-plus\"></i> Nouveau cue")}</button>
                <button type="button" class="scwm-cue-add-section">${tl("<i class=\"fa-solid fa-folder-plus\"></i> Section")}</button>
                <span class="scwm-cue-toolbar-sep"></span>
                <button type="button" class="scwm-cue-stopall">${tl("<i class=\"fa-solid fa-stop\"></i> Tout arrêter")}</button>
            </div>
            <div class="scwm-cue-list">${html}</div>
        </div>`;
    }

    // En-tête de section (repliable, renommable, déplaçable).
    #section(s) {
        const chevron = s.collapsed ? "fa-chevron-right" : "fa-chevron-down";
        return `
        <div class="scwm-cue-section${s.collapsed ? " collapsed" : ""}" data-item-id="${s.id}">
            <button type="button" class="scwm-cue-sec-collapse" title="${tl("Replier / déplier")}"><i class="fas ${chevron}"></i></button>
            <i class="fa-solid fa-folder scwm-cue-sec-icon"></i>
            <input type="text" class="scwm-cue-sec-title" name="sectitle" value="${esc(s.title ?? "")}" placeholder="${tl("Nom de la section")}"/>
            <div class="scwm-cue-move">
                <button type="button" class="scwm-cue-up" title="${tl("Monter")}"><i class="fa-solid fa-chevron-up"></i></button>
                <button type="button" class="scwm-cue-down" title="${tl("Descendre")}"><i class="fa-solid fa-chevron-down"></i></button>
                <button type="button" class="scwm-cue-del" title="${tl("Supprimer la section")}"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
    }

    #card(c) {
        const trigOpts = Object.entries(CUE_TRIGGERS).map(([k, label]) =>
            `<option value="${k}" ${c.trigger === k ? "selected" : ""}>${esc(label)}</option>`).join("");

        const needsToken = c.trigger === "reveal";
        const tokenRow = `
            <div class="form-group scwm-cue-tokenrow" ${needsToken ? "" : 'style="opacity:.7"'}>
                <label>${tl("Token lié")}</label>
                <span class="scwm-cue-tokenname">${c.tokenName ? esc(c.tokenName) : `${tl("<em>aucun</em>")}`}</span>
                <button type="button" class="scwm-cue-link" title="${tl("Lier au token sélectionné sur la scène")}">
                    ${tl("<i class=\"fa-solid fa-link\"></i> Lier au token sélectionné")}
                </button>
                ${c.tokenId ? `<button type="button" class="scwm-cue-unlink" title="Délier"><i class="fa-solid fa-unlink"></i></button>` : ""}
            </div>`;

        const collapsed = !!c.collapsed;
        const chevron = collapsed ? "fa-chevron-right" : "fa-chevron-down";
        const body = `
            <div class="scwm-cue-body">
                <div class="form-group">
                    <label>${tl("Fichier audio")}</label>
                    <div class="scwm-cue-file">
                        <input type="text" name="path" value="${esc(c.path)}" placeholder="${tl("ex. music/reveal.ogg")}"/>
                        <button type="button" class="scwm-cue-playlists" title="${tl("Choisir depuis les playlists (monde &amp; compendiums)")}"><i class="fa-solid fa-music"></i></button>
                        <button type="button" class="scwm-cue-browse" title="${tl("Parcourir les fichiers")}"><i class="fa-solid fa-folder-open"></i></button>
                    </div>
                </div>
                <div class="scwm-cue-grid">
                    <div class="form-group"><label>${tl("Départ (s)")}</label><input type="number" name="offset" value="${c.offset}" min="0" step="0.1"/></div>
                    <div class="form-group"><label>${tl("Volume")}</label><input type="number" name="volume" value="${c.volume}" min="0" max="1" step="0.05"/></div>
                    <div class="form-group"><label>${tl("Fondu (ms)")}</label><input type="number" name="fade" value="${c.fade}" min="0" step="50"/></div>
                    <div class="form-group"><label>${tl("Boucle")}</label><input type="checkbox" name="loop" ${c.loop ? "checked" : ""}/></div>
                </div>
                <div class="form-group">
                    <label>${tl("Déclencheur")}</label>
                    <select name="trigger" class="scwm-cue-trigger">${trigOpts}</select>
                </div>
                ${tokenRow}
            </div>`;

        return `
        <div class="scwm-cue-card${collapsed ? " collapsed" : ""}" data-cue-id="${c.id}" data-item-id="${c.id}">
            <div class="scwm-cue-head">
                <button type="button" class="scwm-cue-collapse" title="Replier / déplier"><i class="fas ${chevron}"></i></button>
                <input type="text" class="scwm-cue-title" name="name" value="${esc(c.name)}" placeholder="Nom du cue"/>
                <div class="scwm-cue-head-actions">
                    <button type="button" class="scwm-cue-up" title="Monter"><i class="fa-solid fa-chevron-up"></i></button>
                    <button type="button" class="scwm-cue-down" title="Descendre"><i class="fa-solid fa-chevron-down"></i></button>
                    <button type="button" class="scwm-cue-play" title="Jouer pour tous"><i class="fa-solid fa-play"></i></button>
                    <button type="button" class="scwm-cue-stop" title="Stop"><i class="fa-solid fa-stop"></i></button>
                    <button type="button" class="scwm-cue-del" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            ${collapsed ? "" : body}
        </div>`;
    }

    // Lit les valeurs d'une carte vers un objet cue (en repartant de l'existant
    // pour préserver id / lien token).
    #readCard(cardEl) {
        const base = getCue(cardEl.dataset.cueId) ?? { id: cardEl.dataset.cueId };
        const q = (sel) => cardEl.querySelector(sel);
        // Une carte repliée n'a pas ses champs de corps → on garde les valeurs
        // existantes (base) pour ceux qui sont absents.
        const out = { ...base };
        const name = q("[name=name]"); if (name) out.name = name.value.trim() || "Cue";
        const path = q("[name=path]"); if (path) out.path = path.value.trim();
        const off = q("[name=offset]"); if (off) out.offset = Number(off.value) || 0;
        const vol = q("[name=volume]"); if (vol) out.volume = Number(vol.value);
        const fade = q("[name=fade]"); if (fade) out.fade = Number(fade.value) || 0;
        const loop = q("[name=loop]"); if (loop) out.loop = loop.checked;
        const trig = q("[name=trigger]"); if (trig) out.trigger = trig.value;
        return out;
    }

    #wire(root) {
        root.querySelector(".scwm-cue-add")?.addEventListener("click", async () => {
            await upsertCue(newCue());
            this.render();
        });
        root.querySelector(".scwm-cue-add-section")?.addEventListener("click", async () => {
            await addItem(newSection());
            this.render();
        });
        root.querySelector(".scwm-cue-stopall")?.addEventListener("click", () => _broadcast("stop", { fade: 300 }));

        // ---- Sections (en-têtes) ----
        root.querySelectorAll(".scwm-cue-section").forEach(sec => {
            const id = sec.dataset.itemId;
            sec.querySelector(".scwm-cue-sec-collapse")?.addEventListener("click", async () => {
                const cur = getCue(id);
                await setCollapsed(id, !cur?.collapsed);
                this.render();
            });
            sec.querySelector(".scwm-cue-sec-title")?.addEventListener("change", (e) =>
                patchItem(id, { title: e.target.value.trim() || tl("Section") }));
            sec.querySelector(".scwm-cue-up")?.addEventListener("click", async () => { await moveItem(id, -1); this.render(); });
            sec.querySelector(".scwm-cue-down")?.addEventListener("click", async () => { await moveItem(id, 1); this.render(); });
            sec.querySelector(".scwm-cue-del")?.addEventListener("click", async () => { await deleteItem(id); this.render(); });
        });

        root.querySelectorAll(".scwm-cue-card").forEach(card => {
            const id = card.dataset.cueId;

            // Replier / déplier + réordonner.
            card.querySelector(".scwm-cue-collapse")?.addEventListener("click", async () => {
                const cur = getCue(id);
                await setCollapsed(id, !cur?.collapsed);
                this.render();
            });
            card.querySelector(".scwm-cue-up")?.addEventListener("click", async () => { await moveItem(id, -1); this.render(); });
            card.querySelector(".scwm-cue-down")?.addEventListener("click", async () => { await moveItem(id, 1); this.render(); });

            // Sauvegarde silencieuse à chaque modification de champ (sans re-render).
            card.querySelectorAll("input[name], select[name]").forEach(el => {
                el.addEventListener("change", async () => {
                    await upsertCue(this.#readCard(card));
                    // Le changement de déclencheur modifie l'affichage → re-render.
                    if (el.name === "trigger") this.render();
                });
            });

            card.querySelector(".scwm-cue-browse")?.addEventListener("click", () => {
                const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
                const input = card.querySelector("[name=path]");
                new FP({ type: "audio", current: input.value || "", callback: async (p) => {
                    input.value = p; await upsertCue(this.#readCard(card));
                } }).render(true);
            });

            card.querySelector(".scwm-cue-playlists")?.addEventListener("click", () => {
                _openPlaylistBrowser(async (path, name) => {
                    const input = card.querySelector("[name=path]");
                    input.value = path;
                    // Si le cue porte encore un nom générique, le nommer d'après le son.
                    const nameEl = card.querySelector("[name=name]");
                    if (nameEl && (!nameEl.value.trim() || memeNom(nameEl.value.trim(), tl("Nouveau cue")))) nameEl.value = name;
                    await upsertCue(this.#readCard(card));
                });
            });

            card.querySelector(".scwm-cue-play")?.addEventListener("click", async () => {
                await upsertCue(this.#readCard(card));
                playCueForAll(getCue(id));
            });
            card.querySelector(".scwm-cue-stop")?.addEventListener("click", () => _broadcast("stop", { fade: 200 }));

            card.querySelector(".scwm-cue-del")?.addEventListener("click", async () => {
                await deleteCue(id);
                this.render();
            });

            card.querySelector(".scwm-cue-link")?.addEventListener("click", async () => {
                const tok = canvas.tokens?.controlled?.[0];
                if (!tok) { ui.notifications?.warn(tl("Sélectionnez d'abord un token sur la scène.")); return; }
                const cue = this.#readCard(card);
                cue.tokenId = tok.id;
                cue.tokenName = tok.name;
                cue.sceneId = canvas.scene?.id ?? "";
                await upsertCue(cue);
                this.render();
            });
            card.querySelector(".scwm-cue-unlink")?.addEventListener("click", async () => {
                const cue = this.#readCard(card);
                cue.tokenId = ""; cue.tokenName = ""; cue.sceneId = "";
                await upsertCue(cue);
                this.render();
            });
        });
    }
}

let _cuesApp = null;
export function openSceneCues() {
    if (!game.user.isGM) return;
    _cuesApp ??= new SceneCuesApp();
    _cuesApp.render(true);
}

// ============================================================
// NAVIGATEUR DE PLAYLISTS — écouter & choisir un son
// ============================================================
// Rassemble les sons des playlists du MONDE et des COMPENDIUMS. Chaque son
// expose un chemin de fichier (PlaylistSound#path) directement réutilisable
// comme source d'un cue, sans devoir l'importer ni ranger le fichier.
// Arborescence des playlists : Source (Monde / chaque compendium) → dossiers
// (comme dans la barre latérale ou le compendium) → playlists → morceaux.
// Les compendiums ne sont lus qu'en texte (fiches), aucun fichier audio n'est chargé.
function _cheminDossiers(folder) {
    if (!folder) return [];
    try { return [...[...(folder.ancestors ?? [])].reverse().map(f => f.name), folder.name].filter(Boolean); }
    catch { return folder.name ? [folder.name] : []; }
}
const _noeud = (nom) => ({ nom, dossiers: new Map(), playlists: [] });
function _ranger(racine, chemin, pl) {
    let n = racine;
    for (const d of chemin) { if (!n.dossiers.has(d)) n.dossiers.set(d, _noeud(d)); n = n.dossiers.get(d); }
    n.playlists.push(pl);
}
async function _collectPlaylistSounds() {
    const sources = [];
    const grab = (pl) => [...pl.sounds]
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map(s => ({ name: s.name || tl("Son"), path: s.path }))
        .filter(s => s.path);

    const monde = _noeud(tl("Monde"));
    for (const pl of game.playlists ?? []) {
        const sounds = grab(pl);
        if (sounds.length) _ranger(monde, _cheminDossiers(pl.folder), { label: pl.name, sounds });
    }
    if (monde.playlists.length || monde.dossiers.size) sources.push({ ...monde, icone: "fa-earth-europe" });

    for (const pack of game.packs.filter(p => p.documentName === "Playlist")) {
        let docs = [];
        try { docs = await pack.getDocuments(); } catch (e) { journal.avert(`[${MOD}] compendium ${pack.collection} :`, e); }
        const racine = _noeud(pack.metadata?.label ?? pack.collection);
        for (const pl of docs) {
            const sounds = grab(pl);
            if (sounds.length) _ranger(racine, _cheminDossiers(pl.folder), { label: pl.name, sounds });
        }
        if (racine.playlists.length || racine.dossiers.size) sources.push({ ...racine, icone: "fa-book" });
    }
    return sources;
}

// Texte simplifié pour la recherche : minuscules, sans accents.
const _cle = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Aperçu local (MJ seul) : un seul morceau à la fois, bouton ▶ ↔ ⏹.
let _apercu = null, _apercuBtn = null;
async function _arreterApercu() {
    const s = _apercu; _apercu = null;
    if (_apercuBtn) { _apercuBtn.querySelector("i").className = "fa-solid fa-play"; _apercuBtn.dataset.tooltip = tl("Écouter (moi uniquement)"); }
    _apercuBtn = null;
    try { await s?.stop?.(); } catch { /* */ }
}

/**
 * Fenêtre « Playlists — écouter & choisir ».
 * @param {Function} onPick   (path, name) → morceau choisi.
 * @param {object}   [opts]
 * @param {Function} [opts.onQueue]  (path, name) → ajoute à une file d'attente
 *                                   (bouton affiché seulement si fourni).
 * @param {string}   [opts.titre]
 */
export async function _openPlaylistBrowser(onPick, opts = {}) {
    const sources = await _collectPlaylistSounds();
    if (!sources.length) {
        ui.notifications?.warn(tl("Aucun son trouvé dans les playlists (monde ou compendiums)."));
        return;
    }
    const flat = [];
    const compter = (n) => n.playlists.reduce((a, p) => a + p.sounds.length, 0)
        + [...n.dossiers.values()].reduce((a, d) => a + compter(d), 0);
    const rendrePlaylist = (pl, contexte) => {
        const rows = pl.sounds.map(s => {
            const idx = flat.push(s) - 1;
            return `<div class="scwm-pl-row" data-cherche="${esc(_cle(`${s.name} ${pl.label} ${contexte}`))}">
                <span class="scwm-pl-name">${esc(s.name)}</span>
                <span class="scwm-pl-row-actions">
                    <button type="button" class="scwm-pl-play" data-idx="${idx}" data-tooltip="${tl("Écouter (moi uniquement)")}"><i class="fa-solid fa-play"></i></button>
                    ${opts.onQueue ? `<button type="button" class="scwm-pl-queue" data-idx="${idx}" data-tooltip="${tl("Ajouter à la file d'attente")}"><i class="fa-solid fa-list-ol"></i></button>` : ""}
                    <button type="button" class="scwm-pl-pick" data-idx="${idx}" data-tooltip="${opts.onQueue ? tl("Jouer maintenant") : tl("Choisir ce son")}"><i class="fa-solid fa-check"></i></button>
                </span>
            </div>`;
        }).join("");
        return `<details class="scwm-pl-group">
            <summary><i class="fa-solid fa-chevron-right scwm-pl-chev"></i><i class="fa-solid fa-music"></i> ${esc(pl.label)} <span class="scwm-pl-nb">${pl.sounds.length}</span></summary>
            <div class="scwm-pl-contenu">${rows}</div>
        </details>`;
    };
    const rendreNoeud = (n, contexte) => {
        const dossiers = [...n.dossiers.values()].sort((a, b) => a.nom.localeCompare(b.nom, game.i18n?.lang || "fr"))
            .map(d => `<details class="scwm-pl-dossier">
                <summary><i class="fa-solid fa-chevron-right scwm-pl-chev"></i><i class="fa-solid fa-folder"></i> ${esc(d.nom)} <span class="scwm-pl-nb">${compter(d)}</span></summary>
                <div class="scwm-pl-contenu">${rendreNoeud(d, `${contexte} ${d.nom}`)}</div>
            </details>`).join("");
        const pls = n.playlists.slice().sort((a, b) => a.label.localeCompare(b.label, game.i18n?.lang || "fr"))
            .map(pl => rendrePlaylist(pl, contexte)).join("");
        return dossiers + pls;
    };
    const arbre = sources.map((src, i) => `<details class="scwm-pl-source"${i === 0 ? " open" : ""}>
            <summary><i class="fa-solid fa-chevron-right scwm-pl-chev"></i><i class="fa-solid ${src.icone}"></i> ${esc(src.nom)} <span class="scwm-pl-nb">${compter(src)}</span></summary>
            <div class="scwm-pl-contenu">${rendreNoeud(src, src.nom)}</div>
        </details>`).join("");

    const content = `
        <div class="scwm-pl-browser">
            <div class="scwm-pl-recherche">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="search" class="scwm-pl-search" placeholder="${tl("Rechercher une musique ou une playlist…")}" autocomplete="off">
                <span class="scwm-pl-compte"></span>
            </div>
            <p class="scwm-pl-vide" hidden>${tl("Aucune musique ne correspond.")}</p>
            <p class="scwm-pl-aide">${opts.onQueue
                ? tl("▶ écoute pour vous seul · ≡ ajoute à la file d'attente du groupe · ✓ joue maintenant pour le groupe.")
                : tl("▶ écoute pour vous seul (les joueurs n'entendent rien) · ✓ choisit le morceau.")}</p>
            <div class="scwm-pl-arbre">${arbre}</div>
        </div>`;

    new Dialog({
        title: opts.titre ?? tl("Playlists — écouter & choisir"),
        content,
        buttons: {
            close: { icon: '<i class="fa-solid fa-times"></i>', label: tl("Fermer"), callback: () => _arreterApercu() }
        },
        default: "close",
        close: () => _arreterApercu(),
        render: (html) => {
            const root = html[0] ?? html;
            // Recherche : sans accents ni majuscules, sur le nom du morceau, de
            // sa playlist, de ses dossiers et de sa source ; chaque mot doit être
            // trouvé. Les dossiers/playlists qui contiennent un résultat s'ouvrent.
            const champ = root.querySelector(".scwm-pl-search");
            const compte = root.querySelector(".scwm-pl-compte");
            const vide = root.querySelector(".scwm-pl-vide");
            const blocs = [...root.querySelectorAll(".scwm-pl-arbre details")];
            const etatInitial = new Map(blocs.map(d => [d, d.open]));
            const filtrer = () => {
                const mots = _cle(champ?.value).split(/\s+/).filter(Boolean);
                let n = 0;
                root.querySelectorAll(".scwm-pl-row").forEach(r => {
                    const ok = mots.every(m => r.dataset.cherche.includes(m));
                    r.style.display = ok ? "" : "none";
                    if (ok) n++;
                });
                // Du plus profond au plus haut : un bloc est visible s'il contient une ligne visible.
                for (const d of blocs.slice().reverse()) {
                    const visible = [...d.querySelectorAll(".scwm-pl-row")].some(r => r.style.display !== "none");
                    d.style.display = visible ? "" : "none";
                    d.open = mots.length ? visible : etatInitial.get(d);
                }
                if (compte) compte.textContent = mots.length ? tl("{0} résultat(s)", n) : "";
                if (vide) vide.hidden = n > 0;
            };
            champ?.addEventListener("input", filtrer);
            champ?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.preventDefault(); });
            setTimeout(() => champ?.focus(), 50);

            // ▶ / ⏹ : aperçu local, le bouton bascule.
            root.querySelectorAll(".scwm-pl-play").forEach(b => b.addEventListener("click", async () => {
                const s = flat[Number(b.dataset.idx)];
                if (!s) return;
                const memeBouton = _apercuBtn === b;
                await _arreterApercu();
                if (memeBouton) return;
                try {
                    const AH = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
                    const son = await AH.play({ src: s.path, volume: 0.7, loop: false }, false);
                    _apercu = son; _apercuBtn = b;
                    b.querySelector("i").className = "fa-solid fa-stop";
                    b.dataset.tooltip = tl("Arrêter l'écoute");
                    son?.addEventListener?.("end", () => { if (_apercu === son) _arreterApercu(); });
                } catch (e) {
                    journal.avert(tl("[{0}] Aperçu audio :", MOD), e);
                    ui.notifications?.warn(tl("Impossible de lire « {0} » (fichier manquant ?).", s.name));
                }
            }));
            root.querySelectorAll(".scwm-pl-pick").forEach(b => b.addEventListener("click", () => {
                const s = flat[Number(b.dataset.idx)];
                if (s) { onPick(s.path, s.name); ui.notifications?.info(tl("Son choisi : {0}", s.name)); }
            }));
            root.querySelectorAll(".scwm-pl-queue").forEach(b => b.addEventListener("click", () => {
                const s = flat[Number(b.dataset.idx)];
                if (s) { opts.onQueue(s.path, s.name); ui.notifications?.info(tl("Ajouté à la file d'attente : {0}", s.name)); }
            }));
        }
    }, { width: 540, height: 600, resizable: true, classes: ["scwm-pl-fenetre"] }).render(true);
}

// ============================================================
// BOUTON HUD DU TOKEN — activer un cue préparé pour ce token
// ============================================================
function _injectHudButton(hud, html) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MOD, "enableSceneCues")) return;
    const token = hud?.object;
    if (!token) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    const linked = cuesForToken(token.id);
    const btn = document.createElement("div");
    btn.className = `control-icon scwm-cue-btn${linked.length ? " active" : ""}`;
    btn.title = linked.length ? tl("Cues liés ({0}) — clic pour jouer", linked.length) : tl("Cues audio — aucun lié (ouvrir le gestionnaire)");
    btn.innerHTML = `<i class="fa-solid fa-clapperboard"></i>`;
    btn.addEventListener("click", () => _openTokenCuePicker(token));

    const col = root.querySelector(".col.left") ?? root.querySelector(".left") ?? root;
    col.appendChild(btn);
}

function _openTokenCuePicker(token) {
    const linked = cuesForToken(token.id);
    const rows = linked.map(c => `
        <div class="scwm-cue-pick" data-cue-id="${c.id}">
            <span><i class="fas ${c.trigger === "reveal" ? "fa-eye" : "fa-play"}"></i> ${esc(c.name)}</span>
            <span class="scwm-cue-pick-actions">
                <button type="button" class="scwm-cue-pick-play" data-cue-id="${c.id}">${tl("<i class=\"fa-solid fa-play\"></i> Jouer")}</button>
            </span>
        </div>`).join("") ||
        `<p>${tl("Aucun cue lié à ce token pour l'instant.")}</p>`;

    const content = `<div class="scwm-cue-picker">${rows}</div>`;

    new Dialog({
        title: `Cues — ${token.name}`,
        content,
        buttons: {
            manage: { icon: '<i class="fa-solid fa-sliders"></i>', label: tl("Gérer les cues"), callback: () => openSceneCues() },
            close:  { icon: '<i class="fa-solid fa-times"></i>', label: tl("Fermer") }
        },
        default: "close",
        render: (html) => {
            const root = html[0] ?? html;
            root.querySelectorAll(".scwm-cue-pick-play").forEach(b =>
                b.addEventListener("click", () => {
                    const cue = getCue(b.dataset.cueId);
                    if (cue) playCueForAll(cue);
                }));
        }
    }).render(true);
}

// ============================================================
// HOOKS
// ============================================================
export function SceneAudioHooks() {
    // Handlers de diffusion (tous les clients).
    CONFIG.queries["westmarch.sceneCue.play"] = async (d) => { await playCueLocal(d); return true; };
    CONFIG.queries["westmarch.sceneCue.stop"] = async (d) => { await stopAllCuesLocal(d?.fade); return true; };

    // Bouton dans la barre WestMarch (GM) → ouvre le gestionnaire.
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.settings.get(MOD, "enableSceneCues")) return;
        if (!game.user.isGM) return;
        if (!controls.westmarch) {
            controls.westmarch = { name: "westmarch", title: "WestMarch", icon: "fa-solid fa-hammer", layer: "tokens", tools: {} };
        }
        controls.westmarch.tools.sceneCues = {
            name: "sceneCues",
            title: tl("Cues audio — Mise en scène"),
            icon: "fa-solid fa-clapperboard",
            button: true,
            onChange: () => openSceneCues(),
            visible: true
        };
    });

    // Bouton HUD du token.
    Hooks.on("renderTokenHUD", (hud, html) => _injectHudButton(hud, html));

    // Déclencheur « Révélation » : token perd son invisibilité GM (hidden → false).
    Hooks.on("updateToken", (tokenDoc, changes) => {
        if (!game.settings.get(MOD, "enableSceneCues")) return;
        if (!("hidden" in changes) || changes.hidden !== false) return;
        if (!game.user.isGM) return;
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;

        for (const cue of getCues()) {
            if (cue.trigger === "reveal" && cue.tokenId === tokenDoc.id && cue.path) {
                playCueForAll(cue);
            }
        }
    });

    // Déclencheur « Début de combat ».
    Hooks.on("combatStart", () => {
        if (!game.settings.get(MOD, "enableSceneCues")) return;
        if (!game.user.isGM) return;
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;
        for (const cue of getCues()) {
            if (cue.trigger === "combatStart" && cue.path) playCueForAll(cue);
        }
    });

    // Préchargement des sons de la scène (départ instantané).
    Hooks.on("canvasReady", () => {
        if (!game.settings.get(MOD, "enableSceneCues")) return;
        for (const cue of getCues()) if (cue.path) _getSound(cue.path);
    });
}
