// ============================================================
// index.js — Point d'entrée unique du module fusionné
// Soruta — Completed Westmarch
//
// Regroupe les 9 anciens modules Soruta. Chaque feature garde son
// fichier dans modules/ ; toutes sont initialisées ici.
// Les settings et flags sont sous le namespace unique MOD (const.js),
// avec migration automatique des données existantes (migration.js).
// © 2026 Soruta.
// ============================================================

import { registerSettings } from "./modules/settings.js";
import { MigrationHooks }    from "./modules/migration.js";

// --- Phase 2 : Fiche PJ (Relations / Bestiaire / Carnet & Expéditions) ---
import { setupCharacterSheet } from "./modules/character-sheet.js";
import { RelationsHooks }      from "./modules/relations.js";
import { BestiaryHooks }       from "./modules/bestiary.js";
import { CarnetToolbarHooks }  from "./modules/carnet.js";

// --- Phase 3 : Toolkit ---
import { RageHooks }         from "./modules/rage.js";
import { GoliathHooks }      from "./modules/goliath.js";
import { PolymorphHooks }    from "./modules/polymorph.js";
import { TokenHooks }        from "./modules/token.js";
import { ItemHooks }         from "./modules/items.js";
import { TgcmHooks }         from "./modules/tgcm.js";
import { FolderMoveHooks }   from "./modules/foldermove.js";
import { MejShopHooks }      from "./modules/mejshop.js";
import { MejRestockHooks }   from "./modules/mejrestock.js";
import { ExportDialogHooks } from "./modules/export-dialog.js";
import { TemplateHooks }     from "./modules/template.js";
import { HotbarHooks }       from "./modules/hotbar.js";
import { ConnStatsHooks }    from "./modules/connstats.js";

// --- Phase 4 : Westmarch core ---
import { ChatHooks }      from "./modules/chat.js";
import { ImageHooks }     from "./modules/image.js";
import { PlayerHooks }    from "./modules/player.js";
import { ScenesHooks }    from "./modules/scenes.js";
import { DocumentHooks }  from "./modules/document.js";
import { JournalHooks }   from "./modules/journal.js";
import { SessionHooks }   from "./modules/session.js";
import { AntiCheatHooks } from "./modules/anticheat.js";
import { SocketHooks }    from "./modules/socket.js";
import { CombatHooks }    from "./modules/combat.js";
import { AudioHooks }     from "./modules/audio.js";
import { PartyPauseHooks } from "./modules/partypause.js";

// --- Phase 5 : Serveur ---
import { SocketHooks as ServeurSocketHooks } from "./modules/serveur-socket.js";
import { XpHooks }          from "./modules/xp.js";
import { CalDateHooks }     from "./modules/caldate.js";
import { DiscordLogHooks }  from "./modules/discordlog.js";
import { FakeWarningHooks } from "./modules/fake-warning.js";
import { TmHooks }          from "./modules/tm.js";

// --- Phase 6 : Carte / Midi / Tutoriel ---
import { MapHooks }              from "./modules/map.js";
import { RangeFixHooks }         from "./modules/range-fix.js";
import { registerTutorielButton } from "./modules/toolbar.js";
import { showWelcomeIfNeeded }    from "./modules/welcome.js";

Hooks.on("init", () => {
    // Helpers Handlebars hérités de westmarch (utilisés par les templates de chat).
    Handlebars.registerHelper("for", function (from, to, incr, block) {
        let accum = "";
        for (let i = from; i < to; i += incr) accum += block.fn(i);
        return accum;
    });
    Handlebars.registerHelper("lte", (a, b) => a <= b);

    registerSettings();

    // --- Phase 2 : Fiche PJ ---
    // RelationsHooks avant BestiaryHooks : relations est l'injecteur "primaire"
    // des boutons d'en-tête (Anonyme / Révéler / Exclure) ; bestiary saute
    // l'injection si relations l'a déjà faite (double-guard par classes CSS).
    RelationsHooks();
    BestiaryHooks();
    CarnetToolbarHooks();
    setupCharacterSheet();   // enregistre la fiche au hook "setup"

    // --- Phase 3 : Toolkit ---
    RageHooks();
    GoliathHooks();
    PolymorphHooks();
    TokenHooks();
    ItemHooks();
    TgcmHooks();
    FolderMoveHooks();
    MejShopHooks();
    MejRestockHooks();
    ExportDialogHooks();
    TemplateHooks();
    HotbarHooks();
    ConnStatsHooks();

    // --- Phase 4 : Westmarch core (ordre d'origine) ---
    ChatHooks();
    ImageHooks();
    PlayerHooks();
    ScenesHooks();
    DocumentHooks();
    JournalHooks();
    SessionHooks();
    AntiCheatHooks();
    SocketHooks();
    CombatHooks();
    AudioHooks();
    PartyPauseHooks();

    // --- Phase 5 : Serveur (ordre d'origine) ---
    ServeurSocketHooks();
    XpHooks();
    CalDateHooks();
    DiscordLogHooks();
    FakeWarningHooks();
    TmHooks();

    // --- Phase 6 : Carte + Tutoriel (init) ---
    MapHooks();
    // Bouton tutoriel enregistré en "init" pour que getSceneControlButtons
    // soit déjà écouté quand Foundry construit la barre. Le hook vérifie
    // lui-même le setting tutoEnabled (voir toolbar.js) : on l'enregistre
    // donc toujours, sans le gater ici.
    registerTutorielButton();
});

Hooks.on("ready", () => {
    // Midi Range Fix : enregistré en "ready" (pas "init") pour passer APRÈS
    // le listener canvasReady de midi-qol (qui s'inscrit lui-même en "ready").
    RangeFixHooks();

    // Fenêtre de bienvenue — légère temporisation pour laisser l'UI se stabiliser.
    setTimeout(() => showWelcomeIfNeeded(), 1000);
});

// Migration automatique des données des anciens modules (une seule fois, au ready GM).
MigrationHooks();
