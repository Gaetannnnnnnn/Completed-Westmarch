// ============================================================
// settings.js — Paramètres unifiés du module Soruta — Completed Westmarch
// Tous les settings des 9 anciens modules, sous le namespace unique MOD.
// Les clés en collision ont été préfixées par domaine (relations*, bestiary*,
// carnet*, rangeFix*, tuto*). Voir migration.js pour la reprise des valeurs.
// © 2026 Soruta.
// ============================================================

import { MOD, TUTO_TOGGLES, TM_DEFAULT_SCROLL, TM_DEFAULT_MAGIC, TM_DEFAULT_ROLL, ACTIVATION_CODE, DEACTIVATION_CODE } from "./const.js";
import { applyPartyPause } from "./partypause.js";
import { openProfilesEditor } from "./companions.js";
import { openUiHideDialog, applyUiHiding } from "./uihide.js";
import { applyChatCardPrefs } from "./chat.js";

// ============================================================
// Ressources communes — accès centralisé (avec repli sur les anciennes clés
// par feature, pour ne rien casser tant que la migration n'a pas tourné).
// ============================================================
export const commonFolderPJ       = () => game.settings.get(MOD, "commonFolderPJ")       || game.settings.get(MOD, "relationsFolderPJ")    || game.settings.get(MOD, "bestiaryFolderPJ") || "";
export const commonFolderPNJ      = () => game.settings.get(MOD, "commonFolderPNJ")      || game.settings.get(MOD, "relationsFolderPNJ")   || "";
export const commonFolderNewChars = () => game.settings.get(MOD, "commonFolderNewChars") || game.settings.get(MOD, "charValidationFolder") || "";
export const commonPackPNJ        = () => game.settings.get(MOD, "commonPackPNJ")        || game.settings.get(MOD, "relationsPackPNJ")     || "";
export const commonPackCemetery   = () => game.settings.get(MOD, "commonPackCemetery")   || game.settings.get(MOD, "relationsPackCemetery")|| "";
export const commonPackCreatures  = () => game.settings.get(MOD, "commonPackCreatures")  || game.settings.get(MOD, "bestiaryPackCreatures")|| "";
export const commonPackCraft      = () => game.settings.get(MOD, "commonPackCraft")      || game.settings.get(MOD, "tmCraftPack")          || "";

// Recopie une seule fois les anciennes valeurs par feature vers les clés
// communes, pour qu'elles s'affichent dans la nouvelle section centrale.
export async function migrateCommonResources() {
    if (!game.user.isGM) return;
    if (game.settings.get(MOD, "commonResourcesMigrated")) return;
    const map = {
        commonFolderPJ:       ["relationsFolderPJ", "bestiaryFolderPJ"],
        commonFolderPNJ:      ["relationsFolderPNJ"],
        commonFolderNewChars: ["charValidationFolder"],
        commonPackPNJ:        ["relationsPackPNJ"],
        commonPackCemetery:   ["relationsPackCemetery"],
        commonPackCreatures:  ["bestiaryPackCreatures"],
        commonPackCraft:      ["tmCraftPack"]
    };
    for (const [dest, srcs] of Object.entries(map)) {
        if (game.settings.get(MOD, dest)) continue;
        for (const s of srcs) {
            const v = game.settings.get(MOD, s);
            if (v) { await game.settings.set(MOD, dest, v); break; }
        }
    }
    await game.settings.set(MOD, "commonResourcesMigrated", true);
}

// Settings dont l'utilité dépend entièrement du système de party.
export const PARTY_DEPENDENT_SETTINGS = [
    "enableJoinScene",
    "enableShowParty",
    "enableChatFilter",
    "enablePlayerGrouping",
    "enableGoWithPartyScenes",
    "enableGoWithPartyJournal",
    "enableSessionLog",
    "enableCombatParty",
    "enableCombatTurnLock",
    "enablePartyPause"
];

// Vérifie qu'un setting dépendant de la party est actif ET que la party l'est.
export function partyFeatureEnabled(key) {
    if (!game.settings.get(MOD, "enableParty")) return false;
    return game.settings.get(MOD, key);
}

// config: false → les réglages ne s'affichent plus en liste dans la config du
// module ; ils sont édités via les fenêtres de catégorie (registerMenu).
const B = (name, hint, def = true, extra = {}) => ({
    name, hint, scope: "world", config: false, type: Boolean, default: def, requiresReload: false, ...extra
});
const N = (name, hint, def) => ({
    name, hint, scope: "world", config: false, type: Number, default: def, requiresReload: false
});
const S = (name, hint, def = "") => ({
    name, hint, scope: "world", config: false, type: String, default: def, requiresReload: false
});

export function registerSettings() {

    // ============================================================
    // DOSSIERS & COMPENDIUMS COMMUNS
    // Renseignés une seule fois ici ; lus par toutes les fonctions
    // (Relations, Bestiaire, Création de perso, Temps morts).
    // ============================================================
    game.settings.register(MOD, "commonFolderPJ", S(
        "Dossier des PJ",
        "Dossier d'acteurs contenant les personnages joueurs. Utilisé par Relations et Bestiaire pour reconnaître les PJ."));
    game.settings.register(MOD, "autoPlayerFolder", B(
        "Sous-dossier auto au nom du joueur",
        "À la première connexion d'un joueur, crée automatiquement dans le « Dossier des PJ » un sous-dossier portant son nom.", true));
    game.settings.register(MOD, "gmAutoFolderParent", S(
        "Sous-dossier auto au nom du MJ — dossier parent",
        "Nom du dossier parent (identique dans Acteurs, Journaux et Scènes) dans lequel, à la connexion d'un MJ, un sous-dossier à son nom est créé automatiquement dans ces trois arbres. Laisser vide pour désactiver."));
    game.settings.register(MOD, "commonFolderPNJ", S(
        "Dossier des PNJ",
        "Dossier d'acteurs des PNJ récurrents (alliés, marchands, figures importantes). Utilisé par Relations."));
    game.settings.register(MOD, "commonFolderNewChars", S(
        "Dossier des nouveaux personnages",
        "Dossier où sont créés les personnages validés (Création de personnages)."));
    game.settings.register(MOD, "commonPackPNJ", S(
        "Compendium des PNJ",
        "Compendium d'acteurs PNJ. Ses personnages sont proposés dans le sélecteur de relations (groupe PNJ)."));
    game.settings.register(MOD, "commonPackCemetery", S(
        "Compendium du cimetière",
        "Compendium d'acteurs (anciens PJ / cimetière). Proposé dans le sélecteur de relations (groupe Joueurs)."));
    game.settings.register(MOD, "commonPackCreatures", S(
        "Compendium des créatures",
        "Compendium d'acteurs créatures. Utilisé par le Bestiaire (ajout et reconnaissance des créatures)."));
    game.settings.register(MOD, "commonPackCraft", S(
        "Compendium des objets craftables",
        "Compendium d'OBJETS (ex. importé via Plutonium). Utilisé par l'artisanat des temps morts pour attribuer l'objet fabriqué."));
    game.settings.register(MOD, "commonResourcesMigrated", {
        scope: "world", config: false, type: Boolean, default: false, requiresReload: false
    });

    // ============================================================
    // À PROPOS & PROTECTION
    // Le module ne fonctionne que si le code d'activation est correct. Il n'y a
    // volontairement AUCUN interrupteur pour désactiver la protection (sinon on
    // pourrait la contourner en la décochant).
    // ============================================================
    game.settings.register(MOD, "activationCode", S(
        "Code d'activation",
        "Code attendu par la protection. À renseigner sur ton serveur. Nécessite un rechargement."));

    // ============================================================
    // WESTMARCH — Système de party (core)
    // ============================================================
    game.settings.register(MOD, "enableParty", B(
        "Système de Party",
        "Active le système de party (Create/Join/Leave/Kick/Invite Party). Si désactivé, toutes les options qui en dépendent sont automatiquement désactivées."));
    game.settings.register(MOD, "enableJoinScene", B(
        "Join Scene",
        "Ajoute une option 'Join Scene' dans le menu contextuel de la liste des joueurs (téléportation vers la scène d'un autre membre)."));
    game.settings.register(MOD, "enableShowParty", B(
        "Show Party (partage d'image)",
        "Ajoute un bouton 'Show Party' dans la barre de titre des fenêtres d'image (partage à tous les membres de la party)."));
    game.settings.register(MOD, "enablePlayerGrouping", B(
        "Regroupement visuel des joueurs par party",
        "Réorganise la liste des joueurs pour regrouper visuellement les membres d'une même party."));
    game.settings.register(MOD, "enableGoWithPartyScenes", B(
        "Go With Party (répertoire de scènes)",
        "Ajoute 'Go With Party' dans le menu contextuel du répertoire de scènes (téléporte toute la party)."));
    game.settings.register(MOD, "enableGoWithPartyJournal", B(
        "Go With Party (liens de journaux)",
        "Ajoute 'Go Alone' et 'Go With Party' au menu contextuel des liens de scène dans les journaux."));
    game.settings.register(MOD, "enableChatFilter", B(
        "Filtrage du chat par party",
        "Les joueurs ne voient que les messages des membres de leur propre party."));
    game.settings.register(MOD, "enableChatTabs", B(
        "Onglets de chat (IC / Autre / OOC)",
        "Affiche la barre d'onglets qui sépare les messages par type. Désactivé : tous les messages (de la party) sont regroupés au même endroit, sans onglets.",
        false));
    game.settings.register(MOD, "enableNoteLink", B(
        "Carnet commun (notes liées)",
        "Le MJ peut lier les notes des joueurs de sa party via un « carnet commun » (un journal partagé, éditable par tous les membres liés). Le lien survit à la dissolution de la party. Un joueur n'appartient qu'à un seul groupe à la fois.",
        false));
    // Groupes de carnets communs : [{ id, journalId, members:[userId] }]. Non affiché.
    game.settings.register(MOD, "noteLinkGroups", {
        scope: "world", config: false, type: Array, default: []
    });
    game.settings.register(MOD, "enableSessionLog", B(
        "Rapport de session",
        "Active le suivi de session (dès la création de party) et le bouton 'Clore la session', qui envoie le récap (XP, ennemis, PNJ, objets) sur le webhook Discord ci-dessous."));
    game.settings.register(MOD, "sessionLogWebhookUrl", S(
        "URL du Webhook Discord (rapport de session)",
        "Le bouton 'Clore la session' envoie le rapport (même contenu que les anciens journaux) sur ce webhook. Laisser vide pour désactiver l'envoi."));
    game.settings.register(MOD, "sessionLogForum", B(
        "Salon Discord de type Forum",
        "Si le webhook pointe vers un salon Forum : les rapports sont regroupés dans un post (fil) de forum par meneur, réutilisé à chaque nouveau rapport. Laisser désactivé pour un salon textuel classique.",
        false));
    // Fils de forum créés par meneur (gmId → threadId). Non affiché.
    game.settings.register(MOD, "sessionForumThreads", {
        scope: "world", config: false, type: Object, default: {}
    });
    // Brouillons de rapports de session (Casier du GM). Non affiché.
    game.settings.register(MOD, "sessionDrafts", {
        scope: "world", config: false, type: Array, default: []
    });
    // Journal des sessions clôturées (assiduité) : { id, gmId, gmName, dateISO,
    // players:[{actorId,name}] }. Alimenté à chaque clôture. Non affiché.
    game.settings.register(MOD, "sessionLog", {
        scope: "world", config: false, type: Array, default: []
    });
    // Profils de Casier par GM (présentation du dashboard, etc.). Non affiché.
    game.settings.register(MOD, "casierProfiles", {
        scope: "world", config: false, type: Object, default: {}
    });
    game.settings.register(MOD, "enableCombatParty", B(
        "Combat lié à la party (plutôt qu'à la scène)",
        "Les combats créés par un GM sont détachés de la scène et associés à sa party. Chaque joueur ne voit que le combat de sa party."));
    game.settings.register(MOD, "enableCombatTurnLock", B(
        "Blocage de mouvement hors tour (combat)",
        "Pendant le combat de votre party, un joueur ne peut déplacer son token que quand c'est son tour. Le combat d'une autre party n'affecte jamais vos joueurs. Ne nécessite pas Monk's TokenBar."));
    game.settings.register(MOD, "enablePartyPause", B(
        "Pause de party (remplace le pause global)",
        "Remplace le pause natif de Foundry par un pause propre à chaque party : le GM met SA party en pause (bandeau + blocage du déplacement de ses joueurs), sans affecter les autres. Masque l'indicateur de pause natif. Nécessite un rechargement.",
        false, { requiresReload: true }));
    game.settings.register(MOD, "enableCharValidation", B(
        "Validation des personnages",
        "Les joueurs demandent la création d'un personnage ; un GM valide depuis le Casier (un acteur est créé dans un dossier dédié, le joueur en devient propriétaire). Le joueur construit sa fiche puis la soumet ; à la validation, la fiche est verrouillée (construction non modifiable côté joueur, jeu libre)."));
    game.settings.register(MOD, "charMaxTotal", N(
        "Nombre de personnages max par joueur",
        "Nombre maximum de personnages qu'un joueur peut posséder (actifs + en stock). 0 = illimité.",
        0));
    game.settings.register(MOD, "charMaxActive", N(
        "Personnages actifs simultanés",
        "Nombre de personnages jouables en même temps. Les autres passent « en stock » (cadenas, en Observateur, non jouables).",
        2));
    game.settings.register(MOD, "blockPlayerPlutonium", B(
        "Bloquer les imports Plutonium hors autorisation",
        "Empêche les joueurs d'importer du contenu Plutonium sur une fiche VERROUILLÉE. L'import n'est possible que pendant une fenêtre autorisée par le MJ (création du personnage, ou montée de niveau validée). Les GM ne sont jamais bloqués."));
    game.settings.register(MOD, "charFreeLevelUp", B(
        "Montées de niveau libres (sans validation MJ)",
        "Mode confiance : une fois le personnage validé à la création, les modifications de construction (montées de niveau) ne sont PLUS bloquées ni reverrouillées — le joueur monte de niveau librement, sans passer par le MJ. Le verrou ne s'applique donc qu'à la création initiale.",
        false));
    game.settings.register(MOD, "charNotifyLevelUp", B(
        "Notifier le MJ des montées de niveau",
        "Quand les montées de niveau sont libres, poste quand même au MJ un récapitulatif des changements (niveau, classe, aptitudes, sorts ajoutés/retirés) — pour information, sans rien bloquer.",
        true));
    game.settings.register(MOD, "charValidationFolder", S(
        "Validation — Dossier des personnages",
        "Nom du dossier d'acteurs où sont créés les personnages validés.",
        "Personnages"));

    // ---- Contrôle des sources (livres/extensions autorisés) ----
    game.settings.register(MOD, "enableSourceControl", B(
        "Contrôle des sources autorisées",
        "Réglemente quels livres/extensions D&D (Xanathar, Tal'Dorei, etc.) peuvent être ajoutés à une fiche PJ, quelle que soit la méthode (import Plutonium/5etools, glisser-déposer, création manuelle). Le contenu d'une source non autorisée est bloqué avec un avertissement.",
        false));
    game.settings.register(MOD, "sourceAllowPlayers", S(
        "Sources autorisées — Joueurs",
        "Liste blanche des sources autorisées pour les JOUEURS. Sépare les entrées par « ; ». Une entrée = « Source » (tous types) ou « Source : type1, type2 » pour n'autoriser que certains types de cette source. "
        + "Types : race, classe, sous-classe, don, sort, historique, objet. "
        + "Ex. : « PHB 2024 ; Tal'Dorei : race ; Xanathar : sous-classe, don » = tout de PHB 2024, mais seulement les races de Tal'Dorei et seulement sous-classes/dons de Xanathar. Laisser vide = aucune restriction pour les joueurs."));
    game.settings.register(MOD, "sourceAllowGm", S(
        "Sources autorisées — MJ",
        "Liste blanche des sources autorisées pour le MJ, même syntaxe que pour les joueurs (« Source » ou « Source : type1, type2 », entrées séparées par « ; »). Laisser vide = aucune restriction pour le MJ."));
    game.settings.register(MOD, "sourceMatchField", {
        name: "Champ comparé (Book ou Identifier)",
        hint: "Choisit sur quel champ de la source portent les listes ci-dessus. « Book » = le livre (ex. « PHB 2024 »), plus large. « Identifier » = l'identifiant précis de l'objet (ex. « unarmed-strike »), pour un filtrage fin. « Les deux » accepte une correspondance sur l'un OU l'autre.",
        scope: "world", config: false, type: String, default: "book", requiresReload: false,
        choices: { book: "Book (livre)", identifier: "Identifier (identifiant)", both: "Les deux (l'un ou l'autre)" }
    });
    game.settings.register(MOD, "sourceMatchExact", B(
        "Correspondance exacte des sources",
        "Activé : une source n'est autorisée que si elle correspond EXACTEMENT à une entrée de la liste (« PHB » n'autorise pas « XPHB », le PHB 2024). Désactivé : correspondance souple (une entrée autorise toute source qui la contient) — plus permissif mais risque d'autoriser des sources proches sans le vouloir.",
        true));
    game.settings.register(MOD, "sourceBlockUnknown", B(
        "Bloquer le contenu sans source identifiable",
        "Refuse tout contenu dont la source ne peut pas être déterminée (homebrew, objet créé à la main, source vide). Ne s'applique que si une liste de sources est renseignée pour le rôle concerné.",
        true));
    // État de pause par party (mapping partyId -> true), synchronisé sur tous
    // les clients. Non affiché dans la configuration.
    game.settings.register(MOD, "partyPauseState", {
        scope: "world", config: false, type: Object, default: {},
        onChange: () => applyPartyPause()
    });
    game.settings.register(MOD, "enableAntiCheat", B(
        "Anti-Cheat (combat)",
        "Pendant un combat actif, avertit les GM en privé si un joueur modifie ses sorts préparés, son attunement ou son équipement."));

    // ============================================================
    // SERVEUR — Personnalisations
    // ============================================================
    game.settings.register(MOD, "enableXpBlock", B(
        "Blocage de l'XP et du Level Up",
        "Empêche les joueurs de modifier leur XP et masque le bouton Level Up. Les GM ne sont pas affectés."));
    game.settings.register(MOD, "enableFakeWarning", B(
        "Faux message de maintenance (farce GM)",
        "Ajoute un bouton GM dans la barre WestMarch pour envoyer un faux avertissement jaune (« Mise à jour effectuée… ») à un joueur. Décochez pour retirer complètement le bouton.",
        true));
    game.settings.register(MOD, "enableGmNotes", B(
        "Note GM sur les fiches PJ",
        "Ajoute un onglet « Note GM » sur les fiches de personnage, visible et modifiable uniquement par les GM. Les joueurs ne voient pas l'onglet. Nécessite un rechargement.",
        true, { requiresReload: true }));

    // ---- Rappels de combat (assistant contextuel, dépend de Midi-QOL) ----
    game.settings.register(MOD, "enableReactReminder", B(
        "Rappel des réactions",
        "Quand un PJ est réellement ciblé par une attaque (via Midi-QOL), lui propose ses réactions dans un pop-up et prévient le MJ de sa party qu'il réfléchit ; le choix du joueur ferme la notif du MJ.",
        false));
    game.settings.register(MOD, "enableBonusReminder", B(
        "Rappel des actions bonus utiles",
        "Propose une action bonus pertinente au bon moment (ex. Divine Smite après un coup au corps-à-corps si le PJ a des emplacements de sort).",
        false));
    game.settings.register(MOD, "enableMasteryReminder", B(
        "Rappel des maîtrises d'arme (weapon mastery)",
        "Si l'arme utilisée possède une maîtrise sur la fiche du PJ, rappelle son effet lors de l'attaque.",
        false));
    game.settings.register(MOD, "enableAdvantageReminder", B(
        "Rappel avantage / désavantage",
        "Au jet d'attaque, signale les sources d'avantage/désavantage selon l'état de la cible (à terre + CaC…) et les effets de statut du PJ.",
        false));
    // Opt-out PAR JOUEUR (réglage client, visible et modifiable par chacun) :
    // coupe les pop-ups/chuchotements de rappels de combat sur SON écran.
    game.settings.register(MOD, "combatRemindersOff", {
        name: "Désactiver mes rappels de combat",
        hint: "Coché = tu ne reçois plus les pop-ups et chuchotements de rappels de combat (réactions, châtiments/smite, avantage/désavantage, maîtrises). N'affecte que TON écran, pas les autres joueurs ni le MJ.",
        scope: "client", config: true, type: Boolean, default: false
    });
    game.settings.register(MOD, "hidePlayerStarTab", B(
        "Masquer l'onglet « étoile » aux joueurs",
        "Cache l'onglet dont l'icône est une étoile (favoris) sur les fiches de personnage, pour les joueurs uniquement. Les GM le voient toujours."));
    game.settings.register(MOD, "enableDiscordLog", B(
        "Log Discord (modifications)",
        "Envoie un message Discord à chaque ajout/suppression d'objet, changement de quantité/monnaie, gain d'XP/niveau, et création/suppression de personnage.",
        false));
    game.settings.register(MOD, "discordLogWebhookUrl", S(
        "URL du Webhook Discord (log modifications)",
        "URL du webhook Discord pour les logs de modifications. Laisser vide pour désactiver."));
    game.settings.register(MOD, "downtimeWebhookUrl", S(
        "URL du Webhook Discord (changement de date)",
        "Quand le GM avance la date dans Simple Calendar, envoie un message sur ce webhook. Laisser vide pour désactiver."));
    game.settings.register(MOD, "tmWebhookUrl", S(
        "URL du Webhook Discord (résultats temps morts)",
        "Quand le GM applique les gains de temps morts, envoie le récapitulatif sur ce webhook (salon staff/MJ). Laisser vide pour désactiver."));

    // ============================================================
    // TEMPS MORTS — règles configurables (valeurs + formules + tables)
    // ============================================================
    game.settings.register(MOD, "tmEnabled", B(
        "Temps morts — Activer",
        "Active tout le système de temps morts : bouton sablier sur la fiche PJ (joueur) et onglet « Temps morts » dans le Casier (GM). Nécessite un rechargement.",
        true, { requiresReload: true }));
    // -- Gain de compétence --
    game.settings.register(MOD, "tmSkillBase", N(
        "Gain — Base par jour",
        "Valeur de base ajoutée chaque jour avant caractéristique et bonus.", 1));
    game.settings.register(MOD, "tmAddAbilityMod", B(
        "Gain — Ajouter le modificateur de caractéristique",
        "Si activé, le modificateur de la caractéristique de la compétence est ajouté au taux journalier."));
    game.settings.register(MOD, "tmBonusMaitrise", N(
        "Gain — Bonus Maîtrise", "Bonus journalier si la compétence est maîtrisée.", 2));
    game.settings.register(MOD, "tmBonusExpertise", N(
        "Gain — Bonus Expertise", "Bonus journalier si la compétence est en expertise.", 4));
    game.settings.register(MOD, "tmBonusTools", N(
        "Gain — Bonus Outils", "Bonus journalier pour une maîtrise d'outil.", 4));
    game.settings.register(MOD, "tmRollMinDays", N(
        "Gain — Jours min. pour le jet d20", "Nombre de jours minimum pour autoriser le jet de compétence optionnel.", 5));
    game.settings.register(MOD, "tmSkillFormula", S(
        "Gain — Formule (avancé)",
        "Formule du taux JOURNALIER. Vide = calcul par défaut max(0, base + mod + bonus). Variables : base, mod, bonus, maitrise, expertise, tools. Fonctions : max, min, floor, ceil, round, abs, pow, sqrt."));

    // -- Artisanat : non-magique --
    game.settings.register(MOD, "tmCraftNonMagicCostDiv", N(
        "Craft non-magique — Diviseur de coût", "Coût par défaut = prix / ce diviseur.", 2));
    game.settings.register(MOD, "tmCraftNonMagicDaysPerGp", N(
        "Craft non-magique — PO par jour", "Durée par défaut = arrondi sup. de prix / cette valeur.", 10));
    game.settings.register(MOD, "tmCraftNonMagicCostFormula", S(
        "Craft non-magique — Formule coût (avancé)",
        "Vide = prix / div. Variables : price, div, daysPerGp. Fonctions math disponibles."));
    game.settings.register(MOD, "tmCraftNonMagicDaysFormula", S(
        "Craft non-magique — Formule durée (avancé)",
        "Vide = ceil(price / daysPerGp). Variables : price, div, daysPerGp. Fonctions math disponibles."));

    // -- Artisanat : usage unique --
    game.settings.register(MOD, "tmSingleUseFactor", N(
        "Craft magique — Facteur usage unique", "Multiplie jours et coût pour un objet magique à usage unique (0.5 = moitié).", 0.5));

    // -- Tables (éditées via champs structurés dans la fenêtre) --
    game.settings.register(MOD, "tmScrollTable", {
        name: "Table des parchemins (par niveau de sort 0→9)",
        scope: "world", config: false, type: Object, default: TM_DEFAULT_SCROLL
    });
    game.settings.register(MOD, "tmMagicTable", {
        name: "Table des objets magiques (par rareté)",
        scope: "world", config: false, type: Object, default: TM_DEFAULT_MAGIC
    });
    game.settings.register(MOD, "tmRollTable", {
        name: "Multiplicateurs du test de compétence (par résultat)",
        scope: "world", config: false, type: Object, default: TM_DEFAULT_ROLL
    });
    game.settings.register(MOD, "tmReliableTalent", B(
        "Prise en charge du Reliable Talent",
        "Un personnage possédant un objet nommé « Reliable Talent » ou « Talent Fiable » ne peut pas descendre en dessous de 10 sur le d20 de son test de compétence (s'il est maîtrisé).",
        true));
    game.settings.register(MOD, "tmCraftPack", S(
        "Artisanat — Compendium des objets craftables",
        "Compendium d'OBJETS (ex. importé via Plutonium). À la fin d'un craft, le module y cherche l'objet par son nom et l'ajoute automatiquement à la fiche du joueur. Vide = ajout manuel comme avant."));

    // ============================================================
    // TOOLKIT — Features génériques
    // ============================================================
    game.settings.register(MOD, "enableTokenAppearance", B(
        "Changement d'apparence des tokens",
        "Le GM configure plusieurs images sur un token ; les joueurs cyclent via un bouton dans le HUD."));
    game.settings.register(MOD, "enableTokenPortraitButton", B(
        "Bouton 'Voir le portrait' (HUD du token)",
        "Ajoute un bouton dans le HUD du token qui affiche en grand l'image de la fiche."));
    game.settings.register(MOD, "enableRageSize", B(
        "Taille Large pendant la Rage (Voie du Géant)",
        "Barbares avec 'Giant's Havoc' : le token passe en 2x2 (Large) pendant la Rage, puis revient à sa taille d'origine."));
    game.settings.register(MOD, "enableLargeForm", B(
        "Taille Large — Goliath (Large Form)",
        "Goliaths avec 'Large Form' : utiliser la feature bascule le token en 2x2 (Large) et inversement."));
    game.settings.register(MOD, "enableFormOfTheBeast", B(
        "Armes naturelles — Voie de la Bête (Form of the Beast)",
        "Barbares dont une feature a l'identifiant 'form-of-the-beast' : le module crée 3 armes naturelles (Morsure, Griffes, Queue) avec jets d'attaque/dégâts, et les retire si la feature disparaît.",
        false, { requiresReload: true }));
    game.settings.register(MOD, "enablePolymorph", B(
        "Transformation de token (Wild Shape / Polymorph)",
        "Configurer des formes sur un acteur (onglet Apparence). Un bouton dans le HUD transforme le token et le rétablit."));
    game.settings.register(MOD, "enableTgcm", B(
        "Protégé TGCM (token immunisé à la mort)",
        "Bouton bouclier dans le HUD (GM). Un token protégé ne tombe jamais à 0 PV (reste à 1 PV)."));
    game.settings.register(MOD, "enableCompanions", B(
        "Compagnons évolutifs",
        "Resynchronise les stats d'une créature liée (compagnon, invocation) sur le niveau de son maître, via des profils de formules. Complète l'activité « Summon » du système (ne la remplace pas).",
        false, { requiresReload: true }));
    // Surcharges/ajouts de profils par le MJ (les profils par défaut sont livrés
    // dans companions.js ; ce réglage ne stocke que les modifications du MJ).
    game.settings.register(MOD, "companionProfiles", {
        scope: "world", config: false, type: Object, default: {}
    });
    game.settings.register(MOD, "enableFolderMove", B(
        "Déplacer/Dupliquer vers… (sidebar)",
        "Ajoute 'Déplacer vers…' et 'Dupliquer vers…' dans le menu contextuel des scènes, acteurs, objets et journaux."));
    game.settings.register(MOD, "enableToolAbilityFix", B(
        "Correction de la stat des outils (tools)",
        "À la création d'un outil sans stat, corrige automatiquement vers la stat canonique dnd5e."));
    // Le masquage de la barre de macros (joueurs/GM) est désormais géré
    // uniquement par le panneau « Interface — Masquer des éléments » (uihide.js),
    // qui couvre la hotbar avec ses deux colonnes Joueurs/GM. Les anciens
    // réglages dédiés « enableHideHotbar » ont été retirés (doublon).
    game.settings.register(MOD, "enableConnStats", {
        name: "Fenêtre d'infos de connexion",
        hint: "Affiche au chargement, en haut au centre de l'écran, le temps de connexion, le nombre de modules actifs et la durée moyenne de connexion. Prend effet au prochain chargement.",
        scope: "world", config: false, type: Boolean, default: true, requiresReload: false
    });
    game.settings.register(MOD, "enablePlayerListCompact", {
        name: "Liste des joueurs compacte + recherche",
        hint: "Limite la liste des joueurs à environ 4 lignes (avec défilement) et ajoute une barre de recherche pour filtrer les joueurs par nom.",
        scope: "world", config: false, type: Boolean, default: true, requiresReload: false,
        onChange: () => ui.players?.render()
    });
    // Historique local des temps de connexion (par client) — sert au calcul
    // de la moyenne. Non affiché dans la configuration.
    game.settings.register(MOD, "connStatsHistory", {
        scope: "client", config: false, type: Array, default: []
    });
    // Temps total cumulé passé connecté au serveur (ms), par client.
    game.settings.register(MOD, "connStatsTotalMs", {
        scope: "client", config: false, type: Number, default: 0
    });
    // ---- Habillage des cartes de chat ----
    game.settings.register(MOD, "enableChatCards", {
        name: "Habillage des cartes de chat",
        hint: "Reteinte les cartes de chat dnd5e (attaques, sorts, objets…) et ajoute du confort de lecture. Chaque joueur peut choisir la couleur et le repli dans « Accessibilité ».",
        scope: "world", config: false, type: Boolean, default: true,
        onChange: () => applyChatCardPrefs()
    });
    // Couleur de fond des cartes de chat — PAR JOUEUR (défaut : blanc crème).
    game.settings.register(MOD, "chatCardColor", {
        scope: "client", config: false, type: String, default: "#f4ecd8",
        onChange: () => applyChatCardPrefs()
    });
    // Replier la description des cartes par défaut — PAR JOUEUR.
    game.settings.register(MOD, "chatCardsCollapsed", {
        scope: "client", config: false, type: Boolean, default: true
    });
    game.settings.register(MOD, "enableTemplateSnap", B(
        "Snap des templates AoE au dixième de pied",
        "Pendant le placement d'un template, la taille s'incrémente par paliers de 0,1 ft. Nécessite lib-wrapper pour le snap live."));
    game.settings.register(MOD, "enableFollowTemplates", B(
        "Zones (gabarits / régions) qui suivent le token",
        "Si tu poses une zone AoE en démarrant SUR un token, elle s'y attache et suit ses déplacements (recentrée sur lui ; rotation non suivie). Gère les gabarits de mesure ET les Régions (Foundry v14). La zone est supprimée si le token l'est. Le suivi n'agit que si un MJ est connecté.",
        false));
    game.settings.register(MOD, "enableMejShopFix", B(
        "Correctifs boutiques Monk's Enhanced Journal",
        "Bouton 'Groupe uniquement' dans 'Show to Players' de MEJ, et fix des objets cachés visibles côté joueur."));
    game.settings.register(MOD, "enableMejRestock", B(
        "Réapprovisionnement automatique des boutiques",
        "Active/désactive le système de réapprovisionnement des boutiques MEJ."));
    game.settings.register(MOD, "shopRestockDays", N(
        "Réapprovisionnement — Délai par défaut (jours)",
        "Délai utilisé si aucune valeur par rareté n'est définie. 0 = pas de fallback.", 7));
    game.settings.register(MOD, "shopRestockDaysCommon", N(
        "Réapprovisionnement — Commun (jours)", "Délai pour la rareté Commun. 0 = désactivé.", 0));
    game.settings.register(MOD, "shopRestockDaysUncommon", N(
        "Réapprovisionnement — Peu commun (jours)", "Délai pour la rareté Peu commun. 0 = désactivé.", 0));
    game.settings.register(MOD, "shopRestockDaysRare", N(
        "Réapprovisionnement — Rare (jours)", "Délai pour la rareté Rare. 0 = désactivé.", 0));
    game.settings.register(MOD, "shopRestockDaysVeryRare", N(
        "Réapprovisionnement — Très rare (jours)", "Délai pour la rareté Très rare. 0 = désactivé.", 0));
    game.settings.register(MOD, "shopRestockDaysLegendary", N(
        "Réapprovisionnement — Légendaire (jours)", "Délai pour la rareté Légendaire. 0 = désactivé.", 0));

    // ============================================================
    // RELATIONS (clés préfixées relations*)
    // ============================================================
    game.settings.register(MOD, "relationsEnabled", B(
        "Relations — Activer",
        "Ajoute un onglet 'Relations' sur les fiches PJ et détecte automatiquement les rencontres sur les scènes."));
    game.settings.register(MOD, "relationsAnonymization", B(
        "Relations — Anonymisation",
        "Ajoute les boutons 'Révéler'/'Masquer' dans l'en-tête des fiches (GM). Contrôle l'affichage 'Inconnu'."));
    game.settings.register(MOD, "relationsFolderPJ", S(
        "Relations — Dossier des PJ",
        "Dossier acteur des joueurs. Leur présence sur une scène déclenche la détection de rencontres."));
    game.settings.register(MOD, "relationsFolderPNJ", S(
        "Relations — Dossier des PNJ",
        "Dossier acteur des PNJ récurrents (alliés, marchands, figures importantes)."));
    game.settings.register(MOD, "relationsPackPNJ", S(
        "Relations — Compendium des PNJ",
        "Compendium d'acteurs PNJ. Ses personnages sont proposés dans le sélecteur de relations (groupe PNJ)."));
    game.settings.register(MOD, "relationsPackCemetery", S(
        "Relations — Compendium cimetière des joueurs",
        "Compendium des PJ décédés. Ses personnages sont proposés dans le sélecteur de relations (groupe Joueurs)."));

    // ============================================================
    // BESTIAIRE (clés préfixées bestiary*)
    // ============================================================
    game.settings.register(MOD, "bestiaryEnabled", B(
        "Bestiaire — Activer",
        "Active la détection automatique des créatures rencontrées sur les scènes et l'onglet Bestiaire."));
    game.settings.register(MOD, "bestiaryAnonymization", B(
        "Bestiaire — Anonymisation",
        "Boutons 'Révéler'/'Masquer' dans l'en-tête des fiches (GM). Utilisé si Relations est désactivé."));
    game.settings.register(MOD, "bestiaryFolderPJ", S(
        "Bestiaire — Dossier des PJ",
        "Dossier acteur des joueurs. Chaque joueur voit les créatures rencontrées par son personnage."));
    game.settings.register(MOD, "bestiaryPackCreatures", S(
        "Bestiaire — Compendium des créatures (ID)",
        "ID du compendium des monstres/créatures (ex : world.creatures). La détection automatique et l'ajout manuel lisent uniquement depuis ce compendium.",
        "world.creature"));

    // ============================================================
    // CARNET & EXPÉDITIONS (clés préfixées carnet*)
    // ============================================================
    game.settings.register(MOD, "carnetEnabled", B(
        "Carnet & Expéditions — Activer",
        "Ajoute les onglets Carnet et Expéditions sur les fiches PJ. Nécessite un rechargement.",
        true, { requiresReload: true }));
    game.settings.register(MOD, "enablePcStatus", B(
        "Statut de disponibilité des PJ",
        "Affiche à droite de chaque personnage, dans le répertoire des Acteurs, un badge « Disponible » ou « En expédition ». Le statut est déduit automatiquement des expéditions : un PJ avec une expédition ouverte (date de début sans date de fin) est « En expédition ». Modifiable sans rechargement.",
        true, { onChange: () => ui.actors?.render() }));

    // ============================================================
    // CARTE DES EXPÉDITIONS (clés inchangées)
    // ============================================================
    game.settings.register(MOD, "enableExpeditionMap", B(
        "Carte des expéditions",
        "Synchronise la permission Owner de l'acteur Groupe avec les joueurs membres, pour la vision/brouillard sur la carte du monde."));
    game.settings.register(MOD, "expeditionMapSceneId", S(
        "Carte des expéditions — Scène principale",
        "Scène sur laquelle le brouillard de guerre est suivi par personnage plutôt que par compte joueur."));
    // Scènes SUPPLÉMENTAIRES de carte (ex. archipel : plusieurs îles). Chaque
    // scène garde son propre brouillard (exploration indépendante par scène).
    game.settings.register(MOD, "expeditionMapSceneIds", {
        scope: "world", config: false, type: Array, default: [],
        name: "Carte des expéditions — Scènes supplémentaires",
        hint: "Sélectionnez d'autres scènes à traiter comme cartes d'expédition (Ctrl/Cmd-clic pour en choisir plusieurs). Chacune a son propre brouillard, indépendant des autres et de la scène principale. Idéal pour un archipel (une scène par île)."
    });
    game.settings.register(MOD, "expeditionMapTemplateFolder", S(
        "Carte des expéditions — Dossier du token modèle",
        "Dossier d'acteurs où créer l'acteur Groupe modèle « Token à copier et rennomer ». Laissez vide pour la racine."));
    game.settings.register(MOD, "expeditionRevealRadius", N(
        "Carte des expéditions — Rayon de révélation (en cases)",
        "Nombre de cases (hex) révélées autour du token de groupe lors de son déplacement. 0 = seulement la case du token, 1 = la case + ses voisines, etc.",
        1));
    // Zones toujours éclairées (villes, lieux connus de tous) — peintes par le MJ.
    // Liste de clés de case "i.j". Non affiché (édité via l'outil sur la carte).
    game.settings.register(MOD, "expeditionRevealedZones", {
        scope: "world", config: false, type: Object, default: {}
    });

    // ============================================================
    // MISE EN SCÈNE — CUES AUDIO (clés sceneCues*)
    // ============================================================
    game.settings.register(MOD, "enableSceneCues", B(
        "Mise en scène — Cues audio",
        "Attache à un token un « cue » audio (fichier, seconde de départ, volume, fondu, boucle) via un bouton dans son HUD. Le son se déclenche pour tous les joueurs quand le token perd son invisibilité GM, ou manuellement. Diffusion en local sur chaque client (faible latence), avec préchargement au chargement de la scène. Outil réservé au MJ."));
    game.settings.register(MOD, "sceneCuesDefaultVolume", N(
        "Cues audio — Volume par défaut",
        "Volume initial (0 à 1) proposé pour un nouveau cue.",
        0.8));
    // Stockage central des cues (au niveau du monde) : survivent à la
    // suppression des tokens auxquels ils sont liés. Édités via le gestionnaire.
    game.settings.register(MOD, "sceneCuesList", {
        scope: "world", config: false, type: Array, default: []
    });

    // ============================================================
    // MIDI RANGE FIX (clés préfixées rangeFix*)
    // ============================================================
    game.settings.register(MOD, "rangeFixEnabled", B(
        "Midi Range Fix — Activer",
        "Corrige le calcul de portée midi-qol pour les tokens Large+. Nécessite un rechargement. Sans midi-qol, sans effet.",
        true, { requiresReload: true }));
    game.settings.register(MOD, "rangeAdjust", N(
        "Midi Range Fix — Marge depuis le bord (ft)",
        "Marge soustraite à la portée pour le calcul bord→bord. 2.5 = défaut D&D 5e (demi-case). Ne pas dépasser la portée de l'arme.",
        2.5));

    // ============================================================
    // TUTORIEL
    // ============================================================
    game.settings.register(MOD, "tutoEnabled", B(
        "Tutoriel — Activer",
        "Active le bouton tutoriel ('?') dans la barre WestMarch et la fenêtre de bienvenue. Nécessite un rechargement.",
        true, { requiresReload: true }));
    game.settings.register(MOD, "serverName", S(
        "Tutoriel — Nom affiché dans le message de bienvenue",
        "Titre de la fenêtre d'accueil des joueurs.",
        "Bienvenue sur le serveur !"));
    // Suivi interne : la fiche démo du tutoriel a-t-elle déjà été créée ?
    // (évite de la recréer si le GM la supprime volontairement).
    game.settings.register(MOD, "tutorialActorCreated", {
        scope: "world", config: false, type: Boolean, default: false, requiresReload: false
    });
    // Version de la fiche démo réellement créée avec succès. Ne vaut DEMO_VERSION
    // qu'après une création confirmée : si la création échoue, ce compteur reste
    // en arrière et la création est retentée au prochain chargement. Un bump de
    // DEMO_VERSION force aussi la recréation (nouveau contenu).
    game.settings.register(MOD, "tutorialActorVersion", {
        scope: "world", config: false, type: Number, default: 0, requiresReload: false
    });
    for (const { key, label } of TUTO_TOGGLES) {
        game.settings.register(MOD, key, B(
            `Tutoriel — ${label}`,
            "Inclure les étapes de tutoriel pour cette fonctionnalité."));
    }
    game.settings.register(MOD, "showWelcome", B(
        "Tutoriel — Afficher la fenêtre de bienvenue au login",
        "Si activé, la fenêtre d'accueil s'affiche à chaque connexion (sauf « Ne plus afficher »).",
        false));
    game.settings.register(MOD, "hideWelcome", {
        scope: "client", config: false, type: Boolean, default: false
    });

    // ============================================================
    // RÉCOLTE (HARVEST)
    // ============================================================
    game.settings.register(MOD, "enableHarvest", B(
        "Système de récolte",
        "Permet de récolter (dépecer) une créature morte ciblée pour en tirer des matériaux via une RollTable que vous associez à la créature. Le module ne fournit pas de tables : il utilise les vôtres.",
        false, { requiresReload: true }));
    game.settings.register(MOD, "harvestDcBase", N(
        "Récolte — DC de base", "Difficulté de base du jet de récolte, avant ajout selon le CR.", 10));
    game.settings.register(MOD, "harvestDcPerCr", N(
        "Récolte — DC ajouté par CR", "Ajout à la DC par point de facteur de puissance (CR) de la créature. Ex. 0.5 = +1 tous les 2 CR.", 0.5));
    game.settings.register(MOD, "harvestBaseDraws", N(
        "Récolte — Tirages de base", "Nombre de tirages sur la RollTable en cas de réussite normale. +1 par tranche de 5 au-dessus de la DC ; échec = 1 tirage. Une dépouille « abîmée » réduit ce nombre de moitié.", 2));
    game.settings.register(MOD, "harvestBloodImage", S(
        "Récolte — Image de la tache de sang",
        "Chemin d'image posée à la place du token quand la dépouille est entièrement récoltée. Laisser vide pour utiliser au hasard une des taches de sang fournies avec le module."));
    // Associations créature → RollTable. { byType: {beast: id…}, byName: {"Loup": id…} }
    game.settings.register(MOD, "harvestTables", {
        scope: "world", config: false, type: Object, default: { byType: {}, byName: {} }
    });

    // ---- Suivi de la migration des données des anciens modules ----
    // 0 = jamais migré. Incrémenté par migration.js une fois la reprise faite.
    game.settings.register(MOD, "migrationVersion", {
        scope: "world", config: false, type: Number, default: 0
    });

    // ---- Kill-switch de désactivation (piloté depuis la fenêtre « À propos »).
    // true = module désactivé (voir le gate dans index.js). Réglage monde :
    // seul le MJ peut l'écrire, même si le champ code est visible par tous.
    game.settings.register(MOD, "moduleDeactivated", {
        scope: "world", config: false, type: Boolean, default: false, requiresReload: false,
        name: "Module désactivé",
        hint: "Coché = toutes les fonctions du module sont désactivées sur ce serveur (le module reste installé, la fenêtre « À propos » reste accessible). Décochez pour réactiver. Se pilote aussi par code depuis « À propos ». Le changement recharge automatiquement les clients.",
        onChange: () => foundry.utils.debouncedReload()
    });

    // ---- Masquage d'éléments d'interface (par rôle). Réglage monde : le MJ
    // décide ce qui est caché pour les Joueurs et pour les GM ; chaque client
    // applique sa colonne. Édité via le panneau « Interface — Masquer ».
    game.settings.register(MOD, "hiddenUi", {
        scope: "world", config: false, type: Object, default: { players: [], gm: [] },
        onChange: () => { try { applyUiHiding(); } catch (e) {} }
    });

    // ============================================================
    // MENUS PAR CATÉGORIE (boutons "Configurer" dans la config du module)
    // Visibles UNIQUEMENT si le module est activé (bon code saisi). Tant que le
    // code n'est pas entré, aucun réglage n'est accessible — la seule entrée est
    // la fenêtre de code au démarrage (voir index.js).
    // ============================================================
    // Fenêtre « À propos » — TOUJOURS enregistrée et visible par TOUS (joueurs
    // inclus), même module non activé/désactivé : c'est la seule entrée publique,
    // et elle contient le champ code (activation manquante → réactivation possible).
    registerAboutMenu();

    // Les menus MJ (restricted:true, dont « À propos & protection ») restent
    // enregistrés dès que le CODE D'ACTIVATION est valide — même si le module est
    // désactivé — pour que le MJ garde l'accès à ses réglages et puisse réactiver.
    // Les joueurs ne voient de toute façon que la fenêtre publique « À propos ».
    const activated = (game.settings.get(MOD, "activationCode") ?? "").trim() === ACTIVATION_CODE;
    if (activated) {
        registerConfigHub();   // TOUT passe par le panneau de configuration regroupé
    }
}

// ============================================================
// Fenêtre « À propos » (publique) + kill-switch par code
// ============================================================
function registerAboutMenu() {
    try {
        game.settings.registerMenu(MOD, "menu-about", {
            name:  "À propos",
            label: "Ouvrir",
            hint:  "Informations sur le module, auteur et droits.",
            icon:  "fas fa-circle-info",
            type:  makeLauncher({ firstKey: "about", title: "À propos", icon: "fa-circle-info", open: () => openAboutDialog() }),
            restricted: false   // visible par tout le monde (joueurs inclus)
        });
    } catch (e) {
        console.warn(`[${MOD}] registerMenu « À propos » échec :`, e);
    }
}

async function openAboutDialog() {
    const mod     = game.modules.get(MOD);
    const version = mod?.version ?? "?";
    const author  = "Soruta (Discord : s0ruta)";
    const desc    = mod?.description
        ? mod.description
        : "Module unifié West March pour Foundry VTT (dnd5e).";
    const deactivated = game.settings.get(MOD, "moduleDeactivated") === true;

    const content = `
        <div style="display:flex;flex-direction:column;gap:10px;padding:2px 0;">
            <div style="display:flex;align-items:center;gap:10px;">
                <i class="fa-solid fa-hammer" style="font-size:22px;color:#c9a227;"></i>
                <div>
                    <div style="font-weight:700;font-size:15px;">Soruta — Completed Westmarch</div>
                    <div style="font-size:12px;opacity:.75;">Version ${version}</div>
                </div>
            </div>
            <div style="font-size:12px;line-height:1.5;opacity:.9;">${desc}</div>
            <hr style="border:none;border-top:1px solid rgba(255,255,255,.12);margin:2px 0;">
            <div style="font-size:12px;line-height:1.6;">
                <div><strong>Auteur :</strong> ${author}</div>
                <div><strong>Droits :</strong> © 2026 Soruta — Tous droits réservés.</div>
                <div style="opacity:.75;margin-top:4px;">
                    Ce module et son contenu (code, textes, ressources) sont une œuvre de
                    l'esprit protégée par le droit d'auteur. Toute redistribution, revente,
                    modification ou réutilisation sans autorisation écrite de l'auteur est interdite.
                </div>
                <details style="margin-top:6px;">
                    <summary style="cursor:pointer;color:#c9a227;font-weight:600;">
                        Cadre légal &amp; sanctions encourues
                    </summary>
                    <div style="font-size:11px;line-height:1.55;opacity:.9;margin-top:4px;
                                max-height:180px;overflow-y:auto;padding-right:4px;">
                        <p style="margin:0 0 5px;">
                            France — <em>Code de la propriété intellectuelle</em> (CPI) :
                        </p>
                        <ul style="margin:0 0 5px;padding-left:16px;">
                            <li><strong>Art. L122-4</strong> — Toute reproduction ou représentation,
                                intégrale ou partielle, faite sans le consentement de l'auteur
                                (y compris adaptation, traduction ou transformation) est illicite.</li>
                            <li><strong>Art. L335-3</strong> — La reproduction, la représentation ou
                                la diffusion d'une œuvre en violation des droits de l'auteur
                                constitue un délit de contrefaçon ; cela vise aussi la violation
                                des droits sur un logiciel (art. L122-6).</li>
                            <li><strong>Art. L335-2</strong> — La contrefaçon est punie de
                                <strong>3 ans d'emprisonnement et 300 000 € d'amende</strong> ;
                                portés à <strong>7 ans et 750 000 €</strong> lorsqu'elle est
                                commise en bande organisée.</li>
                            <li><strong>Art. L331-1-3</strong> — S'y ajoutent des
                                <strong>dommages-intérêts</strong> réparant le préjudice subi
                                (manque à gagner, bénéfices réalisés par le contrefacteur,
                                préjudice moral).</li>
                        </ul>
                        <p style="margin:0;opacity:.7;font-style:italic;">
                            Mention informative — le droit applicable peut varier selon le pays
                            et évoluer dans le temps.
                        </p>
                    </div>
                </details>
            </div>
            <hr style="border:none;border-top:1px solid rgba(255,255,255,.12);margin:2px 0;">
            <label style="font-size:12px;display:block;">
                <span style="opacity:.7;">Code</span>
                <input type="password" name="scwm-about-code" autocomplete="off"
                       placeholder="Code…" style="width:100%;box-sizing:border-box;margin-top:3px;">
            </label>
            <div style="font-size:11px;opacity:.6;">
                ${deactivated ? "⚠️ Le module est actuellement désactivé." : ""}
            </div>
        </div>`;

    await foundry.applications.api.DialogV2.wait({
        window:      { title: "À propos — Soruta Completed Westmarch", icon: "fas fa-circle-info" },
        position:    { width: 460 },
        rejectClose: false,
        content,
        buttons: [
            {
                action: "validate", label: "Valider", icon: '<i class="fa-solid fa-check"></i>', default: true,
                callback: async (ev, btn) => {
                    const input = btn.form?.elements?.["scwm-about-code"];
                    const code  = (input?.value ?? "").trim();
                    if (input) input.value = "";   // efface la saisie (aucun point ne subsiste)
                    if (!code) return;

                    // 1) Code d'ACTIVATION → active le module (et lève toute désactivation).
                    //    Réservé au MJ (écriture d'un réglage monde de licence).
                    if (code === ACTIVATION_CODE) {
                        if (!game.user?.isGM) {
                            ui.notifications?.warn("L'activation est réservée au MJ.");
                            return;
                        }
                        await game.settings.set(MOD, "activationCode", code);
                        if (game.settings.get(MOD, "moduleDeactivated") === true) {
                            await game.settings.set(MOD, "moduleDeactivated", false);
                        }
                        ui.notifications?.info("Module activé.");
                        foundry.utils.debouncedReload();
                        return;
                    }

                    // 2) Code de DÉSACTIVATION → bascule le kill-switch.
                    if (!DEACTIVATION_CODE || code !== DEACTIVATION_CODE) {
                        ui.notifications?.error("Code invalide.");
                        return;
                    }
                    if (game.user?.isGM) {
                        // MJ : écriture directe du réglage monde.
                        const next = !(game.settings.get(MOD, "moduleDeactivated") === true);
                        await game.settings.set(MOD, "moduleDeactivated", next);
                        ui.notifications?.info(next ? "Module désactivé." : "Module réactivé.");
                        foundry.utils.debouncedReload();
                        return;
                    }
                    // Joueur : relais vers un MJ connecté (les joueurs ne peuvent pas
                    // écrire un réglage monde). Nécessite qu'un MJ soit en ligne.
                    const gm = game.users.find(u => u.isGM && u.active);
                    if (!gm) {
                        ui.notifications?.warn("Aucun MJ connecté pour appliquer le changement.");
                        return;
                    }
                    try {
                        const res = await gm.query("completed-westmarch.toggleDeactivation", { code });
                        if (res === "off" || res === "on") {
                            ui.notifications?.info(res === "off" ? "Module désactivé." : "Module réactivé.");
                            foundry.utils.debouncedReload();
                        } else {
                            ui.notifications?.error("Le MJ n'a pas pu appliquer le changement.");
                        }
                    } catch (e) {
                        ui.notifications?.error("Échec de la demande au MJ.");
                    }
                }
            },
            { action: "close", label: "Fermer", icon: '<i class="fa-solid fa-xmark"></i>', callback: () => {} }
        ]
    });
}

// Cases à cocher "Activé" injectées à côté du nom de chaque catégorie qui
// possède un interrupteur maître (Party, Relations, Bestiaire, Carnet, Carte,
// Midi). Permet d'activer/désactiver la fonctionnalité sans ouvrir la fenêtre.
const CAT_RELOAD = new Set(["relationsEnabled", "bestiaryEnabled", "carnetEnabled", "rangeFixEnabled", "tmEnabled", "tutoEnabled"]);

function registerCategoryToggles() {
    Hooks.on("renderSettingsConfig", (app, html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;

        for (const cat of CATEGORIES) {
            if (!cat.master) continue;

            // Trouver la ligne du menu : par data-key, sinon par titre (robuste v13/v14).
            let group = root.querySelector(`[data-key="${MOD}.menu-${cat.firstKey}"]`)?.closest(".form-group");
            if (!group) {
                for (const g of root.querySelectorAll(".form-group")) {
                    const lbl = g.querySelector("label");
                    if (lbl && lbl.textContent.trim() === cat.title) { group = g; break; }
                }
            }
            if (!group || group.querySelector(".scwm-cat-toggle")) continue;

            const on = !!game.settings.get(MOD, cat.master);
            const wrap = document.createElement("label");
            wrap.className = "scwm-cat-toggle";
            wrap.style.cssText = "display:inline-flex;align-items:center;gap:5px;margin-left:10px;cursor:pointer;font-size:11px;font-weight:600;color:#8fd19e;vertical-align:middle;";
            wrap.innerHTML = `<input type="checkbox" ${on ? "checked" : ""} style="width:15px;height:15px;margin:0;"> Activé`;

            const cb = wrap.querySelector("input");
            cb.addEventListener("change", async () => {
                await game.settings.set(MOD, cat.master, cb.checked);
                wrap.style.color = cb.checked ? "#8fd19e" : "#e58f8f";
                if (CAT_RELOAD.has(cat.master)) {
                    const ok = await foundry.applications.api.DialogV2.confirm({
                        window:  { title: "Rechargement requis" },
                        content: "<p>Ce changement nécessite un rechargement pour s'appliquer pleinement. Recharger maintenant ?</p>"
                    });
                    if (ok) window.location.reload();
                }
            });
            if (!on) wrap.style.color = "#e58f8f";

            const nameLabel = group.querySelector("label");
            (nameLabel ?? group).appendChild(wrap);
        }
    });
}

// ============================================================
// Catégories (ordre = ordre d'enregistrement des settings).
// firstKey = clé devant laquelle insérer l'en-tête de catégorie.
// ============================================================
// ============================================================
// Arborescence des modifications ciblées (par classe / espèce / …).
// Chaque FEUILLE porte une clé de réglage booléen (key). Un nœud SANS key mais
// AVEC children est une branche dépliable. Extensible : ajoute des entrées.
// ============================================================
const TWEAK_TREE = {
    "Classes": { icon: "fa-hat-wizard", children: {
        "Barbare": { children: {
            "Voie du Géant": { children: {
                "Taille Large pendant la Rage": { key: "enableRageSize" }
            } },
            "Voie de la Bête": { children: {
                "Form of the Beast (armes naturelles)": { key: "enableFormOfTheBeast" }
            } }
        } }
    } },
    "Espèces": { icon: "fa-dna", children: {
        "Goliath": { key: "enableLargeForm" }
    } },
    "Sorts":       { icon: "fa-wand-magic-sparkles", children: {} },
    "Features":    { icon: "fa-star",                children: {} },
    "Backgrounds": { icon: "fa-scroll",              children: {} },
};

// Toutes les clés de réglage (feuilles) de l'arbre, à plat.
function collectTweakKeys(nodes = TWEAK_TREE) {
    const out = [];
    for (const node of Object.values(nodes)) {
        if (node.key) out.push(node.key);
        if (node.children) out.push(...collectTweakKeys(node.children));
    }
    return out;
}

// Rendu HTML récursif de l'arbre (details/summary dépliables, cases pour feuilles).
function renderTweakTree(nodes, depth = 0) {
    return Object.entries(nodes).map(([label, node]) => {
        const pad = depth * 16;
        if (node.key) {
            const on = !!game.settings.get(MOD, node.key);
            return `<label class="scwm-set" data-key="${node.key}" style="display:flex;align-items:center;gap:8px;padding:3px 0 3px ${pad}px;font-weight:400;cursor:pointer;">
                <input type="checkbox" name="${node.key}" ${on ? "checked" : ""} style="width:16px;height:16px;flex-shrink:0;">
                <span>${label}</span></label>`;
        }
        const inner = renderTweakTree(node.children ?? {}, depth + 1);
        const body = inner.trim() ? inner
            : `<p style="margin:2px 0 4px ${pad + 16}px;color:#777;font-size:.85em;font-style:italic;">— aucune entrée —</p>`;
        return `<details style="margin:2px 0 2px ${pad}px;" ${depth < 1 ? "open" : ""}>
            <summary style="cursor:pointer;font-weight:600;padding:2px 0;">${node.icon ? `<i class="fa-solid ${node.icon}"></i> ` : ""}${label}</summary>
            ${body}</details>`;
    }).join("");
}

const CATEGORIES = [
    { firstKey: "tweakTree", icon: "fa-sitemap", title: "Modifications ciblées",
      desc: "Active/désactive les modifications propres à une classe, sous-classe, espèce, sort, feature ou background. Chaque branche est dépliable.",
      tree: TWEAK_TREE, keys: collectTweakKeys() },
    { firstKey: "companionProfiles", icon: "fa-dna", title: "Profils de compagnons",
      desc: "Ajouter ou surcharger les profils de formules des compagnons évolutifs (JSON).",
      open: () => openProfilesEditor(), keys: [] },
    { firstKey: "uihide", icon: "fa-eye-slash", title: "Interface — Masquer des éléments",
      desc: "Masque des icônes de la barre d'outils et de grandes zones de l'interface, avec deux colonnes : Joueurs et GM. Chaque client applique la colonne de son rôle.",
      open: () => openUiHideDialog(), keys: [] },
    { firstKey: "commonFolderPJ", icon: "fa-folder-tree", title: "Dossiers & Compendiums",
      desc: "Dossiers et compendiums communs, renseignés une seule fois ici et utilisés par toutes les fonctions (Relations, Bestiaire, Création de personnages, Temps morts).",
      keys: ["commonFolderPJ","autoPlayerFolder","gmAutoFolderParent","commonFolderPNJ","commonFolderNewChars","commonPackPNJ","commonPackCemetery","commonPackCreatures","commonPackCraft"] },
    { firstKey: "enableParty", master: "enableParty",           icon: "fa-users",           title: "Système de Party",
      desc: "Groupes de joueurs : chat filtré, combat par party, téléportation de groupe, journal de session, anti-cheat.",
      keys: ["enableParty","enableJoinScene","enableShowParty","enablePlayerGrouping","enableGoWithPartyScenes","enableGoWithPartyJournal","enableChatFilter","enableChatTabs","enableChatCards","enableNoteLink","enableSessionLog","sessionLogWebhookUrl","sessionLogForum","enableCombatParty","enableCombatTurnLock","enablePartyPause","enableAntiCheat"] },
    { firstKey: "enableCharValidation", master: "enableCharValidation", icon: "fa-id-card", title: "Création de personnages",
      desc: "Les joueurs demandent la création d'un personnage ; un GM valide depuis le Casier, puis le joueur construit et soumet sa fiche ; à la validation elle est verrouillée. Le dossier de destination se règle dans « Dossiers & Compendiums ».",
      keys: ["enableCharValidation","charMaxTotal","charMaxActive","charFreeLevelUp","charNotifyLevelUp","blockPlayerPlutonium"] },
    { firstKey: "enableSourceControl", master: "enableSourceControl", icon: "fa-book-skull", title: "Contrôle des sources",
      desc: "Réglemente les livres/extensions D&D (Xanathar, Tal'Dorei, etc.) autorisés sur les fiches PJ, via deux listes blanches (joueurs / MJ). Le contenu d'une source non autorisée est bloqué avec un avertissement, quelle que soit la méthode d'ajout.",
      keys: ["enableSourceControl","sourceAllowPlayers","sourceAllowGm","sourceMatchField","sourceMatchExact","sourceBlockUnknown"] },
    { firstKey: "enableHarvest", master: "enableHarvest", icon: "fa-hand-holding-droplet", title: "Récolte (harvest)",
      desc: "Récolte de matériaux sur les créatures mortes. Le module utilise des RollTables que vous créez et associez aux créatures (bouton « Associations » dans l'onglet WestMarch). Butin partagé sur la dépouille, pourriture avec le temps, tache de sang une fois vidée.",
      keys: ["enableHarvest","harvestDcBase","harvestDcPerCr","harvestBaseDraws","harvestBloodImage"] },
    { firstKey: "enableXpBlock",         icon: "fa-server",          title: "Serveur",
      desc: "Personnalisations du serveur : blocage XP / Level Up, logs Discord, webhooks.",
      keys: ["enableXpBlock","enableFakeWarning","enableGmNotes","hidePlayerStarTab","enableDiscordLog","discordLogWebhookUrl","downtimeWebhookUrl","tmWebhookUrl"] },
    { firstKey: "enableReactReminder", icon: "fa-bolt", title: "Rappels de combat",
      desc: "Assistant de combat contextuel (dépend de Midi-QOL) : rappel des réactions (avec notif au MJ de la party), actions bonus utiles (Smite…), maîtrises d'arme, et avantage/désavantage. Chaque point est activable séparément.",
      keys: ["enableReactReminder","enableBonusReminder","enableMasteryReminder","enableAdvantageReminder"] },
    { firstKey: "tmSkillBase", master: "tmEnabled", icon: "fa-hourglass-half",  title: "Temps morts",
      desc: "Règles configurables des temps morts : valeurs, formules (gain de compétence, artisanat) et tables (parchemins, objets magiques). Chaque serveur peut avoir ses propres règles.",
      keys: ["tmEnabled","tmSkillBase","tmAddAbilityMod","tmBonusMaitrise","tmBonusExpertise","tmBonusTools","tmRollMinDays","tmReliableTalent","tmSkillFormula","tmCraftNonMagicCostDiv","tmCraftNonMagicDaysPerGp","tmCraftNonMagicCostFormula","tmCraftNonMagicDaysFormula","tmSingleUseFactor","tmScrollTable","tmMagicTable","tmRollTable"] },
    { firstKey: "enableTokenAppearance", icon: "fa-toolbox",         title: "Toolkit",
      desc: "Apparences de tokens, transformations, tailles Large, TGCM, utilitaires GM, templates AoE, boutiques MEJ et réapprovisionnement.",
      keys: ["enableTokenAppearance","enableTokenPortraitButton","enablePolymorph","enableTgcm","enableCompanions","enableFolderMove","enableToolAbilityFix","enableConnStats","enablePlayerListCompact","enableTemplateSnap","enableFollowTemplates","enableMejShopFix","enableMejRestock","shopRestockDays","shopRestockDaysCommon","shopRestockDaysUncommon","shopRestockDaysRare","shopRestockDaysVeryRare","shopRestockDaysLegendary"] },
    { firstKey: "relationsEnabled", master: "relationsEnabled",      icon: "fa-heart",           title: "Fiche PJ — Relations",
      desc: "Onglet Relations : liens entre personnages, détection automatique des rencontres, anonymisation.",
      keys: ["relationsEnabled","relationsAnonymization"] },
    { firstKey: "bestiaryEnabled", master: "bestiaryEnabled",       icon: "fa-dragon",          title: "Fiche PJ — Bestiaire",
      desc: "Onglet Bestiaire : créatures rencontrées, répertoriées par personnage.",
      keys: ["bestiaryEnabled","bestiaryAnonymization"] },
    { firstKey: "carnetEnabled", master: "carnetEnabled",         icon: "fa-book-open",       title: "Fiche PJ — Carnet & Expéditions",
      desc: "Onglets Carnet (notes enrichies) et Expéditions (dates + durée).",
      keys: ["carnetEnabled","enablePcStatus"] },
    { firstKey: "enableExpeditionMap", master: "enableExpeditionMap",   icon: "fa-map",             title: "Carte des expéditions",
      desc: "Brouillard de guerre par party et par personnage sur une scène dédiée.",
      keys: ["enableExpeditionMap","expeditionMapSceneId","expeditionMapSceneIds","expeditionMapTemplateFolder","expeditionRevealRadius"] },
    { firstKey: "enableSceneCues", master: "enableSceneCues",       icon: "fa-clapperboard",    title: "Mise en scène — Cues audio",
      desc: "Cues audio attachés aux tokens : déclenchement auto quand le token perd son invisibilité GM, ou manuel. Réglage de la seconde de départ, du volume et du fondu.",
      keys: ["enableSceneCues","sceneCuesDefaultVolume"] },
    { firstKey: "rangeFixEnabled", master: "rangeFixEnabled",       icon: "fa-bullseye",        title: "Midi Range Fix",
      desc: "Correction du calcul de portée midi-qol pour les tokens Large et plus.",
      keys: ["rangeFixEnabled","rangeAdjust"] },
    { firstKey: "serverName", master: "tutoEnabled", icon: "fa-circle-question", title: "Tutoriel",
      desc: "Fenêtre de bienvenue et guide interactif, configurable section par section.",
      keys: ["tutoEnabled","serverName","tutoBarreWestmarch","tutoTourFiche","tutoNoteGm","tutoMonPerso","tutoBestiary","tutoRelations","tutoCarnet","tutoCasier","tutoCues","tutoBoutiques","tutoTempsMorts","tutoApparenceTokens","tutoOutilsGm","showWelcome"] },
];

const ACCENT = "#e67e22";

// Schémas des tables de temps morts éditées en grille (champs structurés).
const TM_TABLE_SCHEMAS = {
    tmScrollTable: {
        fallback: TM_DEFAULT_SCROLL,
        rowLabel: (i) => `Niveau ${i}${i === 0 ? " (mineur)" : ""}`,
        cols: [
            { field: "days", label: "Jours",     type: "number" },
            { field: "cost", label: "Coût (PO)", type: "number" }
        ]
    },
    tmMagicTable: {
        fallback: TM_DEFAULT_MAGIC,
        rowLabel: (i, row) => row.key,
        cols: [
            { field: "label", label: "Nom",         type: "text"   },
            { field: "days",  label: "Jours",       type: "number" },
            { field: "cost",  label: "Coût (PO)",   type: "number" },
            { field: "lvl",   label: "Niv. requis", type: "number" }
        ]
    },
    tmRollTable: {
        fallback: TM_DEFAULT_ROLL,
        rowLabel: (i) => `Palier ${i + 1}`,
        cols: [
            { field: "max",   label: "Résultat ≤", type: "number" },
            { field: "mult",  label: "Multipl.",   type: "number" },
            { field: "label", label: "Libellé",    type: "text"   }
        ]
    }
};

function normalizeTable(key) {
    const val = game.settings.get(MOD, key);
    return (Array.isArray(val) && val.length) ? val : TM_TABLE_SCHEMAS[key].fallback;
}

function tableControlHtml(key, cfg) {
    const schema = TM_TABLE_SCHEMAS[key];
    const rows   = normalizeTable(key);
    const th = `<tr><th style="text-align:left;font-size:.72em;color:#888;padding:0 6px 3px 0;"></th>${
        schema.cols.map(c => `<th style="text-align:left;font-size:.72em;color:#888;padding:0 4px 3px;">${c.label}</th>`).join("")}</tr>`;
    const tb = rows.map((row, i) => `<tr>
        <td style="font-size:.8em;color:#aaa;white-space:nowrap;padding:2px 6px 2px 0;">${schema.rowLabel(i, row)}</td>
        ${schema.cols.map(c => `<td style="padding:1px 4px;"><input type="${c.type}" ${c.type === "number" ? 'step="any"' : ""} name="${key}__${i}__${c.field}" value="${escapeAttr(row[c.field] ?? "")}" style="width:100%;box-sizing:border-box;"></td>`).join("")}
    </tr>`).join("");
    return `<div class="scwm-set" data-key="${key}" style="padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <label style="display:block;font-weight:600;margin-bottom:4px;">${cfg.name}</label>
        <table style="width:100%;border-collapse:collapse;"><thead>${th}</thead><tbody>${tb}</tbody></table>
    </div>`;
}

function readTableFromForm(key, root) {
    const schema = TM_TABLE_SCHEMAS[key];
    return normalizeTable(key).map((row, i) => {
        const out = { ...row };
        for (const c of schema.cols) {
            const el = root.querySelector(`[name="${key}__${i}__${c.field}"]`);
            if (!el) continue;
            out[c.field] = c.type === "number" ? Number(el.value) : el.value;
        }
        return out;
    });
}

// ============================================================
// Panneau de configuration REGROUPÉ — un seul bouton ouvre une fenêtre
// où toutes les catégories sont classées par grands thèmes, avec des
// sections repliables. Les boutons « Configurer » individuels restent
// disponibles en parallèle pour un accès direct aux gros modules.
// ============================================================

// Regroupement des catégories (firstKey) par thème. Les catégories non
// listées ici sont ajoutées automatiquement à « Divers ».
const CONFIG_GROUPS = [
    { title: "Fiche PJ & personnages", icon: "fa-id-card",
      cats: ["relationsEnabled", "bestiaryEnabled", "carnetEnabled", "enableCharValidation", "enableSourceControl"] },
    { title: "Party & jeu de groupe", icon: "fa-users",
      cats: ["enableParty", "enableExpeditionMap", "enableHarvest"] },
    { title: "Combat", icon: "fa-bolt",
      cats: ["enableReactReminder", "rangeFixEnabled"] },
    { title: "Serveur & monde", icon: "fa-server",
      cats: ["enableXpBlock", "tmSkillBase", "enableSceneCues", "commonFolderPJ"] },
    { title: "Personnalisation & interface", icon: "fa-sliders",
      cats: ["enableTokenAppearance", "uihide", "tweakTree", "companionProfiles"] },
    { title: "Aide & découverte", icon: "fa-circle-question",
      cats: ["serverName"] }
];

function _groupedCategories() {
    const byKey = new Map(CATEGORIES.map(c => [c.firstKey, c]));
    const used = new Set();
    const groups = CONFIG_GROUPS.map(g => ({
        title: g.title, icon: g.icon,
        cats: g.cats.map(k => byKey.get(k)).filter(Boolean)
    }));
    for (const g of groups) for (const c of g.cats) used.add(c.firstKey);
    const misc = CATEGORIES.filter(c => !used.has(c.firstKey));
    if (misc.length) groups.push({ title: "Divers", icon: "fa-ellipsis", cats: misc });
    return groups.filter(g => g.cats.length);
}

function registerConfigHub() {
    try {
        game.settings.registerMenu(MOD, "menu-config-hub", {
            name:  "⚙ Panneau de configuration (tout)",
            label: "Ouvrir le panneau",
            hint:  "Tous les réglages du module, classés par thème avec des sections repliables. Point d'entrée recommandé.",
            icon:  "fas fa-gears",
            type:  makeLauncher({ firstKey: "config-hub", title: "Panneau de configuration", icon: "fa-gears", open: () => openConfigHub() }),
            restricted: true
        });
    } catch (e) {
        console.warn(`[${MOD}] registerMenu « Panneau de configuration » échec :`, e);
    }
}

// Une catégorie qui a un handler `open` (éditeur dédié) et aucune clé n'est
// pas inlinable : on affiche un bouton qui ouvre son éditeur.
const _catIsInlinable = (cat) => Array.isArray(cat.keys) && cat.keys.length > 0 || !!cat.tree;
const _hubHostId = (cat) => `scwm-hub-cat-${cat.firstKey}`;

async function openConfigHub() {
    const groups = _groupedCategories();

    const groupHtml = groups.map((g, gi) => {
        const cats = g.cats.map(cat => {
            if (!_catIsInlinable(cat)) {
                // Catégorie à éditeur dédié (Profils compagnons, Interface—Masquer…).
                return `<div class="scwm-hub-launch">
                    <div><i class="fa-solid ${cat.icon}"></i> <strong>${cat.title}</strong>
                        <div class="scwm-hub-launch-desc">${cat.desc ?? ""}</div></div>
                    <button type="button" class="scwm-hub-open" data-cat="${cat.firstKey}">
                        <i class="fa-solid fa-up-right-from-square"></i> Ouvrir</button>
                </div>`;
            }
            return `<details class="scwm-hub-cat">
                <summary><i class="scwm-hub-caret fa-solid fa-caret-right"></i><i class="fa-solid ${cat.icon}"></i> ${cat.title}</summary>
                <div class="scwm-hub-cat-body">${buildCategoryForm(cat, _hubHostId(cat), { banner: false })}</div>
            </details>`;
        }).join("");
        return `<section class="scwm-hub-group" data-group="${gi}" ${gi === 0 ? "" : 'style="display:none;"'}>
            <h2 class="scwm-hub-group-title"><i class="fa-solid ${g.icon}"></i> ${g.title}</h2>
            ${cats}
        </section>`;
    }).join("");

    const nav = groups.map((g, gi) =>
        `<button type="button" class="scwm-hub-navbtn ${gi === 0 ? "active" : ""}" data-group="${gi}">
            <i class="fa-solid ${g.icon}"></i><span>${g.title}</span></button>`).join("");

    const content = `
    <div id="scwm-hub" class="scwm-hub">
        <div class="scwm-hub-nav">${nav}</div>
        <div class="scwm-hub-scroll">${groupHtml}</div>
    </div>`;

    const wireHub = () => {
        const root = document.getElementById("scwm-hub");
        if (!root) return;
        // Navigation entre thèmes.
        root.querySelectorAll(".scwm-hub-navbtn").forEach(btn => btn.addEventListener("click", (e) => {
            e.preventDefault();
            const gi = btn.dataset.group;
            root.querySelectorAll(".scwm-hub-navbtn").forEach(b => b.classList.toggle("active", b === btn));
            root.querySelectorAll(".scwm-hub-group").forEach(s => s.style.display = (s.dataset.group === gi) ? "" : "none");
            root.querySelector(".scwm-hub-scroll")?.scrollTo({ top: 0 });
        }));
        // Boutons « Ouvrir » des éditeurs dédiés.
        root.querySelectorAll(".scwm-hub-open").forEach(btn => btn.addEventListener("click", (e) => {
            e.preventDefault();
            const cat = CATEGORIES.find(c => c.firstKey === btn.dataset.cat);
            if (cat?.open) cat.open();
        }));
        // Câblage de chaque formulaire de catégorie inliné, chacun sur SON hôte
        // (évite les collisions de sélecteurs entre catégories).
        for (const g of groups) for (const cat of g.cats) {
            if (!_catIsInlinable(cat)) continue;
            const host = document.getElementById(_hubHostId(cat));
            if (host) { try { wireCategoryForm(cat, host); } catch (err) { console.warn(`[${MOD}] wire hub ${cat.firstKey}`, err); } }
        }
    };

    await foundry.applications.api.DialogV2.wait({
        window:      { title: "Soruta — Panneau de configuration", icon: "fas fa-gears" },
        position:    { width: 780 },
        rejectClose: false,
        content,
        render:      wireHub,
        buttons: [
            {
                action: "save", default: true,
                label: "Tout enregistrer", icon: '<i class="fa-solid fa-save"></i>',
                callback: async () => {
                    let reload = false;
                    for (const g of groups) for (const cat of g.cats) {
                        if (!_catIsInlinable(cat)) continue;
                        const host = document.getElementById(_hubHostId(cat));
                        if (host) reload = (await saveCategoryForm(cat, host, { silent: true })) || reload;
                    }
                    ui.notifications?.info("Réglages enregistrés.");
                    if (reload) {
                        const ok = await foundry.applications.api.DialogV2.confirm({
                            window:  { title: "Rechargement requis" },
                            content: "<p>Certains changements nécessitent un rechargement pour s'appliquer. Recharger maintenant ?</p>"
                        });
                        if (ok) window.location.reload();
                    }
                }
            },
            { action: "close", label: "Fermer", icon: '<i class="fa-solid fa-xmark"></i>', callback: () => {} }
        ]
    });
}

// ============================================================
// Menus par catégorie — chaque grande section devient un bouton
// "Configurer" (registerMenu) qui ouvre une fenêtre dédiée (DialogV2)
// avec uniquement les réglages de cette section.
// ============================================================

function registerCategoryMenus() {
    // Ordre alphabétique des catégories (l'affichage suit l'ordre d'enregistrement).
    const sorted = [...CATEGORIES].sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
    for (const cat of sorted) {
        try {
            game.settings.registerMenu(MOD, `menu-${cat.firstKey}`, {
                name:       cat.title,
                label:      "Configurer",
                hint:       cat.desc,
                icon:       `fas ${cat.icon}`,
                type:       makeLauncher(cat),
                restricted: true   // GM uniquement (réglages "world")
            });
        } catch (e) {
            console.warn(`[${MOD}] registerMenu "${cat.title}" échec :`, e);
        }
    }
}

// Foundry fait new type().render(true) au clic du bouton. registerMenu EXIGE
// que type soit une sous-classe de FormApplication ou d'ApplicationV2 (sinon
// l'enregistrement échoue et le module n'apparaît pas dans la config). On étend
// donc ApplicationV2 et on détourne render() pour ouvrir notre fenêtre DialogV2.
function makeLauncher(category) {
    return class extends foundry.applications.api.ApplicationV2 {
        static DEFAULT_OPTIONS = {
            id:     `scwm-menu-${category.firstKey}`,
            window: { title: category.title }
        };
        async render() { (category.open ?? (() => openCategoryDialog(category)))(); return this; }
        async close()  { return this; }
    };
}

async function openCategoryDialog(category) {
    const uid = `scwm-cat-${category.firstKey}`;
    await foundry.applications.api.DialogV2.wait({
        window:      { title: `Configurer — ${category.title}`, icon: `fas ${category.icon}` },
        position:    { width: 560 },
        rejectClose: false,
        content:     buildCategoryForm(category, uid),
        render:      () => wireCategoryForm(category, document.getElementById(uid)),
        buttons: [
            {
                action: "save", default: true,
                label: "Enregistrer", icon: '<i class="fa-solid fa-save"></i>',
                callback: async () => await saveCategoryForm(category, document.getElementById(uid))
            },
            { action: "close", label: "Fermer", icon: '<i class="fa-solid fa-xmark"></i>', callback: () => {} }
        ]
    });
}

function boolKeysOf(category) {
    return category.keys.filter(k => game.settings.settings.get(`${MOD}.${k}`)?.type === Boolean);
}

function buildCategoryForm(category, uid, { banner = true } = {}) {
    const toggleBar = boolKeysOf(category).length >= 2 ? `
        <div style="display:flex;gap:12px;justify-content:flex-end;margin:0 4px 8px;font-size:.8em;">
            <a class="scwm-all-on"  style="color:#8fd19e;cursor:pointer;">Tout activer</a>
            <span style="color:#555;">·</span>
            <a class="scwm-all-off" style="color:#e58f8f;cursor:pointer;">Tout désactiver</a>
        </div>` : "";
    return `
    <div id="${uid}" class="scwm-cat-form" style="display:flex;flex-direction:column;max-height:60vh;overflow-y:auto;padding-right:4px;">
        ${banner ? licenseBannerHtml() : ""}
        ${category.desc ? `<p style="margin:0 0 8px;font-size:.85em;color:#aaa;font-style:italic;">${category.desc}</p>` : ""}
        ${toggleBar}
        ${category.tree ? renderTweakTree(category.tree) : category.keys.map(settingControlHtml).join("")}
    </div>`;
}

// Bandeau « droits & version » affiché en tête de chaque fenêtre de réglages.
export function licenseBannerHtml() {
    const version = game.modules.get(MOD)?.version ?? "";
    return `
    <div style="display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:7px 10px;
                border:1px solid rgba(201,162,39,0.5);border-radius:5px;
                background:linear-gradient(180deg,rgba(201,162,39,0.12),rgba(0,0,0,0.15));">
        <i class="fa-solid fa-shield-halved" style="color:${ACCENT};font-size:15px;"></i>
        <div style="font-size:.78em;line-height:1.4;color:#d8cfa8;">
            <strong>Soruta — Completed Westmarch</strong> · v${version}<br>
            © 2026 Soruta — Tous droits réservés. Usage personnel autorisé ; toute
            redistribution, modification ou usage commercial est interdit sans autorisation écrite.
        </div>
    </div>`;
}

function settingControlHtml(key) {
    const cfg = game.settings.settings.get(`${MOD}.${key}`);
    if (!cfg) return "";
    if (TM_TABLE_SCHEMAS[key]) return tableControlHtml(key, cfg);
    const val    = game.settings.get(MOD, key);
    const reload = cfg.requiresReload ? ` <span style="color:${ACCENT};font-size:.78em;">⟳ rechargement</span>` : "";
    const hint   = cfg.hint ? `<p style="margin:3px 0 0;font-size:.8em;color:#999;">${cfg.hint}</p>` : "";
    const wrap   = "padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.06);";

    if (cfg.type === Boolean) {
        return `<div class="scwm-set" data-key="${key}" style="${wrap}">
            <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;font-weight:600;margin:0;">
                <span>${cfg.name}${reload}</span>
                <input type="checkbox" name="${key}" ${val ? "checked" : ""} style="width:18px;height:18px;flex-shrink:0;">
            </label>${hint}</div>`;
    }

    let control;
    if (cfg.choices && typeof cfg.choices === "object") {
        const opts = Object.entries(cfg.choices)
            .map(([v, lbl]) => `<option value="${escapeAttr(v)}" ${val === v ? "selected" : ""}>${lbl}</option>`)
            .join("");
        control = `<select name="${key}" style="width:100%;">${opts}</select>`;
    } else if (cfg.type === Number) {
        control = `<input type="number" name="${key}" value="${val ?? 0}" step="any" style="width:100%;">`;
    } else if (key === "gmAutoFolderParent") {
        // Nom de dossier saisi librement (PAS un sélecteur : le même nom sert
        // dans Acteurs, Journaux et Scènes).
        control = `<input type="text" name="${key}" value="${escapeAttr(val ?? "")}" placeholder="Nom du dossier parent (ex. Game Master)" style="width:100%;">`;
    } else if (key.includes("Folder")) {
        control = `<select name="${key}" style="width:100%;">${folderOptionsHtml(val)}</select>`;
    } else if (key.includes("Pack")) {
        // Les compendiums d'OBJETS (craft) vs d'ACTEURS.
        const docType = (key === "tmCraftPack" || key === "commonPackCraft") ? "Item" : "Actor";
        control = `<select name="${key}" style="width:100%;">${packOptionsHtml(val, docType)}</select>`;
    } else if (key === "expeditionMapSceneId") {
        control = `<select name="${key}" style="width:100%;">${sceneOptionsHtml(val)}</select>`;
    } else if (key === "expeditionMapSceneIds") {
        const ids = Array.isArray(val) ? val.filter(Boolean) : [];
        const rows = ids.map(id => sceneRowHtml(id)).join("");
        control = `<div class="scwm-scene-list" data-key="${key}">
            <div class="scwm-scene-rows">${rows}</div>
            <button type="button" class="scwm-scene-add"
                    style="margin-top:2px;padding:3px 10px;border-radius:4px;cursor:pointer;
                           border:1px solid rgba(201,162,39,0.4);background:rgba(201,162,39,0.12);color:#c9a227;">
                <i class="fa-solid fa-plus"></i> Ajouter une carte
            </button>
        </div>`;
    } else if (key === "activationCode") {
        // Champ masqué (comme un mot de passe) — la valeur ne s'affiche pas en clair.
        control = `<input type="password" name="${key}" value="${escapeAttr(val ?? "")}" autocomplete="new-password" style="width:100%;">`;
    } else if (key.endsWith("Image")) {
        // Chemin d'image avec bouton « Parcourir » (FilePicker).
        control = `<div style="display:flex;gap:4px;">
            <input type="text" name="${key}" value="${escapeAttr(val ?? "")}" style="flex:1 1 auto;min-width:0;">
            <button type="button" class="scwm-filepicker" data-target="${key}" data-fptype="image" title="Parcourir" style="flex:0 0 auto;width:34px;"><i class="fa-solid fa-file-import"></i></button>
        </div>`;
    } else {
        control = `<input type="text" name="${key}" value="${escapeAttr(val ?? "")}" style="width:100%;">`;
    }
    return `<div class="scwm-set" data-key="${key}" style="${wrap}">
        <label style="display:block;font-weight:600;margin-bottom:4px;">${cfg.name}${reload}</label>
        ${control}${hint}</div>`;
}

function wireCategoryForm(category, root) {
    if (!root) return;

    // Tout activer / désactiver
    const boolKeys = boolKeysOf(category);
    const setAll = (v) => boolKeys.forEach(k => {
        const el = root.querySelector(`[name="${k}"]`);
        if (el) { el.checked = v; el.disabled = false; el.closest(".scwm-set").style.opacity = "1"; }
    });
    root.querySelector(".scwm-all-on")?.addEventListener("click",  e => { e.preventDefault(); setAll(true); });
    root.querySelector(".scwm-all-off")?.addEventListener("click", e => { e.preventDefault(); setAll(false); });

    // Boutons « Parcourir » (FilePicker) pour les champs d'image.
    root.querySelectorAll(".scwm-filepicker").forEach(btn => btn.addEventListener("click", (e) => {
        e.preventDefault();
        const input = root.querySelector(`[name="${btn.dataset.target}"]`);
        if (!input) return;
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        new FP({ type: btn.dataset.fptype || "image", current: input.value, callback: (path) => { input.value = path; } }).browse();
    }));

    // Liste dynamique de cartes d'expédition : + ajoute une ligne, × retire.
    const sceneList = root.querySelector(".scwm-scene-list");
    if (sceneList) {
        const rowsBox = sceneList.querySelector(".scwm-scene-rows");
        sceneList.querySelector(".scwm-scene-add")?.addEventListener("click", (e) => {
            e.preventDefault();
            rowsBox?.insertAdjacentHTML("beforeend", sceneRowHtml(""));
        });
        sceneList.addEventListener("click", (e) => {
            const del = e.target.closest?.(".scwm-scene-del");
            if (!del) return;
            e.preventDefault();
            del.closest(".scwm-scene-row")?.remove();
        });
    }

    // Cascade Party : grise les sous-options quand le maître est décoché.
    const master = root.querySelector(`[name="enableParty"]`);
    if (master) {
        const subs = PARTY_DEPENDENT_SETTINGS
            .map(k => root.querySelector(`[name="${k}"]`))
            .filter(Boolean);
        const apply = () => subs.forEach(cb => {
            cb.disabled = !master.checked;
            const box = cb.closest(".scwm-set");
            if (box) box.style.opacity = master.checked ? "1" : "0.5";
        });
        master.addEventListener("change", apply);
        apply();
    }
}

async function saveCategoryForm(category, root, { silent = false } = {}) {
    if (!root) return false;
    let needsReload = false;
    for (const key of category.keys) {
        const cfg = game.settings.settings.get(`${MOD}.${key}`);
        if (!cfg) continue;

        // Tables de temps morts (grille de champs) — reconstruites à part.
        if (TM_TABLE_SCHEMAS[key]) {
            const arr = readTableFromForm(key, root);
            if (JSON.stringify(game.settings.get(MOD, key)) !== JSON.stringify(arr)) {
                await game.settings.set(MOD, key, arr);
            }
            continue;
        }

        // Liste dynamique de cartes d'expédition → tableau d'IDs (dédupliqué).
        if (key === "expeditionMapSceneIds") {
            const container = root.querySelector(`.scwm-scene-list[data-key="${key}"]`);
            const ids = container
                ? [...new Set([...container.querySelectorAll(".scwm-scene-select")].map(s => s.value).filter(Boolean))]
                : [];
            if (JSON.stringify(game.settings.get(MOD, key) ?? []) !== JSON.stringify(ids)) {
                await game.settings.set(MOD, key, ids);
            }
            continue;
        }

        const el = root.querySelector(`[name="${key}"]`);
        if (!el) continue;

        let v;
        if (cfg.type === Boolean)      v = el.checked;
        else if (cfg.type === Number)  { v = Number(el.value); if (Number.isNaN(v)) v = cfg.default ?? 0; }
        else                           v = el.value;
        if (game.settings.get(MOD, key) !== v) {
            await game.settings.set(MOD, key, v);
            if (cfg.requiresReload) needsReload = true;
        }
    }
    if (silent) return needsReload;
    ui.notifications?.info(`${category.title} — réglages enregistrés.`);
    if (needsReload) {
        const ok = await foundry.applications.api.DialogV2.confirm({
            window:  { title: "Rechargement requis" },
            content: "<p>Certains changements nécessitent un rechargement de la page pour s'appliquer. Recharger maintenant ?</p>"
        });
        if (ok) window.location.reload();
    }
    return needsReload;
}

function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function folderOptionsHtml(currentVal) {
    const all = game.folders.filter(f => f.type === "Actor");
    const walk = (parentId, depth) => all
        .filter(f => (f.folder?.id ?? null) === parentId)
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name))
        .flatMap(f => [
            `<option value="${f.id}" ${f.id === currentVal ? "selected" : ""}>${"  ".repeat(depth * 2)}${depth > 0 ? "└ " : ""}${f.name}</option>`,
            ...walk(f.id, depth + 1)
        ]);
    return [`<option value="">— aucun —</option>`, ...walk(null, 0)].join("");
}

function sceneOptionsHtml(currentVal) {
    return [
        `<option value="">— Aucune —</option>`,
        ...game.scenes.contents.map(s => `<option value="${s.id}" ${s.id === currentVal ? "selected" : ""}>${s.name}</option>`)
    ].join("");
}

// Une ligne « carte supplémentaire » : sélecteur de scène + bouton retirer.
function sceneRowHtml(selectedId = "") {
    return `<div class="scwm-scene-row" style="display:flex;gap:4px;margin-bottom:4px;">
        <select class="scwm-scene-select" style="flex:1 1 auto;min-width:0;">${sceneOptionsHtml(selectedId)}</select>
        <button type="button" class="scwm-scene-del" title="Retirer cette carte"
                style="flex:0 0 auto;width:30px;border-radius:4px;cursor:pointer;
                       border:1px solid rgba(192,57,43,0.4);background:rgba(192,57,43,0.12);color:#e58f8f;">
            <i class="fa-solid fa-xmark"></i>
        </button>
    </div>`;
}

// Menu déroulant des compendiums (valeur = collection). docType filtre le type
// de document (Actor par défaut ; Item pour les objets craftables).
function packOptionsHtml(currentVal, docType = "Actor") {
    const packs = game.packs.filter(p => p.documentName === docType)
        .sort((a, b) => (a.title ?? a.metadata?.label ?? "").localeCompare(b.title ?? b.metadata?.label ?? ""));
    return [
        `<option value="">— aucun —</option>`,
        ...packs.map(p => {
            const label = p.title ?? p.metadata?.label ?? p.collection;
            return `<option value="${p.collection}" ${p.collection === currentVal ? "selected" : ""}>${escapeAttr(label)}</option>`;
        })
    ].join("");
}
