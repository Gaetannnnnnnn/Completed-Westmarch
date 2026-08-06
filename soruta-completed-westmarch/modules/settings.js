// ============================================================
// settings.js — Paramètres unifiés du module Soruta — Completed Westmarch
// Tous les settings des 9 anciens modules, sous le namespace unique MOD.
// Les clés en collision ont été préfixées par domaine (relations*, bestiary*,
// carnet*, rangeFix*, tuto*). Voir migration.js pour la reprise des valeurs.
// © 2026 Soruta.
// ============================================================

import { MOD, TUTO_TOGGLES, TM_DEFAULT_SCROLL, TM_DEFAULT_MAGIC } from "./const.js";
import { applyHotbarVisibility } from "./hotbar.js";
import { applyPartyPause } from "./partypause.js";

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
    game.settings.register(MOD, "enableSessionLog", B(
        "Rapport de session",
        "Active le suivi de session (dès la création de party) et le bouton 'Clore la session', qui envoie le récap (XP, ennemis, PNJ, objets) sur le webhook Discord ci-dessous."));
    game.settings.register(MOD, "sessionLogWebhookUrl", S(
        "URL du Webhook Discord (rapport de session)",
        "Le bouton 'Clore la session' envoie le rapport (même contenu que les anciens journaux) sur ce webhook. Laisser vide pour désactiver l'envoi."));
    // Brouillons de rapports de session (Casier du GM). Non affiché.
    game.settings.register(MOD, "sessionDrafts", {
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
        "Active tout le système de temps morts : bouton sablier sur la fiche PJ (joueur) et bouton GM dans la barre WestMarch. Nécessite un rechargement.",
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
    game.settings.register(MOD, "enablePolymorph", B(
        "Transformation de token (Wild Shape / Polymorph)",
        "Configurer des formes sur un acteur (onglet Apparence). Un bouton dans le HUD transforme le token et le rétablit."));
    game.settings.register(MOD, "enableTgcm", B(
        "Protégé TGCM (token immunisé à la mort)",
        "Bouton bouclier dans le HUD (GM). Un token protégé ne tombe jamais à 0 PV (reste à 1 PV)."));
    game.settings.register(MOD, "enableFolderMove", B(
        "Déplacer/Dupliquer vers… (sidebar)",
        "Ajoute 'Déplacer vers…' et 'Dupliquer vers…' dans le menu contextuel des scènes, acteurs, objets et journaux."));
    game.settings.register(MOD, "enableToolAbilityFix", B(
        "Correction de la stat des outils (tools)",
        "À la création d'un outil sans stat, corrige automatiquement vers la stat canonique dnd5e."));
    game.settings.register(MOD, "enableHideHotbar", {
        name: "Masquer la barre de macros (joueurs)",
        hint: "Cache la barre de macros (hotbar) pour les joueurs non-GM. Modifiable sans rechargement.",
        scope: "world", config: false, type: Boolean, default: false, requiresReload: false,
        onChange: () => applyHotbarVisibility()
    });
    game.settings.register(MOD, "enableHideHotbarGM", {
        name: "Masquer la barre de macros (GM)",
        hint: "Cache la barre de macros (hotbar) pour les GM. Indépendant de l'option joueurs. Modifiable sans rechargement.",
        scope: "world", config: false, type: Boolean, default: false, requiresReload: false,
        onChange: () => applyHotbarVisibility()
    });
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
    game.settings.register(MOD, "enableTemplateSnap", B(
        "Snap des templates AoE au dixième de pied",
        "Pendant le placement d'un template, la taille s'incrémente par paliers de 0,1 ft. Nécessite lib-wrapper pour le snap live."));
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

    // ============================================================
    // CARTE DES EXPÉDITIONS (clés inchangées)
    // ============================================================
    game.settings.register(MOD, "enableExpeditionMap", B(
        "Carte des expéditions",
        "Synchronise la permission Owner de l'acteur Groupe avec les joueurs membres, pour la vision/brouillard sur la carte du monde."));
    game.settings.register(MOD, "expeditionMapSceneId", S(
        "Carte des expéditions — Scène",
        "Scène sur laquelle le brouillard de guerre est suivi par personnage plutôt que par compte joueur."));

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

    // ---- Suivi de la migration des données des anciens modules ----
    // 0 = jamais migré. Incrémenté par migration.js une fois la reprise faite.
    game.settings.register(MOD, "migrationVersion", {
        scope: "world", config: false, type: Number, default: 0
    });

    // ============================================================
    // MENUS PAR CATÉGORIE (boutons "Configurer" dans la config du module)
    // ============================================================
    registerCategoryMenus();
    registerCategoryToggles();
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
const CATEGORIES = [
    { firstKey: "enableParty", master: "enableParty",           icon: "fa-users",           title: "Système de Party",
      desc: "Groupes de joueurs : chat filtré, combat par party, téléportation de groupe, journal de session, anti-cheat.",
      keys: ["enableParty","enableJoinScene","enableShowParty","enablePlayerGrouping","enableGoWithPartyScenes","enableGoWithPartyJournal","enableChatFilter","enableSessionLog","sessionLogWebhookUrl","enableCombatParty","enableCombatTurnLock","enablePartyPause","enableAntiCheat"] },
    { firstKey: "enableXpBlock",         icon: "fa-server",          title: "Serveur",
      desc: "Personnalisations du serveur : blocage XP / Level Up, logs Discord, webhooks.",
      keys: ["enableXpBlock","enableDiscordLog","discordLogWebhookUrl","downtimeWebhookUrl","tmWebhookUrl"] },
    { firstKey: "tmSkillBase", master: "tmEnabled", icon: "fa-hourglass-half",  title: "Temps morts",
      desc: "Règles configurables des temps morts : valeurs, formules (gain de compétence, artisanat) et tables (parchemins, objets magiques). Chaque serveur peut avoir ses propres règles.",
      keys: ["tmEnabled","tmSkillBase","tmAddAbilityMod","tmBonusMaitrise","tmBonusExpertise","tmBonusTools","tmRollMinDays","tmSkillFormula","tmCraftNonMagicCostDiv","tmCraftNonMagicDaysPerGp","tmCraftNonMagicCostFormula","tmCraftNonMagicDaysFormula","tmSingleUseFactor","tmScrollTable","tmMagicTable"] },
    { firstKey: "enableTokenAppearance", icon: "fa-toolbox",         title: "Toolkit",
      desc: "Apparences de tokens, transformations, tailles Large, TGCM, utilitaires GM, templates AoE, boutiques MEJ et réapprovisionnement.",
      keys: ["enableTokenAppearance","enableTokenPortraitButton","enableRageSize","enableLargeForm","enablePolymorph","enableTgcm","enableFolderMove","enableToolAbilityFix","enableHideHotbar","enableHideHotbarGM","enableConnStats","enablePlayerListCompact","enableTemplateSnap","enableMejShopFix","enableMejRestock","shopRestockDays","shopRestockDaysCommon","shopRestockDaysUncommon","shopRestockDaysRare","shopRestockDaysVeryRare","shopRestockDaysLegendary"] },
    { firstKey: "relationsEnabled", master: "relationsEnabled",      icon: "fa-heart",           title: "Fiche PJ — Relations",
      desc: "Onglet Relations : liens entre personnages, détection automatique des rencontres, anonymisation.",
      keys: ["relationsEnabled","relationsAnonymization","relationsFolderPJ","relationsFolderPNJ","relationsPackPNJ","relationsPackCemetery"] },
    { firstKey: "bestiaryEnabled", master: "bestiaryEnabled",       icon: "fa-dragon",          title: "Fiche PJ — Bestiaire",
      desc: "Onglet Bestiaire : créatures rencontrées, répertoriées par personnage.",
      keys: ["bestiaryEnabled","bestiaryAnonymization","bestiaryFolderPJ","bestiaryPackCreatures"] },
    { firstKey: "carnetEnabled", master: "carnetEnabled",         icon: "fa-book-open",       title: "Fiche PJ — Carnet & Expéditions",
      desc: "Onglets Carnet (notes enrichies) et Expéditions (dates + durée).",
      keys: ["carnetEnabled"] },
    { firstKey: "enableExpeditionMap", master: "enableExpeditionMap",   icon: "fa-map",             title: "Carte des expéditions",
      desc: "Brouillard de guerre par party et par personnage sur une scène dédiée.",
      keys: ["enableExpeditionMap","expeditionMapSceneId"] },
    { firstKey: "rangeFixEnabled", master: "rangeFixEnabled",       icon: "fa-bullseye",        title: "Midi Range Fix",
      desc: "Correction du calcul de portée midi-qol pour les tokens Large et plus.",
      keys: ["rangeFixEnabled","rangeAdjust"] },
    { firstKey: "serverName", master: "tutoEnabled", icon: "fa-circle-question", title: "Tutoriel",
      desc: "Fenêtre de bienvenue et guide interactif, configurable section par section.",
      keys: ["tutoEnabled","serverName","tutoBarreWestmarch","tutoTourFiche","tutoBestiary","tutoRelations","tutoCarnet","tutoCasier","tutoBoutiques","tutoTempsMorts","tutoApparenceTokens","tutoOutilsGm","showWelcome"] },
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
// Menus par catégorie — chaque grande section devient un bouton
// "Configurer" (registerMenu) qui ouvre une fenêtre dédiée (DialogV2)
// avec uniquement les réglages de cette section.
// ============================================================

function registerCategoryMenus() {
    for (const cat of CATEGORIES) {
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
        async render() { openCategoryDialog(category); return this; }
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
                label: "Enregistrer", icon: '<i class="fas fa-save"></i>',
                callback: async () => await saveCategoryForm(category, document.getElementById(uid))
            },
            { action: "close", label: "Fermer", icon: '<i class="fas fa-xmark"></i>', callback: () => {} }
        ]
    });
}

function boolKeysOf(category) {
    return category.keys.filter(k => game.settings.settings.get(`${MOD}.${k}`)?.type === Boolean);
}

function buildCategoryForm(category, uid) {
    const toggleBar = boolKeysOf(category).length >= 2 ? `
        <div style="display:flex;gap:12px;justify-content:flex-end;margin:0 4px 8px;font-size:.8em;">
            <a class="scwm-all-on"  style="color:#8fd19e;cursor:pointer;">Tout activer</a>
            <span style="color:#555;">·</span>
            <a class="scwm-all-off" style="color:#e58f8f;cursor:pointer;">Tout désactiver</a>
        </div>` : "";
    return `
    <div id="${uid}" class="scwm-cat-form" style="display:flex;flex-direction:column;max-height:60vh;overflow-y:auto;padding-right:4px;">
        ${category.desc ? `<p style="margin:0 0 8px;font-size:.85em;color:#aaa;font-style:italic;">${category.desc}</p>` : ""}
        ${toggleBar}
        ${category.keys.map(settingControlHtml).join("")}
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
    if (cfg.type === Number) {
        control = `<input type="number" name="${key}" value="${val ?? 0}" step="any" style="width:100%;">`;
    } else if (key.includes("Folder")) {
        control = `<select name="${key}" style="width:100%;">${folderOptionsHtml(val)}</select>`;
    } else if (key.includes("Pack")) {
        control = `<select name="${key}" style="width:100%;">${packOptionsHtml(val)}</select>`;
    } else if (key === "expeditionMapSceneId") {
        control = `<select name="${key}" style="width:100%;">${sceneOptionsHtml(val)}</select>`;
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

async function saveCategoryForm(category, root) {
    if (!root) return;
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
    ui.notifications?.info(`${category.title} — réglages enregistrés.`);
    if (needsReload) {
        const ok = await foundry.applications.api.DialogV2.confirm({
            window:  { title: "Rechargement requis" },
            content: "<p>Certains changements nécessitent un rechargement de la page pour s'appliquer. Recharger maintenant ?</p>"
        });
        if (ok) window.location.reload();
    }
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

// Menu déroulant des compendiums d'acteurs (valeur = collection, ex. world.pnj).
function packOptionsHtml(currentVal) {
    const packs = game.packs.filter(p => p.documentName === "Actor")
        .sort((a, b) => (a.title ?? a.metadata?.label ?? "").localeCompare(b.title ?? b.metadata?.label ?? ""));
    return [
        `<option value="">— aucun —</option>`,
        ...packs.map(p => {
            const label = p.title ?? p.metadata?.label ?? p.collection;
            return `<option value="${p.collection}" ${p.collection === currentVal ? "selected" : ""}>${escapeAttr(label)}</option>`;
        })
    ].join("");
}
