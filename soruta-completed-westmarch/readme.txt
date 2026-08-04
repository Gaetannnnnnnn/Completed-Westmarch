================================================================================
                   SORUTA — COMPLETED WESTMARCH
                   Module Foundry VTT — Privé
================================================================================

Version : 1.1.2
Auteur  : Soruta (Discord : s0ruta)
Système : dnd5e sur Foundry VTT v13+ (ciblé v14)
Accès   : © 2026 Soruta — Tous droits réservés. Usage personnel autorisé.
          Toute redistribution, modification ou usage commercial est
          strictement interdit sans autorisation écrite.

--------------------------------------------------------------------------------
DESCRIPTION
--------------------------------------------------------------------------------

Module West March unifié. Regroupe en un seul paquet l'ensemble des anciens
modules Soruta, jusque-là distribués séparément :

  westmarch · serveur · toolkit · relations · bestiaire
  carnet · carte-expeditions · midi-range-fix · tutoriel

Toutes les fonctionnalités restent activables / désactivables individuellement
depuis les paramètres du module. Les données (settings et flags) sont désormais
regroupées sous un identifiant unique : "soruta-completed-westmarch".

MIGRATION AUTOMATIQUE — Au premier chargement par un GM, le module reprend
automatiquement toutes les données des anciens modules (réglages + flags sur
les acteurs, scènes, tokens, joueurs, objets, journaux, pages et combats) et
les recopie sous le nouvel identifiant. Opération non destructive (les anciennes
données sont laissées en place) et exécutée une seule fois. Voir migration.js.

--------------------------------------------------------------------------------
ARCHITECTURE
--------------------------------------------------------------------------------

index.js
   Point d'entrée unique. Enregistre les helpers Handlebars, les settings, puis
   initialise toutes les features au hook "init" (et Midi Range Fix + fenêtre de
   bienvenue au hook "ready"). Lance la migration au premier "ready" GM.

modules/const.js
   Constantes partagées : MOD (namespace unique), LEGACY_IDS (anciens modules,
   pour la migration), TUTO_TOGGLES (sections du tutoriel).

modules/settings.js
   Tous les paramètres des 9 anciens modules sous un namespace unique. Les clés
   en collision ont été préfixées par domaine (relations*, bestiary*, carnet*,
   rangeFix*, tuto*). Bannière, séparateurs de sections, sélecteurs de dossiers
   et de scène, cascade visuelle du système de Party.

modules/migration.js
   Reprise automatique des settings et des flags des anciens modules vers MOD.
   Remappe la seule clé de flag en collision : "list" → "relationsList" /
   "bestiaryList". Idempotente (suivi via le setting "migrationVersion").

FICHE PERSONNAGE
   character-sheet.js  — Une seule sous-classe dnd5e (PARTS/TABS) composant les
                         onglets Relations / Bestiaire / Carnet / Expéditions
                         selon les settings activés.
   relations.js        — Système de relations entre acteurs (flag relationsList).
   bestiary.js         — Bestiaire par personnage (flag bestiaryList).
   carnet.js           — Onglets Carnet (notes ProseMirror) et Expéditions
                         (dates + durée), bouton "Date Expédition" dans la barre.

WESTMARCH CORE
   chat.js combat.js player.js session.js anticheat.js scenes.js journal.js
   image.js audio.js document.js socket.js
   — Party, filtrage du chat, combat par party, journal de session, anti-cheat,
     téléportation de groupe, partage d'images.

SERVEUR
   tm.js         — Temps morts (gain de compétence + artisanat, panier, validation GM).
   xp.js         — Blocage XP / Level Up côté joueur.
   caldate.js    — Notification Discord au changement de date (Simple Calendar).
   discordlog.js — Logs Discord des modifications (objets, monnaie, XP, persos).
   fake-warning.js + serveur-socket.js — Faux message d'avertissement GM (queries v13).

TOOLKIT
   rage.js goliath.js polymorph.js token.js items.js tgcm.js foldermove.js
   mejshop.js mejrestock.js export-dialog.js template.js
   — Tailles Large (Rage/Goliath), transformation de token, apparences multiples,
     protégé TGCM, correction stat des outils, déplacer/dupliquer, correctifs et
     réapprovisionnement des boutiques MEJ, export "fiche originale", snap AoE.

CARTE / MIDI / TUTORIEL
   map.js        — Carte des expéditions (fog par party et par personnage).
   range-fix.js  — Correction de portée midi-qol pour tokens Large+.
   tutorial.js welcome.js toolbar.js — Fenêtre de bienvenue + tutoriel interactif.

templates/   — Onglets de fiche (character-relations/bestiary/journal/downtime.hbs).
styles/      — Feuilles de style de toutes les features.

--------------------------------------------------------------------------------
DÉPENDANCES
--------------------------------------------------------------------------------

Obligatoire :
  - dnd5e v3+ (système de jeu)

Optionnelles (une feature se désactive silencieusement si absente) :
  - midi-qol            — requis par Midi Range Fix
  - Monk's Enhanced Journal — requis par les correctifs et le restock des boutiques
  - Simple Calendar     — dates (fallback ; game.time.calendar utilisé en priorité)
  - monks-tokenbar      — interaction avec le déplacement en combat
  - lib-wrapper         — snap live des templates AoE

--------------------------------------------------------------------------------
PARAMÈTRES CONFIGURABLES
--------------------------------------------------------------------------------

Paramètres du jeu → Configuration des modules → Soruta — Completed Westmarch

Regroupés par section : Système de Party · Serveur · Toolkit ·
Fiche PJ (Relations / Bestiaire / Carnet) · Carte des expéditions ·
Midi Range Fix · Tutoriel.

--------------------------------------------------------------------------------
NOTE DE FUSION (clés renommées)
--------------------------------------------------------------------------------

Collisions résolues lors de la fusion :
  Settings :
    relations (enabled/anonymization/folderPJ/folderPNJ/folderCreatures)
      → relationsEnabled / relationsAnonymization / relationsFolderPJ / …
    bestiaire (enabled/anonymization/folderPJ/packCreatures/folderCreatures)
      → bestiaryEnabled / bestiaryAnonymization / bestiaryFolderPJ / …
    carnet.enabled              → carnetEnabled
    midi-range-fix.enabled      → rangeFixEnabled  (rangeAdjust inchangé)
    tutoriel.<toggles>          → tuto<Toggle>      (serverName/showWelcome inchangés)
  Flags :
    relations « list »          → relationsList
    bestiaire « list »          → bestiaryList
    (toutes les autres clés convergent sans conflit : partyId, tm,
     carnetNotes, expeditions, tgcm, polymorphForms, images, restock, etc.)

--------------------------------------------------------------------------------
COMPTES JOUEURS
--------------------------------------------------------------------------------

Les comptes joueurs (non-GM) ne peuvent pas exécuter de commandes console.
Tout diagnostic doit passer par le compte GM en reproduisant l'interaction UI.

================================================================================
                   COMPLETED WESTMARCH — MISES À JOUR
================================================================================

v1.1.2 | 2026-08-04
   - Éditeur de notes (Carnet) habillé en "grimoire" : page de parchemin vieilli
     (taches, dégradé, bords assombris), encre sépia, en-tête cuir, titres à
     l'encre rouge/brune, plume plus grande. Classe .carnet-grimoire sur le
     dialog + styles dans carnet.css.

v1.1.1 | 2026-08-04
   - Éditeur de notes (Carnet) : police par défaut "Enchanted Land" (fournie
     dans fonts/EnchantedLand.otf, enregistrée via module.json + CSS), appliquée
     à l'édition et à l'affichage des notes. Repli Signika si absente.

v1.1.0 | 2026-08-04
   - Boutons "Ajouter" de Relations et Bestiaire harmonisés avec le style doré
     des boutons Carnet & Expéditions (retrait du style gris inline, style CSS).

v1.0.9 | 2026-08-04
   - Fix chat : le template des onglets IC/OOC/Autre n'avait pas été copié lors
     de la fusion et le chemin pointait encore vers "modules/westmarch/...". Le
     chat restait bloqué sur l'onglet IC et masquait les cartes de jets (type
     OTHER). Template recréé, chemin corrigé, et les onglets sont désormais
     conditionnés au réglage "Filtrage du chat par party" (désactivable).

v1.0.8 | 2026-08-03
   - Bestiaire : détection des créatures fiabilisée. En plus du lien compendium
     et de compendiumSource, ajout d'un repli par nom (l'acteur du token
     correspond à une entrée du compendium, via son index mis en cache) — la
     détection marche quelle que soit la façon dont le token a été posé.

v1.0.7 | 2026-08-03
   - Relations : retrait du bouton "Ajouter une relation" de l'état vide de
     l'onglet (le bouton "+ Ajouter" du bandeau, GM, reste inchangé).

v1.0.6 | 2026-08-03
   - Fix : les boutons de configuration n'apparaissaient pas (module absent de
     la liste des réglages). registerMenu exige un type sous-classe de
     FormApplication/ApplicationV2 ; le launcher des catégories étend désormais
     ApplicationV2.

v1.0.5 | 2026-08-03
   - Temps morts entièrement paramétrable (nouvelle catégorie "Temps morts") :
     valeurs (base, bonus maîtrise/expertise/outils, mod de carac, seuil du jet
     d20), formules éditables (gain journalier, coût/durée de craft non-magique,
     évaluées en sécurité côté GM) et tables (parchemins 0→9, objets magiques par
     rareté) éditées en champs structurés. Les labels de l'UI reflètent les
     valeurs configurées. Défauts = anciennes règles (aucun changement si non
     modifié).

v1.0.4 | 2026-08-03
   - Bestiaire : utilise désormais uniquement le compendium des créatures
     (réglage "Compendium des créatures"). Le dossier de créatures est abandonné
     (réglage "Dossier des créatures (legacy)" retiré). La détection auto
     reconnaît aussi les acteurs importés depuis ce compendium (compendiumSource).

v1.0.3 | 2026-08-03
   - Rapport de session refondu : plus de "Create Party with Log" ni de journaux
     auto. Le "Create Party" normal démarre le suivi ; "Clore la session" envoie
     le récap (même contenu qu'avant : joueurs/XP, ennemis, PNJ, objets) sur un
     webhook Discord (nouveau réglage "URL du Webhook Discord (rapport de session)"
     dans la section Système de Party).

v1.0.2 | 2026-08-03
   - Config du module refondue en menus par catégorie : chaque grande section
     (Party, Serveur, Toolkit, Fiche PJ, Carte, Midi, Tutoriel) est un bouton
     "Configurer" qui ouvre une fenêtre dédiée. Tous les réglages passent en
     config:false et sont édités via ces fenêtres (registerMenu + DialogV2).

v1.0.1 | 2026-08-03
   - Retrait de la fonctionnalité Webhook Discord (chat IC par scène) et de la
     lib TurndownService associée.
   - Retrait des mentions "Ashara" (branding). Les identifiants legacy des
     anciens modules sont conservés uniquement pour la migration des données.
   - Ajout : masquage de la barre de macros pour les joueurs (réglage Toolkit,
     "enableHideHotbar", live, GM exclu).

v1.0.0 | 2026-08-03
   Fusion initiale des 9 modules Soruta en un module unique
   "soruta-completed-westmarch", ciblé Foundry VTT v14.
   - Namespace unique pour tous les settings et flags.
   - Fiche PJ unifiée : une seule sous-classe compose Relations, Bestiaire,
     Carnet et Expéditions (fin de la cascade de fiches entre modules).
   - Migration automatique et non destructive des données des anciens modules
     au premier lancement (settings + flags de tous les types de documents),
     avec remappage des clés en collision (list → relationsList / bestiaryList).
   - Barre WestMarch, sockets/queries et hooks inter-features conservés.
