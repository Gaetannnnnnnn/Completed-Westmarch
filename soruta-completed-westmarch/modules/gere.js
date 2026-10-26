import { MOD } from "./const.js";
// ============================================================
// gere.js — Indicateur « géré par le module » sur les fiches
//
// Sur la fiche d'un personnage, une petite icône d'engrenages dorée
// apparaît à côté des aptitudes / dons dont le module automatise une règle
// (Healer, Alert, Large Form, Giant's Havoc, Form of the Beast). Au survol :
// ce que fait le module. Seulement si la modification correspondante est
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
      texte: "Géré par le module : les dés de soins de vos sorts (et du Battle Medic) relancent automatiquement les 1." },
    { test: (i) => i.type === "feat" && (ident(i) === "alert" || /^(alert|vigilant)$/i.test(nom(i))), cle: "enableAlertSwap",
      texte: "Géré par le module : après l'initiative, le MJ peut échanger la vôtre avec celle d'un autre joueur (bouton dans le suivi de combat)." },
    { test: (i) => /large form/i.test(nom(i)), cle: "enableLargeForm",
      texte: "Géré par le module : utiliser cette aptitude fait passer votre jeton en taille Large, et inversement." },
    { test: (i) => /giant.?s havoc/i.test(nom(i)), cle: "enableRageSize",
      texte: "Géré par le module : pendant la Rage, votre jeton passe en taille Large." },
    { test: (i) => i.type === "feat" && ident(i) === "form-of-the-beast", cle: "enableFormOfTheBeast",
      texte: "Géré par le module : les armes naturelles (Morsure, Griffes, Queue) sont créées automatiquement." }
];

export const badgeActif = () => lire("a11yManagedBadge", true) !== false;

function ajouterBadges(app, html) {
    try {
        if (!badgeActif()) return;
        const actor = app?.document ?? app?.actor;
        if (!(actor instanceof Actor)) return;
        const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element);
        if (!root?.querySelectorAll) return;
        for (const item of actor.items) {
            const g = GERES.find(x => x.test(item));
            if (!g || lire(g.cle, false) !== true) continue;
            root.querySelectorAll(`[data-item-id="${item.id}"]`).forEach(ligne => {
                if (ligne.querySelector(".scwm-gere")) return;
                const cible = ligne.querySelector(".item-name .title, .item-name h4, .item-name, .name .title, .name, h4, .title") ?? ligne;
                const i = document.createElement("i");
                i.className = "fa-solid fa-gears scwm-gere";
                i.dataset.tooltip = g.texte;
                i.setAttribute("aria-label", g.texte);
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
