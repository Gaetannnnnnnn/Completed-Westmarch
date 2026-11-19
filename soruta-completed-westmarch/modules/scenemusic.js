import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
import { _openPlaylistBrowser } from "./sceneaudio.js";
// ============================================================
// scenemusic.js — Musique de scène (pour le groupe qui la regarde)
//
// Foundry ne lance la musique d'une scène (playlist / son de l'onglet
// Ambiance) que quand la scène est ACTIVÉE, et pour tout le monde. En West
// Marches, chaque groupe est sur sa propre scène, rarement l'active.
//
// Ici, la musique est réglée dans la configuration de la scène, onglet
// « Autres » (v14 ; « Ambiance » en v13), et elle est jouée chez CHAQUE
// personne qui a cette scène à l'écran : le groupe qui y est, que la scène
// soit active ou non. Elle s'arrête (fondu) quand on quitte la scène ; si la
// scène suivante a la même musique, elle continue sans coupure.
//
// Lecture locale sur chaque client, dans le canal « Musique » de Foundry : le
// curseur de volume « Musique » de chaque joueur s'applique. Aucune diffusion
// réseau, aucun document Playlist n'est modifié.
//
// Réglages par scène (flag sceneMusic) : fichier, volume, boucle, fondu,
// jouer aussi chez le MJ. Réglage du module : enableSceneMusic (Toolkit).
// © 2026 Soruta.
// ============================================================

const FLAG = "sceneMusic";
const actif = () => { try { return game.settings.get(MOD, "enableSceneMusic") !== false; } catch { return false; } };
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const DEFAUT = { path: "", volume: 0.5, loop: true, fade: 2, gm: true };

function lireCfg(scene) {
    const f = scene?.getFlag?.(MOD, FLAG);
    return { ...DEFAUT, ...(f ?? {}) };
}

// ------------------------------------------------------------------
// LECTURE
// ------------------------------------------------------------------
let _courant = null;     // { path, sound }
let _jeton = 0;          // annule une lecture devenue obsolète (changements de scène rapides)

async function arreter(fadeS = 1) {
    const c = _courant; _courant = null;
    if (!c?.sound) return;
    // Pas d'attente : l'ancienne musique s'éteint pendant que la nouvelle monte (fondu enchaîné).
    try { Promise.resolve(c.sound.stop({ fade: Math.max(0, fadeS) * 1000 })).catch(() => {}); }
    catch { try { c.sound.stop(); } catch { /* */ } }
}

async function appliquer(scene) {
    const mon = ++_jeton;
    const cfg = lireCfg(scene);
    const veut = actif() && !!scene && !!cfg.path && (!game.user.isGM || cfg.gm !== false);
    const vol = Math.min(1, Math.max(0, Number(cfg.volume) || 0));

    // Même musique que la scène précédente : on continue, réglages mis à jour.
    if (veut && _courant?.path === cfg.path && _courant.sound?.playing) {
        try { _courant.sound.loop = !!cfg.loop; } catch { /* */ }
        try { _courant.sound.volume = vol; } catch { /* */ }
        return;
    }
    await arreter(Number(cfg.fade) || 1);
    if (!veut || mon !== _jeton) return;

    const Sound = foundry.audio?.Sound;
    if (!Sound) return;
    try {
        try { await game.audio?.unlock; } catch { /* attend le premier clic du joueur */ }
        if (mon !== _jeton) return;
        const ctx = game.audio?.music;
        const sound = new Sound(cfg.path, ctx ? { context: ctx } : {});
        await sound.load();
        if (mon !== _jeton) return;
        await sound.play({ loop: !!cfg.loop, volume: vol, fade: (Number(cfg.fade) || 0) * 1000 });
        _courant = { path: cfg.path, sound };
    } catch (e) {
        journal.avert(tl("[{0}] Musique de scène : lecture impossible ({1}).", MOD, cfg.path), e);
    }
}

// ------------------------------------------------------------------
// CONFIGURATION DE LA SCÈNE (onglet « Autres »)
// ------------------------------------------------------------------
function blocConfig(scene) {
    const c = lireCfg(scene);
    const n = (k) => `flags.${MOD}.${FLAG}.${k}`;
    return `
    <fieldset class="scwm-scene-music">
        <legend><i class="fa-solid fa-music"></i> ${tl("Musique de la scène (pour le groupe)")}</legend>
        <p class="hint">${tl("Jouée chez chaque personne qui a cette scène à l'écran (le groupe qui y est), même si la scène n'est pas active. Elle s'arrête en quittant la scène, et continue sans coupure si la scène suivante a la même musique.")}</p>
        <div class="form-group">
            <label>${tl("Musique")}</label>
            <div class="form-fields">
                <file-picker name="${n("path")}" type="audio" value="${esc(c.path)}"></file-picker>
                <button type="button" class="scwm-sm-playlists icon" data-tooltip="${tl("Choisir dans les playlists")}"><i class="fa-solid fa-list"></i></button>
                <button type="button" class="scwm-sm-test icon" data-tooltip="${tl("Écouter (chez vous seulement)")}"><i class="fa-solid fa-play"></i></button>
            </div>
            <p class="hint">${tl("Laisser vide : pas de musique.")}</p>
        </div>
        <div class="form-group">
            <label>${tl("Volume")}</label>
            <div class="form-fields"><range-picker name="${n("volume")}" min="0" max="1" step="0.05" value="${Number(c.volume)}"></range-picker></div>
        </div>
        <div class="form-group">
            <label>${tl("En boucle")}</label>
            <div class="form-fields"><input type="checkbox" name="${n("loop")}" ${c.loop ? "checked" : ""}></div>
            <p class="hint">${tl("Recommence au début à la fin du morceau, tant que la scène est à l'écran.")}</p>
        </div>
        <div class="form-group">
            <label>${tl("Fondu (secondes)")}</label>
            <div class="form-fields"><input type="number" name="${n("fade")}" min="0" max="20" step="0.5" value="${Number(c.fade)}"></div>
        </div>
        <div class="form-group">
            <label>${tl("Jouer aussi chez le MJ")}</label>
            <div class="form-fields"><input type="checkbox" name="${n("gm")}" ${c.gm !== false ? "checked" : ""}></div>
            <p class="hint">${tl("Décoché : seuls les joueurs l'entendent (pratique quand le MJ passe d'une scène à l'autre).")}</p>
        </div>
    </fieldset>`;
}

let _test = null;
async function arreterTest() { try { await _test?.stop?.(); } catch { /* */ } _test = null; }

function injecter(app, html) {
    if (!actif() || !game.user.isGM) return;
    const scene = app?.document;
    const root = (html instanceof HTMLElement) ? html : (html?.[0] ?? app?.element);
    if (!scene || !root || root.querySelector(".scwm-scene-music")) return;
    // v14 : onglet « Autres » (misc). Repli v13 : Ambiance, puis Général.
    const onglet = root.querySelector('.tab[data-tab="misc"], [data-application-part="misc"]')
        ?? root.querySelector('.tab[data-tab="ambience"], .tab[data-tab="environment"], [data-application-part="environment"]')
        ?? root.querySelector('.tab[data-tab="basics"], [data-application-part="basics"]');
    if (!onglet) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = blocConfig(scene);
    const bloc = tmp.firstElementChild;
    onglet.appendChild(bloc);

    const champ = bloc.querySelector("file-picker");
    bloc.querySelector(".scwm-sm-playlists")?.addEventListener("click", () => {
        _openPlaylistBrowser((path) => {
            champ.value = path;
            champ.dispatchEvent(new Event("change", { bubbles: true }));
        });
    });
    const test = bloc.querySelector(".scwm-sm-test");
    test?.addEventListener("click", async () => {
        const icone = test.querySelector("i");
        if (_test) { await arreterTest(); icone.className = "fa-solid fa-play"; return; }
        const src = champ.value;
        if (!src) return;
        const vol = Number(bloc.querySelector("range-picker")?.value ?? 0.5);
        try {
            const AH = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
            _test = await AH.play({ src, volume: vol, loop: false }, false);   // local uniquement
            icone.className = "fa-solid fa-stop";
            _test?.addEventListener?.("end", () => { _test = null; icone.className = "fa-solid fa-play"; });
        } catch (e) {
            journal.avert(tl("[{0}] Musique de scène : écoute impossible.", MOD), e);
            ui.notifications?.warn(tl("Impossible de lire ce fichier."));
        }
    });
    app.setPosition?.({ height: "auto" });
}

// ------------------------------------------------------------------
export function SceneMusicHooks() {
    Hooks.on("renderSceneConfig", (app, html) => {
        try { injecter(app, html); } catch (e) { journal.avert(tl("[{0}] Musique de scène (configuration) :", MOD), e); }
    });
    Hooks.on("closeSceneConfig", () => { arreterTest(); });

    Hooks.on("canvasReady", (canvas) => { appliquer(canvas?.scene ?? null); });
    Hooks.on("updateScene", (scene, changes) => {
        if (scene.id !== canvas?.scene?.id) return;
        if (!foundry.utils.hasProperty(changes, `flags.${MOD}.${FLAG}`)) return;
        appliquer(scene);
    });
    // Réglage du module désactivé/réactivé : on applique tout de suite.
    Hooks.on("updateSetting", (setting) => {
        if (setting?.key === `${MOD}.enableSceneMusic`) appliquer(canvas?.scene ?? null);
    });
}
