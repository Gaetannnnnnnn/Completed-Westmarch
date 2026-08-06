// ============================================================
// demoactor.js — Fiche de démonstration du tutoriel
//
// Le tutoriel a besoin d'une fiche PJ cohérente et TOUJOURS la même
// (le GM n'a souvent pas de personnage assigné). Le module crée
// automatiquement, au premier chargement par un GM, un aventurier
// d'exemple complet — niveau 12, classe/sous-classe/historique/race,
// équipement, biographie, caractéristiques — ainsi que des relations,
// un bestiaire, des notes et des expéditions, le tout PUREMENT improvisé
// et auto-suffisant : aucune référence à un autre acteur du monde, aucun
// impact sur le reste du serveur.
//
// Création idempotente + montée de version : si une ancienne fiche démo
// (version < DEMO_VERSION) existe, elle est remplacée par la nouvelle.
// Si le GM la supprime volontairement, elle n'est pas recréée.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const DEMO_VERSION = 4;
const rid = () => foundry.utils.randomID();

export function getTutorialActor() {
    return game.actors?.find(a => a.getFlag(MOD, "tutorialDemo") === true) ?? null;
}

// ---- Accès temporaire pendant le tutoriel -------------------
// La fiche démo est en "Aucun" par défaut. Pendant le tutoriel, l'utilisateur
// devient Propriétaire (pour voir/éditer les onglets comme une fiche normale),
// puis repasse en "Aucun" à la fermeture. Un joueur ne pouvant pas modifier
// l'ownership, il passe par une requête au GM.
async function setDemoOwnership(userId, level) {
    const actor = getTutorialActor();
    if (!actor) return;
    if (game.user.isGM) {
        try { await actor.update({ [`ownership.${userId}`]: level }); } catch (e) {}
        return;
    }
    const gm = game.users.find(u => u.isGM && u.active);
    if (!gm) return;   // pas de GM en ligne → on ne peut pas accorder l'accès
    try { await gm.query("completed-westmarch.setDemoOwnership", { userId, level }); } catch (e) {}
}

export async function grantTutorialAccess() {
    if (game.user.isGM) return;   // le GM possède déjà tout
    await setDemoOwnership(game.user.id, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
}
export function revokeTutorialAccess() {
    if (game.user.isGM) return;
    setDemoOwnership(game.user.id, CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
}

export async function ensureTutorialActor() {
    if (!game.user.isGM) return;
    if (!game.settings.get(MOD, "tutoEnabled")) return;

    const existing = getTutorialActor();
    if (existing) {
        if ((existing.getFlag(MOD, "tutorialDemoVersion") ?? 1) >= DEMO_VERSION) return;
        // Ancienne fiche démo → on la remplace par la version enrichie.
        try { await existing.delete(); } catch (e) { console.warn(`[${MOD}] Suppression ancienne fiche démo :`, e); }
    } else if (game.settings.get(MOD, "tutorialActorCreated")) {
        return;   // supprimée volontairement par le GM
    }

    try {
        await createDemoActor();
        await game.settings.set(MOD, "tutorialActorCreated", true);
        console.log(`[${MOD}] Fiche démo du tutoriel créée (v${DEMO_VERSION}).`);
    } catch (err) {
        console.error(`[${MOD}] Échec de la création de la fiche démo du tutoriel :`, err);
    }
}

async function createDemoActor() {
    // Dossier "Tutoriel"
    let folder = game.folders?.find(f => f.type === "Actor" && f.name === "Tutoriel");
    if (!folder) folder = await Folder.create({ name: "Tutoriel", type: "Actor" });

    // "Aucun" par défaut : personne ne conserve d'accès à la fiche démo. Le
    // tutoriel accorde temporairement l'accès Propriétaire au participant
    // (voir grantTutorialAccess / revokeTutorialAccess).
    const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;

    // ---- Items (classe / sous-classe / historique / race / équipement) ----
    const items = [
        { name: "Rôdeur", type: "class", img: "icons/skills/ranged/arrow-strike-glowing-teal.webp",
          system: { levels: 12, identifier: "ranger", hitDice: "d10" } },
        { name: "Chasseur de l'ombre", type: "subclass", img: "icons/magic/perception/silhouette-stealth-shadow.webp",
          system: { classIdentifier: "ranger", identifier: "gloom-stalker" } },
        { name: "Ermite", type: "background", img: "icons/environment/wilderness/tent-brown.webp" },
        { name: "Demi-elfe", type: "race", img: "icons/environment/people/commoner.webp" },
        { name: "Épée longue", type: "weapon", img: "icons/weapons/swords/sword-guard-purple.webp" },
        { name: "Arc long", type: "weapon", img: "icons/weapons/bows/bow-recurve-brown.webp" },
        { name: "Armure de cuir clouté", type: "equipment", img: "icons/equipment/chest/breastplate-leather-brown-belt.webp" },
        { name: "Cape d'elfe", type: "equipment", img: "icons/equipment/back/cloak-hooded-green.webp" },
        { name: "Potion de soins", type: "consumable", img: "icons/consumables/potions/potion-tube-corked-red.webp",
          system: { quantity: 3 } },
        { name: "Sac d'aventurier", type: "equipment", img: "icons/containers/bags/pack-leather-brown-tan.webp" }
    ];

    const bio =
        "<p><strong>Aeryn Nightleaf</strong>, demi-elfe rôdeuse au service des Marches de l'Ouest, " +
        "arpente les frontières sauvages depuis plus de dix ans. Élevée par un ermite après la " +
        "disparition de sa famille, elle a appris à survivre dans l'ombre et à parler aux bêtes.</p>" +
        "<p><em>Personnage de démonstration du module Soruta — Completed Westmarch. Purement fictif, " +
        "sans lien avec votre monde. Vous pouvez le modifier librement.</em></p>";

    // ---- Relations (auto-suffisantes : cibles fictives, aucun acteur réel) ----
    const relationsList = [
        { id: rid(), targetId: "demo-rel-sylwen", targetName: "Dame Sylwen d'Argentcombe", targetImg: "icons/svg/mystery-man.svg",
          type: "PNJ", level: 3, note: "Mentore et protectrice. Confie les missions aux Marches.", lastPosition: "Tour d'Argent", secret: false, revealed: true },
        { id: rid(), targetId: "demo-rel-rictus", targetName: "Rictus le Balafré", targetImg: "icons/svg/terror.svg",
          type: "PNJ", level: -2, note: "Chef de bande hostile croisé au Col des Corbeaux.", lastPosition: "Col des Corbeaux", secret: false, revealed: true },
        { id: rid(), targetId: "demo-rel-kaelen", targetName: "Kaelen, marchand ambulant", targetImg: "icons/svg/coins.svg",
          type: "PNJ", level: 1, note: "Fournit informations et matériel contre menus services.", lastPosition: "Bourg-la-Rivière", secret: false, revealed: true }
    ];

    // ---- Bestiaire (auto-suffisant) ----
    const bestiaryList = [
        { id: rid(), targetId: "demo-bst-gobelin", targetName: "Gobelin des cavernes", targetImg: "icons/svg/terror.svg",
          hostility: -1, note: "Rapides, embuscades nocturnes en meute.", firstScene: "Grotte de Karndal", revealed: true },
        { id: rid(), targetId: "demo-bst-loup", targetName: "Loup des ombres", targetImg: "icons/svg/wolf.svg",
          hostility: -2, note: "Prédateur de meute, très agressif la nuit.", firstScene: "Forêt de Vlourn", revealed: true },
        { id: rid(), targetId: "demo-bst-esprit", targetName: "Esprit sylvestre", targetImg: "icons/svg/oak.svg",
          hostility: 2, note: "Gardien bienveillant d'une clairière ancienne.", firstScene: "Clairière du Vieux Chêne", revealed: true }
    ];

    // ---- Carnet (sections + notes) ----
    const carnetNotes = [
        { id: rid(), type: "section", title: "Journal de campagne" },
        { id: rid(), title: "Arrivée aux Marches", linkedExpId: null,
          content: "<p>Aeryn rejoint les Marches de l'Ouest. Premiers contacts avec Dame Sylwen, qui l'envoie éclaircir les raids gobelins.</p>" },
        { id: rid(), title: "La menace gobeline", linkedExpId: null,
          content: "<p>Les raids se multiplient près de la grotte de Karndal. Rictus le Balafré semble tirer les ficelles.</p>" }
    ];

    // ---- Expéditions (auto-suffisantes ; PAS de gmId → n'apparaissent pas
    //      dans le Casier / le Suivi des GM du serveur) ----
    const expeditions = [
        { id: rid(), name: "Reconnaissance du Col des Corbeaux", startDate: { day: 12, month: 2, year: 1487 }, endDate: { day: 15, month: 2, year: 1487 } },
        { id: rid(), name: "La clairière du Vieux Chêne",        startDate: { day: 3,  month: 4, year: 1487 }, endDate: null }
    ];

    await Actor.create({
        name:   "Aeryn Nightleaf (Tutoriel)",
        type:   "character",
        img:    "icons/environment/people/commoner.webp",
        folder: folder?.id ?? null,
        ownership: { default: NONE },
        prototypeToken: { name: "Aeryn (Tutoriel)", actorLink: true },
        flags: { [MOD]: {
            tutorialDemo: true,
            tutorialDemoVersion: DEMO_VERSION,
            relationsList, bestiaryList, carnetNotes, expeditions
        } },
        system: {
            abilities: {
                str: { value: 10 }, dex: { value: 18 }, con: { value: 14 },
                int: { value: 11 }, wis: { value: 16 }, cha: { value: 12 }
            },
            attributes: { hp: { value: 98, max: 98 } },
            details: {
                biography: { value: bio },
                alignment: "Neutre Bon",
                xp: { value: 100000 }
            }
        },
        items
    });
}
