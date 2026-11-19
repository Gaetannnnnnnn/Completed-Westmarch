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
// arrêtée, jouer aussi chez le MJ. Réglage du module : enableSceneMusic.
//
// Le MJ la pilote depuis l'onglet Playlists : section « Musiques de scène »
// (scènes réglées où se trouve quelqu'un) avec arrêt / relance et volume.
// © 2026 Soruta.
// ============================================================

const FLAG = "sceneMusic";
const actif = () => { try { return game.settings.get(MOD, "enableSceneMusic") !== false; } catch { return false; } };
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const DEFAUT = { path: "", volume: 0.5, loop: true, fade: 2, gm: true, stopped: false };

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
    const veut = actif() && !!scene && !!cfg.path && !cfg.stopped && (!game.user.isGM || cfg.gm !== false);
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
            <label>${tl("Arrêtée")}</label>
            <div class="form-fields"><input type="checkbox" name="${n("stopped")}" ${c.stopped ? "checked" : ""}></div>
            <p class="hint">${tl("Coupe la musique chez tout le monde sur cette scène, sans perdre le réglage. Aussi faisable depuis l'onglet Playlists (« Musiques de scène »).")}</p>
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
// ONGLET PLAYLISTS (MJ) : « Musiques de scène »
// Les musiques de scène ne sont pas des playlists Foundry (elles sont jouées
// séparément chez chaque client). Cette section les rend visibles et
// pilotables : une ligne par scène réglée où quelqu'un se trouve, avec
// arrêt / relance et volume. Agir modifie le réglage de la scène : tous les
// clients qui la regardent suivent aussitôt.
// ------------------------------------------------------------------
const nomFichier = (p) => { try { return decodeURIComponent(String(p).split("/").pop()).replace(/\.[^.]+$/, ""); } catch { return String(p); } };

function scenesAvecMusique() {
    return game.scenes.filter(s => lireCfg(s).path)
        .map(s => ({ s, cfg: lireCfg(s), ici: game.users.filter(u => u.active && u.viewedScene === s.id) }))
        .filter(x => x.ici.length)
        .sort((a, b) => b.ici.length - a.ici.length || a.s.name.localeCompare(b.s.name));
}

function sectionPlaylists(app, html) {
    if (!actif() || !game.user.isGM) return;
    const root = (html instanceof HTMLElement) ? html : (html?.[0] ?? app?.element);
    if (!root) return;
    root.querySelector(".scwm-sm-sidebar")?.remove();
    const liste = scenesAvecMusique();
    if (!liste.length) return;

    const lignes = liste.map(({ s, cfg, ici }) => {
        const noms = ici.map(u => u.name).join(", ");
        return `<li class="scwm-sm-ligne" data-scene="${esc(s.id)}" style="display:flex;flex-direction:column;gap:2px;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);${cfg.stopped ? "opacity:.6;" : ""}">
            <div style="display:flex;align-items:center;gap:6px;">
                <button type="button" class="scwm-sm-basculer" data-tooltip="${cfg.stopped ? tl("Relancer la musique") : tl("Arrêter la musique")}"
                    style="flex:0 0 26px;width:26px;height:24px;padding:0;margin:0;line-height:1;"><i class="fa-solid ${cfg.stopped ? "fa-play" : "fa-stop"}"></i></button>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                    <div style="font-size:11px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${esc(cfg.path)}">
                        <i class="fa-solid fa-music"></i> ${esc(nomFichier(cfg.path))}${cfg.loop ? ` <i class="fa-solid fa-repeat" data-tooltip="${tl("En boucle")}"></i>` : ""}${cfg.stopped ? ` — ${tl("arrêtée")}` : ""}</div>
                </div>
                <span style="flex:0 0 auto;font-size:11px;opacity:.8;" data-tooltip="${esc(noms)}"><i class="fa-solid fa-users"></i> ${ici.length}</span>
            </div>
            <input type="range" class="scwm-sm-volume" min="0" max="1" step="0.05" value="${Number(cfg.volume)}" data-tooltip="${tl("Volume")}" style="width:100%;margin:0;">
        </li>`;
    }).join("");

    const sec = document.createElement("section");
    sec.className = "scwm-sm-sidebar";
    sec.style.cssText = "margin:4px 6px 6px;border:1px solid rgba(201,162,39,.45);border-radius:5px;background:rgba(0,0,0,.2);";
    sec.innerHTML = `<header style="display:flex;align-items:center;gap:6px;padding:4px 6px;font-weight:600;border-bottom:1px solid rgba(201,162,39,.3);">
            <i class="fa-solid fa-map"></i> ${tl("Musiques de scène")}
            <span style="font-weight:400;font-size:11px;opacity:.7;">${tl("(chez les groupes)")}</span></header>
        <ol style="list-style:none;margin:0;padding:0;">${lignes}</ol>`;

    sec.querySelectorAll(".scwm-sm-ligne").forEach(li => {
        const scene = game.scenes.get(li.dataset.scene);
        if (!scene) return;
        li.querySelector(".scwm-sm-basculer")?.addEventListener("click", async (ev) => {
            ev.preventDefault();
            await scene.setFlag(MOD, `${FLAG}.stopped`, !lireCfg(scene).stopped);
        });
        li.querySelector(".scwm-sm-volume")?.addEventListener("change", async (ev) => {
            await scene.setFlag(MOD, `${FLAG}.volume`, Number(ev.currentTarget.value));
        });
    });

    const repere = root.querySelector(".directory-list");
    if (repere) repere.insertAdjacentElement("beforebegin", sec);
    else root.prepend(sec);
}
const rafraichirPlaylists = foundry.utils.debounce(() => {
    if (game.user?.isGM && ui.playlists?.rendered) ui.playlists.render();
}, 250);

// ------------------------------------------------------------------
export function SceneMusicHooks() {
    Hooks.on("renderSceneConfig", (app, html) => {
        try { injecter(app, html); } catch (e) { journal.avert(tl("[{0}] Musique de scène (configuration) :", MOD), e); }
    });
    Hooks.on("closeSceneConfig", () => { arreterTest(); });

    Hooks.on("canvasReady", (canvas) => { appliquer(canvas?.scene ?? null); });
    Hooks.on("updateScene", (scene, changes) => {
        const musique = foundry.utils.hasProperty(changes, `flags.${MOD}.${FLAG}`);
        if (musique || "name" in changes) rafraichirPlaylists();
        if (!musique || scene.id !== canvas?.scene?.id) return;
        appliquer(scene);
    });

    // Onglet Playlists du MJ : section « Musiques de scène », tenue à jour
    // quand un joueur change de scène, se connecte ou se déconnecte.
    Hooks.on("renderPlaylistDirectory", (app, html) => {
        try { sectionPlaylists(app, html); } catch (e) { journal.avert(tl("[{0}] Musique de scène (onglet Playlists) :", MOD), e); }
    });
    Hooks.on("updateUser", (user, changes) => { if ("viewedScene" in changes || "active" in changes) rafraichirPlaylists(); });
    Hooks.on("userConnected", () => rafraichirPlaylists());
    // La barre des scènes se redessine quand un joueur change de scène (ses
    // pastilles de joueurs) : bon signal pour remettre la section à jour.
    Hooks.on("renderSceneNavigation", () => rafraichirPlaylists());
    Hooks.on("deleteScene", () => rafraichirPlaylists());
    // Réglage du module désactivé/réactivé : on applique tout de suite.
    Hooks.on("updateSetting", (setting) => {
        if (setting?.key === `${MOD}.enableSceneMusic`) appliquer(canvas?.scene ?? null);
    });
}
