// ============================================================
// pantheon.js — Dossier « Panthéons » (Dieux de Faerûn)
//
// Au premier lancement (MJ), si l'option createPantheonFolder est active,
// crée un dossier de Journaux « Panthéons » (couleur #860404) et y importe
// le JournalEntry fourni avec le module (data/dieux-de-faerun-complet.json).
// Création UNE SEULE FOIS (flag world pantheonCreatedOnce) : si le MJ le
// supprime, il n'est pas recréé au prochain lancement.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const FOLDER_NAME  = "Panthéons";
const FOLDER_COLOR = "#860404";

export function PantheonHooks() {
    Hooks.once("ready", async () => {
        try {
            if (!game.user?.isGM) return;
            if (!game.settings.get(MOD, "createPantheonFolder")) return;

            if (game.settings.get(MOD, "pantheonCreatedOnce") !== true) {
                await createPantheon();
                await game.settings.set(MOD, "pantheonCreatedOnce", true);
            }

            // Migration unique : rendre VISIBLE par tous un panthéon créé avant
            // l'ajout du partage (il était MJ-only). Ne s'exécute qu'une fois.
            if (game.settings.get(MOD, "pantheonSharedOnce") !== true) {
                await sharePantheonWithPlayers();
                await game.settings.set(MOD, "pantheonSharedOnce", true);
            }
        } catch (e) {
            console.error(`[${MOD}] Création du dossier « Panthéons » :`, e);
        }
    });
}

async function createPantheon() {
    // Charge l'export du JournalEntry embarqué dans le module.
    const resp = await fetch(`modules/${MOD}/data/dieux-de-faerun-complet.json`);
    if (!resp.ok) throw new Error(`Chargement de data/dieux-de-faerun-complet.json échoué : HTTP ${resp.status}`);
    const data = await resp.json();

    // Dossier de Journaux « Panthéons » (réutilise un éventuel dossier existant
    // au même nom pour éviter les doublons).
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === FOLDER_NAME);
    if (!folder) {
        folder = await Folder.create({ name: FOLDER_NAME, type: "JournalEntry", color: FOLDER_COLOR });
    }

    // Nettoie les champs d'export qui ne doivent pas être réinjectés tels quels.
    delete data._id;
    delete data._stats;
    data.folder = folder?.id ?? null;
    // Visible par TOUS les joueurs (Observateur par défaut) + flag d'identification.
    data.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [MOD]: { pantheon: true } });

    await JournalEntry.create(data, { keepId: false });
    console.log(`[${MOD}] Dossier « ${FOLDER_NAME} » créé avec « ${data.name} ».`);
    ui.notifications?.info(`Dossier « ${FOLDER_NAME} » créé dans les Journaux (Dieux de Faerûn).`);
}

// Rend visible par tous (Observateur) les journaux « Panthéons » existants qui
// étaient encore MJ-only (créés avant l'ajout du partage). Idempotent.
async function sharePantheonWithPlayers() {
    const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    const folder = game.folders.find(f => f.type === "JournalEntry" && f.name === FOLDER_NAME);
    const journals = game.journal.filter(j =>
        j.getFlag(MOD, "pantheon") === true ||
        (folder && (j.folder?.id === folder.id)));
    for (const j of journals) {
        if ((j.ownership?.default ?? 0) < OBS) {
            try {
                await j.update({ "ownership.default": OBS, [`flags.${MOD}.pantheon`]: true });
                console.log(`[${MOD}] Panthéon « ${j.name} » rendu visible par tous les joueurs.`);
            } catch (e) { console.warn(`[${MOD}] Partage du panthéon échoué :`, e); }
        }
    }
}
