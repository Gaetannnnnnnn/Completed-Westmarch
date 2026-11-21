// ============================================================
// monk.js — Moine : Arts martiaux (Martial Arts) automatiques
//
// Règle : tant qu'il ne porte ni armure ni bouclier, un moine peut, avec ses
// frappes à mains nues et ses armes de moine :
//   - lancer son dé d'Arts martiaux à la place du dé normal de l'arme ;
//   - utiliser la Dextérité au lieu de la Force (attaque et dégâts) : le
//     module prend la meilleure des deux, donc la Dextérité pour un moine
//     classique, même si l'attaque de l'arme était réglée sur la Force.
//
// dnd5e le fait déjà pour la « Unarmed Strike » fournie avec la classe Moine
// (formule @scale.monk.die), mais pas pour les armes : la feature officielle
// propose un enchantement à appliquer arme par arme. Ici, rien à modifier :
// le module applique la règle EN MÉMOIRE, au moment où dnd5e prépare l'arme
// (rien n'est enregistré dans l'objet). La fiche affiche donc le bon dé, et
// tous les jets (dnd5e, Midi-QOL) l'utilisent.
//
// Armes de moine :
//   - règles 2024 : armes simples de corps à corps, et armes de guerre de
//     corps à corps avec la propriété Légère ;
//   - règles 2014 : épée courte, et armes simples de corps à corps sans les
//     propriétés À deux mains ni Lourde.
// La version des règles est celle de la classe Moine de l'acteur (source),
// sinon le réglage « Rules Version » de dnd5e.
//
// Le dé ne remplace celui de l'arme que s'il est plus grand (la règle dit
// « peut »). Une arme Polyvalente garde le plus grand des deux dés à deux mains.
// Réglage : enableMonkMartialArts (Modifications ciblées → Classes → Moine).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";

const actif = () => { try { return game.settings.get(MOD, "enableMonkMartialArts") === true; } catch { return false; } };

// Dé d'Arts martiaux par niveau de moine, si l'échelle de la classe manque.
const DE_2024 = [[17, 12], [11, 10], [5, 8], [1, 6]];
const DE_2014 = [[17, 10], [11, 8], [5, 6], [1, 4]];
const ARMURES = new Set(["light", "medium", "heavy", "shield"]);

// Valeurs d'origine des armes modifiées, pour rester idempotent et pouvoir
// revenir en arrière (réglage décoché, armure enfilée…).
const ORIGINES = new WeakMap();

function classeMoine(actor) {
    return actor?.classes?.monk
        ?? actor?.items?.find?.(i => i.type === "class" && (i.system?.identifier === "monk" || /^(monk|moine)$/i.test(i.name ?? "")));
}

function regles2024(classe) {
    const r = String(classe?.system?.source?.rules ?? "");
    if (r === "2024") return true;
    if (r === "2014") return false;
    try { return game.settings.get("dnd5e", "rulesVersion") !== "legacy"; } catch { return true; }
}

// Nombre de faces du dé d'Arts martiaux (échelle de la classe, sinon le niveau).
export function deArtsMartiaux(actor, classe = classeMoine(actor)) {
    if (!classe) return 0;
    const echelle = actor.system?.scale?.monk ?? actor.system?.scale?.[classe.system?.identifier] ?? {};
    const cles = Object.keys(echelle).sort((a, b) => (/die|martial/i.test(b) ? 1 : 0) - (/die|martial/i.test(a) ? 1 : 0));
    for (const cle of cles) {
        const faces = Number(echelle[cle]?.faces);
        if (faces > 0) return faces;
    }
    const niveau = Number(classe.system?.levels ?? 0);
    const table = regles2024(classe) ? DE_2024 : DE_2014;
    return table.find(([min]) => niveau >= min)?.[1] ?? 0;
}

function porteArmureOuBouclier(actor) {
    return !!actor.items?.some?.(i => i.type === "equipment" && i.system?.equipped && ARMURES.has(i.system?.type?.value));
}

export function estMainsNues(item) {
    return item.system?.identifier === "unarmed-strike"
        || /unarmed strike|mains? nues?/i.test(item.name ?? "");
}

export function estArmeDeMoine(item, en2024) {
    const s = item.system ?? {};
    const type = s.type?.value;
    const props = s.properties;
    const a = (p) => !!props?.has?.(p);
    if (en2024) return type === "simpleM" || (type === "martialM" && a("lgt"));
    return s.type?.baseItem === "shortsword" || (type === "simpleM" && !a("two") && !a("hvy"));
}

function memoriser(sys) {
    if (ORIGINES.has(sys)) return ORIGINES.get(sys);
    const b = sys.damage?.base ?? {};
    const v = sys.damage?.versatile ?? {};
    const o = {
        fin: !!sys.properties?.has?.("fin"),
        number: b.number, denomination: b.denomination,
        customEnabled: b.custom?.enabled, customFormula: b.custom?.formula,
        vNumber: v.number, vDenomination: v.denomination,
        stepped: typeof b.steppedDenomination === "function" ? b.steppedDenomination() : null,
        // Caractéristique imposée par chaque activité d'attaque (id → valeur).
        attaques: new Map(Array.from(sys.activities?.values?.() ?? []).filter(a => a?.type === "attack" && a.attack)
            .map(a => [a.id, a.attack.ability]))
    };
    ORIGINES.set(sys, o);
    return o;
}

function restaurer(sys) {
    const o = ORIGINES.get(sys);
    if (!o) return;
    const b = sys.damage?.base, v = sys.damage?.versatile;
    if (!o.fin) sys.properties?.delete?.("fin");
    if (b) {
        b.number = o.number; b.denomination = o.denomination;
        if (b.custom) { b.custom.enabled = o.customEnabled; b.custom.formula = o.customFormula; }
    }
    if (v) { v.number = o.vNumber; v.denomination = o.vDenomination; }
    for (const [id, ability] of o.attaques) {
        const act = sys.activities?.get?.(id);
        if (act?.attack) act.attack.ability = ability;
    }
    ORIGINES.delete(sys);
}

// Ce que le module a changé sur chaque arme (pour l'icône « modifié par le
// module » de la fiche, cf. gere.js). Clé : l'objet system préparé.
const MODIFS = new WeakMap();
export function modifsArtsMartiaux(item) {
    const m = item?.system ? MODIFS.get(item.system) : null;
    return m?.lignes?.length ? m : null;
}

// ---- Tavern Brawler (Bagarreur de taverne) -----------------------------------
// 2024 : frappe à mains nues 1d4 + Force au lieu des dégâts normaux, et les 1
// des dés de dégâts de la frappe à mains nues sont relancés (nouveau jet gardé).
// 2014 : frappe à mains nues 1d4. Le d4 ne remplace JAMAIS un meilleur dé
// (dé d'Arts martiaux du moine, par ex.) ; la relance s'applique à tout dé.
// Réglage : enableTavernBrawler (Modifications ciblées → Features).
const bagarreurActif = () => { try { return game.settings.get(MOD, "enableTavernBrawler") === true; } catch { return false; } };
export function donBagarreur(actor) {
    return actor?.items?.find?.(i => i.type === "feat"
        && (i.system?.identifier === "tavern-brawler" || /^(tavern brawler|bagarreur( de taverne)?)$/i.test(String(i.name ?? "").trim())));
}

// Applique (ou retire) les Arts martiaux et Tavern Brawler sur une arme, en mémoire.
export function appliquerArtsMartiaux(item) {
    if (item?.type !== "weapon") return;
    const sys = item.system;
    const actor = item.actor;
    const mainsNues = !!actor && estMainsNues(item);
    const classe = actif() && actor ? classeMoine(actor) : null;
    const moine = !!classe && !porteArmureOuBouclier(actor)
        && (mainsNues || estArmeDeMoine(item, regles2024(classe)));
    const faces = moine ? deArtsMartiaux(actor, classe) : 0;
    const don = mainsNues && bagarreurActif() ? donBagarreur(actor) : null;
    if ((!moine || !faces) && !don) { restaurer(sys); MODIFS.delete(sys); return; }
    if (!sys.damage?.base) { MODIFS.delete(sys); return; }

    const o = memoriser(sys);
    const b = sys.damage.base;
    // Chaque changement : { source (d'où vient la règle), texte (ce qui change) }.
    const changes = [];
    const srcMoine = classe ? tl("Arts martiaux — Moine niv. {0}, règles {1}, sans armure ni bouclier",
        classe.system?.levels ?? "?", regles2024(classe) ? "2024" : "2014") : "";

    if (moine && faces) {
        // Dextérité : la propriété Finesse fait prendre la meilleure des deux
        // (la Dextérité pour un moine classique). Une activité d'attaque réglée
        // sur « Force » repasse en automatique, sinon elle ignorerait la Dextérité.
        sys.properties?.add?.("fin");
        let forceLibre = false;
        for (const [id, ability] of o.attaques) {
            const act = sys.activities?.get?.(id);
            if (act?.attack && ability === "str") { act.attack.ability = ""; forceLibre = true; }
        }
        if (!o.fin || forceLibre) changes.push({ source: srcMoine, texte: tl("Dextérité utilisable à la place de la Force, pour l'attaque et les dégâts (le module prend la meilleure des deux)") });
    }

    const de = (n, d) => (Number(n || 1) === 1 ? `d${d}` : `${n}d${d}`);
    if (mainsNues) {
        // Dé de départ de la frappe à mains nues : le dé d'Arts martiaux si la
        // formule native l'utilise déjà (@scale.monk), sinon le dé de l'objet
        // (0 pour « 1 + Force »).
        const echelleNative = /@scale\.monk\./.test(String(o.customFormula ?? ""));
        const deObjet = o.customEnabled ? 0 : (Number(o.number || 1) === 1 ? Number(o.denomination) || 0 : 0);
        const deDepart = echelleNative ? faces : deObjet;
        let deFinal = deDepart;
        if (moine && faces > deFinal) {
            deFinal = faces;
            changes.push({ source: srcMoine, texte: tl("dé de dégâts remplacé par le dé d'Arts martiaux d{0}{1}", faces, deDepart ? tl(" au lieu de d{0}", deDepart) : tl(" au lieu de 1 dégât fixe")) });
        }
        let relance = false;
        if (don) {
            const srcDon = tl("Tavern Brawler — don, règles {0}", "{R}");
            if (deFinal < 4) {
                changes.push({ source: srcDon, texte: tl("dégâts de la frappe à mains nues : 1d4 + modificateur au lieu de {0}", deDepart ? `d${deDepart}` : tl("1 dégât fixe")) });
                deFinal = 4;
            } else {
                const origine = (echelleNative || (moine && faces === deFinal)) ? tl("dé d'Arts martiaux du moine") : tl("dé de l'arme");
                changes.push({ source: srcDon, texte: tl("son d4 n'est PAS utilisé : le d{0} actuel ({1}) est au moins aussi bon", deFinal, origine) });
            }
            const r2024 = String(don.system?.source?.rules ?? "") === "2024"
                || (String(don.system?.source?.rules ?? "") !== "2014" && (() => { try { return game.settings.get("dnd5e", "rulesVersion") !== "legacy"; } catch { return true; } })());
            for (const c of changes) if (c.source === srcDon) c.source = srcDon.replace("{R}", r2024 ? "2024" : "2014");
            if (r2024 && b.custom) { relance = true; changes.push({ source: srcDon.replace("{R}", "2024"), texte: tl("un 1 sur un dé de dégâts est relancé et le nouveau résultat est gardé (« r1 » dans la formule)") }); }
        }
        if (deFinal !== deDepart || relance) {
            if (b.custom) { b.custom.enabled = true; b.custom.formula = `1d${deFinal}${relance ? "r1" : ""} + @mod`; }
            else { b.number = 1; b.denomination = deFinal; }
        }
    } else if (moine && faces && !o.customEnabled) {   // formule personnalisée : on n'y touche pas
        // Arme de moine : un seul dé, remplacé s'il est plus petit.
        const nombre = Number(o.number || 1);
        if (nombre === 1 && Number(o.denomination || 0) < faces) {
            b.number = 1; b.denomination = faces;
            changes.push({ source: srcMoine, texte: tl("dé de dégâts remplacé par le dé d'Arts martiaux d{0} au lieu de {1}", faces, de(o.number, o.denomination)) });
        }
        if (sys.isVersatile && sys.damage.versatile) {
            const vOrig = Number(o.vDenomination || o.stepped || o.denomination || 0);
            const v = sys.damage.versatile;
            if (Number(o.vNumber || nombre) === 1 && vOrig < faces) { v.number = 1; v.denomination = faces; }
            else { v.number = o.vNumber || nombre; v.denomination = vOrig; }
        }
    }
    if (!changes.length) { MODIFS.delete(sys); return; }
    // Formule de dégâts obtenue, pour qu'on voie le résultat final.
    let formule = b.custom?.enabled ? String(b.custom.formula ?? "") : (b.denomination ? `${b.number || 1}d${b.denomination} + @mod` : "");
    if (faces) formule = formule.replace(/@scale\.monk\.[\w-]+/g, `1d${faces}`);
    formule = formule.replace(/@mod/g, tl("mod."));
    MODIFS.set(sys, { lignes: changes, formule });
}

// Re-prépare les acteurs moines et bagarreurs (réglage changé).
export function rafraichirMoines() {
    for (const a of game.actors ?? []) {
        if (!classeMoine(a) && !donBagarreur(a)) continue;
        try { a.reset(); a.sheet?.rendered && a.sheet.render(); } catch { /* */ }
    }
}

export function MonkHooks() {
    // dnd5e calcule le dé et les caractéristiques d'une arme dans
    // prepareFinalAttributes (après l'échelle des classes) : on s'insère juste avant.
    const cible = "CONFIG.Item.documentClass.prototype.prepareFinalAttributes";
    const avant = function (wrapped, ...args) {
        try { appliquerArtsMartiaux(this); } catch (e) { journal.avert(tl("[{0}] Arts martiaux du moine :", MOD), e); }
        return wrapped(...args);
    };
    try {
        if (game.modules.get("lib-wrapper")?.active && globalThis.libWrapper) {
            libWrapper.register(MOD, cible, avant, "WRAPPER");
        } else {
            const proto = CONFIG.Item.documentClass.prototype;
            const original = proto.prepareFinalAttributes;
            if (typeof original !== "function") return;
            proto.prepareFinalAttributes = function (...args) { return avant.call(this, original.bind(this), ...args); };
        }
    } catch (e) {
        journal.erreur(tl("[{0}] Arts martiaux du moine : impossible de s'insérer dans dnd5e.", MOD), e);
    }
}
