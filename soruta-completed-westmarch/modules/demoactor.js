// ============================================================
// demoactor.js — Fiche de démonstration du tutoriel
//
// Le tutoriel a besoin d'une fiche PJ cohérente et TOUJOURS la même
// (le GM n'a souvent pas de personnage assigné). Plutôt que d'exiger
// l'import manuel d'un compendium, le module crée automatiquement, au
// premier chargement par un GM, une fiche PJ dédiée « Aventurier
// d'exemple (Tutoriel) », en lecture pour tous les joueurs. Le tutoriel
// l'ouvre en priorité.
//
// Création idempotente : suivi via le réglage "tutorialActorCreated" —
// si le GM la supprime volontairement, elle n'est pas recréée (le
// tutoriel retombe alors sur le personnage du joueur).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

export function getTutorialActor() {
    return game.actors?.find(a => a.getFlag(MOD, "tutorialDemo") === true) ?? null;
}

export async function ensureTutorialActor() {
    if (!game.user.isGM) return;
    if (!game.settings.get(MOD, "tutoEnabled")) return;
    if (getTutorialActor()) return;
    if (game.settings.get(MOD, "tutorialActorCreated")) return;   // déjà créée une fois

    try {
        // Dossier "Tutoriel" (créé si absent).
        let folder = game.folders?.find(f => f.type === "Actor" && f.name === "Tutoriel");
        if (!folder) folder = await Folder.create({ name: "Tutoriel", type: "Actor" });

        const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
        await Actor.create({
            name:   "Aventurier d'exemple (Tutoriel)",
            type:   "character",
            folder: folder?.id ?? null,
            ownership: { default: OBSERVER },
            flags: { [MOD]: { tutorialDemo: true } },
            system: {
                details: {
                    biography: {
                        value: "<p>Personnage de démonstration utilisé par le tutoriel du module " +
                               "<strong>Soruta — Completed Westmarch</strong>. Vous pouvez le modifier " +
                               "librement ; le tutoriel continuera de l'utiliser.</p>"
                    }
                },
                abilities: {
                    str: { value: 12 }, dex: { value: 14 }, con: { value: 13 },
                    int: { value: 10 }, wis: { value: 11 }, cha: { value: 15 }
                }
            }
        });

        await game.settings.set(MOD, "tutorialActorCreated", true);
        console.log(`[${MOD}] Fiche démo du tutoriel créée.`);
    } catch (err) {
        console.error(`[${MOD}] Échec de la création de la fiche démo du tutoriel :`, err);
    }
}
