# Soruta — Modules Foundry VTT

Modules Foundry VTT v13 / D&D 5e v3 pour les serveurs WestMarch.

---

## Modules

| Module | ID | Version | Description |
|--------|----|---------|-------------|
| WestMarch Système | `westmarch` | 2.2.5 | Socle core — sessions, party, chat, combat, audio |
| WestMarch Ashara | `westmarch-ashara` | 1.0.9 | Extensions serveur — temps morts, XP, Discord log |
| Relations | `ashara-relations` | 1.6.3 | Onglet Relations sur la fiche PJ |
| Bestiaire | `ashara-bestiary` | 1.3.4 | Onglet Bestiaire sur la fiche PJ |
| Carnet d'Expéditions | `carnet` | 1.3.8 | Onglets Carnet & Expéditions sur la fiche PJ |
| Map Ouvert Systèmes | `carte-expeditions` | 1.0.2 | Gestion fog of war par personnage/groupe |
| Midi Range Fix | `midi-range-fix` | 1.5.9 | Corrige la portée midi-qol pour les grands tokens |
| Toolkit | `toolkit` | 1.2.6 | Outils GM — polymorph, boutiques MEJ, export fiches |
| Tutoriel | `tutoriel` | 1.2.7 | Guide interactif pour les joueurs et le GM |

---

## Prérequis

### Légende

- **Requis** — sans ce module, la fonctionnalité centrale ne fonctionne pas
- **Recommandé** — fonctionne seul mais incomplet sans
- **Ext. requis** — module tiers indispensable
- **Ext. optionnel** — améliore une feature spécifique

### Tableau des dépendances

| Module | Soruta requis | Soruta recommandé | Externe requis | Externe optionnel |
|--------|--------------|-------------------|----------------|-------------------|
| `westmarch` | — | — | — | `monks-tokenbar` |
| `westmarch-ashara` | `westmarch` | — | — | `simple-calendar` |
| `ashara-relations` | — | — | — | — |
| `ashara-bestiary` | — | `ashara-relations` | — | — |
| `carnet` | `westmarch` | `ashara-bestiary`, `ashara-relations` | — | `simple-calendar` |
| `carte-expeditions` | — | — | — | — |
| `midi-range-fix` | — | — | `midi-qol` | — |
| `toolkit` | — | — | — | `monks-enhanced-journal`, `lib-wrapper`, `monks-tokenbar` |
| `tutoriel` | — | `westmarch` | — | `monks-enhanced-journal` |

### Chaîne d'héritage des fiches PJ

```
CharacterActorSheet (dnd5e)
  → AshCharacterSheet      (ashara-relations)
    → AshBestiarySheet     (ashara-bestiary)
      → CarnetSheet        (carnet)
```

Chaque module détecte ceux qui le précèdent via `CONFIG.asharaSheets` et hérite de leur fiche. Si un maillon manque, il remonte à la fiche disponible la plus proche.

### Export des fiches PJ

`toolkit` expose un menu contextuel (clic droit sur un acteur) permettant d'exporter en deux formats :

- **Fiche actuelle** — export complet avec toutes les données modules (flags, expéditions, relations, bestiaire…). À réimporter sur un serveur avec les mêmes modules.
- **Fiche originale dnd5e** — supprime tous les flags propres aux modules Soruta avant export. Compatible avec n'importe quel serveur Foundry.

Les modules `ashara-relations`, `ashara-bestiary` et `carnet` se déclarent automatiquement dans `CONFIG.asharaSheetsModules` au démarrage. `toolkit` lit cette liste pour savoir quels flags supprimer — aucune dépendance explicite n'est requise entre ces modules et `toolkit`.

---

## Notes

- Tous les modules nécessitent **Foundry VTT v13+** et le système **D&D 5e v3+**.
- `midi-range-fix` s'inactive automatiquement si `midi-qol` n'est pas installé.
- `westmarch-ashara` — les dates (temps morts, caldate) utilisent l'API calendrier **native Foundry v13** (`game.time.calendar`), pas `SimpleCalendar.api` directement. Mais en pratique, Simple Calendar est recommandé pour avoir les bons noms de mois du calendrier Ashara. Le log Discord passe par un webhook HTTP configuré en settings.
- `carte-expeditions` et `ashara-relations` sont les seuls modules totalement autonomes.
- `monks-enhanced-journal` est uniquement requis pour les features boutiques/réapprovisionnement de `toolkit`. Le reste du module (polymorph, export, outils GM) fonctionne sans.

---

*© 2026 Soruta — Usage personnel autorisé. Toute redistribution ou usage commercial est interdit sans autorisation écrite.*
