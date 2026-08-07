// ============================================================
// sceneaudio.js — Mise en scène : cues audio attachés aux tokens
//
// Permet au MJ d'attacher à un token un « cue » audio :
//   { path, offset (seconde de départ), volume, fade, loop }
// Le cue se déclenche :
//   • AUTOMATIQUEMENT pour tous les joueurs quand le token perd son
//     invisibilité GM (propriété hidden : true → false) ;
//   • MANUELLEMENT depuis le bouton du HUD du token (« Jouer pour tous »).
//
// Diffusion à tous les clients via le système de queries de Foundry v13
// (CONFIG.queries) — pas besoin de déclarer "socket" dans le manifeste.
// Chaque client lit le fichier EN LOCAL, à la seconde demandée : latence
// réseau minimale, aucun flux partagé (contrairement à watch2gether).
// Préchargement au chargement de la scène → départ quasi instantané.
//
// Feature 100 % autonome (réglages sous sa propre catégorie), sans lien
// avec les autres modules. © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const FLAG = "sceneCue";
const _cache  = new Map();   // path -> Sound (préchargé)
const _active = new Set();   // Sounds en cours (pour « stop »)

function _audio() { return foundry.audio ?? {}; }

// Récupère (et met en cache) un Sound chargé pour un chemin donné.
async function _getSound(path) {
    if (_cache.has(path)) return _cache.get(path);
    const { Sound } = _audio();
    let sound = null;
    if (Sound) {
        const ctx = game.audio?.music ?? game.audio?.environment ?? undefined;
        sound = new Sound(path, ctx ? { context: ctx } : {});
        try { await sound.load(); }
        catch (e) { console.error(`[${MOD}] Chargement audio échoué : ${path}`, e); }
    }
    _cache.set(path, sound);
    return sound;
}

// Lecture LOCALE d'un cue (sur le client courant), à l'offset demandé.
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
        console.error(`[${MOD}] Lecture du cue audio échouée :`, e);
    }
}

// Arrêt LOCAL de tous les cues en cours.
export async function stopAllCuesLocal(fade = 300) {
    for (const s of _active) {
        try { await s.stop({ fade }); } catch { try { s.stop(); } catch {} }
    }
    _active.clear();
}

// Diffuse une action (play / stop) à TOUS les clients (émetteur inclus).
function _broadcast(action, data = {}) {
    if (action === "play") playCueLocal(data);
    else if (action === "stop") stopAllCuesLocal(data.fade);

    const others = game.users.filter(u => u.active && u.id !== game.user.id);
    for (const u of others) {
        u.query(`westmarch.sceneCue.${action}`, data).catch(e =>
            console.warn(`[${MOD}] cue → ${u.name} :`, e));
    }
}

// Lit un cue depuis le flag du token, en complétant par les valeurs par défaut.
function _cueOf(tokenDoc) {
    const c = tokenDoc?.getFlag(MOD, FLAG);
    if (!c) return null;
    return {
        enabled: !!c.enabled,
        path:    c.path ?? "",
        offset:  Number(c.offset) || 0,
        volume:  Number.isFinite(+c.volume) ? +c.volume : 0.8,
        fade:    Number(c.fade) || 0,
        loop:    !!c.loop
    };
}

// ============================================================
// UI : bouton HUD (MJ) → fenêtre de configuration du cue
// ============================================================
function _injectHudButton(hud, html) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MOD, "enableSceneCues")) return;
    const token = hud?.object;
    if (!token) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    const cue = _cueOf(token.document);
    const active = cue?.enabled && cue?.path;

    const btn = document.createElement("div");
    btn.className = `control-icon scwm-cue-btn${active ? " active" : ""}`;
    btn.title = active ? "Cue audio (configuré) — clic pour régler" : "Cue audio — attacher un son";
    btn.innerHTML = `<i class="fas fa-clapperboard"></i>`;
    btn.addEventListener("click", () => _openCueConfig(token));

    const col = root.querySelector(".col.left") ?? root.querySelector(".left") ?? root;
    col.appendChild(btn);
}

function _openCueConfig(token) {
    const doc = token.document;
    const cur = _cueOf(doc) ?? {
        enabled: true, path: "", offset: 0,
        volume: Number(game.settings.get(MOD, "sceneCuesDefaultVolume")) || 0.8,
        fade: 0, loop: false
    };

    const content = `
    <div class="scwm-cue-form">
      <p class="notes">Le son se déclenche pour <strong>tous les joueurs</strong> quand ce token
      perd son invisibilité GM. Vous pouvez aussi le jouer manuellement ci-dessous.</p>
      <div class="form-group">
        <label>Activé</label>
        <input type="checkbox" name="enabled" ${cur.enabled ? "checked" : ""}/>
      </div>
      <div class="form-group">
        <label>Fichier audio</label>
        <div style="display:flex; gap:4px; flex:1;">
          <input type="text" name="path" value="${cur.path}" placeholder="ex. music/reveal.ogg" style="flex:1;"/>
          <button type="button" class="scwm-cue-browse" title="Parcourir"><i class="fas fa-folder-open"></i></button>
        </div>
      </div>
      <div class="form-group">
        <label>Départ (secondes)</label>
        <input type="number" name="offset" value="${cur.offset}" min="0" step="0.1"/>
      </div>
      <div class="form-group">
        <label>Volume (0–1)</label>
        <input type="number" name="volume" value="${cur.volume}" min="0" max="1" step="0.05"/>
      </div>
      <div class="form-group">
        <label>Fondu d'entrée (ms)</label>
        <input type="number" name="fade" value="${cur.fade}" min="0" step="50"/>
      </div>
      <div class="form-group">
        <label>Boucle</label>
        <input type="checkbox" name="loop" ${cur.loop ? "checked" : ""}/>
      </div>
      <div class="form-group scwm-cue-actions" style="justify-content:flex-end; gap:6px;">
        <button type="button" class="scwm-cue-test"><i class="fas fa-headphones"></i> Tester (moi)</button>
        <button type="button" class="scwm-cue-playall"><i class="fas fa-play"></i> Jouer pour tous</button>
        <button type="button" class="scwm-cue-stop"><i class="fas fa-stop"></i> Stop</button>
      </div>
    </div>`;

    const read = (root) => ({
        enabled: root.querySelector("[name=enabled]").checked,
        path:    root.querySelector("[name=path]").value.trim(),
        offset:  Number(root.querySelector("[name=offset]").value) || 0,
        volume:  Number(root.querySelector("[name=volume]").value),
        fade:    Number(root.querySelector("[name=fade]").value) || 0,
        loop:    root.querySelector("[name=loop]").checked
    });

    new Dialog({
        title: `Cue audio — ${token.name}`,
        content,
        buttons: {
            save: {
                icon: '<i class="fas fa-save"></i>', label: "Enregistrer",
                callback: async (html) => {
                    const root = html[0] ?? html;
                    await doc.setFlag(MOD, FLAG, read(root));
                    ui.notifications?.info("Cue audio enregistré.");
                }
            },
            remove: {
                icon: '<i class="fas fa-trash"></i>', label: "Retirer",
                callback: async () => { await doc.unsetFlag(MOD, FLAG); ui.notifications?.info("Cue audio retiré."); }
            },
            close: { icon: '<i class="fas fa-times"></i>', label: "Fermer" }
        },
        default: "save",
        render: (html) => {
            const root = html[0] ?? html;
            root.querySelector(".scwm-cue-browse")?.addEventListener("click", () => {
                const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
                const input = root.querySelector("[name=path]");
                new FP({ type: "audio", current: input.value || "", callback: (p) => { input.value = p; } }).render(true);
            });
            root.querySelector(".scwm-cue-test")?.addEventListener("click", () => playCueLocal(read(root)));
            root.querySelector(".scwm-cue-playall")?.addEventListener("click", () => _broadcast("play", read(root)));
            root.querySelector(".scwm-cue-stop")?.addEventListener("click", () => _broadcast("stop", { fade: 300 }));
        }
    }).render(true);
}

// ============================================================
// HOOKS
// ============================================================
export function SceneAudioHooks() {
    // Handlers de diffusion (tous les clients doivent les enregistrer).
    CONFIG.queries["westmarch.sceneCue.play"] = async (d) => { await playCueLocal(d); return true; };
    CONFIG.queries["westmarch.sceneCue.stop"] = async (d) => { await stopAllCuesLocal(d?.fade); return true; };

    // Bouton de configuration dans le HUD du token (MJ).
    Hooks.on("renderTokenHUD", (hud, html) => _injectHudButton(hud, html));

    // Déclenchement AUTO : le token perd son invisibilité GM (hidden true → false).
    Hooks.on("updateToken", (tokenDoc, changes) => {
        if (!game.settings.get(MOD, "enableSceneCues")) return;
        if (!("hidden" in changes) || changes.hidden !== false) return;   // uniquement la révélation
        if (!game.user.isGM) return;
        // Déduplication multi-GM : seul le GM actif diffuse.
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;

        const cue = _cueOf(tokenDoc);
        if (!cue || !cue.enabled || !cue.path) return;
        _broadcast("play", cue);
    });

    // Préchargement des cues de la scène → départ instantané au déclenchement.
    Hooks.on("canvasReady", () => {
        if (!game.settings.get(MOD, "enableSceneCues")) return;
        for (const t of canvas.tokens?.placeables ?? []) {
            const cue = _cueOf(t.document);
            if (cue?.enabled && cue.path) _getSound(cue.path);
        }
    });
}
