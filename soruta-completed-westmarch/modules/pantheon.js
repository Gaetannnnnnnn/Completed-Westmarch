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
            if (game.settings.get(MOD, "pantheonCreatedOnce") === true) return;

            await createPantheon();

            // Marque la création comme faite, quoi qu'il arrive ensuite, pour ne
            // JAMAIS recréer automatiquement (même si le MJ supprime le dossier).
            await game.settings.set(MOD, "pantheonCreatedOnce", true);
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
    delete data.ownership;   // laisse les permissions par défaut (le MJ les ajustera)
    data.folder = folder?.id ?? null;

    await JournalEntry.create(data, { keepId: false });
    console.log(`[${MOD}] Dossier « ${FOLDER_NAME} » créé avec « ${data.name} ».`);
    ui.notifications?.info(`Dossier « ${FOLDER_NAME} » créé dans les Journaux (Dieux de Faerûn).`);
}
