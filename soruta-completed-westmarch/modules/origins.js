// ============================================================
// origins.js — Background personnalisé dans le compendium du module
//
// Réglage "enableCustomBackground" (section « Contenu personnalisé »,
// rechargement requis). Activé, le GM connecté remplit au chargement du
// monde le compendium « Backgrounds » du module (soruta-completed-westmarch
// .backgrounds, dossier « Soruta WestMarch ») avec le background
// « Origine personnalisée », écrit directement au format dnd5e :
//
//   - Valeurs de caractéristique : +2 / +1 ou +1 / +1 / +1, au choix parmi
//     les six (avancement AbilityScoreImprovement : 3 points, max 2 par
//     caractéristique, aucune verrouillée) ;
//   - Don : un don d'origine au choix (avancement ItemChoice, restreint aux
//     dons de sous-type « origin » ; la liste est construite à partir des
//     compendiums présents, et on peut aussi déposer un autre don) ;
//   - Compétences : deux au choix (Trait skills:*) ;
//   - Outil : un outil d'artisan, un instrument ou un jeu (Trait) ;
//   - Équipement : aucun, 200 po de richesse de départ.
//
// Une mise à jour du module remplace son dossier, compendium compris :
// le background est donc recréé au chargement suivant s'il manque, ou mis
// à jour si sa version (BG_VERSION) a changé. Le module ne supprime jamais
// rien quand le réglage est coupé.
// Contenu repris de homebrew/westmarch-perso.json (source WMP).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";

const PACK_ID    = `${MOD}.backgrounds`;
const BG_ID      = "scwmOriginePerso";   // 16 caractères : id stable du document
const BG_VERSION = 1;                    // à augmenter quand le contenu change

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

export function customBackgroundEnabled() {
    try { return game.settings.get(MOD, "enableCustomBackground") === true; } catch { return false; }
}

// Dons d'origine disponibles dans les compendiums d'objets chargés. À nom
// égal, on garde celui d'un compendium autre que le SRD du système (ex. le
// Player's Handbook officiel) : la liste ne montre pas deux fois le même don.
async function originFeatPool() {
    const byName = new Map();
    for (const pack of game.packs) {
        if (pack.documentName !== "Item" || pack.collection === PACK_ID) continue;
        let index;
        try { index = await pack.getIndex({ fields: ["system.type.value", "system.type.subtype"] }); }
        catch { continue; }
        for (const e of index) {
            if (e.type !== "feat" || e.system?.type?.value !== "feat" || e.system?.type?.subtype !== "origin") continue;
            const prev = byName.get(e.name);
            const fromSystem = pack.metadata?.packageName === game.system.id;
            if (!prev || (prev.fromSystem && !fromSystem)) byName.set(e.name, { uuid: e.uuid, fromSystem });
        }
    }
    return [...byName.values()].map((v, i) => ({ uuid: v.uuid, sort: (i + 1) * 100000 }));
}

function backgroundData(pool) {
    const zeros = Object.fromEntries(ABILITIES.map(a => [a, 0]));
    const description = [
        `<p><strong>${tl("Valeurs de caractéristique :")}</strong> ${tl("+2 à une caractéristique et +1 à une autre, ou +1 à trois caractéristiques différentes (au choix parmi les six).")}</p>`,
        `<p><strong>${tl("Don :")}</strong> ${tl("Un don d'origine au choix.")}</p>`,
        `<p><strong>${tl("Maîtrises de compétences :")}</strong> ${tl("Deux compétences au choix.")}</p>`,
        `<p><strong>${tl("Maîtrise d'outil :")}</strong> ${tl("Un outil d'artisan, un instrument de musique ou un jeu au choix.")}</p>`,
        `<p><strong>${tl("Équipement :")}</strong> ${tl("200 po, à dépenser pour acheter son équipement de départ.")}</p>`,
        `<h3>${tl("Description")}</h3>`,
        `<p>${tl("Ce background est laissé libre : chaque joueur en écrit l'histoire avec le MJ.")}</p>`
    ].join("");

    return {
        _id:  BG_ID,
        name: tl("Origine personnalisée"),
        type: "background",
        img:  "icons/svg/book.svg",
        system: {
            description: { value: description, chat: "" },
            identifier: "origine-personnalisee",
            source: { custom: "West Marches - Contenu personnalisé", rules: "2024", book: "WMP", license: "" },
            startingEquipment: [],
            wealth: "200",
            advancement: [
                {
                    _id: "scwmBgAsi0000001",
                    type: "AbilityScoreImprovement",
                    level: 0,
                    title: tl("Valeurs de caractéristique"),
                    hint: tl("+2 à une caractéristique et +1 à une autre, ou +1 à trois caractéristiques différentes (au choix parmi les six)."),
                    configuration: { cap: 2, points: 3, fixed: zeros, locked: [] },
                    value: {}
                },
                {
                    _id: "scwmBgFeat000001",
                    type: "ItemChoice",
                    level: 0,
                    title: tl("Don d'origine"),
                    hint: tl("Un don d'origine au choix."),
                    configuration: {
                        choices: { "0": { count: 1, replacement: false } },
                        allowDrops: true,
                        type: "feat",
                        pool,
                        spell: null,
                        restriction: { type: "feat", subtype: "origin" }
                    },
                    value: { added: {}, replaced: {} }
                },
                {
                    _id: "scwmBgSkills0001",
                    type: "Trait",
                    level: 0,
                    title: tl("Maîtrises de compétences"),
                    hint: tl("Deux compétences au choix."),
                    configuration: {
                        mode: "default", allowReplacements: false, grants: [],
                        choices: [{ count: 2, pool: ["skills:*"] }]
                    },
                    value: { chosen: [] }
                },
                {
                    _id: "scwmBgTool000001",
                    type: "Trait",
                    level: 0,
                    title: tl("Maîtrise d'outil"),
                    hint: tl("Un outil d'artisan, un instrument de musique ou un jeu au choix."),
                    configuration: {
                        mode: "default", allowReplacements: false, grants: [],
                        choices: [{ count: 1, pool: ["tool:art:*", "tool:music:*", "tool:game:*"] }]
                    },
                    value: { chosen: [] }
                }
            ]
        },
        flags: { [MOD]: { customBackgroundVersion: BG_VERSION } }
    };
}

/** Crée (ou met à jour) le background dans le compendium du module. */
async function installCustomBackground() {
    const pack = game.packs.get(PACK_ID);
    if (!pack) {
        journal.avert(tl("[{0}] Compendium « Backgrounds » introuvable : background personnalisé non installé.", MOD));
        return;
    }
    const index    = await pack.getIndex({ fields: [`flags.${MOD}.customBackgroundVersion`] });
    const existing = index.get(BG_ID);
    const version  = existing?.flags?.[MOD]?.customBackgroundVersion ?? 0;
    if (existing && version >= BG_VERSION) return;   // déjà à jour : rien à faire

    const wasLocked = pack.locked;
    try {
        if (wasLocked) await pack.configure({ locked: false });
        const data = backgroundData(await originFeatPool());
        const Item = foundry.documents?.Item ?? globalThis.Item;
        if (existing) {
            const doc = await pack.getDocument(BG_ID);
            await doc.update(data, { diff: false, recursive: false });
        } else {
            await Item.create(data, { pack: PACK_ID, keepId: true });
        }
        ui.notifications.info(tl("[{0}] Background « {1} » installé dans le compendium « Backgrounds ».", MOD, data.name));
    } catch (e) {
        journal.erreur(tl("[{0}] Installation du background personnalisé échouée", MOD), e);
        ui.notifications.error(tl("[{0}] Le background personnalisé n'a pas pu être installé (voir console).", MOD));
    } finally {
        if (wasLocked) { try { await pack.configure({ locked: true }); } catch { /* */ } }
    }
}

export function OriginsHooks() {
    Hooks.once("ready", async () => {
        if (!customBackgroundEnabled()) return;
        // Un seul GM écrit (le GM actif), pour éviter les doublons.
        if (!game.users.activeGM?.isSelf) return;
        await installCustomBackground();
    });
}
