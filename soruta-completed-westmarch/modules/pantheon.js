// ============================================================
// pantheon.js — Dossier « Panthéons » (Dieux de Faerûn)
//
// Au premier lancement (MJ), si l'option createPantheonFolder est active,
// crée un dossier de Journaux « Panthéons » (couleur #860404) et y importe
// le JournalEntry fourni avec le module (data/dieux-de-faerun-complet.json en
// français, data/dieux-de-faerun-en.json en anglais).
// Création UNE SEULE FOIS (flag world pantheonCreatedOnce) : si le MJ le
// supprime, il n'est pas recréé au prochain lancement.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

import { journal } from "./log.js";
import { tl, memeNom, estFr } from "./i18n.js";
const FOLDER_NAME  = tl("Panthéons");
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
            journal.erreur(tl("[{0}] Création du dossier « Panthéons » :", MOD), e);
        }
    });
}

async function createPantheon() {
    // Charge l'export du JournalEntry embarqué dans le module.
    // Version française ou anglaise selon la langue du MJ qui le crée.
    const fichier = `data/dieux-de-faerun-${estFr() ? "complet" : "en"}.json`;
    const resp = await fetch(`modules/${MOD}/${fichier}`);
    if (!resp.ok) throw new Error(tl("Chargement de {0} échoué : HTTP {1}", fichier, resp.status));
    const data = await resp.json();

    // Dossier de Journaux « Panthéons » (réutilise un éventuel dossier existant
    // au même nom pour éviter les doublons).
    let folder = game.folders.find(f => f.type === "JournalEntry" && memeNom(f.name, tl("Panthéons")));
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
    journal.debug(tl("[{0}] Dossier « {1} » créé avec « {2} ».", MOD, FOLDER_NAME, data.name));
    ui.notifications?.info(tl("Dossier « {0} » créé dans les Journaux ({1}).", FOLDER_NAME, data.name));
}

// Rend visible par tous (Observateur) les journaux « Panthéons » existants qui
// étaient encore MJ-only (créés avant l'ajout du partage). Idempotent.
async function sharePantheonWithPlayers() {
    const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    const folder = game.folders.find(f => f.type === "JournalEntry" && memeNom(f.name, tl("Panthéons")));
    const journals = game.journal.filter(j =>
        j.getFlag(MOD, "pantheon") === true ||
        (folder && (j.folder?.id === folder.id)));
    for (const j of journals) {
        if ((j.ownership?.default ?? 0) < OBS) {
            try {
                await j.update({ "ownership.default": OBS, [`flags.${MOD}.pantheon`]: true });
                journal.debug(tl("[{0}] Panthéon « {1} » rendu visible par tous les joueurs.", MOD, j.name));
            } catch (e) { journal.avert(tl("[{0}] Partage du panthéon échoué :", MOD), e); }
        }
    }
}
