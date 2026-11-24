import { MOD } from "./const.js";
import { tl } from "./i18n.js";
import { modifsArtsMartiaux } from "./monk.js";
// ============================================================
// gere.js — Indicateur « géré par le module » sur les fiches
//
// Sur la fiche d'un personnage, une petite icône d'engrenages dorée
// apparaît à côté :
//   - des aptitudes / dons dont le module automatise une règle (Healer,
//     Alert, Large Form, Giant's Havoc, Form of the Beast) : « Géré par… » ;
//   - des objets que le module MODIFIE ou crée (armes du moine sous Arts
//     martiaux : dé et Dextérité ; armes naturelles de Form of the Beast) :
//     « Modifié par <nom du module> : » puis le détail des changements.
// Seulement si la modification correspondante est
// activée (Modifications ciblées), et désactivable par chaque joueur dans
// « Accessibilité » (réglage client a11yManagedBadge).
// © 2026 Soruta.
// ============================================================

const lire = (k, def) => { try { return game.settings.get(MOD, k); } catch { return def; } };
const nom = (i) => String(i?.name ?? "").trim();
const ident = (i) => String(i?.system?.identifier ?? "").toLowerCase();

// Aptitudes gérées : test sur l'objet, réglage qui l'active, explication.
const GERES = [
    { test: (i) => i.type === "feat" && (ident(i) === "healer" || /^(healer|gu[ée]risseur)$/i.test(nom(i))), cle: "enableHealerReroll",
      texte: tl("les dés de soins de vos sorts (et du Battle Medic) relancent automatiquement les 1.") },
    { test: (i) => i.type === "feat" && (ident(i) === "alert" || /^(alert|vigilant)$/i.test(nom(i))), cle: "enableAlertSwap",
      texte: tl("après l'initiative, le MJ peut échanger la vôtre avec celle d'un autre joueur (bouton dans le suivi de combat).") },
    { test: (i) => /large form/i.test(nom(i)), cle: "enableLargeForm",
      texte: tl("utiliser cette aptitude fait passer votre jeton en taille Large, et inversement.") },
    { test: (i) => /giant.?s havoc/i.test(nom(i)), cle: "enableRageSize",
      texte: tl("pendant la Rage, votre jeton passe en taille Large.") },
    { test: (i) => i.type === "feat" && (ident(i) === "tavern-brawler" || /^(tavern brawler|bagarreur( de taverne)?)$/i.test(nom(i))), cle: "enableTavernBrawler",
      texte: tl("votre frappe à mains nues lance 1d4 (sauf si vous avez déjà un meilleur dé, comme celui d'Arts martiaux) et, en règles 2024, relance les 1 aux dégâts.") },
    { test: (i) => i.type === "feat" && ident(i) === "form-of-the-beast", cle: "enableFormOfTheBeast",
      texte: tl("les armes naturelles (Morsure, Griffes, Queue) sont créées automatiquement.") }
];

// Objets MODIFIÉS par le module (calcul en mémoire, ou objet créé par lui).
// Chaque entrée renvoie la liste des changements pour cet objet, ou null.
const MODIFIES = [
    (i) => modifsArtsMartiaux(i),
    (i) => i.getFlag?.(MOD, "beastWeapon") ? { lignes: [{ source: tl("Form of the Beast — Barbare, Voie de la Bête"), texte: tl("arme naturelle créée automatiquement par le module quand la forme est activée") }] } : null
];

// Icônes masquées si le joueur coche « Cacher les icônes du module » (Accessibilité),
// ou s'il avait décoché l'ancien réglage « Indicateur géré par le module ».
export const badgeActif = () => lire("a11yHideModuleIcons", false) !== true && lire("a11yManagedBadge", true) !== false;

// Nom du module tel qu'affiché par Foundry (module.json → title).
const nomModule = () => game.modules?.get?.(MOD)?.title || "Soruta — Completed Westmarch";

function ajouterBadges(app, html) {
    try {
        if (!badgeActif()) return;
        const actor = app?.document ?? app?.actor;
        if (!(actor instanceof Actor)) return;
        const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element);
        if (!root?.querySelectorAll) return;
        for (const item of actor.items) {
            const g = GERES.find(x => x.test(item));
            const gere = g && lire(g.cle, false) === true;
            let modifs = null;
            for (const f of MODIFIES) { try { modifs = f(item); } catch { modifs = null; } if (modifs) break; }
            if (!gere && !modifs) continue;
            // Bulle : chaque changement avec sa SOURCE (la règle qui le justifie).
            const e = (t) => foundry.utils.escapeHTML(String(t ?? ""));
            const bulleHtml = gere
                ? `<strong>${e(tl("Géré par {0}", nomModule()))}</strong><br>${e(g.texte)}`
                : `<strong>${e(tl("Modifié par {0}", nomModule()))}</strong>`
                  + modifs.lignes.map(l => `<br>• <strong>${e(l.source)}</strong> : ${e(l.texte)}`).join("")
                  + (modifs.formule ? `<br><em>${e(tl("Formule de dégâts obtenue : {0}", modifs.formule))}</em>` : "");
            const bulle = gere
                ? `${tl("Géré par {0}", nomModule())} : ${g.texte}`
                : `${tl("Modifié par {0}", nomModule())} : ` + modifs.lignes.map(l => `${l.source} : ${l.texte}`).join(" ; ")
                  + (modifs.formule ? `. ${tl("Formule de dégâts obtenue : {0}", modifs.formule)}` : "");
            root.querySelectorAll(`[data-item-id="${item.id}"]`).forEach(ligne => {
                // Une seule icône par ligne : on ignore les éléments imbriqués
                // qui portent aussi data-item-id (image, contrôles…).
                if (ligne.parentElement?.closest(`[data-item-id="${item.id}"]`)) return;
                if (ligne.querySelector(".scwm-gere")) return;
                const cible = ligne.querySelector(".item-name .title, .item-name h4, .item-name, .name .title, .name, h4, .title") ?? ligne;
                const i = document.createElement("i");
                i.className = "fa-solid fa-gears scwm-gere";
                // v13/v14 : data-tooltip-html = HTML explicite (recommandé par Foundry).
                i.dataset.tooltipHtml = bulleHtml;
                i.dataset.tooltipDirection = "UP";
                i.setAttribute("aria-label", bulle);
                i.style.cssText = "color:#c9a227;font-size:.8em;margin-left:5px;opacity:.85;cursor:help;";
                cible.appendChild(i);
            });
        }
    } catch (e) { /* jamais bloquant pour la fiche */ }
}

export function GereHooks() {
    Hooks.on("renderActorSheetV2", ajouterBadges);
    Hooks.on("renderActorSheet", ajouterBadges);
}

// Rafraîchit les fiches ouvertes (après changement du réglage).
export function rafraichirFiches() {
    try {
        for (const app of foundry.applications.instances?.values?.() ?? []) if (app.document instanceof Actor) app.render();
        for (const app of Object.values(ui.windows ?? {})) if (app.document instanceof Actor || app.actor instanceof Actor) app.render();
    } catch {}
}
