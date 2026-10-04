import { MOD } from "./const.js";
// ============================================================
// anticheat.js — Surveillance des modifications suspectes en combat
// Avertit les GM (en privé) quand un joueur modifie ses sorts
// préparés, son attunement, son équipement, ses emplacements de
// sorts, ou les utilisations restantes d'une feature, pendant un combat
// ============================================================

export function AntiCheatHooks() {

    // Helper commun : envoie le message d'alerte au(x) GM de la party
    // concernée uniquement (pas à tous les GM de la table).
    const notifyGM = (actor, userId, events) => {
        if (events.length === 0) return;
        const author = game.users.get(userId)?.name ?? "Inconnu";

        // La partyId d'un joueur correspond à l'id du GM qui a créé la party.
        const partyId = game.users.get(userId)?.getFlag(MOD, "partyId");
        const partyGm = partyId ? game.users.get(partyId) : null;
        const gmIds = partyGm?.isGM ? [partyGm.id] : [];

        if (gmIds.length === 0) return;

        ChatMessage.create({
            content: `⚠️ <strong>Anti-Cheat</strong> — <strong>${actor.name}</strong> (joueur : ${author}) ${events.join(", ")} <em>pendant le combat</em>.`,
            whisper: gmIds,
            speaker: { alias: "Anti-Cheat" }
        });
    };

    const isWatchedCombatant = (actor) => {
        if (!actor || actor.type !== "character") return false;
        if (!actor.hasPlayerOwner) return false;
        if (!game.combat || !game.combat.started) return false;
        return game.combat.combatants.some(c => c.actorId === actor.id);
    };

    // ============================================================
    // SECTION : Modifications sur les items (sorts, équipement, features)
    // ============================================================
    Hooks.on("preUpdateItem", (item, changes, options, userId) => {
        if (game.user.isGM) return;
        if (!game.settings.get(MOD, "enableAntiCheat")) return;

        const actor = item.parent;
        if (!isWatchedCombatant(actor)) return;

        const events = [];

        // ---- Sorts préparés ----
        // Compatible dnd5e 5.x (system.preparation.{mode,prepared}) ET dnd5e 6.0
        // (system.method + system.prepared en NOMBRE : l'état « préparé » vaut
        // CONFIG.DND5E.spellPreparationStates.prepared.value, ~1). L'ancien
        // chemin a disparu en 6.0 → d'où la non-détection.
        if (item.type === "spell") {
            let before, after, preparable;
            if (changes.system?.prepared !== undefined || (changes.system?.method !== undefined && item.system?.prepared !== undefined)) {
                // Modèle 6.0
                const PREP = CONFIG.DND5E?.spellPreparationStates?.prepared?.value ?? 1;
                const bNum = Number(item.system?.prepared ?? 0);
                const aNum = changes.system?.prepared !== undefined ? Number(changes.system.prepared) : bNum;
                before = (bNum === PREP);
                after  = (aNum === PREP);
                const method = changes.system?.method ?? item.system?.method;
                preparable = !!(CONFIG.DND5E?.spellcasting?.[method]?.prepares);
            } else if (changes.system?.preparation?.prepared !== undefined) {
                // Modèle 5.x
                before = !!item.system?.preparation?.prepared;
                after  = !!changes.system.preparation.prepared;
                preparable = item.system?.preparation?.mode === "prepared";
            }
            if (before !== undefined && preparable && before !== after) {
                events.push(`${after ? "a préparé" : "a dé-préparé"} le sort <strong>${item.name}</strong>`);
            }
        }

        // ---- Attunement ----
        if (changes.system?.attuned !== undefined) {
            const before = item.system.attuned;
            const after = changes.system.attuned;
            if (before !== after) {
                events.push(`${after ? "s'est attuné à" : "s'est désattuné de"} <strong>${item.name}</strong>`);
            }
        }

        // ---- Équipement (armes/armures) ----
        if (changes.system?.equipped !== undefined && ["weapon", "equipment"].includes(item.type)) {
            const before = item.system.equipped;
            const after = changes.system.equipped;
            if (before !== after) {
                events.push(`${after ? "a équipé" : "a déséquipé"} <strong>${item.name}</strong>`);
            }
        }

        // ---- Utilisations d'une feature (feat) ----
        // dnd5e v4 utilise system.uses.spent (nombre d'utilisations
        // consommées) plutôt que system.uses.value. Une baisse de "spent"
        // = récupération d'utilisations (suspect pendant le combat) ;
        // une hausse = utilisation normale de la feature.
        if (changes.system?.uses?.spent !== undefined && item.type === "feat") {
            const before = item.system.uses?.spent ?? 0;
            const after = changes.system.uses.spent;
            if (after < before) {
                const max = item.system.uses?.max ?? "?";
                events.push(`a regagné des utilisations de <strong>${item.name}</strong> (${max - before} → ${max - after})`);
            }
        }
        if (changes.system?.uses?.max !== undefined && item.type === "feat") {
            const before = item.system.uses?.max ?? 0;
            const after = changes.system.uses.max;
            if (after !== before) {
                events.push(`a modifié le maximum d'utilisations de <strong>${item.name}</strong> (${before} → ${after})`);
            }
        }

        notifyGM(actor, userId, events);
    });

    // ============================================================
    // SECTION : Modifications des emplacements de sorts (sur l'acteur)
    // ============================================================
    Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
        if (game.user.isGM) return;
        if (!game.settings.get(MOD, "enableAntiCheat")) return;
        if (!isWatchedCombatant(actor)) return;

        const spellChanges = changes.system?.spells;
        if (!spellChanges) return;

        const events = [];

        for (const [slotKey, slotChange] of Object.entries(spellChanges)) {
            const before = actor.system.spells?.[slotKey];
            if (!before) continue;

            // On ne signale que les hausses de "value" (récupération
            // suspecte d'emplacements) et tout changement de "max".
            if (slotChange.value !== undefined && slotChange.value > (before.value ?? 0)) {
                events.push(`a regagné un emplacement de sort (${slotKey}) (${before.value} → ${slotChange.value})`);
            }
            if (slotChange.max !== undefined && slotChange.max !== (before.max ?? 0)) {
                events.push(`a modifié le maximum d'emplacements de sort (${slotKey}) (${before.max} → ${slotChange.max})`);
            }
        }

        notifyGM(actor, userId, events);
    });
}
