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
    getSessionDrafts, saveSessionDraft, deleteSessionDraft, sendSessionReport, getSessionLog, expeditionSessionCount
} from "./session.js";
import {
    getCreationRequests, approveCreation, rejectCreation,
    getPendingActors, validateActor, returnActor,
    getLevelUpRequests, grantLevelUp
} from "./charvalidation.js";
import { downtimeContentHtml, wireDowntime, applyDowntimeFromRoot } from "./tm.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Brouillons du GM courant (les rapports sont rangés par gmId).
function draftsFor(gmId) {
    return getSessionDrafts().filter(d => d.gmId === gmId)
        .sort((a, b) => (b.dateISO ?? "").localeCompare(a.dateISO ?? ""));
}
function myDrafts() { return draftsFor(game.user.id); }

// Expéditions EN COURS du GM (issues de l'onglet Expédition des fiches),
// regroupées par expédition (nom + date de début). La party actuelle du GM
// sert à marquer "En session" l'expédition qu'il MJ en ce moment.
function gmExpeditions(gmId = game.user.id) {
    // Personnages de la party actuellement menée par ce GM.
    const partyCharIds = new Set(
        (game.users ?? [])
            .filter(u => u.getFlag(MOD, "partyId") === gmId)
            .map(u => u.character?.id)
            .filter(Boolean)
    );

    const groups = new Map();
    for (const actor of game.actors ?? []) {
        if (actor.type !== "character") continue;
        for (const e of getExpeditions(actor)) {
            if (!e.startDate || e.endDate) continue;
            // Uniquement les expéditions dont CE GM est le MJ (tag gmId).
            if (e.gmId !== gmId) continue;
            const key = `${e.name || "Expédition"}|${JSON.stringify(e.startDate)}`;
            if (!groups.has(key)) groups.set(key, { name: e.name || "Expédition sans nom", startDate: e.startDate, gmId: e.gmId, startReal: e.startReal ?? null, endReal: null, participants: [] });
            groups.get(key).participants.push({ id: actor.id, name: actor.name });
        }
    }

    const out = [...groups.values()].map(g => ({
        ...g,
        sessions: expeditionSessionCount(g),
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

// Valeur numérique comparable d'une date d'expédition (objet calendrier ou nombre).
function dateVal(d) {
    if (d == null) return 0;
    if (typeof d === "number") return d;
    if (typeof d === "object") return (d.year ?? 0) * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0);
    return 0;
}

// Nom du joueur derrière un PJ (createdFor → propriétaire non-MJ → nom du PJ).
function playerOf(actor) {
    const uid = actor.getFlag(MOD, "createdFor");
    const u = uid ? game.users.get(uid) : null;
    if (u) return u.name;
    const owner = game.users.find(x => !x.isGM && actor.testUserPermission?.(x, "OWNER"));
    return owner?.name ?? actor.name;
}

// ============================================================
// Registre des PJ (vue type tableur — inspirée de l'Excel « PJ Ashara »)
// Colonnes déduites automatiquement des fiches Foundry.
// ============================================================

// Classes du perso : [{ name, sub, lvl }] triées par niveau décroissant.
function charClassList(actor) {
    const classItems = actor.items.filter(i => i.type === "class");
    const subItems   = actor.items.filter(i => i.type === "subclass");
    const findSub = (ci) => {
        const ident = ci.system?.identifier;
        let s = ident ? subItems.find(x => x.system?.classIdentifier === ident) : null;
        if (!s && classItems.length === 1 && subItems.length === 1) s = subItems[0];
        return s?.name ?? "";
    };
    return classItems
        .map(ci => ({ name: ci.name, sub: findSub(ci), lvl: ci.system?.levels ?? 0 }))
        .sort((a, b) => (b.lvl || 0) - (a.lvl || 0));
}

// Espèce / race : item « race » en priorité, sinon le champ details.race.
function charRace(actor) {
    const r = actor.items.find(i => i.type === "race");
    if (r) return r.name;
    const d = actor.system?.details?.race;
    if (typeof d === "string" && d.trim()) return d.trim();
    if (d?.name) return d.name;
    return "—";
}

// Une ligne par PJ de joueur (exclut les PNJ et les fiches sans propriétaire joueur).
function rosterRows() {
    const rows = [];
    for (const a of game.actors ?? []) {
        if (a.type !== "character" || !a.hasPlayerOwner) continue;
        const classes = charClassList(a);
        const total = a.system?.details?.level ?? classes.reduce((s, c) => s + (c.lvl || 0), 0);
        rows.push({
            id: a.id, joueur: playerOf(a), perso: a.name,
            classes, multi: classes.length > 1, race: charRace(a), total
        });
    }
    return rows;
}

// Libellé « Fighter (Eldritch Knight) 3 / Wizard (Evocation) 2 ».
function classesLabel(classes) {
    return classes.length
        ? classes.map(c => `${c.name}${c.sub ? ` (${c.sub})` : ""} ${c.lvl}`).join(" / ")
        : "—";
}

// Comptages type « Statistiques » du tableur.
function rosterStats(rows) {
    const byClass = {}, bySub = {}, byRace = {}, byPlayer = {}, byLevel = {};
    let multiCount = 0;
    for (const r of rows) {
        if (r.multi) multiCount++;
        byPlayer[r.joueur] = (byPlayer[r.joueur] || 0) + 1;
        byLevel[r.total]   = (byLevel[r.total] || 0) + 1;
        byRace[r.race]     = (byRace[r.race] || 0) + 1;
        for (const c of r.classes) {
            byClass[c.name] = (byClass[c.name] || 0) + 1;
            if (c.sub) bySub[`${c.name} — ${c.sub}`] = (bySub[`${c.name} — ${c.sub}`] || 0) + 1;
        }
    }
    return { byClass, bySub, byRace, byPlayer, byLevel, multiCount,
             nbPerso: rows.length, nbJoueurs: Object.keys(byPlayer).length };
}

// Vue « Disponibilités » : un joueur → ses PJ + nb d'expéditions en cours.
function disposRows() {
    const byPlayer = new Map();
    for (const a of game.actors ?? []) {
        if (a.type !== "character" || !a.hasPlayerOwner) continue;
        const p = playerOf(a);
        if (!byPlayer.has(p)) byPlayer.set(p, { joueur: p, pjs: [], open: new Set() });
        const g = byPlayer.get(p);
        g.pjs.push(a.name);
        for (const e of getExpeditions(a)) {
            if (e.startDate && !e.endDate) g.open.add(`${e.name}|${JSON.stringify(e.startDate)}|${e.gmId || ""}`);
        }
    }
    return [...byPlayer.values()]
        .map(x => ({ joueur: x.joueur, pjs: x.pjs, nb: x.pjs.length, open: x.open.size }))
        .sort((a, b) => a.joueur.localeCompare(b.joueur, "fr", { sensitivity: "base" }));
}

// Activité des joueurs (réutilise la logique d'assiduité : trimestre = 90 j).
const ACTIVE_DAYS = 90;
function playerLastSessionMap() {
    const m = new Map();   // nom joueur -> ISO de la dernière session
    for (const s of getSessionLog()) {
        for (const p of (s.players ?? [])) {
            const a = game.actors.get(p.actorId);
            const name = a ? playerOf(a) : (p.name ?? "?");
            const cur = m.get(name);
            if (s.dateISO && (!cur || s.dateISO > cur)) m.set(name, s.dateISO);
        }
    }
    return m;
}
const isPlayerActive = (iso) => !!iso && (Date.now() - new Date(iso).getTime()) <= ACTIVE_DAYS * 86400000;

// ============================================================
// Poids du monde (données + médias) — tous types de documents.
// ============================================================
const fmtBytes = (b) => b >= 1048576 ? (b / 1048576).toFixed(2) + " Mo" : (b / 1024).toFixed(1) + " Ko";

async function measureWorld() {
    const size = (o) => new Blob([JSON.stringify(o ?? {})]).size;
    const cache = new Map(); let echecs = 0;

    // File d'attente à concurrence limitée : lancer TOUTES les requêtes HEAD en
    // même temps sature le serveur, qui en laisse tomber quelques-unes au hasard
    // → mesures incomplètes et classement instable d'un run à l'autre. On limite
    // donc le nombre de requêtes simultanées pour des résultats fiables/stables.
    const pLimit = (n) => {
        let active = 0; const queue = [];
        const pump = () => {
            if (active >= n || !queue.length) return;
            active++;
            const { fn, res } = queue.shift();
            Promise.resolve().then(fn).then(res, res).finally(() => { active--; pump(); });
        };
        return (fn) => new Promise((res) => { queue.push({ fn, res }); pump(); });
    };
    const limit = pLimit(6);

    // Une mesure HEAD avec délai d'expiration + un nouvel essai (les erreurs
    // réseau ponctuelles ne faussent plus le total).
    const headSize = async (src) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
            const r = await fetch(src, { method: "HEAD", signal: ctrl.signal });
            return Number(r.headers.get("content-length")) || 0;
        } finally { clearTimeout(t); }
    };
    const measure = async (src) => {
        try { return await headSize(src); }
        catch { try { return await headSize(src); }   // second essai
                catch { echecs++; return 0; } }
    };

    const fileSize = (src) => {
        if (typeof src !== "string" || !src || src.startsWith("data:")) return Promise.resolve(0);
        if (!cache.has(src)) cache.set(src, limit(() => measure(src)));
        return cache.get(src);
    };

    const items = [];
    const addDoc = async (type, doc, srcs) => {
        let data = 0;
        try { data = size(doc.toObject()); } catch (e) {}
        const uniq = [...new Set((srcs ?? []).filter(s => typeof s === "string" && s && !s.startsWith("data:")))];
        const media = (await Promise.all(uniq.map(fileSize))).reduce((a, b) => a + b, 0);
        items.push({ type, nom: doc.name ?? "(sans nom)", dossier: doc.folder?.name ?? "", data, media });
    };
    const imgsFromHtml = (html) => {
        const out = [];
        if (typeof html !== "string") return out;
        for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) out.push(m[1]);
        return out;
    };

    const jobs = [];
    for (const s of (game.scenes ?? []))
        jobs.push(addDoc("Scène", s, [s.background?.src, ...(s.tiles ?? []).map(t => t.texture?.src)]));
    for (const a of (game.actors ?? []))
        jobs.push(addDoc("Acteur", a, [a.img, a.prototypeToken?.texture?.src, ...(a.items?.map(i => i.img) ?? [])]));
    for (const it of (game.items ?? []))
        jobs.push(addDoc("Objet", it, [it.img]));
    for (const j of (game.journal ?? [])) {
        const srcs = [];
        for (const p of (j.pages ?? [])) { if (p.src) srcs.push(p.src); srcs.push(...imgsFromHtml(p.text?.content)); }
        jobs.push(addDoc("Journal", j, srcs));
    }
    for (const t of (game.tables ?? []))
        jobs.push(addDoc("Table", t, [t.img, ...[...(t.results ?? [])].map(r => r.img)]));
    for (const c of (game.cards ?? [])) {
        const srcs = [c.img];
        for (const cd of (c.cards ?? [])) for (const f of (cd.faces ?? [])) srcs.push(f.img);
        jobs.push(addDoc("Cartes", c, srcs));
    }
    for (const pl of (game.playlists ?? [])) {
        const srcs = [];
        for (const snd of (pl.sounds ?? [])) srcs.push(snd.path);
        jobs.push(addDoc("Playlist", pl, srcs));   // médias = fichiers audio (souvent les plus lourds)
    }
    for (const m of (game.macros ?? []))
        jobs.push(addDoc("Macro", m, [m.img]));

    await Promise.all(jobs);

    const byType = new Map();
    for (const it of items) {
        if (!byType.has(it.type)) byType.set(it.type, { type: it.type, count: 0, data: 0, media: 0 });
        const g = byType.get(it.type); g.count++; g.data += it.data; g.media += it.media;
    }
    const summary = [...byType.values()].sort((a, b) =>
        (b.data + b.media) - (a.data + a.media) || a.type.localeCompare(b.type, "fr"));
    items.sort((a, b) =>
        (b.data + b.media) - (a.data + a.media)
        || (a.type.localeCompare(b.type, "fr"))
        || (a.nom.localeCompare(b.nom, "fr")));
    return { summary, items, echecs };
}

function worldSizeTablesHtml(res) {
    const f = fmtBytes;
    const CAP = 250;
    const shown = res.items.slice(0, CAP);
    const grandData  = res.summary.reduce((s, t) => s + t.data, 0);
    const grandMedia = res.summary.reduce((s, t) => s + t.media, 0);

    const sumRows = res.summary.map(t => `
        <tr>
            <td>${esc(t.type)}</td>
            <td style="text-align:center;">${t.count}</td>
            <td style="text-align:right;">${f(t.data)}</td>
            <td style="text-align:right;">${f(t.media)}</td>
            <td style="text-align:right;font-weight:700;">${f(t.data + t.media)}</td>
        </tr>`).join("");
    const itemRows = shown.map(m => `
        <tr>
            <td>${esc(m.type)}</td>
            <td>${esc(m.nom)}</td>
            <td>${esc(m.dossier)}</td>
            <td style="text-align:right;">${f(m.data)}</td>
            <td style="text-align:right;">${f(m.media)}</td>
            <td style="text-align:right;font-weight:700;">${f(m.data + m.media)}</td>
        </tr>`).join("");
    const warn = res.echecs
        ? `<p style="margin:6px 0 0;color:#e0a13a;font-size:12px;"><i class="fa-solid fa-triangle-exclamation"></i> ${res.echecs} média(s) non mesuré(s) (URL externe ou fichier manquant).</p>`
        : "";
    const capNote = res.items.length > CAP
        ? `<p style="margin:4px 0 0;font-size:12px;opacity:.7;">Affichage limité aux ${CAP} éléments les plus lourds (sur ${res.items.length}).</p>`
        : "";

    return `
        <h3 style="margin:10px 0 4px;">Résumé par type</h3>
        <div class="scwm-scenesize-scroll" style="max-height:30vh;overflow:auto;">
            <table class="scwm-reg-table">
                <thead><tr><th>Type</th><th>Nb</th><th>Données</th><th>Médias</th><th>Total</th></tr></thead>
                <tbody>${sumRows || `<tr><td colspan="5" style="opacity:.6;">Rien à mesurer.</td></tr>`}</tbody>
                <tfoot><tr style="border-top:2px solid rgba(201,162,39,0.4);">
                    <td style="font-weight:700;">Total</td>
                    <td style="text-align:center;">${res.items.length}</td>
                    <td style="text-align:right;">${f(grandData)}</td>
                    <td style="text-align:right;">${f(grandMedia)}</td>
                    <td style="text-align:right;font-weight:700;">${f(grandData + grandMedia)}</td>
                </tr></tfoot>
            </table>
        </div>
        <h3 style="margin:14px 0 4px;">Éléments les plus lourds</h3>
        <div class="scwm-scenesize-scroll" style="max-height:40vh;overflow:auto;">
            <table class="scwm-reg-table">
                <thead><tr><th>Type</th><th>Nom</th><th>Dossier</th><th>Données</th><th>Médias</th><th>Total</th></tr></thead>
                <tbody>${itemRows || `<tr><td colspan="6" style="opacity:.6;">Rien à afficher.</td></tr>`}</tbody>
            </table>
        </div>
        ${capNote}${warn}`;
}

// Expéditions CLÔTURÉES distinctes (regroupées par nom + début + MJ), avec les
// PJ participants. Base de l'assiduité (jamais les connexions).
function closedExpeditions() {
    const map = new Map();
    for (const actor of game.actors ?? []) {
        if (actor.type !== "character") continue;
        for (const e of getExpeditions(actor)) {
            if (!e.startDate || !e.endDate) continue;   // seulement clôturées
            const key = `${e.name || "?"}|${JSON.stringify(e.startDate)}|${e.gmId || ""}`;
            if (!map.has(key)) map.set(key, { name: e.name || "Expédition sans nom", startDate: e.startDate, endDate: e.endDate, gmId: e.gmId || null, startReal: e.startReal ?? null, endReal: e.endReal ?? null, participants: new Set() });
            const g = map.get(key);
            g.participants.add(actor.id);
            if (e.endReal && (!g.endReal || e.endReal > g.endReal)) g.endReal = e.endReal;      // date réelle de clôture
            if (e.startReal && (!g.startReal || e.startReal < g.startReal)) g.startReal = e.startReal; // ouverture
        }
    }
    return [...map.values()]
        .map(x => ({ ...x, participants: [...x.participants] }))
        .sort((a, b) => dateVal(b.endDate) - dateVal(a.endDate));
}

// Date IRL lisible + ancienneté (« il y a X j ») pour juger de l'activité.
function realDateLabel(iso) {
    if (!iso) return "jamais";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    const ago = days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} j`;
    return `${d.toLocaleDateString("fr-FR")} (${ago})`;
}

// Barres horizontales (graphique CSS, sans librairie). r.extra = texte à droite.
function barChart(rows, color) {
    if (!rows.length) return `<p class="scwm-casier-empty">Aucune donnée.</p>`;
    const max = Math.max(1, ...rows.map(r => r.value));
    return rows.map(r => `
        <div style="display:flex;align-items:center;gap:8px;margin:3px 0;">
            <span style="flex:0 0 150px;text-align:right;font-size:.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.label)}</span>
            <div style="flex:1;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;">
                <div style="width:${(r.value / max * 100).toFixed(1)}%;background:${color};height:15px;border-radius:3px;min-width:2px;"></div>
            </div>
            <span style="flex:0 0 28px;font-size:.85em;font-weight:600;">${r.value}</span>
            ${r.extra ? `<span style="flex:0 0 150px;font-size:.78em;opacity:.75;white-space:nowrap;">${esc(r.extra)}</span>` : ""}
        </div>`).join("");
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
            if (!groups.has(key)) groups.set(key, { name: e.name || "Expédition sans nom", startDate: e.startDate, gmId: e.gmId, startReal: e.startReal ?? null, endReal: null, participants: [] });
            groups.get(key).participants.push(actor.name);
        }
    }

    return (game.users ?? []).filter(u => u.isGM).map(gm => {
        const exps = (byGm.has(gm.id) ? [...byGm.get(gm.id).values()] : [])
            .map(x => ({ ...x, sessions: expeditionSessionCount(x) }));
        return { id: gm.id, name: gm.name, count: exps.length, exps };
    });
}

class CasierApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id:       "scwm-casier",
        classes:  ["scwm-casier"],
        window:   { title: "Casier", icon: "fa-solid fa-box-archive", resizable: true },
        position: { width: 760, height: 560 }
    };

    #tab = "dashboard";
    #selectedId = null;
    #viewGmId = null;   // GM dont on consulte le dashboard depuis « Suivi des GM »

    get title() { return `Casier de ${game.user.name}`; }

    async _renderHTML() { return this.#buildHTML(); }
    _replaceHTML(result, content) { content.innerHTML = result; this.#wire(content); }

    // ---- Rendu ----
    #buildHTML() {
        const drafts = myDrafts();

        const cvEnabled = game.settings.get(MOD, "enableCharValidation");
        const cvCount = cvEnabled ? (getCreationRequests().length + getPendingActors().length) : 0;
        const tmEnabled = game.settings.get(MOD, "tmEnabled");
        const tmDeclared = tmEnabled
            ? (game.actors?.filter(a => a.type === "character" && a.hasPlayerOwner && a.getFlag(MOD, "tm")?.declared).length ?? 0)
            : 0;

        // Onglets répartis en deux groupes : « Travail » (usage courant du MJ)
        // et « Statistiques » (vues de données / analyse).
        const workTabs = [
            { key: "dashboard",   icon: "fa-gauge-high", label: "Dashboard" },
            { key: "reports",     icon: "fa-scroll",     label: `Rapports${drafts.length ? ` (${drafts.length})` : ""}` },
            { key: "expeditions", icon: "fa-route",      label: "Expéditions" },
            ...(tmEnabled ? [{ key: "downtime", icon: "fa-hourglass-half", label: `Temps morts${tmDeclared ? ` (${tmDeclared})` : ""}` }] : []),
            ...(cvEnabled ? [{ key: "validation", icon: "fa-id-card", label: `Validation${cvCount ? ` (${cvCount})` : ""}` }] : [])
        ];
        const statTabs = [
            { key: "gms",         icon: "fa-users-gear",   label: "Suivi des GM" },
            { key: "registre",    icon: "fa-address-book", label: "Registre" },
            { key: "stats",       icon: "fa-chart-pie",    label: "Statistiques" },
            { key: "dispos",      icon: "fa-user-check",   label: "Disponibilités" },
            { key: "attendance",  icon: "fa-chart-column", label: "Assiduité" },
            { key: "scenesize",   icon: "fa-hard-drive",   label: "Poids du monde" }
        ];
        const tabBtn = (t) => `
            <button type="button" class="scwm-casier-tab ${this.#tab === t.key ? "active" : ""}" data-tab="${t.key}">
                <i class="fas ${t.icon}"></i> ${t.label}
            </button>`;
        const tabsHtml = `
            <div class="scwm-casier-tabgroup">Travail</div>
            ${workTabs.map(tabBtn).join("")}
            <div class="scwm-casier-tabgroup">Statistiques</div>
            ${statTabs.map(tabBtn).join("")}`;

        // Liste du livret (colonne gauche) — seulement pour l'onglet Rapports.
        let sideList = "";
        if (this.#tab === "reports") {
            sideList = drafts.length
                ? drafts.map(d => `
                    <div class="scwm-casier-page ${d.id === this.#selectedId ? "active" : ""}" data-draft-id="${esc(d.id)}">
                        <i class="fa-solid fa-scroll"></i>
                        <span class="scwm-casier-page-title">Rapport — ${esc(d.dateDisplay)}</span>
                    </div>`).join("")
                : `<div class="scwm-casier-empty">Aucun rapport en attente.</div>`;
        }

        let detail;
        if (this.#tab === "dashboard")      detail = this.#dashboardDetail(drafts);
        else if (this.#tab === "reports") {
            const draft = drafts.find(d => d.id === this.#selectedId);
            detail = draft ? this.#draftDetail(draft) : `<div class="scwm-casier-placeholder"><i class="fa-solid fa-book-open"></i><p>Sélectionnez un rapport à finaliser dans le livret.</p></div>`;
        }
        else if (this.#tab === "expeditions") detail = this.#expeditionsDetail();
        else if (this.#tab === "downtime")    detail = this.#downtimeDetail();
        else if (this.#tab === "registre")    detail = this.#registreDetail();
        else if (this.#tab === "stats")       detail = this.#statsDetail();
        else if (this.#tab === "dispos")      detail = this.#disposDetail();
        else if (this.#tab === "scenesize")   detail = this.#sceneSizeDetail();
        else if (this.#tab === "attendance")  detail = this.#attendanceDetail();
        else if (this.#tab === "validation")  detail = this.#validationDetail();
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
                <h2><i class="fa-solid fa-box-archive"></i> Casier de ${esc(game.user.name)}</h2>
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
        if (!exps.length) return `<div class="scwm-casier-placeholder"><i class="fa-solid fa-route"></i><p>Aucune expédition en cours.</p></div>`;
        return `
            <div class="scwm-casier-detail">
                <h2>Expéditions en cours</h2>
                ${exps.map(x => `
                    <div class="scwm-casier-exp-card ${x.current ? "current" : ""}">
                        <div class="scwm-casier-exp-head">
                            <i class="fa-solid fa-route"></i>
                            <span class="scwm-casier-exp-name">${esc(x.name)}</span>
                            ${x.current ? `<span class="scwm-casier-exp-badge">En session</span>` : ""}
                            <span class="scwm-casier-date">${esc(formatDate(x.startDate))}</span>
                            ${x.sessions != null ? `<span class="scwm-casier-date" style="opacity:.7;">· ${x.sessions} session${x.sessions > 1 ? "s" : ""}</span>` : ""}
                        </div>
                        ${x.participants.length ? `<div class="scwm-casier-exp-parts">${x.participants.map(p => esc(p.name)).join(", ")}</div>` : ""}
                    </div>`).join("")}
            </div>`;
    }

    // ---- Onglet Temps morts (panneau embarqué) ----
    #downtimeDetail() {
        return `
            <div class="scwm-casier-detail scwm-casier-downtime">
                <h2><i class="fa-solid fa-hourglass-half"></i> Temps morts</h2>
                <div class="scwm-tm-embed">${downtimeContentHtml(true)}</div>
                <div class="scwm-casier-actions" style="margin-top:10px;">
                    <button type="button" class="scwm-casier-apply-tm"><i class="fa-solid fa-coins"></i> Appliquer les gains</button>
                </div>
            </div>`;
    }

    // ---- Onglet Validation des personnages ----
    #validationDetail() {
        const reqs = getCreationRequests();
        const pend = getPendingActors();

        const reqRows = reqs.length ? reqs.map(r => `
            <div class="scwm-casier-cv-row" data-cv-user="${esc(r.userId)}">
                <div class="scwm-cv-info">
                    <strong>${esc(r.name || "Sans nom")}</strong> — <em>${esc(r.userName)}</em>
                    ${r.concept ? `<br><small>${esc(r.concept)}</small>` : ""}
                </div>
                <div class="scwm-cv-row-actions">
                    <button type="button" class="scwm-cv-approve" data-user="${esc(r.userId)}"><i class="fa-solid fa-check"></i> Créer &amp; assigner</button>
                    <button type="button" class="scwm-cv-reject" data-user="${esc(r.userId)}"><i class="fa-solid fa-times"></i> Refuser</button>
                </div>
            </div>`).join("") : `<div class="scwm-casier-empty">Aucune demande de création.</div>`;

        const pendRows = pend.length ? pend.map(a => {
            // Dépliant des modifications de montée de niveau (si présentes).
            const changes = Array.isArray(a.changes) ? a.changes : [];
            const changesBlock = (a.kind === "levelup" && changes.length) ? `
                <details class="scwm-cv-changes" style="margin-top:6px;">
                    <summary style="cursor:pointer;opacity:.85;font-size:.9em;"><i class="fa-solid fa-list-check"></i> Modifications de la fiche (${changes.length})</summary>
                    <ul style="margin:4px 0 0;padding-left:18px;font-size:.85em;opacity:.9;">${changes.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
                </details>` : "";
            return `
            <div class="scwm-casier-cv-row" data-cv-actor="${esc(a.id)}">
                <div class="scwm-cv-info">
                    <strong>${esc(a.name)}</strong> — <em>${esc(a.ownerName)}</em>
                    ${a.kind === "levelup"
                        ? `<span class="scwm-cv-tag scwm-cv-tag-levelup"><i class="fa-solid fa-arrow-up-1-9"></i> Montée de niveau</span>`
                        : `<span class="scwm-cv-tag scwm-cv-tag-creation"><i class="fa-solid fa-user-plus"></i> Création</span>`}
                    ${changesBlock}
                </div>
                <div class="scwm-cv-row-actions">
                    <button type="button" class="scwm-cv-openactor" data-actor="${esc(a.id)}" title="Ouvrir la fiche"><i class="fa-solid fa-user"></i></button>
                    <button type="button" class="scwm-cv-validate" data-actor="${esc(a.id)}"><i class="fa-solid fa-lock"></i> Valider &amp; verrouiller</button>
                    <button type="button" class="scwm-cv-return" data-actor="${esc(a.id)}"><i class="fa-solid fa-rotate-left"></i> Renvoyer</button>
                </div>
            </div>`; }).join("") : `<div class="scwm-casier-empty">Aucune fiche à valider.</div>`;

        return `
            <div class="scwm-casier-detail scwm-casier-validation">
                <h2><i class="fa-solid fa-id-card"></i> Validation des personnages</h2>
                <div class="scwm-casier-cv-section">
                    <h3>Demandes de création</h3>
                    ${reqRows}
                </div>
                <div class="scwm-casier-cv-section">
                    <h3>Fiches à valider</h3>
                    ${pendRows}
                </div>
            </div>`;
    }

    // ---- Onglet Suivi des GM ----
    #gmsDetail() {
        // Si un GM est sélectionné → on affiche uniquement SON dashboard.
        if (this.#viewGmId) return this.#gmDashboardDetail(this.#viewGmId);

        const gms = gmTracking();
        if (!gms.length) return `<div class="scwm-casier-placeholder"><i class="fa-solid fa-users-gear"></i><p>Aucun GM.</p></div>`;
        return `
            <div class="scwm-casier-detail">
                <h2>Suivi des GM</h2>
                ${gms.map(gm => `
                    <div class="scwm-casier-gm-card ${gm.count ? "active" : ""}">
                        <div class="scwm-casier-gm-head">
                            <i class="fa-solid fa-user-shield"></i>
                            <span class="scwm-casier-gm-name scwm-casier-gm-open" data-gm="${esc(gm.id)}" title="Voir le dashboard de ${esc(gm.name)}">${esc(gm.name)}</span>
                            <span class="scwm-casier-gm-badge">${gm.count} expédition${gm.count > 1 ? "s" : ""}</span>
                        </div>
                        ${gm.exps.length
                            ? `<ul class="scwm-casier-gm-exps">${gm.exps.map(e => `
                                <li>
                                    <strong>${esc(e.name)}</strong>
                                    <span class="scwm-casier-date">(${esc(formatDate(e.startDate))})</span>
                                    ${e.sessions != null ? `<span class="scwm-casier-date" style="opacity:.7;">· ${e.sessions} session${e.sessions > 1 ? "s" : ""}</span>` : ""}
                                    <div class="scwm-casier-gm-parts">${e.participants.length ? e.participants.map(esc).join(", ") : "Aucun joueur"}</div>
                                </li>`).join("")}</ul>`
                            : `<div class="scwm-casier-gm-line" style="opacity:.6;">Aucune expédition en cours.</div>`}
                    </div>`).join("")}
            </div>`;
    }

    // ---- Onglet Assiduité ----
    // Cœur (compteurs, barres, tableau) = EXPÉDITIONS clôturées.
    // Activité (joueurs/MJ actifs + date de dernière activité) = SESSIONS.
    // Chaque expédition affiche (N sessions) = sessions du même MJ dans sa période.
    #attendanceDetail() {
        const list = closedExpeditions();
        const sessions = getSessionLog();

        // Dernière SESSION (date réelle) par joueur et par MJ → mesure d'activité.
        const sessPlayerLast = new Map();   // nom joueur -> ISO
        const sessGmLast     = new Map();   // nom MJ     -> ISO
        const keepMax = (m, k, iso) => { if (!iso) return; const cur = m.get(k); if (!cur || iso > cur) m.set(k, iso); };
        for (const s of sessions) {
            const gmName = s.gmName || (s.gmId ? (game.users.get(s.gmId)?.name ?? "MJ inconnu") : "MJ inconnu");
            keepMax(sessGmLast, gmName, s.dateISO);
            for (const p of (s.players ?? [])) {
                const a = game.actors.get(p.actorId);
                keepMax(sessPlayerLast, a ? playerOf(a) : (p.name ?? "?"), s.dateISO);
            }
        }
        if (!list.length) {
            return `<div class="scwm-casier-placeholder"><i class="fa-solid fa-chart-column"></i>
                <p>Aucune expédition clôturée pour l'instant. L'assiduité se calcule sur les expéditions terminées.</p></div>`;
        }

        // Agrégats EXPÉDITIONS (par joueur / par MJ).
        const players = new Map();   // nom joueur -> count
        const gms     = new Map();   // nom MJ     -> { count, parts }
        for (const e of list) {
            const gmName = e.gmId ? (game.users.get(e.gmId)?.name ?? "MJ inconnu") : "— (sans MJ)";
            if (!gms.has(gmName)) gms.set(gmName, { count: 0, parts: 0 });
            const g = gms.get(gmName); g.count++; g.parts += e.participants.length;

            const pn = new Set(e.participants.map(id => { const a = game.actors.get(id); return a ? playerOf(a) : null; }).filter(Boolean));
            for (const name of pn) players.set(name, (players.get(name) ?? 0) + 1);
        }

        // Barres : valeur = nb d'expéditions ; date à droite = dernière SESSION (activité).
        const playerRows = [...players.entries()].map(([label, count]) => ({ label, value: count, extra: realDateLabel(sessPlayerLast.get(label)) })).sort((a, b) => b.value - a.value);
        const gmRows     = [...gms.entries()].map(([label, g]) => ({ label, value: g.count, parts: g.parts, extra: realDateLabel(sessGmLast.get(label)) })).sort((a, b) => b.value - a.value);

        // « Actifs » (trimestre = 90 j) : basé sur la dernière SESSION.
        const ACTIVE_DAYS = 90;
        const isRecent = (iso) => iso && (Date.now() - new Date(iso).getTime()) <= ACTIVE_DAYS * 86400000;
        const totalExp = list.length;
        const totalPlayers = [...sessPlayerLast.values()].filter(isRecent).length;
        const totalGms = [...sessGmLast.entries()].filter(([k, iso]) => !k.startsWith("—") && isRecent(iso)).length;

        // Tableau des expéditions (40 plus récentes) avec (N sessions).
        const expRows = list.slice(0, 40).map(e => {
            const ns = expeditionSessionCount(e);
            return `
            <tr>
                <td>${esc(e.name)}${ns != null ? ` <span style="opacity:.65;">(${ns} session${ns > 1 ? "s" : ""})</span>` : ""}</td>
                <td>${esc(formatDate(e.endDate))}</td>
                <td style="font-size:.85em;opacity:.8;">${esc(e.endReal ? new Date(e.endReal).toLocaleDateString("fr-FR") : "—")}</td>
                <td>${esc(e.gmId ? (game.users.get(e.gmId)?.name ?? "?") : "—")}</td>
                <td style="font-size:.85em;">${e.participants.map(id => esc(game.actors.get(id)?.name ?? "?")).join(", ") || "—"}</td>
            </tr>`;
        }).join("");

        const card = (n, l) => `<div style="flex:1;background:var(--scwm-panel,rgba(255,255,255,.05));border-radius:8px;padding:8px 10px;text-align:center;">
            <div style="font-size:1.5em;font-weight:700;">${n}</div><div style="font-size:.8em;opacity:.7;">${l}</div></div>`;

        return `
            <div class="scwm-casier-detail scwm-casier-attendance" style="overflow:auto;">
                <h2><i class="fa-solid fa-chart-column"></i> Assiduité</h2>
                <div style="display:flex;gap:10px;margin:0 0 14px;">
                    ${card(totalExp, "expéditions clôturées")}
                    ${card(totalPlayers, "joueurs actifs (trimestre)")}
                    ${card(totalGms, "MJ actifs (trimestre)")}
                </div>

                <div class="scwm-casier-cv-section">
                    <h3>Expéditions par joueur <span style="font-weight:400;font-size:.75em;opacity:.7;">(nombre · dernière session jouée)</span></h3>
                    ${barChart(playerRows, "#8fd19e")}
                </div>

                <div class="scwm-casier-cv-section">
                    <h3>Expéditions menées par MJ <span style="font-weight:400;font-size:.75em;opacity:.7;">(nombre · dernière session menée)</span></h3>
                    ${barChart(gmRows, "#c9a227")}
                    <div style="font-size:.8em;opacity:.7;margin-top:4px;">${gmRows.map(g => `${esc(g.label)} : ${g.parts} participation(s)`).join(" · ")}</div>
                </div>

                <div class="scwm-casier-cv-section">
                    <h3>Expéditions clôturées (récentes)</h3>
                    <table style="width:100%;border-collapse:collapse;font-size:.9em;">
                        <thead><tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,.15);">
                            <th style="padding:3px 4px;">Expédition</th><th style="padding:3px 4px;">Fin (IG)</th><th style="padding:3px 4px;">Clôturée (IRL)</th><th style="padding:3px 4px;">MJ</th><th style="padding:3px 4px;">Participants</th>
                        </tr></thead>
                        <tbody>${expRows}</tbody>
                    </table>
                </div>
            </div>`;
    }

    // Dashboard d'un GM donné, consulté depuis « Suivi des GM » (uniquement le
    // dashboard). Éditable si c'est le sien, en lecture seule sinon.
    #gmDashboardDetail(gmId) {
        const gm     = game.users?.get(gmId);
        const name   = gm?.name ?? "GM";
        const drafts = draftsFor(gmId);
        const exps   = gmExpeditions(gmId);
        const isSelf = gmId === game.user.id;
        const pres   = getPresentation(gmId);
        const presHtml = isSelf
            ? `<textarea class="scwm-casier-presentation" rows="8"
                    placeholder="Présentez-vous, vos critères, vos horaires… (visible ici, sauvegardé automatiquement)">${esc(pres)}</textarea>`
            : (pres
                ? `<div class="scwm-casier-presentation-view">${esc(pres).replace(/\n/g, "<br>")}</div>`
                : `<div class="scwm-casier-empty">Aucune présentation renseignée.</div>`);
        return `
            <div class="scwm-casier-detail scwm-casier-dashboard">
                <button type="button" class="scwm-casier-gm-back"><i class="fa-solid fa-arrow-left"></i> Retour au suivi des GM</button>
                <h2><i class="fa-solid fa-box-archive"></i> Casier de ${esc(name)}</h2>
                <p class="scwm-casier-meta">Tableau de bord du meneur${isSelf ? "" : " — lecture seule"}</p>

                <div class="scwm-casier-stats">
                    <div class="scwm-casier-stat"><b>${drafts.length}</b><span>Rapport(s) à finaliser</span></div>
                    <div class="scwm-casier-stat"><b>${exps.length}</b><span>Expédition(s) en cours</span></div>
                </div>

                <h3>Présentation</h3>
                ${presHtml}
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
                    <button type="button" class="scwm-casier-send"><i class="fa-solid fa-paper-plane"></i> Clôturer &amp; envoyer sur Discord</button>
                    <button type="button" class="scwm-casier-delete"><i class="fa-solid fa-trash"></i> Supprimer</button>
                </div>
            </div>`;
    }

    // ---- Onglet Registre des personnages ----
    #registreDetail() {
        const lastMap = playerLastSessionMap();
        const rows = rosterRows()
            .sort((a, b) => a.joueur.localeCompare(b.joueur, "fr", { sensitivity: "base" })
                         || a.perso.localeCompare(b.perso, "fr", { sensitivity: "base" }));
        const body = rows.map(r => {
            const iso = lastMap.get(r.joueur);
            const inactive = !isPlayerActive(iso);
            const title = inactive ? `Joueur inactif — dernière session : ${realDateLabel(iso)}` : "";
            return `
            <tr class="scwm-reg-row scwm-reg-clickable${inactive ? " scwm-reg-inactive" : ""}"
                data-actor="${r.id}" title="${esc(title)}"
                data-joueur="${esc(r.joueur)}" data-perso="${esc(r.perso)}"
                data-classe="${esc(r.classes[0]?.name ?? "")}" data-race="${esc(r.race)}"
                data-total="${r.total}">
                <td>${esc(r.joueur)}${inactive ? ' <i class="fa-solid fa-moon" title="Inactif ce trimestre"></i>' : ""}</td>
                <td>${esc(r.perso)}</td>
                <td>${esc(classesLabel(r.classes))}</td>
                <td>${esc(r.race)}</td>
                <td style="text-align:center;">${r.total}</td>
                <td style="text-align:center;">${r.multi ? "✔" : ""}</td>
            </tr>`;
        }).join("");
        return `
            <div class="scwm-casier-detail">
                <h2><i class="fa-solid fa-address-book"></i> Registre des personnages</h2>
                <div class="scwm-reg-toolbar">
                    <input type="text" class="scwm-reg-filter" placeholder="Filtrer (joueur, perso, classe, espèce)…">
                    <span class="scwm-reg-count">${rows.length} PJ</span>
                    <button type="button" class="scwm-reg-csv"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
                </div>
                <p class="scwm-reg-legend"><i class="fa-solid fa-moon"></i> joueur inactif (aucune session depuis ${ACTIVE_DAYS} j) · clic sur une ligne = ouvrir la fiche</p>
                <table class="scwm-reg-table">
                    <thead><tr>
                        <th class="scwm-reg-sort" data-col="0" data-type="txt">Joueur</th>
                        <th class="scwm-reg-sort" data-col="1" data-type="txt">Perso</th>
                        <th class="scwm-reg-sort" data-col="2" data-type="txt">Classe(s)</th>
                        <th class="scwm-reg-sort" data-col="3" data-type="txt">Espèce</th>
                        <th class="scwm-reg-sort" data-col="4" data-type="num">Niv</th>
                        <th>Multi</th>
                    </tr></thead>
                    <tbody>${body || `<tr><td colspan="6" style="opacity:.6;">Aucun PJ.</td></tr>`}</tbody>
                </table>
            </div>`;
    }

    // ---- Onglet Statistiques ----
    #statsDetail() {
        const st = rosterStats(rosterRows());
        const countTable = (title, obj, numericKey = false) => {
            const entries = Object.entries(obj);
            entries.sort((a, b) => numericKey ? (Number(a[0]) - Number(b[0]))
                                              : (b[1] - a[1] || a[0].localeCompare(b[0], "fr", { sensitivity: "base" })));
            return `<div class="scwm-stat-block">
                <h3>${title}</h3>
                <table class="scwm-reg-table"><tbody>
                    ${entries.map(([k, v]) => `<tr><td>${esc(String(k))}</td><td style="text-align:right;">${v}</td></tr>`).join("")
                        || `<tr><td style="opacity:.6;">—</td></tr>`}
                </tbody></table>
            </div>`;
        };
        return `
            <div class="scwm-casier-detail">
                <h2><i class="fa-solid fa-chart-pie"></i> Statistiques</h2>
                <div class="scwm-casier-stats">
                    <div class="scwm-casier-stat"><b>${st.nbJoueurs}</b><span>Joueur(s)</span></div>
                    <div class="scwm-casier-stat"><b>${st.nbPerso}</b><span>Personnage(s)</span></div>
                    <div class="scwm-casier-stat"><b>${st.multiCount}</b><span>Multiclassé(s)</span></div>
                </div>
                <div class="scwm-stat-grid">
                    ${countTable("Par classe", st.byClass)}
                    ${countTable("Par sous-classe", st.bySub)}
                    ${countTable("Par espèce", st.byRace)}
                    ${countTable("Par joueur", st.byPlayer)}
                    ${countTable("Distribution des niveaux", st.byLevel, true)}
                </div>
            </div>`;
    }

    // ---- Onglet Disponibilités ----
    #disposDetail() {
        const lastMap = playerLastSessionMap();
        const rows = disposRows();
        const body = rows.map(r => {
            const iso = lastMap.get(r.joueur);
            const inactive = !isPlayerActive(iso);
            return `
            <tr class="${inactive ? "scwm-reg-inactive" : ""}"
                title="${inactive ? esc(`Joueur inactif — dernière session : ${realDateLabel(iso)}`) : ""}">
                <td>${esc(r.joueur)}${inactive ? ' <i class="fa-solid fa-moon" title="Inactif ce trimestre"></i>' : ""}</td>
                <td>${esc(r.pjs.join(", ")) || "—"}</td>
                <td style="text-align:center;">${r.nb}</td>
                <td style="text-align:center;">${r.open || ""}</td>
                <td style="white-space:nowrap;">${esc(realDateLabel(iso))}</td>
            </tr>`;
        }).join("");
        return `
            <div class="scwm-casier-detail">
                <h2><i class="fa-solid fa-user-check"></i> Disponibilités des joueurs</h2>
                <p class="scwm-reg-legend"><i class="fa-solid fa-moon"></i> joueur inactif (aucune session depuis ${ACTIVE_DAYS} j)</p>
                <table class="scwm-reg-table">
                    <thead><tr>
                        <th>Joueur</th><th>PJ</th><th>Nb PJ</th><th>Expé. en cours</th><th>Dernière session</th>
                    </tr></thead>
                    <tbody>${body || `<tr><td colspan="5" style="opacity:.6;">Aucun joueur.</td></tr>`}</tbody>
                </table>
            </div>`;
    }

    // ---- Onglet Poids du monde ----
    #sceneSizeDetail() {
        return `
            <div class="scwm-casier-detail">
                <h2><i class="fa-solid fa-hard-drive"></i> Poids du monde</h2>
                <div class="scwm-reg-toolbar">
                    <span style="flex:1;font-size:.85em;color:#9a8b70;">
                        Poids des documents (données) + de leurs médias (images, audio), tous types confondus :
                        scènes, acteurs, objets, journaux, tables, cartes, playlists, macros. Le plus lourd d'abord.
                    </span>
                    <button type="button" class="scwm-scenesize-calc"><i class="fa-solid fa-rotate"></i> Recalculer</button>
                </div>
                <div class="scwm-scenesize-out">
                    <p style="opacity:.7;"><i class="fa-solid fa-spinner fa-spin"></i> Calcul en cours…</p>
                </div>
            </div>`;
    }

    // ---- Écouteurs ----
    #wire(root) {
        root.querySelectorAll(".scwm-casier-tab").forEach(btn =>
            btn.addEventListener("click", () => {
                this.#tab = btn.dataset.tab;
                this.#viewGmId = null;   // on quitte la vue dashboard d'un GM
                this.render();
            }));

        // ---- Suivi des GM : ouvrir / fermer le dashboard d'un GM ----
        root.querySelectorAll(".scwm-casier-gm-open").forEach(el =>
            el.addEventListener("click", () => { this.#viewGmId = el.dataset.gm; this.render(); }));
        root.querySelector(".scwm-casier-gm-back")?.addEventListener("click", () => { this.#viewGmId = null; this.render(); });

        root.querySelectorAll(".scwm-casier-page[data-draft-id]").forEach(pg =>
            pg.addEventListener("click", () => {
                this.#selectedId = pg.dataset.draftId;
                this.render();
            }));

        // ---- Onglet Poids des scènes : calcul asynchrone + remplissage ----
        if (this.#tab === "scenesize") {
            const out = root.querySelector(".scwm-scenesize-out");
            const run = async () => {
                if (out) out.innerHTML = `<p style="opacity:.7;"><i class="fa-solid fa-spinner fa-spin"></i> Calcul en cours…</p>`;
                try {
                    const res = await measureWorld();
                    if (out) out.innerHTML = worldSizeTablesHtml(res);
                } catch (e) {
                    console.warn("[casier] poids du monde :", e);
                    if (out) out.innerHTML = `<p style="color:#c0392b;">Échec du calcul.</p>`;
                }
            };
            run();
            root.querySelector(".scwm-scenesize-calc")?.addEventListener("click", () => run());
        }

        // ---- Onglet Registre : filtre / tri / export CSV (100% client) ----
        const regTable = root.querySelector(".scwm-reg-table");
        if (regTable) {
            const tbody = regTable.querySelector("tbody");
            const allRows = () => Array.from(tbody.querySelectorAll("tr.scwm-reg-row"));

            // Clic sur une ligne → ouvre la fiche du PJ.
            root.querySelectorAll("tr.scwm-reg-clickable").forEach(tr =>
                tr.addEventListener("click", () => game.actors.get(tr.dataset.actor)?.sheet.render(true)));

            // Filtre live (masque les lignes, met à jour le compteur).
            const filter = root.querySelector(".scwm-reg-filter");
            const count  = root.querySelector(".scwm-reg-count");
            const applyFilter = () => {
                const q = (filter?.value || "").toLowerCase().trim();
                let shown = 0;
                for (const tr of allRows()) {
                    const hit = !q || tr.textContent.toLowerCase().includes(q);
                    tr.style.display = hit ? "" : "none";
                    if (hit) shown++;
                }
                if (count) count.textContent = `${shown} PJ`;
            };
            filter?.addEventListener("input", applyFilter);

            // Tri au clic sur l'en-tête (alterne asc/desc).
            let sortDir = {};
            root.querySelectorAll(".scwm-reg-sort").forEach(th => th.addEventListener("click", () => {
                const col  = Number(th.dataset.col);
                const num  = th.dataset.type === "num";
                const dir  = sortDir[col] = -(sortDir[col] || 1);   // bascule
                const rows = allRows().sort((a, b) => {
                    const va = a.children[col]?.textContent.trim() ?? "";
                    const vb = b.children[col]?.textContent.trim() ?? "";
                    const c  = num ? (parseFloat(va) || 0) - (parseFloat(vb) || 0)
                                   : va.localeCompare(vb, "fr", { sensitivity: "base" });
                    return c * dir;
                });
                rows.forEach(r => tbody.appendChild(r));
                root.querySelectorAll(".scwm-reg-sort").forEach(h => h.dataset.arrow = "");
                th.dataset.arrow = dir > 0 ? " ▲" : " ▼";
            }));

            // Export CSV (lignes visibles, dans l'ordre courant).
            root.querySelector(".scwm-reg-csv")?.addEventListener("click", () => {
                const header = ["Joueur", "Perso", "Classe(s)", "Espèce", "Niveau total", "Multiclasse"];
                const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
                const lines = [header.map(esc).join(";")];
                for (const tr of allRows()) {
                    if (tr.style.display === "none") continue;
                    const c = tr.children;
                    lines.push([c[0], c[1], c[2], c[3], c[4], c[5]]
                        .map(td => esc(td?.textContent.trim() ?? "")).join(";"));
                }
                const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement("a");
                a.href = url; a.download = "registre-pj.csv";
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            });
        }

        // ---- Onglet Validation ----
        root.querySelectorAll(".scwm-cv-approve").forEach(b => b.addEventListener("click", async () => { await approveCreation(b.dataset.user); this.render(); refreshCasierBadge(); }));
        root.querySelectorAll(".scwm-cv-reject").forEach(b => b.addEventListener("click", async () => { await rejectCreation(b.dataset.user); this.render(); refreshCasierBadge(); }));
        root.querySelectorAll(".scwm-cv-validate").forEach(b => b.addEventListener("click", async () => { await validateActor(b.dataset.actor); this.render(); refreshCasierBadge(); }));
        root.querySelectorAll(".scwm-cv-return").forEach(b => b.addEventListener("click", async () => { await returnActor(b.dataset.actor); this.render(); refreshCasierBadge(); }));
        root.querySelectorAll(".scwm-cv-grantlvl").forEach(b => b.addEventListener("click", async () => { await grantLevelUp(b.dataset.actor); this.render(); refreshCasierBadge(); }));
        root.querySelectorAll(".scwm-cv-openactor").forEach(b => b.addEventListener("click", () => game.actors.get(b.dataset.actor)?.sheet.render(true)));

        // Onglet Temps morts embarqué : câblage + application des gains.
        if (this.#tab === "downtime") {
            wireDowntime(root);
            root.querySelector(".scwm-casier-apply-tm")?.addEventListener("click", async () => {
                await applyDowntimeFromRoot(root);
                this.render();
            });
        }

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

// Fenêtre (lecture seule) des présentations des MJ — accessible aux joueurs.
export function openGmPresentations() {
    const gms = (game.users ?? []).filter(u => u.isGM);
    const cards = gms.map(gm => {
        const pres = getPresentation(gm.id);
        return `<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;margin:0 0 8px;">
            <div style="font-weight:700;margin-bottom:4px;"><i class="fa-solid fa-user-shield"></i> ${esc(gm.name)}</div>
            <div style="font-size:.92em;opacity:.9;">${pres ? esc(pres).replace(/\n/g, "<br>") : "<em>Aucune présentation.</em>"}</div>
        </div>`;
    }).join("") || "<p>Aucun MJ.</p>";
    foundry.applications.api.DialogV2.wait({
        window:   { title: "Présentations des MJ", icon: "fa-solid fa-user-shield" },
        position: { width: 480 },
        content:  `<div style="max-height:60vh;overflow:auto;">${cards}</div>`,
        rejectClose: false,
        buttons: [{ action: "close", label: "Fermer", icon: "fa-solid fa-xmark", default: true }]
    }).catch(() => {});
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

    // Bouton JOUEUR : voir les présentations des MJ (lecture seule).
    Hooks.on("getSceneControlButtons", (controls) => {
        if (game.user.isGM) return;   // le MJ a déjà le Casier complet
        if (!controls.westmarch) {
            controls.westmarch = { name: "westmarch", title: "WestMarch", icon: "fa-solid fa-hammer", layer: "tokens", tools: {} };
        }
        controls.westmarch.tools.gmPresentations = {
            name:     "gmPresentations",
            title:    "Présentations des MJ",
            icon:     "fa-solid fa-user-shield",
            button:   true,
            onChange: () => openGmPresentations(),
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
                    <p><i class="fa-solid fa-box-archive"></i> Vous avez <strong>${n}</strong> rapport(s) de session en attente de finalisation.</p>
                    <button type="button" class="scwm-casier-open"><i class="fa-solid fa-up-right-from-square"></i> Ouvrir le Casier</button>
                </div>`
            });
        }, 1500);
    });
}
