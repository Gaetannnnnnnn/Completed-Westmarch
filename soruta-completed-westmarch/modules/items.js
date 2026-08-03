import { MOD } from "./const.js";
// ============================================================
// items.js — Correction de la stat par défaut des outils (tools)
// - Il existe DEUX structures de données séparées pour les outils dans
//   dnd5e, et chacune a son propre repli "Intelligence" codé en dur,
//   indépendant de l'outil réel :
//   1) L'item "tool" lui-même (system.ability) : reste vide si Plutonium
//      ne le renseigne pas ; seul l'AFFICHAGE/le jet retombe alors sur
//      "int" (voir ToolData#abilityMod dans le système dnd5e), peu
//      importe l'outil.
//   2) La PROFICIENCY d'outil sur la fiche d'acteur (system.tools.<clé>),
//      utilisée notamment pour les blocs de statistiques de monstres /
//      PNJ importés par Plutonium (proficiency sans item associé) : le
//      schéma du système dnd5e initialise CHAQUE entrée avec
//      `ability: "int"` (CreatureTemplate, dans le système dnd5e) —
//      c'est cette structure-là, pas l'item, qui était en cause pour
//      les "Outils de forgeron" en Intelligence au lieu de Force.
// - Dans les deux cas, la vraie stat canonique de l'outil existe côté
//   système, dans CONFIG.DND5E.tools[clé].ability — on s'en sert
//   directement (pas de table recopiée à la main ici, qui se
//   désynchroniserait au moindre changement du système dnd5e).
// ============================================================

// Renvoie la stat canonique (ex: "str") connue par le système dnd5e pour
// la clé d'outil donnée (ex: "smith"), ou undefined si inconnue
// (outil homebrew par exemple — on ne devine rien dans ce cas).
function canonicalToolAbility(key) {
    return CONFIG.DND5E?.tools?.[key]?.ability;
}

// Calcule, pour un objet "system.tools" d'acteur (clé -> {value, ability,
// ...}), le patch minimal à appliquer pour corriger les entrées dont la
// stat est vide ou vaut "int" par défaut alors que la stat canonique de
// cet outil est différente. Renvoie null si rien à corriger.
function computeToolsAbilityFix(toolsData) {
    if (!toolsData) return null;

    let fixes = null;
    for (const [key, entry] of Object.entries(toolsData)) {
        if (!entry) continue;
        const canonical = canonicalToolAbility(key);
        if (!canonical) continue;

        const current = entry.ability;
        if ((!current || current === "int") && current !== canonical) {
            fixes ??= {};
            fixes[key] = { ability: canonical };
        }
    }
    return fixes;
}

export function ItemHooks() {

    // ============================================================
    // SECTION : item "tool" autonome (dans l'inventaire d'un perso) —
    // voir le point 1) en tête de fichier.
    // ============================================================
    Hooks.on("preCreateItem", (item, data, options, userId) => {
        if (!game.settings.get(MOD, "enableToolAbilityFix")) return;
        if (item.type !== "tool") return;

        const baseItem = item.system?.type?.baseItem;
        if (!baseItem) return;

        const canonical = canonicalToolAbility(baseItem);
        if (!canonical) return;

        const current = item.system?.ability;
        if ((!current || current === "int") && current !== canonical) {
            item.updateSource({ "system.ability": canonical });
        }
    });

    // ============================================================
    // SECTION : proficiency d'outil sur la fiche d'acteur (PNJ/monstre
    // importé par Plutonium, ou tout acteur dont system.tools est rempli
    // directement plutôt que via un item) — voir le point 2) en tête de
    // fichier. Couvre la création ET la mise à jour d'un acteur, puisque
    // Plutonium peut renseigner les proficiencies après coup.
    // ============================================================
    Hooks.on("preCreateActor", (actor, data, options, userId) => {
        if (!game.settings.get(MOD, "enableToolAbilityFix")) return;

        const fixes = computeToolsAbilityFix(data.system?.tools);
        if (fixes) actor.updateSource({ system: { tools: fixes } });
    });

    Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
        if (!game.settings.get(MOD, "enableToolAbilityFix")) return;

        const fixes = computeToolsAbilityFix(changes.system?.tools);
        if (fixes) foundry.utils.mergeObject(changes, { system: { tools: fixes } });
    });

    // ============================================================
    // SECTION : rattrapage one-shot au chargement du monde, pour les
    // acteurs déjà importés AVANT l'ajout de ce correctif (donc jamais
    // passés par les hooks ci-dessus). GM uniquement, sans effet si rien
    // à corriger (idempotent, peut tourner à chaque chargement sans
    // risque).
    // ============================================================
    Hooks.on("ready", async () => {
        if (!game.user.isGM) return;
        if (!game.settings.get(MOD, "enableToolAbilityFix")) return;

        for (const actor of game.actors ?? []) {
            const fixes = computeToolsAbilityFix(actor.system?.tools);
            if (fixes) await actor.update({ system: { tools: fixes } });
        }
    });
}
