// ============================================================
// tidy5e-compat.js — Compatibilité avec « Tidy 5e Sheets »
//
// Tidy5e est une fiche entièrement différente (rendu Svelte). Notre
// fiche personnage (character-sheet.js) injecte ses onglets Relations /
// Bestiaire / Carnet / Expéditions / Note GM via le système de PARTS de
// la fiche dnd5e native — ce qui ne s'applique PAS quand l'utilisateur
// choisit d'afficher ses fiches avec Tidy5e.
//
// Ce module ré-enregistre les MÊMES onglets dans les fiches Tidy5e via
// son API officielle (api.registerCharacterTab / HtmlTab), en réutilisant
// exactement les mêmes constructeurs de contenu et fonctions de câblage.
// Les feuilles de style de ces onglets sont déjà chargées globalement,
// donc le rendu est identique.
//
// Rien n'est fait si Tidy5e n'est pas installé/actif : le hook
// « tidy5e-sheet.ready » ne se déclenche simplement jamais.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { buildTabHtml as relBuildTab, wireTab as relWireTab } from "./relations.js";
import { buildTabHtml as bstBuildTab, wireTab as bstWireTab } from "./bestiary.js";
import {
    buildJournalHtml, buildDowntimeHtml, wireJournalTab, wireDowntimeTab
} from "./carnet.js";
import { buildGmNotesHtml, wireGmNotes } from "./character-sheet.js";

// Récupère l'acteur depuis les paramètres onRender de Tidy (plusieurs
// chemins possibles selon la version de Tidy/dnd5e).
function _actorOf(p) {
    return p?.app?.document ?? p?.app?.actor ?? p?.data?.actor ?? p?.data?.document ?? null;
}

function registerTidyTabs(api) {
    if (!api?.registerCharacterTab || !api?.models?.HtmlTab) {
        console.warn(`[${MOD}] API Tidy5e incomplète : onglets non injectés.`);
        return;
    }
    const HtmlTab = api.models.HtmlTab;

    const relOn    = game.settings.get(MOD, "relationsEnabled");
    const bestOn   = game.settings.get(MOD, "bestiaryEnabled");
    const carnetOn = game.settings.get(MOD, "carnetEnabled");
    // Onglet Note GM : seulement pour les MJ (chaque client enregistre ses
    // propres onglets ; un joueur n'enregistre donc jamais cet onglet).
    const gmNotesOn = game.settings.get(MOD, "enableGmNotes") && game.user?.isGM;

    // Fabrique un HtmlTab : le contenu est (re)construit à chaque cycle de
    // rendu dans onRender (renderScheme handlebars) pour rester à jour, puis
    // les écouteurs sont (ré)attachés. On laisse `html` vide et on remplit
    // dans onRender pour ne pas dépendre de la forme du contexte Tidy.
    const makeTab = ({ title, id, icon, build, wire }) => new HtmlTab({
        title,
        tabId: `${MOD}-${id}`,
        iconClass: icon,
        html: "",
        onRender: (p) => {
            const actor = _actorOf(p);
            const el = p?.tabContentsElement;
            if (!actor || !el) return;
            try {
                el.innerHTML = build(actor);
                wire(actor, el, p.app);
            } catch (e) {
                console.error(`[${MOD}] Rendu onglet Tidy « ${title} » :`, e);
            }
        }
    });

    const opts = { overrideExisting: true };

    try {
        if (gmNotesOn) api.registerCharacterTab(makeTab({
            title: "Note GM", id: "gmnotes", icon: "fa-solid fa-user-secret",
            build: (a) => buildGmNotesHtml(a),
            wire:  (a, el) => wireGmNotes(a, el)
        }), opts);

        if (relOn) api.registerCharacterTab(makeTab({
            title: "Relations", id: "relations", icon: "fa-solid fa-heart",
            build: (a) => relBuildTab(a),
            wire:  (a, el) => relWireTab(a, $(el))
        }), opts);

        if (bestOn) api.registerCharacterTab(makeTab({
            title: "Bestiaire", id: "bestiary", icon: "fa-solid fa-dragon",
            build: (a) => bstBuildTab(a),
            wire:  (a, el) => bstWireTab(a, $(el))
        }), opts);

        if (carnetOn) {
            api.registerCharacterTab(makeTab({
                title: "Carnet", id: "carnet-journal", icon: "fa-solid fa-book-open",
                build: (a) => buildJournalHtml(a),
                wire:  (a, el, app) => wireJournalTab(a, el, app)
            }), opts);
            api.registerCharacterTab(makeTab({
                title: "Expéditions", id: "carnet-downtime", icon: "fa-solid fa-hourglass-half",
                build: (a) => buildDowntimeHtml(a),
                wire:  (a, el, app) => wireDowntimeTab(a, el, app)
            }), opts);
        }

        console.log(`[${MOD}] Onglets injectés dans les fiches Tidy5e.`);
    } catch (e) {
        console.error(`[${MOD}] Enregistrement des onglets Tidy5e échoué :`, e);
    }
}

export function Tidy5eCompatHooks() {
    // L'API est disponible au hook « tidy5e-sheet.ready ». On l'écoute ;
    // si Tidy a déjà émis le ready (module chargé avant nous), on récupère
    // l'API directement.
    Hooks.once("tidy5e-sheet.ready", (api) => registerTidyTabs(api));

    const direct = game.modules.get("tidy5e-sheet")?.api;
    if (direct) {
        try { registerTidyTabs(direct); } catch (e) { /* déjà géré via le hook */ }
    }
}
