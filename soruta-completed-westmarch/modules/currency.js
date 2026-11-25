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

// ---- Répartition des pièces dans les contenants (poids du sac sans fond) ----
// Les pièces RESTENT sur la bourse (system.currency) : rien n'est déplacé.
// Le joueur note seulement, via une petite fenêtre, combien de pièces il range
// dans chaque contenant. Seules celles mises dans un contenant « au contenu
// sans poids » (sac sans fond) sont retirées de l'encombrement ; ailleurs,
// elles pèsent normalement.
const bagCoinsActif = () => { try { return game.settings.get(MOD, "enableBagOfHoldingCoins") === true; } catch { return false; } };
const DENOMS = ["pp", "gp", "ep", "sp", "cp"];
const DENOM_LABEL = { pp: "PP", gp: "PO", ep: "PE", sp: "PA", cp: "PC" };

const estSansPoids = (item) => {
    const p = item?.system?.properties;
    return !!(p?.has?.("weightlessContents") || (Array.isArray(p) && p.includes("weightlessContents")));
};
// Un contenant « liquide » (gourde, flasque, cruche…) a une capacité en VOLUME
// et aucune capacité en objets/poids : on n'y range pas de pièces → exclu.
const peutContenirPieces = (c) => {
    const cap = c?.system?.capacity ?? {};
    const vol = Number(cap.volume?.value) || 0;
    const cnt = Number(cap.count) || 0;
    const wt  = Number(cap.weight?.value) || 0;
    return !(vol > 0 && cnt <= 0 && wt <= 0);
};
const contenants = (actor) => (actor?.items ?? []).filter(i => i.type === "container" && peutContenirPieces(i));
const aContenant = (actor) => { try { return contenants(actor).length > 0; } catch { return false; } };
const denomsAutorisees = () => {
    let ep = true; try { ep = !game.settings.get(MOD, "disableElectrum"); } catch { /* */ }
    return DENOMS.filter(d => d !== "ep" || ep);
};
const repartition = (actor) => { try { return actor?.getFlag?.(MOD, "repartitionMonnaie") ?? {}; } catch { return {}; } };

// Poids des pièces à retirer = pièces rangées dans les contenants SANS POIDS.
export function poidsMonnaieSac(actor) {
    if (!bagCoinsActif() || actor?.type !== "character") return 0;
    try { if (!game.settings.get("dnd5e", "currencyWeight")) return 0; } catch { return 0; }
    const rep = repartition(actor);
    const purse = actor.system?.currency ?? {};
    const sansPoidsIds = new Set(contenants(actor).filter(estSansPoids).map(c => c.id));
    let n = 0;
    for (const d of DENOMS) {
        let alloue = 0;
        for (const [cid, v] of Object.entries(rep)) if (sansPoidsIds.has(cid)) alloue += Math.max(0, Number(v?.[d]) || 0);
        n += Math.min(alloue, Math.max(0, Number(purse[d]) || 0));
    }
    let metric = false; try { metric = !!game.settings.get("dnd5e", "metricWeightUnits"); } catch { /* */ }
    const perW = CONFIG.DND5E?.encumbrance?.currencyPerWeight?.[metric ? "metric" : "imperial"] ?? 50;
    return perW ? n / perW : 0;
}

// Petite fenêtre de répartition des pièces.
async function ouvrirRepartition(actor) {
    const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
    const nf = (n) => Math.max(0, Math.floor(Number(n) || 0));
    const purse = actor.system?.currency ?? {};
    const rep = repartition(actor);
    const conts = contenants(actor);
    const denoms = denomsAutorisees();
    const uid = "scwm-rep-" + foundry.utils.randomID();

    const thead = `<tr><th class="scwm-rep-h-nom">${esc(tl("Contenant"))}</th>${denoms.map(d => `<th class="scwm-rep-den ${d}">${DENOM_LABEL[d]}</th>`).join("")}</tr>`;
    const lignes = conts.map(c => {
        const v = rep[c.id] ?? {};
        const img = esc(c.img || "icons/svg/item-bag.svg");
        const badge = estSansPoids(c) ? `<span class="scwm-rep-sp" data-tooltip="${esc(tl("Contenu sans poids : les pièces ici ne pèsent pas."))}">${esc(tl("sans poids"))}</span>` : "";
        return `<tr data-cid="${c.id}">
            <td class="scwm-rep-nom"><div class="scwm-rep-nomwrap"><img class="scwm-rep-img" src="${img}" alt=""><div class="scwm-rep-nomtxt"><b>${esc(c.name)}</b>${badge}</div></div></td>
            ${denoms.map(d => `<td><input class="scwm-rep-coin" type="number" min="0" step="1" data-d="${d}" value="${nf(v[d])}"></td>`).join("")}
        </tr>`;
    }).join("");
    const videRow = `<tr><td colspan="${denoms.length + 1}" style="opacity:.7;padding:10px;text-align:center;">${esc(tl("Aucun contenant sur la fiche."))}</td></tr>`;
    const footRow = (cls, label, attr) => `<tr class="${cls}"><td class="scwm-rep-flabel">${esc(label)}</td>${denoms.map(d =>
        `<td${attr ? ` class="${attr === "reste" ? "scwm-rep-reste" : ""}" data-${attr}="${d}"` : ""}>${attr ? (attr === "tot" ? "0" : "—") : nf(purse[d])}</td>`).join("")}</tr>`;

    const content = `<div id="${uid}" class="scwm-rep">
        <p class="scwm-rep-intro">${esc(tl("Les pièces restent sur ta bourse — tu notes seulement où tu les ranges. Seul un sac sans fond retire leur poids de l'encombrement."))}</p>
        <div class="scwm-rep-scroll">
            <table>
                <thead>${thead}</thead>
                <tbody>${lignes || videRow}</tbody>
                <tfoot>
                    ${footRow("scwm-rep-bourse", tl("Bourse (total)"), "")}
                    ${footRow("", tl("Rangé (total)"), "tot")}
                    ${footRow("", tl("Reste sur la bourse"), "reste")}
                </tfoot>
            </table>
        </div>
        <p class="scwm-rep-err" data-err></p>
    </div>`;

    const recalc = () => {
        const root = document.getElementById(uid); if (!root) return true;
        let ok = true;
        for (const d of denoms) {
            let somme = 0;
            root.querySelectorAll(`input[data-d="${d}"]`).forEach(i => { somme += nf(i.value); });
            const reste = nf(purse[d]) - somme;
            const tot = root.querySelector(`[data-tot="${d}"]`); if (tot) tot.textContent = somme;
            const cell = root.querySelector(`[data-reste="${d}"]`);
            if (cell) { cell.textContent = reste; cell.style.color = reste < 0 ? "#e06c5a" : ""; }
            if (reste < 0) ok = false;
        }
        const err = root.querySelector("[data-err]");
        if (err) err.textContent = ok ? "" : tl("Tu ranges plus de pièces que tu n'en as (valeurs en rouge).");
        return ok;
    };

    await foundry.applications.api.DialogV2.wait({
        window: { title: tl("Répartition des pièces — {0}", actor.name), icon: "fa-solid fa-sack-dollar" },
        position: { width: 460 },
        rejectClose: false,
        content,
        render: () => {
            const root = document.getElementById(uid); if (!root) return;
            root.querySelectorAll("input[data-d]").forEach(i => i.addEventListener("input", recalc));
            recalc();
        },
        buttons: [
            {
                action: "save", default: true, label: tl("Enregistrer"), icon: '<i class="fa-solid fa-save"></i>',
                callback: async () => {
                    const root = document.getElementById(uid); if (!root) return;
                    const nouvelle = {};
                    root.querySelectorAll("tr[data-cid]").forEach(tr => {
                        const o = {};
                        tr.querySelectorAll("input[data-d]").forEach(i => { const n = nf(i.value); if (n > 0) o[i.dataset.d] = n; });
                        if (Object.keys(o).length) nouvelle[tr.dataset.cid] = o;
                    });
                    for (const d of DENOMS) {           // jamais plus que la bourse
                        const max = nf(purse[d]); let somme = 0;
                        for (const o of Object.values(nouvelle)) somme += Number(o[d]) || 0;
                        if (somme > max && somme > 0) { const r = max / somme; for (const o of Object.values(nouvelle)) if (o[d]) o[d] = Math.floor(o[d] * r); }
                    }
                    try { await actor.setFlag(MOD, "repartitionMonnaie", nouvelle); } catch (e) { /* */ }
                }
            },
            { action: "cancel", label: tl("Annuler") }
        ]
    });
}

// Icône cliquable à côté de la bourse → ouvre la fenêtre de répartition.
function injecterIconeSac(app, html) {
    try {
        if (!bagCoinsActif()) return;
        const actor = app?.document ?? app?.actor;
        if (!(actor instanceof Actor) || actor.type !== "character") return;
        if (!aContenant(actor)) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        const sec = root?.querySelector?.(".currency");
        if (!sec || sec.querySelector(".scwm-rep-open")) return;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "scwm-rep-open";
        b.dataset.tooltip = tl("Répartir mes pièces dans mes contenants — le sac sans fond retire leur poids de l'encombrement.");
        b.innerHTML = `<i class="fa-solid fa-sack-dollar"></i>`;
        b.addEventListener("click", (ev) => { ev.preventDefault(); ouvrirRepartition(actor); });
        sec.appendChild(b);
    } catch { /* jamais bloquant */ }
}

export function CurrencyHooks() {
    Hooks.on("renderActorSheet", injecterIconeSac);
    Hooks.on("renderActorSheetV2", injecterIconeSac);


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
