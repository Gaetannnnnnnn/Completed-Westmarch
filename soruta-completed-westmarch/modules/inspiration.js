// ============================================================
// inspiration.js — Inspiration héroïque (règles 2024)
//
//   - Humain, Ingénieux (Resourceful) : à la fin d'un repos long, le
//     personnage obtient l'Inspiration héroïque (case cochée sur la fiche).
//   - Don Musicien (Musician, Encouraging Song) : à la fin d'un repos court ou
//     long, le joueur du musicien choisit jusqu'à « bonus de maîtrise » alliés
//     qui reçoivent l'Inspiration héroïque. Le client MJ actif fait l'écriture
//     (un joueur ne peut pas modifier la fiche d'un autre).
//
// dnd5e affiche bien ces capacités sur la carte de fin de repos, mais ne coche
// pas l'Inspiration. Priorité aux automatisations existantes : si l'objet est
// préparé par Midi-QOL (macro onUse) ou un module de « premades », le module ne
// fait rien pour lui (même test que initiative-recup.js).
// Réglages : enableResourcefulInspiration (Espèces → Humain) et
// enableMusicianInspiration (Features → Musician).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
import { dejaAutomatise } from "./initiative-recup.js";

const QUERY = "completed-westmarch.heroicInspiration";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reglage = (cle) => { try { return game.settings.get(MOD, cle) === true; } catch { return false; } };
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function trait(actor, id, noms) {
    const ns = noms.map(norm);
    return actor?.items?.find?.(i => i.system?.identifier === id || ns.includes(norm(i.name)));
}
export const ingenieux = (actor) => trait(actor, "resourceful", ["Resourceful", "Ingénieux", "Débrouillard"]);
export const musicien = (actor) => trait(actor, "musician", ["Musician", "Musicien"]);

const aInspiration = (actor) => actor?.system?.attributes?.inspiration === true;

async function annoncer(source, cibles, titre) {
    try {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: source }),
            content: `<p><i class="fa-solid fa-star"></i> ${tl("<strong>{0}</strong> : Inspiration héroïque pour {1}.", esc(titre), cibles.map(a => `<strong>${esc(a.name)}</strong>`).join(", "))}</p>`
        });
    } catch { /* */ }
}

// Donne l'Inspiration (côté MJ) : vérifie le musicien et le nombre d'alliés.
async function donnerParMusicien(sourceId, actorIds) {
    const source = game.actors.get(sourceId);
    const don = musicien(source);
    if (!source || !don) return false;
    const pb = Number(source.system?.attributes?.prof ?? 2) || 2;
    const cibles = [...new Set(actorIds)].slice(0, pb).map(id => game.actors.get(id)).filter(a => a && a.id !== source.id);
    const aDonner = cibles.filter(a => !aInspiration(a));
    for (const a of aDonner) await a.update({ "system.attributes.inspiration": true });
    if (cibles.length) await annoncer(source, cibles, don.name);
    return true;
}

// Fenêtre de choix des alliés (client du joueur du musicien).
async function choisirAllies(actor, don) {
    const pb = Number(actor.system?.attributes?.prof ?? 2) || 2;
    const allies = (game.actors?.filter?.(a => a.type === "character" && a.hasPlayerOwner && a.id !== actor.id) ?? [])
        .sort((a, b) => a.name.localeCompare(b.name));
    if (!allies.length) return;
    const uid = `scwm-musicien-${actor.id}`;
    const lignes = allies.map(a => `<label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;">
        <input type="checkbox" name="allie" value="${a.id}">
        <img src="${esc(a.img ?? "icons/svg/mystery-man.svg")}" style="width:28px;height:28px;border:none;object-fit:cover;">
        <span style="flex:1;">${esc(a.name)}</span>${aInspiration(a) ? `<em style="opacity:.7;">${tl("déjà inspiré")}</em>` : ""}</label>`).join("");
    let choix = [];
    await foundry.applications.api.DialogV2.wait({
        window: { title: `${don.name} — ${actor.name}`, icon: "fa-solid fa-music" },
        position: { width: 400 },
        rejectClose: false,
        content: `<div id="${uid}"><p style="margin:0 0 6px;">${tl("Chanson d'encouragement : choisis jusqu'à <strong>{0}</strong> allié(s) qui reçoivent l'Inspiration héroïque.", pb)}</p>
            <div style="max-height:320px;overflow-y:auto;">${lignes}</div></div>`,
        render: (ev, dialog) => {
            const root = dialog.element?.querySelector?.(`#${uid}`) ?? document.getElementById(uid);
            root?.addEventListener("change", () => {
                const coches = root.querySelectorAll("input[name=allie]:checked");
                root.querySelectorAll("input[name=allie]:not(:checked)").forEach(i => { i.disabled = coches.length >= pb; });
            });
        },
        buttons: [
            { action: "ok", label: tl("Inspirer"), icon: "fa-solid fa-music", default: true,
              callback: () => { choix = [...document.querySelectorAll(`#${uid} input[name="allie"]:checked`)].map(i => i.value); } },
            { action: "cancel", label: tl("Pas cette fois"), icon: "fa-solid fa-xmark" }
        ]
    });
    if (!choix.length) return;
    if (game.user.isGM) return donnerParMusicien(actor.id, choix);
    const mj = game.users?.activeGM;
    if (!mj) { ui.notifications?.warn(tl("Aucun MJ connecté : l'Inspiration héroïque ne peut pas être donnée aux autres personnages.")); return; }
    try { await mj.query(QUERY, { sourceId: actor.id, actorIds: choix }); }
    catch (e) { journal.erreur(tl("[{0}] Inspiration héroïque (Musicien) :", MOD), e); }
}

export function InspirationHooks() {
    // Tous les clients : le MJ actif traite les demandes des joueurs.
    CONFIG.queries[QUERY] = async ({ sourceId, actorIds } = {}) => {
        if (!game.user.isGM || !reglage("enableMusicianInspiration")) return false;
        return donnerParMusicien(sourceId, Array.isArray(actorIds) ? actorIds : []);
    };

    // Fin de repos : le hook ne se déclenche que sur le client qui a fait le repos.
    Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
        try {
            if (!actor?.isOwner || actor.type !== "character") return;
            const long = (config?.type ?? result?.type ?? (result?.longRest ? "long" : "short")) === "long";

            const ing = ingenieux(actor);
            if (long && ing && reglage("enableResourcefulInspiration") && !dejaAutomatise(ing) && !aInspiration(actor)) {
                await actor.update({ "system.attributes.inspiration": true });
                await annoncer(actor, [actor], ing.name);
            }

            const mus = musicien(actor);
            if (mus && reglage("enableMusicianInspiration") && !dejaAutomatise(mus)) await choisirAllies(actor, mus);
        } catch (e) {
            journal.erreur(tl("[{0}] Inspiration héroïque après le repos :", MOD), e);
        }
    });
}
