import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
// ============================================================
// anticheat.js — Surveillance des modifications suspectes en combat
// Avertit les GM (en privé) quand un joueur modifie ses sorts
// préparés, son attunement, son équipement, ses emplacements de
// sorts, ou les utilisations restantes d'une feature, pendant un combat
// ============================================================

export function AntiCheatHooks() {

    // ------------------------------------------------------------
    // Canal de query (Foundry v13) : c'est le GM de la party qui CRÉE le
    // message d'alerte, pas le joueur. Indispensable pour la confidentialité :
    // l'auteur d'un message chuchoté peut TOUJOURS le voir — si le joueur
    // créait lui-même l'alerte (même chuchotée aux GM), il la verrait. En
    // déléguant la création au GM via une query, le joueur n'est jamais ni
    // auteur ni destinataire → il ne voit rien.
    // Tous les clients enregistrent le handler ; seul un GM y donne suite.
    // ------------------------------------------------------------
    CONFIG.queries["westmarch.anticheat"] = async (data) => {
        if (!game.user.isGM) return false;
        try {
            await ChatMessage.create({
                content: `${tl("⚠️ <strong>Anti-Cheat</strong> — <strong>{0}</strong> (joueur : {1}) {2} <em>pendant le combat</em>.", data.actorName, data.authorName, (data.events ?? []).join(", "))}`,
                whisper: [game.user.id],
                speaker: { alias: tl("Anti-Cheat") }
            });
            return true;
        } catch (e) { journal.erreur(tl("[{0}] Anti-Cheat (création message GM) :", MOD), e); return false; }
    };

    // Helper commun : envoie l'alerte AU GM de la party concernée, qui la
    // créera lui-même (voir le handler de query ci-dessus). Appelé côté
    // joueur (le client qui initie la modification).
    const reportToGm = (actor, userId, events) => {
        if (!events || events.length === 0) return;
        const author = game.users.get(userId)?.name ?? tl("Inconnu");

        // La partyId d'un joueur correspond à l'id du GM qui a créé la party.
        const partyId = game.users.get(userId)?.getFlag(MOD, "partyId");
        const partyGm = partyId ? game.users.get(partyId) : null;
        if (!partyGm?.isGM || !partyGm.active) return;

        partyGm.query("westmarch.anticheat", {
            actorName: actor.name, authorName: author, events
        }).catch(err => journal.erreur(`[${MOD}] Anti-Cheat (query) :`, err));
    };

    // Un acteur est surveillé s'il participe à UN combat démarré (quel qu'il
    // soit — pas seulement game.combat, qui pointe sur le combat globalement
    // actif, pas forcément celui de la party du joueur).
    const isWatchedCombatant = (actor) => {
        if (!actor || actor.type !== "character") return false;
        if (!actor.hasPlayerOwner) return false;
        const combats = game.combats?.contents ?? [];
        return combats.some(c => c.started && c.combatants.some(cb => cb.actorId === actor.id));
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
                events.push(`${tl("{0} le sort <strong>{1}</strong>", after ? tl("a préparé") : tl("a dé-préparé"), item.name)}`);
            }
        }

        // ---- Attunement ----
        if (changes.system?.attuned !== undefined) {
            const before = item.system.attuned;
            const after = changes.system.attuned;
            if (before !== after) {
                events.push(`${after ? tl("s'est attuné à") : tl("s'est désattuné de")} <strong>${item.name}</strong>`);
            }
        }

        // ---- Équipement (armes/armures) ----
        if (changes.system?.equipped !== undefined && ["weapon", "equipment"].includes(item.type)) {
            const before = item.system.equipped;
            const after = changes.system.equipped;
            if (before !== after) {
                events.push(`${after ? tl("a équipé") : tl("a déséquipé")} <strong>${item.name}</strong>`);
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
                events.push(`${tl("a regagné des utilisations de <strong>{0}</strong> ({1} → {2})", item.name, max - before, max - after)}`);
            }
        }
        if (changes.system?.uses?.max !== undefined && item.type === "feat") {
            const before = item.system.uses?.max ?? 0;
            const after = changes.system.uses.max;
            if (after !== before) {
                events.push(`${tl("a modifié le maximum d'utilisations de <strong>{0}</strong> ({1} → {2})", item.name, before, after)}`);
            }
        }

        reportToGm(actor, userId, events);
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
                events.push(tl("a regagné un emplacement de sort ({0}) ({1} → {2})", slotKey, before.value, slotChange.value));
            }
            if (slotChange.max !== undefined && slotChange.max !== (before.max ?? 0)) {
                events.push(tl("a modifié le maximum d'emplacements de sort ({0}) ({1} → {2})", slotKey, before.max, slotChange.max));
            }
        }

        reportToGm(actor, userId, events);
    });

    // ============================================================
    // SECTION : Ajout d'un item pendant le combat
    // Un joueur qui s'ajoute un sort, une arme, un objet, une aptitude…
    // en plein combat est suspect. createItem est un hook « post » diffusé
    // à tous les clients : on ne réagit que sur le client qui l'a initié
    // (game.userId === userId) pour n'émettre qu'une seule alerte.
    // ============================================================
    const ITEM_TYPE_FR = {
        spell: tl("le sort"), weapon: "l'arme", equipment: tl("l'équipement"),
        consumable: tl("le consommable"), feat: "l'aptitude", tool: "l'outil",
        loot: "l'objet", container: tl("le conteneur"), background: "l'historique",
        class: tl("la classe"), subclass: tl("la sous-classe"), race: tl("l'espèce"), feature: "l'aptitude"
    };
    Hooks.on("createItem", (item, options, userId) => {
        if (game.userId !== userId) return;        // seulement le client initiateur
        if (game.user.isGM) return;
        if (!game.settings.get(MOD, "enableAntiCheat")) return;

        const actor = item.parent;
        if (!actor || !isWatchedCombatant(actor)) return;

        const label = ITEM_TYPE_FR[item.type] ?? "l'objet";
        reportToGm(actor, userId, [`${tl("a ajouté {0} <strong>{1}</strong>", label, item.name)}`]);
    });
}
