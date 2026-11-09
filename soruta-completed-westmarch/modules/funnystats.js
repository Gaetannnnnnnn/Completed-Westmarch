// ============================================================
// funnystats.js — FunnyStats : tableau de fin de combat
//
// À la fin de chaque combat, un tableau façon « fin de partie » (League of
// Legends) montre les stats de tout le monde : dégâts infligés et reçus,
// dégâts annulés, PV temporaires absorbés, soins sur soi / sur les autres,
// éliminations, K.O., attaques réussies, critiques, 20 et 1 naturels… avec des
// titres (MVP, Tank, Ange gardien…).
//
// Option PERSONNELLE dans « Accessibilité » (désactivée par défaut) : chaque
// joueur choisit s'il veut voir le tableau. Le relevé, lui, est fait par le
// client du MJ actif, pour tout combat en cours.
//
// Sources :
//   - PV : hooks dnd5e.damageActor / dnd5e.healActor (déclenchés sur tous les
//     clients après une mise à jour des PV, quelle qu'en soit l'origine) ;
//   - dégâts résistés : dnd5e.preCalculateDamage (brut) et dnd5e.calculateDamage
//     (après résistances / immunités / réductions). Ces calculs tournent aussi
//     pour l'aperçu de la carte « Appliquer les dégâts » (plusieurs fois, sur
//     chaque client) : on ne retient que le DERNIER calcul de l'acteur, et on ne
//     le compte qu'au moment où les dégâts sont vraiment appliqués
//     (dnd5e.applyDamage, ou à défaut dnd5e.damageActor sur le client qui a fait
//     la mise à jour), une seule fois ;
//   - attaques et dés : messages dnd5e (attaque, dégâts, soins) ou, avec
//     Midi-QOL, la fin de son déroulé (midi-qol.RollComplete : cibles touchées
//     définitives) ;
//   - historique des dés : chaque jet (Roll) des messages du chat, à leur
//     création et quand une carte est complétée (Midi-QOL ajoute ses jets à la
//     carte), avec le round et le combattant dont c'est le tour ;
//   - par round : dégâts et soins de chaque round, pour le meilleur round et la
//     moyenne de dégâts par round ;
//   - auteur d'un dégât ou d'un soin : le dernier jet de dégâts / soins visant
//     la cible (moins d'une minute), sinon le dernier jet tout court, sinon le
//     combattant dont c'est le tour.
// Les stats sont gardées sur le combat (flag) pour survivre à un rechargement,
// puis publiées dans le réglage monde funnyStatsDernier : chaque client qui a
// activé l'option ouvre alors le tableau.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";

export const K_FUN = "funnyStats";               // client : voir le tableau
const K_DERNIER = "funnyStatsDernier";           // monde : dernier tableau publié
const QUERY = "completed-westmarch.funnyStats";
const FLAG = "funnystats";
const DELAI_SOURCE = 60_000;                      // attribution : 1 minute

const estMjActif = () => !!game.user?.isGM && (game.users?.activeGM ?? game.user) === game.user;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const voirActif = () => { try { return game.settings.get(MOD, K_FUN) === true; } catch { return false; } };

// Colonnes du tableau (clé, libellé, icône, libellé court, onglet).
// Onglet « combat » : dégâts, soins, éliminations. Onglet « jeu » :
// déplacement, actions, dés.
const COLONNES = [
    ["inflige",     "Dégâts infligés",          "fa-hand-fist",          "Infligés"],
    ["brut",        "Dégâts bruts : ce que les coups auraient fait sans résistances ni PV temporaires (infligés + résistés par les cibles)", "fa-explosion", "Dgt bruts"],
    ["recu",        "Dégâts reçus",             "fa-heart-crack",        "Reçus"],
    ["annule",      "Dégâts résistés (résistances, immunités, réductions)", "fa-shield-halved", "Résistés"],
    ["bouclier",    "Dégâts absorbés par des PV temporaires", "fa-shield", "Abs. PV temp."],
    ["soinsSoi",    "Soins sur soi",            "fa-heart-pulse",        "Soins soi"],
    ["soinsAutres", "Soins sur les autres",     "fa-hand-holding-heart", "Soins autres"],
    ["pvTemp",      "PV temporaires gagnés",    "fa-heart-circle-plus",  "PV temp."],
    ["kills",       "Éliminations",             "fa-skull",              "Kills"],
    ["ko",          "K.O. subis",               "fa-bed",                "K.O."],
    ["maxTourDeg",  "Meilleur round : dégâts infligés en un seul round", "fa-burst", "Max dgt / round"],
    ["moyTourDeg",  "Moyenne de dégâts infligés par round", "fa-chart-line", "Moy. dgt / round"],
    ["maxTourSoin", "Meilleur round : soins donnés en un seul round", "fa-kit-medical", "Max soins / round"],
    ["distance",    "Distance parcourue",       "fa-shoe-prints",        "Distance",     "jeu"],
    ["actions",     "Actions utilisées",        "fa-circle",             "Actions",      "jeu"],
    ["bonus",       "Actions bonus utilisées",  "fa-play",               "Bonus",        "jeu"],
    ["reactions",   "Réactions utilisées",      "fa-rotate-left",        "Réactions",    "jeu"],
    ["sorts",       "Sorts lancés",             "fa-wand-sparkles",      "Sorts",        "jeu"],
    ["consommables","Consommables utilisés",    "fa-flask",              "Conso.",       "jeu"],
    ["touches",     "Attaques réussies",        "fa-bullseye",           "Touchés",      "jeu"],
    ["ratees",      "Attaques ratées",          "fa-wind",               "Ratés",        "jeu"],
    ["reussiteCrit","Réussites critiques (20 naturel ou critique)", "fa-dice-d20", "Réus. crit.", "jeu"],
    ["echecCrit",   "Échecs critiques (1 naturel)", "fa-face-dizzy",     "Éch. crit.",   "jeu"]
];
const ONGLET = (c) => c[4] ?? "combat";
const vide = () => Object.fromEntries(COLONNES.map(([k]) => [k, 0]));

// ------------------------------------------------------------------ stockage (MJ)
const STATS = new Map();          // combatId → { lignes: {uuid: ligne} }
const SAUVE = new Map();          // combatId → minuterie d'enregistrement
const DERNIERS = { damage: new Map(), healing: new Map(), anyDamage: null, anyHealing: null };

function combatDe(uuid) {
    return (game.combats ?? []).find(c => c.started && c.combatants.some(cb => cb.actor?.uuid === uuid)) ?? null;
}
function etat(combat) {
    let e = STATS.get(combat.id);
    if (!e) {
        e = foundry.utils.deepClone(combat.getFlag?.(MOD, FLAG) ?? { lignes: {} });
        STATS.set(combat.id, e);
    }
    return e;
}
function ligne(combat, uuid) {
    const e = etat(combat);
    if (!e.lignes[uuid]) {
        const cb = combat.combatants.find(c => c.actor?.uuid === uuid);
        const a = cb?.actor ?? fromUuidSync(uuid);
        e.lignes[uuid] = { nom: cb?.name ?? a?.name ?? "?", img: cb?.img ?? a?.img ?? "", pj: !!a?.hasPlayerOwner, ...vide() };
    }
    return e.lignes[uuid];
}
const PAR_ROUND = { inflige: "d", soinsSoi: "s", soinsAutres: "s" };
function ajouter(uuid, cle, n = 1) {
    if (!uuid || !n) return;
    const combat = combatDe(uuid);
    if (!combat) return;
    const l = ligne(combat, uuid);
    l[cle] = Math.round(((l[cle] || 0) + n) * 10) / 10;
    // Dégâts et soins de chaque round (meilleur round, moyenne).
    const pr = PAR_ROUND[cle];
    if (pr) {
        const r = String(Math.max(1, combat.round || 1));
        l.rounds ??= {};
        l.rounds[r] ??= { d: 0, s: 0 };
        l.rounds[r][pr] += n;
    }
    planifierSauvegarde(combat);
}
function planifierSauvegarde(combat) {
    clearTimeout(SAUVE.get(combat.id));
    SAUVE.set(combat.id, setTimeout(() => {
        SAUVE.delete(combat.id);
        if (!game.combats.get(combat.id)) return;
        combat.setFlag(MOD, FLAG, STATS.get(combat.id)).catch(e => journal.avert(tl("[{0}] FunnyStats :", MOD), e));
    }, 4000));
}

// Auteur probable d'un dégât / soin reçu par `uuid`.
function auteur(type, uuid) {
    const now = Date.now();
    const cible = DERNIERS[type].get(uuid);
    if (cible && now - cible.t < DELAI_SOURCE) return cible.source;
    const any = type === "damage" ? DERNIERS.anyDamage : DERNIERS.anyHealing;
    if (any && now - any.t < DELAI_SOURCE) return any.source;
    return combatDe(uuid)?.combatant?.actor?.uuid ?? null;
}
function noterSource(type, source, cibles) {
    if (!source) return;
    const t = Date.now();
    for (const c of cibles ?? []) if (c) DERNIERS[type].set(c, { source, t });
    if (type === "damage") DERNIERS.anyDamage = { source, t };
    else DERNIERS.anyHealing = { source, t };
}

// ------------------------------------------------------------------ événements (MJ)
function traiter(ev) {
    switch (ev?.type) {
        case "annule": {
            const v = Math.max(0, Math.round(ev.valeur || 0));
            ajouter(ev.uuid, "annule", v);
            // Part résistée attribuée aussi à l'attaquant : ses dégâts bruts.
            const src = auteur("damage", ev.uuid);
            if (src && src !== ev.uuid) ajouter(src, "resisteInflige", v);
            break;
        }
        case "attaque": {
            const s = ev.source;
            // Une seule réussite critique par jet (un 20 naturel EST un critique).
            if (ev.crit || ev.nat === 20) ajouter(s, "reussiteCrit");
            else if (ev.nat === 1 || ev.fumble) ajouter(s, "echecCrit");
            if (ev.touches) ajouter(s, "touches", ev.touches);
            if (ev.ratees) ajouter(s, "ratees", ev.ratees);
            break;
        }
        case "de": if (ev.nat === 20) ajouter(ev.source, "reussiteCrit"); else if (ev.nat === 1) ajouter(ev.source, "echecCrit"); break;
        case "activite": {
            const cle = { action: "actions", bonus: "bonus", reaction: "reactions" }[ev.activation];
            if (cle) ajouter(ev.source, cle);
            if (ev.sort) ajouter(ev.source, "sorts");
            if (ev.consommable) ajouter(ev.source, "consommables");
            break;
        }
        case "source": noterSource(ev.soin ? "healing" : "damage", ev.source, ev.cibles); break;
    }
}

// ------------------------------------------------------------------ historique des dés (MJ)
const MAX_JETS = 1500;
const TYPES_JET = {
    attack: "Attaque", damage: "Dégâts", healing: "Soins", save: "Sauvegarde", check: "Test",
    ability: "Test", skill: "Compétence", tool: "Outil", death: "Sauvegarde contre la mort",
    initiative: "Initiative", hitDie: "Dé de vie", concentration: "Concentration"
};
function typeJet(msg, roll) {
    const D = CONFIG.Dice ?? {};
    if (D.DamageRoll && roll instanceof D.DamageRoll) {
        const t = roll.options?.type;
        return (t && t in (CONFIG.DND5E?.healingTypes ?? {})) ? "healing" : "damage";
    }
    const f = msg.flags?.dnd5e?.roll?.type ?? msg.system?.roll?.type;
    if (f) return f;
    if (msg.flags?.core?.initiativeRoll) return "initiative";
    if (D.D20Roll && roll instanceof D.D20Roll && (msg.flags?.["midi-qol"] || msg.flags?.dnd5e?.activity)) return "attack";
    return roll?.dice?.some(d => d.faces === 20) ? "check" : "autre";
}
function detailDes(roll) {
    return (roll?.dice ?? []).map(d => {
        const res = (d.results ?? []).map(x => (x.active === false || x.discarded) ? `<s>${x.result}</s>` : String(x.result));
        return `${d.number ?? ""}d${d.faces} : ${res.join(", ")}`;
    }).join(" · ");
}
function enregistrerJets(msg) {
    if (!msg?.rolls?.length || msg.blind) return;
    const actor = ChatMessage.getSpeakerActor?.(msg.speaker) ?? null;
    const uuid = actor?.uuid;
    const combat = uuid ? combatDe(uuid) : (game.combats?.find(c => c.started && c.scene?.id === msg.speaker?.scene) ?? null);
    if (!combat) return;
    const e = etat(combat);
    e.vus ??= {};
    e.jets ??= [];
    const deja = e.vus[msg.id] ?? 0;
    if (msg.rolls.length <= deja) return;
    for (const roll of msg.rolls.slice(deja)) {
        const nat = naturel(roll);
        e.jets.push({
            r: combat.round || 0,
            tour: combat.combatant?.name ?? "",
            qui: actor?.name ?? msg.speaker?.alias ?? "?",
            img: actor?.img ?? "",
            type: typeJet(msg, roll),
            formule: roll.formula ?? "",
            total: roll.total ?? null,
            des: detailDes(roll),
            crit: !!roll.isCritical || nat === 20,
            echec: !!roll.isFumble || nat === 1
        });
    }
    e.vus[msg.id] = msg.rolls.length;
    if (e.jets.length > MAX_JETS) e.jets.splice(0, e.jets.length - MAX_JETS);
    planifierSauvegarde(combat);
}
async function envoyer(ev) {
    if (estMjActif()) return traiter(ev);
    const mj = game.users?.activeGM;
    if (!mj) return;
    try { await mj.query(QUERY, ev); } catch { /* MJ déconnecté : tant pis pour ce point */ }
}

// Résultat naturel (dé gardé) d'un jet de d20, ou null.
function naturel(roll) {
    const d = roll?.dice?.find?.(x => x.faces === 20);
    const r = d?.results?.find(x => x.active !== false && !x.discarded);
    return r ? Number(r.result) : null;
}

function surDegatsPV(actor, changes, estSoin) {
    const uuid = actor?.uuid;
    const combat = uuid ? combatDe(uuid) : null;
    if (!combat) return;
    const avant = actor.system?.attributes?.hp?.value - (changes.hp || 0);
    if (!estSoin) {
        const perteHp = Math.max(0, -(changes.hp || 0));
        const perteTemp = Math.max(0, -(changes.temp || 0));
        ajouter(uuid, "recu", perteHp);
        ajouter(uuid, "bouclier", perteTemp);
        const src = auteur("damage", uuid);
        if (src && src !== uuid) ajouter(src, "inflige", perteHp + perteTemp);
        if (avant > 0 && (actor.system?.attributes?.hp?.value ?? 1) <= 0) {
            ajouter(uuid, "ko");
            if (src && src !== uuid) ajouter(src, "kills");
        }
    } else {
        const src = auteur("healing", uuid) ?? uuid;
        const gainHp = Math.max(0, changes.hp || 0);
        const gainTemp = Math.max(0, changes.temp || 0);
        if (gainHp) ajouter(src, src === uuid ? "soinsSoi" : "soinsAutres", gainHp);
        if (gainTemp) ajouter(uuid, "pvTemp", gainTemp);
    }
}

// Messages dnd5e (attaque, dégâts, soins, autres jets de d20).
function surMessage(msg) {
    const actor = ChatMessage.getSpeakerActor?.(msg.speaker) ?? null;
    const source = actor?.uuid;
    if (!source) return;
    const type = msg.flags?.dnd5e?.roll?.type ?? msg.system?.roll?.type ?? (msg.type !== "base" ? msg.type : null);
    const listeCibles = msg.system?.targets?.length ? msg.system.targets : (msg.flags?.dnd5e?.targets ?? []);
    const cibles = listeCibles.map(t => t.actor ?? t.uuid).filter(Boolean);
    const midi = game.modules.get("midi-qol")?.active;

    if (type === "damage" || type === "healing") {
        traiter({ type: "source", soin: type === "healing", source, cibles });
        return;
    }
    if (type === "attack" && !midi) {
        const roll = msg.rolls?.[0];
        const nat = naturel(roll);
        const crit = !!roll?.isCritical;
        let touches = 0, ratees = 0;
        for (const t of listeCibles) {
            if (t.ac == null) continue;
            const ok = !roll?.isFumble && (crit || (roll?.total ?? 0) >= t.ac);
            ok ? touches++ : ratees++;
        }
        traiter({ type: "attaque", source, nat, crit, fumble: !!roll?.isFumble, touches, ratees });
        return;
    }
    if (type !== "attack") {
        for (const r of msg.rolls ?? []) {
            const nat = naturel(r);
            if (nat === 20 || nat === 1) { traiter({ type: "de", source, nat }); break; }
        }
    }
}

// Longueur d'un trajet (coins haut-gauche) dans l'unité de la scène.
function mesurer(doc, coins) {
    const scene = doc.parent;
    const g = Number(scene?.grid?.size) || 100;
    const c = coins.map(p => ({ x: p.x + (Number(doc.width) || 1) * g / 2, y: p.y + (Number(doc.height) || 1) * g / 2 }))
        .filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
    if (c.length < 2) return 0;
    try {
        if (canvas?.scene?.id === scene?.id && typeof canvas.grid?.measurePath === "function") {
            const d = canvas.grid.measurePath(c)?.distance;
            if (Number.isFinite(d)) return d;
        }
    } catch { /* repli ci-dessous */ }
    let px = 0;
    for (let i = 1; i < c.length; i++) px += Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y);
    return px / g * (Number(scene?.grid?.distance) || 5);
}

// ------------------------------------------------------------------ fin du combat (MJ)
async function publier(combat) {
    clearTimeout(SAUVE.get(combat.id));
    const e = STATS.get(combat.id) ?? combat.getFlag?.(MOD, FLAG);
    STATS.delete(combat.id);
    const lignes = Object.values(e?.lignes ?? {});
    if (!lignes.some(l => COLONNES.some(([k]) => l[k]))) return;
    const rounds = Math.max(1, combat.round ?? 1);
    for (const l of lignes) {
        const parRound = Object.values(l.rounds ?? {});
        l.maxTourDeg = Math.max(0, ...parRound.map(x => x.d || 0));
        l.maxTourSoin = Math.max(0, ...parRound.map(x => x.s || 0));
        l.moyTourDeg = Math.round((l.inflige || 0) / rounds * 10) / 10;
        // Infligés (PV + PV temporaires perdus) + ce que les cibles ont résisté.
        l.brut = Math.round(((l.inflige || 0) + (l.resisteInflige || 0)) * 10) / 10;
        delete l.rounds;
    }
    const scene = game.scenes.get(combat.scene?.id ?? combat._source?.scene);
    await game.settings.set(MOD, K_DERNIER, {
        id: foundry.utils.randomID(), date: new Date().toISOString(),
        titre: scene?.name ?? tl("Combat"), rounds: combat.round ?? 0, lignes,
        unite: scene?.grid?.units ?? "", jets: e?.jets ?? []
    });
}

// ------------------------------------------------------------------ tableau
function titres(lignes) {
    const pjs = lignes.filter(l => l.pj);
    const meilleur = (fn) => {
        let best = null, v = 0;
        for (const l of pjs) { const x = fn(l); if (x > v) { v = x; best = l; } }
        return best ? { l: best, v } : null;
    };
    return [
        ["fa-trophy", tl("MVP"), meilleur(l => l.inflige + l.soinsAutres + l.kills * 10)],
        ["fa-skull", tl("Bourreau"), meilleur(l => l.kills)],
        ["fa-shield-heart", tl("Tank"), meilleur(l => l.recu + l.bouclier)],
        ["fa-hand-holding-heart", tl("Ange gardien"), meilleur(l => l.soinsAutres)],
        ["fa-shield-halved", tl("Inébranlable"), meilleur(l => l.annule)],
        ["fa-shoe-prints", tl("Globe-trotter"), meilleur(l => l.distance || 0)],
        ["fa-bolt", tl("Infatigable"), meilleur(l => (l.actions || 0) + (l.bonus || 0) + (l.reactions || 0))],
        ["fa-dice-d20", tl("Béni des dés"), meilleur(l => l.reussiteCrit || 0)],
        ["fa-face-dizzy", tl("Maudit des dés"), meilleur(l => l.echecCrit || 0)]
    ].filter(([, , m]) => m);
}

export async function ouvrirTableau(data = null) {
    data ??= game.settings.get(MOD, K_DERNIER);
    const lignes = data?.lignes ?? [];
    if (!lignes.length) { ui.notifications?.info(tl("Aucun tableau FunnyStats pour le moment.")); return; }
    const max = Object.fromEntries(COLONNES.map(([k]) => [k, Math.max(0, ...lignes.map(l => l[k] || 0))]));
    const tri = (a, b) => (b.inflige + b.soinsAutres) - (a.inflige + a.soinsAutres);
    const unite = data.unite ? ` (${esc(data.unite)})` : "";
    const tableau = (titre, liste, couleur, onglet) => !liste.length ? "" : `
        <h3 style="margin:10px 0 4px;color:${couleur};border-bottom:1px solid ${couleur}55;">${titre}</h3>
        <div style="overflow-x:auto;"><table class="scwm-fun-table" style="width:100%;min-width:640px;border-collapse:collapse;font-size:12px;table-layout:fixed;">
            <thead><tr><th style="text-align:left;width:170px;">${tl("Combattant")}</th>
            ${COLONNES.filter(c => ONGLET(c) === onglet).map(([k, lib, ic, court]) => `<th title="${esc(tl(lib))}" style="text-align:center;padding:2px 3px;font-size:10px;font-weight:600;line-height:1.2;"><i class="fa-solid ${ic}" style="font-size:12px;"></i><br>${esc(tl(court))}${k === "distance" ? unite : ""}</th>`).join("")}</tr></thead>
            <tbody>${liste.sort(tri).map(l => `<tr style="border-top:1px solid rgba(255,255,255,0.08);">
                <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:3px 4px;"><img src="${esc(l.img)}" style="width:22px;height:22px;border:none;vertical-align:middle;object-fit:contain;margin-right:4px;">${esc(l.nom)}</td>
                ${COLONNES.filter(c => ONGLET(c) === onglet).map(([k]) => {
                    const v = Math.round((l[k] || 0) * 10) / 10, top = v > 0 && v === Math.round(max[k] * 10) / 10;
                    return `<td style="text-align:center;padding:2px 4px;${top ? "color:#f0c040;font-weight:700;" : v ? "" : "opacity:.35;"}">${v}</td>`;
                }).join("")}</tr>`).join("")}</tbody>
        </table></div>`;
    const t = titres(lignes);
    const date = data.date ? new Date(data.date).toLocaleString(game.i18n?.lang || "fr") : "";
    const content = `<div class="scwm-funnystats">
        <p style="margin:0 0 6px;opacity:.8;">${esc(data.titre)} · ${tl("{0} round(s)", data.rounds ?? 0)} · ${esc(date)}</p>
        ${t.length ? `<div style="display:flex;flex-wrap:nowrap;gap:4px;margin-bottom:6px;overflow-x:auto;">${t.map(([ic, nom, m]) =>
            `<div title="${esc(nom)} : ${esc(m.l.nom)}" style="flex:1 1 0;min-width:0;padding:4px 6px;border:1px solid rgba(240,192,64,0.45);border-radius:6px;background:rgba(240,192,64,0.08);font-size:11px;line-height:1.3;">
                <div style="font-weight:700;color:#f0c040;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><i class="fa-solid ${ic}"></i> ${nom}</div>
                <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.l.nom)}</div></div>`).join("")}</div>` : ""}
        <div class="scwm-fun-onglets" style="display:flex;gap:6px;margin:8px 0 2px;">
            <button type="button" data-onglet="combat" class="active" style="flex:1;"><i class="fa-solid fa-hand-fist"></i> ${tl("Combat")}</button>
            <button type="button" data-onglet="jeu" style="flex:1;"><i class="fa-solid fa-shoe-prints"></i> ${tl("Déplacements, actions et dés")}</button>
            <button type="button" class="scwm-fun-histo" style="flex:0 0 auto;width:auto;padding:0 10px;" ${data.jets?.length ? "" : "disabled"}
                title="${esc(tl("Tous les jets de dés du combat, round par round"))}"><i class="fa-solid fa-scroll"></i> ${tl("Historique des dés")}${data.jets?.length ? ` (${data.jets.length})` : ""}</button>
        </div>
        ${["combat", "jeu"].map(o => `<div class="scwm-fun-page" data-page="${o}" style="${o === "combat" ? "" : "display:none;"}">
            ${tableau(tl("Héros"), lignes.filter(l => l.pj), "#5aa9e6", o)}
            ${tableau(tl("Adversaires et alliés PNJ"), lignes.filter(l => !l.pj), "#e65a5a", o)}
        </div>`).join("")}
    </div>`;
    await foundry.applications.api.DialogV2.wait({
        window: { title: tl("FunnyStats — fin du combat"), icon: "fa-solid fa-ranking-star" },
        position: { width: Math.min(980, window.innerWidth - 40) },
        content,
        rejectClose: false,
        render: (ev, dlg) => {
            const root = dlg?.element ?? document;
            root.querySelector(".scwm-fun-histo")?.addEventListener("click", (e) => { e.preventDefault(); ouvrirHistorique(data); });
            root.querySelectorAll(".scwm-fun-onglets button[data-onglet]").forEach(b => b.addEventListener("click", (e) => {
                e.preventDefault();
                root.querySelectorAll(".scwm-fun-onglets button[data-onglet]").forEach(x => x.classList.toggle("active", x === b));
                root.querySelectorAll(".scwm-fun-page").forEach(p => { p.style.display = p.dataset.page === b.dataset.onglet ? "" : "none"; });
            }));
        },
        buttons: [{ action: "close", label: tl("Fermer"), icon: "fa-solid fa-xmark", default: true }]
    }).catch(() => {});
}

// ------------------------------------------------------------------ historique (fenêtre)
export async function ouvrirHistorique(data = null) {
    data ??= game.settings.get(MOD, K_DERNIER);
    const jets = data?.jets ?? [];
    if (!jets.length) { ui.notifications?.info(tl("Aucun jet de dés enregistré pour ce combat.")); return; }
    const noms = [...new Set(jets.map(j => j.qui))].sort();
    const types = [...new Set(jets.map(j => j.type))];
    const libType = (t) => tl(TYPES_JET[t] ?? "Autre");
    const lignesHtml = () => {
        let rPrec = null;
        return jets.map((j, i) => {
            const entete = j.r !== rPrec ? `<tr class="scwm-histo-round" data-r="${j.r}"><td colspan="5" style="padding:6px 4px 2px;font-weight:700;color:#f0c040;border-bottom:1px solid rgba(240,192,64,.4);">${j.r ? tl("Round {0}", j.r) : tl("Avant le premier round")}</td></tr>` : "";
            rPrec = j.r;
            const couleur = j.crit ? "color:#5ad17a;font-weight:700;" : j.echec ? "color:#e65a5a;font-weight:700;" : "";
            return `${entete}<tr class="scwm-histo-jet" data-qui="${esc(j.qui)}" data-type="${esc(j.type)}" data-r="${j.r}" style="border-top:1px solid rgba(255,255,255,.06);">
                <td style="padding:2px 4px;white-space:nowrap;opacity:.75;">${esc(j.tour)}</td>
                <td style="padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${j.img ? `<img src="${esc(j.img)}" style="width:18px;height:18px;border:none;vertical-align:middle;object-fit:contain;margin-right:3px;">` : ""}${esc(j.qui)}</td>
                <td style="padding:2px 4px;white-space:nowrap;">${esc(libType(j.type))}</td>
                <td style="padding:2px 4px;text-align:center;${couleur}">${j.total ?? "—"}${j.crit ? " ✦" : j.echec ? " ✕" : ""}</td>
                <td style="padding:2px 4px;font-size:11px;opacity:.85;">${esc(j.formule)}<br><span style="opacity:.8;">${j.des}</span></td></tr>`;
        }).join("");
    };
    const content = `<div class="scwm-fun-histo-root">
        <div style="display:flex;gap:6px;margin-bottom:6px;">
            <select class="scwm-histo-qui" style="flex:1;"><option value="">${tl("Tous les combattants")}</option>${noms.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select>
            <select class="scwm-histo-type" style="flex:1;"><option value="">${tl("Tous les jets")}</option>${types.map(t => `<option value="${esc(t)}">${esc(libType(t))}</option>`).join("")}</select>
        </div>
        <div style="max-height:60vh;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;">
            <thead><tr style="position:sticky;top:0;background:rgba(20,20,25,.95);">
                <th style="text-align:left;width:120px;">${tl("Tour de")}</th><th style="text-align:left;width:150px;">${tl("Lanceur")}</th>
                <th style="text-align:left;width:110px;">${tl("Jet")}</th><th style="width:70px;">${tl("Résultat")}</th><th style="text-align:left;">${tl("Formule et dés")}</th></tr></thead>
            <tbody>${lignesHtml()}</tbody></table></div>
        <p style="margin:6px 0 0;font-size:11px;opacity:.7;">${tl("✦ réussite critique (20 naturel) · ✕ échec critique (1 naturel) · dé barré : dé écarté (avantage, désavantage, relance).")}</p>
    </div>`;
    await foundry.applications.api.DialogV2.wait({
        window: { title: tl("FunnyStats — historique des dés"), icon: "fa-solid fa-scroll" },
        position: { width: Math.min(760, window.innerWidth - 40) },
        content,
        rejectClose: false,
        render: (ev, dlg) => {
            const root = dlg?.element ?? document;
            const filtrer = () => {
                const q = root.querySelector(".scwm-histo-qui")?.value ?? "";
                const t = root.querySelector(".scwm-histo-type")?.value ?? "";
                const visibles = new Set();
                root.querySelectorAll(".scwm-histo-jet").forEach(tr => {
                    const ok = (!q || tr.dataset.qui === q) && (!t || tr.dataset.type === t);
                    tr.style.display = ok ? "" : "none";
                    if (ok) visibles.add(tr.dataset.r);
                });
                root.querySelectorAll(".scwm-histo-round").forEach(tr => { tr.style.display = visibles.has(tr.dataset.r) ? "" : "none"; });
            };
            root.querySelectorAll(".scwm-histo-qui, .scwm-histo-type").forEach(s => s.addEventListener("change", filtrer));
        },
        buttons: [{ action: "close", label: tl("Fermer"), icon: "fa-solid fa-xmark", default: true }]
    }).catch(() => {});
}

// ------------------------------------------------------------------ hooks
export function registerFunnyStatsSettings() {
    game.settings.register(MOD, K_FUN, {
        name: tl("FunnyStats — tableau de fin de combat"), scope: "client", config: false,
        type: Boolean, default: false
    });
    game.settings.register(MOD, K_DERNIER, {
        scope: "world", config: false, type: Object, default: {},
        onChange: (v) => { if (voirActif() && v?.lignes?.length) ouvrirTableau(v); }
    });
}

export function FunnyStatsHooks() {
    registerFunnyStatsSettings();
    // Événements envoyés par les clients des joueurs au MJ actif.
    CONFIG.queries[QUERY] = async (ev) => { if (estMjActif()) traiter(ev); return true; };

    Hooks.on("dnd5e.damageActor", (actor, changes, update, userId) => {
        // Dégâts appliqués sans passer par applyDamage (Midi-QOL…) : le client
        // qui a fait la mise à jour compte la résistance de son dernier calcul.
        if (userId === game.userId) compterResiste(actor);
        if (estMjActif()) surDegatsPV(actor, changes, false);
    });
    Hooks.on("dnd5e.healActor", (actor, changes) => { if (estMjActif()) surDegatsPV(actor, changes, true); });

    // Dégâts résistés (résistances, immunités, réductions) : brut puis final.
    // Le calcul tourne aussi pour chaque APERÇU de la carte d'application :
    // on garde seulement le dernier calcul de chaque acteur, et on le compte
    // une fois, quand les dégâts sont vraiment appliqués.
    const BRUT = new WeakMap();
    const DERNIER_CALCUL = new Map();   // uuid acteur → { resiste, t }
    Hooks.on("dnd5e.preCalculateDamage", (actor, damages, options) => {
        const mult = options?.multiplier ?? 1;
        const brut = (damages ?? []).filter(d => !(d.type in (CONFIG.DND5E?.healingTypes ?? {})))
            .reduce((s, d) => s + Math.max(0, Number(d.value) || 0), 0) * mult;
        BRUT.set(damages, brut);
    });
    Hooks.on("dnd5e.calculateDamage", (actor, damages) => {
        const brut = BRUT.get(damages);
        if (brut == null || !actor?.uuid) return;
        const final = (damages ?? []).filter(d => !(d.type in (CONFIG.DND5E?.healingTypes ?? {})))
            .reduce((s, d) => s + Math.max(0, Number(d.value) || 0), 0);
        DERNIER_CALCUL.set(actor.uuid, { resiste: Math.max(0, Math.trunc(brut) - Math.trunc(final)), t: Date.now() });
    });
    const compterResiste = (actor) => {
        const c = actor?.uuid ? DERNIER_CALCUL.get(actor.uuid) : null;
        if (!c) return;
        DERNIER_CALCUL.delete(actor.uuid);
        if (Date.now() - c.t > 10_000 || !c.resiste || !combatDe(actor.uuid)) return;
        envoyer({ type: "annule", uuid: actor.uuid, valeur: c.resiste });
    };
    Hooks.on("dnd5e.applyDamage", (actor) => compterResiste(actor));

    // Messages dnd5e : le MJ les reçoit tous.
    Hooks.on("createChatMessage", (msg) => {
        if (!estMjActif()) return;
        try { surMessage(msg); } catch (e) { journal.avert(tl("[{0}] FunnyStats :", MOD), e); }
        try { enregistrerJets(msg); } catch (e) { journal.avert(tl("[{0}] FunnyStats :", MOD), e); }
    });
    // Cartes complétées après coup (Midi-QOL ajoute attaque et dégâts à sa carte).
    Hooks.on("updateChatMessage", (msg, changes) => {
        if (!estMjActif() || !("rolls" in (changes ?? {}))) return;
        try { enregistrerJets(msg); } catch (e) { journal.avert(tl("[{0}] FunnyStats :", MOD), e); }
    });

    // Midi-QOL : attaques et auteur des dégâts depuis son déroulé (client qui
    // lance l'action), envoyés au MJ.
    // Résultat d'attaque : à la FIN du déroulé (midi-qol.RollComplete), quand
    // les cibles touchées sont définitives. Au moment de AttackRollComplete,
    // hitTargets peut encore être vide : tout comptait comme raté.
    Hooks.on("midi-qol.RollComplete", (w) => {
        try {
            const source = w?.actor?.uuid; if (!source || !w.attackRoll) return;
            const cibles = w.targets?.size ?? 0, touches = w.hitTargets?.size ?? 0;
            envoyer({ type: "attaque", source, nat: Number(w.diceRoll) || naturel(w.attackRoll), crit: !!w.isCritical,
                      fumble: !!w.isFumble, touches, ratees: Math.max(0, cibles - touches) });
        } catch { /* */ }
    });
    Hooks.on("midi-qol.DamageRollComplete", (w) => {
        try {
            const source = w?.actor?.uuid; if (!source) return;
            const liste = [...(w.hitTargets?.size ? w.hitTargets : (w.targets ?? []))];
            const soin = w.activity?.type === "heal" || /heal/i.test(String(w.defaultDamageType ?? ""));
            envoyer({ type: "source", soin, source, cibles: liste.map(t => (t.actor ?? t.document?.actor)?.uuid).filter(Boolean) });
        } catch { /* */ }
    });

    // Actions, actions bonus, réactions, sorts, consommables : utilisation
    // d'une activité dnd5e (client de celui qui l'utilise), envoyée au MJ.
    Hooks.on("dnd5e.postUseActivity", (activity) => {
        try {
            const actor = activity?.actor ?? activity?.item?.actor;
            if (!actor?.uuid || !combatDe(actor.uuid)) return;
            envoyer({ type: "activite", source: actor.uuid, activation: activity.activation?.type ?? null,
                      sort: activity.item?.type === "spell", consommable: activity.item?.type === "consumable" });
        } catch { /* */ }
    });

    // Distance parcourue (MJ) : on garde la dernière position de chaque token
    // et on mesure le trajet (avec ses étapes) à chaque déplacement.
    const POS = new Map();
    const semer = (combat) => { for (const cb of combat?.combatants ?? []) { const t = cb.token; if (t) POS.set(t.id, { x: t.x, y: t.y }); } };
    Hooks.on("combatStart", (c) => { if (estMjActif()) semer(c); });
    Hooks.on("createCombatant", (cb) => { if (estMjActif() && cb.token) POS.set(cb.token.id, { x: cb.token.x, y: cb.token.y }); });
    Hooks.once("ready", () => { if (estMjActif()) for (const c of game.combats ?? []) if (c.started) semer(c); });
    Hooks.on("updateToken", (doc, changes, options) => {
        if (!estMjActif() || (!("x" in changes) && !("y" in changes))) return;
        const prev = POS.get(doc.id);
        POS.set(doc.id, { x: doc.x, y: doc.y });
        const uuid = doc.actor?.uuid;
        if (!prev || !uuid || !combatDe(uuid)) return;
        if (doc.getFlag?.(MOD, "accroche")) return;      // porté ou mené : il ne marche pas lui-même
        const wps = options?.movement?.[doc.id]?.waypoints;
        const pts = [prev, ...(Array.isArray(wps) ? wps.filter(w => Number.isFinite(w?.x) && Number.isFinite(w?.y)) : []), { x: doc.x, y: doc.y }];
        const d = mesurer(doc, pts);
        if (d > 0) ajouter(uuid, "distance", d);
    });

    // Fin du combat : publication du tableau.
    Hooks.on("deleteCombat", (combat) => { if (estMjActif()) publier(combat).catch(e => journal.avert(tl("[{0}] FunnyStats :", MOD), e)); });
}
