import { MOD } from "./const.js";
export function XpHooks() {

    // ============================================================
    // SECTION : Blocage de la modification de l'XP par les joueurs
    // - Les joueurs ne peuvent pas modifier leur XP manuellement
    // - Les GM peuvent toujours modifier l'XP librement
    // ============================================================
    // Le joueur peut construire librement sa fiche (XP / niveau / classe) quand :
    //   - une montée de niveau lui a été autorisée (flag levelUpGranted), OU
    //   - c'est un perso du circuit de validation encore EN CONSTRUCTION,
    //     c.-à-d. pas encore verrouillé (création initiale, avant validation).
    const levelUpGranted = (actor) => {
        if (!actor) return false;
        if (actor.getFlag?.(MOD, "levelUpGranted") === true) return true;
        if (game.settings.get(MOD, "enableCharValidation")
            && actor.getFlag?.(MOD, "createdFor")
            && actor.getFlag?.(MOD, "locked") !== true) return true;
        return false;
    };

    Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
        // On laisse passer les GM
        if (game.user.isGM) return true;
        if (!game.settings.get(MOD, "enableXpBlock")) return;
        if (levelUpGranted(actor)) return true;   // montée de niveau autorisée

        // Si la mise à jour touche à l'XP
        if (changes?.system?.details?.xp !== undefined) {
            ui.notifications.warn("Vous n'êtes pas autorisé à modifier votre XP.");
            return false;
        }

        // Certains systèmes/extensions modifient directement le niveau
        // sur l'acteur plutôt que via l'item de classe : on bloque aussi.
        if (changes?.system?.details?.level !== undefined) {
            ui.notifications.warn("Vous n'êtes pas autorisé à monter de niveau.");
            return false;
        }
    });

    // ============================================================
    // SECTION : Blocage du level up via l'item de classe
    // - En dnd5e, monter de niveau = augmenter system.levels sur
    //   l'item "class" (ou en ajouter un nouveau pour le multiclasse).
    // - Ça passe par ce mécanisme que ce soit via la fiche standard,
    //   l'assistant d'avancement, OU un module tiers comme Plutonium :
    //   tout finit par un update/create sur l'item de classe.
    // ============================================================
    Hooks.on("preUpdateItem", (item, changes, options, userId) => {
        if (game.user.isGM) return true;
        if (!game.settings.get(MOD, "enableXpBlock")) return;
        if (item.type !== "class") return;
        if (levelUpGranted(item.parent)) return true;   // montée de niveau autorisée

        if (changes?.system?.levels !== undefined) {
            ui.notifications.warn("Vous n'êtes pas autorisé à monter de niveau.");
            return false;
        }
    });

    Hooks.on("preCreateItem", (item, itemData, options, userId) => {
        if (game.user.isGM) return true;
        if (!game.settings.get(MOD, "enableXpBlock")) return;
        if (levelUpGranted(item.parent)) return true;   // montée de niveau autorisée

        // Empêche l'ajout d'une nouvelle classe (multiclasse) par un joueur
        if ((item.type ?? itemData?.type) === "class") {
            ui.notifications.warn("Vous n'êtes pas autorisé à monter de niveau.");
            return false;
        }
    });

    // ============================================================
    // SECTION : Désactivation (sans masquer) du bouton Level Up et
    // verrouillage du champ XP sur la fiche personnage (joueurs uniquement)
    // - On garde le badge de niveau visible (le joueur doit voir son
    //   niveau), on retire juste l'interactivité du clic.
    // ============================================================
    const hideLevelUpAndXp = (actor, html) => {
        if (game.user.isGM) return;
        if (!game.settings.get(MOD, "enableXpBlock")) return;
        if (levelUpGranted(actor)) return;   // montée autorisée → bouton actif

        const $html = $(html);

        // Bouton/badge Level Up : plusieurs variantes de markup possibles
        // selon la version de la fiche (dnd5e v3/v4, sheets custom, etc.)
        // On désactive le clic sans cacher l'élément (le niveau doit
        // rester visible sur la fiche).
        $html.find('[data-action]').filter(
            (i, el) => /level.?up/i.test(el.dataset.action ?? "")
        ).each((i, el) => {
            el.removeAttribute('data-action');
            el.style.pointerEvents = 'none';
            el.style.cursor = 'default';
        });

        // Champ XP : ciblé en priorité par le name du data-binding
        // (stable d'une version à l'autre), classes connues en fallback
        $html.find('input[name$="xp.value"], input[name$="xp.max"]').prop('disabled', true);
        $html.find('.experience input, .xp input').prop('disabled', true);
    };

    Hooks.on("renderActorSheet", (sheet, html) => hideLevelUpAndXp(sheet?.actor ?? sheet?.document, html));

    // Pour les fiches V2 (ApplicationV2 / Tidy5e etc.)
    Hooks.on("renderActorSheetV2", (sheet, html) => hideLevelUpAndXp(sheet?.actor ?? sheet?.document, html));
}