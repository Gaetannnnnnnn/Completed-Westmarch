// ============================================================
// character-sheet.js — Fiche PJ unifiée (dnd5e v3, ApplicationV2)
//
// Remplace l'ancienne cascade relations → bestiary → carnet (3 modules
// séparés qui s'empilaient via CONFIG.asharaSheets). Ici, une SEULE
// sous-classe compose les onglets Relations / Bestiaire / Carnet /
// Expéditions selon les settings activés, enregistrée une seule fois.
//
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { buildTabHtml as relBuildTab, wireTab as relWireTab } from "./relations.js";
import { buildTabHtml as bstBuildTab, wireTab as bstWireTab } from "./bestiary.js";
import {
    buildJournalHtml, buildDowntimeHtml, wireJournalTab, wireDowntimeTab
} from "./carnet.js";

export function setupCharacterSheet() {
    // Enregistrement au hook "setup" : garanti après tous les "init",
    // et game.settings est disponible.
    Hooks.once("setup", () => {
        const relOn    = game.settings.get(MOD, "relationsEnabled");
        const bestOn   = game.settings.get(MOD, "bestiaryEnabled");
        const carnetOn = game.settings.get(MOD, "carnetEnabled");

        // Aucun onglet custom demandé → on laisse la fiche dnd5e native.
        if (!relOn && !bestOn && !carnetOn) return;

        const Base = dnd5e.applications.actor.CharacterActorSheet;
        const tpl  = (name) => `modules/${MOD}/templates/${name}`;
        const partDef = (name) => ({
            container:  { classes: ["tab-body"], id: "tabs" },
            template:   tpl(name),
            scrollable: [""]
        });

        class SorutaCharacterSheet extends Base {

            static PARTS = {
                ...super.PARTS,
                ...(relOn    ? { relations: partDef("character-relations.hbs") } : {}),
                ...(bestOn   ? { bestiary:  partDef("character-bestiary.hbs")  } : {}),
                ...(carnetOn ? {
                    "carnet-journal":  partDef("character-journal.hbs"),
                    "carnet-downtime": partDef("character-downtime.hbs")
                } : {})
            };

            static TABS = [
                ...super.TABS,
                ...(relOn    ? [{ tab: "relations",       group: "primary", label: "Relations",    icon: "fas fa-heart" }] : []),
                ...(bestOn   ? [{ tab: "bestiary",        group: "primary", label: "Bestiaire",    icon: "fas fa-dragon" }] : []),
                ...(carnetOn ? [
                    { tab: "carnet-journal",  group: "primary", label: "Carnet",      icon: "fas fa-book-open" },
                    { tab: "carnet-downtime", group: "primary", label: "Expéditions", icon: "fas fa-hourglass-half" }
                ] : [])
            ];

            // Même nom que la fiche native → remplace sans multiplier les entrées.
            static get name() { return "CharacterActorSheet"; }

            async _prepareContext(options = {}) {
                const ctx = await super._prepareContext(options);
                if (relOn)  ctx.relationsHtml = relBuildTab(this.actor);
                if (bestOn) ctx.bestiaryHtml  = bstBuildTab(this.actor);
                if (carnetOn) {
                    ctx.journalHtml  = buildJournalHtml(this.actor);
                    ctx.downtimeHtml = buildDowntimeHtml(this.actor);
                }
                return ctx;
            }

            _attachPartListeners(partId, htmlElement, options) {
                super._attachPartListeners(partId, htmlElement, options);
                if (relOn    && partId === "relations")      relWireTab(this.actor, $(htmlElement));
                if (bestOn   && partId === "bestiary")        bstWireTab(this.actor, $(htmlElement));
                if (carnetOn && partId === "carnet-journal")  wireJournalTab(this.actor, htmlElement, this);
                if (carnetOn && partId === "carnet-downtime") wireDowntimeTab(this.actor, htmlElement, this);
            }

            // Re-applique changeTab après insertion de toutes les parts (sinon
            // l'onglet custom mémorisé n'est pas actif à l'ouverture).
            async _onRender(context, options) {
                await super._onRender(context, options);
                const customTabs = [];
                if (relOn)    customTabs.push("relations");
                if (bestOn)   customTabs.push("bestiary");
                if (carnetOn) customTabs.push("carnet-journal", "carnet-downtime");
                for (const tab of customTabs) {
                    if (this.tabGroups?.primary === tab) {
                        delete this.tabGroups.primary;
                        this.changeTab(tab, "primary", { updatePosition: false });
                        break;
                    }
                }
            }
        }

        Actors.registerSheet("dnd5e", SorutaCharacterSheet, {
            types:       ["character"],
            makeDefault: true,
            label:       "Soruta — Fiche personnage"
        });
    });
}
