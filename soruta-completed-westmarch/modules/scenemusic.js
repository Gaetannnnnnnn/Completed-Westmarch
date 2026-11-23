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
// (scènes réglées où se trouve quelqu'un) avec arrêt / relance et volume
// POUR TOUT LE MONDE, et section « Musique du groupe » (le groupe du MJ qui
// regarde, lui seul) : pause, autre musique, boucle ou volume pour ce
// groupe seulement (voir partyMusic plus bas).
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

const ARRETES = new WeakSet();   // sons arrêtés volontairement (pas une « fin » de morceau)
async function arreter(fadeS = 1) {
    const c = _courant; _courant = null;
    if (!c?.sound) return;
    ARRETES.add(c.sound);
    // Pas d'attente : l'ancienne musique s'éteint pendant que la nouvelle monte (fondu enchaîné).
    try { Promise.resolve(c.sound.stop({ fade: Math.max(0, fadeS) * 1000 })).catch(() => {}); }
    catch { try { c.sound.stop(); } catch { /* */ } }
}

// ------------------------------------------------------------------
// GROUPES (parties) : contrôle de la musique PAR GROUPE
// Le groupe d'un utilisateur = flag partyId (id du MJ chef du groupe).
// L'état musical du groupe est stocké sur le MJ chef : flag partyMusic
//   { mode: "scene" | "stopped" | "custom", path, volume, loop }
//   - scene   : le groupe entend la musique de la scène où il est (suit
//               l'arrêt global de la scène) — mode posé à la création ;
//   - stopped : arrêtée pour CE groupe seulement ;
//   - custom  : une autre musique pour ce groupe seulement (quelle que soit
//               la scène, même si la musique de la scène est arrêtée).
// Sans groupe (ou groupe sans état) : la musique de la scène, réglage global.
// ------------------------------------------------------------------
const PFLAG = "partyMusic";
export const chefDe = (user) => { const pid = user?.getFlag?.(MOD, "partyId"); return pid ? game.users.get(pid) ?? null : null; };
export const etatGroupe = (chef) => chef?.getFlag?.(MOD, PFLAG) ?? null;
// Passe au morceau suivant de la file d'attente du groupe. Renvoie false si
// la file est vide.
export async function avancerFile(chefId) {
    const e = etatGroupe(game.users.get(chefId));
    const file = e?.queue ?? [];
    if (!file.length) return false;
    const [suivant, ...reste] = file;
    await definirEtatGroupe(chefId, { ...e, mode: "custom", path: suivant.path, nom: suivant.name, queue: reste, history: avecHistorique(e) });
    return true;
}

// ---- Historique (bouton ⏮ « Musique précédente ») ----
// Chaque fois que le groupe change de morceau (suivant, autre musique,
// retour à la scène), ce qu'il écoutait est mémorisé (20 au plus) :
//   { path, name } pour un morceau choisi, { scene: true } pour la musique
//   de la scène.
const HIST_MAX = 20;
const entreeCourante = (e) => (e?.mode === "custom" && e.path) ? { path: e.path, name: e.nom ?? "" }
    : (!e || !e.mode || e.mode === "scene") ? { scene: true } : null;
export function avecHistorique(e) {
    const h = [...(e?.history ?? [])];
    const c = entreeCourante(e);
    const dernier = h[h.length - 1];
    if (c && !(dernier && (c.scene ? dernier.scene : dernier.path === c.path))) h.push(c);
    return h.slice(-HIST_MAX);
}
// Revient au morceau précédent ; le morceau en cours repasse en tête de la
// file d'attente (⏭ le retrouve). Renvoie false si l'historique est vide.
export async function morceauPrecedent(chefId) {
    const e = etatGroupe(game.users.get(chefId));
    const h = [...(e?.history ?? [])];
    if (!h.length) return false;
    const prec = h.pop();
    const c = entreeCourante(e);
    const queue = (c && !c.scene) ? [c, ...(e.queue ?? [])] : [...(e.queue ?? [])];
    if (prec.scene) await definirEtatGroupe(chefId, { ...e, mode: "scene", history: h, queue });
    else await definirEtatGroupe(chefId, { ...e, mode: "custom", path: prec.path, nom: prec.name, history: h, queue });
    return true;
}
export async function definirEtatGroupe(chefId, etat) {
    const chef = game.users.get(chefId);
    if (!chef || !game.user.isGM) return;
    if (etat == null) return chef.unsetFlag(MOD, PFLAG);
    return chef.setFlag(MOD, PFLAG, etat);
}

// Ce que CE client doit entendre sur cette scène : { path, volume, loop, fade } ou null.
function musiqueVoulue(scene) {
    if (!actif() || !scene) return null;
    const cfg = lireCfg(scene);
    if (game.user.isGM && cfg.gm === false && !chefDe(game.user)) return null;
    const chef = chefDe(game.user);
    const pm = etatGroupe(chef);
    const fade = Number(cfg.fade) || 2;
    // File d'attente non vide : le morceau en cours ne boucle pas, pour que
    // le suivant puisse démarrer à la fin.
    const attente = (pm?.queue?.length ?? 0) > 0;
    const groupe = pm ? chef.id : null;
    if (pm?.mode === "stopped") return null;
    if (pm?.mode === "custom" && pm.path) {
        return { path: pm.path, volume: pm.volume ?? 0.5, loop: pm.loop !== false && !attente, fade, groupe };
    }
    if (!cfg.path || cfg.stopped) return null;
    // « Pas chez le MJ » : sauf pour le MJ chef quand une file d'attente
    // attend la fin du morceau (c'est sa lecture qui déclenche le suivant).
    if (game.user.isGM && cfg.gm === false && !(attente && groupe === game.user.id)) return null;
    return { path: cfg.path, volume: pm?.volume ?? cfg.volume, loop: (pm?.loop ?? cfg.loop) && !attente, fade, groupe };
}

async function appliquer(scene) {
    const mon = ++_jeton;
    const voulue = musiqueVoulue(scene);
    const cfg = voulue ?? lireCfg(scene);
    const veut = !!voulue;
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
        // Fin naturelle du morceau chez le MJ chef du groupe : il passe au
        // suivant de la file d'attente (une seule personne décide, pas de doublon).
        if (voulue?.groupe && voulue.groupe === game.user.id) {
            sound.addEventListener?.("end", () => {
                if (ARRETES.has(sound) || _courant?.sound !== sound) return;
                avancerFile(voulue.groupe).catch(() => {});
            });
        }
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
        <legend><i class="fa-solid fa-music"></i> ${tl("Musique de la scène")}</legend>
        <p class="hint">${tl("Jouée pour TOUS ceux qui ont cette scène à l'écran, même si elle n'est pas active. Elle s'arrête en quittant la scène, et continue sans coupure si la scène suivante a la même musique. Le MJ d'un groupe peut la mettre en pause ou la remplacer pour son groupe seulement, depuis l'onglet Playlists (« Musique du groupe »).")}</p>
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
    return game.scenes.filter(s => String(lireCfg(s).path ?? "").trim())
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
                        <i class="fa-solid fa-music"></i> ${esc(nomFichier(cfg.path))}${cfg.stopped ? ` — ${tl("arrêtée")}` : ""}</div>
                </div>
                <button type="button" class="scwm-sm-boucle${cfg.loop ? " scwm-actif" : ""}" data-tooltip="${cfg.loop ? tl("En boucle : cliquer pour jouer une seule fois") : tl("Une seule fois : cliquer pour jouer en boucle")}"
                    style="flex:0 0 26px;width:26px;height:24px;padding:0;margin:0;${cfg.loop ? "color:#c9a227;border-color:#c9a227;" : "opacity:.6;"}"><i class="fa-solid fa-repeat"></i></button>
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
            <span style="font-weight:400;font-size:11px;opacity:.7;">${tl("(chez tout le monde)")}</span></header>
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
        li.querySelector(".scwm-sm-boucle")?.addEventListener("click", async (ev) => {
            ev.preventDefault();
            await scene.setFlag(MOD, `${FLAG}.loop`, !lireCfg(scene).loop);
        });
    });

    const repere = root.querySelector(".directory-list");
    if (repere) repere.insertAdjacentElement("beforebegin", sec);
    else root.prepend(sec);
}

// Scène d'un groupe : d'abord les scènes des joueurs connectés (avec musique
// en priorité), puis celle du MJ chef.
function sceneDuGroupe(chef, membres) {
    const ids = [...new Set([...membres, chef].filter(u => u?.active && u.viewedScene).map(u => u.viewedScene))];
    const scenes = ids.map(id => game.scenes.get(id)).filter(Boolean);
    return scenes.find(sc => String(lireCfg(sc).path ?? "").trim()) ?? scenes[0] ?? null;
}

// Groupes existants : chaque MJ chef (partyId = son propre id) et ses membres.
function groupes() {
    return game.users.filter(u => u.isGM && u.getFlag(MOD, "partyId") === u.id).map(chef => ({
        chef,
        membres: game.users.filter(u => u.id !== chef.id && u.getFlag(MOD, "partyId") === chef.id),
        etat: etatGroupe(chef)
    }));
}

function sectionGroupes(root) {
    root.querySelector(".scwm-smg-sidebar")?.remove();
    // Groupe concerné : sur une scène qui a une musique configurée, ou avec
    // une musique à lui.
    // Scène du groupe : celle où sont les JOUEURS du groupe (le MJ chef peut
    // regarder ailleurs), de préférence une scène qui a une musique.
    const sceneDe = (g) => sceneDuGroupe(g.chef, g.membres);
    // Seulement le groupe DU MJ qui regarde (celui dont il fait partie).
    const monGroupe = game.user.getFlag(MOD, "partyId");
    const liste = groupes().filter(g => g.chef.id === monGroupe)
        .filter(g => g.etat?.mode === "custom" || g.etat?.mode === "stopped" || g.etat?.queue?.length
            || String(lireCfg(sceneDe(g)).path ?? "").trim());
    if (!liste.length) return;
    const lignes = liste.map(({ chef, membres, etat }) => {
        const enLigne = [chef, ...membres].filter(u => u.active);
        const scene = sceneDuGroupe(chef, membres);
        const cfgScene = scene ? lireCfg(scene) : null;
        const mode = etat?.mode ?? "scene";
        let quoi;
        if (mode === "stopped") quoi = `<i class="fa-solid fa-volume-xmark"></i> ${tl("arrêtée pour ce groupe")}`;
        else if (mode === "custom") quoi = `<i class="fa-solid fa-music"></i> ${esc(etat.nom || nomFichier(etat.path))} <em>(${tl("musique du groupe")})</em>`;
        else if (cfgScene?.path) quoi = `<i class="fa-solid fa-map"></i> ${esc(nomFichier(cfgScene.path))}${cfgScene.stopped ? ` — ${tl("arrêtée (scène)")}` : ""}`;
        else quoi = `<i class="fa-solid fa-map"></i> <em>${tl("pas de musique sur la scène")}</em>`;
        const vol = Number(etat?.volume ?? (mode === "custom" ? 0.5 : cfgScene?.volume ?? 0.5));
        const boucle = mode === "custom" ? etat?.loop !== false : (etat?.loop ?? cfgScene?.loop ?? true);
        return `<li class="scwm-smg-ligne" data-chef="${esc(chef.id)}" style="display:flex;flex-direction:column;gap:3px;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);${mode === "stopped" ? "opacity:.65;" : ""}">
            <div style="display:flex;align-items:center;gap:6px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tl("Groupe de {0}", esc(chef.name))}
                        <span style="font-weight:400;font-size:11px;opacity:.7;" data-tooltip="${esc([chef, ...membres].map(u => u.name).join(", "))}"><i class="fa-solid fa-users"></i> ${membres.length + 1}${scene ? ` · ${esc(scene.name)}` : ""}</span></div>
                    <div style="font-size:11px;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${quoi}</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;">
                <button type="button" class="scwm-smg-act" data-act="${mode === "stopped" ? "scene" : "stop"}" data-tooltip="${mode === "stopped" ? tl("Relancer la musique de la scène pour ce groupe") : tl("Arrêter la musique pour ce groupe seulement")}"
                    style="flex:0 0 26px;width:26px;height:24px;padding:0;margin:0;"><i class="fa-solid ${mode === "stopped" ? "fa-play" : "fa-stop"}"></i></button>
                <button type="button" class="scwm-smg-act" data-act="autre" data-tooltip="${tl("Jouer une autre musique pour ce groupe seulement")}"
                    style="flex:0 0 26px;width:26px;height:24px;padding:0;margin:0;"><i class="fa-solid fa-list"></i></button>
                ${(() => {
                    const prec = (etat?.history ?? []).at(-1);
                    const nomPrec = prec ? (prec.scene ? tl("musique de la scène") : (prec.name || nomFichier(prec.path))) : "";
                    return `<button type="button" class="scwm-smg-act" data-act="prec" ${prec ? "" : "disabled"}
                        data-tooltip="${prec ? esc(tl("Musique précédente : {0}", nomPrec)) : tl("Aucune musique précédente")}"
                        style="flex:0 0 26px;width:26px;height:24px;padding:0;margin:0;"><i class="fa-solid fa-backward-step"></i></button>`;
                })()}
                <button type="button" class="scwm-smg-act" data-act="skip" data-tooltip="${(etat?.queue?.length) ? tl("Passer au morceau suivant de la file d'attente") : (mode === "custom" ? tl("Passer : revenir à la musique de la scène") : tl("File d'attente vide"))}"
                    ${(etat?.queue?.length || mode === "custom") ? "" : "disabled"}
                    style="flex:0 0 26px;width:26px;height:24px;padding:0;margin:0;"><i class="fa-solid fa-forward-step"></i></button>
                ${mode === "custom" ? `<button type="button" class="scwm-smg-act" data-act="scene" data-tooltip="${tl("Revenir à la musique de la scène")}"
                    style="flex:0 0 26px;width:26px;height:24px;padding:0;margin:0;"><i class="fa-solid fa-rotate-left"></i></button>` : ""}
                <button type="button" class="scwm-smg-act" data-act="boucle" data-tooltip="${boucle ? tl("En boucle : cliquer pour jouer une seule fois") : tl("Une seule fois : cliquer pour jouer en boucle")}"
                    style="flex:0 0 26px;width:26px;height:24px;padding:0;margin:0;${boucle ? "color:#6aa8e8;border-color:#6aa8e8;" : "opacity:.6;"}"><i class="fa-solid fa-repeat"></i></button>
                <input type="range" class="scwm-smg-volume" min="0" max="1" step="0.05" value="${vol}" data-tooltip="${tl("Volume pour ce groupe")}" style="flex:1;margin:0;">
            </div>
            ${(etat?.queue?.length) ? `<div class="scwm-smg-file" style="margin-top:2px;padding:3px 0 0;border-top:1px dashed rgba(106,168,232,.35);">
                <div style="display:flex;align-items:center;gap:6px;font-size:11px;opacity:.8;">
                    <i class="fa-solid fa-list-ol"></i> ${tl("File d'attente ({0})", etat.queue.length)}
                    <a class="scwm-smg-vider" style="margin-left:auto;cursor:pointer;" data-tooltip="${tl("Vider la file d'attente")}"><i class="fa-solid fa-trash"></i></a>
                </div>
                <ol style="margin:2px 0 0;padding-left:20px;font-size:11px;">
                    ${etat.queue.map((q, i) => `<li style="display:flex;align-items:center;gap:4px;">
                        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${esc(q.path)}">${esc(q.name || nomFichier(q.path))}</span>
                        <a class="scwm-smg-retirer" data-i="${i}" style="cursor:pointer;opacity:.7;" data-tooltip="${tl("Retirer de la file")}"><i class="fa-solid fa-xmark"></i></a>
                    </li>`).join("")}
                </ol>
            </div>` : ""}
        </li>`;
    }).join("");
    const sec = document.createElement("section");
    sec.className = "scwm-smg-sidebar";
    sec.style.cssText = "margin:0 6px 6px;border:1px solid rgba(106,168,232,.45);border-radius:5px;background:rgba(0,0,0,.2);";
    sec.innerHTML = `<header style="display:flex;align-items:center;gap:6px;padding:4px 6px;font-weight:600;border-bottom:1px solid rgba(106,168,232,.3);">
            <i class="fa-solid fa-users"></i> ${tl("Musique du groupe")}</header>
        <ol style="list-style:none;margin:0;padding:0;">${lignes}</ol>`;
    sec.querySelectorAll(".scwm-smg-ligne").forEach(li => {
        const chefId = li.dataset.chef;
        const etat = () => etatGroupe(game.users.get(chefId)) ?? { mode: "scene" };
        li.querySelectorAll(".scwm-smg-act").forEach(b => b.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const act = b.dataset.act;
            if (act === "stop")  return definirEtatGroupe(chefId, { ...etat(), mode: "stopped" });
            if (act === "scene") return definirEtatGroupe(chefId, { ...etat(), mode: "scene", history: avecHistorique(etat()) });
            if (act === "prec") {
                if (!(await morceauPrecedent(chefId))) ui.notifications?.info(tl("Aucune musique précédente."));
                return;
            }
            if (act === "boucle") {
                const e = etat();
                const chef = game.users.get(chefId);
                const sc = game.scenes.get([chef, ...game.users.filter(u => u.getFlag(MOD, "partyId") === chefId)].find(u => u?.active && u.viewedScene)?.viewedScene);
                const actuelle = e.mode === "custom" ? e.loop !== false : (e.loop ?? (sc ? lireCfg(sc).loop : true));
                return definirEtatGroupe(chefId, { ...e, loop: !actuelle });
            }
            if (act === "autre") {
                _openPlaylistBrowser(
                    (path, name) => definirEtatGroupe(chefId, { ...etat(), mode: "custom", path, nom: name, volume: etat().volume ?? 0.5, loop: etat().loop ?? true, history: avecHistorique(etat()) }),
                    {
                        titre: tl("Musique du groupe — choisir ou mettre en file d'attente"),
                        onQueue: (path, name) => { const e = etat(); return definirEtatGroupe(chefId, { ...e, queue: [...(e.queue ?? []), { path, name }] }); }
                    });
            }
            if (act === "skip") {
                if (await avancerFile(chefId)) return;
                const e = etat();
                if (e.mode === "custom") return definirEtatGroupe(chefId, { ...e, mode: "scene", queue: [], history: avecHistorique(e) });
                ui.notifications?.info(tl("File d'attente vide."));
            }
        }));
        li.querySelector(".scwm-smg-vider")?.addEventListener("click", () => definirEtatGroupe(chefId, { ...etat(), queue: [] }));
        li.querySelectorAll(".scwm-smg-retirer").forEach(x => x.addEventListener("click", () => {
            const e = etat(); const q = [...(e.queue ?? [])]; q.splice(Number(x.dataset.i), 1);
            definirEtatGroupe(chefId, { ...e, queue: q });
        }));
        li.querySelector(".scwm-smg-volume")?.addEventListener("change", (ev) =>
            definirEtatGroupe(chefId, { ...etat(), volume: Number(ev.currentTarget.value) }));
    });
    const apres = root.querySelector(".scwm-sm-sidebar");
    if (apres) apres.insertAdjacentElement("afterend", sec);
    else {
        const repere = root.querySelector(".directory-list");
        if (repere) repere.insertAdjacentElement("beforebegin", sec); else root.prepend(sec);
    }
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
        try {
            const root = (html instanceof HTMLElement) ? html : (html?.[0] ?? app?.element);
            if (root && actif() && game.user.isGM) sectionGroupes(root);
        } catch (e) { journal.avert(tl("[{0}] Musique par groupe (onglet Playlists) :", MOD), e); }
    });
    Hooks.on("updateUser", (user, changes) => {
        const groupe = foundry.utils.hasProperty(changes, `flags.${MOD}.${PFLAG}`)
            || foundry.utils.hasProperty(changes, `flags.${MOD}.partyId`)
            || foundry.utils.hasProperty(changes, `flags.${MOD}.-=${PFLAG}`)
            || foundry.utils.hasProperty(changes, `flags.${MOD}.-=partyId`);
        if ("viewedScene" in changes || "active" in changes || groupe) rafraichirPlaylists();
        // Mon groupe a changé (j'y entre / en sors), ou l'état musical de mon groupe a changé.
        if (groupe && (user.id === game.user.id || user.id === game.user.getFlag(MOD, "partyId"))) appliquer(canvas?.scene ?? null);
    });
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
