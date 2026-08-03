# Contexte — Projet Foundry VTT Ashara
*À lire au début de chaque nouvelle conversation Cowork pour retrouver le contexte complet.*

---

## Qui je suis

- **Utilisatrice** : Lyra (Discord : s0ruta, email : soruta31@gmail.com)
- **Projet** : Campagne West March sur Foundry VTT v13, système dnd5e v3
- **Rôle** : GM + développeuse des modules custom

---

## Règles absolues à respecter

### 1. Toujours demander avant de modifier
Toujours proposer les changements et attendre une confirmation explicite avant toute modification de fichier — code, readme, module.json, ou autre. Ne jamais implémenter et informer après coup.

### 2. westmarch est gelé
Le module `westmarch` est gelé. Aucune modification de ses fichiers (code, settings, readme.txt, etc.) sans permission explicite de Lyra. Toute nouvelle feature doit aller dans un module séparé.

### 3. Mise à jour des readme
Pour tous les modules custom : mettre à jour `readme.txt` en continu à chaque feature ajoutée (structure, section feature, settings, changelog daté). Ne jamais toucher `module.json` pour la version — Lyra le gère elle-même, **sauf exception explicitement accordée**.

### 4. Tests joueur
Les comptes joueurs (non-GM) ne peuvent pas exécuter de commandes dans la console Foundry. Tous les tests de diagnostic doivent passer par le compte GM, en reproduisant l'interaction UI qu'un joueur ferait.

---

## Architecture des modules

Tous les modules sont dans `C:\Users\gaeta\OneDrive\D&D\Ashara\Ashara\` :

| Module | ID | Version | Description |
|---|---|---|---|
| `westmarch` | westmarch | — | Module core West March (gelé) |
| `westmarch-ashara` | westmarch-ashara | — | Overrides Ashara sur westmarch |
| `toolkit` | toolkit | 1.0.7 | Features génériques (tokens, MEJ restock, etc.) |
| `bestiary` | ashara-bestiary | 1.3.4 | Bestiaire par personnage |
| `relations` | ashara-relations | 1.6.3 | Système de relations entre acteurs |
| `carnet` | carnet | 1.1.2 | Carnet d'expéditions + notes ProseMirror |
| `tutoriel` | tutoriel | — | Fenêtre de bienvenue + bulles tutoriel |
| `midi-range-fix` | midi-range-fix | 1.2.4 | Fix portée midi-qol pour tokens Large+ |
| `carte-expeditions` | carte-expeditions | — | Carte des expéditions |

---

## Contexte technique

- **Foundry VTT v13**, ApplicationV2, PARTS/TABS system, dnd5e v3
- Les modules utilisent `Hooks`, `game.settings`, `actor.setFlag()`, `Dialog` (old Application class) et `ApplicationV2`
- Les templates `.hbs` sont chargés en JS via `loadTemplates()` — la clé `templates` dans `module.json` est obsolète en v13
- Foundry v13 a un handler global sur `<a[href]>` → `window.open()` : ne jamais mettre `href="#"` sur des liens interactifs

---

## Projets en cours / reportés

### bestiary — lecture depuis compendium (reporté)
Faire lire `ashara-bestiary` depuis un compendium configurable au lieu de `game.actors`. Le monde contient ~500 monstres MM24 qui ralentissent la connexion (50-150s). Migration : remplacer le setting "nom de dossier" par "id de compendium", et `game.actors.filter(...)` par `game.packs.get(id).getDocuments()`.

---

## Historique récent (session 2026-07-24 → 2026-08-03)

- **midi-range-fix v1.2.1** : guard ruler (`_state > 0`) pour ne pas intercepter les mesures manuelles
- **midi-range-fix v1.2.2/1.2.3** : setting `rangeAdjust` (2.5 ft par défaut, configurable en game), soustraction bord→bord, banner version/auteur dans les settings
- **midi-range-fix v1.2.4** : polling réduit 250ms → 2000ms (perf)
- **carnet v1.1.1** : fix ouverture nouvel onglet navigateur (suppression `href="#"` sur tous les `<a>` interactifs)
- **carnet v1.1.2** : éditeur ProseMirror inline remplacé par Dialog popup (menus fonctionnels)
- **tutoriel v1.1.4** : `showWelcome` passé en scope `world`, ajout `hideWelcome` scope `client`
- **toolkit v1.0.7** : fix fuite mémoire `pointermove`/`pointerup` dans popup import token
- **bestiary + relations** : suppression clé `templates` obsolète dans `module.json`
