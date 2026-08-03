// ============================================================
// migration.js — Reprise automatique des données des anciens modules
// vers le module fusionné "Soruta — Completed Westmarch".
//
// Migre, une seule fois (au premier "ready" GM) :
//   1) les SETTINGS des anciens namespaces vers les nouvelles clés ;
//   2) les FLAGS de tous les documents (acteurs, scènes, tokens, users…)
//      des anciens scopes vers le scope unique MOD.
//
// Non destructif : les anciennes valeurs sont laissées en place (au cas où).
// © 2026 Soruta.
// ============================================================

import { MOD, LEGACY_IDS, TUTO_TOGGLES } from "./const.js";

// Version courante du schéma de migration. Incrémenter si de nouvelles
// reprises sont ajoutées plus tard.
const MIGRATION_VERSION = 1;

// ------------------------------------------------------------
// Table de correspondance des SETTINGS : "ancienNamespace.ancienneClé" → "nouvelleClé"
// ------------------------------------------------------------
function buildSettingsMap() {
    const map = {};
    const same = (ns, keys) => keys.forEach(k => { map[`${ns}.${k}`] = k; });

    // Westmarch (clés inchangées)
    same("westmarch", [
        "enableParty", "enableJoinScene", "enableShowParty", "enablePlayerGrouping",
        "enableGoWithPartyScenes", "enableGoWithPartyJournal", "enableChatFilter",
        "enableWebhook", "enableSessionLog", "enableCombatParty", "enableAntiCheat"
    ]);

    // Ashara (clés inchangées)
    same("westmarch-ashara", [
        "enableXpBlock", "enableDiscordLog",
        "discordLogWebhookUrl", "downtimeWebhookUrl", "tmWebhookUrl"
    ]);

    // Toolkit (clés inchangées)
    same("toolkit", [
        "enableTokenAppearance", "enableTokenPortraitButton", "enableRageSize",
        "enableLargeForm", "enablePolymorph", "enableTgcm", "enableFolderMove",
        "enableToolAbilityFix", "enableTemplateSnap", "enableMejShopFix", "enableMejRestock",
        "shopRestockDays", "shopRestockDaysCommon", "shopRestockDaysUncommon",
        "shopRestockDaysRare", "shopRestockDaysVeryRare", "shopRestockDaysLegendary"
    ]);

    // Carte des expéditions (clés inchangées)
    same("carte-expeditions", ["enableExpeditionMap", "expeditionMapSceneId"]);

    // Relations (clés préfixées)
    map["ashara-relations.enabled"]         = "relationsEnabled";
    map["ashara-relations.anonymization"]   = "relationsAnonymization";
    map["ashara-relations.folderPJ"]        = "relationsFolderPJ";
    map["ashara-relations.folderPNJ"]       = "relationsFolderPNJ";
    map["ashara-relations.folderCreatures"] = "relationsFolderCreatures";

    // Bestiaire (clés préfixées)
    map["ashara-bestiary.enabled"]          = "bestiaryEnabled";
    map["ashara-bestiary.anonymization"]    = "bestiaryAnonymization";
    map["ashara-bestiary.folderPJ"]         = "bestiaryFolderPJ";
    map["ashara-bestiary.packCreatures"]    = "bestiaryPackCreatures";
    map["ashara-bestiary.folderCreatures"]  = "bestiaryFolderCreatures";

    // Carnet (clé préfixée)
    map["carnet.enabled"]                   = "carnetEnabled";

    // Midi range fix (clés préfixées)
    map["midi-range-fix.enabled"]           = "rangeFixEnabled";
    map["midi-range-fix.rangeAdjust"]       = "rangeAdjust";

    // Tutoriel
    map["tutoriel.serverName"]              = "serverName";
    map["tutoriel.showWelcome"]             = "showWelcome";
    for (const { key, legacy } of TUTO_TOGGLES) {
        map[`tutoriel.${legacy}`] = key;
    }

    return map;
}

// ------------------------------------------------------------
// Table de correspondance des FLAGS : "ancienScope.ancienneClé" → "nouvelleClé"
// Seule collision réelle : "list" (relations ↔ bestiaire).
// ------------------------------------------------------------
function remapFlagKey(scope, key) {
    if (scope === "ashara-relations" && key === "list") return "relationsList";
    if (scope === "ashara-bestiary"  && key === "list") return "bestiaryList";
    return key;
}

// ------------------------------------------------------------
// Lecture BRUTE d'une valeur de setting stockée, sans nécessiter que
// l'ancien module soit encore enregistré/installé.
// ------------------------------------------------------------
function readRawWorldSetting(fullKey) {
    try {
        const storage = game.settings.storage.get("world");
        // v13 : collection de Setting documents (.key / .value JSON string)
        const doc = storage?.find?.(s => s.key === fullKey);
        if (!doc) return undefined;
        const raw = doc.value;
        try { return JSON.parse(raw); } catch { return raw; }
    } catch (e) {
        console.warn(`[${MOD}] readRawWorldSetting échec pour ${fullKey}:`, e);
        return undefined;
    }
}

async function migrateSettings() {
    const map = buildSettingsMap();
    let count = 0;
    for (const [oldFull, newKey] of Object.entries(map)) {
        const val = readRawWorldSetting(oldFull);
        if (val === undefined) continue; // jamais modifié → défaut conservé
        try {
            const cur = game.settings.get(MOD, newKey);
            if (cur === val) continue;
            await game.settings.set(MOD, newKey, val);
            count++;
        } catch (e) {
            console.warn(`[${MOD}] migration setting ${oldFull} → ${newKey} échec:`, e);
        }
    }
    return count;
}

// ------------------------------------------------------------
// Migration des flags d'un document (copie ancien scope → MOD).
// ------------------------------------------------------------
function collectFlagUpdates(doc) {
    const updates = {};
    const flags = doc.flags ?? {};
    for (const scope of LEGACY_IDS) {
        const bag = flags[scope];
        if (!bag || typeof bag !== "object") continue;
        for (const [key, val] of Object.entries(bag)) {
            const newKey = remapFlagKey(scope, key);
            // Ne pas écraser une valeur déjà migrée (idempotence).
            if (flags[MOD]?.[newKey] !== undefined) continue;
            updates[`flags.${MOD}.${newKey}`] = val;
        }
    }
    return updates;
}

async function migrateDocuments(collection, label) {
    let count = 0;
    for (const doc of collection) {
        try {
            const updates = collectFlagUpdates(doc);
            if (Object.keys(updates).length) {
                await doc.update(updates, { diff: false });
                count++;
            }
        } catch (e) {
            console.warn(`[${MOD}] migration flags ${label} "${doc?.name ?? doc?.id}" échec:`, e);
        }
    }
    return count;
}

async function migrateSceneTokens() {
    let count = 0;
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            try {
                const updates = collectFlagUpdates(token);
                if (Object.keys(updates).length) {
                    await token.update(updates, { diff: false });
                    count++;
                }
            } catch (e) {
                console.warn(`[${MOD}] migration flags token "${token?.name}" (scène ${scene?.name}) échec:`, e);
            }
        }
    }
    return count;
}

// Pages de journal — les timers de réapprovisionnement des boutiques MEJ
// (restock / restockEnabled) sont stockés sur les JournalEntryPage.
async function migrateJournalPages() {
    let count = 0;
    for (const entry of game.journal) {
        for (const page of entry.pages) {
            try {
                const updates = collectFlagUpdates(page);
                if (Object.keys(updates).length) {
                    await page.update(updates, { diff: false });
                    count++;
                }
            } catch (e) {
                console.warn(`[${MOD}] migration flags page "${page?.name}" (journal ${entry?.name}) échec:`, e);
            }
        }
    }
    return count;
}

// ------------------------------------------------------------
// Point d'entrée — appelé au hook "ready".
// ------------------------------------------------------------
export function MigrationHooks() {
    Hooks.once("ready", async () => {
        // Seul le GM actif effectue les écritures (évite les doublons multi-clients).
        const primaryGM = game.users?.activeGM ?? game.users?.find(u => u.isGM && u.active);
        if (!game.user.isGM || (primaryGM && primaryGM !== game.user)) return;

        const done = game.settings.get(MOD, "migrationVersion");
        if (done >= MIGRATION_VERSION) return;

        console.log(`[${MOD}] Migration des données des anciens modules — démarrage…`);

        const nSettings = await migrateSettings();
        const nActors   = await migrateDocuments(game.actors, "acteur");
        const nScenes   = await migrateDocuments(game.scenes, "scène");
        const nTokens   = await migrateSceneTokens();
        const nUsers    = await migrateDocuments(game.users, "utilisateur");
        const nItems    = await migrateDocuments(game.items, "objet");
        const nJournals = await migrateDocuments(game.journal, "journal");
        const nPages    = await migrateJournalPages();
        const nCombats  = await migrateDocuments(game.combats, "combat");

        await game.settings.set(MOD, "migrationVersion", MIGRATION_VERSION);

        const total = nActors + nScenes + nTokens + nUsers + nItems + nJournals + nPages + nCombats;
        console.log(`[${MOD}] Migration terminée — ${nSettings} settings, ${total} documents (` +
            `${nActors} acteurs, ${nScenes} scènes, ${nTokens} tokens, ${nUsers} users, ${nItems} objets, ${nJournals} journaux, ${nPages} pages, ${nCombats} combats).`);
        ui.notifications?.info(
            `Completed Westmarch : migration des données terminée (${nSettings} réglages, ${total} documents).`,
            { permanent: false }
        );
    });
}
