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

import { registerSettings, migrateCommonResources } from "./modules/settings.js";
import { MOD, ACTIVATION_CODE } from "./modules/const.js";
import { MigrationHooks }    from "./modules/migration.js";

// --- Phase 2 : Fiche PJ (Relations / Bestiaire / Carnet & Expéditions) ---
import { setupCharacterSheet } from "./modules/character-sheet.js";
import { RelationsHooks }      from "./modules/relations.js";
import { BestiaryHooks }       from "./modules/bestiary.js";
import { CarnetToolbarHooks }  from "./modules/carnet.js";
import { PcStatusHooks }       from "./modules/pcstatus.js";
import { SceneAudioHooks }     from "./modules/sceneaudio.js";

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
import { PlayerListHooks } from "./modules/playerlist.js";
import { ScenesHooks }    from "./modules/scenes.js";
import { DocumentHooks }  from "./modules/document.js";
import { JournalHooks }   from "./modules/journal.js";
import { SessionHooks }   from "./modules/session.js";
import { CasierHooks }    from "./modules/casier.js";
import { CharValidationHooks } from "./modules/charvalidation.js";
import { SourceControlHooks } from "./modules/sourcecontrol.js";
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
import { ensureTutorialActor }    from "./modules/demoactor.js";

Hooks.on("init", () => {
    // Police personnalisée "Enchanted Land" — enregistrée par code (la clé
    // "fonts" du manifeste n'est pas reconnue par le schéma Foundry v13/v14 et
    // déclenche un avertissement). CONFIG.fontDefinitions est la voie officielle.
    try {
        CONFIG.fontDefinitions["Enchanted Land"] = {
            editor: true,
            fonts: [
                { urls: ["modules/soruta-completed-westmarch/fonts/EnchantedLand.otf"], weight: "400", style: "normal" }
            ]
        };
        CONFIG.fontDefinitions["Perry Gothic"] = {
            editor: true,
            fonts: [
                { urls: ["modules/soruta-completed-westmarch/fonts/PerryGothic.ttf"], weight: "400", style: "normal" }
            ]
        };
    } catch (e) { console.warn("westmarch | Enregistrement des polices :", e); }

    // Helpers Handlebars hérités de westmarch (utilisés par les templates de chat).
    Handlebars.registerHelper("for", function (from, to, incr, block) {
        let accum = "";
        for (let i = from; i < to; i += incr) accum += block.fn(i);
        return accum;
    });
    Handlebars.registerHelper("lte", (a, b) => a <= b);

    registerSettings();

    // --- Protection dissuasive (code d'activation) ---
    // Si la protection est activée et que le code saisi ne correspond pas, on
    // n'initialise AUCUNE fonctionnalité (les réglages restent accessibles pour
    // saisir le code). Contournable en lisant le code source — purement dissuasif.
    if (game.settings.get(MOD, "protectionEnabled")
        && (game.settings.get(MOD, "activationCode") ?? "").trim() !== ACTIVATION_CODE) {
        console.warn("[soruta-completed-westmarch] Module non activé : code d'activation manquant ou invalide. Fonctionnalités désactivées.");
        Hooks.once("ready", async () => {
            if (!game.user?.isGM) return;
            ui.notifications?.error(
                "Soruta — Completed Westmarch : ce module est protégé et n'est pas activé sur ce serveur. "
                + "© Soruta — Tous droits réservés."
            );
            const entered = await promptActivationCode();
            if (entered == null) return;                       // annulé
            await game.settings.set(MOD, "activationCode", entered.trim());
            if (entered.trim() === ACTIVATION_CODE) foundry.utils.debouncedReload();
            else ui.notifications?.error("Code d'activation invalide.");
        });
        return;   // on arrête là : aucune feature n'est enregistrée
    }

    // --- Phase 2 : Fiche PJ ---
    // RelationsHooks avant BestiaryHooks : relations est l'injecteur "primaire"
    // des boutons d'en-tête (Anonyme / Révéler / Exclure) ; bestiary saute
    // l'injection si relations l'a déjà faite (double-guard par classes CSS).
    RelationsHooks();
    BestiaryHooks();
    CarnetToolbarHooks();
    PcStatusHooks();
    SceneAudioHooks();
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
    PlayerListHooks();
    ScenesHooks();
    DocumentHooks();
    JournalHooks();
    SessionHooks();
    CasierHooks();
    CharValidationHooks();
    SourceControlHooks();
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
    if (!scwmActivated()) return;   // module non activé → rien

    // Midi Range Fix : enregistré en "ready" (pas "init") pour passer APRÈS
    // le listener canvasReady de midi-qol (qui s'inscrit lui-même en "ready").
    RangeFixHooks();

    // Recopie une fois les anciens dossiers/compendiums par feature vers la
    // nouvelle section commune « Dossiers & Compendiums ».
    migrateCommonResources();

    // Fiche démo du tutoriel : créée une fois au premier chargement GM.
    ensureTutorialActor();

    // Fenêtre de bienvenue — légère temporisation pour laisser l'UI se stabiliser.
    setTimeout(() => showWelcomeIfNeeded(), 1000);
});

// Migration automatique des données des anciens modules (une seule fois, au ready GM).
// (Non gardée par l'activation : ne fait que recopier d'anciennes données — sans
// intérêt pour un téléchargement neuf qui n'en a aucune.)
MigrationHooks();

// Vérifie l'activation (protection désactivée OU code correct).
function scwmActivated() {
    return !game.settings.get(MOD, "protectionEnabled")
        || (game.settings.get(MOD, "activationCode") ?? "").trim() === ACTIVATION_CODE;
}

// Fenêtre demandant le code d'activation (MJ). Retourne la saisie ou null.
async function promptActivationCode() {
    try {
        return await foundry.applications.api.DialogV2.wait({
            window: { title: "Soruta — Completed Westmarch", icon: "fas fa-shield-halved" },
            content: `<p style="margin:0 0 8px;">Ce module est protégé. Saisissez le code d'activation pour l'activer sur ce serveur.</p>
                      <input type="text" name="scwm-code" style="width:100%;box-sizing:border-box;" placeholder="Code d'activation" autofocus>`,
            rejectClose: false,
            buttons: [
                { action: "ok", label: "Activer", icon: "fas fa-check", default: true,
                  callback: (ev, btn) => btn.form.elements["scwm-code"]?.value ?? "" },
                { action: "cancel", label: "Annuler", icon: "fas fa-xmark", callback: () => null }
            ]
        });
    } catch (e) { return null; }
}
