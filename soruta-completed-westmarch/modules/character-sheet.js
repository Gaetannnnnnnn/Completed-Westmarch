// ============================================================
// character-sheet.js — Fiche PJ unifiée (dnd5e v3, ApplicationV2)
//
// Remplace l'ancienne cascade relations → bestiary → carnet (3 modules
// séparés qui s'empilaient via un mécanisme partagé). Ici, une SEULE
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

// Onglet « Note GM » — notes privées du MJ, invisibles pour les joueurs.
const _escNotes = (s) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function buildGmNotesHtml(actor) {
    const notes = actor.getFlag(MOD, "gmNotes") ?? "";
    return `<div class="scwm-gmnotes">
        <div class="scwm-gmnotes-header">
            <i class="fas fa-user-secret"></i>
            <span class="scwm-gmnotes-title">Notes du MJ</span>
            <span class="scwm-gmnotes-badge"><i class="fas fa-lock"></i> Privé</span>
        </div>
        <p class="scwm-gmnotes-sub">Visibles et modifiables uniquement par les MJ — le joueur ne les voit jamais.</p>
        <div class="scwm-gmnotes-paper">
            <textarea class="scwm-gmnotes-input" placeholder="Écrivez ici vos notes sur ${_escNotes(actor.name)} : secrets, projets, dettes, rappels…">${_escNotes(notes)}</textarea>
        </div>
        <p class="scwm-gmnotes-foot"><i class="fas fa-cloud-arrow-up"></i> Sauvegarde automatique quand vous cliquez ailleurs.</p>
    </div>`;
}
function wireGmNotes(actor, htmlElement) {
    const ta = htmlElement.querySelector(".scwm-gmnotes-input");
    if (!ta) return;
    ta.addEventListener("change", () => actor.setFlag(MOD, "gmNotes", ta.value));
}

export function setupCharacterSheet() {
    // Masque l'onglet « étoile » (favoris) aux joueurs, sur toute fiche PJ
    // (fiche native ou custom). Ne touche jamais l'affichage des GM.
    const hideStarTabForPlayers = (sheet, html) => {
        if (game.user.isGM) return;
        if (!game.settings.get(MOD, "hidePlayerStarTab")) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;
        root.querySelectorAll("nav i.fa-star").forEach(ic => {
            const navItem = ic.closest("[data-tab]");
            if (!navItem || !navItem.closest("nav")) return;   // uniquement la barre d'onglets
            navItem.style.display = "none";
            const t = navItem.dataset.tab;
            if (t) { const panel = root.querySelector(`.tab[data-tab="${t}"]`); if (panel) panel.style.display = "none"; }
        });
    };
    Hooks.on("renderActorSheet",   (s, h) => hideStarTabForPlayers(s, h));
    Hooks.on("renderActorSheetV2", (s, h) => hideStarTabForPlayers(s, h));

    // Enregistrement au hook "setup" : garanti après tous les "init",
    // et game.settings est disponible.
    Hooks.once("setup", () => {
        const relOn    = game.settings.get(MOD, "relationsEnabled");
        const bestOn   = game.settings.get(MOD, "bestiaryEnabled");
        const carnetOn = game.settings.get(MOD, "carnetEnabled");
        // Onglet Note GM : uniquement si activé ET si l'utilisateur courant est GM
        // (la part n'existe pas du tout pour les joueurs → onglet + contenu privés).
        const gmNotesOn = game.settings.get(MOD, "enableGmNotes") && game.user?.isGM;

        // Aucun onglet custom demandé → on laisse la fiche dnd5e native.
        if (!relOn && !bestOn && !carnetOn && !gmNotesOn) return;

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
                ...(gmNotesOn ? { gmnotes: partDef("character-gmnotes.hbs") } : {}),
                ...(relOn    ? { relations: partDef("character-relations.hbs") } : {}),
                ...(bestOn   ? { bestiary:  partDef("character-bestiary.hbs")  } : {}),
                ...(carnetOn ? {
                    "carnet-journal":  partDef("character-journal.hbs"),
                    "carnet-downtime": partDef("character-downtime.hbs")
                } : {})
            };

            static TABS = [
                ...(gmNotesOn ? [{ tab: "gmnotes", group: "primary", label: "Note GM", icon: "fas fa-user-secret" }] : []),
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
                if (gmNotesOn) ctx.gmNotesHtml = buildGmNotesHtml(this.actor);
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
                if (gmNotesOn && partId === "gmnotes")        wireGmNotes(this.actor, htmlElement);
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
                if (gmNotesOn) customTabs.push("gmnotes");
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
