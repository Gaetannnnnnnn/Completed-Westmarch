import { MOD } from "./const.js";
import { tl } from "./i18n.js";
// ============================================================
// currency.js — Règles de monnaie (bourse)
// ------------------------------------------------------------
//  • Retirer l'électrum (EP) : masque le slot EP sur les fiches ET les
//    contenants, et force toute valeur d'EP à 0 (blocage des ajouts).
//  • Pièces dans les contenants : empêche de stocker des pièces dans un
//    contenant (sac, poche…) — selon le réglage, pour les joueurs seulement
//    ou pour tout le monde. Objectif : que la richesse soit TOUJOURS sur la
//    bourse de la fiche, là où les autres modules (ex. Temps morts) la lisent.
// ============================================================

// CSS de masquage du slot Électrum (fiche PJ + fiche de contenant). Sélecteurs
// volontairement redondants (attribut + :has + classes) pour couvrir toutes
// les variantes de gabarit dnd5e sans dépendre d'une structure précise.
const EP_HIDE_CSS = `
[name="system.currency.ep"] { display: none !important; }
label:has(> [name="system.currency.ep"]),
li:has([name="system.currency.ep"]),
.form-group:has([name="system.currency.ep"]),
.denomination.ep,
.currency .ep,
.currency-item.ep { display: none !important; }
`;

function applyElectrumCss() {
    try {
        let st = document.getElementById("scwm-currency-style");
        const on = game.settings.get(MOD, "disableElectrum");
        if (!on) { if (st) st.textContent = ""; return; }
        if (!st) { st = document.createElement("style"); st.id = "scwm-currency-style"; document.head.appendChild(st); }
        st.textContent = EP_HIDE_CSS;
    } catch (e) { /* best-effort */ }
}

export function CurrencyHooks() {

    // Masquage visuel de l'électrum (ré-appliqué à chaque rendu de fiche pour
    // réagir à un changement de réglage sans recharger entièrement).
    Hooks.once("ready", applyElectrumCss);
    Hooks.on("renderActorSheet", applyElectrumCss);
    Hooks.on("renderActorSheetV2", applyElectrumCss);
    Hooks.on("renderItemSheet", applyElectrumCss);
    Hooks.on("renderItemSheetV2", applyElectrumCss);

    // ---- Électrum : forcer EP à 0 sur les fiches (acteurs) ----
    Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
        if (!game.settings.get(MOD, "disableElectrum")) return;
        const ep = changes.system?.currency?.ep;
        if (ep !== undefined && Number(ep) !== 0) {
            changes.system.currency.ep = 0;
        }
    });

    // ---- Électrum (dans un contenant) + blocage des pièces en contenant ----
    Hooks.on("preUpdateItem", (item, changes, options, userId) => {
        const curChange = changes.system?.currency;
        if (!curChange) return;

        // Électrum forcé à 0, partout.
        if (game.settings.get(MOD, "disableElectrum") && curChange.ep !== undefined && Number(curChange.ep) !== 0) {
            curChange.ep = 0;
        }

        // Blocage des pièces dans un contenant.
        if (item.type !== "container") return;
        const mode = game.settings.get(MOD, "currencyContainerBlock");   // off | players | all
        if (mode === "off") return;
        const blockForMe = mode === "all" || (mode === "players" && !game.user.isGM);
        if (!blockForMe) return;

        // On ne bloque que les AUGMENTATIONS (ajout de pièces) ; retirer des
        // pièces d'un contenant vers la fiche reste permis.
        const before = item.system?.currency ?? {};
        let increased = false;
        for (const [denom, v] of Object.entries(curChange)) {
            if (Number(v || 0) > Number(before[denom] || 0)) { increased = true; break; }
        }
        if (increased) {
            delete changes.system.currency;   // on annule la modif de pièces (le reste passe)
            ui.notifications?.warn(tl("Les pièces doivent être rangées sur la fiche du personnage, pas dans un contenant (sac, poche…)."));
        }
    });

    // Un contenant créé/importé DÉJÀ rempli de pièces (côté rôle bloqué) : on
    // retire les pièces à la création.
    Hooks.on("preCreateItem", (item, data, options, userId) => {
        if (item.type !== "container") return;
        const mode = game.settings.get(MOD, "currencyContainerBlock");
        if (mode === "off") return;
        const blockForMe = mode === "all" || (mode === "players" && !game.user.isGM);
        if (!blockForMe) return;
        const cur = data?.system?.currency;
        if (cur && Object.values(cur).some(v => Number(v || 0) > 0)) {
            item.updateSource({ "system.currency": { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 } });
        }
    });
}
