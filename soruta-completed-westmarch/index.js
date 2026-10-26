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
import { journal, registerLogSettings, surveillerErreurs } from "./modules/log.js";
import { MOD } from "./modules/const.js";
import { licenceValide, noterEtatInitial, controlerLicence, proposerActivation, renouvelerJetonExpire } from "./modules/licence.js";
import { MigrationHooks }    from "./modules/migration.js";
import { SiteHooks }         from "./modules/site.js";

// --- Phase 2 : Fiche PJ (Relations / Bestiaire / Carnet & Expéditions) ---
import { setupCharacterSheet } from "./modules/character-sheet.js";
import { RelationsHooks }      from "./modules/relations.js";
import { BestiaryHooks }       from "./modules/bestiary.js";
import { Tidy5eCompatHooks }   from "./modules/tidy5e-compat.js";
import { CarnetToolbarHooks }  from "./modules/carnet.js";
import { PcStatusHooks }       from "./modules/pcstatus.js";
import { SceneAudioHooks }     from "./modules/sceneaudio.js";

// --- Phase 3 : Toolkit ---
import { RageHooks }         from "./modules/rage.js";
import { GoliathHooks }      from "./modules/goliath.js";
import { HealerHooks }       from "./modules/healer.js";
import { AlertHooks }        from "./modules/alert.js";
import { GereHooks }         from "./modules/gere.js";
import { BeastHooks }        from "./modules/beast.js";
import { PolymorphHooks }    from "./modules/polymorph.js";
import { TokenHooks }        from "./modules/token.js";
import { ItemHooks }         from "./modules/items.js";
import { TgcmHooks }         from "./modules/tgcm.js";
import { FolderMoveHooks }   from "./modules/foldermove.js";
import { MejShopHooks }      from "./modules/mejshop.js";
import { MejRestockHooks }   from "./modules/mejrestock.js";
import { ExportDialogHooks } from "./modules/export-dialog.js";
import { TemplateHooks }     from "./modules/template.js";
import { ConnStatsHooks }    from "./modules/connstats.js";

// --- Phase 4 : Westmarch core ---
import { ChatHooks }      from "./modules/chat.js";
import { ImageHooks }     from "./modules/image.js";
import { PlayerHooks }    from "./modules/player.js";
import { PlayerListHooks } from "./modules/playerlist.js";
import { TradeHooks }      from "./modules/trade.js";
import { ScenesHooks }    from "./modules/scenes.js";
import { DocumentHooks }  from "./modules/document.js";
import { JournalHooks }   from "./modules/journal.js";
import { SessionHooks }   from "./modules/session.js";
import { StarXpHooks }    from "./modules/starxp.js";
import { PantheonHooks }  from "./modules/pantheon.js";
import { NoteLinkHooks }  from "./modules/notelink.js";
import { CasierHooks }    from "./modules/casier.js";
import { CharValidationHooks } from "./modules/charvalidation.js";
import { SourceControlHooks } from "./modules/sourcecontrol.js";
import { CurrencyHooks } from "./modules/currency.js";
import { HarvestHooks }       from "./modules/harvest.js";
import { CompanionHooks }     from "./modules/companions.js";
import { AntiCheatHooks } from "./modules/anticheat.js";
import { SocketHooks }    from "./modules/socket.js";
import { CombatHooks }    from "./modules/combat.js";
import { AudioHooks }     from "./modules/audio.js";
import { PartyPauseHooks } from "./modules/partypause.js";

// --- Phase 5 : Serveur ---
import { SocketHooks as ServeurSocketHooks } from "./modules/serveur-socket.js";
import { XpHooks }          from "./modules/xp.js";
import { XpProgressHooks }  from "./modules/xpprogress.js";
import { MondeHooks }       from "./modules/monde.js";
import { RangementHooks }   from "./modules/rangement.js";
import { CalDateHooks }     from "./modules/caldate.js";
import { DiscordLogHooks }  from "./modules/discordlog.js";
import { FakeWarningHooks } from "./modules/fake-warning.js";
import { TmHooks }          from "./modules/tm.js";

// --- Phase 6 : Carte / Midi / Tutoriel ---
import { MapHooks }              from "./modules/map.js";
import { UiHideHooks }           from "./modules/uihide.js";
import { AccessibilityHooks }    from "./modules/accessibility.js";
import { CombatRemindersHooks }  from "./modules/combatreminders.js";
import { RangeFixHooks }         from "./modules/range-fix.js";
import { registerTutorielButton } from "./modules/toolbar.js";
import { showWelcomeIfNeeded }    from "./modules/welcome.js";
import { ensureTutorialActor }    from "./modules/demoactor.js";
import { tl, registerLangueSetting } from "./modules/i18n.js";

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
    } catch (e) { journal.critique(tl("westmarch | Enregistrement des polices :"), e); }

    // Helpers Handlebars hérités de westmarch (utilisés par les templates de chat).
    Handlebars.registerHelper("for", function (from, to, incr, block) {
        let accum = "";
        for (let i = from; i < to; i += incr) accum += block.fn(i);
        return accum;
    });
    Handlebars.registerHelper("lte", (a, b) => a <= b);

    registerLangueSetting();   // langue du module (par utilisateur), avant tout le reste
    registerSettings();
    registerLogSettings();   // mode verbeux (par joueur)

    // --- Langue : anglais par défaut, français pour les clients en français ---
    Handlebars.registerHelper("scwmT", (s) => tl(String(s ?? "")));
    // Noms de dossiers par défaut : fixés une fois dans la langue du MJ, pour
    // que tous les clients (quelle que soit leur langue) lisent le même nom.
    Hooks.once("ready", async () => {
        if (!game.users?.activeGM?.isSelf) return;
        for (const [cle, fr] of [["charValidationFolder", tl("Personnages")], ["mondeFolderPlace", tl("Lieux")]]) {
            try {
                const stocke = game.settings.storage.get("world")?.getSetting?.(`${MOD}.${cle}`);
                if (!stocke) await game.settings.set(MOD, cle, tl(fr));
            } catch { /* réglage absent : rien à faire */ }
        }
    });
    surveillerErreurs();     // erreurs non rattrapées du module → journal + contact

    // --- Licence (validée par le serveur licence.altheia.eu, voir licence.js) ---
    // Sans licence valide pour CE monde, on n'initialise AUCUNE fonctionnalité
    // (la fenêtre « À propos » reste accessible). La signature du jeton est
    // vérifiée au « ready » par controlerLicence().
    const _licenceOk   = noterEtatInitial();
    const _deactivated = game.settings.get(MOD, "moduleDeactivated") === true;
    if (!_licenceOk || _deactivated) {
        journal.info(tl("[soruta-completed-westmarch] Module inactif ({0}). Fonctionnalités désactivées. La fenêtre « À propos » reste accessible dans les réglages du module.", _deactivated ? tl("désactivé via code") : tl("licence absente, expirée ou invalide")));
        if (_deactivated) return;   // désactivé : les réglages « À propos » suffisent (réactivation par code)
        Hooks.once("ready", async () => {
            if (!game.user?.isGM) return;
            // Jeton simplement expiré (monde fermé > 7 jours) : renouvellement automatique.
            if (await renouvelerJetonExpire()) return;   // licence rétablie : les clients rechargent
            ui.notifications?.error(
                tl("Soruta — Completed Westmarch : ce module nécessite une licence et n'est pas activé sur ce monde. ")
                + tl("© Soruta — Tous droits réservés.")
            );
            await proposerActivation();
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
    Tidy5eCompatHooks();     // ré-injecte les onglets dans les fiches Tidy5e (si présent)

    // --- Phase 3 : Toolkit ---
    RageHooks();
    GoliathHooks();
    HealerHooks();
    AlertHooks();
    GereHooks();
    BeastHooks();
    PolymorphHooks();
    TokenHooks();
    ItemHooks();
    TgcmHooks();
    FolderMoveHooks();
    MejShopHooks();
    MejRestockHooks();
    ExportDialogHooks();
    TemplateHooks();
    ConnStatsHooks();

    // --- Phase 4 : Westmarch core (ordre d'origine) ---
    ChatHooks();
    ImageHooks();
    PlayerHooks();
    PlayerListHooks();
    TradeHooks();
    ScenesHooks();
    DocumentHooks();
    JournalHooks();
    SessionHooks();
    StarXpHooks();
    PantheonHooks();
    NoteLinkHooks();
    CasierHooks();
    CharValidationHooks();
    SourceControlHooks();
    CurrencyHooks();
    HarvestHooks();
    CompanionHooks();
    AntiCheatHooks();
    SocketHooks();
    CombatHooks();
    AudioHooks();
    PartyPauseHooks();

    // --- Phase 5 : Serveur (ordre d'origine) ---
    ServeurSocketHooks();
    XpHooks();
    XpProgressHooks();      // niveau max du serveur (XP plafonnée, montée bloquée)
    MondeHooks();           // registre du monde : boutons et menus des fiches PNJ / lieux
    RangementHooks();       // « Où ranger quoi ? » : journal guide régénéré si les réglages changent
    CalDateHooks();
    DiscordLogHooks();
    FakeWarningHooks();
    TmHooks();

    // --- Phase 6 : Carte + Tutoriel (init) ---
    MapHooks();
    UiHideHooks();
    AccessibilityHooks();
    CombatRemindersHooks();
    // Bouton tutoriel enregistré en "init" pour que getSceneControlButtons
    // soit déjà écouté quand Foundry construit la barre. Le hook vérifie
    // lui-même le setting tutoEnabled (voir toolbar.js) : on l'enregistre
    // donc toujours, sans le gater ici.
    registerTutorielButton();
});

Hooks.on("ready", () => {
    if (!scwmActivated()) return;   // module non activé → rien

    // Licence : vérifie la signature du jeton, puis le renouvelle une fois par jour.
    controlerLicence();

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

// Message aux MJ (une fois par version) avec le lien de la page du module sur
// le site d'Althéia. Non gardé par la licence : il indique aussi où l'obtenir.
SiteHooks();

// Vérifie l'activation : le module ne fonctionne qu'avec une licence valide pour ce monde.
function scwmActivated() {
    if (game.settings.get(MOD, "moduleDeactivated") === true) return false;
    return licenceValide();
}
