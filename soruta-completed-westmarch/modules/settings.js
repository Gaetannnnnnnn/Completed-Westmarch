// ============================================================
// settings.js — Paramètres unifiés du module Soruta — Completed Westmarch
// Tous les settings des 9 anciens modules, sous le namespace unique MOD.
// Les clés en collision ont été préfixées par domaine (relations*, bestiary*,
// carnet*, rangeFix*, tuto*). Voir migration.js pour la reprise des valeurs.
// © 2026 Soruta.
// ============================================================

import { MOD, TUTO_TOGGLES } from "./const.js";
import { applyHotbarVisibility } from "./hotbar.js";

// Settings dont l'utilité dépend entièrement du système de party.
export const PARTY_DEPENDENT_SETTINGS = [
    "enableJoinScene",
    "enableShowParty",
    "enableChatFilter",
    "enablePlayerGrouping",
    "enableGoWithPartyScenes",
    "enableGoWithPartyJournal",
    "enableSessionLog",
    "enableCombatParty"
];

// Vérifie qu'un setting dépendant de la party est actif ET que la party l'est.
export function partyFeatureEnabled(key) {
    if (!game.settings.get(MOD, "enableParty")) return false;
    return game.settings.get(MOD, key);
}

const B = (name, hint, def = true, extra = {}) => ({
    name, hint, scope: "world", config: true, type: Boolean, default: def, requiresReload: false, ...extra
});
const N = (name, hint, def) => ({
    name, hint, scope: "world", config: true, type: Number, default: def, requiresReload: false
});
const S = (name, hint, def = "") => ({
    name, hint, scope: "world", config: true, type: String, default: def, requiresReload: false
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
        "Journal de session",
        "Active le bouton 'Clore la session' (capture XP, ennemis, PNJ, objets et génère un journal)."));
    game.settings.register(MOD, "enableCombatParty", B(
        "Combat lié à la party (plutôt qu'à la scène)",
        "Les combats créés par un GM sont détachés de la scène et associés à sa party. Chaque joueur ne voit que le combat de sa party."));
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
        hint: "Cache la barre de macros (hotbar) pour les joueurs non-GM. Le GM la conserve toujours. Modifiable sans rechargement.",
        scope: "world", config: true, type: Boolean, default: false, requiresReload: false,
        onChange: () => applyHotbarVisibility()
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
    game.settings.register(MOD, "relationsFolderCreatures", S(
        "Relations — Dossier des créatures",
        "Dossier acteur des monstres/créatures pour la détection automatique de rencontres."));

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
        "ID du compendium des monstres (ex : world.creature). Prioritaire sur le dossier si renseigné.",
        "world.creature"));
    game.settings.register(MOD, "bestiaryFolderCreatures", S(
        "Bestiaire — Dossier des créatures (legacy)",
        "Dossier acteur de secours si aucun compendium n'est configuré."));

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
    game.settings.register(MOD, "serverName", S(
        "Tutoriel — Nom affiché dans le message de bienvenue",
        "Titre de la fenêtre d'accueil des joueurs.",
        "Bienvenue sur le serveur !"));
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
    // MISE EN FORME de la page de configuration
    // ============================================================
    registerSettingsUI();
}

// ============================================================
// Catégories (ordre = ordre d'enregistrement des settings).
// firstKey = clé devant laquelle insérer l'en-tête de catégorie.
// ============================================================
const CATEGORIES = [
    { firstKey: "enableParty",           icon: "fa-users",           title: "Système de Party",
      desc: "Groupes de joueurs : chat filtré, combat par party, téléportation de groupe, journal de session, anti-cheat.",
      keys: ["enableParty","enableJoinScene","enableShowParty","enablePlayerGrouping","enableGoWithPartyScenes","enableGoWithPartyJournal","enableChatFilter","enableSessionLog","enableCombatParty","enableAntiCheat"] },
    { firstKey: "enableXpBlock",         icon: "fa-server",          title: "Serveur",
      desc: "Personnalisations du serveur : blocage XP / Level Up, logs Discord, webhooks.",
      keys: ["enableXpBlock","enableDiscordLog","discordLogWebhookUrl","downtimeWebhookUrl","tmWebhookUrl"] },
    { firstKey: "enableTokenAppearance", icon: "fa-toolbox",         title: "Toolkit — Tokens & GM",
      desc: "Apparences multiples, transformations, tailles Large (Rage / Goliath), protégé TGCM, utilitaires GM.",
      keys: ["enableTokenAppearance","enableTokenPortraitButton","enableRageSize","enableLargeForm","enablePolymorph","enableTgcm","enableFolderMove","enableToolAbilityFix","enableHideHotbar"] },
    { firstKey: "enableTemplateSnap",    icon: "fa-ruler-combined",  title: "Toolkit — Templates AoE",
      desc: "Snap des gabarits de zone au dixième de pied.",
      keys: ["enableTemplateSnap"] },
    { firstKey: "enableMejShopFix",      icon: "fa-store",           title: "Toolkit — Boutiques MEJ",
      desc: "Correctifs des boutiques Monk's Enhanced Journal.",
      keys: ["enableMejShopFix"] },
    { firstKey: "enableMejRestock",      icon: "fa-arrows-rotate",   title: "Toolkit — Réapprovisionnement",
      desc: "Restock automatique des boutiques, avec délais configurables par rareté.",
      keys: ["enableMejRestock","shopRestockDays","shopRestockDaysCommon","shopRestockDaysUncommon","shopRestockDaysRare","shopRestockDaysVeryRare","shopRestockDaysLegendary"] },
    { firstKey: "relationsEnabled",      icon: "fa-heart",           title: "Fiche PJ — Relations",
      desc: "Onglet Relations : liens entre personnages, détection automatique des rencontres, anonymisation.",
      keys: ["relationsEnabled","relationsAnonymization","relationsFolderPJ","relationsFolderPNJ","relationsFolderCreatures"] },
    { firstKey: "bestiaryEnabled",       icon: "fa-dragon",          title: "Fiche PJ — Bestiaire",
      desc: "Onglet Bestiaire : créatures rencontrées, répertoriées par personnage.",
      keys: ["bestiaryEnabled","bestiaryAnonymization","bestiaryFolderPJ","bestiaryPackCreatures","bestiaryFolderCreatures"] },
    { firstKey: "carnetEnabled",         icon: "fa-book-open",       title: "Fiche PJ — Carnet & Expéditions",
      desc: "Onglets Carnet (notes enrichies) et Expéditions (dates + durée).",
      keys: ["carnetEnabled"] },
    { firstKey: "enableExpeditionMap",   icon: "fa-map",             title: "Carte des expéditions",
      desc: "Brouillard de guerre par party et par personnage sur une scène dédiée.",
      keys: ["enableExpeditionMap","expeditionMapSceneId"] },
    { firstKey: "rangeFixEnabled",       icon: "fa-bullseye",        title: "Midi Range Fix",
      desc: "Correction du calcul de portée midi-qol pour les tokens Large et plus.",
      keys: ["rangeFixEnabled","rangeAdjust"] },
    { firstKey: "serverName",            icon: "fa-circle-question", title: "Tutoriel",
      desc: "Fenêtre de bienvenue et guide interactif, configurable section par section.",
      keys: ["serverName","tutoBarreWestmarch","tutoBestiary","tutoRelations","tutoCarnet","tutoBoutiques","tutoTempsMorts","tutoApparenceTokens","tutoOutilsGm","showWelcome"] },
];

const ACCENT = "#e67e22";

function registerSettingsUI() {
    Hooks.on("renderSettingsConfig", (app, html) => {
        const root = $(html);

        // ---- Bandeau module en tête ----
        const firstGroup = root.find(`[name="${MOD}.enableParty"]`).closest(".form-group");
        if (firstGroup.length) {
            const version = game.modules.get(MOD)?.version ?? "?";
            firstGroup.before(`
                <div style="margin-bottom:14px;padding:12px 16px;border:1px solid ${ACCENT};border-radius:6px;background:rgba(230,126,34,0.09);">
                    <p style="margin:0 0 4px 0;font-size:1.05em;"><i class="fas fa-hammer" style="color:${ACCENT};"></i> <strong>Soruta — Completed Westmarch</strong> — v${version}</p>
                    <p style="margin:0;font-size:0.9em;">Module West March unifié. Chaque fonctionnalité ci-dessous est activable indépendamment.</p>
                    <p style="margin:6px 0 0 0;font-size:0.85em;font-style:italic;color:${ACCENT};">© 2026 Soruta — Usage personnel autorisé.</p>
                </div>
            `);
        }

        // ---- En-têtes de catégorie (titre + icône + description + tout activer/désactiver) ----
        for (const cat of CATEGORIES) buildCategoryHeader(root, cat);

        // ---- Conversion des champs dossier en <select> arborescent ----
        buildFolderSelects(root, [
            "relationsFolderPJ", "relationsFolderPNJ", "relationsFolderCreatures",
            "bestiaryFolderPJ", "bestiaryFolderCreatures"
        ]);

        // ---- Conversion du champ scène (carte) en <select> ----
        const sceneInput = root.find(`[name="${MOD}.expeditionMapSceneId"]`);
        if (sceneInput.length && sceneInput.is("input")) {
            const cur = game.settings.get(MOD, "expeditionMapSceneId");
            const select = $(`<select name="${MOD}.expeditionMapSceneId" style="width:100%"></select>`);
            select.append(`<option value="">— Aucune —</option>`);
            game.scenes.contents.forEach(s => select.append(`<option value="${s.id}">${s.name}</option>`));
            select.val(cur || "");
            sceneInput.replaceWith(select);
        }

        // ---- Cascade visuelle des options dépendantes de la Party ----
        applyPartyCascade(root);
    });
}

// Coche/décoche toutes les cases à cocher d'une catégorie.
function setCategory(root, keys, value) {
    for (const k of keys) {
        const cb = root.find(`input[name="${MOD}.${k}"][type="checkbox"]`);
        if (cb.length) cb.prop("checked", value).prop("disabled", false);
    }
}

function buildCategoryHeader(root, cat) {
    const g = root.find(`[name="${MOD}.${cat.firstKey}"]`).closest(".form-group");
    if (!g.length) return;

    // Cases à cocher réellement présentes dans cette catégorie
    const boolKeys = cat.keys.filter(k =>
        root.find(`input[name="${MOD}.${k}"][type="checkbox"]`).length > 0);

    const toggleAll = boolKeys.length >= 2 ? `
        <span style="font-size:0.72em;font-weight:400;text-transform:none;letter-spacing:0;white-space:nowrap;">
            <a class="scwm-check-all"   style="color:#8fd19e;cursor:pointer;">Tout activer</a>
            <span style="color:#555;">·</span>
            <a class="scwm-uncheck-all" style="color:#e58f8f;cursor:pointer;">Tout désactiver</a>
        </span>` : "";

    const header = $(`
        <div class="scwm-cat-header" style="margin:18px 0 8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;
                        border-bottom:1px solid ${ACCENT};padding-bottom:4px;">
                <span style="color:${ACCENT};font-size:0.95em;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">
                    <i class="fas ${cat.icon}"></i> ${cat.title}
                </span>
                ${toggleAll}
            </div>
            <p style="margin:4px 0 0 0;font-size:0.82em;color:#999;font-style:italic;">${cat.desc}</p>
        </div>
    `);

    g.before(header);

    header.find(".scwm-check-all").on("click", (e) => { e.preventDefault(); setCategory(root, boolKeys, true); });
    header.find(".scwm-uncheck-all").on("click", (e) => { e.preventDefault(); setCategory(root, boolKeys, false); });
}

function buildFolderSelects(root, keys) {
    const options = (currentVal) => {
        const all = game.folders.filter(f => f.type === "Actor");
        const walk = (parentId, depth) => all
            .filter(f => (f.folder?.id ?? null) === parentId)
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name))
            .flatMap(f => [
                `<option value="${f.id}" ${f.id === currentVal ? "selected" : ""}>${"  ".repeat(depth * 2)}${depth > 0 ? "└ " : ""}${f.name}</option>`,
                ...walk(f.id, depth + 1)
            ]);
        return [`<option value="">— aucun —</option>`, ...walk(null, 0)].join("");
    };
    for (const key of keys) {
        const input = root.find(`[name="${MOD}.${key}"]`);
        if (!input.length) continue;
        const cur = game.settings.get(MOD, key);
        input.replaceWith(`<select name="${MOD}.${key}" style="width:100%">${options(cur)}</select>`);
    }
}

function applyPartyCascade(root) {
    const partyGroup = root.find(`[name="${MOD}.enableParty"]`).closest(".form-group");
    if (!partyGroup.length) return;

    // Indente les options dépendantes juste sous "Système de Party".
    let anchor = partyGroup;
    const subs = [];
    PARTY_DEPENDENT_SETTINGS.forEach(key => {
        const group = root.find(`[name="${MOD}.${key}"]`).closest(".form-group");
        if (!group.length) return;
        group.css({ marginLeft: "24px", borderLeft: `2px solid ${ACCENT}`, paddingLeft: "8px" });
        group.insertAfter(anchor);
        anchor = group;
        const cb = group.find(`[name="${MOD}.${key}"]`);
        if (cb.length) subs.push({ cb, group });
    });

    // Quand le maître est décoché, on grise et désactive les sous-options SANS
    // les décocher (leur valeur stockée est préservée ; partyFeatureEnabled()
    // renvoie déjà false tant que le maître est off).
    const master = partyGroup.find(`[name="${MOD}.enableParty"]`);
    const apply = () => {
        const on = master.prop("checked");
        subs.forEach(({ cb, group }) => {
            cb.prop("disabled", !on);
            group.css("opacity", on ? "1" : "0.5");
        });
    };
    master.on("change", apply);
    apply();
}
