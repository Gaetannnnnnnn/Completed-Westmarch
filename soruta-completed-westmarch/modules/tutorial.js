// ============================================================
// tutorial.js — Moteur de tutoriel (bulles step-by-step)
//
// Architecture :
//   - SECTION_LABELS / ICONS / SETTING_KEYS : métadonnées par fonctionnalité
//   - STEPS_BY_FEATURE  : étapes groupées par fonctionnalité (pas par module)
//   - startTutorial()   : construit la liste filtrée (gmOnly/playerOnly), lance l'affichage
//   - closeTutorial()   : nettoie le DOM + retire le listener Echap
//   - _showStep()       : rendu async (beforeShow → spotlight → bulle)
//   - _positionBubble() : positionnement auto avec flip si débordement
// ============================================================

import { MOD } from "./const.js";
const MODULE = MOD;

// ================================================================
// SECTIONS : labels, icônes et clés de settings (par fonctionnalité)
// ================================================================

export const SECTION_LABELS = {
    barreWestmarch:  "Barre WestMarch",
    bestiary:        "Bestiaire",
    relations:       "Relations",
    carnet:          "Carnet & Expéditions",
    boutiques:       "Boutiques (MEJ)",
    tempsMorts:      "Temps morts",
    apparenceTokens: "Apparence des tokens",
    outilsGm:        "Outils GM",
};

export const SECTION_ICONS = {
    barreWestmarch:  "fa-compass",
    bestiary:        "fa-dragon",
    relations:       "fa-users",
    carnet:          "fa-book-open",
    boutiques:       "fa-store",
    tempsMorts:      "fa-hourglass-half",
    apparenceTokens: "fa-masks-theater",
    outilsGm:        "fa-shield-halved",
};

export const SETTING_KEYS = {
    barreWestmarch:  "tutoBarreWestmarch",
    bestiary:        "tutoBestiary",
    relations:       "tutoRelations",
    carnet:          "tutoCarnet",
    boutiques:       "tutoBoutiques",
    tempsMorts:      "tutoTempsMorts",
    apparenceTokens: "tutoApparenceTokens",
    outilsGm:        "tutoOutilsGm",
};

// ================================================================
// MODULES REQUIS PAR SECTION
// [] = toujours disponible  |  plusieurs IDs = au moins un doit être actif
// ================================================================

// Module fusionné : les fonctionnalités ne sont plus des modules séparés.
// section → clé de setting d'activation (null = toujours disponible).
export const SECTION_FEATURE_SETTING = {
    barreWestmarch:  null,               // le tutoriel crée lui-même le groupe
    bestiary:        "bestiaryEnabled",
    relations:       "relationsEnabled",
    carnet:          "carnetEnabled",
    boutiques:       null,               // dépendance externe (MEJ) gérée à part
    tempsMorts:      null,               // fonctionnalité intégrée
    apparenceTokens: null,               // fonctionnalité intégrée
    outilsGm:        null,               // fonctionnalité intégrée (gmOnly géré à part)
};

// Sections réservées au GM (toutes leurs étapes sont gmOnly)
export const SECTION_GM_ONLY = new Set(["boutiques", "outilsGm"]);

/**
 * Retourne true si la section est disponible pour l'utilisateur courant :
 *   - la fonctionnalité correspondante est activée (ou intégrée)
 *   - "boutiques" nécessite le module externe Monk's Enhanced Journal
 *   - la section n'est pas GM-only si l'utilisateur est joueur
 */
export function isSectionAvailable(sectionKey) {
    if (SECTION_GM_ONLY.has(sectionKey) && !game.user?.isGM) return false;
    if (sectionKey === "boutiques")
        return !!game.modules.get("monks-enhanced-journal")?.active;
    const setting = SECTION_FEATURE_SETTING[sectionKey];
    if (!setting) return true;
    return !!game.settings.get(MOD, setting);
}

// ================================================================
// ÉTAT GLOBAL
// ================================================================

let _steps      = [];
let _current    = 0;
let _wrapEl     = null;
let _escHandler = null;

// ================================================================
// NAVIGATION : ouvrir la fiche PJ et naviguer vers un onglet
// ================================================================

async function _openActorSheetTab(tabName) {
    // Acteur du joueur connecté, ou premier PJ disponible pour un GM sans personnage
    const actor = game.user.character
        ?? (game.user.isGM ? game.actors.find(a => a.type === "character" && a.hasPlayerOwner) : null);
    if (!actor) return;

    actor.sheet.render(true);
    await new Promise(r => setTimeout(r, 500));

    // App v1 : element est jQuery ; App v2 : element est un HTMLElement direct
    const appId   = actor.sheet.appId;
    const sheetEl = document.querySelector(`[data-appid="${appId}"]`)
        ?? (actor.sheet.element instanceof HTMLElement
            ? actor.sheet.element
            : actor.sheet.element?.[0]);
    if (!sheetEl) return;

    // Priorité au BOUTON de navigation (dans <nav class="tabs">) plutôt qu'au
    // panneau de contenu (class="tab"). Le panneau est invisible quand l'onglet
    // n'est pas actif → getBoundingClientRect() = 0,0,0,0 → bulle collée au bord.
    const navBtn =
        sheetEl.querySelector(`nav.tabs [data-tab="${tabName}"]`) ??
        sheetEl.querySelector(`.tabs:not(.tab-body) [data-tab="${tabName}"]`) ??
        sheetEl.querySelector(`[data-tab="${tabName}"]:not(.tab)`);

    if (navBtn) {
        navBtn.click();
        await new Promise(r => setTimeout(r, 450));
    }
}

// Raccourci : renvoie un beforeShow qui navigue vers l'onglet donné
const _toSheet = tab => () => _openActorSheetTab(tab);

// ================================================================
// NAVIGATION : ouvrir le prototype token → onglet Apparence
// ================================================================

async function _openProtoTokenAppearance() {
    const actor = game.user.character
        ?? (game.user.isGM ? game.actors.find(a => a.type === "character" && a.hasPlayerOwner) : null);
    if (!actor) return;

    // Idempotent : fenêtre déjà marquée → juste naviguer vers Apparence
    const existing = document.querySelector('.tuto-proto-token');
    if (existing && document.contains(existing)) {
        _clickAppearanceTab(existing);
        return;
    }

    // La config prototype token est déjà ouverte mais pas encore marquée ?
    // (ui.windows = registre de toutes les FormApplication v1 ouvertes)
    const already = Object.values(ui.windows ?? {}).find(app =>
        /token/i.test(app.constructor?.name ?? "") && app.element
    );
    if (already) {
        const el = already.element instanceof HTMLElement
            ? already.element : already.element?.[0];
        if (el) {
            el.classList.add('tuto-proto-token');
            _clickAppearanceTab(el);
            return;
        }
    }

    // ── Enregistrer le hook AVANT d'ouvrir pour ne pas rater le render ──
    // renderPrototypeTokenConfig(app, html, data) est le hook natif Foundry v13
    let hookResolve;
    const hookPromise = new Promise(r => { hookResolve = r; });
    const hookId = Hooks.once("renderPrototypeTokenConfig", app => hookResolve(app));

    // ── Ouvrir la fenêtre ────────────────────────────────────────────────
    let opened = false;

    // Méthode 1 : bouton dans la fiche acteur (si elle est déjà ouverte dans le DOM)
    const sheetEl = (() => {
        if (actor.sheet.element instanceof HTMLElement) return actor.sheet.element;
        if (actor.sheet.element?.[0] instanceof HTMLElement) return actor.sheet.element[0];
        const appId = actor.sheet.appId;
        if (appId) return document.querySelector(`[data-appid="${appId}"]`);
        const id = actor.sheet.id;
        if (id) return document.getElementById(id);
        return null;
    })();

    const tokenBtn = sheetEl?.querySelector(
        '[data-action="openTokenConfig"], [data-action="configureToken"]'
    ) ?? [...(sheetEl?.querySelectorAll('[data-action]') ?? [])].find(b =>
        /token/i.test(b.dataset.action ?? "")
    );
    if (tokenBtn) { tokenBtn.click(); opened = true; }

    // Méthode 2 : API directe Foundry
    if (!opened) {
        try {
            const Cls = globalThis.PrototypeTokenConfig ?? globalThis.TokenConfig;
            if (Cls) { new Cls(actor.prototypeToken).render(true); opened = true; }
        } catch(e) { console.warn("[Tutoriel] PrototypeTokenConfig directe :", e); }
    }

    // Méthode 3 : ouvrir la fiche acteur puis cliquer le bouton
    if (!opened) {
        actor.sheet.render(true);
        await new Promise(r => setTimeout(r, 800));
        const sheetEl2 = actor.sheet.element instanceof HTMLElement
            ? actor.sheet.element
            : document.querySelector(`[data-appid="${actor.sheet.appId}"]`) ?? actor.sheet.element?.[0];
        const btn2 = sheetEl2?.querySelector('[data-action="openTokenConfig"], [data-action="configureToken"]')
            ?? [...(sheetEl2?.querySelectorAll('[data-action]') ?? [])].find(b =>
                /token/i.test(b.dataset.action ?? ""));
        if (btn2) { btn2.click(); opened = true; }
    }

    if (!opened) {
        Hooks.off("renderPrototypeTokenConfig", hookId);
        hookResolve(null);
        console.warn("[Tutoriel] _openProtoTokenAppearance : impossible d'ouvrir la config token.");
        return;
    }

    // ── Attendre le hook renderPrototypeTokenConfig (max 5 s) ───────────
    const tokenApp = await Promise.race([
        hookPromise,
        new Promise(r => setTimeout(() => r(null), 5000))
    ]);

    let tcEl = null;

    if (tokenApp?.element) {
        // Le hook a fourni l'app directement
        tcEl = tokenApp.element instanceof HTMLElement
            ? tokenApp.element
            : tokenApp.element?.[0] ?? null;
    }

    // Fallback si le hook n'a pas tiré dans le délai (config déjà ouverte avant le hook ?)
    if (!tcEl) {
        Hooks.off("renderPrototypeTokenConfig", hookId);
        const fallbackApp = Object.values(ui.windows ?? {}).find(app =>
            /token/i.test(app.constructor?.name ?? "") && app.element
        );
        if (fallbackApp) {
            tcEl = fallbackApp.element instanceof HTMLElement
                ? fallbackApp.element
                : fallbackApp.element?.[0] ?? null;
        }
    }

    if (!tcEl) {
        console.warn("[Tutoriel] _openProtoTokenAppearance : fenêtre introuvable après ouverture.");
        return;
    }

    tcEl.classList.add('tuto-proto-token');
    _clickAppearanceTab(tcEl);
}

function _clickAppearanceTab(el) {
    const btn = el.querySelector(
        'nav [data-tab="appearance"], button[data-tab="appearance"], a[data-tab="appearance"]'
    );
    if (btn) btn.click();
}

// ================================================================
// NAVIGATION : ouvrir l'onglet Chat dans la sidebar
// ================================================================

async function _openChatTab() {
    const btn = document.querySelector(
        '[data-action="changeSidebarTab"][data-tab="chat"], ' +
        'a[data-tab="chat"], ' +
        '#sidebar-tabs [data-tab="chat"], ' +
        '.tabs a[data-tab="chat"]'
    );
    btn?.click();
    await new Promise(r => setTimeout(r, 350));
}

// ================================================================
// NAVIGATION : ouvrir / activer le groupe WestMarch dans la barre
// ================================================================

// En Foundry v13 les outils d'un groupe ne sont dans le DOM que si ce groupe
// est actif. On clique le bouton de groupe WestMarch s'il n'est pas déjà actif.
async function _expandWestmarch() {
    const grp = document.querySelector("[data-control='westmarch']");
    if (!grp) return;
    // Considère le groupe comme actif si l'un de ses outils est déjà dans le DOM
    if (document.querySelector("[data-tool='tutoriel'],[data-tool='downtime'],[data-tool='carnetDate'],[data-tool='fakeWarning']")) return;
    grp.click();
    await new Promise(r => setTimeout(r, 350));
}

// ================================================================
// DÉFINITION DES ÉTAPES PAR FONCTIONNALITÉ
// ================================================================

const STEPS_BY_FEATURE = {

    // ---- Barre WestMarch ----
    barreWestmarch: [
        {
            target:   "#controls, #scene-controls, nav.scene-controls",
            title:    "La barre de contrôles",
            text:     "La barre latérale gauche contient les outils de la table. Le groupe <strong>WestMarch</strong>, propre à ce serveur, y ajoute des fonctions spéciales accessibles à tous.",
            textGM:   "La barre latérale gauche contient les outils de la table. Le groupe <strong>WestMarch</strong> regroupe vos outils de gestion : expéditions, temps morts, boutiques et plus.",
            position: "right"
        },
        {
            target:   "[data-control='westmarch'], [data-group='westmarch']",
            title:    "Groupe WestMarch",
            text:     "Cliquez ici pour déplier les outils WestMarch. Vous y trouverez le bouton tutoriel et les fonctions spéciales de ce serveur.",
            textGM:   "Cliquez ici pour déplier les outils WestMarch. En tant que GM, vous avez accès à des boutons supplémentaires : gestion des expéditions, temps morts, et faux message de maintenance.",
            position: "right"
        },
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='tutoriel']",
            title:      "Bouton Tutoriel",
            text:       "Ce bouton <i class='fas fa-circle-question'></i> relance ce tutoriel à tout moment. Accessible à <strong>tous les joueurs</strong>. Appuyez sur <kbd>Echap</kbd> pour fermer à tout moment.",
            position:   "right"
        },
    ],

    // ---- Bestiaire ----
    bestiary: [
        {
            beforeShow: _toSheet("bestiary"),
            target:     "nav.tabs [data-tab='bestiary'], .tabs .item[data-tab='bestiary']",
            title:      "Onglet Bestiaire",
            text:       "L'onglet <strong>Bestiaire</strong> liste les créatures que vous avez rencontrées. Les entrées sont ajoutées <strong>automatiquement</strong> quand vous croisez une créature sur une scène — vous n'avez rien à faire.",
            textGM:     "Le Bestiaire se remplit <strong>automatiquement</strong> : dès qu'un PJ entre en contact avec une créature sur une scène, une entrée est créée dans son Bestiaire. Vous pouvez aussi en ajouter manuellement via le bouton Ajouter sur la fiche du joueur.",
            position:   "bottom"
        },
        {
            target:   null,
            title:    "Consulter une entrée",
            text:     "Cliquez sur la flèche d'une entrée pour déplier les notes du GM sur cette créature.",
            textGM:   "Cliquez sur la flèche d'une entrée pour la déplier. Vous pouvez y renseigner la scène de première rencontre et ajouter des notes visibles par le joueur.",
            position: "center"
        },
        {
            beforeShow: _toSheet("bestiary"),
            target:     ".bst-delete",
            title:      "Retirer une entrée",
            text:       "L'icône <i class='fas fa-trash'></i> à droite d'une entrée retire définitivement cette créature de votre bestiaire. Une confirmation est demandée avant la suppression.",
            textGM:     "L'icône <i class='fas fa-trash'></i> retire la créature du bestiaire du joueur. Elle pourra être ré-ajoutée automatiquement si le joueur la recroise en scène.",
            position:   "left"
        },
    ],

    // ---- Relations ----
    relations: [
        {
            beforeShow: _toSheet("relations"),
            target:     "nav.tabs [data-tab='relations'], .tabs .item[data-tab='relations']",
            title:      "Onglet Relations",
            text:       "L'onglet <strong>Relations</strong> liste vos liens avec les PJ et PNJ. Les entrées sont ajoutées <strong>automatiquement</strong> quand vous croisez quelqu'un sur une scène. Vous pouvez aussi en ajouter manuellement via le bouton <strong>+</strong>.",
            textGM:     "Les Relations se remplissent <strong>automatiquement</strong> : dès qu'un PJ partage une scène avec un autre personnage, une entrée est créée dans ses Relations. Vous pouvez aussi en ajouter ou modifier depuis la fiche d'un joueur.",
            position:   "bottom"
        },
        {
            beforeShow: _toSheet("relations"),
            target:     ".tab[data-tab='relations']",
            title:      "Gérer ses relations",
            text:       "Chaque relation a un type (allié, ennemi, neutre…) et un espace de notes libre. Elle n'est visible que par vous et le GM.",
            textGM:     "Chaque relation a un type et un espace de notes. Elle est visible par le joueur et par vous. Vous pouvez modifier ou supprimer n'importe quelle entrée.",
            position:   "right"
        },
        {
            beforeShow: _toSheet("relations"),
            target:     ".rel-delete",
            title:      "Supprimer une relation",
            text:       "L'icône <i class='fas fa-trash'></i> à droite d'une relation la supprime. Elle pourra être recréée automatiquement si vous recroisez ce personnage en scène.",
            textGM:     "L'icône <i class='fas fa-trash'></i> supprime la relation du joueur. Elle sera recréée automatiquement si le joueur recroise ce personnage en scène.",
            position:   "left"
        },
        {
            beforeShow: _toSheet("relations"),
            target:     ".scwm-exclude-btn",
            title:      "Bloquer & retirer des listes",
            text:       "Deux boutons dans l'en-tête de la fiche : <i class='fas fa-ban'></i> <strong>bloque l'ajout automatique</strong> (Relations & Bestiaire) sans toucher aux listes existantes, et <i class='fas fa-users-slash'></i> <strong>retire ce personnage de chez tous les joueurs</strong>. Pratique pour les figurants ou les doublons.",
            textGM:     "Deux boutons dans l'en-tête : <i class='fas fa-ban'></i> <strong>bloque les ajouts automatiques</strong> futurs (cliquer à nouveau pour réactiver), et <i class='fas fa-users-slash'></i> <strong>retire immédiatement</strong> ce personnage des Relations et du Bestiaire de <strong>tous les joueurs</strong> (avec confirmation). Les deux sont indépendants et s'appliquent à n'importe quelle fiche PJ ou PNJ.",
            position:   "bottom"
        },
    ],

    // ---- Carnet & Expéditions ----
    carnet: [
        // ── Vue d'ensemble ───────────────────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     "nav.tabs [data-tab='carnet-journal'], .tabs .item[data-tab='carnet-journal']",
            title:      "Onglet Carnet",
            text:       "L'onglet <strong>Carnet</strong> est votre journal de bord personnel. Il contient des <strong>notes libres</strong> que vous pouvez organiser, réordonner et formater à votre guise. Personne d'autre que vous (et le GM) ne peut les lire.",
            textGM:     "L'onglet <strong>Carnet</strong> est le journal de bord du joueur. En tant que GM, vous pouvez consulter et modifier les notes de n'importe quel personnage. Les notes sont privées : un joueur ne voit que les siennes.",
            position:   "bottom"
        },
        // ── Ajouter une note ─────────────────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-add-note",
            title:      "Ajouter une note",
            text:       "Le bouton <strong>+ Note</strong> crée une nouvelle note vide. Donnez-lui un titre en cliquant directement dessus, puis cliquez <strong>Modifier</strong> pour rédiger son contenu.",
            textGM:     "Le bouton <strong>+ Note</strong> crée une note sur la fiche du joueur. Vous pouvez en ajouter autant que vous voulez, y compris pour y coller des résumés de session ou des informations secrètes.",
            position:   "bottom"
        },
        // ── Sections ─────────────────────────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-add-section",
            title:      "Organiser en sections",
            text:       "Le bouton <strong>Section</strong> insère un séparateur nommé entre vos notes. Utilisez-le pour regrouper vos notes par thème (par ex. <em>Quêtes</em>, <em>PNJ rencontrés</em>, <em>Secrets</em>…). Cliquez le chevron d'une section pour la replier et masquer toutes ses notes.",
            textGM:     "Les <strong>sections</strong> sont des séparateurs que le joueur (ou vous) peut créer pour organiser ses notes. Replier une section masque toutes les notes qu'elle contient jusqu'à la section suivante.",
            position:   "bottom"
        },
        // ── Réordonner par drag & drop ───────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-drag-handle",
            title:      "Réordonner les notes",
            text:       "La <strong>poignée <i class='fas fa-grip-vertical'></i></strong> à gauche de chaque note ou section permet de la faire glisser pour changer son ordre. Attrapez-la et déposez la note à l'endroit souhaité — la ligne dorée indique où elle va s'insérer.",
            textGM:     "La <strong>poignée <i class='fas fa-grip-vertical'></i></strong> à gauche permet de déplacer les notes et les sections par glisser-déposer. L'ordre est sauvegardé automatiquement sur la fiche du joueur.",
            position:   "right"
        },
        // ── Replier une note ─────────────────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-toggle-note",
            title:      "Replier une note",
            text:       "Cliquez le <strong>chevron <i class='fas fa-chevron-down'></i></strong> à gauche du titre pour replier ou déplier une note individuellement. Pratique quand le carnet commence à s'allonger.",
            position:   "right"
        },
        // ── Éditeur de texte ─────────────────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-edit-note",
            title:      "Éditeur de note",
            text:       "Le bouton <strong>Modifier</strong> ouvre l'éditeur enrichi. La barre d'outils propose : <strong>Gras</strong>, <em>Italique</em>, Souligné, Barré, deux niveaux de <strong>titres</strong> (T1/T2), paragraphe normal, listes à puces et numérotées, et un sélecteur de taille de police. Les icônes s'illuminent en doré quand le format est actif sur votre sélection. Cliquez <strong>Sauvegarder</strong> ou appuyez sur <kbd>Entrée</kbd> — toutes vos frappes sont capturées en temps réel.",
            textGM:     "Le bouton <strong>Modifier</strong> ouvre l'éditeur enrichi. Il fonctionne comme un éditeur de texte classique avec barre d'outils (gras, italique, titres, listes, taille…). Les icônes s'allument quand le format est actif. Le contenu est sauvegardé à chaque frappe, pas seulement au clic sur Sauvegarder.",
            position:   "top"
        },
        // ── Lier à une expédition ────────────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-link-exp",
            title:      "Lier une note à une expédition",
            text:       "Le lien <i class='fas fa-link'></i> <strong>Lier</strong> associe une note à une expédition précise. Une fois liée, le nom de l'expédition apparaît dans la note, et un lien <i class='fas fa-calendar-alt'></i> permet de sauter directement à l'expédition dans l'onglet Expéditions. Pour délier, cliquez <i class='fas fa-unlink'></i>.",
            position:   "left"
        },
        // ── Onglet Expéditions ───────────────────────────────────
        {
            beforeShow: _toSheet("carnet-downtime"),
            target:     "nav.tabs [data-tab='carnet-downtime'], .tabs .item[data-tab='carnet-downtime']",
            title:      "Onglet Expéditions",
            text:       "L'onglet <strong>Expéditions</strong> liste toutes vos sessions de jeu avec leur date de début, de fin et leur durée en jours calculée automatiquement. Cliquez sur le nom d'une expédition pour naviguer vers les notes qui lui sont liées dans le Carnet.",
            textGM:     "L'onglet <strong>Expéditions</strong> liste les sessions avec dates et durée. Les dates sont enregistrées via le bouton <i class='fas fa-calendar-plus'></i> dans la barre WestMarch. Depuis ici vous pouvez aussi renommer une expédition ou la supprimer.",
            position:   "bottom"
        },
        // ── Bouton GM Date Expédition ────────────────────────────
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='carnetDate']",
            title:      "Bouton Date Expédition",
            text:       "Ce bouton enregistre la <strong>date de début d'une nouvelle expédition</strong> pour toute la party en un seul clic, en utilisant la date du calendrier du monde. Recliquez-le en fin de session pour enregistrer la <strong>date de fin</strong> et clôturer l'expédition.",
            position:   "right",
            gmOnly:     true
        },
    ],

    // ---- Boutiques ----
    boutiques: [
        {
            target:   null,
            title:    "Boutiques — Afficher aux joueurs",
            text:     "Les boutiques fonctionnent via <strong>Monk's Enhanced Journal</strong>. Ouvrez un journal de type Boutique, ajoutez vos articles, puis cliquez <strong>Afficher aux joueurs</strong> pour ouvrir la boutique à votre groupe. Les joueurs peuvent y acheter directement, même sans accès à la fiche de la party.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "Réapprovisionnement automatique",
            text:     "Quand un article tombe à 0, il se remet à 1 automatiquement après un délai. Les délais par rareté (Commun, Peu commun, Rare, Très rare, Légendaire) sont configurables dans les <strong>paramètres du module Toolkit</strong>.",
            position: "center",
            gmOnly:   true
        },
    ],

    // ---- Temps morts ----
    tempsMorts: [
        // ── Bouton sablier sur la fiche (joueurs) ────────────────
        {
            beforeShow: async () => {
                const actor = game.user.character;
                if (!actor) return;
                actor.sheet.render(true);
                await new Promise(r => setTimeout(r, 600));
            },
            target:     ".westmarch-tm-declare",
            title:      "Le bouton Temps mort",
            text:       "Le sablier <i class='fas fa-hourglass-half'></i> dans l'en-tête de votre fiche indique l'état de votre temps mort entre deux sessions. <span style='color:#888'>Gris</span> = rien déclaré. <span style='color:#e67e22'>Orange</span> = activité ajoutée mais pas encore soumise. <span style='color:#2ecc71'>Vert</span> = déclaration envoyée au GM. Cliquez-le pour ouvrir le formulaire.",
            position:   "bottom",
            playerOnly: true
        },
        // ── Ce qu'il y a dans la fenêtre (joueurs) ───────────────
        {
            beforeShow: async () => {
                const actor = game.user.character;
                if (!actor) return;
                actor.sheet.render(true);
                await new Promise(r => setTimeout(r, 400));
            },
            target:     null,
            title:      "Déclarer une activité",
            text:       "La fenêtre se divise en deux blocs :<br><br><strong>Gain de compétence</strong> — choisissez une compétence ou maîtrise dans la liste, entrez les dates de début et fin de votre temps mort. Le nombre de jours et le bonus sont calculés automatiquement.<br><br><strong>Artisanat</strong> — choisissez le type d'objet à fabriquer (arme, armure, parchemin…), sa rareté, son prix de base et les dates. Le coût en po et la progression sont calculés à la volée.<br><br>Cliquez <strong>Ajouter au panier</strong> pour chaque activité, puis <strong>Déclarer</strong> pour envoyer au GM. Vous pouvez combiner plusieurs activités dans une même déclaration.",
            position:   "center",
            playerOnly: true
        },
        // ── Après la déclaration (joueurs) ────────────────────────
        {
            beforeShow: async () => {
                const actor = game.user.character;
                if (!actor) return;
                actor.sheet.render(true);
                await new Promise(r => setTimeout(r, 400));
            },
            target:     ".westmarch-tm-declare",
            title:      "Après la déclaration",
            text:       "Une fois déclaré, le sablier passe au <span style='color:#2ecc71'>vert</span> et affiche un résumé de vos activités au survol. Le GM sera notifié et pourra valider lors de la prochaine session. Si vous devez modifier votre déclaration, rouvrez simplement la fenêtre — elle conserve votre saisie.",
            position:   "bottom",
            playerOnly: true
        },
        // ── Valider (GM) ──────────────────────────────────────────
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='downtime']",
            title:      "Valider les temps morts (GM)",
            text:       "Ce bouton ouvre la liste de toutes les déclarations reçues. Pour chaque joueur, vous voyez ses activités, les jours travaillés et les gains calculés. Cliquez <strong>Valider</strong> pour appliquer les bonus directement sur la fiche (XP de compétence, progression de craft…). Vous pouvez aussi voir les joueurs sans déclaration via la case en bas.",
            position:   "right",
            gmOnly:     true
        },
    ],

    // ---- Apparence des tokens ----
    apparenceTokens: [
        // ── Portrait HUD ─────────────────────────────────────────
        {
            target:   null,
            title:    "Voir le portrait",
            text:     "<strong>Clic droit</strong> sur un token → HUD → bouton portrait <i class='fas fa-image'></i> : affiche en grand l'image de la fiche du personnage.",
            position: "center"
        },
        // ── Accéder au Prototype Token ────────────────────────────
        {
            beforeShow: async () => {
                const actor = game.user.character
                    ?? (game.user.isGM ? game.actors.find(a => a.type === "character" && a.hasPlayerOwner) : null);
                if (!actor) return;
                actor.sheet.render(true);
                await new Promise(r => setTimeout(r, 600));
            },
            target:   '[data-action="openTokenConfig"]',
            title:    "Ouvrir le Prototype Token",
            text:     "Ce bouton dans l'en-tête de la fiche ouvre la configuration du <strong>Prototype Token</strong> — le token tel qu'il apparaît par défaut sur la carte. L'onglet <strong>Apparence</strong> donne accès à deux fonctions avancées : le <em>Cycle d'apparences</em> et le <em>Wild Shape / Polymorph</em>. Cliquez <strong>Suivant</strong> pour l'ouvrir automatiquement.",
            position: "bottom"
        },
        // ── Cycle d'apparences (prototype token → Apparence) ─────
        {
            beforeShow: _openProtoTokenAppearance,
            target:     ".tuto-proto-token",
            title:      "Cycle d'apparences",
            text:       "La fenêtre ouverte est le <strong>Prototype Token</strong>, onglet <strong>Apparence</strong>. La section <strong>Cycle d'apparences</strong> permet d'ajouter plusieurs images alternatives pour le token. En jeu, le bouton <i class='fas fa-images'></i> dans le HUD (clic droit sur le token) bascule entre ces images — utile pour les tenues, les états visuels ou les formes mineures.",
            position:   "left"
        },
        // ── Wild Shape / Polymorph (même onglet Apparence) ───────
        {
            beforeShow: _openProtoTokenAppearance,
            target:     ".tuto-proto-token",
            title:      "Wild Shape / Polymorph",
            text:       "La section <strong>Wild Shape / Polymorph</strong> du même onglet configure des formes de transformation complètes. Le bouton <i class='fas fa-dragon'></i> dans le HUD (clic droit sur le token) applique la transformation en un clic — et la rétablit en re-cliquant. Accessible au GM et aux propriétaires du token.",
            position:   "left"
        },
    ],

    // ---- Outils GM ----
    outilsGm: [
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='fakeWarning']",
            title:      "Faux message de maintenance",
            text:       "Ce bouton <i class='fas fa-triangle-exclamation'></i> envoie une fausse notification jaune à un joueur précis — pour lui faire croire qu'un problème technique a été résolu.",
            position:   "right",
            gmOnly:     true
        },
        {
            beforeShow: _openChatTab,
            target:     "[data-wm-action='clearParty']",
            title:      "Vider les messages de ma party",
            text:       "Ce bouton <i class='fas fa-users-slash'></i> supprime uniquement les messages du chat dont l'auteur appartient à <strong>votre party</strong>. Les messages des autres GMs et de leurs joueurs ne sont pas touchés. Une confirmation est demandée avant la suppression.",
            position:   "top",
            gmOnly:     true
        },
        {
            beforeShow: _openChatTab,
            target:     "[data-wm-action='importParty']",
            title:      "Importer des messages de chat",
            text:       "Ce bouton <i class='fas fa-file-import'></i> permet de réimporter un export de chat Foundry (<code>.txt</code>) ou JSON. Les messages sont recréés dans le chat en conservant leur timestamp d'origine — ils apparaîtront dans le bon ordre chronologique. Pratique pour restaurer un historique après un clear accidentel.",
            position:   "top",
            gmOnly:     true
        },
        {
            target:   null,
            title:    "Protection TGCM",
            text:     "Le bouton <i class='fas fa-shield-halved'></i> dans le HUD d'un token (GM uniquement) le protège de la mort. Un token TGCM ne peut jamais tomber à 0 PV — tout dégât fatal le laisse à 1 PV.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "Blocage XP et Level Up",
            text:     "Activez le <strong>blocage XP</strong> dans les paramètres de <em>Serveur</em> pour empêcher les joueurs de modifier leur XP ou monter de niveau eux-mêmes. Seul le GM peut le faire.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "Logs Discord",
            text:     "Configurez des URLs <strong>webhook</strong> dans les paramètres de <em>Serveur</em> pour recevoir des notifications automatiques sur Discord : modifications d'objets, changements de date de jeu, et résultats des temps morts.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "Exporter un personnage",
            text:     "Faites un <strong>clic droit</strong> sur n'importe quel acteur dans la sidebar et choisissez <strong>Exporter</strong>. Une fenêtre vous propose deux formats : <br><br><i class='fas fa-layer-group'></i> <strong>Fiche actuelle</strong> — export complet avec toutes les données (expéditions, relations, bestiaire, flags modules). À réimporter uniquement sur un serveur avec les mêmes modules.<br><br><i class='fas fa-dice-d20'></i> <strong>Fiche originale dnd5e</strong> — réinitialise la fiche au format dnd5e standard et supprime toutes les données propres au serveur. Compatible partout.",
            position: "center",
            gmOnly:   true
        },
    ],
};

// ================================================================
// API PUBLIQUE
// ================================================================

/**
 * Lance le tutoriel.
 * @param {string[]|null} selectedSections  Sections à inclure, ou null pour les settings.
 */
export function startTutorial(selectedSections = null) {
    _steps = [];
    for (const [section, settingKey] of Object.entries(SETTING_KEYS)) {
        // Filtrer les sections dont le module requis n'est pas actif
        if (!isSectionAvailable(section)) continue;

        const include = selectedSections !== null
            ? selectedSections.includes(section)
            : game.settings.get(MODULE, settingKey);
        if (!include) continue;

        const sectionSteps = (STEPS_BY_FEATURE[section] ?? []).filter(s => {
            if (s.gmOnly     && !game.user.isGM) return false;
            if (s.playerOnly &&  game.user.isGM) return false;
            return true;
        });
        _steps.push(...sectionSteps.map(st => ({ ...st, _section: section })));
    }

    if (!_steps.length) {
        ui.notifications.warn("[Tutoriel] Aucun contenu activé. Activez des fonctionnalités dans les paramètres du tutoriel.");
        return;
    }

    _current = 0;
    _buildWrap();
    _showStep(0);
}

export function closeTutorial() {
    if (_escHandler) {
        document.removeEventListener("keydown", _escHandler);
        _escHandler = null;
    }
    _wrapEl?.remove();
    _wrapEl = null;
}

// ================================================================
// CONSTRUCTION DU WRAPPER
// ================================================================

function _buildWrap() {
    closeTutorial();
    _wrapEl = document.createElement("div");
    _wrapEl.id = "tuto-wrap";
    _wrapEl.style.cssText = "position:fixed;inset:0;z-index:9900;pointer-events:none;";
    document.body.appendChild(_wrapEl);

    // Fermeture via Echap
    _escHandler = e => { if (e.key === "Escape") closeTutorial(); };
    document.addEventListener("keydown", _escHandler);
}

// ================================================================
// AFFICHAGE D'UNE ÉTAPE (async pour supporter beforeShow)
// ================================================================

// Sections présentes dans _steps, dans l'ordre d'apparition.
function _orderedSections() {
    const seen = [];
    for (const st of _steps) {
        if (st._section != null && !seen.includes(st._section)) seen.push(st._section);
    }
    return seen;
}
function _sectionFirstIndex(section) {
    return _steps.findIndex(st => st._section === section);
}

async function _showStep(idx) {
    if (!_wrapEl) return;
    const step = _steps[idx];
    if (!step) return;

    // Navigation préalable (ouvrir fiche/onglet si nécessaire)
    if (step.beforeShow) {
        await step.beforeShow();
    }
    // Le tutoriel a peut-être été fermé pendant l'attente du beforeShow
    if (!_wrapEl) return;

    _wrapEl.innerHTML = "";

    // Texte spécifique GM si défini
    const text = (step.textGM && game.user.isGM) ? step.textGM : step.text;

    const targetEl = step.target ? document.querySelector(step.target) : null;

    // ---- SPOTLIGHT : 4 panneaux autour de la cible, ou plein écran ----
    if (targetEl) {
        const r   = targetEl.getBoundingClientRect();
        const pad = 7;
        const T   = Math.max(0, r.top    - pad);
        const B   = Math.min(window.innerHeight, r.bottom + pad);
        const L   = Math.max(0, r.left   - pad);
        const R   = Math.min(window.innerWidth,  r.right  + pad);

        const panelStyles = [
            `top:0;left:0;right:0;height:${T}px`,
            `top:${B}px;left:0;right:0;bottom:0`,
            `top:${T}px;left:0;width:${L}px;height:${B - T}px`,
            `top:${T}px;left:${R}px;right:0;height:${B - T}px`,
        ];
        for (const s of panelStyles) {
            const p = _mkPanel(s);
            p.addEventListener("click", closeTutorial);
            _wrapEl.appendChild(p);
        }

        const ring = document.createElement("div");
        ring.className = "tuto-ring";
        ring.style.cssText = `
            position:fixed;pointer-events:none;z-index:9902;
            top:${T}px;left:${L}px;
            width:${R - L}px;height:${B - T}px;
            border-width:2px;border-style:solid;
        `;
        _wrapEl.appendChild(ring);
    } else {
        const p = _mkPanel("inset:0");
        p.style.background = "rgba(0,0,0,0.6)";
        p.addEventListener("click", (e) => { if (e.target === p) closeTutorial(); });
        _wrapEl.appendChild(p);
    }

    // ---- BULLE ----
    const isFirst = idx === 0;
    const isLast  = idx === _steps.length - 1;

    // ---- Navigation par CATÉGORIE (coins de la bulle) ----
    const curSection   = step._section;
    const ordered      = _orderedSections();
    const secIdx       = ordered.indexOf(curSection);
    const prevSection  = secIdx > 0 ? ordered[secIdx - 1] : null;
    const nextSection  = (secIdx >= 0 && secIdx < ordered.length - 1) ? ordered[secIdx + 1] : null;
    const firstOfCur   = _sectionFirstIndex(curSection);
    const atSectionStart = idx <= firstOfCur;
    const canGoPrevCat = !atSectionStart || !!prevSection;   // début de catégorie OU catégorie précédente
    const catPrevDis   = canGoPrevCat ? "" : " disabled";
    const catNextDis   = nextSection ? "" : " disabled";
    const catPrevTip   = !atSectionStart ? "Revenir au début de la catégorie"
                         : prevSection ? `Catégorie précédente : ${SECTION_LABELS[prevSection] ?? prevSection}`
                         : "Aucune catégorie précédente";
    const catNextTip   = nextSection ? `Catégorie suivante : ${SECTION_LABELS[nextSection] ?? nextSection}`
                         : "Dernière catégorie";

    const bubble = document.createElement("div");
    bubble.id = "tuto-bubble";
    bubble.innerHTML = `
        <div class="tuto-bubble-header">
            <button class="tuto-cat-btn tuto-cat-prev" title="${catPrevTip}"${catPrevDis}>
                <i class="fas fa-angle-left"></i> Retour
            </button>
            <span class="tuto-step-counter">
                <span class="tuto-step-dots">${_renderDots(idx, _steps.length)}</span>
                ${idx + 1} / ${_steps.length}
            </span>
            <button class="tuto-cat-btn tuto-cat-next" title="${catNextTip}"${catNextDis}>
                Suivant <i class="fas fa-angle-right"></i>
            </button>
            <button class="tuto-close-btn" title="Fermer le tutoriel (Echap)">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="tuto-bubble-body">
            <h3 class="tuto-bubble-title">${step.title}</h3>
            <p class="tuto-bubble-text">${text}</p>
        </div>
        <div class="tuto-bubble-footer">
            <button class="tuto-btn tuto-prev"${isFirst ? " disabled" : ""}>
                <i class="fas fa-chevron-left"></i> Précédent
            </button>
            <button class="tuto-btn tuto-next primary">
                ${isLast
                    ? '<i class="fas fa-check"></i> Terminer'
                    : 'Suivant <i class="fas fa-chevron-right"></i>'}
            </button>
        </div>`;

    _wrapEl.appendChild(bubble);

    bubble.querySelector(".tuto-close-btn").addEventListener("click", closeTutorial);
    bubble.querySelector(".tuto-prev").addEventListener("click", () => {
        if (_current > 0) _showStep(--_current);
    });
    bubble.querySelector(".tuto-next").addEventListener("click", () => {
        if (_current < _steps.length - 1) _showStep(++_current);
        else closeTutorial();
    });

    bubble.querySelector(".tuto-cat-prev")?.addEventListener("click", () => {
        if (!atSectionStart)      _current = firstOfCur;                       // début de la catégorie courante
        else if (prevSection)     _current = _sectionFirstIndex(prevSection);  // catégorie précédente
        else return;
        _showStep(_current);
    });
    bubble.querySelector(".tuto-cat-next")?.addEventListener("click", () => {
        if (!nextSection) return;
        _current = _sectionFirstIndex(nextSection);
        _showStep(_current);
    });

    _positionBubble(bubble, targetEl, step.position ?? "center");
}

// ================================================================
// HELPERS DOM
// ================================================================

function _mkPanel(styleStr) {
    const d = document.createElement("div");
    d.className = "tuto-panel";
    d.style.cssText = `position:fixed;pointer-events:auto;background:rgba(0,0,0,0.58);${styleStr}`;
    return d;
}

function _renderDots(current, total) {
    const MAX = 12;
    if (total <= MAX) {
        // Tous les points tiennent — on les affiche tous
        return Array.from({ length: total }, (_, i) =>
            `<span class="tuto-dot${i === current ? " active" : ""}"></span>`
        ).join("");
    }
    // Fenêtre glissante de MAX points centrée sur l'étape courante
    const half  = Math.floor(MAX / 2);
    const start = clamp(current - half, 0, total - MAX);
    const end   = start + MAX - 1;
    let html = "";
    // Point tronqué à gauche = fondu
    if (start > 0) html += `<span class="tuto-dot dim"></span>`;
    for (let i = start; i <= end; i++) {
        const isActive = i === current;
        const isDim    = (i === start && start > 0) || (i === end && end < total - 1);
        html += `<span class="tuto-dot${isActive ? " active" : ""}${isDim ? " dim" : ""}"></span>`;
    }
    // Point tronqué à droite = fondu
    if (end < total - 1) html += `<span class="tuto-dot dim"></span>`;
    return html;
}

// ================================================================
// POSITIONNEMENT DE LA BULLE
// ================================================================

function _positionBubble(bubble, targetEl, position) {
    bubble.style.cssText += ";position:fixed;pointer-events:auto;z-index:9910;";

    if (!targetEl || position === "center") {
        bubble.style.top       = "50%";
        bubble.style.left      = "50%";
        bubble.style.transform = "translate(-50%,-50%)";
        return;
    }

    requestAnimationFrame(() => {
        const rT   = targetEl.getBoundingClientRect();
        const rB   = bubble.getBoundingClientRect();
        const BW   = rB.width  || 340;
        const BH   = rB.height || 200;
        const M    = 16;
        const ARR  = 14;

        let dir = position;
        if (dir === "right"  && rT.right  + BW + M + ARR > window.innerWidth)  dir = "left";
        if (dir === "left"   && rT.left   - BW - M - ARR < 0)                  dir = "right";
        if (dir === "bottom" && rT.bottom + BH + M + ARR > window.innerHeight) dir = "top";
        if (dir === "top"    && rT.top    - BH - M - ARR < 0)                  dir = "bottom";

        bubble.setAttribute("data-arrow", dir);

        const cx = rT.left + rT.width  / 2;
        const cy = rT.top  + rT.height / 2;
        let top, left;

        switch (dir) {
            case "right":
                left = rT.right + ARR + M;
                top  = clamp(cy - BH / 2, M, window.innerHeight - BH - M);
                break;
            case "left":
                left = rT.left - BW - ARR - M;
                top  = clamp(cy - BH / 2, M, window.innerHeight - BH - M);
                break;
            case "bottom":
                top  = rT.bottom + ARR + M;
                left = clamp(cx - BW / 2, M, window.innerWidth - BW - M);
                break;
            case "top":
                top  = rT.top - BH - ARR - M;
                left = clamp(cx - BW / 2, M, window.innerWidth - BW - M);
                break;
        }

        bubble.style.top       = `${top}px`;
        bubble.style.left      = `${left}px`;
        bubble.style.transform = "";

        // Ajuste la position de la flèche pour qu'elle pointe sur le centre
        // de la cible même si la bulle a été clampée (ex: cible en haut de l'écran)
        if (dir === "right" || dir === "left") {
            const pct = clamp((cy - top) / BH * 100, 8, 92);
            bubble.style.setProperty("--tuto-arrow-v", `${pct}%`);
        } else {
            const pct = clamp((cx - left) / BW * 100, 8, 92);
            bubble.style.setProperty("--tuto-arrow-h", `${pct}%`);
        }
    });
}

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
