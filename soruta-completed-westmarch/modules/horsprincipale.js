import { MOD } from "./const.js";
// ============================================================
// horsprincipale.js — Campagnes secondaires (hors campagne principale)
//
// Un dossier d'acteurs est désigné dans les réglages. Tous les personnages
// qu'il contient (et ceux de ses sous-dossiers) sont « hors principale » :
//   - absents du casier, des statistiques, des assiduités et des
//     expéditions comptées ;
//   - pas d'étape de validation de fiche ;
//   - rien envoyé sur Discord (pings de validation, logs).
// Le bestiaire, les relations et la mécanique d'expédition continuent de
// fonctionner normalement pour eux.
// © 2026 Soruta.
// ============================================================

// Id du dossier secondaire, ou "" si la fonction est désactivée / non réglée.
export function dossierSecondaireId() {
    try {
        if (game.settings.get(MOD, "enableSecondaryCampaign") !== true) return "";
        return game.settings.get(MOD, "secondaryFolderId") || "";
    } catch { return ""; }
}

// Vrai si l'acteur est dans le dossier secondaire choisi, ou l'un de ses
// sous-dossiers (on remonte l'arbre des dossiers).
export function estHorsPrincipale(actor) {
    const id = dossierSecondaireId();
    if (!id || !actor) return false;
    let f = actor.folder, garde = 0;
    while (f && garde++ < 50) {
        if (f.id === id) return true;
        f = f.folder;
    }
    return false;
}
