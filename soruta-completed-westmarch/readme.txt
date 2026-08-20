================================================================================
                   SORUTA — COMPLETED WESTMARCH
                   Module Foundry VTT — Privé
================================================================================

Version : 3.4.9
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

Le module a depuis été enrichi de nombreuses fonctions West March propres au
serveur : Casier du MJ (tableau de bord), validation des personnages (demande,
verrouillage, montée de niveau, limites & stock), cues audio de mise en scène,
onglet Note GM privé, statut de disponibilité des PJ, pause de party, et un
regroupement central des dossiers/compendiums communs (« Dossiers & Compendiums »).

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
                         onglets Relations / Bestiaire / Carnet / Expéditions et
                         Note GM (privé, GM) selon les settings activés. Masque
                         aussi l'onglet « étoile » aux joueurs (option).
   relations.js        — Système de relations entre acteurs (flag relationsList).
   bestiary.js         — Bestiaire par personnage (flag bestiaryList).
   carnet.js           — Onglets Carnet (notes ProseMirror) et Expéditions
                         (dates + durée), bouton "Date Expédition" dans la barre.
   pcstatus.js         — Badge de disponibilité des PJ (Disponible / En expédition)
                         dans le répertoire des Acteurs, déduit des expéditions.

WESTMARCH CORE
   chat.js combat.js player.js playerlist.js session.js anticheat.js scenes.js
   journal.js image.js audio.js document.js socket.js partypause.js connstats.js
   — Party, filtrage du chat, combat par party (blocage de mouvement hors tour
     natif), pause de party (remplace le pause global, banner natif), liste des
     joueurs compacte, journal / clôture de session, anti-cheat, téléportation
     de groupe, partage d'images, stats de connexion, audio cloisonné par party.

GESTION DES PERSONNAGES & MENEUR
   casier.js         — Tableau de bord du MJ (bouton WestMarch) : onglets
                       Dashboard, Rapports, Expéditions, Temps morts (validation
                       embarquée), Validation des personnages, Suivi des GM.
   charvalidation.js — Cycle de vie des PJ : demande de création → validation GM
                       (acteur créé dans « Joueurs / <joueur> », propriétaire =
                       joueur), construction, soumission, verrouillage sélectif
                       (construction bloquée / jeu libre), montée de niveau
                       validée, limites de persos et système de stock (Observateur).

MISE EN SCÈNE
   sceneaudio.js     — Cues audio (bouton WestMarch, GM) : sons préparés avec
                       seconde de départ / volume / fondu, déclencheurs (manuel,
                       révélation d'un token, début de combat), lecture locale par
                       party (faible latence), navigateur de playlists monde/compendiums.

SERVEUR
   tm.js         — Temps morts (gain de compétence + artisanat ; ajout automatique
                   de l'objet fabriqué depuis un compendium ; validation dans le Casier).
   xp.js         — Blocage XP / Level Up côté joueur (levé pendant la création d'un
                   perso et lors d'une montée de niveau validée par le MJ).
   caldate.js    — Notification Discord au changement de date (API calendrier
                   native game.time.calendar — Mini Calendar, etc.).
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

templates/   — Onglets de fiche (character-relations / bestiary / journal /
               downtime / gmnotes .hbs).
styles/      — Feuilles de style de toutes les features (dont casier, charvalidation,
               sceneaudio, pcstatus, gmnotes, partypause, connstats, playerlist).

--------------------------------------------------------------------------------
DÉPENDANCES
--------------------------------------------------------------------------------

Obligatoire :
  - dnd5e v3+ (système de jeu)

Optionnelles (une feature se désactive silencieusement si absente) :
  - midi-qol            — requis par Midi Range Fix
  - Monk's Enhanced Journal — requis par les correctifs et le restock des boutiques
  - Mini Calendar       — calendrier du monde (dates du Carnet, notif Discord de
                          changement de jour). Le module lit l'API native
                          game.time.calendar : tout module de calendrier v13
                          (Mini Calendar, etc.) convient, aucune dépendance figée.
  - lib-wrapper         — snap live des templates AoE

Le blocage de mouvement hors tour en combat est désormais natif (setting
"Blocage de mouvement hors tour") : Monk's TokenBar n'est plus nécessaire.

--------------------------------------------------------------------------------
PARAMÈTRES CONFIGURABLES
--------------------------------------------------------------------------------

Paramètres du jeu → Configuration des modules → Soruta — Completed Westmarch

Regroupés par section : Dossiers & Compendiums · Système de Party ·
Création de personnages · Serveur (dont Note GM) · Temps morts · Toolkit ·
Fiche PJ (Relations / Bestiaire / Carnet) · Carte des expéditions ·
Mise en scène — Cues audio · Midi Range Fix · Tutoriel.

La section « Dossiers & Compendiums » centralise, à un seul endroit, les dossiers
et compendiums communs (PJ, PNJ, cimetière, créatures, objets craftables, dossier
des nouveaux personnages) utilisés par toutes les fonctions.

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

v3.2.4 | 2026-08-04
   - Reglages : bandeau "droits & version" en tete de chaque fenetre de reglages.

v3.2.3 | 2026-08-04
   - Temps morts : reprise des apports du module autonome "downtime". Table des
     multiplicateurs du test de competence desormais editable (reglages), au lieu
     du code en dur ; interrupteur Reliable Talent (tmReliableTalent) ; champ
     "Bonus au jet" (valeur fixe ou des + provenance) ajoute au test, pris en compte
     dans l'apercu et le calcul. (const.js, settings.js, tm.js)

v3.2.2 | 2026-08-04
   - Diagnostic (carte des expeditions) : logs console [CE] au changement de
     personnage assigne, pour tracer la synchro d'ownership et la permutation de
     fog. (map.js)

v3.2.1 | 2026-08-04
   - Controle des sources : nouveau reglage "Champ compare" (menu deroulant) pour
     choisir si les listes portent sur le champ Book (livre) ou Identifier
     (identifiant precis de l'objet), ou les deux. (sourcecontrol.js, settings.js)

v3.2.0 | 2026-08-04
   - Controle des sources : filtrage par TYPE au sein d'une source. Syntaxe des
     listes : "Source" (tous types) ou "Source : type1, type2" (entrees separees
     par ";"). Types : race, classe, sous-classe, don, sort, historique, objet.
     Permet ex. d'autoriser seulement les races d'un livre mais pas ses sous-classes.
     Retro-compatible avec l'ancienne liste par virgules. (sourcecontrol.js, settings.js)

v3.1.9 | 2026-08-04
   - Controle des sources : nouveau reglage "Correspondance exacte des sources"
     (active par defaut). En exact, "PHB" n'autorise pas "XPHB" (PHB 2024) et les
     sources proches ne sont plus confondues. Mode souple (contient) disponible en
     option. (sourcecontrol.js, settings.js)

v3.1.8 | 2026-08-04
   - Nouveau : Controle des sources. Reglemente les livres/extensions D&D
     (Xanathar, Tal'Dorei, etc.) autorises sur les fiches PJ via deux listes
     blanches distinctes (joueurs / MJ). Le contenu d'une source non autorisee est
     bloque + avertissement, quelle que soit la methode d'ajout (Plutonium/5etools,
     glisser-deposer, manuel). Detection via system.source + flags. Option de
     blocage du contenu sans source. (sourcecontrol.js, settings.js, index.js)

v3.1.7 | 2026-08-04
   - Cues audio : correction d'affichage — la grille Depart/Volume/Fondu/Boucle et
     la ligne Declencheur ne se chevauchent plus (espacement vertical du corps du
     cue). (sceneaudio.css)

v3.1.6 | 2026-08-04
   - Rapports de session Discord : prise en charge des salons de type Forum
     (nouveau reglage "Salon Discord de type Forum"). Les rapports sont regroupes
     dans un post (fil) de forum par meneur, cree au 1er rapport puis reutilise
     (thread_id memorise). Salon textuel classique inchange. (settings.js, session.js)

v3.1.5 | 2026-08-04
   - Carte des expeditions : fiabilisation de la sauvegarde de fog quand l'onglet
     du joueur est en arriere-plan (navigateur qui throttle). Le GM pilote
     desormais le client concerne via des queries : commit force de la fog avant
     un changement de PJ, rechargement apres, et commit force apres chaque
     deplacement d'un token de groupe. Corrige "au changement de PJ j'ai la fog du
     PJ precedent". (map.js)

v3.1.4 | 2026-08-04
   - Carte des expeditions : la fog est desormais PERSONNELLE par personnage et
     unique pour toutes les expeditions (conservee et cumulative). Le token de
     groupe ne sert qu'a indiquer qui explore ; il ne partitionne plus la fog.
     Cle de sauvegarde = personnage seul, avec migration des anciennes cles
     "perso:groupe". (map.js)

v3.1.3 | 2026-08-04
   - Carte des expeditions : le MJ peut explorer POUR des joueurs hors-scene. En
     deplacant un token de GROUPE selectionne sur la scene, son exploration est
     enregistree dans la fog des membres du groupe qui ne regardent pas la scene
     (hors-ligne / autre scene), persistee par personnage. Necessite Vision par
     token sur la scene. (map.js)

v3.1.2 | 2026-08-04
   - Carte des expeditions : nouveau reglage "Dossier du token modele" — l'acteur
     Groupe modele est cree dans le dossier d'acteurs choisi (cree le dossier si
     nom libre inexistant). (settings.js, map.js)

v3.1.1 | 2026-08-04
   - Carte des expeditions : creation auto d'un acteur Groupe modele
     "Token a copier et rennomer" (token non lie + vision activee) et depot d'un
     exemplaire sur la scene configuree, pret a copier/renommer (idempotent). (map.js)

v3.1.0 | 2026-08-04
   - Casier / Suivi des GM : cliquer sur le pseudo d'un GM affiche uniquement
     son dashboard (stats + presentation) ; bouton retour. Presentation editable
     seulement pour son propre casier, sinon lecture seule. (casier.js, casier.css)

v3.0.9 | 2026-08-04
   - Creation de perso : quand un GM cree un PJ directement dans le sous-dossier
     d'un joueur (Dossier des PJ), les etapes de demande/validation sont sautees
     — la fiche est d'emblee validee, verrouillee et attribuee au joueur
     (proprietaire). (charvalidation.js)

v3.0.8 | 2026-08-04
   - Dossiers : nouveau reglage "Sous-dossier auto au nom du joueur". A la
     premiere connexion d'un joueur, le GM cree automatiquement dans le Dossier
     des PJ un sous-dossier a son nom (idempotent). (settings.js, charvalidation.js)

v3.0.7 | 2026-08-04
   - Temps morts / Craft : le champ "Nom" est desormais en lecture seule et ne
     fait qu'afficher l'objet choisi dans le compendium (clic sur le champ ou
     l'icone livre pour choisir). Plus de saisie libre (tm.js).

v3.0.6 | 2026-08-04
   - Note GM : onglet restyle (en-tete avec icone + titre + badge "Prive", zone de
     notes en panneau "papier", focus dore) au lieu du textarea brut
     (character-sheet.js, gmnotes.css).

v3.0.5 | 2026-08-04
   - Tutoriel (Mes personnages) : ajout d une etape d intro qui explique tout le
     principe du circuit (demande -> validation -> construction -> soumission ->
     verrouillage ; montee de niveau ; limites & stock), en plus des etapes
     d interface (tutorial.js).

v3.0.4 | 2026-08-04
   - Validation des personnages : dans "Mes personnages", le bouton "Monter de
     niveau" ne s affiche que si le PJ a atteint le seuil d XP (value >= max)
     (charvalidation.js).

v3.0.3 | 2026-08-04
   - Tutoriel : la fenetre de bienvenue ne propose plus que "Commencer le
     tutoriel" (bouton "Plus tard" retire ; fermeture via la croix) (welcome.js).

v3.0.2 | 2026-08-04
   - Validation des personnages : nouveau reglage "Bloquer les imports Plutonium
     hors autorisation" (defaut on). Sur une fiche VERROUILLEE, un joueur ne peut
     pas importer de contenu Plutonium (items marques du flag plutonium) ; l import
     n est possible que pendant une creation ou une montee de niveau autorisee par
     le MJ. GM jamais bloque (charvalidation.js, settings.js).

v3.0.1 | 2026-08-04
   - Tutoriel : les sections reservees aux joueurs (Mes personnages, Temps morts)
     sont cachees aux GM (elles y seraient vides). Nouvelle notion
     SECTION_PLAYER_ONLY (tutorial.js).

v3.0.0 | 2026-08-04
   - Version : passage en 3.0.0 (retenue — le versionnage ne depasse pas 9 par
     chiffre : 2.9.9 -> 3.0.0).
   - Tutoriel : la section "Note GM" passe apres "Carnet & Expeditions" dans l
     ordre de passage (tutorial.js).

v2.16.10 | 2026-08-04
   - Tutoriel : "Temps morts" n apparait plus qu une fois cote GM. L etape du
     Casier est placee entre Expeditions et Suivi des GM ; l etape de validation
     en double (section Temps morts) est retiree (tutorial.js).

v2.16.9 | 2026-08-04
   - Tutoriel : "Ne plus afficher" deplace de la fenetre de bienvenue vers la FIN
     du guide (propose seulement quand il est termine) — la fenetre de bienvenue
     n a plus que "Commencer" et "Plus tard" (welcome.js, tutorial.js).

v2.16.8 | 2026-08-04
   - Tutoriel : les fenetres de bienvenue et de selection affichent un
     avertissement invitant a fermer toutes les fiches/fenetres ouvertes avant de
     lancer le guide (welcome.js).

v2.16.7 | 2026-08-04
   - Readme : mise a jour des sections descriptives (architecture, features,
     reglages) pour refleter toutes les nouveautes (Casier, validation des
     personnages, cues audio, note GM, statut PJ, pause de party, dossiers &
     compendiums communs...).

v2.16.6 | 2026-08-04
   - Casier / Validation : les fiches a valider indiquent desormais s il s agit
     d une "Creation" (verte) ou d une "Montee de niveau" (bleue) — une fiche deja
     validee qui revient = montee de niveau (charvalidation.js, casier.js,
     charvalidation.css).

v2.16.5 | 2026-08-04
   - Validation des personnages : pendant la CREATION (fiche non encore
     verrouillee), xp.js laisse le joueur construire librement (XP, niveau,
     classe) au lieu de bloquer "level up non autorise". Le blocage ne s applique
     qu une fois la fiche validee & verrouillee (xp.js).

v2.16.4 | 2026-08-04
   - Validation des personnages : les persos valides sont crees dans un
     sous-dossier au NOM DU JOUEUR, a l interieur du dossier parent configure
     (ex. Joueurs / Gauthier). Le sous-dossier est cree au besoin (charvalidation.js).

v2.16.3 | 2026-08-04
   - Validation des personnages : la fenetre "Mes personnages" liste desormais
     TOUS les persos du joueur — y compris ceux crees a la main par le MJ (via la
     propriete du joueur), pas seulement ceux issus d une demande. Statut
     "jouable" pour ces persos hors circuit, avec option de soumission
     (charvalidation.js).

v2.16.2 | 2026-08-04
   - Validation des personnages : badge "En construction" (orange) sur la ligne de
     l acteur tant qu une montee de niveau est autorisee (fiche deverrouillee pour
     edition), jusqu a la re-validation (charvalidation.js, charvalidation.css).

v2.16.1 | 2026-08-04
   - Temps morts : suppression des messages "ajouter l objet a la main" (l objet
     s importe desormais automatiquement du compendium). Message de fin de craft
     simplifie ; plus de rappel manuel au demarrage (tm.js).

v2.16.0 | 2026-08-04
   - Tutoriel : mise a jour complete avec les nouvelles fonctionnalites. Nouvelles
     sections — Note GM (GM), Mes personnages (joueur : demande/soumission/stock),
     Cues audio (GM). Le Casier gagne les etapes onglets Temps morts et Validation.
     L etape de validation des temps morts pointe desormais le Casier (l ancien
     bouton de barre ayant ete retire). Toutes les etapes pointent l element
     concerne (const.js, tutorial.js, settings.js, charvalidation.js).

v2.15.2 | 2026-08-04
   - Casier / Temps morts : suppression du scroll interne (55vh) dans le panneau
     embarque, pour un scroll unique et fluide via la colonne du Casier (tm.js).

v2.15.1 | 2026-08-04
   - Fiche PJ : nouveau reglage "Masquer l onglet etoile aux joueurs" (Serveur).
     Cache l onglet a icone etoile (favoris) sur les fiches, cote joueurs
     uniquement ; les GM le voient toujours (character-sheet.js, settings.js).

v2.15.0 | 2026-08-04
   - Fiche PJ : onglet "Note GM" (reglage Serveur). Ajoute un onglet prive sur les
     fiches de personnage, visible et editable uniquement par les GM (la part
     n existe pas pour les joueurs). Notes stockees sur l acteur (flag gmNotes)
     (character-sheet.js, character-gmnotes.hbs, gmnotes.css, settings.js).

v2.14.0 | 2026-08-04
   - Casier : l onglet "Temps morts" embarque directement le panneau de validation
     (liste des declarations, recherche, modifier/refuser) et un bouton
     "Appliquer les gains" — plus besoin d ouvrir une fenetre separee. openDowntime
     refactorise en fonctions reutilisables (tm.js, casier.js).

v2.13.0 | 2026-08-04
   - Validation des personnages : limites & stock. Deux reglages — "Nombre de
     personnages max par joueur" (0 = illimite) et "Personnages actifs simultanes"
     (defaut 2). Au-dela du nombre d actifs, les persos passent EN STOCK : cadenas
     dans la fenetre "Mes personnages", ownership Observateur (non jouable),
     badge "Stock" sur la ligne de l acteur. Boutons Activer / Mettre en stock
     (changement d ownership via requete au GM). Le total limite le nombre de
     demandes de creation (charvalidation.js, settings.js, charvalidation.css).

v2.12.0 | 2026-08-04
   - Validation des personnages : MULTI-PERSONNAGES. La fenetre "Mes personnages"
     liste tous les persos du joueur (statut + actions) et un bouton "Demander un
     nouveau personnage" permet d en demander plusieurs (2e, 3e...). Chaque perso
     a ses propres actions (ouvrir, soumettre, monter de niveau).
   - Verrou : re-affichage de la fiche apres un blocage, pour que la valeur
     saisie (affichage optimiste) revienne bien a l etat verrouille reel
     (charvalidation.js, charvalidation.css).

v2.11.0 | 2026-08-04
   - Reglages : nouvelle section "Dossiers & Compendiums" en tete, qui regroupe
     en un seul endroit les dossiers/compendiums communs (PJ, PNJ, cimetiere,
     creatures, objets craftables, nouveaux persos). Les champs dupliques ont
     ete retires des sections Relations/Bestiaire/Temps morts/Creation de perso ;
     toutes les fonctions lisent ces valeurs centrales. Les valeurs deja saisies
     sont recopiees automatiquement (migration unique). (settings.js, relations.js,
     bestiary.js, tm.js, charvalidation.js, index.js).

v2.10.1 | 2026-08-04
   - Tutoriel (Caracteristiques) : le halo cible desormais directement les six
     cases de caracteristiques (une par capacite) au lieu du conteneur qui
     debordait sur les Skills/Saves (tutorial.js).

v2.10.0 | 2026-08-04
   - Validation des personnages : flux de MONTEE DE NIVEAU. Le joueur demande une
     montee de niveau (bouton dans "Mon personnage", fiche verrouillee) -> badge
     "Level up" sur la ligne de l acteur -> le GM autorise depuis le Casier
     (onglet Validation, section Montees de niveau) : la fiche se deverrouille et
     xp.js laisse passer la montee (flag levelUpGranted) -> le joueur monte de
     niveau puis re-soumet -> re-validation re-verrouille. (charvalidation.js,
     xp.js, casier.js).

v2.9.6 | 2026-08-04
   - Validation des personnages : badge "En creation" (violet) affiche des qu une
     fiche est creee pour un joueur et pas encore validee (avant meme la
     soumission) ; "A valider" quand soumise. Rafraichi a la creation de l acteur
     (charvalidation.js, charvalidation.css).

v2.9.5 | 2026-08-04
   - Temps morts : la fenetre de declaration du joueur ne depasse plus l ecran.
     Le contenu est borne (max-height 74vh) et devient scrollable, gardant les
     boutons Declarer/Ajouter accessibles (tm.js).

v2.9.4 | 2026-08-04
   - Tutoriel : la bulle ne sort plus de l ecran quand la cible est collee a un
     bord (clamp final sur les deux axes en plus du flip) (tutorial.js).

v2.9.3 | 2026-08-04
   - Casier : les temps morts ont desormais leur propre ONGLET "Temps morts"
     (avec compteur de declarations en attente) au lieu d un simple bouton sur
     le dashboard (casier.js, settings.js).

v2.9.2 | 2026-08-04
   - Reglages : la validation des personnages a desormais sa propre section
     "Creation de personnages" (au lieu d etre dans Systeme de Party)
     (settings.js).

v2.9.1 | 2026-08-04
   - Validation des personnages : le reglage "Dossier des personnages" est un
     selecteur de dossier (stocke un id) ; ensureFolder accepte desormais id ou
     nom, avec repli sur "Personnages" (charvalidation.js).

v2.9.0 | 2026-08-04
   - Artisanat : selecteur d objet lie au compendium. Dans le formulaire de craft,
     un bouton (livre) ouvre la liste des objets du compendium configure avec
     barre de recherche ; le choix remplit le nom, le prix et memorise l objet
     exact (uuid). A la fin du craft, CET objet est ajoute a la fiche (repli sur
     recherche par nom si aucun objet n a ete choisi) (tm.js).

v2.8.0 | 2026-08-04
   - Temps morts : la fenetre GM s ouvre desormais depuis le Casier (bouton
     "Temps morts" du dashboard) ; l icone dediee est retiree de la barre
     WestMarch (tm.js, casier.js).
   - Artisanat : a la fin d un craft, l objet est ajoute AUTOMATIQUEMENT a la
     fiche du joueur, cherche par nom dans un compendium d objets configure
     (reglage "Artisanat — Compendium des objets craftables"). Introuvable =
     rappel manuel comme avant (tm.js, settings.js).

v2.7.0 | 2026-08-04
   - Nouveau : Validation des personnages (tickets). Le joueur demande la
     creation d un perso (bouton "Mon personnage" dans la barre WestMarch) ;
     n importe quel GM valide depuis le Casier (onglet Validation) -> un acteur
     est cree dans un dossier dedie, le joueur en devient proprietaire. Il le
     construit (imports Plutonium compris) puis le soumet ; a la validation la
     fiche est VERROUILLEE : construction non modifiable cote joueur (caracs,
     maitrises, classe/espece/historique/aptitudes/sorts appris), jeu libre
     (tout ce que surveille anticheat + PV, monnaie, conditions...). Un badge
     "A valider" / "Level up" s affiche sur la ligne de l acteur, entre le nom
     et le statut d expedition. Respec/level-up prevus pour plus tard
     (charvalidation.js, charvalidation.css, casier.js, settings.js, index.js).

v2.6.0 | 2026-08-04
   - Cues audio : le gestionnaire gagne des SECTIONS (en-tetes repliables qui
     regroupent les cues) et le repli/depli de chaque cue, plus des fleches
     monter/descendre pour organiser. Etat de repli et ordre memorises
     (sceneaudio.js, sceneaudio.css).

v2.5.2 | 2026-08-04
   - Tutoriel (Caracteristiques) : le halo ne prend plus que la rangee des six
     boucliers (.ability-scores .bottom) au lieu de tout le conteneur qui
     debordait sur les Skills/Saving Throws (tutorial.js).

v2.5.1 | 2026-08-04
   - Tutoriel : l etape sur l Inspiration heroique precise qu elle ne vient pas
     que du MJ (aussi aptitudes, especes, autres sources) (tutorial.js).

v2.5.0 | 2026-08-04
   - Carnet : police de l editeur de notes remplacee par Perry Gothic
     (fonts/PerryGothic.ttf). Declaree via CONFIG.fontDefinitions (dispo aussi
     dans le menu de police de l editeur) (index.js, styles/carnet.css).

v2.4.1 | 2026-08-04
   - Pause de party : correction "jeu coince en pause". Une pause GLOBALE
     residuelle est levee au chargement, et la barre espace leve d abord une
     eventuelle pause globale avant de basculer la party (l interception ne peut
     plus laisser une pause globale coincee) (partypause.js).

v2.4.0 | 2026-08-04
   - Cues audio : navigateur de playlists. Un bouton note de musique a cote du
     champ fichier ouvre la liste des sons des playlists du MONDE et des
     COMPENDIUMS, avec ecoute locale (le MJ essaie sans que les joueurs
     entendent) et bouton Choisir qui remplit le fichier du cue (le chemin du
     son est reutilise directement, sans import) (sceneaudio.js, sceneaudio.css).

v2.3.4 | 2026-08-04
   - Pause de party : correction de la pause bloquee sur "activee". Interception
     fiable de la barre espace en phase de capture (avant le KeyboardManager de
     Foundry) pour que le pause global ne parte jamais, + anti-double-bascule
     (evite que capture clavier et game.togglePause s annulent). Le filet de
     securite se contente desormais d annuler une pause globale parasite sans
     toucher a l etat de party (partypause.js).

v2.3.3 | 2026-08-04
   - Pause de party : affichage via le banner NATIF #pause ("Game Paused") au
     lieu d un bandeau maison. Meme apparence que Foundry et compatibilite avec
     les modules d habillage de la pause (glow bleu de Monk, etc.). Le banner
     natif n est plus masque ; il est revele localement pour les membres de la
     party en pause (partypause.js, partypause.css).

v2.3.2 | 2026-08-04
   - Pause de party : filet de securite. Si une pause GLOBALE s active malgre le
     detournement de game.togglePause (macro, socket, module tiers), le GM actif
     l annule aussitot et bascule a la place la pause de sa party — plus de
     "pause qui stoppe toute la table" (partypause.js).

v2.3.1 | 2026-08-04
   - Cues audio : diffusion limitee a la PARTY du GM (flag partyId) au lieu de
     toute la table. Chaque client lisant le son en local, on ne notifie que les
     membres de la party (emetteur inclus). Si le systeme de Party est desactive,
     diffusion a tous comme avant (sceneaudio.js).

v2.3.0 | 2026-08-04
   - Cues audio : refonte en gestionnaire central. Nouveau bouton "Cues audio"
     dans la barre WestMarch (GM) ouvrant une fenetre de gestion. Les cues sont
     stockes au niveau du monde (survivent a la suppression du token). Chaque
     cue a un declencheur : Manuel, Revelation du token lie, ou Debut de combat.
     On lie un cue au token selectionne ; depuis le HUD du token on rejoue les
     cues lies. Prechargement + diffusion locale via queries v13. Remplace la
     config par-token (sceneaudio.js, sceneaudio.css, settings.js).

v2.2.1 | 2026-08-04
   - Cues audio : correction de la mise en page de la ligne "Fichier audio"
     (input ecrase par le bouton parcourir) (sceneaudio.css, sceneaudio.js).

v2.2.0 | 2026-08-04
   - Nouveau : Mise en scene — Cues audio. Attache a un token un cue audio
     (fichier, seconde de depart, volume, fondu, boucle) via un bouton dans son
     HUD. Le son part pour tous les joueurs quand le token perd son invisibilite
     GM (hidden true->false), ou manuellement ("Jouer pour tous"). Lecture locale
     sur chaque client via queries v13 (faible latence), prechargement au
     chargement de la scene. Categorie de reglages dediee, sans lien avec un
     autre module (sceneaudio.js, sceneaudio.css, settings.js, index.js).

v2.1.1 | 2026-08-04
   - Tutoriel (Expeditions) : ajout d une etape sur le Statut de disponibilite
     des PJ. Ouvre le repertoire des Acteurs et pointe le badge du perso demo
     (tutorial.js, pcstatus.css).

v2.1.0 | 2026-08-04
   - Nouveau : Statut de disponibilite des PJ. Un badge "Disponible" /
     "En expedition" s affiche a droite de chaque personnage dans le repertoire
     des Acteurs. Statut deduit automatiquement des expeditions (une expedition
     ouverte = En expedition). Activable dans Fiche PJ > Carnet & Expeditions
     (pcstatus.js, pcstatus.css).

v2.0.0 | 2026-08-04
   - Manifeste : suppression de la cle "fonts" (non reconnue par le schema
     Foundry v13/v14 → avertissement Package Warnings). La police Enchanted
     Land est desormais enregistree par code via CONFIG.fontDefinitions au
     hook init (index.js).

v1.9.9 | 2026-08-04
   - Tutoriel (Tour de la fiche) : ordre Inventaire avant Aptitudes, et ajout
     d une etape "Effets" apres les Sorts (tutorial.js).

v1.9.8 | 2026-08-04
   - Fiche demo tutoriel : correction du bug qui empechait sa (re)creation. Un
     echec de fetch marquait faussement la fiche comme creee ; desormais le
     succes n est enregistre qu apres un Actor.create confirme, l ancienne
     fiche n est supprimee qu apres creation de la nouvelle, et un suivi de
     version (tutorialActorVersion) permet de retenter tant que la creation a
     echoue (demoactor.js, settings.js).

v1.9.7 | 2026-08-04
   - Calendrier : passage a Mini Calendar. Le module lisait deja l API native
     game.time.calendar (aucune dependance Simple Calendar reelle) ; nettoyage
     des references residuelles a SimpleCalendar dans carnet.js et mise a jour
     de la dependance recommandee (module.json, readme).

v1.9.6 | 2026-08-04
   - Tutoriel (Tour de la fiche) : fusion des etapes "Niveau & experience" et
     "Repos & inspiration" en une seule etape "Niveau, experience & repos"
     (zone .right de l en-tete + barre d exp) (tutorial.js).

v1.9.5 | 2026-08-04
   - Tutoriel : correction du spotlight multi-zones. Le masque CSS ne decoupait
     pas les trous (alpha) ; remplace par un SVG en regle evenodd (vrais trous,
     clics traversants dans les zones eclairees) (tutorial.js).

v1.9.4 | 2026-08-04
   - Tutoriel (Tour de la fiche) : etape "Caracteristiques" calee sur
     section.ability-scores (confirme via inspection) (tutorial.js).

v1.9.3 | 2026-08-04
   - Tutoriel (Relations) : ordre des etapes inverse — "Reveler a la party"
     passe avant "Rendre anonyme" (tutorial.js).

v1.9.2 | 2026-08-04
   - Tutoriel (Tour de la fiche) : etape caracteristiques/competences scindee en
     deux — "Caracteristiques" (rangee du haut .ability-scores) et "Competences"
     (colonne .left) (tutorial.js).

v1.9.1 | 2026-08-04
   - Casier (Dashboard) : retrait de la case "Party active" (casier.js).

v1.9.0 | 2026-08-04
   - Fiche demo tutoriel (v8) : construite a partir d un personnage complet livre
     dans le module (data/tutorial-actor.json — Clerc 12, ~150 objets dont sorts).
     Overrides a la creation : image forcee (icone du coeur), ownership Aucun,
     dossier Tutoriel, flags demo (relations/bestiaire/notes/expeditions).
     demoactor.js charge le JSON via fetch.

v1.8.4 | 2026-08-04
   - Tutoriel : le spotlight supporte plusieurs cibles (step.targets = liste) via
     un masque SVG (un trou par zone). L etape "Niveau & experience" eclaire en
     forme de L la barre d XP (.meter.exp) ET le rond du niveau (tutorial.js).

v1.8.3 | 2026-08-04
   - Tutoriel (Tour de la fiche) : les caracteristiques/competences pointent la
     colonne gauche (.left) ; nouvelle etape "Jets de sauvegarde & defense" sur
     tout le bloc .saves (filigree-box), texte precisant defense = jet de
     sauvegarde OU CA (tutorial.js).

v1.8.2 | 2026-08-04
   - Tutoriel (Tour de la fiche) : etape en-tete scindee en deux — "Niveau &
     experience" (badge + barre XP) et "Repos & inspiration heroique" (boutons
     repos court/long, inspiration) (tutorial.js).

v1.8.1 | 2026-08-04
   - Tutoriel (Tour de la fiche) : selecteurs cales sur le DOM reel du sheet
     dnd5e2 : CA = .ac-badge, init/vitesse/maitrise = .lozenges, PV/des de vie =
     les deux .meter-group de .stats, en-tete = .sheet-header (tutorial.js).

v1.8.0 | 2026-08-04
   - Tutoriel (Tour de la fiche) : l etape "Les onglets de la fiche" ciblait par
     erreur la barre laterale (repertoire Acteurs). Elle vise desormais la barre
     d onglets du sheet via nav.tabs:has([data-tab=features]) (tutorial.js).

v1.7.9 | 2026-08-04
   - Tutoriel (Tour de la fiche) : selecteurs des champs affines pour le sheet
     dnd5e2 (.ac, .meter.hit-points, .meter.hit-dice, .meter.exp, data-ability).
     Certains restent a confirmer selon la version (tutorial.js).

v1.7.8 | 2026-08-04
   - Tutoriel (Tour de la fiche) : l etape "Le nom du personnage" ne pointe plus
     toute la barre de titre (.window-title) mais l element du nom du sheet
     (.document-name) (tutorial.js).

v1.7.7 | 2026-08-04
   - Tutoriel (Apparence des tokens) : les etapes ouvrant le Prototype Token
     (Ouvrir le Prototype Token, Cycle d apparences, Wild Shape/Polymorph) sont
     desormais gmOnly (les joueurs n ont pas les permissions). L etape "Voir le
     portrait" reste visible pour tous (tutorial.js).

v1.7.6 | 2026-08-04
   - Tutoriel : nouvelle section "Tour de la fiche" (avant le Bestiaire) qui
     ouvre la fiche demo et pointe nom, portrait, niveau/classe/XP, CA,
     initiative/vitesse/maitrise, PV, des de vie, caracteristiques, la barre
     d onglets, puis Aptitudes / Inventaire / Sorts / Biographie. Selecteurs de
     champs avec repli (bulle centree si non trouve) ; onglets surs
     (const.js, settings.js, tutorial.js).

v1.7.5 | 2026-08-04
   - Fiche demo tutoriel (v7) : ajout de monnaie (3 pp, 245 po, 60 pa, 40 pc).
     Recreation auto (demoactor.js).

v1.7.4 | 2026-08-04
   - Fiche demo tutoriel (v6) : ajout d aptitudes (features, type feat) —
     aptitudes de classe (Style de combat, Ennemi jure, Explorateur-ne, Attaque
     supplementaire, Ombres du Feywild), traits d espece (Vision dans le noir,
     Ascendance feerique) et historique. Recreation auto (demoactor.js).

v1.7.3 | 2026-08-04
   - Fiche demo tutoriel (v5) : l espece (Demi-elfe) et l historique (Ermite)
     recoivent un identifiant + une description pour etre correctement rattaches
     par dnd5e. Recreation auto de la fiche demo (demoactor.js).

v1.7.2 | 2026-08-04
   - Tutoriel (Relations, GM) : ajout de deux etapes apres "Bloquer/Retirer" :
     "Rendre anonyme" (fa-eye-slash) et "Reveler a la party" (fa-eye) (tutorial.js).

v1.7.1 | 2026-08-04
   - Tutoriel : nouvelle section GM "Casier du MJ" (ouvre le Casier et pointe
     Dashboard, presentation, Rapports, Expeditions, Suivi des GM). Une etape
     "Clore la session" est ajoutee en fin de section Carnet/Expeditions, juste
     avant la section Casier (const.js, settings.js, tutorial.js).

v1.7.0 | 2026-08-04
   - Relations : le selecteur d ajout propose desormais, en plus des dossiers
     PJ/PNJ, les acteurs de DEUX compendiums choisis en reglages (menus
     deroulants) : "Compendium des PNJ" (groupe PNJ) et "Compendium cimetiere
     des joueurs" (groupe Joueurs). Ajout par simple reference (nom+image, aucun
     acteur cree). Regroupement par source (relations.js, settings.js : nouveau
     controle compendium + packOptionsHtml).

v1.6.8 | 2026-08-04
   - Relations : suppression du reglage inutilise "Dossier des creatures"
     (vestige d ashara-relations, jamais utilise ; les creatures relevent du
     Bestiaire). Retire de settings.js, relations.js et migration.js.

v1.6.7 | 2026-08-04
   - Tutoriel : les etapes "Bloquer l ajout automatique" et "Retirer de chez
     tous les joueurs" sont desormais gmOnly (masquees pour les joueurs, ces
     boutons etant reserves au GM) (tutorial.js).

v1.6.6 | 2026-08-04
   - Fiche demo tutoriel (v4) : ownership par defaut "Aucun". Au lancement du
     tutoriel, le participant devient Proprietaire de la fiche demo (les joueurs
     passent par une requete au GM) ; a la fermeture (croix / Echap / derniere
     etape) il repasse en "Aucun". Query completed-westmarch.setDemoOwnership
     (demoactor.js, serveur-socket.js, tutorial.js).

v1.6.5 | 2026-08-04
   - Fiche demo tutoriel (v3) : ownership par defaut passe a Proprietaire (au
     lieu d Observateur) pour que les onglets Relations/Bestiaire/Carnet se
     presentent en mode editable comme une fiche de joueur normale. Recreation
     auto (demoactor.js).

v1.6.4 | 2026-08-04
   - Tutoriel : cliquer en dehors de la bulle (zone assombrie / fond) ne met
     plus fin au tutoriel. Fermeture uniquement via le bouton croix ou Echap
     (tutorial.js).

v1.6.3 | 2026-08-04
   - Tutoriel bestiaire : l etape "Consulter une entree" pointe desormais le
     chevron (.bst-toggle) au lieu d une bulle centree sans cible (tutorial.js).

v1.6.2 | 2026-08-04
   - Temps morts (validation GM) : ne trouvait les PJ que dans un dossier nomme
     "PJ". Desormais repli sur TOUS les personnages possedes par un joueur si
     aucun dossier "PJ" n est utilise (corrige "Aucun personnage joueur
     trouve") (tm.js).

v1.6.1 | 2026-08-04
   - Bouton barre WestMarch : "Temps morts — Gains" renomme en "Temps morts" (tm.js).

v1.6.0 | 2026-08-04
   - Fiche demo du tutoriel enrichie (v2) : aventurier niveau 12 complet
     (classe Rodeur/sous-classe/historique/race, equipement, bio,
     caracteristiques) + relations, bestiaire, notes et expeditions improvises
     et AUTO-SUFFISANTS (aucun acteur externe, aucun impact serveur ; les
     expeditions demo n ont pas de gmId donc n apparaissent pas dans le Casier).
     Montee de version auto : l ancienne fiche demo est remplacee (demoactor.js).
   - Relations : ajout d un groupe "Autres" pour les relations dont la cible
     n est pas dans un dossier PJ/PNJ (corrige aussi les relations orphelines)
     (relations.js).

v1.5.7 | 2026-08-04
   - Casier (Dashboard) : placeholder de la presentation, "vos regles maison"
     remplace par "vos criteres" (casier.js).

v1.5.6 | 2026-08-04
   - formatDate (carnet) : gere le retour objet {date,time} de Simple Calendar
     (formatDateTime) et renvoie toujours une chaine (corrige "[object Object]"
     sur les dates quand Simple Calendar est actif).
   - Casier / Expeditions en cours : n affiche que les expeditions dont le GM
     courant est le MJ (tag gmId), les anciennes non taguees ne sont plus
     listees (casier.js).

v1.5.5 | 2026-08-04
   - Suivi des GM : affiche desormais, par GM, le nombre d expeditions EN COURS
     (taguees a ce GM), avec le nom de chacune et la liste des joueurs qui y
     participent (casier.js / casier.css).

v1.5.4 | 2026-08-04
   - Casier : correction "[object Object]" dans Expeditions et Suivi des GM. Les
     dates d expedition (objet {day,month,year}) sont desormais formatees via
     carnet.formatDate ; cle de regroupement basee sur la date serialisee.

v1.5.3 | 2026-08-04
   - Casier : l onglet "Sessions" devient "Expeditions" et liste les expeditions
     EN COURS du GM (issues de l onglet Expedition), regroupees par expedition ;
     badge "En session" sur celle dont des participants sont dans la party
     actuelle du GM. Les expeditions sont taggees au GM createur (carnet.js).

v1.5.2 | 2026-08-04
   - Rapports de session en attente : pastille de notif sur le bouton Casier
     (par GM, aucun suivi inter-GM des rapports) + message chuchote a soi-meme
     (self-roll) a la connexion avec un bouton Ouvrir le Casier. Le badge se
     rafraichit a l enregistrement/envoi/suppression d un brouillon (casier.js,
     casier.css, session.js).

v1.5.1 | 2026-08-04
   - Casier : deux onglets ajoutes. "Dashboard" (par defaut) avec le nom du GM,
     un recap (rapports en attente, party active, sessions ouvertes) et une
     presentation editable persistante (reglage casierProfiles). "Suivi des GM"
     listant, pour chaque GM, sa session/party en cours et ses membres.
     Onglets passes en vertical (casier.js / casier.css).

v1.5.0 | 2026-08-04
   - Cloture de session enrichie : la fenetre ajoute un champ NOTES et un bouton
     "Enregistrer pour plus tard" (brouillon range dans le Casier) en plus de
     "Cloturer et envoyer". XP applique dans les deux cas.
   - Nouveau "Casier de [GM]" (icone dans la barre WestMarch, GM) : tableau de
     bord style livret. Onglet "Rapports a finaliser" (brouillons editables ->
     bouton Cloturer qui envoie le rapport sur Discord) et "Sessions en cours".
     casier.js / casier.css ; brouillons stockes dans le reglage sessionDrafts.
   - session.js refactore : buildSessionEmbed / sendSessionReport / CRUD des
     brouillons exportes et reutilises par le Casier.

v1.4.1 | 2026-08-04
   - Fiche demo du tutoriel : le module cree automatiquement au 1er chargement GM
     une fiche PJ dediee "Aventurier d exemple (Tutoriel)" (dossier Tutoriel,
     lecture pour tous). Le tutoriel l ouvre en priorite, donc il utilise
     toujours la meme fiche. Creation idempotente via tutorialActorCreated.
     Nouveau demoactor.js ; tutorial.js pointe dessus.

v1.4.0 | 2026-08-04
   - Tutoriel : l etape unique du bouton de retrait est scindee en DEUX etapes,
     une par bouton (fa-ban "Bloquer l ajout automatique" et fa-users-slash
     "Retirer de chez tous les joueurs") (tutorial.js).

v1.3.9 | 2026-08-04
   - Liste des joueurs compacte : la barre de recherche est de nouveau DANS le
     cadre du panneau (epinglee sticky en tete de .players-list), pleine largeur,
     fond solide opaque sans coins arrondis : elle ne sort plus du cadre et les
     noms ne transparaissent plus derriere (playerlist.js/.css).

v1.3.8 | 2026-08-04
   - Fiche PJ/PNJ : le bouton unique de retrait est scinde en DEUX boutons dans
     l en-tete : fa-ban "Bloquer l ajout automatique" (toggle des flags, ne
     retire rien) et fa-users-slash "Retirer de chez tous les joueurs" (action
     ponctuelle avec confirmation). relations.js, bestiary.js, tutorial.js.

v1.3.7 | 2026-08-04
   - Liste des joueurs compacte : la barre de recherche est desormais AU-DESSUS
     de la liste (hors de la zone defilante) ; les noms defilent uniquement en
     dessous et ne passent plus derriere la barre (playerlist.js/.css).

v1.3.6 | 2026-08-04
   - Liste des joueurs compacte : la barre de recherche a un fond 100 pourcent
     opaque (les lignes ne transparaissent plus au defilement), z-index releve,
     ombrage, et padding-haut de la liste supprime (playerlist.css).

v1.3.5 | 2026-08-04
   - Liste des joueurs compacte : correctifs. Barre de recherche epinglee A
     L INTERIEUR de la liste (sticky), hauteur forcee en !important (~4 lignes),
     filtrage base sur data-user-id (fonctionne en v13) (playerlist.js/.css).

v1.3.4 | 2026-08-04
   - Nouvelle option Toolkit "Liste des joueurs compacte + recherche" : limite
     la liste des joueurs a ~4 lignes (defilement) et ajoute une barre de
     recherche pour filtrer par nom (playerlist.js / playerlist.css).

v1.3.3 | 2026-08-04
   - Fenetre d infos de connexion : le compteur "Documents charges" exclut
     desormais le bruit (messages du chat, reglages, dossiers, utilisateurs,
     combats) et ne compte que le contenu (acteurs, objets, journaux, scenes,
     macros, tables, cartes, playlists) (connstats.js).

v1.3.2 | 2026-08-04
   - Fenetre d infos de connexion : ajout du nombre de documents charges (somme
     des collections de monde) en plus des assets (connstats.js).

v1.3.1 | 2026-08-04
   - Nouvelle fonctionnalite "Pause de party" (categorie Systeme de Party) :
     remplace le pause global natif. Le GM met SA party en pause (bandeau +
     blocage du deplacement de ses joueurs non-GM), sans affecter les autres
     partys. Detourne game.togglePause (bouton + raccourci) et masque
     l indicateur PAUSED natif. Etat partage via le reglage de monde
     partyPauseState (partypause.js / partypause.css). Reglage enablePartyPause,
     necessite un rechargement.

v1.3.0 | 2026-08-04
   - Fenetre d infos de connexion : ajout du nombre d assets charges (ressources
     recuperees par le navigateur, via Resource Timing) (connstats.js).

v1.2.9 | 2026-08-04
   - Fenetre d infos de connexion : disparition auto reglee a 7 s (au lieu de
     12 s). Croix de fermeture en haut a droite inchangee (connstats.js).

v1.2.8 | 2026-08-04
   - Nouvelle fonctionnalite Toolkit "Fenetre d infos de connexion" : au
     chargement, petite fenetre en haut au centre affichant le temps de
     connexion, le nombre de modules actifs et la duree moyenne de connexion
     (historique local, 20 dernieres sessions). Reglage enableConnStats,
     disparition auto apres 12 s (connstats.js / connstats.css).

v1.2.7 | 2026-08-04
   - Onglet Relations restyle dans le meme theme fantasy dore que le Bestiaire :
     barre de titre a filet dore + police Modesto, recherche Bookinsanity, noms
     en serif, filets dores sur les lignes et en-tetes de section (relations.js,
     relations.css).

v1.2.6 | 2026-08-04
   - Nouvelle option "Masquer la barre de macros (GM)", independante de
     l option joueurs. Chaque utilisateur applique le reglage de son role
     (hotbar.js / settings.js, categorie Toolkit).

v1.2.5 | 2026-08-04
   - Fenetre d attribution d XP : la liste des PJ se base desormais sur les
     membres REELS de la party (flags persistants) et non sur sessionData, qui
     se vide au rechargement de Foundry. La cloture fonctionne aussi apres un
     rechargement (party retrouvee via le flag du GM). Le rapport retombe sur
     les membres actuels si le snapshot de session est vide (session.js).

v1.2.4 | 2026-08-04
   - Bouton tutoriel : le hook getSceneControlButtons est desormais toujours
     enregistre et verifie tutoEnabled en interne (toolbar.js / index.js), au
     lieu d etre gate a l init. Corrige la disparition de l icone "?" du groupe
     WestMarch apres un basculement de la case Active du Tutoriel.

v1.2.3 | 2026-08-04
   - "Clore la session" ouvre desormais une fenetre d attribution d XP : un
     champ "XP pour tous" qui remplit tous les PJ, plus un champ par PJ pour
     ajuster individuellement. L XP est ajoute a chaque acteur puis compte comme
     gain dans le rapport. Fermer la fenetre annule la cloture (session.js).

v1.2.2 | 2026-08-04
   - Blocage de mouvement hors tour désormais NATIF (combat.js, hook
     preUpdateToken) : pendant le combat de sa party, un joueur ne peut
     déplacer son token que quand c'est son tour ; le combat d'une autre
     party n'affecte jamais ses joueurs. Nouveau setting "enableCombatTurnLock".
   - Monk's TokenBar n'est plus utilisé ni recommandé (retiré de
     relationships.recommends et des dépendances du readme). L'ancien
     contournement via le flag monks-tokenbar.movement est supprimé.

v1.2.1 | 2026-08-04
   - module.json : ajout du champ "relationships". dnd5e en prérequis (requires),
     et midi-qol, MEJ, Simple Calendar, lib-wrapper, monks-tokenbar en recommandés
     (recommends). À l activation du module, Foundry propose d activer ces
     dépendances (obligatoire pour dnd5e, optionnel pour les autres).

v1.2.0 | 2026-08-04
   - Cases « Activé » ajoutées aussi à Temps morts et Tutoriel : nouveaux
     interrupteurs maîtres tmEnabled / tutoEnabled qui coupent toute la feature
     (bouton sablier + bouton GM pour TM ; bouton ? + fenêtre de bienvenue pour
     le tutoriel). Rechargement requis.

v1.1.9 | 2026-08-04
   - Config : case à cocher « Activé » ajoutée à côté du nom des catégories à
     interrupteur maître (Party, Relations, Bestiaire, Carnet, Carte, Midi) pour
     activer/désactiver la fonctionnalité sans ouvrir la fenêtre. Invite de
     rechargement pour les réglages qui le nécessitent.

v1.1.8 | 2026-08-04
   - Tutoriel : navigation par catégorie ajoutée dans les coins de la bulle 
     « Retour » (haut-gauche : début de la catégorie, puis catégorie précédente)
     et « Suivant » (haut-droite : catégorie suivante). Les boutons Précédent/
     Suivant du bas restent pour naviguer étape par étape.

v1.1.7 | 2026-08-04
   - Onglet Bestiaire stylisé (fantasy) : titre en Modesto Condensed doré, noms
     de créatures en serif (Bookinsanity), filets dorés dégradés au lieu des traits
     gris, accents chauds au survol.

v1.1.6 | 2026-08-04
   - Barre de contrôle du chat : tous les boutons (modes de jet, export/flush,
     boutons party) uniformisés  même taille, bordure, fond, rayon et écart,
     avec survol/actif orange cohérent.

v1.1.5 | 2026-08-04
   - Boutons de gestion party du chat (effacer / importer) : remis sur une seule
     ligne à la fin de la rangée native. Retrait du forçage flex-wrap + séparateur
     qui créait une 2e ligne et faisait déborder les boutons sur la carte.

v1.1.4 | 2026-08-04
   - Onglets de chat (IC / Autre / OOC) refaits : vraie barre horizontale propre
     (segments pleine largeur, onglet actif surligné, pastille de notif dans le
     bouton) au lieu des icônes rondes flottantes. Template + CSS revus.

v1.1.3 | 2026-08-04
   - Fix éditeur grimoire : la zone d'écriture remplit désormais toute la hauteur
     du dialog (plus de grand vide de parchemin sous les boutons).

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
