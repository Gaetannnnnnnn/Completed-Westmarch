import { MOD } from "./const.js";
// ============================================================
// healer.js — Don « Healer » (Guérisseur) : relance des 1 sur les soins
//
// Règle (PHB 2024, Healer → Healing Rerolls) : quand vous lancez un dé pour
// déterminer les PV rendus par un SORT, ou par le Battle Medic de ce don,
// vous pouvez relancer un 1, et vous devez garder le nouveau résultat.
//
// Mise en œuvre : au moment du jet de soins (hook dnd5e
// « preRollDamageV2 »), si le lanceur a le don Healer, on ajoute le
// modificateur Foundry « r1 » à chaque dé de la formule de soins
// (2d8 + 3 → 2d8r1 + 3). « r1 » relance une seule fois un dé qui fait 1 et
// garde le nouveau résultat, exactement comme la règle. Les PV temporaires
// ne sont pas concernés (ce ne sont pas des PV rendus).
//
// Don reconnu : objet de type « feat » d'identifiant « healer », ou nommé
// « Healer » / « Guérisseur ». Réglage : enableHealerReroll (Modifications
// ciblées → Features).
// © 2026 Soruta.
// ============================================================

const actif = () => { try { return game.settings.get(MOD, "enableHealerReroll") === true; } catch { return false; } };

export function aLeDonHealer(actor) {
    return !!actor?.items?.some?.(i => i.type === "feat" && (
        i.system?.identifier === "healer" || /^(healer|gu[ée]risseur)$/i.test(String(i.name ?? "").trim())));
}

// Ajoute « r1 » à chaque dé d'une formule (sauf s'il relance déjà).
export function avecRelanceDes1(formule) {
    // Pas après un « . » ou « @ » : « @scale.clerc.d8 » est une référence, pas un dé.
    return String(formule ?? "").replace(/(?<![\w.@])(\d*d\d+)(?!\d)(?!r)/gi, "$1r1");
}

// Ce jet est-il un jet de soins (PV rendus) ?
function estSoin(roll, activity) {
    const opt = roll?.options ?? {};
    const types = new Set([opt.type, ...(opt.types ?? [])].filter(Boolean));
    if (types.size) return types.has("healing");
    // Activité « Soin » sans type renseigné sur le jet : on regarde l'activité.
    if (activity?.type === "heal") {
        const t = activity.healing?.types;
        return !t || (t.has?.("healing") ?? [...t].includes("healing"));
    }
    return false;
}

export function HealerHooks() {
    Hooks.on("dnd5e.preRollDamageV2", (config) => {
        if (!actif()) return;
        const activity = config?.subject;
        const item = activity?.item;
        const actor = item?.actor ?? activity?.actor;
        if (!actor || !aLeDonHealer(actor)) return;
        // Sorts, et le Battle Medic du don lui-même.
        const sourceOk = item?.type === "spell"
            || (item?.type === "feat" && (item.system?.identifier === "healer" || /^(healer|gu[ée]risseur)$/i.test(item.name ?? "")));
        if (!sourceOk) return;
        for (const roll of config.rolls ?? []) {
            if (!estSoin(roll, activity)) continue;
            roll.parts = (roll.parts ?? []).map(avecRelanceDes1);
        }
    });
}
