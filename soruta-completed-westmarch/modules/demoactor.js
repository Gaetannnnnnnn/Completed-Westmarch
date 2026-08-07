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

const DEMO_VERSION = 8;
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
    const createdVersion = Number(game.settings.get(MOD, "tutorialActorVersion") ?? 0);

    if (existing) {
        if ((existing.getFlag(MOD, "tutorialDemoVersion") ?? 1) >= DEMO_VERSION) return;
        // Ancienne fiche démo → on tente de créer la nouvelle AVANT de supprimer
        // l'ancienne, pour ne jamais rester sans fiche si la création échoue.
        try {
            await createDemoActor();
            await game.settings.set(MOD, "tutorialActorVersion", DEMO_VERSION);
            await game.settings.set(MOD, "tutorialActorCreated", true);
            try { await existing.delete(); } catch (e) { console.warn(`[${MOD}] Suppression ancienne fiche démo :`, e); }
            console.log(`[${MOD}] Fiche démo du tutoriel mise à jour (v${DEMO_VERSION}).`);
        } catch (err) {
            console.error(`[${MOD}] Échec de la mise à jour de la fiche démo (ancienne conservée) :`, err);
        }
        return;
    }

    // Pas de fiche existante. On ne recrée pas si la version courante a déjà été
    // créée puis supprimée volontairement par le GM. Un bump de DEMO_VERSION
    // (createdVersion < DEMO_VERSION) autorise la recréation.
    if (createdVersion >= DEMO_VERSION) return;

    try {
        await createDemoActor();
        await game.settings.set(MOD, "tutorialActorVersion", DEMO_VERSION);
        await game.settings.set(MOD, "tutorialActorCreated", true);
        console.log(`[${MOD}] Fiche démo du tutoriel créée (v${DEMO_VERSION}).`);
    } catch (err) {
        console.error(`[${MOD}] Échec de la création de la fiche démo du tutoriel :`, err);
        ui.notifications?.warn("Completed Westmarch : échec de la création de la fiche démo du tutoriel (voir la console F12). Nouvelle tentative au prochain rechargement.");
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

    // ---- Fiche de base : chargée depuis le JSON livré dans le module ----
    // (personnage complet exporté depuis Foundry : classe, sorts, aptitudes,
    // équipement, caractéristiques…). On applique nos overrides par-dessus.
    const resp = await fetch(`modules/${MOD}/data/tutorial-actor.json`);
    if (!resp.ok) throw new Error(`Chargement de data/tutorial-actor.json échoué : HTTP ${resp.status}`);
    const data = await resp.json();

    // Nettoyage des champs propres au monde source (acteur + objets embarqués).
    // On retire _id/_stats et les flags de modules tiers (midi-qol, plutonium,
    // tidy5e…) qui ne servent pas à la démo et pourraient poser souci.
    delete data._id; delete data._stats; delete data.folder; delete data.ownership;
    if (Array.isArray(data.items)) {
        for (const it of data.items) {
            delete it._stats;
            if (it.flags) for (const ns of Object.keys(it.flags)) {
                if (ns !== "dnd5e") delete it.flags[ns];
            }
        }
    }

    // Image forcée sur celle de l'ancienne fiche démo (icône du cœur → marche
    // partout, aucun fichier à livrer).
    const IMG = "icons/environment/people/commoner.webp";
    data.name = data.name || "Tutoriel";
    data.type = "character";
    data.img  = IMG;
    data.folder = folder?.id ?? null;
    data.ownership = { default: NONE };
    data.prototypeToken = data.prototypeToken ?? {};
    data.prototypeToken.name = data.name;
    data.prototypeToken.actorLink = true;
    data.prototypeToken.texture = { ...(data.prototypeToken.texture ?? {}), src: IMG };

    // Flags : marqueur de fiche démo + contenus de démonstration des onglets.
    data.flags = data.flags ?? {};
    data.flags[MOD] = {
        tutorialDemo: true,
        tutorialDemoVersion: DEMO_VERSION,
        relationsList, bestiaryList, carnetNotes, expeditions
    };

    const created = await Actor.create(data);
    if (!created) throw new Error("Actor.create n'a renvoyé aucun acteur.");
    return created;
}
