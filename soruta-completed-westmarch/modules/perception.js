// ============================================================
// perception.js — « Qui voit quoi » côté joueur
//
// Sert à la détection automatique (Relations) : seul le personnage sur
// lequel le joueur est connecté (game.user.character, réglé dans
// « Configuration du joueur ») détecte, et seulement les jetons qu'il voit
// vraiment :
//   - pas de mur ni de porte fermée qui bloque la vue entre son jeton et la
//     cible (au moins un point de la cible doit être en ligne de vue) ;
//   - si la scène utilise la vision des jetons : la cible doit aussi être
//     visible à l'écran du joueur (lumière, obscurité, vision dans le noir,
//     invisibilité… tels que Foundry les calcule) ;
//   - un jeton caché par le MJ n'est jamais vu.
// Les scènes déclarées comme « Carte des expéditions » sont exclues : aucune
// détection n'y a lieu (voir surCarteExpedition).
// © 2026 Soruta.
// ============================================================

import { expeditionSceneIds } from "./map.js";

import { journal } from "./log.js";
import { tl } from "./i18n.js";
// La scène affichée est-elle une carte des expéditions ?
export function surCarteExpedition() {
    try { return !!canvas.scene && expeditionSceneIds().includes(canvas.scene.id); } catch { return false; }
}

// Jeton du personnage connecté sur la scène affichée (celui qu'il contrôle
// en priorité s'il y en a plusieurs, ex. jetons non liés).
export function jetonDuPersonnage() {
    const perso = game.user?.character;
    if (!perso) return null;
    const jetons = (canvas.tokens?.placeables ?? []).filter(t => t.actor?.id === perso.id);
    return jetons.find(t => t.controlled) ?? jetons[0] ?? null;
}

// Points testés sur la cible : centre + 4 points vers les coins (à 25 %
// du bord), pour qu'une cible à moitié derrière un mur reste vue.
function pointsDe(t) {
    const x = t.document.x, y = t.document.y, w = t.w ?? 0, h = t.h ?? 0;
    const c = t.center ?? { x: x + w / 2, y: y + h / 2 };
    return [c, { x: x + w * .25, y: y + h * .25 }, { x: x + w * .75, y: y + h * .25 },
        { x: x + w * .25, y: y + h * .75 }, { x: x + w * .75, y: y + h * .75 }];
}

// Un mur bloque-t-il la VUE entre a et b ? Seuls les murs qui bloquent la
// vision comptent (test « sight » de Foundry) : murs de mouvement seul ou de
// son seul, portes ouvertes et murs invisibles sont ignorés ; un mur
// « limité » se comporte comme dans Foundry.
export function murEntre(a, b) {
    try {
        const backend = CONFIG.Canvas?.polygonBackends?.sight
            ?? foundry.canvas?.geometry?.ClockwiseSweepPolygon ?? globalThis.ClockwiseSweepPolygon;
        return !!backend?.testCollision?.(a, b, { type: "sight", mode: "any" });
    } catch (e) {
        journal.avert(tl("[perception] test de mur impossible"), e);
        return false;
    }
}

// Le jeton « obs » voit-il le jeton « cible » ?
export function voit(obs, cible) {
    if (!obs || !cible || obs === cible) return false;
    if (cible.document?.hidden) return false;
    const visionScene = canvas.scene?.tokenVision ?? canvas.visibility?.tokenVision ?? false;
    if (visionScene && cible.isVisible === false) return false;
    const o = obs.center ?? { x: obs.document.x + (obs.w ?? 0) / 2, y: obs.document.y + (obs.h ?? 0) / 2 };
    return pointsDe(cible).some(p => !murEntre(o, p));
}

// Ouvre une image en grand (fenêtre « portrait ») avec l'API actuelle de
// Foundry (v13+), sans passer par l'ancien nom global « ImagePopout ».
export function ouvrirImage(src, titre) {
    if (!src) return;
    const IP = foundry.applications?.apps?.ImagePopout;
    if (IP) return new IP({ src, window: { title: titre ?? "" } }).render(true);
    return new globalThis.ImagePopout(src, { title: titre }).render(true);   // anciennes versions
}

// ---- Date de rencontre (Relations, Bestiaire) ----------------------------
// { jeu: { day, month, year } | null, reel: "AAAA-MM-JJ" } : date du calendrier
// du monde (game.time.calendar, ex. Mini Calendar) si disponible, et date réelle.
export function dateDeRencontre() {
    let jeu = null;
    try {
        const cal = game.time?.calendar;
        if (cal) { const c = cal.timeToComponents(game.time.worldTime); jeu = { day: c.dayOfMonth + 1, month: c.month, year: c.year }; }
    } catch {}
    const d = new Date();
    const reel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { jeu, reel };
}
// Même jour (jeu et réel) ? Sert à n'écrire qu'une fois par jour.
export function memeRencontre(a, b) {
    if (!a || !b) return false;
    const j = (x) => x?.jeu ? `${x.jeu.year}-${x.jeu.month}-${x.jeu.day}` : "";
    return a.reel === b.reel && j(a) === j(b);
}
function nomMois(m) {
    try {
        const cal = game.time?.calendar;
        const nom = cal?.months?.values ? Array.from(cal.months.values)[m]?.name : null;
        if (nom) return game.i18n.localize(nom);
    } catch {}
    return `mois ${m + 1}`;
}
// Texte affiché : date du jeu si connue (date réelle au survol), sinon date réelle.
export function texteRencontre(r) {
    if (!r) return { texte: "", titre: "" };
    const reel = r.reel ? r.reel.split("-").reverse().join("/") : "";
    if (r.jeu) return { texte: `${r.jeu.day} ${nomMois(r.jeu.month)} ${r.jeu.year}`, titre: reel ? tl("Date réelle : {0}", reel) : "" };
    return { texte: reel, titre: tl("Date réelle (pas de calendrier de jeu)") };
}
