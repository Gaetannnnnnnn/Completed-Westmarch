import { MOD } from "./const.js";
// ============================================================
// rage.js — Passage en taille Large (width/height 2x2) pendant la Rage
// - Spécifique à la sous-classe Voie du Géant : la feature "Giant's
//   Havoc" (palier 3) dit "quand vous entrez en rage, si vous êtes plus
//   petit que Large, vous devenez Large" — ce n'est PAS un comportement
//   de tous les barbares, seulement de ceux qui possèdent cette feature.
// - L'effet actif "Rage" (PHB 2024) est stocké en PERMANENCE sur l'item
//   "Rage" lui-même (transfer: true), à l'état désactivé — ce n'est donc
//   pas un document créé/détruit quand on active/désactive la rage, mais
//   le même document dont le champ "disabled" bascule (true <-> false).
//   On écoute donc updateActiveEffect (pas createActiveEffect /
//   deleteActiveEffect, qui ne se déclenchent jamais dans ce cas) et on
//   regarde la transition de "disabled" dans les changements.
//   NB : comme l'effet appartient à l'ITEM (transfer effect), son parent
//   Foundry est l'Item "Rage", pas l'acteur directement — on remonte donc
//   via effect.parent.actor.
// - On ne redimensionne le token QUE si l'acteur possède la feature
//   "Giant's Havoc".
// - On ne grandit que si le token est plus petit que Large (2x2) — un
//   token déjà Large/Huge (race, ajustement manuel) n'est pas modifié,
//   conformément à la formulation officielle de la feature.
// - GM uniquement : ces hooks de document se déclenchent sur TOUS les
//   clients connectés (pas que celui qui a activé la rage) ; un seul
//   client doit effectuer la mise à jour du token, sinon plusieurs
//   clients tentent la même modification en même temps.
// - La taille d'origine de chaque token est mémorisée (flag) avant
//   modification, pour pouvoir la restaurer exactement à la fin de la
//   rage (utile pour les races déjà Large/Huge, ou les tokens dont la
//   taille a été ajustée manuellement par le GM).
// ============================================================

function isRageEffect(effect) {
    return /rage/i.test(effect?.name ?? "");
}

// Remonte vers l'acteur, que l'effet soit directement sur l'acteur
// (cas générique) ou transféré depuis un item (cas du "Rage" officiel).
function effectActor(effect) {
    if (effect.parent?.documentName === "Actor") return effect.parent;
    if (effect.parent?.documentName === "Item") return effect.parent.actor ?? null;
    return null;
}

// Vérifie que l'acteur possède bien la feature "Giant's Havoc" (Voie du
// Géant, palier 3) — sans elle, la rage ne change jamais la taille.
// Le "." (et non "'?") couvre aussi bien l'apostrophe droite (') que
// l'apostrophe typographique (') utilisée dans les items officiels.
function hasGiantsHavoc(actor) {
    return !!actor.items?.find(i => /giant.?s havoc/i.test(i.name ?? ""));
}

async function applyGiantSize(actor) {
    if (!hasGiantsHavoc(actor)) return;

    for (const tokenDoc of actor.getActiveTokens(false, true)) {
        // Déjà Large ou plus grand : on ne touche à rien (cf. la
        // formulation officielle de la feature, "si plus petit que Large").
        if (tokenDoc.width >= 2 && tokenDoc.height >= 2) continue;

        // Ne mémorise la taille d'origine que si elle ne l'est pas déjà
        // (sécurité si l'effet est réactivé sans que la précédente n'ait
        // été proprement restaurée).
        if (!tokenDoc.getFlag(MOD, "preRageSize")) {
            await tokenDoc.setFlag(MOD, "preRageSize", {
                width: tokenDoc.width,
                height: tokenDoc.height
            });
        }

        await tokenDoc.update({ width: 2, height: 2 });
    }
}

async function revertGiantSize(actor) {
    for (const tokenDoc of actor.getActiveTokens(false, true)) {
        const saved = tokenDoc.getFlag(MOD, "preRageSize");
        if (!saved) continue;

        await tokenDoc.update({ width: saved.width, height: saved.height });
        await tokenDoc.unsetFlag(MOD, "preRageSize");
    }
}

export function RageHooks() {

    // Cas générique (effet réellement créé/détruit sur l'acteur, ex: si
    // un autre module/effet maison fonctionne ainsi plutôt que par
    // transfer+disabled).
    Hooks.on("createActiveEffect", async (effect) => {
        if (!game.settings.get(MOD, "enableRageSize")) return;
        if (!game.user.isGM) return;
        if (!isRageEffect(effect)) return;

        const actor = effectActor(effect);
        if (actor) await applyGiantSize(actor);
    });

    Hooks.on("deleteActiveEffect", async (effect) => {
        if (!game.settings.get(MOD, "enableRageSize")) return;
        if (!game.user.isGM) return;
        if (!isRageEffect(effect)) return;

        const actor = effectActor(effect);
        if (actor) await revertGiantSize(actor);
    });

    // Cas réel du "Rage" officiel (PHB 2024) : l'effet existe toujours sur
    // l'item, seul son état "disabled" change quand on active/désactive
    // la rage.
    Hooks.on("updateActiveEffect", async (effect, changes) => {
        if (!game.settings.get(MOD, "enableRageSize")) return;
        if (!game.user.isGM) return;
        if (!isRageEffect(effect)) return;
        if (!("disabled" in changes)) return;

        const actor = effectActor(effect);
        if (!actor) return;

        if (changes.disabled === false) await applyGiantSize(actor);
        else if (changes.disabled === true) await revertGiantSize(actor);
    });
}
