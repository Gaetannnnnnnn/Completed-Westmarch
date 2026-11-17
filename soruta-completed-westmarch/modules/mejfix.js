import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
// ============================================================
// mejfix.js — Correctif : envoi de documents vers un compendium avec
// Monk's Enhanced Journal actif
//
// Bug de MEJ (constaté en 14.02, Foundry v14) : MEJ remplace
// CompendiumCollection#importDocument et y appelle
//     MonksEnhancedJournal.fixType(this.object)
// Or un compendium n'a pas de propriété `object` : fixType reçoit `undefined`
// et plante (« can't access property "type", object is undefined »).
// Conséquence : AUCUN document ne peut plus être envoyé dans un compendium —
// glisser-déposer d'une playlist, d'un acteur, d'un objet… — sans message.
//
// Correctif : fixType ignore un objet absent (null / undefined). Le reste de
// MEJ est inchangé : sa préparation des journaux à l'import est conservée,
// puis l'import normal de Foundry a lieu.
// Si MEJ corrige un jour son code, ce garde-fou devient simplement inutile.
// Réglage : enableMejCompendiumFix.
// © 2026 Soruta.
// ============================================================

const actif = () => { try { return game.settings.get(MOD, "enableMejCompendiumFix") !== false; } catch { return true; } };
const MARQUE = Symbol.for("scwm.mejFixTypeGuard");

function installer() {
    if (!game.modules.get("monks-enhanced-journal")?.active) return;
    const MEJ = game.MonksEnhancedJournal ?? globalThis.MonksEnhancedJournal;
    if (!MEJ || typeof MEJ.fixType !== "function") return;
    if (MEJ.fixType[MARQUE]) return;   // déjà installé
    const original = MEJ.fixType;
    const garde = function (object, ...args) {
        if (object == null && actif()) return undefined;   // le cas qui plantait
        return original.call(this, object, ...args);
    };
    garde[MARQUE] = true;
    MEJ.fixType = garde;
    journal.info?.(tl("[{0}] Correctif Monk's Enhanced Journal : envoi vers les compendiums rétabli.", MOD));
}

export function MejFixHooks() {
    // MEJ s'installe à l'init ; on passe après lui.
    Hooks.once("setup", () => { try { installer(); } catch (e) { journal.avert(tl("[{0}] Correctif MEJ (compendiums) :", MOD), e); } });
    Hooks.once("ready", () => { try { installer(); } catch (e) { journal.avert(tl("[{0}] Correctif MEJ (compendiums) :", MOD), e); } });
}
