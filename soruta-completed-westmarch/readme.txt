================================================================================
                   SORUTA — COMPLETED WESTMARCH
                   Module Foundry VTT — Privé
================================================================================

Version : 1.9.9
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
