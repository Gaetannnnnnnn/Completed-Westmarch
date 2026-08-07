// ============================================================
// casier.js — « Casier de [GM] » : tableau de bord du meneur
//
// Bouton dans la barre WestMarch (GM uniquement) → ouvre un tableau de
// bord avec, à gauche en mode livret, deux onglets :
//   - « Rapports à finaliser » : les brouillons de rapport de session
//     enregistrés (via « Enregistrer pour plus tard » à la clôture) ;
//     éditables (notes) puis clôturables → envoi sur le salon Discord.
//   - « Sessions en cours »    : les expéditions/sessions ouvertes des PJ.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { getExpeditions, formatDate } from "./carnet.js";
import {
    getSessionDrafts, saveSessionDraft, deleteSessionDraft, sendSessionReport
} from "./session.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Brouillons du GM courant (les rapports sont rangés par gmId).
function myDrafts() {
    return getSessionDrafts().filter(d => d.gmId === game.user.id)
        .sort((a, b) => (b.dateISO ?? "").localeCompare(a.dateISO ?? ""));
}

// Expéditions EN COURS du GM (issues de l'onglet Expédition des fiches),
// regroupées par expédition (nom + date de début). La party actuelle du GM
// sert à marquer "En session" l'expédition qu'il MJ en ce moment.
function gmExpeditions() {
    // Personnages de la party actuellement menée par ce GM.
    const partyCharIds = new Set(
        (game.users ?? [])
            .filter(u => u.getFlag(MOD, "partyId") === game.user.id)
            .map(u => u.character?.id)
            .filter(Boolean)
    );

    const groups = new Map();
    for (const actor of game.actors ?? []) {
        if (actor.type !== "character") continue;
        for (const e of getExpeditions(actor)) {
            if (!e.startDate || e.endDate) continue;
            // Uniquement les expéditions dont CE GM est le MJ (tag gmId).
            if (e.gmId !== game.user.id) continue;
            const key = `${e.name || "Expédition"}|${JSON.stringify(e.startDate)}`;
            if (!groups.has(key)) groups.set(key, { name: e.name || "Expédition sans nom", startDate: e.startDate, participants: [] });
            groups.get(key).participants.push({ id: actor.id, name: actor.name });
        }
    }

    const out = [...groups.values()].map(g => ({
        ...g,
        // "En session" = l'expédition dont des participants sont dans la party
        // actuelle du GM (la session qu'il mène en ce moment).
        current: partyCharIds.size > 0 && g.participants.some(p => partyCharIds.has(p.id))
    }));
    out.sort((a, b) => (Number(b.current) - Number(a.current)) || a.name.localeCompare(b.name));
    return out;
}

// Présentation du dashboard (par GM), persistée dans le réglage casierProfiles.
function getPresentation(gmId) {
    const p = game.settings.get(MOD, "casierProfiles");
    return (p && typeof p === "object" && p[gmId]?.presentation) || "";
}
async function setPresentation(gmId, text) {
    const p = foundry.utils.deepClone(game.settings.get(MOD, "casierProfiles") ?? {});
    p[gmId] = { ...(p[gmId] ?? {}), presentation: text };
    await game.settings.set(MOD, "casierProfiles", p);
}

// Suivi de tous les GM : leurs expéditions EN COURS (taguées gmId), le nom de
// chacune et les joueurs qui y participent.
function gmTracking() {
    // Regroupe les expéditions ouvertes par GM puis par expédition (nom+date).
    const byGm = new Map();
    for (const actor of game.actors ?? []) {
        if (actor.type !== "character") continue;
        for (const e of getExpeditions(actor)) {
            if (!e.startDate || e.endDate || !e.gmId) continue;
            if (!byGm.has(e.gmId)) byGm.set(e.gmId, new Map());
            const groups = byGm.get(e.gmId);
            const key = `${e.name || "Expédition"}|${JSON.stringify(e.startDate)}`;
            if (!groups.has(key)) groups.set(key, { name: e.name || "Expédition sans nom", startDate: e.startDate, participants: [] });
            groups.get(key).participants.push(actor.name);
        }
    }

    return (game.users ?? []).filter(u => u.isGM).map(gm => {
        const exps = byGm.has(gm.id) ? [...byGm.get(gm.id).values()] : [];
        return { name: gm.name, count: exps.length, exps };
    });
}

class CasierApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id:       "scwm-casier",
        classes:  ["scwm-casier"],
        window:   { title: "Casier", icon: "fas fa-box-archive", resizable: true },
        position: { width: 760, height: 560 }
    };

    #tab = "dashboard";
    #selectedId = null;

    get title() { return `Casier de ${game.user.name}`; }

    async _renderHTML() { return this.#buildHTML(); }
    _replaceHTML(result, content) { content.innerHTML = result; this.#wire(content); }

    // ---- Rendu ----
    #buildHTML() {
        const drafts = myDrafts();

        const TABS = [
            { key: "dashboard",   icon: "fa-gauge-high", label: "Dashboard" },
            { key: "reports",     icon: "fa-scroll",     label: `Rapports${drafts.length ? ` (${drafts.length})` : ""}` },
            { key: "expeditions", icon: "fa-route",      label: "Expéditions" },
            { key: "gms",         icon: "fa-users-gear", label: "Suivi des GM" }
        ];
        const tabsHtml = TABS.map(t => `
            <button type="button" class="scwm-casier-tab ${this.#tab === t.key ? "active" : ""}" data-tab="${t.key}">
                <i class="fas ${t.icon}"></i> ${t.label}
            </button>`).join("");

        // Liste du livret (colonne gauche) — seulement pour l'onglet Rapports.
        let sideList = "";
        if (this.#tab === "reports") {
            sideList = drafts.length
                ? drafts.map(d => `
                    <div class="scwm-casier-page ${d.id === this.#selectedId ? "active" : ""}" data-draft-id="${esc(d.id)}">
                        <i class="fas fa-scroll"></i>
                        <span class="scwm-casier-page-title">Rapport — ${esc(d.dateDisplay)}</span>
                    </div>`).join("")
                : `<div class="scwm-casier-empty">Aucun rapport en attente.</div>`;
        }

        let detail;
        if (this.#tab === "dashboard")      detail = this.#dashboardDetail(drafts);
        else if (this.#tab === "reports") {
            const draft = drafts.find(d => d.id === this.#selectedId);
            detail = draft ? this.#draftDetail(draft) : `<div class="scwm-casier-placeholder"><i class="fas fa-book-open"></i><p>Sélectionnez un rapport à finaliser dans le livret.</p></div>`;
        }
        else if (this.#tab === "expeditions") detail = this.#expeditionsDetail();
        else                                  detail = this.#gmsDetail();

        return `
            <div class="scwm-casier-body">
                <aside class="scwm-casier-side">
                    <div class="scwm-casier-tabs">${tabsHtml}</div>
                    <div class="scwm-casier-pages">${sideList}</div>
                </aside>
                <section class="scwm-casier-content">${detail}</section>
            </div>`;
    }

    // ---- Onglet Dashboard ----
    #dashboardDetail(drafts) {
        const exps = gmExpeditions();
        return `
            <div class="scwm-casier-detail scwm-casier-dashboard">
                <h2><i class="fas fa-box-archive"></i> Casier de ${esc(game.user.name)}</h2>
                <p class="scwm-casier-meta">Tableau de bord du meneur</p>

                <div class="scwm-casier-stats">
                    <div class="scwm-casier-stat"><b>${drafts.length}</b><span>Rapport(s) à finaliser</span></div>
                    <div class="scwm-casier-stat"><b>${exps.length}</b><span>Expédition(s) en cours</span></div>
                </div>

                <h3>Présentation</h3>
                <textarea class="scwm-casier-presentation" rows="8"
                    placeholder="Présentez-vous, vos critères, vos horaires… (visible ici, sauvegardé automatiquement)">${esc(getPresentation(game.user.id))}</textarea>
            </div>`;
    }

    // ---- Onglet Expéditions (du GM) ----
    #expeditionsDetail() {
        const exps = gmExpeditions();
        if (!exps.length) return `<div class="scwm-casier-placeholder"><i class="fas fa-route"></i><p>Aucune expédition en cours.</p></div>`;
        return `
            <div class="scwm-casier-detail">
                <h2>Expéditions en cours</h2>
                ${exps.map(x => `
                    <div class="scwm-casier-exp-card ${x.current ? "current" : ""}">
                        <div class="scwm-casier-exp-head">
                            <i class="fas fa-route"></i>
                            <span class="scwm-casier-exp-name">${esc(x.name)}</span>
                            ${x.current ? `<span class="scwm-casier-exp-badge">En session</span>` : ""}
                            <span class="scwm-casier-date">${esc(formatDate(x.startDate))}</span>
                        </div>
                        ${x.participants.length ? `<div class="scwm-casier-exp-parts">${x.participants.map(p => esc(p.name)).join(", ")}</div>` : ""}
                    </div>`).join("")}
            </div>`;
    }

    // ---- Onglet Suivi des GM ----
    #gmsDetail() {
        const gms = gmTracking();
        if (!gms.length) return `<div class="scwm-casier-placeholder"><i class="fas fa-users-gear"></i><p>Aucun GM.</p></div>`;
        return `
            <div class="scwm-casier-detail">
                <h2>Suivi des GM</h2>
                ${gms.map(gm => `
                    <div class="scwm-casier-gm-card ${gm.count ? "active" : ""}">
                        <div class="scwm-casier-gm-head">
                            <i class="fas fa-user-shield"></i>
                            <span class="scwm-casier-gm-name">${esc(gm.name)}</span>
                            <span class="scwm-casier-gm-badge">${gm.count} expédition${gm.count > 1 ? "s" : ""}</span>
                        </div>
                        ${gm.exps.length
                            ? `<ul class="scwm-casier-gm-exps">${gm.exps.map(e => `
                                <li>
                                    <strong>${esc(e.name)}</strong>
                                    <span class="scwm-casier-date">(${esc(formatDate(e.startDate))})</span>
                                    <div class="scwm-casier-gm-parts">${e.participants.length ? e.participants.map(esc).join(", ") : "Aucun joueur"}</div>
                                </li>`).join("")}</ul>`
                            : `<div class="scwm-casier-gm-line" style="opacity:.6;">Aucune expédition en cours.</div>`}
                    </div>`).join("")}
            </div>`;
    }

    #draftDetail(d) {
        const players = (d.players ?? []).map(p => {
            let l = `<strong>${esc(p.name)}</strong> — XP ${p.xpBefore} → ${p.xpAfter}`;
            if (p.xpGained > 0) l += ` (+${p.xpGained})`;
            if (p.levelUp)      l += ` ⬆ <em>Niveau ${p.levelAfter}</em>`;
            return `<li>${l}</li>`;
        }).join("") || "<li>—</li>";

        const enemies = (d.combatants ?? []).map(e => `<li>${esc(e.name)}${e.cr != null ? ` — CR ${esc(e.cr)}` : ""}</li>`).join("");
        const npcs    = (d.npcs ?? []).map(n => `<li>${esc(n.name)}</li>`).join("");
        const items   = (d.items ?? []).map(i => `<li><strong>${esc(i.playerName)}</strong> — ${esc(i.itemName)}</li>`).join("");

        return `
            <div class="scwm-casier-detail" data-draft-id="${esc(d.id)}">
                <h2>Rapport de session — ${esc(d.dateDisplay)}</h2>
                <p class="scwm-casier-meta">Meneur : ${esc(d.gmName)}</p>

                <h3>Joueurs</h3>
                <ul class="scwm-casier-players">${players}</ul>

                ${enemies ? `<h3>Ennemis rencontrés</h3><ul>${enemies}</ul>` : ""}
                ${npcs    ? `<h3>PNJ rencontrés</h3><ul>${npcs}</ul>` : ""}
                ${items   ? `<h3>Objets récupérés</h3><ul>${items}</ul>` : ""}

                <h3>Notes de session</h3>
                <textarea class="scwm-casier-notes" rows="7" placeholder="Rédigez ou complétez le compte-rendu…">${esc(d.notes ?? "")}</textarea>

                <div class="scwm-casier-actions">
                    <button type="button" class="scwm-casier-send"><i class="fas fa-paper-plane"></i> Clôturer &amp; envoyer sur Discord</button>
                    <button type="button" class="scwm-casier-delete"><i class="fas fa-trash"></i> Supprimer</button>
                </div>
            </div>`;
    }

    // ---- Écouteurs ----
    #wire(root) {
        root.querySelectorAll(".scwm-casier-tab").forEach(btn =>
            btn.addEventListener("click", () => {
                this.#tab = btn.dataset.tab;
                this.render();
            }));

        root.querySelectorAll(".scwm-casier-page[data-draft-id]").forEach(pg =>
            pg.addEventListener("click", () => {
                this.#selectedId = pg.dataset.draftId;
                this.render();
            }));

        // Présentation du dashboard : sauvegarde à la perte de focus.
        const pres = root.querySelector(".scwm-casier-presentation");
        if (pres) pres.addEventListener("change", () => setPresentation(game.user.id, pres.value));

        // Sauvegarde des notes à la volée (perte de focus).
        const notes = root.querySelector(".scwm-casier-notes");
        if (notes) {
            notes.addEventListener("change", async () => {
                const d = myDrafts().find(x => x.id === this.#selectedId);
                if (!d) return;
                d.notes = notes.value;
                await saveSessionDraft(d);
            });
        }

        root.querySelector(".scwm-casier-send")?.addEventListener("click", async () => {
            const d = myDrafts().find(x => x.id === this.#selectedId);
            if (!d) return;
            if (notes) d.notes = notes.value;
            const ok = await sendSessionReport(d);
            if (!ok) return;   // avertissement déjà émis (webhook manquant / échec)
            await deleteSessionDraft(d.id);
            this.#selectedId = null;
            ui.notifications.info("Rapport de session envoyé sur Discord.");
            refreshCasierBadge();
            this.render();
        });

        root.querySelector(".scwm-casier-delete")?.addEventListener("click", async () => {
            const d = myDrafts().find(x => x.id === this.#selectedId);
            if (!d) return;
            const ok = await foundry.applications.api.DialogV2.confirm({
                window:  { title: "Supprimer le rapport" },
                content: `<p>Supprimer définitivement le brouillon <strong>Rapport — ${esc(d.dateDisplay)}</strong> ?</p>`
            });
            if (!ok) return;
            await deleteSessionDraft(d.id);
            this.#selectedId = null;
            refreshCasierBadge();
            this.render();
        });
    }
}

let _casierApp = null;
export function openCasier() {
    if (!_casierApp) _casierApp = new CasierApp();
    _casierApp.render(true);
}

// Force un rafraîchissement du badge de notif sur le bouton Casier.
export function refreshCasierBadge() {
    try { ui.controls?.render?.(); } catch (e) {}
}

export function CasierHooks() {
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM) return;
        if (!controls.westmarch) {
            controls.westmarch = { name: "westmarch", title: "WestMarch", icon: "fa-solid fa-hammer", layer: "tokens", tools: {} };
        }
        controls.westmarch.tools.casier = {
            name:     "casier",
            title:    `Casier de ${game.user.name}`,
            icon:     "fa-solid fa-box-archive",
            button:   true,
            onChange: () => openCasier(),
            visible:  true
        };
    });

    // Pastille de notification sur le bouton Casier si des rapports sont en
    // attente (par GM — aucun suivi inter-GM des rapports).
    Hooks.on("renderSceneControls", (app, html) => {
        if (!game.user.isGM) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        const btn = root?.querySelector('[data-tool="casier"]');
        if (btn) btn.classList.toggle("scwm-has-drafts", myDrafts().length > 0);
    });

    Hooks.once("ready", () => {
        if (!game.user.isGM) return;

        // Ouvre le Casier via le bouton du message d'alerte (délégation globale).
        document.body.addEventListener("click", (e) => {
            if (e.target?.closest?.(".scwm-casier-open")) openCasier();
        });

        // Message chuchoté à soi-même (self-roll) rappelant les rapports en attente.
        setTimeout(() => {
            const n = myDrafts().length;
            if (n <= 0) return;
            ChatMessage.create({
                speaker: { alias: "Casier" },
                whisper: [game.user.id],
                content: `<div class="scwm-casier-alert">
                    <p><i class="fas fa-box-archive"></i> Vous avez <strong>${n}</strong> rapport(s) de session en attente de finalisation.</p>
                    <button type="button" class="scwm-casier-open"><i class="fas fa-up-right-from-square"></i> Ouvrir le Casier</button>
                </div>`
            });
        }, 1500);
    });
}
