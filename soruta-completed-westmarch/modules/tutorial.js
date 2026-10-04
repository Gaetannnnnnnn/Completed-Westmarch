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
import { getTutorialActor, grantTutorialAccess, revokeTutorialAccess } from "./demoactor.js";
import { openCasier } from "./casier.js";
import { openSceneCues } from "./sceneaudio.js";
import { openPlayerHub } from "./charvalidation.js";
import { openA11yDialog } from "./accessibility.js";
import { openConfigHub } from "./settings.js";
const MODULE = MOD;

// Ouvre le gestionnaire de cues audio (étapes GM).
async function _openCues() {
    try { openSceneCues(); } catch {}
    await new Promise(r => setTimeout(r, 400));
}
// Ouvre la fenêtre « Mes personnages » (étapes joueur).
async function _openMonPerso() {
    try { openPlayerHub(); } catch {}
    await new Promise(r => setTimeout(r, 350));
}

// Ouvre le Casier et bascule sur l'onglet voulu (pour les étapes du tutoriel).
async function _openCasier(tab) {
    openCasier();
    await new Promise(r => setTimeout(r, 400));
    if (tab) {
        document.querySelector(`.scwm-casier-tab[data-tab="${tab}"]`)?.click();
        await new Promise(r => setTimeout(r, 250));
    }
}

// Acteur utilisé par le tutoriel : en priorité la fiche démo dédiée (toujours
// la même), sinon le personnage du joueur, sinon un PJ existant pour un GM.
function _tutorialActor() {
    return getTutorialActor()
        ?? game.user.character
        ?? (game.user.isGM ? game.actors.find(a => a.type === "character" && a.hasPlayerOwner) : null);
}

// ================================================================
// SECTIONS : labels, icônes et clés de settings (par fonctionnalité)
// ================================================================

export const SECTION_LABELS = {
    accessibilite:   "Accessibilité",
    barreWestmarch:  "Barre WestMarch",
    tourFiche:       "Tour de la fiche",
    noteGm:          "Note GM (privé)",
    monPerso:        "Mes personnages",
    bestiary:        "Bestiaire",
    relations:       "Relations",
    carnet:          "Carnet & Expéditions",
    casier:          "Casier du MJ",
    carteExpedition: "Carte des expéditions",
    cues:            "Cues audio (mise en scène)",
    boutiques:       "Boutiques (MEJ)",
    tempsMorts:      "Temps morts",
    apparenceTokens: "Apparence des tokens",
    outilsGm:        "Outils GM",
    echange:         "Échange entre joueurs",
    transformation:  "Transformations",
    compagnons:      "Compagnons évolutifs",
    pantheon:        "Panthéons",
};

export const SECTION_ICONS = {
    accessibilite:   "fa-universal-access",
    barreWestmarch:  "fa-compass",
    tourFiche:       "fa-id-card",
    noteGm:          "fa-user-secret",
    monPerso:        "fa-id-badge",
    bestiary:        "fa-dragon",
    relations:       "fa-users",
    carnet:          "fa-book-open",
    casier:          "fa-box-archive",
    carteExpedition: "fa-map-location-dot",
    cues:            "fa-clapperboard",
    boutiques:       "fa-store",
    tempsMorts:      "fa-hourglass-half",
    apparenceTokens: "fa-masks-theater",
    outilsGm:        "fa-shield-halved",
    echange:         "fa-right-left",
    transformation:  "fa-paw",
    compagnons:      "fa-dna",
    pantheon:        "fa-landmark",
};

// L'ordre des clés = ordre de passage du tutoriel.
export const SETTING_KEYS = {
    barreWestmarch:  "tutoBarreWestmarch",
    tourFiche:       "tutoTourFiche",
    monPerso:        "tutoMonPerso",
    bestiary:        "tutoBestiary",
    relations:       "tutoRelations",
    carnet:          "tutoCarnet",
    noteGm:          "tutoNoteGm",
    casier:          "tutoCasier",
    carteExpedition: "tutoCarteExpedition",
    cues:            "tutoCues",
    boutiques:       "tutoBoutiques",
    tempsMorts:      "tutoTempsMorts",
    apparenceTokens: "tutoApparenceTokens",
    outilsGm:        "tutoOutilsGm",
    echange:         "tutoEchange",
    transformation:  "tutoTransformation",
    compagnons:      "tutoCompagnons",
    pantheon:        "tutoPantheon",
};

// ================================================================
// MODULES REQUIS PAR SECTION
// [] = toujours disponible  |  plusieurs IDs = au moins un doit être actif
// ================================================================

// Module fusionné : les fonctionnalités ne sont plus des modules séparés.
// section → clé de setting d'activation (null = toujours disponible).
export const SECTION_FEATURE_SETTING = {
    barreWestmarch:  null,               // le tutoriel crée lui-même le groupe
    tourFiche:       null,               // tour générique de la fiche dnd5e
    noteGm:          "enableGmNotes",
    monPerso:        "enableCharValidation",
    bestiary:        "bestiaryEnabled",
    relations:       "relationsEnabled",
    carnet:          "carnetEnabled",
    casier:          null,               // outil MJ intégré (gmOnly)
    carteExpedition: "enableExpeditionMap",
    cues:            "enableSceneCues",
    boutiques:       null,               // dépendance externe (MEJ) gérée à part
    tempsMorts:      null,               // fonctionnalité intégrée
    apparenceTokens: null,               // fonctionnalité intégrée
    outilsGm:        null,               // fonctionnalité intégrée (gmOnly géré à part)
    echange:         "enableTrade",
    transformation:  "enablePolymorph",
    compagnons:      "enableCompanions",
    pantheon:        "createPantheonFolder",
};

// Sections réservées au GM (toutes leurs étapes sont gmOnly)
export const SECTION_GM_ONLY = new Set(["casier", "carteExpedition", "cues", "noteGm", "boutiques", "outilsGm", "compagnons"]);

// Sections réservées aux JOUEURS (étapes playerOnly) : cachées aux GM, pour qui
// elles seraient vides (déclaration de temps morts, gestion de ses personnages).
export const SECTION_PLAYER_ONLY = new Set(["monPerso", "tempsMorts"]);

// Sections « natives Foundry / dnd5e » (bases que quelqu'un qui connaît déjà
// Foundry n'a pas besoin de revoir) : sautées si l'utilisateur se dit expérimenté.
// On peut aussi marquer une étape isolée avec `native: true` (voir apparenceTokens).
export const SECTION_NATIVE = new Set(["tourFiche"]);

// Sections ESSENTIELLES (« à connaître pour jouer ici ») — mises en avant dans le
// menu ; le reste est rangé sous « Optionnel ». Le filtrage par rôle/activation
// (isSectionAvailable) s'applique ensuite : un joueur ne verra que ses essentiels.
export const SECTION_ESSENTIAL = new Set([
    "barreWestmarch",   // repérer les outils du serveur (tous)
    "monPerso",         // créer / gérer son personnage (joueur)
    "carnet",           // carnet & expéditions (tous)
    "tempsMorts",       // déclarer entre deux sessions (joueur)
    "casier",           // tableau de bord (MJ)
    "carteExpedition",  // brouillard des expéditions (MJ, si activé)
]);

/**
 * Retourne true si la section est disponible pour l'utilisateur courant :
 *   - la fonctionnalité correspondante est activée (ou intégrée)
 *   - "boutiques" nécessite le module externe Monk's Enhanced Journal
 *   - la section n'est pas GM-only si l'utilisateur est joueur
 */
export function isSectionAvailable(sectionKey) {
    if (SECTION_GM_ONLY.has(sectionKey) && !game.user?.isGM) return false;
    if (SECTION_PLAYER_ONLY.has(sectionKey) && game.user?.isGM) return false;
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
let _onComplete = null;   // callback appelé à la fin d'un parcours (retour au menu)

// ================================================================
// NAVIGATION : ouvrir la fiche PJ et naviguer vers un onglet
// ================================================================

async function _openActorSheetTab(tabName) {
    // Fiche démo dédiée en priorité (toujours la même pour le tutoriel).
    const actor = _tutorialActor();
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

// Ouvre le Carnet ET déplie la première note si elle est repliée : le bouton
// « Modifier » / « Lier » se trouve dans le CORPS de la note (masqué quand elle
// est repliée), donc sans ça le spotlight n'a rien à pointer et part en haut.
async function _openCarnetNoteExpanded() {
    await _openActorSheetTab("carnet-journal");
    await new Promise(r => setTimeout(r, 150));
    try {
        const el = _tutorialActor()?.sheet?.element;
        const root = (el instanceof HTMLElement ? el : el?.[0]) ?? document;
        const firstCard = root.querySelector(".carnet-note-card");
        const body = firstCard?.querySelector(".carnet-note-body");
        if (firstCard && body && getComputedStyle(body).display === "none") {
            firstCard.querySelector(".carnet-toggle-note")?.click();
            await new Promise(r => setTimeout(r, 200));
        }
    } catch {}
}

// ── Tour d'accessibilité : navigation Settings → config module → dialogue ──
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function _openSidebarSettingsTab() {
    try { ui.sidebar?.expand?.(); } catch {}
    try { ui.sidebar?.activateTab?.("settings"); } catch {}
    try { ui.sidebar?.changeTab?.("settings", "primary"); } catch {}
    try {
        document.querySelector('#sidebar [data-tab="settings"], #sidebar-tabs [data-tab="settings"], nav.tabs [data-tab="settings"], [data-action="tab"][data-tab="settings"]')?.click();
    } catch {}
    await _sleep(300);
}

// Ouvre la fenêtre de configuration des paramètres (« Game Settings ») et
// surligne le bouton « Accessibilité » du module.
async function _openModuleSettings() {
    try { game.settings.sheet?.render(true); } catch {}
    await _sleep(550);
    _highlightA11yMenu();
}

function _highlightA11yMenu() {
    document.querySelectorAll(".tuto-a11y-highlight").forEach(e => e.classList.remove("tuto-a11y-highlight"));
    // Le bouton du menu Accessibilité (registerMenu) porte data-key "<MOD>.menu-accessibility".
    let node = document.querySelector(`[data-key="${MODULE}.menu-accessibility"]`);
    if (!node) {
        // Repli : chercher par texte « Accessibilité » dans la fenêtre de config.
        node = [...document.querySelectorAll(".form-group, .settings-config .form-group, section .form-group")]
            .find(g => /accessibilit/i.test(g.textContent ?? ""));
    }
    const row = node?.closest?.(".form-group") ?? node;
    if (row) {
        row.classList.add("tuto-a11y-highlight");
        try { row.scrollIntoView({ block: "center", behavior: "instant" }); } catch {}
    }
}

// Ouvre le dialogue Accessibilité. NE PAS await openA11yDialog : il bloque
// (DialogV2.wait) jusqu'à la fermeture → on le lance et on attend le rendu DOM.
async function _openA11yTour() {
    try { if (!document.getElementById("scwm-a11y-form")) openA11yDialog(); } catch {}
    await _sleep(450);
}

// ── Panthéons : ouvrir l'onglet Journaux + surligner le dossier « Panthéons » ──
async function _openPantheonFolder() {
    _closeTradeDemo();
    try { ui.sidebar?.expand?.(); } catch {}
    try { ui.sidebar?.activateTab?.("journal"); } catch {}
    try { ui.sidebar?.changeTab?.("journal", "primary"); } catch {}
    try { document.querySelector('#sidebar [data-tab="journal"], #sidebar-tabs [data-tab="journal"], nav.tabs [data-tab="journal"], [data-action="tab"][data-tab="journal"]')?.click(); } catch {}
    await _sleep(300);
    try { ui.journal?.render?.(false); } catch {}
    await _sleep(250);
    document.querySelectorAll(".tuto-a11y-highlight").forEach(e => e.classList.remove("tuto-a11y-highlight"));
    const el = ui.journal?.element;
    const root = (el instanceof HTMLElement) ? el : (el?.[0] ?? document.getElementById("journal"));
    const folderLi = [...(root?.querySelectorAll("li.folder, .directory-item.folder") ?? [])]
        .find(li => /panth[eé]on/i.test(li.querySelector(".folder-name, header, .directory-item-name")?.textContent ?? li.textContent ?? ""));
    if (folderLi) {
        if (folderLi.classList.contains("collapsed")) folderLi.querySelector(":scope > header, :scope > .folder-header")?.click();
        folderLi.classList.add("tuto-a11y-highlight");
        try { folderLi.scrollIntoView({ block: "center", behavior: "instant" }); } catch {}
    }
}

// ── Échange : fenêtre FICTIVE de démonstration (pas un vrai échange) ──
function _closeTradeDemo() { document.getElementById("scwm-trade-demo")?.remove(); }
async function _openTradeDemo() {
    _closeTradeDemo();
    const el = document.createElement("div");
    el.id = "scwm-trade-demo";
    el.style.cssText = "position:fixed;top:13%;left:50%;transform:translateX(-50%);z-index:60;width:540px;max-width:92vw;"
        + "background:#1b1a17;border:1px solid #c9a227;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.6);color:#e8dcc0;font-size:13px;overflow:hidden;";
    el.innerHTML = `
        <div style="background:linear-gradient(180deg,rgba(201,162,39,.25),rgba(0,0,0,.2));padding:8px 12px;font-weight:700;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(201,162,39,.4);">
            <i class="fa-solid fa-right-left" style="color:#c9a227;"></i> Échange avec Alya (démonstration)
        </div>
        <div style="display:flex;gap:10px;padding:12px;">
            <div data-demo="mine" style="flex:1;border:1px solid rgba(201,162,39,.4);border-radius:6px;padding:8px;min-height:120px;">
                <div style="font-weight:700;margin-bottom:6px;color:#c9a227;">Votre offre</div>
                <div style="opacity:.8;">• Épée longue<br>• Potion de soin ×2</div>
            </div>
            <div data-demo="theirs" style="flex:1;border:1px solid rgba(154,123,30,.4);border-radius:6px;padding:8px;min-height:120px;">
                <div style="font-weight:700;margin-bottom:6px;color:#9ab;">Offre d'Alya</div>
                <div style="opacity:.8;">• Bouclier<br>• 25 po</div>
            </div>
        </div>
        <div data-demo="currency" style="display:flex;gap:10px;padding:0 12px 10px;align-items:center;">
            <span style="opacity:.8;">Monnaie à donner :</span>
            <span style="border:1px solid rgba(201,162,39,.4);border-radius:4px;padding:2px 8px;">PO <strong>10</strong></span>
            <span style="border:1px solid rgba(201,162,39,.4);border-radius:4px;padding:2px 8px;">PA <strong>0</strong></span>
            <span style="border:1px solid rgba(201,162,39,.4);border-radius:4px;padding:2px 8px;">PC <strong>0</strong></span>
        </div>
        <div data-demo="buttons" style="display:flex;gap:8px;padding:0 12px 12px;">
            <button type="button" style="flex:1;padding:6px;border-radius:5px;border:1px solid #6ec06e;background:rgba(110,192,110,.18);color:#bfeabf;font-weight:700;">✔ Confirmer mon offre</button>
            <button type="button" style="flex:0 0 auto;padding:6px 12px;border-radius:5px;border:1px solid #c0392b;background:rgba(192,57,43,.18);color:#f0b5ae;">Annuler</button>
        </div>`;
    document.body.appendChild(el);
    await _sleep(200);
}

// ── Transformations / Compagnons : ouvrir le Panneau de configuration ──
async function _openConfigHubTour() {
    _closeTradeDemo();
    try { ui.sidebar?.expand?.(); } catch {}
    try { openConfigHub(); } catch {}
    await _sleep(550);
}

// Ouvre la fiche démo sans changer d'onglet (pour pointer l'en-tête / la barre latérale).
async function _openSheet() {
    const actor = _tutorialActor();
    if (!actor) return;
    actor.sheet.render(true);
    await new Promise(r => setTimeout(r, 500));
}

// ================================================================
// NAVIGATION : ouvrir le prototype token → onglet Apparence
// ================================================================

async function _openProtoTokenAppearance() {
    const actor = _tutorialActor();
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

// Ouvre l'onglet Acteurs de la sidebar, déplie le dossier du perso démo et
// marque son badge de statut pour que le spotlight le pointe précisément.
// Racine DOM du répertoire des Acteurs, tolérante aux versions (v13/v14).
function _actorsRoot() {
    const el = ui.actors?.element;
    return (el instanceof HTMLElement) ? el : (el?.[0] ?? document.getElementById("actors"));
}

async function _showPcStatus() {
    // Déplier la sidebar et basculer sur l'onglet Acteurs — plusieurs méthodes
    // car l'API a changé (v13/v14) et la sidebar peut être repliée.
    try { ui.sidebar?.expand?.(); } catch {}
    try { ui.sidebar?.activateTab?.("actors"); } catch {}
    try { ui.sidebar?.changeTab?.("actors", "primary"); } catch {}
    // Repli ultime : clic direct sur le bouton d'onglet dans le DOM.
    try {
        document.querySelector('#sidebar [data-tab="actors"], #sidebar-tabs [data-tab="actors"], nav.tabs [data-tab="actors"], [data-action="tab"][data-tab="actors"]')?.click();
    } catch {}
    await new Promise(r => setTimeout(r, 300));

    const actor = _tutorialActor();

    // Déplier le dossier contenant le perso démo (le <li> n'existe pas si replié).
    try {
        const root = _actorsRoot();
        const fid = actor?.folder?.id ?? actor?.folder;
        if (fid && root) {
            const folderLi = root.querySelector(`li.folder[data-folder-id="${fid}"]`);
            if (folderLi && folderLi.classList.contains("collapsed")) {
                folderLi.querySelector(":scope > header, :scope > .folder-header")?.click();
                await new Promise(r => setTimeout(r, 200));
            }
        }
    } catch {}
    try { ui.actors?.render(false); } catch {}
    await new Promise(r => setTimeout(r, 450));

    // Marqueur temporaire sur le badge (cible du spotlight). Si le badge n'existe
    // pas (option PC status désactivée), on marque la LIGNE du perso à défaut,
    // pour que le spotlight pointe au moins le bon endroit.
    document.querySelectorAll(".tuto-status-highlight").forEach(e => e.classList.remove("tuto-status-highlight"));
    const root = _actorsRoot();
    if (actor && root) {
        const li = root.querySelector(
            `li.directory-item[data-entry-id="${actor.id}"], ` +
            `li.directory-item[data-document-id="${actor.id}"]`);
        const badge = li?.querySelector(".scwm-pc-status");
        (badge ?? li)?.classList.add("tuto-status-highlight");
        try { li?.scrollIntoView({ block: "center", behavior: "instant" }); } catch {}
    }
}

// ================================================================
// DÉFINITION DES ÉTAPES PAR FONCTIONNALITÉ
// ================================================================

const STEPS_BY_FEATURE = {

    // ---- Accessibilité (section obligatoire, en premier) ----
    accessibilite: [
        {
            beforeShow: async () => { try { ui.sidebar?.expand?.(); } catch {} await _sleep(200); },
            target:     '#sidebar [data-tab="settings"], #sidebar-tabs [data-tab="settings"], nav.tabs [data-tab="settings"], [data-action="tab"][data-tab="settings"]',
            title:      "D'abord : l'accessibilité",
            text:       "Avant tout, un point <strong>important</strong> : ce module propose des options d'accessibilité pour un confort de jeu adapté à chacun (daltonisme, contraste, avatars, auto-masquage…). <strong>Chaque personne règle les siennes</strong> sur son propre compte. On va les découvrir ensemble. Tout commence par l'onglet <strong>Réglages</strong> (l'engrenage) de la barre latérale.",
            position:   "left"
        },
        {
            beforeShow: _openSidebarSettingsTab,
            target:     '#settings button[data-action="configure"], button.configure-settings, [data-action="configure"], #settings .settings, #settings',
            title:      "Les Paramètres du jeu",
            text:       "Dans l'onglet Réglages, ouvre <strong>Configurer les paramètres</strong> (Game Settings) : c'est là que vivent tous les réglages, dont ceux de ce module.",
            position:   "left"
        },
        {
            beforeShow: _openModuleSettings,
            target:     '.tuto-a11y-highlight, .settings-config, #client-settings, .categories, section.window-content',
            title:      "Les réglages du module",
            text:       "Voici les réglages de <strong>Soruta — Completed Westmarch</strong>. Repère la ligne <strong>Accessibilité</strong> : son bouton <em>Ouvrir</em> donne accès à tes options personnelles. (Les réglages marqués ici sont surtout côté MJ ; l'accessibilité, elle, est pour tout le monde.)",
            position:   "right"
        },
        {
            beforeShow: _openA11yTour,
            target:     "#scwm-a11y-form",
            title:      "Tes options d'accessibilité",
            text:       "Cette fenêtre est <strong>personnelle à ton compte</strong> : elle n'affecte que ton affichage, pas celui des autres. Passons chaque option en revue.",
            position:   "left"
        },
        {
            beforeShow: _openA11yTour,
            target:     '[data-a11y-row="dalton"]',
            title:      "Mode daltonisme",
            text:       "Applique un <strong>filtre de correction des couleurs</strong> sur l'interface et la carte, pour mieux distinguer les teintes. Trois types : <strong>Protanopie</strong> (rouge), <strong>Deutéranopie</strong> (vert), <strong>Tritanopie</strong> (bleu). Choisis celui qui correspond à ta vision, ou « Aucun » pour des couleurs normales.",
            position:   "left"
        },
        {
            beforeShow: _openA11yTour,
            target:     '[data-a11y-row="contrast"]',
            title:      "Fort contraste",
            text:       "Renforce le <strong>contraste</strong> du texte, des bordures et des fonds de l'interface — utile en cas de basse vision ou d'écran peu lisible.",
            position:   "left"
        },
        {
            beforeShow: _openA11yTour,
            target:     '[data-a11y-row="contrastcol"]',
            title:      "Couleur des contours",
            text:       "En mode fort contraste, choisis la <strong>couleur des bordures</strong> et du contour de focus (jaune par défaut). Le lien <em>réinit.</em> remet la couleur d'origine.",
            position:   "left"
        },
        {
            beforeShow: _openA11yTour,
            target:     '[data-a11y-row="avatars"]',
            title:      "Avatars des joueurs",
            text:       "Affiche la <strong>miniature du portrait</strong> de chaque joueur à côté de son nom dans la liste des joueurs — plus facile à repérer d'un coup d'œil.",
            position:   "left"
        },
        {
            beforeShow: _openA11yTour,
            target:     '[data-a11y-row="autohide"]',
            title:      "Auto-masquage de l'interface",
            text:       "<strong>Estompe</strong> les contrôles, la navigation, les macros et la liste des joueurs tant que la souris ne les survole pas : l'écran reste épuré et tu te concentres sur la scène.",
            position:   "left"
        },
        {
            beforeShow: _openA11yTour,
            target:     '[data-a11y-row="compact"]',
            title:      "Contrôles de gauche compacts",
            text:       "<strong>Réduit la taille</strong> des icônes de la barre d'outils de gauche, pour gagner de la place à l'écran.",
            position:   "left"
        },
        {
            beforeShow: _openA11yTour,
            target:     '[data-a11y-row="chatcol"]',
            title:      "Couleur des cartes de chat",
            text:       "Choisis la <strong>couleur de fond</strong> de tes cartes de chat (blanc crème par défaut) ; le texte s'adapte automatiquement pour rester lisible. C'est un réglage personnel. <strong>N'oublie pas d'Enregistrer</strong> en bas de la fenêtre pour appliquer tes choix !",
            position:   "left"
        }
    ],

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
            text:       "Ce bouton <i class='fa-solid fa-circle-question'></i> relance ce tutoriel à tout moment. Accessible à <strong>tous les joueurs</strong>. Appuyez sur <kbd>Echap</kbd> pour fermer à tout moment.",
            position:   "right"
        },
    ],

    // ---- Tour de la fiche personnage ----
    tourFiche: [
        {
            beforeShow: _openSheet,
            target:     ".document-name, .sheet-header .name, [name='name']",
            title:      "Le nom du personnage",
            text:       "En haut de la fiche : le <strong>nom</strong> du personnage, et à gauche son <strong>portrait</strong>. Un clic sur le portrait permet de le changer.",
            position:   "bottom"
        },
        {
            beforeShow: _openSheet,
            targets:    [".sheet-header .right", ".meter.exp"],
            title:      "Niveau, expérience & repos",
            text:       "Cette zone de l'en-tête regroupe : le <strong>niveau global</strong> (badge rond, ici 12) et la <strong>barre d'expérience</strong> vers le niveau suivant, l'<strong>Inspiration héroïque</strong> (un bonus ponctuel qui peut venir du MJ, mais aussi d'une aptitude, d'une espèce ou d'autres sources), et les boutons de <strong>Repos court</strong> et <strong>Repos long</strong> (récupération de PV, sorts et capacités).",
            position:   "bottom"
        },
        {
            beforeShow: _openSheet,
            target:     ".ac-badge",
            title:      "Classe d'armure (CA)",
            text:       "L'écusson affiche la <strong>Classe d'Armure</strong> : la difficulté pour vous toucher au combat.",
            position:   "right"
        },
        {
            beforeShow: _openSheet,
            target:     ".stats .lozenges",
            title:      "Initiative, Vitesse & Maîtrise",
            text:       "Les valeurs clés : le bonus d'<strong>Initiative</strong>, la <strong>Vitesse</strong> de déplacement et le <strong>bonus de maîtrise</strong> (Proficiency).",
            position:   "right"
        },
        {
            beforeShow: _openSheet,
            target:     ".stats .meter-group",
            title:      "Points de vie",
            text:       "La barre de <strong>points de vie</strong> (actuels / max), avec les points de vie <strong>temporaires</strong>.",
            position:   "right"
        },
        {
            beforeShow: _openSheet,
            target:     ".stats .meter-group + .meter-group",
            title:      "Dés de vie",
            text:       "Les <strong>dés de vie</strong> servent à récupérer des PV lors d'un repos court. Ici 12 dés (un par niveau).",
            position:   "right"
        },
        {
            beforeShow: _openSheet,
            targets:    [
                ".ability-scores [data-ability='str']",
                ".ability-scores [data-ability='dex']",
                ".ability-scores [data-ability='con']",
                ".ability-scores [data-ability='int']",
                ".ability-scores [data-ability='wis']",
                ".ability-scores [data-ability='cha']"
            ],
            title:      "Caractéristiques",
            text:       "La rangée du haut affiche les six <strong>caractéristiques</strong> (Force, Dextérité, Constitution, Intelligence, Sagesse, Charisme) avec leur score et leur modificateur. Cliquez-en une pour lancer un test de caractéristique.",
            position:   "bottom"
        },
        {
            beforeShow: _openSheet,
            target:     ".tab[data-tab='details'] .left, .sheet-body .left",
            title:      "Compétences",
            text:       "La colonne <strong>Skills</strong> liste les <strong>compétences</strong> (Acrobaties, Arcanes, Perception…) avec la caractéristique associée et le bonus. Cliquez une compétence pour lancer son jet.",
            position:   "right"
        },
        {
            beforeShow: _openSheet,
            target:     ".saves, filigree-box.saves",
            title:      "Jets de sauvegarde & défense",
            text:       "Le bloc <strong>Saving Throws</strong> liste vos <strong>jets de sauvegarde</strong>. Selon la menace, votre défense passe soit par un <strong>jet de sauvegarde</strong> (ce bloc), soit par la <strong>Classe d'Armure</strong> (vue plus haut) face aux attaques.",
            position:   "left"
        },
        {
            beforeShow: _openSheet,
            target:     "nav.tabs:has([data-tab='features']), .sheet.actor nav.tabs, .dnd5e2 nav.tabs",
            title:      "Les onglets de la fiche",
            text:       "La barre d'onglets donne accès au reste : <strong>Aptitudes</strong>, <strong>Inventaire</strong>, <strong>Sorts</strong>, <strong>Biographie</strong>… ainsi qu'aux onglets ajoutés par le serveur (Relations, Bestiaire, Carnet, Expéditions).",
            position:   "bottom"
        },
        {
            beforeShow: _toSheet("inventory"),
            target:     "nav.tabs [data-tab='inventory'], .tabs [data-tab='inventory']",
            title:      "Inventaire & argent",
            text:       "L'onglet <strong>Inventaire</strong> liste l'équipement (armes, armures, objets) et la <strong>bourse</strong> (or, argent, cuivre…).",
            position:   "bottom"
        },
        {
            beforeShow: _toSheet("features"),
            target:     "nav.tabs [data-tab='features'], .tabs [data-tab='features']",
            title:      "Aptitudes (Features)",
            text:       "L'onglet <strong>Aptitudes</strong> regroupe les capacités de classe, d'espèce et d'historique du personnage.",
            position:   "bottom"
        },
        {
            beforeShow: _toSheet("spells"),
            target:     "nav.tabs [data-tab='spells'], .tabs [data-tab='spells']",
            title:      "Sorts",
            text:       "L'onglet <strong>Sorts</strong> présente les sorts connus/préparés et les emplacements de sorts par niveau.",
            position:   "bottom"
        },
        {
            beforeShow: _toSheet("effects"),
            target:     "nav.tabs [data-tab='effects'], .tabs [data-tab='effects']",
            title:      "Effets",
            text:       "L'onglet <strong>Effets</strong> liste les effets actifs sur le personnage : bonus/malus temporaires, conditions (empoisonné, à terre…) et effets de sorts ou d'objets en cours.",
            position:   "bottom"
        },
        {
            beforeShow: _toSheet("biography"),
            target:     "nav.tabs [data-tab='biography'], .tabs [data-tab='biography']",
            title:      "Biographie",
            text:       "L'onglet <strong>Biographie</strong> contient l'histoire, l'apparence et les notes personnelles du personnage.",
            position:   "bottom"
        },
    ],

    // ---- Note GM (onglet privé, GM) ----
    noteGm: [
        {
            beforeShow: _toSheet("gmnotes"),
            target:     "nav.tabs [data-tab='gmnotes'], .tabs [data-tab='gmnotes']",
            title:      "Onglet Note GM",
            textGM:     "Sur chaque fiche de personnage, l'onglet <strong>Note GM</strong> <i class='fa-solid fa-user-secret'></i> n'est visible que par vous — il n'existe même pas côté joueur. Idéal pour vos secrets et rappels sur un PJ. <strong>Le même onglet existe aussi sur les fiches de PNJ</strong> (réglable séparément dans Réglages → Toolkit), pratique pour noter secrets, motivations et projets d'un PNJ.",
            position:   "bottom",
            gmOnly:     true
        },
        {
            beforeShow: _toSheet("gmnotes"),
            target:     ".scwm-gmnotes-input, .scwm-gmnotes",
            title:      "Vos notes privées",
            textGM:     "Écrivez ici tout ce que vous voulez retenir sur ce personnage (plans, secrets, dettes…). Sauvegarde automatique à la perte de focus. Le joueur ne peut pas les lire dans son interface.",
            position:   "left",
            gmOnly:     true
        },
    ],

    // ---- Mes personnages (création & validation, joueur) ----
    monPerso: [
        // ── Le principe (avant l'interface) ──────────────────────
        {
            target:     null,
            title:      "Comment fonctionne la création de personnage",
            text:       "Sur ce serveur, les personnages passent par un <strong>circuit de validation</strong> avec le MJ. Le principe, étape par étape :<br><br>"
                      + "<strong>1. Demande</strong> — vous demandez la création d'un personnage (un nom, une idée générale).<br>"
                      + "<strong>2. Validation</strong> — un MJ accepte : une fiche vierge est créée dans vos acteurs, vous en devenez propriétaire.<br>"
                      + "<strong>3. Construction</strong> — vous montez librement votre personnage (classe, sorts, équipement…).<br>"
                      + "<strong>4. Soumission</strong> — quand c'est prêt, vous le soumettez au MJ.<br>"
                      + "<strong>5. Verrouillage</strong> — le MJ valide : la fiche est <strong>verrouillée</strong>. Vous jouez normalement (PV, sorts, or, conditions…) mais vous ne pouvez plus changer sa <em>construction</em> (caractéristiques, classe, aptitudes…) sans repasser par le MJ.<br><br>"
                      + "<strong>Monter de niveau :</strong> quand vous avez assez d'XP, un bouton apparaît ; vous en faites la demande, le MJ l'autorise (la fiche se déverrouille), vous montez de niveau, puis vous re-soumettez.<br><br>"
                      + "<strong>Plusieurs personnages :</strong> vous pouvez en avoir plusieurs, dans la limite fixée par le MJ. Au-delà du nombre de personnages <em>actifs</em> autorisés, les autres passent <strong>en stock</strong> (non jouables) ; vous en activez un à la place d'un autre.",
            position:   "center",
            playerOnly: true
        },
        // ── Le bouton dans la barre ──────────────────────────────
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='charValidation']",
            title:      "Le bouton « Mes personnages »",
            text:       "Tout se passe depuis le bouton <i class='fa-solid fa-id-card'></i> de la barre WestMarch : il ouvre <strong>« Mes personnages »</strong>, d'où vous demandez, suivez et soumettez vos personnages.",
            position:   "right",
            playerOnly: true
        },
        // ── La fenêtre ───────────────────────────────────────────
        {
            beforeShow: _openMonPerso,
            target:     ".scwm-cv-hub",
            title:      "Demander & gérer",
            text:       "« <strong>Demander un nouveau personnage</strong> » envoie une demande au MJ (dans la limite autorisée). Une fois le perso créé et construit, cliquez <strong>Soumettre</strong> : le MJ le valide et le verrouille. En haut, un compteur indique vos personnages <strong>actifs</strong> ; au-delà de la limite, les autres passent <strong>en stock</strong> <i class='fa-solid fa-lock'></i> — vous les activez / mettez en stock selon vos places. Le bouton <strong>Monter de niveau</strong> n'apparaît que lorsque le PJ a assez d'XP.",
            position:   "left",
            playerOnly: true
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
            beforeShow: _toSheet("bestiary"),
            target:   ".bst-toggle",
            title:    "Consulter une entrée",
            text:     "Cliquez sur la flèche d'une entrée pour déplier les notes du GM sur cette créature.",
            textGM:   "Cliquez sur la flèche d'une entrée pour la déplier. Vous pouvez y renseigner la scène de première rencontre et ajouter des notes visibles par le joueur.",
            position: "left"
        },
        {
            beforeShow: _toSheet("bestiary"),
            target:     ".bst-delete",
            title:      "Retirer une entrée",
            text:       "L'icône <i class='fa-solid fa-trash'></i> à droite d'une entrée retire définitivement cette créature de votre bestiaire. Une confirmation est demandée avant la suppression.",
            textGM:     "L'icône <i class='fa-solid fa-trash'></i> retire la créature du bestiaire du joueur. Elle pourra être ré-ajoutée automatiquement si le joueur la recroise en scène.",
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
            text:       "L'icône <i class='fa-solid fa-trash'></i> à droite d'une relation la supprime. Elle pourra être recréée automatiquement si vous recroisez ce personnage en scène.",
            textGM:     "L'icône <i class='fa-solid fa-trash'></i> supprime la relation du joueur. Elle sera recréée automatiquement si le joueur recroise ce personnage en scène.",
            position:   "left"
        },
        {
            beforeShow: _toSheet("relations"),
            target:     ".scwm-exclude-btn",
            title:      "Bloquer l'ajout automatique",
            text:       "Le bouton <i class='fa-solid fa-ban'></i> dans l'en-tête de la fiche <strong>empêche ce personnage d'être ajouté automatiquement</strong> aux Relations et au Bestiaire. Il ne touche pas aux listes déjà existantes. Cliquez à nouveau pour réactiver.",
            textGM:     "Le bouton <i class='fa-solid fa-ban'></i> dans l'en-tête <strong>bloque les ajouts automatiques futurs</strong> (Relations & Bestiaire) sans rien retirer des listes existantes. Devient rouge quand actif ; cliquez à nouveau pour réactiver. S'applique à n'importe quelle fiche PJ ou PNJ.",
            position:   "bottom",
            gmOnly:     true
        },
        {
            beforeShow: _toSheet("relations"),
            target:     ".scwm-removeall-btn",
            title:      "Retirer de chez tous les joueurs",
            text:       "Le bouton <i class='fa-solid fa-users-slash'></i> <strong>retire ce personnage des Relations et du Bestiaire de tous les joueurs</strong>, d'un coup. Une confirmation est demandée. Sans blocage, il pourra revenir s'il est recroisé.",
            textGM:     "Le bouton <i class='fa-solid fa-users-slash'></i> <strong>nettoie immédiatement</strong> ce personnage des listes de <strong>tous les joueurs</strong> (Relations & Bestiaire), avec confirmation. Indépendant du blocage <i class='fa-solid fa-ban'></i> : combinez les deux pour retirer ET empêcher tout retour automatique.",
            position:   "bottom",
            gmOnly:     true
        },
        {
            beforeShow: _toSheet("relations"),
            target:     ".scwm-reveal-btn",
            title:      "Révéler à la party",
            textGM:     "Le bouton <i class='fa-solid fa-eye'></i> <strong>révèle</strong> ce personnage à toute la party d'un coup : son vrai nom apparaît dans les Relations et le Bestiaire de chaque joueur, même s'il était anonyme.",
            position:   "bottom",
            gmOnly:     true
        },
        {
            beforeShow: _toSheet("relations"),
            target:     ".scwm-anon-btn",
            title:      "Rendre anonyme",
            textGM:     "Le bouton <i class='fa-solid fa-eye-slash'></i> rend ce personnage <strong>anonyme</strong> : dans les Relations et le Bestiaire des joueurs, il s'affiche « Inconnu » tant qu'il n'est pas révélé. Devient rouge quand actif ; recliquez pour lever l'anonymat.",
            position:   "bottom",
            gmOnly:     true
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
            textGM:     "Les <strong>sections</strong> sont des séparateurs que le joueur (ou vous, le MJ) peut créer pour organiser ses notes. Replier une section masque toutes les notes qu'elle contient jusqu'à la section suivante.",
            position:   "bottom"
        },
        // ── Réordonner par drag & drop ───────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-drag-handle",
            title:      "Réordonner les notes",
            text:       "La <strong>poignée <i class='fa-solid fa-grip-vertical'></i></strong> à gauche de chaque note ou section permet de la faire glisser pour changer son ordre. Attrapez-la et déposez la note à l'endroit souhaité — la ligne dorée indique où elle va s'insérer.",
            textGM:     "La <strong>poignée <i class='fa-solid fa-grip-vertical'></i></strong> à gauche permet de déplacer les notes et les sections par glisser-déposer. L'ordre est sauvegardé automatiquement sur la fiche du joueur.",
            position:   "right"
        },
        // ── Replier une note ─────────────────────────────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-toggle-note",
            title:      "Replier une note",
            text:       "Cliquez le <strong>chevron <i class='fa-solid fa-chevron-down'></i></strong> à gauche du titre pour replier ou déplier une note individuellement. Pratique quand le carnet commence à s'allonger.",
            position:   "right"
        },
        // ── Barre recherche / tout replier-déplier ───────────────
        {
            beforeShow: _toSheet("carnet-journal"),
            target:     ".carnet-tools-bar, .carnet-search",
            title:      "Rechercher & tout replier",
            text:       "En haut du carnet : un champ de <strong>recherche</strong> masque instantanément les notes qui ne contiennent pas votre texte (titre + contenu), et les boutons <i class='fa-solid fa-angles-down'></i>/<i class='fa-solid fa-angles-up'></i> <strong>déplient ou replient toutes les notes</strong> d'un coup. Pratique quand le carnet s'allonge.",
            position:   "bottom"
        },
        // ── Éditeur de texte ─────────────────────────────────────
        {
            beforeShow: _openCarnetNoteExpanded,
            target:     ".carnet-edit-note",
            title:      "Éditeur de note",
            text:       "Le bouton <strong>Modifier</strong> ouvre l'éditeur « grimoire ». La barre d'outils propose : <strong>Gras</strong>, <em>Italique</em>, Souligné, Barré, deux niveaux de <strong>titres</strong> (T1/T2), paragraphe, listes, une <strong>taille en points</strong> (comme Word), la <strong>couleur du texte</strong> <i class='fa-solid fa-palette'></i> et l'<strong>insertion de lien</strong> <i class='fa-solid fa-link'></i> (sélectionnez le texte puis l'URL). Tout est <strong>sauvegardé automatiquement</strong> : même en fermant par la croix, rien n'est perdu.",
            textGM:     "Le bouton <strong>Modifier</strong> ouvre l'éditeur enrichi : gras, italique, titres, listes, <strong>taille en points</strong>, <strong>couleur</strong> et <strong>liens</strong>. Le contenu est sauvegardé en continu (aucune perte, même en fermant sans « Sauvegarder »).",
            position:   "top"
        },
        // ── Lier à une expédition ────────────────────────────────
        {
            beforeShow: _openCarnetNoteExpanded,
            target:     ".carnet-link-exp",
            title:      "Lier une note à une expédition",
            text:       "Le lien <i class='fa-solid fa-link'></i> <strong>Lier</strong> associe une note à une expédition précise. Une fois liée, le nom de l'expédition apparaît dans la note, et un lien <i class='fa-solid fa-calendar-alt'></i> permet de sauter directement à l'expédition dans l'onglet Expéditions. Pour délier, cliquez <i class='fa-solid fa-unlink'></i>.",
            position:   "left"
        },
        // ── Onglet Expéditions ───────────────────────────────────
        {
            beforeShow: _toSheet("carnet-downtime"),
            target:     "nav.tabs [data-tab='carnet-downtime'], .tabs .item[data-tab='carnet-downtime']",
            title:      "Onglet Expéditions",
            text:       "L'onglet <strong>Expéditions</strong> liste toutes vos sessions de jeu avec leur date de début, de fin et leur durée en jours calculée automatiquement. Cliquez sur le nom d'une expédition pour naviguer vers les notes qui lui sont liées dans le Carnet.",
            textGM:     "L'onglet <strong>Expéditions</strong> liste les sessions avec dates et durée. Les dates sont enregistrées via le bouton <i class='fa-solid fa-calendar-plus'></i> dans la barre WestMarch. Depuis ici vous pouvez aussi renommer une expédition ou la supprimer.",
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
        // ── Statut de disponibilité des PJ (répertoire des Acteurs) ──
        {
            beforeShow: _showPcStatus,
            target:     ".tuto-status-highlight, #actors .scwm-pc-status, .scwm-pc-status",
            title:      "Statut de disponibilité",
            text:       "Dans le répertoire des <strong>Acteurs</strong>, un badge à droite de chaque personnage indique s'il est <strong>Disponible</strong> ou <strong>En expédition</strong>. Le statut est automatique : dès qu'une expédition est ouverte (date de début sans date de fin), le PJ passe « En expédition » ; sa clôture le repasse « Disponible ». Pratique pour voir d'un coup d'œil qui est déjà parti.",
            position:   "right"
        },
        // ── Clore la session (GM) — transition vers le Casier ────
        {
            beforeShow: async () => { ui.players?.render?.(); await new Promise(r => setTimeout(r, 300)); },
            target:     ".westmarch-close-session",
            title:      "Clore la session",
            textGM:     "Sous la liste des joueurs, le bouton <i class='fa-solid fa-book'></i> <strong>Clore la session</strong> ouvre la fenêtre de clôture. On y trouve : l'attribution d'<strong>XP</strong> à la party (champ « pour tous » + un champ par PJ) — ou un sélecteur <strong>1 à 3 étoiles</strong> si le système d'étoiles est actif ; une case pour <strong>n'attribuer qu'une fois le rapport envoyé</strong> (pratique si vous hésitez : ajustable ensuite dans le Casier) ; le choix des <strong>intrigues liées</strong> (tags partagés ou vos intrigues perso, créables à la volée) ; un champ de <strong>notes</strong> ; et deux issues — <strong>Clôturer &amp; envoyer</strong> sur Discord, ou <strong>Enregistrer pour plus tard</strong> dans votre Casier. C'est ce Casier qu'on va voir maintenant.",
            position:   "top",
            gmOnly:     true
        },
    ],

    // ---- Casier du MJ (GM) ----
    casier: [
        {
            beforeShow: () => _openCasier("dashboard"),
            target:     ".scwm-casier-dashboard",
            title:      "Le Casier du MJ",
            textGM:     "Le bouton <i class='fa-solid fa-box-archive'></i> <strong>Casier</strong> dans la barre WestMarch ouvre votre tableau de bord de meneur. L'onglet <strong>Dashboard</strong> résume vos rapports à finaliser, l'état de votre party et le nombre d'expéditions en cours.",
            position:   "left"
        },
        {
            beforeShow: () => _openCasier("dashboard"),
            target:     ".scwm-casier-presentation",
            title:      "Votre présentation",
            textGM:     "Ce champ libre vous laisse noter votre présentation, vos critères, vos horaires… Sauvegardé automatiquement et propre à chaque meneur.",
            position:   "top"
        },
        // Onglets présentés DE HAUT EN BAS, dans l'ordre de la barre du Casier.
        // Groupe « Travail » : Rapports, Expéditions, Temps morts, Validation.
        {
            beforeShow: () => _openCasier("reports"),
            target:     ".scwm-casier-tab[data-tab='reports']",
            title:      "Rapports à finaliser",
            textGM:     "Les rapports <strong>enregistrés pour plus tard</strong> à la clôture arrivent ici. Sélectionnez-en un pour compléter ses notes, ajuster les <strong>intrigues</strong> et l'attribution en attente, puis <strong>Clôturer &amp; envoyer sur Discord</strong>. Une pastille sur le bouton Casier et un message à la connexion vous rappellent les rapports en attente.",
            position:   "right"
        },
        {
            beforeShow: () => _openCasier("expeditions"),
            target:     ".scwm-casier-tab[data-tab='expeditions']",
            title:      "Expéditions en cours",
            textGM:     "Vos expéditions en cours (issues de l'onglet Expédition), regroupées par expédition avec leurs participants. Un badge <strong>En session</strong> marque celle qui correspond à votre party active.",
            position:   "right"
        },
        {
            beforeShow: () => _openCasier("downtime"),
            target:     ".scwm-casier-tab[data-tab='downtime'], .scwm-casier-downtime",
            title:      "Temps morts (dans le Casier)",
            textGM:     "L'onglet <strong>Temps morts</strong> affiche directement toutes les déclarations des joueurs (gains de compétence et artisanat). Vous les modifiez/refusez au besoin, puis <strong>Appliquer les gains</strong> applique tout en un clic — l'objet fabriqué est ajouté automatiquement depuis le compendium configuré.",
            position:   "right"
        },
        {
            beforeShow: () => _openCasier("validation"),
            target:     ".scwm-casier-tab[data-tab='validation'], .scwm-casier-validation",
            title:      "Validation des personnages",
            textGM:     "L'onglet <strong>Validation</strong> regroupe les <strong>demandes de création</strong> (Créer &amp; assigner), les <strong>fiches à valider</strong> (Valider &amp; verrouiller) et les <strong>montées de niveau</strong> à autoriser. C'est ici que vous gérez tout le cycle de vie des personnages joueurs.",
            position:   "right"
        },
        // Groupe « Statistiques » : Intrigues, Suivi des GM, Registre, Statistiques, Disponibilités, Assiduité, Poids du monde.
        {
            beforeShow: () => _openCasier("intrigues"),
            target:     ".scwm-casier-tab[data-tab='intrigues'], .scwm-intrigue",
            title:      "Intrigues",
            textGM:     "L'onglet <strong>Intrigues</strong> regroupe vos rapports par <strong>trame narrative</strong> (les intrigues cochées à la clôture). Pour chaque intrigue : les <strong>MJ impliqués</strong>, les <strong>joueurs liés</strong> et la liste des sessions. Parfait pour préparer une <strong>récompense finale</strong>, retrouver les joueurs d'une même trame ou recruter. La liste d'intrigues partagées se règle dans les paramètres (Système de Party) ; chaque MJ a aussi ses <strong>intrigues perso</strong>.",
            position:   "left"
        },
        {
            beforeShow: () => _openCasier("gms"),
            target:     ".scwm-casier-tab[data-tab='gms']",
            title:      "Suivi des GM",
            textGM:     "Pour chaque meneur : le nombre d'expéditions en cours, leur nom et les joueurs qui y participent — pratique pour se coordonner à plusieurs MJ.",
            position:   "left"
        },
        {
            beforeShow: () => _openCasier("registre"),
            target:     ".scwm-casier-tab[data-tab='registre'], .scwm-reg-table",
            title:      "Registre des personnages",
            textGM:     "L'onglet <strong>Registre</strong> liste tous les PJ (joueur, perso, classes/sous-classes/niveaux, espèce, niveau total), déduit automatiquement des fiches. <strong>Triable</strong> (clic sur un en-tête), <strong>filtrable</strong> (barre de recherche) et <strong>exportable en CSV</strong>. Un <strong>clic sur une ligne</strong> ouvre la fiche ; les joueurs <strong>inactifs</strong> (90 j) sont grisés avec une 🌙.",
            position:   "left"
        },
        {
            beforeShow: () => _openCasier("stats"),
            target:     ".scwm-casier-tab[data-tab='stats'], .scwm-stat-grid",
            title:      "Statistiques",
            textGM:     "L'onglet <strong>Statistiques</strong> compte les personnages par classe, sous-classe, espèce, joueur et par niveau, avec le total de joueurs, de persos et de multiclassés — une vue d'ensemble de la population du serveur.",
            position:   "left"
        },
        {
            beforeShow: () => _openCasier("dispos"),
            target:     ".scwm-casier-tab[data-tab='dispos'], .scwm-reg-table",
            title:      "Disponibilités des joueurs",
            textGM:     "L'onglet <strong>Disponibilités</strong> montre, par joueur, ses PJ, leur nombre, ses expéditions en cours et sa dernière session. Les inactifs y sont aussi signalés.",
            position:   "left"
        },
        {
            beforeShow: () => _openCasier("attendance"),
            target:     ".scwm-casier-tab[data-tab='attendance']",
            title:      "Assiduité",
            textGM:     "L'onglet <strong>Assiduité</strong> mesure l'activité : nombre d'expéditions par joueur et par MJ, dernière activité de chacun (session ou expédition close), et qui est <strong>actif</strong> sur le trimestre (90 jours). Idéal pour repérer les joueurs qui décrochent.",
            position:   "left"
        },
        {
            beforeShow: () => _openCasier("scenesize"),
            target:     ".scwm-casier-tab[data-tab='scenesize']",
            title:      "Poids du monde",
            textGM:     "L'onglet <strong>Poids du monde</strong> mesure la taille (données + médias) de vos scènes, acteurs, objets et journaux — pour repérer ce qui alourdit le monde et faire le ménage si besoin.",
            position:   "left"
        },
    ],

    // ---- Carte des expéditions (brouillard maison, GM) ----
    carteExpedition: [
        {
            target:   null,
            title:    "Carte des expéditions — le principe",
            text:     "Cette carte du monde a un <strong>brouillard « maison »</strong>, géré par le module (pas celui de Foundry). Son intérêt : le brouillard est <strong>propre à CHAQUE personnage</strong>. Chaque PJ ne voit sur la carte que les zones que <em>lui</em> a découvertes — deux personnages d'un même joueur ont chacun leur exploration.<br><br>"
                    + "En pratique : la scène est entièrement visible « nativement » (vision par token désactivée), et le module pose par-dessus un calque noir qui laisse des trous aux cases explorées du personnage joué. C'est fiable et isolé par perso, contrairement au brouillard natif de Foundry.<br><br>"
                    + "La scène concernée est celle définie dans <strong>Réglages → Carte des expéditions → Scène</strong>. Tout ce qui suit ne s'applique qu'à cette scène.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "Plusieurs cartes (archipel)",
            text:     "Tu n'es pas limité à une seule carte. Dans <strong>Réglages → Carte des expéditions</strong>, le bouton <strong>« + Ajouter une carte »</strong> ajoute autant de <strong>scènes</strong> que tu veux (une par île, par région…).<br><br>"
                    + "Chaque scène garde son <strong>propre brouillard</strong>, totalement indépendant : explorer une île ne dévoile rien sur les autres. Les zones toujours éclairées (villes) sont elles aussi propres à chaque scène. Tout ce qui suit s'applique à <strong>chacune</strong> des cartes déclarées.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "Le token de groupe (qui explore)",
            text:     "L'exploration se fait via un <strong>token de groupe</strong>. Le module crée un acteur modèle <strong>« Token à copier et rennomer »</strong> dans le dossier configuré.<br><br>"
                    + "<strong>1.</strong> Duplique cet acteur : une petite fenêtre s'ouvre pour le <strong>renommer</strong> (le nom s'applique à la fiche et au prototype token).<br>"
                    + "<strong>2.</strong> Ouvre la fiche du groupe et ajoute comme <strong>Membres</strong> les personnages de l'expédition (leurs PJ assignés).<br>"
                    + "<strong>3.</strong> Pose son token sur la carte.<br><br>"
                    + "Ce sont les <strong>membres</strong> du groupe qui recevront la révélation quand tu déplaces ce token.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "Révéler en déplaçant",
            text:     "Quand tu <strong>déplaces le token de groupe</strong> sur la carte, les cases (hex) du <strong>trajet parcouru</strong> se révèlent automatiquement pour chaque personnage <strong>membre</strong> du groupe — pas pour les autres.<br><br>"
                    + "Le nombre de cases révélées autour du token se règle avec <strong>« Rayon de révélation (en cases) »</strong> dans les réglages (0 = seulement la case du token, 1 = la case + ses voisines, etc.).<br><br>"
                    + "Astuce : pour pré-explorer proprement une zone pour un personnage, assure-toi qu'il est bien <strong>membre</strong> du groupe, puis promène le token.",
            position: "center",
            gmOnly:   true
        },
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='scwmLightZone']",
            title:      "Bouton « Éclairer une zone » (villes)",
            text:       "Cet outil <i class='fa-solid fa-city'></i> te permet de marquer des zones <strong>toujours éclairées pour tout le monde</strong> — typiquement les villes et lieux connus de tous, indépendamment de l'exploration.<br><br>"
                      + "Active-le, puis sur la carte : <strong>clic gauche</strong> éclaire une case, <strong>clic droit</strong> la masque. Ces zones apparaissent pour tous les personnages, en plus de leur propre exploration. Pense à désactiver l'outil quand tu as fini.",
            position:   "right",
            gmOnly:     true
        },
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='scwmFogReset']",
            title:      "Bouton « Réinitialiser le brouillard »",
            text:       "Cet outil <i class='fa-solid fa-eraser'></i> ouvre une fenêtre pour effacer le brouillard exploré.<br><br>"
                      + "Tu peux réinitialiser <strong>un seul personnage</strong> (choisi dans la liste) ou <strong>tout le monde</strong>. La réinitialisation totale est protégée par plusieurs avertissements et une confirmation à <strong>taper</strong>, car elle est <strong>irréversible</strong> : les zones effacées ne se récupèrent pas, chaque joueur reverra sa carte noire jusqu'à ré-exploration.",
            position:   "right",
            gmOnly:     true
        },
    ],

    // ---- Cues audio (mise en scène) ----
    cues: [
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='sceneCues']",
            title:      "Cues audio — le bouton",
            textGM:     "Le bouton <i class='fa-solid fa-clapperboard'></i> <strong>Cues audio</strong> dans la barre WestMarch ouvre le gestionnaire de mise en scène : des sons préparés que vous déclenchez au bon moment, uniquement pour votre party.",
            position:   "right",
            gmOnly:     true
        },
        {
            beforeShow: _openCues,
            target:     ".scwm-cue-toolbar",
            title:      "Préparer un cue",
            textGM:     "« <strong>Nouveau cue</strong> » crée un son (fichier, seconde de départ, volume, fondu, boucle). « <strong>Section</strong> » regroupe et replie vos cues. Le bouton 🎵 à côté du fichier ouvre vos playlists (monde &amp; compendiums) pour <strong>écouter et choisir</strong> un son.",
            position:   "bottom",
            gmOnly:     true
        },
        {
            beforeShow: _openCues,
            target:     ".scwm-cue-trigger, .scwm-cue-card",
            title:      "Le déclencheur",
            textGM:     "Chaque cue a un <strong>déclencheur</strong> : <em>Manuel</em> (bouton ▶), <em>Révélation du token lié</em> (le son part quand vous retirez l'invisibilité GM du token), ou <em>Début de combat</em>. Reliez un cue au token sélectionné avec « Lier au token ». Depuis le HUD du token, le bouton <i class='fa-solid fa-clapperboard'></i> rejoue les cues liés.",
            position:   "left",
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
            text:       "Le sablier <i class='fa-solid fa-hourglass-half'></i> dans l'en-tête de votre fiche indique l'état de votre temps mort entre deux sessions. <span style='color:#888'>Gris</span> = rien déclaré. <span style='color:#e67e22'>Orange</span> = activité ajoutée mais pas encore soumise. <span style='color:#2ecc71'>Vert</span> = déclaration envoyée au GM. Cliquez-le pour ouvrir le formulaire.",
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
            text:       "La fenêtre se divise en deux blocs :<br><br><strong>Gain de compétence</strong> — choisissez une compétence ou maîtrise dans la liste, entrez les dates de début et fin de votre temps mort. Le nombre de jours et le bonus sont calculés automatiquement. Si vous cochez <strong>Tools</strong>, un champ <strong>« Outil utilisé »</strong> apparaît : indiquez l'outil (la compétence choisie ne sert alors qu'à la caractéristique associée), et c'est le nom de l'outil qui figurera dans le récap.<br><br><strong>Artisanat</strong> — choisissez le type d'objet à fabriquer (arme, armure, parchemin…), sa rareté, son prix de base et les dates. Le coût en po et la progression sont calculés à la volée.<br><br>Cliquez <strong>Ajouter au panier</strong> pour chaque activité, puis <strong>Déclarer</strong> pour envoyer au GM. Vous pouvez combiner plusieurs activités dans une même déclaration.",
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
        // La validation des temps morts (GM) est couverte par la section Casier
        // (onglet Temps morts) — pas de doublon ici.
    ],

    // ---- Apparence des tokens ----
    apparenceTokens: [
        // ── Portrait HUD ─────────────────────────────────────────
        {
            target:   null,
            title:    "Voir le portrait",
            text:     "<strong>Clic droit</strong> sur un token → HUD → bouton portrait <i class='fa-solid fa-image'></i> : affiche en grand l'image de la fiche du personnage.",
            position: "center",
            native:   true
        },
        // ── Accéder au Prototype Token ────────────────────────────
        {
            beforeShow: async () => {
                const actor = _tutorialActor();
                if (!actor) return;
                actor.sheet.render(true);
                await new Promise(r => setTimeout(r, 600));
            },
            target:   '[data-action="openTokenConfig"]',
            title:    "Ouvrir le Prototype Token",
            text:     "Ce bouton dans l'en-tête de la fiche ouvre la configuration du <strong>Prototype Token</strong> — le token tel qu'il apparaît par défaut sur la carte. L'onglet <strong>Apparence</strong> donne accès à deux fonctions avancées : le <em>Cycle d'apparences</em> et le <em>Wild Shape / Polymorph</em>. Cliquez <strong>Suivant</strong> pour l'ouvrir automatiquement.",
            position: "bottom",
            gmOnly:   true,
            native:   true
        },
        // ── Cycle d'apparences (prototype token → Apparence) ─────
        {
            beforeShow: _openProtoTokenAppearance,
            target:     ".tuto-proto-token",
            title:      "Cycle d'apparences",
            text:       "La fenêtre ouverte est le <strong>Prototype Token</strong>, onglet <strong>Apparence</strong>. La section <strong>Cycle d'apparences</strong> permet d'ajouter plusieurs images alternatives pour le token. En jeu, le bouton <i class='fa-solid fa-images'></i> dans le HUD (clic droit sur le token) bascule entre ces images — utile pour les tenues, les états visuels ou les formes mineures.",
            position:   "left",
            gmOnly:     true
        },
        // ── Wild Shape / Polymorph (même onglet Apparence) ───────
        {
            beforeShow: _openProtoTokenAppearance,
            target:     ".tuto-proto-token",
            title:      "Wild Shape / Polymorph",
            text:       "La section <strong>Wild Shape / Polymorph</strong> du même onglet configure des formes de transformation complètes. Le bouton <i class='fa-solid fa-dragon'></i> dans le HUD (clic droit sur le token) applique la transformation en un clic — et la rétablit en re-cliquant. Accessible au GM et aux propriétaires du token.",
            position:   "left",
            gmOnly:     true
        },
    ],

    // ---- Outils GM ----
    outilsGm: [
        {
            beforeShow: _expandWestmarch,
            target:     "[data-tool='fakeWarning']",
            title:      "Faux message de maintenance",
            text:       "Ce bouton <i class='fa-solid fa-triangle-exclamation'></i> envoie une fausse notification jaune à un joueur précis — pour lui faire croire qu'un problème technique a été résolu. Vous pouvez le <strong>retirer complètement</strong> en décochant « Faux message de maintenance » dans <em>Réglages → Serveur</em>.",
            position:   "right",
            gmOnly:     true
        },
        {
            beforeShow: _openChatTab,
            target:     "[data-wm-action='clearParty']",
            title:      "Vider les messages de ma party",
            text:       "Ce bouton <i class='fa-solid fa-users-slash'></i> supprime uniquement les messages du chat dont l'auteur appartient à <strong>votre party</strong>. Les messages des autres GMs et de leurs joueurs ne sont pas touchés. Une confirmation est demandée avant la suppression.",
            position:   "top",
            gmOnly:     true
        },
        {
            beforeShow: _openChatTab,
            target:     "[data-wm-action='importParty']",
            title:      "Importer des messages de chat",
            text:       "Ce bouton <i class='fa-solid fa-file-import'></i> permet de réimporter un export de chat Foundry (<code>.txt</code>) ou JSON. Les messages sont recréés dans le chat en conservant leur timestamp d'origine — ils apparaîtront dans le bon ordre chronologique. Pratique pour restaurer un historique après un clear accidentel.",
            position:   "top",
            gmOnly:     true
        },
        {
            target:   null,
            title:    "Protection TGCM",
            text:     "Le bouton <i class='fa-solid fa-shield-halved'></i> dans le HUD d'un token (GM uniquement) le protège de la mort. Un token TGCM ne peut jamais tomber à 0 PV — tout dégât fatal le laisse à 1 PV.",
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
            text:     "Faites un <strong>clic droit</strong> sur n'importe quel acteur dans la sidebar et choisissez <strong>Exporter</strong>. Une fenêtre vous propose deux formats : <br><br><i class='fa-solid fa-layer-group'></i> <strong>Fiche actuelle</strong> — export complet avec toutes les données (expéditions, relations, bestiaire, flags modules). À réimporter uniquement sur un serveur avec les mêmes modules.<br><br><i class='fa-solid fa-dice-d20'></i> <strong>Fiche originale dnd5e</strong> — réinitialise la fiche au format dnd5e standard et supprime toutes les données propres au serveur. Compatible partout.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "Masquer des éléments d'interface",
            text:     "<strong>Réglages → Interface — Masquer des éléments</strong> ouvre un panneau qui liste ce qui est présent sur l'interface (icônes de la barre d'outils, barre de macros, liste des joueurs, navigation…). Chaque élément a <strong>deux colonnes de cases</strong> : <strong>Joueurs</strong> et <strong>GM</strong>. Cochez ce que vous voulez cacher pour chaque rôle ; chaque client applique la colonne de son rôle. « Tout réafficher » remet tout.",
            position: "center",
            gmOnly:   true
        },
        {
            target:   null,
            title:    "À propos & activation / désactivation",
            text:     "<strong>Réglages → À propos</strong> (visible par tous) affiche version, auteur et protection des droits. Tout en bas, un <strong>champ code</strong> :<br><br>"
                    + "• votre <strong>code d'activation</strong> active le module ;<br>"
                    + "• votre <strong>code de désactivation</strong> le coupe pour tout le serveur (le ressaisir le réactive).<br><br>"
                    + "Un joueur peut aussi saisir le code (sa demande est relayée à un MJ connecté). Le module désactivé, la fenêtre « À propos » reste accessible pour le réactiver.",
            position: "center",
            gmOnly:   true
        },
    ],

    // ---- Échange entre joueurs (players + GM) ----
    echange: [
        {
            beforeShow: async () => { _closeTradeDemo(); try { ui.players?.render?.(); } catch {} await _sleep(250); },
            target:     "#players, #players-active, .players",
            title:      "Échange entre joueurs",
            text:       "Ce serveur permet d'<strong>échanger objets et monnaie</strong> entre joueurs, façon Dofus. Pour lancer un échange : dans la <strong>liste des joueurs</strong>, survolez un joueur en ligne — un bouton <i class='fa-solid fa-right-left'></i> <strong>Échanger</strong> apparaît. (On ne peut pas échanger pendant une party ; en expédition, uniquement avec les membres de l'expédition ; sinon librement.)",
            position:   "right"
        },
        {
            beforeShow: _openTradeDemo,
            target:     "#scwm-trade-demo",
            title:      "La fenêtre d'échange",
            text:       "Voici (en <strong>démonstration</strong>) à quoi ressemble un échange. Deux zones : <strong>votre offre</strong> à gauche, celle de l'autre à droite. Vous y glissez vos objets et réglez la <strong>monnaie</strong> à donner. Tant que personne n'a validé, chacun peut modifier son offre.",
            position:   "left"
        },
        {
            beforeShow: _openTradeDemo,
            target:     '#scwm-trade-demo [data-demo="buttons"]',
            title:      "Confirmer l'échange",
            text:       "Chaque joueur doit <strong>Confirmer son offre</strong> : l'échange ne se fait que lorsque les <strong>deux</strong> ont confirmé — tout est transféré d'un coup, sans risque. <strong>Annuler</strong> ferme l'échange sans rien transférer. Côté demandeur, une petite fenêtre « en attente d'acceptation » s'affiche (impossible à fermer, seulement annuler) tant que l'autre n'a pas répondu.",
            position:   "left"
        },
    ],

    // ---- Transformations : Wild Shape / Polymorphie (players + GM) ----
    transformation: [
        {
            beforeShow: _openSidebarSettingsTab,
            target:     '#settings button[data-action="configure"], button.configure-settings, [data-action="configure"], #settings',
            title:      "Transformations — où régler",
            text:       "Le module gère deux systèmes distincts via le moteur dnd5e : la <strong>Forme sauvage</strong> (druide) et la <strong>Polymorphie</strong> (sort), avec les règles PHB 2024. Les options se trouvent dans <strong>Réglages → Configurer les paramètres</strong>, catégorie <strong>Transformation</strong>.",
            position:   "left"
        },
        {
            beforeShow: _openConfigHubTour,
            target:     "#scwm-hub",
            title:      "Catégorie « Transformation »",
            text:       "Dans le <strong>Panneau de configuration</strong> → groupe <strong>Combat</strong> → <strong>Transformation</strong> : activez/désactivez l'ensemble et réglez l'application des limites de <strong>facteur de puissance (FP)</strong>.",
            position:   "right"
        },
        {
            target:     null,
            title:      "Comment ça marche en jeu",
            text:       "En combat, sélectionnez le token du personnage : des boutons apparaissent dans le <strong>HUD du token</strong> — <strong>Forme sauvage</strong> (druide) et/ou <strong>Polymorphie</strong>, puis <strong>Revenir</strong> à la forme d'origine. Choisissez la bête : le moteur dnd5e applique la transformation (garde l'essentiel du perso selon le type), vérifie le FP max autorisé, et <strong>Revenir</strong> restaure la fiche. Deux listes de formes mémorisées (Wild Shape / Polymorphie) évitent de re-chercher à chaque fois.",
            position:   "center"
        },
    ],

    // ---- Compagnons évolutifs (GM) ----
    compagnons: [
        {
            target:     null,
            title:      "Compagnons évolutifs — le principe",
            textGM:     "Un <strong>compagnon évolutif</strong> (familier, invocation, animal) voit ses stats (CA, PV, bonus…) <strong>recalculées automatiquement</strong> selon le niveau de son <strong>maître</strong> (le PJ). Plus besoin de refaire sa fiche à chaque niveau : le module resynchronise via des <strong>formules</strong>.",
            position:   "center",
            gmOnly:     true
        },
        {
            target:     null,
            title:      "Attribuer un compagnon",
            textGM:     "Ouvrez la fiche de la <strong>créature (PNJ)</strong> à lier. Dans la <strong>barre de titre</strong> de sa fenêtre, un bouton <i class='fa-solid fa-dna'></i> apparaît (MJ) : cliquez-le pour ouvrir le dialogue, choisissez le <strong>maître</strong> (le PJ) et le <strong>profil</strong> de formules à appliquer, puis validez. Le compagnon est lié et se mettra à jour tout seul quand le maître monte de niveau.",
            position:   "center",
            gmOnly:     true
        },
        {
            beforeShow: _openConfigHubTour,
            target:     "#scwm-hub",
            title:      "Personnaliser les profils (JSON)",
            textGM:     "Les profils de formules sont <strong>personnalisables</strong>. Dans le <strong>Panneau de configuration</strong> → groupe <strong>Personnalisation &amp; interface</strong> → <strong>Profils de compagnons</strong>, vous pouvez ajouter ou surcharger des profils en <strong>JSON</strong> : chaque champ (ex. <code>system.attributes.hp.max</code>) reçoit une <strong>formule</strong> pouvant référencer <code>@level</code> (niveau du maître), <code>@master</code>, <code>@pb</code>… Parfait pour coller à vos règles maison.",
            position:   "right",
            gmOnly:     true
        },
    ],

    // ---- Panthéons : Dieux de Faerûn (players + GM) ----
    pantheon: [
        {
            beforeShow: _openPantheonFolder,
            target:     ".tuto-a11y-highlight, #journal .folder, .journal .directory-item.folder",
            title:      "Le dossier Panthéons",
            text:       "Dans l'onglet <strong>Journaux</strong>, le module ajoute un dossier <strong>Panthéons</strong> contenant un compendium complet des <strong>Dieux de Faerûn</strong> (tous les panthéons). Il est <strong>visible par tout le monde</strong> : cliquez le journal pour consulter les divinités, leurs domaines et symboles.",
            textGM:     "Dans l'onglet <strong>Journaux</strong>, le module crée au premier lancement un dossier <strong>Panthéons</strong> (Dieux de Faerûn, tous les panthéons), <strong>visible par tous les joueurs</strong>. Vous pouvez le consulter, le déplacer ou le supprimer ; il ne sera pas recréé. L'option se coupe dans <strong>Réglages → Serveur</strong> si vous n'en voulez pas.",
            position:   "right"
        },
    ],
};

// ================================================================
// API PUBLIQUE
// ================================================================

// Question d'entrée : connaît-il déjà Foundry ? → true (sauter les bases natives),
// false (tout faire), ou null (annulé / fenêtre fermée).
async function _askFoundryExperience() {
    const DialogV2 = foundry.applications.api.DialogV2;
    try {
        const res = await DialogV2.wait({
            window: { title: "Avant de commencer", icon: "fa-solid fa-circle-question" },
            position: { width: 460 },
            rejectClose: false,
            content: `<p style="margin:0 0 8px;">Connais-tu déjà <strong>Foundry VTT</strong> et l'as-tu déjà utilisé ?</p>
                      <p style="margin:0;font-size:.85em;opacity:.75;">Si oui, on passe directement aux fonctions propres à ce serveur (on saute le tour des bases : fiche de personnage, tokens…).</p>`,
            buttons: [
                { action: "yes", label: "Oui, je connais Foundry", icon: "fa-solid fa-user-check", callback: () => "yes" },
                { action: "no",  label: "Non / première fois", icon: "fa-solid fa-graduation-cap", default: true, callback: () => "no" }
            ]
        });
        if (res === "yes") return true;
        if (res === "no")  return false;
        return null;
    } catch (e) { return false; }
}

/**
 * Lance le tutoriel.
 * @param {string[]|null} selectedSections  Sections à inclure, ou null pour les settings.
 */
export async function startTutorial(selectedSections = null, onComplete = null) {
    _onComplete = onComplete;

    // Question d'expérience Foundry uniquement pour un parcours COMPLET (pas quand
    // on lance une section précise depuis le menu — l'utilisateur a déjà choisi).
    let experienced = false;
    if (selectedSections === null) {
        experienced = await _askFoundryExperience();
        if (experienced === null) { _onComplete = null; return; }
    }

    _steps = [];
    // Section OBLIGATOIRE : Accessibilité — toujours incluse, en premier, non
    // désactivable (ni gating par réglage, ni par le sélecteur de sections).
    {
        const accSteps = (STEPS_BY_FEATURE.accessibilite ?? []).filter(s => {
            if (s.gmOnly     && !game.user.isGM) return false;
            if (s.playerOnly &&  game.user.isGM) return false;
            return true;
        });
        _steps.push(...accSteps.map(st => ({ ...st, _section: "accessibilite" })));
    }
    for (const [section, settingKey] of Object.entries(SETTING_KEYS)) {
        // Filtrer les sections dont le module requis n'est pas actif
        if (!isSectionAvailable(section)) continue;
        // Sauter les sections purement natives si l'utilisateur connaît Foundry.
        if (experienced && SECTION_NATIVE.has(section)) continue;

        const include = selectedSections !== null
            ? selectedSections.includes(section)
            : game.settings.get(MODULE, settingKey);
        if (!include) continue;

        const sectionSteps = (STEPS_BY_FEATURE[section] ?? []).filter(s => {
            if (s.gmOnly     && !game.user.isGM) return false;
            if (s.playerOnly &&  game.user.isGM) return false;
            if (experienced  && s.native) return false;   // étape native isolée
            return true;
        });
        _steps.push(...sectionSteps.map(st => ({ ...st, _section: section })));
    }

    if (!_steps.length) {
        ui.notifications.warn("[Tutoriel] Aucun contenu activé. Activez des fonctionnalités dans les paramètres du tutoriel.");
        return;
    }

    // Accès temporaire à la fiche démo (Propriétaire) le temps du tutoriel,
    // pour que les onglets se présentent comme une fiche de joueur normale.
    await grantTutorialAccess();

    _current = 0;
    _buildWrap();
    _showStep(0);
}

// Nettoyage DOM seul (aussi utilisé avant de (re)construire le wrapper).
export function closeTutorial() {
    if (_escHandler) {
        document.removeEventListener("keydown", _escHandler);
        _escHandler = null;
    }
    _wrapEl?.remove();
    _wrapEl = null;
}

// Fin réelle du tutoriel (croix / Échap / dernière étape) : on retire l'accès
// temporaire à la fiche démo, puis on nettoie le DOM. Si le guide a été TERMINÉ
// (dernière étape), on propose de ne plus afficher la fenêtre de bienvenue.
function _endTutorial(completed = false) {
    revokeTutorialAccess();
    _closeTradeDemo();   // retire la fenêtre d'échange de démonstration si présente
    closeTutorial();
    // Mode « menu » : on rouvre le menu après chaque section, quelle que soit la
    // façon de terminer (fin, croix, Échap). C'est la croix du MENU qui arrête.
    if (_onComplete) {
        const cb = _onComplete;
        _onComplete = null;
        try { cb(completed); } catch (e) { console.warn("[Tutoriel] onComplete :", e); }
        return;
    }
    if (completed) _promptHideWelcome();
}

// Proposé à la fin du guide : masquer la fenêtre de bienvenue (par utilisateur).
function _promptHideWelcome() {
    if (!game.settings.get(MODULE, "tutoEnabled")) return;
    if (game.settings.get(MODULE, "hideWelcome"))  return;   // déjà masquée
    new Dialog({
        title:   "Guide terminé",
        content: `<p>Vous avez terminé le guide. Souhaitez-vous <strong>ne plus afficher la fenêtre de bienvenue</strong> à la connexion ?</p>
                  <p style="opacity:.7;font-size:12px;">Vous pourrez toujours relancer le guide via le bouton « ? » dans la barre WestMarch.</p>`,
        buttons: {
            hide: {
                icon: '<i class="fa-solid fa-eye-slash"></i>', label: "Ne plus afficher",
                callback: () => {
                    game.settings.set(MODULE, "hideWelcome", true);
                    ui.notifications.info("[Tutoriel] La fenêtre d'accueil ne s'affichera plus. Bouton « ? » dans la barre WestMarch pour relancer le guide.");
                }
            },
            keep: { icon: '<i class="fa-solid fa-check"></i>', label: "Garder l'accueil", callback: () => {} }
        },
        default: "hide"
    }).render(true);
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
    _escHandler = e => { if (e.key === "Escape") _endTutorial(); };
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

    // Cibles : une seule (step.target) ou plusieurs (step.targets = [sel, …]),
    // pour éclairer plusieurs zones à la fois (ex. barre d'XP + badge de niveau
    // → forme en « L »).
    const _selectors = Array.isArray(step.targets) ? step.targets
                     : step.target ? [step.target] : [];
    const targetEls = _selectors.map(s => document.querySelector(s)).filter(Boolean);
    const targetEl  = targetEls[0] ?? null;   // ancre pour le positionnement de la bulle

    // ---- SPOTLIGHT : un "trou" par cible via masque SVG, ou plein écran ----
    if (targetEls.length) {
        const pad = 7;
        const rects = targetEls.map(el => {
            const r = el.getBoundingClientRect();
            return {
                T: Math.max(0, r.top    - pad),
                B: Math.min(window.innerHeight, r.bottom + pad),
                L: Math.max(0, r.left   - pad),
                R: Math.min(window.innerWidth,  r.right  + pad),
            };
        });

        // Assombrissement plein écran percé d'un trou par cible : un SVG avec
        // un tracé "rectangle plein écran + rectangles internes" en règle
        // evenodd → les rectangles internes deviennent des trous. Les clics
        // dans les trous passent à travers (zones non peintes du tracé).
        const NS = "http://www.w3.org/2000/svg";
        const W = window.innerWidth, H = window.innerHeight;
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("width", W);
        svg.setAttribute("height", H);
        svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        svg.style.cssText = "position:fixed;inset:0;z-index:9901;pointer-events:none;";
        const path = document.createElementNS(NS, "path");
        let d = `M0 0 H${W} V${H} H0 Z`;
        for (const r of rects) {
            d += ` M${r.L} ${r.T} H${r.R} V${r.B} H${r.L} Z`;
        }
        path.setAttribute("d", d);
        path.setAttribute("fill", "rgba(0,0,0,0.62)");
        path.setAttribute("fill-rule", "evenodd");
        path.style.pointerEvents = "auto";   // bloque les clics sur la zone assombrie
        svg.appendChild(path);
        _wrapEl.appendChild(svg);

        for (const r of rects) {
            const ring = document.createElement("div");
            ring.className = "tuto-ring";
            ring.style.cssText = `position:fixed;pointer-events:none;z-index:9902;
                top:${r.T}px;left:${r.L}px;width:${r.R - r.L}px;height:${r.B - r.T}px;
                border-width:2px;border-style:solid;`;
            _wrapEl.appendChild(ring);
        }
    } else {
        const p = _mkPanel("inset:0");
        p.style.background = "rgba(0,0,0,0.6)";
        // Clic sur le fond : ne ferme PAS le tuto (fermeture via ✕ ou Échap).
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
                <i class="fa-solid fa-angle-left"></i> Retour
            </button>
            <span class="tuto-step-counter">
                <span class="tuto-step-dots">${_renderDots(idx, _steps.length)}</span>
                ${idx + 1} / ${_steps.length}
            </span>
            <button class="tuto-cat-btn tuto-cat-next" title="${catNextTip}"${catNextDis}>
                Suivant <i class="fa-solid fa-angle-right"></i>
            </button>
            <button class="tuto-close-btn" title="Fermer le tutoriel (Echap)">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
        <div class="tuto-bubble-body">
            <h3 class="tuto-bubble-title">${step.title}</h3>
            <p class="tuto-bubble-text">${text}</p>
        </div>
        <div class="tuto-bubble-footer">
            <button class="tuto-btn tuto-prev"${isFirst ? " disabled" : ""}>
                <i class="fa-solid fa-chevron-left"></i> Précédent
            </button>
            <button class="tuto-btn tuto-next primary">
                ${isLast
                    ? '<i class="fa-solid fa-check"></i> Terminer'
                    : 'Suivant <i class="fa-solid fa-chevron-right"></i>'}
            </button>
        </div>`;

    _wrapEl.appendChild(bubble);

    bubble.querySelector(".tuto-close-btn").addEventListener("click", () => _endTutorial(false));
    bubble.querySelector(".tuto-prev").addEventListener("click", () => {
        if (_current > 0) _showStep(--_current);
    });
    bubble.querySelector(".tuto-next").addEventListener("click", () => {
        if (_current < _steps.length - 1) _showStep(++_current);
        else _endTutorial(true);   // dernière étape → guide terminé
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

        // Garde-fou final : la bulle reste TOUJOURS entièrement dans l'écran,
        // même si la cible est collée à un bord (sinon elle sort du cadre).
        left = clamp(left, M, Math.max(M, window.innerWidth  - BW - M));
        top  = clamp(top,  M, Math.max(M, window.innerHeight - BH - M));

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
