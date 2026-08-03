import { MOD } from "./const.js";
// ============================================================
// goliath.js — Taille Large pour les Goliaths (feature "Large Form")
//
// Quand un Goliath utilise sa feature "Large Form", son token passe
// en 2x2 (Large). Réutiliser la feature revient à la taille d'origine
// (comportement toggle).
//
// Différence avec rage.js : "Large Form" n'a pas d'effet actif sur
// l'acteur — on ne peut donc pas écouter updateActiveEffect. On écoute
// à la place le hook d'activité dnd5e qui se déclenche quand l'item
// est "utilisé" depuis la fiche du personnage.
//
// Prérequis côté jeu : la feature "Large Form" doit avoir au moins
// une activité configurée dans dnd5e (ex: type "Utility", activation
// "Bonus Action"). Sans activité, le clic sur l'item n'envoie aucun
// hook d'utilisation et le module ne peut pas réagir.
//
// Comportement toggle :
//   - 1er usage → token passe en 2x2 (Large), taille d'origine mémorisée
//   - 2e usage → token revient à la taille mémorisée
//
// Identique à rage.js : GM uniquement (plusieurs clients connectés
// ne doivent pas tous effectuer la mise à jour), et la taille d'origine
// est stockée en flag sur le tokenDoc pour être restaurée exactement.
// ============================================================

function isLargeFormActivity(activity) {
    return /large form/i.test(activity?.item?.name ?? "");
}

async function toggleLargeForm(actor) {
    for (const tokenDoc of actor.getActiveTokens(false, true)) {
        const saved = tokenDoc.getFlag(MOD, "preLargeFormSize");

        if (saved) {
            // Déjà en Large Form → revenir à la taille d'origine
            await tokenDoc.update({ width: saved.width, height: saved.height });
            await tokenDoc.unsetFlag(MOD, "preLargeFormSize");
        } else {
            // Pas encore en Large Form → passer en 2x2 si plus petit
            if (tokenDoc.width >= 2 && tokenDoc.height >= 2) continue;
            await tokenDoc.setFlag(MOD, "preLargeFormSize", {
                width:  tokenDoc.width,
                height: tokenDoc.height
            });
            await tokenDoc.update({ width: 2, height: 2 });
        }
    }
}

// Cooldown par acteur (500 ms) pour éviter le double-déclenchement
// si dnd5e.postUseActivity ET midi-qol.RollComplete se déclenchent tous les deux.
const _cooldown = new Set();
async function toggleLargeFormDebounced(actor) {
    if (_cooldown.has(actor.id)) return;
    _cooldown.add(actor.id);
    setTimeout(() => _cooldown.delete(actor.id), 500);
    await toggleLargeForm(actor);
}

export function GoliathHooks() {

    // Hook dnd5e natif (dnd5e 5.x / Foundry v13).
    Hooks.on("dnd5e.postUseActivity", async (activity, config, results) => {
        if (!game.settings.get(MOD, "enableLargeForm")) return;
        if (!game.user.isGM) return;
        if (!isLargeFormActivity(activity)) return;
        const actor = activity.item?.actor ?? activity.actor ?? null;
        if (!actor) return;
        await toggleLargeFormDebounced(actor);
    });

    // Hook Midi QOL — déclenché après le workflow complet d'un item.
    // Couvre le cas où Midi QOL intercepte le pipeline dnd5e et que
    // postUseActivity ne se déclenche pas (activité "Midi Use").
    Hooks.on("midi-qol.RollComplete", async (workflow) => {
        if (!game.settings.get(MOD, "enableLargeForm")) return;
        if (!game.user.isGM) return;
        if (!workflow?.item || !/large form/i.test(workflow.item.name ?? "")) return;
        const actor = workflow.actor ?? workflow.item?.actor ?? null;
        if (!actor) return;
        await toggleLargeFormDebounced(actor);
    });
}
