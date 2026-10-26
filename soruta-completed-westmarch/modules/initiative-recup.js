// ============================================================
// initiative-recup.js — Capacités qui se rechargent au jet d'initiative
//
// Quand un combattant lance son initiative (premier jet de ce combat), le
// client MJ actif applique automatiquement, si le personnage a la capacité :
//   - Moine, Métabolisme surnaturel (Uncanny Metabolism, 2024) : s'il reste
//     une utilisation ET qu'au moins un point de focus est dépensé, récupère
//     tous les points de focus et rend dé d'Arts martiaux + niveau de moine PV.
//     L'utilisation est décomptée (une fois par repos long).
//   - Moine, Focus parfait (Perfect Focus, 2024) : si le Métabolisme n'a pas
//     servi à ce jet, remonte les points de focus à 4 s'il en reste 3 ou moins.
//     Perfection de l'être (Perfect Self, 2014) : 4 ki s'il n'en reste aucun.
//   - Barbare, Rage persistante (Persistent Rage, 2024) : s'il reste une
//     utilisation ET qu'une rage est dépensée, récupère toutes les rages.
//   - Barde, Inspiration supérieure (Superior Inspiration) : remonte les
//     Inspirations bardiques à 2 (2024) ou à 1 s'il n'en reste aucune (2014).
//   - Druide, Archidruide (Archdruid, 2024 — Evergreen Wild Shape) : s'il ne
//     reste aucune Forme sauvage, en récupère une.
// Une capacité déjà épuisée (utilisation dépensée) ne fait rien.
//
// Priorité aux automatisations existantes : si l'objet de la capacité est déjà
// automatisé — récupération « Initiative » réglée dans dnd5e, macro Midi-QOL
// (onUse), ou objet préparé par Chris's Premades / Gambit's Premades / Midi
// Item Showcase —, le module ne fait rien pour cette capacité.
//
// Un message de chat résume ce qui a été récupéré. Réglages : un par capacité
// (Modifications ciblées → Classes).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
import { deArtsMartiaux } from "./monk.js";

const FLAG = "initRecupFaite";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reglage = (cle) => { try { return game.settings.get(MOD, cle) === true; } catch { return false; } };

// ------------------------------------------------------------------ objets
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").trim();

// Trouve un objet par identifiant dnd5e ou par nom (anglais / français).
function objet(actor, identifiants, noms = []) {
    const ids = new Set(identifiants);
    const ns = noms.map(norm);
    return actor.items.find(i => ids.has(i.system?.identifier))
        ?? actor.items.find(i => ns.includes(norm(i.name)));
}

function en2024(item) {
    const r = String(item?.system?.source?.rules ?? "");
    if (r === "2024") return true;
    if (r === "2014") return false;
    try { return game.settings.get("dnd5e", "rulesVersion") !== "legacy"; } catch { return true; }
}

// Utilisations : max, dépensées, restantes.
function usages(item) {
    const u = item?.system?.uses;
    const max = Number(u?.max) || 0;
    const spent = Math.max(0, Number(u?.spent) || 0);
    return { max, spent, reste: Math.max(0, max - spent) };
}

// L'objet est-il déjà automatisé ailleurs (dnd5e, Midi-QOL, premades) ?
export function dejaAutomatise(item) {
    if (!item) return false;
    const recup = item.system?.uses?.recovery ?? [];
    if ([...recup].some(r => r?.period === "initiative")) return true;
    const f = item.flags ?? {};
    if (f["chris-premades"] || f["gambits-premades"] || f["midi-item-showcase-community"]) return true;
    if (String(f["midi-qol"]?.onUseMacroName ?? "").trim()) return true;
    for (const a of item.system?.activities?.values?.() ?? []) {
        const m = a?.flags?.["midi-qol"] ?? a?.midiProperties ?? {};
        if (String(a?.flags?.["midi-qol"]?.onUseMacroName ?? m?.onUseMacroName ?? "").trim()) return true;
    }
    return false;
}

// Remet des utilisations : « reste » visé (jamais au-delà du maximum).
const viserReste = (item, reste) => {
    const { max } = usages(item);
    return { _id: item.id, "system.uses.spent": Math.max(0, max - Math.min(max, reste)) };
};

// ------------------------------------------------------------------ capacités
async function recuperer(actor) {
    const lignes = [];
    const majObjets = [];
    let soin = 0;

    // --- Moine
    const focus = objet(actor, ["monks-focus", "ki", "focus-points"], ["Monk's Focus", "Focus Points", "Ki", "Ki Points", "Points de focus", "Points de ki"]);
    let metabolismeUtilise = false;
    if (focus) {
        const uf = usages(focus);
        const metab = objet(actor, ["uncanny-metabolism"], ["Uncanny Metabolism", "Métabolisme surnaturel", "Métabolisme extraordinaire"]);
        if (metab && reglage("enableUncannyMetabolism") && !dejaAutomatise(metab)) {
            const um = usages(metab);
            if (um.reste > 0 && uf.spent > 0) {
                const niveau = Number(actor.classes?.monk?.system?.levels ?? 0);
                const faces = deArtsMartiaux(actor) || 6;
                const roll = await new Roll(`1d${faces} + ${niveau}`).evaluate();
                soin = roll.total;
                majObjets.push({ _id: focus.id, "system.uses.spent": 0 });
                majObjets.push({ _id: metab.id, "system.uses.spent": um.spent + 1 });
                metabolismeUtilise = true;
                lignes.push(tl("<strong>Métabolisme surnaturel</strong> : {0} point(s) de focus récupéré(s), {1} PV rendus ({2}).", uf.spent, soin, esc(roll.formula)));
            }
        }
        const parfait = objet(actor, ["perfect-focus", "perfect-self"], ["Perfect Focus", "Perfect Self", "Focus parfait", "Perfection de l'être"]);
        if (!metabolismeUtilise && parfait && reglage("enablePerfectFocus") && !dejaAutomatise(parfait)) {
            const cible = en2024(parfait) ? (uf.reste <= 3 ? 4 : 0) : (uf.reste === 0 ? 4 : 0);
            if (cible > uf.reste && uf.max > uf.reste) {
                const maj = viserReste(focus, cible);
                majObjets.push(maj);
                lignes.push(tl("<strong>{0}</strong> : points de focus remontés à {1}.", esc(parfait.name), uf.max - maj["system.uses.spent"]));
            }
        }
    }

    // --- Barbare
    const rage = objet(actor, ["rage"], ["Rage"]);
    const persist = objet(actor, ["persistent-rage"], ["Persistent Rage", "Rage persistante"]);
    if (rage && persist && reglage("enablePersistentRage") && !dejaAutomatise(persist)) {
        const up = usages(persist), ur = usages(rage);
        if (up.max > 0 && up.reste > 0 && ur.spent > 0) {
            majObjets.push({ _id: rage.id, "system.uses.spent": 0 });
            majObjets.push({ _id: persist.id, "system.uses.spent": up.spent + 1 });
            lignes.push(tl("<strong>Rage persistante</strong> : {0} rage(s) récupérée(s).", ur.spent));
        }
    }

    // --- Barde
    const inspi = objet(actor, ["bardic-inspiration"], ["Bardic Inspiration", "Inspiration bardique"]);
    const sup = objet(actor, ["superior-inspiration"], ["Superior Inspiration", "Inspiration supérieure"]);
    if (inspi && sup && reglage("enableSuperiorInspiration") && !dejaAutomatise(sup)) {
        const ui_ = usages(inspi);
        const cible = en2024(sup) ? 2 : (ui_.reste === 0 ? 1 : 0);
        if (cible > ui_.reste && ui_.max > ui_.reste) {
            const maj = viserReste(inspi, cible);
            majObjets.push(maj);
            lignes.push(tl("<strong>Inspiration supérieure</strong> : Inspirations bardiques remontées à {0}.", ui_.max - maj["system.uses.spent"]));
        }
    }

    // --- Druide
    const forme = objet(actor, ["wild-shape"], ["Wild Shape", "Forme sauvage", "Forme animale"]);
    const archi = objet(actor, ["archdruid", "evergreen-wild-shape"], ["Archdruid", "Archidruide", "Evergreen Wild Shape"]);
    if (forme && archi && en2024(archi) && reglage("enableEvergreenWildShape") && !dejaAutomatise(archi)) {
        const uw = usages(forme);
        if (uw.max > 0 && uw.reste === 0) {
            majObjets.push(viserReste(forme, 1));
            lignes.push(tl("<strong>Archidruide</strong> : une Forme sauvage récupérée."));
        }
    }

    if (!lignes.length) return;
    // Plusieurs mises à jour du même objet : la dernière l'emporte.
    const parId = new Map();
    for (const m of majObjets) parId.set(m._id, { ...(parId.get(m._id) ?? {}), ...m });
    await actor.updateEmbeddedDocuments("Item", [...parId.values()]);
    if (soin > 0) {
        const hp = actor.system?.attributes?.hp ?? {};
        const max = Number(hp.effectiveMax ?? hp.max ?? 0) || Infinity;
        await actor.update({ "system.attributes.hp.value": Math.min(max, (Number(hp.value) || 0) + soin) });
    }
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><i class="fa-solid fa-bolt"></i> ${tl("Au jet d'initiative :")}</p><ul><li>${lignes.join("</li><li>")}</li></ul>`
    });
}

// ------------------------------------------------------------------ hooks
const estMjActif = () => !!game.user?.isGM && (game.users?.activeGM ?? game.user) === game.user;

export function InitiativeRecupHooks() {
    Hooks.on("updateCombatant", async (combatant, changes) => {
        if (!estMjActif()) return;
        if (!("initiative" in (changes ?? {})) || changes.initiative === null || changes.initiative === undefined) return;
        const actor = combatant.actor;
        if (!actor || combatant.getFlag?.(MOD, FLAG)) return;
        try {
            await combatant.setFlag(MOD, FLAG, true);   // une seule fois par combat (relance d'initiative ignorée)
            await recuperer(actor);
        } catch (e) {
            journal.erreur(tl("[{0}] Récupération au jet d'initiative :", MOD), e);
        }
    });
}
