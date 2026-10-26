import { MOD } from "./const.js";
import { journal, definirRelais, INVITATION } from "./log.js";
// ============================================================
// discordlog.js — Log des modifications vers un salon Discord
// Envoie un message via webhook Discord pour : ajout/suppression
// d'objets d'inventaire, changement de quantité, gain d'XP/niveau,
// et création/suppression de personnages.
// ============================================================

const INVENTORY_TYPES = ["weapon", "equipment", "consumable", "tool", "backpack", "loot"];

// Autres éléments de fiche (non-inventaire) dont l'ajout/retrait est loggé
// via l'interrupteur « Niveaux & autres éléments ».
const ELEMENT_TYPES = ["feat", "spell", "race", "class", "subclass", "background"];
const ELEMENT_LABELS = {
    feat: "aptitude/don", spell: "sort", race: "espèce", class: "classe",
    subclass: "sous-classe", background: "historique"
};

// Raccourci lecture d'un interrupteur de contenu loggé.
const _log = (k) => game.settings.get(MOD, k);

// Un acteur est-il loggé ? PJ toujours ; PNJ seulement si « Inclure les PNJ ».
// Un PNJ importé d'un compendium n'est jamais loggé (voir importeDuCompendium).
const _actorLogged = (actor) =>
    !!actor && (actor.type === "character" || (actor.type === "npc" && _log("logIncludeNpc") && !importeDuCompendium(actor)));

// Acteur (non PJ) importé depuis un compendium (créatures, PNJ du
// compendium, import Plutonium) : jamais loggé, pour ne pas dévoiler aux
// lecteurs du salon ce que le MJ prépare.
function importeDuCompendium(actor) {
    if (!actor || actor.type === "character") return false;
    const src = actor._stats?.compendiumSource ?? actor.getFlag?.("core", "sourceId") ?? actor.flags?.core?.sourceId ?? "";
    if (typeof src === "string" && src.startsWith("Compendium.")) return true;
    return !!(actor.flags?.plutonium || actor.flags?.["5etools"]);
}

// ============================================================
// Horodatage classique ajouté devant chaque message de log Discord :
// jour/mois/année heure:minute:seconde.
// ============================================================
function buildTimestamp() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");

    return `${day}/${month}/${year} ${hh}:${mm}:${ss}`;
}

// Anti-doublon par contenu : certains modules tiers (ex. Monks TokenBar /
// Assign XP) déclenchent parfois deux fois le même hook preUpdateActor pour
// un seul et même changement réel (avant/après identiques). Ce n'est pas
// dû à plusieurs GM connectés (déjà géré par activeGM ci-dessous), donc on
// bloque aussi tout message strictement identique envoyé dans les 5
// dernières secondes.
const recentMessages = new Map();
const DEDUPE_WINDOW_MS = 5000;

function isDuplicate(content) {
    const now = Date.now();
    for (const [msg, ts] of recentMessages) {
        if (now - ts > DEDUPE_WINDOW_MS) recentMessages.delete(msg);
    }
    if (recentMessages.has(content)) return true;
    recentMessages.set(content, now);
    return false;
}

// Détermine si CE client est celui qui doit envoyer le message (un seul
// client doit le faire, peu importe combien sont connectés).
function isElectedSender() {
    // En priorité, le GM "actif" (désignation déterministe de Foundry,
    // identique sur tous les clients).
    const activeGM = game.users.activeGM;
    if (activeGM) return game.user.id === activeGM.id;

    // Aucun GM connecté (ex. joueurs qui gèrent leur inventaire entre deux
    // sessions) : avec l'ancien code, personne ne correspondait jamais à
    // activeGM et le message était silencieusement perdu. On élit donc à
    // la place l'utilisateur actif avec l'id le plus petit — un calcul
    // déterministe, identique sur tous les clients connectés.
    const activeUsers = game.users.filter(u => u.active);
    if (activeUsers.length === 0) return false;
    const elected = activeUsers.reduce((a, b) => (a.id < b.id ? a : b));
    return game.user.id === elected.id;
}

// Thèmes de log : quand le thème change d'un message à l'autre, une ligne de
// séparation portant le nom du nouveau thème est ajoutée au-dessus.
// (Mémoire propre à chaque client : un message envoyé par un autre client
// entre-temps n'est pas connu, la ligne peut donc parfois manquer ou se
// répéter.)
const THEMES = {
    inventaire: "📦 Inventaire", elements: "📜 Aptitudes, sorts & éléments", progression: "⬆️ Progression",
    monnaie: "💰 Monnaie", modifs: "✏️ Modifications de fiche", fiches: "🧾 Personnages",
    scenes: "🗺️ Scènes", journaux: "📔 Journaux", problemes: "🚨 Problèmes du module"
};
let _dernierTheme = null;
function ligneTheme(theme) {
    if (!theme || theme === _dernierTheme) return "";
    _dernierTheme = theme;
    return `─────── ${THEMES[theme] ?? theme} ───────\n`;
}

// Envoie effectivement le message au webhook (logique commune).
function postToWebhook(content, theme) {
    if (!game.settings.get(MOD, "enableDiscordLog")) return;
    if (isDuplicate(content)) return;

    const url = game.settings.get(MOD, "discordLogWebhookUrl");
    if (!url) return;

    const timestamped = `${ligneTheme(theme)}\`${buildTimestamp()}\` ${content}`;

    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: timestamped, username: "WestMarch Log" })
    }).catch(err => journal.erreurLocale("[WestMarch] Erreur envoi Discord log :", err));
}

// Pour les hooks "post" (createItem/deleteItem/createActor/deleteActor) :
// ceux-ci se déclenchent sur TOUS les clients connectés une fois la
// modification confirmée par le serveur (GM ET joueurs). Sans élection,
// chaque client connecté enverrait son propre message en double. On
// élit donc un seul client responsable de l'envoi.
function sendToDiscord(content, theme) {
    if (!isElectedSender()) return;
    postToWebhook(content, theme);
}

// Pour les hooks "pre" (preUpdateItem/preUpdateActor) : ceux-ci ne se
// déclenchent QUE sur le client qui exécute réellement la modification
// (celui qui appelle .update()), jamais sur les autres clients connectés.
// Appliquer l'élection ici était le bug : quand un JOUEUR modifiait sa
// quantité/monnaie/XP, son client (le seul à voir le hook) n'était
// jamais "l'élu" dès qu'un GM était connecté — et le GM, lui, ne voyait
// jamais le hook puisqu'il ne l'exécutait pas. Résultat : aucun message
// n'était jamais envoyé pour les actions des joueurs. Ici, pas de risque
// de doublon multi-client (un seul client exécute l'update), donc on
// envoie directement, sans élection.
function sendToDiscordDirect(content, theme) {
    postToWebhook(content, theme);
}

// Tag d'auteur pour affichage dans le log : ajoute un ⚠️ quand l'action
// vient d'un joueur (et non d'un GM), pour repérer en un coup d'œil les
// modifications faites par les joueurs eux-mêmes.
function authorTag(userId) {
    const user = game.users.get(userId);
    const name = user?.name ?? "Inconnu";
    if (user && !user.isGM) {
        return `⚠️ *(par ${name} — joueur)*`;
    }
    return `*(par ${name})*`;
}

// ============================================================
// Modifications de fiche (objets / aptitudes / sorts et fiche elle-même)
// ============================================================
// Ce qui change EN JEU n'est pas une modification de fiche : ignoré.
const IGNORE_ITEM = [/^_id$/, /^_stats/, /^flags(\.|$)/, /^sort$/, /^ownership/, /^folder$/,
    /^system\.quantity/, /^system\.levels$/,                          // déjà loggés à part
    /^system\.uses\.(spent|value)$/, /^system\.recharge\.charged$/, /^system\.hd\.spent$/,
    /^system\.activities\.[^.]+\.uses\.(spent|value)$/,
    /^system\.equipped$/, /^system\.attuned$/, /^system\.prepared$/, /^system\.preparation\.prepared$/,
    /^system\.container$/];
const IGNORE_ACTOR = [/^_id$/, /^_stats/, /^flags(\.|$)/, /^sort$/, /^ownership/, /^folder$/, /^prototypeToken/,
    /^system\.attributes\.hp\.(value|temp|tempmax)$/, /^system\.attributes\.death/, /^system\.attributes\.exhaustion$/,
    /^system\.attributes\.inspiration$/, /^system\.details\.xp/, /^system\.currency/,
    /^system\.resources\.[^.]+\.value$/, /^system\.spells\.[^.]+\.value$/, /^system\.favorites/];

const LIBELLES_ITEM = [["name", "nom"], ["img", "image"], ["system.description", "description"],
    ["system.activities", "actions"], ["system.damage", "dégâts"], ["system.range", "portée"], ["system.uses", "utilisations"],
    ["system.properties", "propriétés"], ["system.price", "prix"], ["system.weight", "poids"], ["system.rarity", "rareté"],
    ["system.armor", "armure"], ["system.level", "niveau du sort"], ["system.school", "école"], ["system.duration", "durée"],
    ["system.target", "cible / zone"], ["system.activation", "activation"], ["system.attunement", "harmonisation requise"],
    ["system.identified", "identifié"], ["system.type", "type"], ["system.requirements", "prérequis"], ["system.source", "source"],
    ["system.magicalBonus", "bonus magique"], ["system.ability", "caractéristique"], ["system.save", "jet de sauvegarde"],
    ["system.formula", "formule"], ["system.advancement", "avancements"], ["system.identifier", "identifiant"],
    ["system.strength", "force requise"], ["system.capacity", "capacité"], ["system.materials", "composantes"],
    ["system.properties", "propriétés"], ["system.recharge", "recharge"], ["system.hd", "dés de vie"]];
const LIBELLES_ACTOR = [["name", "nom"], ["img", "portrait"], ["system.details.biography", "biographie"],
    ["system.details", "détails"], ["system.traits.languages", "langues"], ["system.traits.dr", "résistances"],
    ["system.traits.di", "immunités"], ["system.traits.dv", "vulnérabilités"], ["system.traits.ci", "immunités aux états"],
    ["system.traits.weaponProf", "maîtrises d'armes"], ["system.traits.armorProf", "maîtrises d'armures"],
    ["system.traits", "traits"], ["system.attributes.movement", "vitesses"], ["system.attributes.senses", "sens"],
    ["system.attributes.ac", "CA"], ["system.attributes.hp", "PV max / bonus"], ["system.attributes.init", "initiative"],
    ["system.attributes.spellcasting", "caractéristique d'incantation"], ["system.attributes", "attributs"],
    ["system.bonuses", "bonus"], ["system.tools", "outils"], ["system.resources", "ressources"], ["system.spells", "emplacements de sorts"]];

const _json = (v) => JSON.stringify(v ?? null);
// Clés réellement modifiées (les fiches envoient souvent tout le formulaire).
function clesModifiees(doc, changes, ignore) {
    const plat = foundry.utils.flattenObject(changes ?? {});
    const out = [];
    for (const [k, v] of Object.entries(plat)) {
        const cle = k.replace(/\.-=([^.]+)$/, ".$1").replace(/^-=/, "");
        if (ignore.some(re => re.test(cle))) continue;
        const avant = foundry.utils.getProperty(doc._source ?? doc, cle);
        if (k.includes("-=")) { if (avant !== undefined) out.push({ cle, avant, apres: undefined }); continue; }
        if (_json(avant) !== _json(v)) out.push({ cle, avant, apres: v });
    }
    return out;
}
const court = (v) => (v === null || v === undefined) ? "∅" : (typeof v === "boolean" ? (v ? "oui" : "non") : String(v));
const scalaire = (v) => v === null || v === undefined || ["number", "boolean"].includes(typeof v) || (typeof v === "string" && v.length <= 40 && !v.includes("<"));

// Libellés lisibles : caractéristiques et compétences nommées, avant → après
// pour les valeurs simples, sinon juste le nom du champ.
function decrire(mods, libelles) {
    const vus = new Map();
    for (const m of mods) {
        let lib = null;
        const ab = m.cle.match(/^system\.abilities\.([a-z]{3})\.(value|proficient)$/);
        const sk = m.cle.match(/^system\.skills\.([a-z]{3})\.value$/);
        if (ab) {
            const nom = game.i18n?.localize?.(CONFIG.DND5E?.abilities?.[ab[1]]?.label ?? ab[1]) ?? ab[1];
            lib = ab[2] === "value" ? nom : `maîtrise des JS de ${nom}`;
        } else if (sk) {
            lib = `maîtrise ${game.i18n?.localize?.(CONFIG.DND5E?.skills?.[sk[1]]?.label ?? sk[1]) ?? sk[1]}`;
        } else {
            const trouve = libelles.find(([pre]) => m.cle === pre || m.cle.startsWith(pre + "."));
            lib = trouve ? trouve[1] : m.cle.replace(/^system\./, "").split(".")[0];
        }
        const exact = ab || sk || libelles.some(([pre]) => m.cle === pre);
        const detail = exact && scalaire(m.avant) && scalaire(m.apres) ? ` ${court(m.avant)} → ${court(m.apres)}` : "";
        if (!vus.has(lib) || detail) vus.set(lib, `${lib}${detail}`);
    }
    return [...vus.values()];
}
const ITEM_LABEL_TYPE = { weapon: "arme", equipment: "équipement", consumable: "consommable", tool: "outil", loot: "objet",
    container: "contenant", backpack: "contenant", feat: "aptitude/don", spell: "sort", race: "espèce", class: "classe",
    subclass: "sous-classe", background: "historique" };

// Problèmes du module (erreurs, fonctions cassées, conflits) : envoyés dans
// le log Discord par le client où ils se produisent, avec la mention de
// contact. Branché sur log.js (definirRelais).
function envoyerProbleme({ niveau, texte, detail }) {
    try { if (!_log("logModuleErrors")) return; } catch { return; }
    const u = game.user;
    const qui = u ? `${u.name}${u.isGM ? " (MJ)" : " (joueur)"}` : "?";
    const versions = `Foundry ${game.version ?? "?"} · ${game.system?.id ?? "?"} ${game.system?.version ?? ""} · module ${game.modules?.get(MOD)?.version ?? "?"}`;
    const titre = niveau === "conflit" ? "🧩 **Conflit ou fonction cassée dans le module**" : "🚨 **Erreur dans le module**";
    const corps = `${titre} — chez ${qui}\n> ${texte.slice(0, 900)}${detail ? `\n\`${detail.slice(0, 300)}\`` : ""}\n-# ${versions}\n➡️ **Contacter le propriétaire du module** : ouvrez un ticket sur le Discord Althéia (pas de message privé, merci) — ${INVITATION}`;
    postToWebhook(corps, "problemes");
}

export function DiscordLogHooks() {
    definirRelais(envoyerProbleme);


    // ============================================================
    // SECTION : Items d'inventaire (ajout / suppression / quantité)
    // ============================================================
    Hooks.on("createItem", (item, options, userId) => {
        const actor = item.parent;
        if (!_actorLogged(actor)) return;

        if (INVENTORY_TYPES.includes(item.type)) {
            if (!_log("logInventory")) return;
            const qty = item.system?.quantity?.value;
            sendToDiscord(`📦 **${actor.name}** a obtenu **${item.name}**${qty > 1 ? ` x${qty}` : ""}. ${authorTag(userId)}`, "inventaire");
        } else if (ELEMENT_TYPES.includes(item.type)) {
            if (!_log("logLevelsElements")) return;
            sendToDiscord(`➕ **${actor.name}** a ajouté **${item.name}** (${ELEMENT_LABELS[item.type] ?? item.type}). ${authorTag(userId)}`, "elements");
        }
    });

    Hooks.on("deleteItem", (item, options, userId) => {
        const actor = item.parent;
        if (!_actorLogged(actor)) return;

        if (INVENTORY_TYPES.includes(item.type)) {
            if (!_log("logInventory")) return;
            sendToDiscord(`🗑️ **${actor.name}** a perdu **${item.name}**. ${authorTag(userId)}`, "inventaire");
        } else if (ELEMENT_TYPES.includes(item.type)) {
            if (!_log("logLevelsElements")) return;
            sendToDiscord(`➖ **${actor.name}** a retiré **${item.name}** (${ELEMENT_LABELS[item.type] ?? item.type}). ${authorTag(userId)}`, "elements");
        }
    });

    // preUpdateItem (et non updateItem) : au moment où updateItem se
    // déclenche, la modif est déjà appliquée sur le document, donc
    // item.system.X vaudrait déjà la valeur "après" et avant == après
    // en permanence. preUpdateItem fournit encore l'état "avant".
    Hooks.on("preUpdateItem", (item, changes, options, userId) => {
        const actor = item.parent;
        if (!actor) return;

        // ---- Quantité d'un objet d'inventaire ----
        // dnd5e envoie soit system.quantity (nombre brut, à plat — c'est
        // ce qu'envoie l'ajustement +/- de la fiche), soit system.quantity.value
        // (structure imbriquée) selon le point d'entrée utilisé.
        const quantityChange = typeof changes.system?.quantity === "number"
            ? changes.system.quantity
            : changes.system?.quantity?.value;

        if (_log("logInventory") && _actorLogged(actor) && INVENTORY_TYPES.includes(item.type) && quantityChange !== undefined) {
            const before = typeof item.system.quantity === "number"
                ? item.system.quantity
                : (item.system.quantity?.value ?? 0);
            const after = quantityChange;
            if (before !== after) {
                sendToDiscordDirect(`🔄 **${actor.name}** : quantité de **${item.name}** ${before} → ${after}. ${authorTag(userId)}`, "inventaire");
            }
        }

        // ---- Modification de l'objet / aptitude / sort ----
        if (_log("logSheetEdits") && _actorLogged(actor)) {
            const mods = clesModifiees(item, changes, IGNORE_ITEM);
            if (mods.length) {
                const lib = decrire(mods, LIBELLES_ITEM);
                const nom = mods.find(m => m.cle === "name") ? `**${item.name}** → **${changes.name}**` : `**${item.name}**`;
                sendToDiscordDirect(`✏️ **${actor.name}** a modifié ${nom} (${ITEM_LABEL_TYPE[item.type] ?? item.type}) : ${lib.join(", ")}. ${authorTag(userId)}`, "modifs");
            }
        }

        // ---- Niveau (via l'item de classe) ----
        if (_log("logLevelsElements") && _actorLogged(actor) && item.type === "class" && changes.system?.levels !== undefined) {
            const before = item.system.levels ?? 0;
            const after = changes.system.levels;
            if (before !== after) {
                sendToDiscordDirect(`⬆️ **${actor.name}** : niveau de **${item.name}** ${before} → ${after}. ${authorTag(userId)}`, "progression");
            }
        }
    });

    // ============================================================
    // SECTION : XP et monnaie
    // ============================================================
    // Même raison : preUpdateActor (avant la modif), pas updateActor.
    Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
        if (!_actorLogged(actor)) return;

        // ---- Modification de la fiche elle-même ----
        if (_log("logSheetEdits")) {
            const mods = clesModifiees(actor, changes, IGNORE_ACTOR);
            if (mods.length) sendToDiscordDirect(`✏️ **${actor.name}** : fiche modifiée — ${decrire(mods, LIBELLES_ACTOR).join(", ")}. ${authorTag(userId)}`, "modifs");
        }

        // ---- XP ----
        if (_log("logXp") && changes.system?.details?.xp?.value !== undefined) {
            const before = actor.system.details?.xp?.value ?? 0;
            const after = changes.system.details.xp.value;
            if (before !== after) {
                sendToDiscordDirect(`✨ **${actor.name}** : XP ${before} → ${after}. ${authorTag(userId)}`, "progression");
            }
        }

        // ---- Monnaie ----
        if (_log("logCurrency") && changes.system?.currency) {
            const before = actor.system.currency ?? {};
            const after = changes.system.currency;
            const labels = { pp: "PP", gp: "PO", ep: "PE", sp: "PA", cp: "PC" };
            const diffs = [];
            for (const [denom, newVal] of Object.entries(after)) {
                const oldVal = before[denom] ?? 0;
                if (newVal !== oldVal) {
                    const delta = newVal - oldVal;
                    diffs.push(`${labels[denom] ?? denom} : ${oldVal} → ${newVal} (${delta > 0 ? "+" : ""}${delta})`);
                }
            }
            if (diffs.length > 0) {
                sendToDiscordDirect(`💰 **${actor.name}** : ${diffs.join(", ")}. ${authorTag(userId)}`, "monnaie");
            }
        }
    });

    // ============================================================
    // SECTION : Création / suppression de fiches (PJ, + PNJ si activé)
    // ============================================================
    Hooks.on("createActor", (actor, options, userId) => {
        if (!_log("logActors") || !_actorLogged(actor)) return;
        const kind = actor.type === "npc" ? "PNJ" : "Personnage";
        sendToDiscord(`🆕 ${kind} créé : **${actor.name}**. ${authorTag(userId)}`, "fiches");
    });

    Hooks.on("deleteActor", (actor, options, userId) => {
        if (!_log("logActors") || !_actorLogged(actor)) return;
        const kind = actor.type === "npc" ? "PNJ" : "Personnage";
        sendToDiscord(`❌ ${kind} supprimé : **${actor.name}**. ${authorTag(userId)}`, "fiches");
    });

    // ============================================================
    // SECTION : Création / suppression de scènes (maps)
    // ============================================================
    Hooks.on("createScene", (scene, options, userId) => {
        if (!_log("logScenes")) return;
        sendToDiscord(`🗺️ Scène créée : **${scene.name}**. ${authorTag(userId)}`, "scenes");
    });

    Hooks.on("deleteScene", (scene, options, userId) => {
        if (!_log("logScenes")) return;
        sendToDiscord(`🗺️❌ Scène supprimée : **${scene.name}**. ${authorTag(userId)}`, "scenes");
    });

    // ============================================================
    // SECTION : Création / suppression de journaux
    // ============================================================
    Hooks.on("createJournalEntry", (entry, options, userId) => {
        if (!_log("logJournals")) return;
        sendToDiscord(`📔 Journal créé : **${entry.name}**. ${authorTag(userId)}`, "journaux");
    });

    Hooks.on("deleteJournalEntry", (entry, options, userId) => {
        if (!_log("logJournals")) return;
        sendToDiscord(`📔❌ Journal supprimé : **${entry.name}**. ${authorTag(userId)}`, "journaux");
    });
}
