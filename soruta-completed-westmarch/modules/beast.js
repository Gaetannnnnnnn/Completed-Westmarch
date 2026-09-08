// ============================================================
// beast.js — Voie de la Bête (Barbare) : Form of the Beast
//
// Quand un personnage possède une FEATURE dont l'identifiant système est
// "form-of-the-beast", le module lui crée 3 armes naturelles — Morsure (Bite),
// Griffes (Claws), Queue (Tail) — avec jets d'attaque et de dégâts corrects
// (basés sur la Force + maîtrise). Les armes sont retirées si la feature
// disparaît. Réglage : enableFormOfTheBeast (arbre « Modifications ciblées »).
//
// ⚠️ Le schéma des armes/dégâts a changé entre dnd5e v3 et v4 (activités). On
// écrit les champs des DEUX schémas ; ajuste les définitions plus bas si les
// jets ne sont pas conformes sur ta version.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const enabled = () => game.settings.get(MOD, "enableFormOfTheBeast");
const FEATURE_ID = "form-of-the-beast";
const FLAG = "beastWeapon";

// A la feature « Form of the Beast » (par identifiant système).
function hasFormOfTheBeast(actor) {
    return !!actor?.items?.some(i =>
        i.type === "feat" && (i.system?.identifier ?? "").toLowerCase() === FEATURE_ID);
}

// ------------------------------------------------------------
// Définition des 3 armes naturelles
// ------------------------------------------------------------
const BEAST_DEFS = {
    bite:  { name: "Morsure (Form of the Beast)", img: "icons/svg/terror.svg", dice: 8, type: "piercing", reach: 5 },
    claws: { name: "Griffes (Form of the Beast)", img: "icons/creatures/claws/claw-curved-jagged-gray.webp",   dice: 6, type: "slashing", reach: 5 },
    tail:  { name: "Queue (Form of the Beast)",   img: "icons/creatures/abilities/tail-swipe-green.webp",       dice: 8, type: "piercing", reach: 10 },
};

function makeBeastWeapon(slot) {
    const d = BEAST_DEFS[slot];
    const actId = foundry.utils.randomID();
    return {
        name: d.name, type: "weapon", img: d.img,
        system: {
            type: { value: "natural", baseItem: "" },
            proficient: 1, equipped: true, identified: true,
            ability: "str",
            // Schéma v3 : type d'action + parts de dégâts.
            actionType: "mwak",
            damage: {
                base:  { number: 1, denomination: d.dice, types: [d.type], bonus: "" },
                parts: [[`1d${d.dice} + @mod`, d.type]],
            },
            range: { value: d.reach, long: null, units: "ft" },
            // Schéma v4 : activité d'attaque (utilise les dégâts de base de l'arme).
            activities: {
                [actId]: {
                    _id: actId, type: "attack", name: "Attaque",
                    activation: { type: "action", value: 1 },
                    attack: { ability: "str", bonus: "", flat: false, type: { value: "melee", classification: "weapon" } },
                    damage: { includeBase: true, parts: [] },
                    range: { value: d.reach, units: "ft" },
                },
            },
        },
        flags: { [MOD]: { [FLAG]: slot } },
    };
}

function beastWeaponsOn(actor) {
    return actor.items.filter(i => i.getFlag(MOD, FLAG));
}

// Crée/retire les armes selon la présence de la feature. isOwner requis.
async function syncBeastWeapons(actor) {
    if (!enabled() || !actor?.isOwner) return;
    if (actor.type !== "character") return;
    const existing = beastWeaponsOn(actor);
    const shouldHave = hasFormOfTheBeast(actor);

    if (shouldHave) {
        const slotsPresent = new Set(existing.map(i => i.getFlag(MOD, FLAG)));
        const toCreate = Object.keys(BEAST_DEFS)
            .filter(slot => !slotsPresent.has(slot))
            .map(makeBeastWeapon);
        if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
    } else if (existing.length) {
        await actor.deleteEmbeddedDocuments("Item", existing.map(i => i.id));
    }
}

export function BeastHooks() {
    if (!enabled()) return;

    // Feature ajoutée/retirée → resynchronise les armes.
    Hooks.on("createItem", (item) => {
        if (item.type !== "feat") return;
        if ((item.system?.identifier ?? "").toLowerCase() !== FEATURE_ID) return;
        syncBeastWeapons(item.parent);
    });
    Hooks.on("deleteItem", (item) => {
        if (item.type !== "feat") return;
        if ((item.system?.identifier ?? "").toLowerCase() !== FEATURE_ID) return;
        syncBeastWeapons(item.parent);
    });

    // Passe initiale : personnages possédés par l'utilisateur.
    Hooks.once("ready", () => {
        for (const a of game.actors ?? []) if (a.type === "character" && a.isOwner) syncBeastWeapons(a);
    });
}
