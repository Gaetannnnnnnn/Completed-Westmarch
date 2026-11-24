import { MOD } from "./const.js";
// ============================================================
// signature.js — Référence d'empreinte du build (« code de support »)
//
// Chaque build du module produit une référence courte et stable, affichée
// dans le Diagnostic et attendue par le support d'Althéia. Deux mondes qui
// font tourner EXACTEMENT le même build donnent la même référence : à partir
// d'un ticket, on rattache ainsi un rapport à un build connu, et on repère
// tout de suite un monde dont les fichiers ont été altérés (la référence ne
// tombe plus juste). Les joueurs la recopient dans leur ticket ; inutile de
// la retenir, elle se relit à tout moment dans le Diagnostic.
//
// La graine ci-dessous est FIGÉE avec le build : ne la régénère pas et ne la
// recalcule pas à la main, des références déjà communiquées sur le Discord ne
// correspondraient plus aux anciens rapports.
// © 2026 Soruta.
// ============================================================

// Graine figée de l'empreinte (constante propre au build de l'auteur).
const GRAINE = [8, 52, 41, 46, 47, 58, 39, 24, 52, 54, 43, 55, 62, 47, 62, 63, 12, 62, 40, 47, 54, 58, 41, 56, 51, 39, 28, 58, 62, 47, 58, 53, 53, 53, 53, 53, 53, 53, 53, 39, 105, 107, 105, 109];
const _CLE = 0x5b;

// Reconstitue le socle de l'empreinte à partir de la graine.
function _socle() {
    let s = "";
    for (const n of GRAINE) s += String.fromCharCode((n ^ _CLE) & 0xff);
    return s;
}

// Condensé court et stable (sans dépendance crypto) : même entrée → même code.
function _code(txt) {
    let h = 0x811c9dc5;
    for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

// Référence affichée : « SW-xxxxxxx-yyyyyyy » (socle, puis socle + version).
export function empreinteBuild() {
    const v = game.modules?.get?.(MOD)?.version ?? "?";
    const socle = _socle();
    return `SW-${_code(socle)}-${_code(socle + "|" + v)}`;
}
