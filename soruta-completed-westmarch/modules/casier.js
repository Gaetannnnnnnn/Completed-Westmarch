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
import { journal } from "./log.js";
import { getExpeditions, formatDate } from "./carnet.js";
import {
    getSessionDrafts, saveSessionDraft, deleteSessionDraft, sendSessionReport, getSessionLog, expeditionSessionCount,
    applyDeferredAward, setSessionLogTags
} from "./session.js";
import {
    getCreationRequests, approveCreation, rejectCreation,
    getPendingActors, validateActor, returnActor,
    getLevelUpRequests, grantLevelUp
} from "./charvalidation.js";
import { downtimeContentHtml, wireDowntime, applyDowntimeFromRoot } from "./tm.js";
import { mondeActif, ongletMondeHtml, cablerOngletMonde } from "./monde.js";
import { tl, locale } from "./i18n.js";

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
            const key = `${e.name || tl("Expédition")}|${JSON.stringify(e.startDate)}`;
            if (!groups.has(key)) groups.set(key, { name: e.name || tl("Expédition sans nom"), startDate: e.startDate, gmId: e.gmId, startReal: e.startReal ?? null, endReal: null, participants: [] });
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
// Registre des PJ (vue type tableur — inspirée du registre Excel des PJ)
// Colonnes déduites automatiquement des fiches Foundry.
// ============================================================

// Classes du perso : [{ name, ident, sub, subIdent, lvl }] triées par niveau ↓.
// On garde l'IDENTIFIANT (system.identifier) de la classe et de la sous-classe :
// il est indépendant de la langue (« wizard »), contrairement au nom affiché
// qui peut être traduit (« Magicien »). Les statistiques agrègent dessus pour
// ne pas compter la même classe deux fois selon la langue de la fiche.
function charClassList(actor) {
    const classItems = actor.items.filter(i => i.type === "class");
    const subItems   = actor.items.filter(i => i.type === "subclass");
    const findSub = (ci) => {
        const ident = ci.system?.identifier;
        let s = ident ? subItems.find(x => x.system?.classIdentifier === ident) : null;
        if (!s && classItems.length === 1 && subItems.length === 1) s = subItems[0];
        return s ?? null;
    };
    const norm = (v) => String(v ?? "").toLowerCase().trim();
    return classItems
        .map(ci => {
            const s = findSub(ci);
            return {
                name:     ci.name,
                ident:    norm(ci.system?.identifier) || norm(ci.name),
                sub:      s?.name ?? "",
                subIdent: norm(s?.system?.identifier) || norm(s?.name),
                lvl:      ci.system?.levels ?? 0
            };
        })
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
// Classes/sous-classes agrégées par IDENTIFIANT (langue-indépendant) pour éviter
// les doublons « wizard » / « magicien ». Le libellé affiché est le nom le plus
// fréquent rencontré pour cet identifiant (donc la traduction dominante).
function rosterStats(rows) {
    const byRace = {}, byPlayer = {}, byLevel = {};
    let multiCount = 0;

    // key -> { count, names: Map(nomAffiché -> occurrences) }
    const classAgg = new Map();
    const subAgg   = new Map();
    const bump = (map, key, label) => {
        const e = map.get(key) ?? { count: 0, names: new Map() };
        e.count++;
        if (label) e.names.set(label, (e.names.get(label) || 0) + 1);
        map.set(key, e);
    };
    // Convertit une Map d'agrégats en objet { libellé: total } (libellé = le
    // nom le plus fréquent ; les totaux d'un même libellé sont fusionnés).
    const toObj = (map) => {
        const out = {};
        for (const { count, names } of map.values()) {
            const label = [...names.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr", { sensitivity: "base" }))[0]?.[0] ?? "—";
            out[label] = (out[label] || 0) + count;
        }
        return out;
    };

    for (const r of rows) {
        if (r.multi) multiCount++;
        byPlayer[r.joueur] = (byPlayer[r.joueur] || 0) + 1;
        byLevel[r.total]   = (byLevel[r.total] || 0) + 1;
        byRace[r.race]     = (byRace[r.race] || 0) + 1;
        for (const c of r.classes) {
            const cKey = c.ident || String(c.name ?? "").toLowerCase().trim();
            bump(classAgg, cKey, c.name);
            if (c.sub) {
                const sKey = `${cKey}|${c.subIdent || String(c.sub).toLowerCase().trim()}`;
                // Libellé « Classe — Sous-classe » avec les noms tels qu'affichés.
                bump(subAgg, sKey, `${c.name} — ${c.sub}`);
            }
        }
    }

    return { byClass: toObj(classAgg), bySub: toObj(subAgg), byRace, byPlayer, byLevel, multiCount,
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
    const m = new Map();   // nom joueur -> ISO de la dernière activité
    const bump = (name, iso) => { if (!iso) return; const cur = m.get(name); if (!cur || iso > cur) m.set(name, iso); };
    for (const s of getSessionLog()) {
        for (const p of (s.players ?? [])) {
            const a = game.actors.get(p.actorId);
            bump(a ? playerOf(a) : (p.name ?? "?"), s.dateISO);
        }
    }
    // Repli sur les expéditions clôturées (le journal de sessions peut être vide).
    for (const e of closedExpeditions()) {
        if (!e.endReal) continue;
        for (const id of (e.participants ?? [])) {
            const a = game.actors.get(id);
            bump(a ? playerOf(a) : "?", e.endReal);
        }
    }
    return m;
}
const isPlayerActive = (iso) => !!iso && (Date.now() - new Date(iso).getTime()) <= ACTIVE_DAYS * 86400000;

// ============================================================
// Poids du monde (données + médias) — tous types de documents.
// ============================================================
const fmtBytes = (b) => b >= 1048576 ? (b / 1048576).toFixed(2) + tl(" Mo") : (b / 1024).toFixed(1) + tl(" Ko");

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
        items.push({ type, nom: doc.name ?? tl("(sans nom)"), dossier: doc.folder?.name ?? "", data, media });
    };
    const imgsFromHtml = (html) => {
        const out = [];
        if (typeof html !== "string") return out;
        for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) out.push(m[1]);
        return out;
    };

    const jobs = [];
    for (const s of (game.scenes ?? []))
        jobs.push(addDoc(tl("Scène"), s, [s.background?.src, ...(s.tiles ?? []).map(t => t.texture?.src)]));
    for (const a of (game.actors ?? []))
        jobs.push(addDoc(tl("Acteur"), a, [a.img, a.prototypeToken?.texture?.src, ...(a.items?.map(i => i.img) ?? [])]));
    for (const it of (game.items ?? []))
        jobs.push(addDoc(tl("Objet"), it, [it.img]));
    for (const j of (game.journal ?? [])) {
        const srcs = [];
        for (const p of (j.pages ?? [])) { if (p.src) srcs.push(p.src); srcs.push(...imgsFromHtml(p.text?.content)); }
        jobs.push(addDoc(tl("Journal"), j, srcs));
    }
    for (const t of (game.tables ?? []))
        jobs.push(addDoc(tl("Table"), t, [t.img, ...[...(t.results ?? [])].map(r => r.img)]));
    for (const c of (game.cards ?? [])) {
        const srcs = [c.img];
        for (const cd of (c.cards ?? [])) for (const f of (cd.faces ?? [])) srcs.push(f.img);
        jobs.push(addDoc(tl("Cartes"), c, srcs));
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
        ? `<p style="margin:6px 0 0;color:#e0a13a;font-size:12px;">${tl("<i class=\"fa-solid fa-triangle-exclamation\"></i> {0} média(s) non mesuré(s) (URL externe ou fichier manquant).", res.echecs)}</p>`
        : "";
    const capNote = res.items.length > CAP
        ? `<p style="margin:4px 0 0;font-size:12px;opacity:.7;">${tl("Affichage limité aux {0} éléments les plus lourds (sur {1}).", CAP, res.items.length)}</p>`
        : "";

    return `
        <h3 style="margin:10px 0 4px;">${tl("Résumé par type")}</h3>
        <div class="scwm-scenesize-scroll" style="max-height:30vh;overflow:auto;">
            <table class="scwm-reg-table">
                <thead><tr><th>${tl("Type")}</th><th>${tl("Nb")}</th><th>${tl("Données")}</th><th>${tl("Médias")}</th><th>${tl("Total")}</th></tr></thead>
                <tbody>${sumRows || `<tr><td colspan="5" style="opacity:.6;">${tl("Rien à mesurer.")}</td></tr>`}</tbody>
                <tfoot><tr style="border-top:2px solid rgba(201,162,39,0.4);">
                    <td style="font-weight:700;">${tl("Total")}</td>
                    <td style="text-align:center;">${res.items.length}</td>
                    <td style="text-align:right;">${f(grandData)}</td>
                    <td style="text-align:right;">${f(grandMedia)}</td>
                    <td style="text-align:right;font-weight:700;">${f(grandData + grandMedia)}</td>
                </tr></tfoot>
            </table>
        </div>
        <h3 style="margin:14px 0 4px;">${tl("Éléments les plus lourds")}</h3>
        <div class="scwm-scenesize-scroll" style="max-height:40vh;overflow:auto;">
            <table class="scwm-reg-table">
                <thead><tr><th>${tl("Type")}</th><th>${tl("Nom")}</th><th>${tl("Dossier")}</th><th>${tl("Données")}</th><th>${tl("Médias")}</th><th>${tl("Total")}</th></tr></thead>
                <tbody>${itemRows || `<tr><td colspan="6" style="opacity:.6;">${tl("Rien à afficher.")}</td></tr>`}</tbody>
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
            if (!map.has(key)) map.set(key, { name: e.name || tl("Expédition sans nom"), startDate: e.startDate, endDate: e.endDate, gmId: e.gmId || null, startReal: e.startReal ?? null, endReal: e.endReal ?? null, participants: new Set() });
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
    const ago = days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : tl("il y a {0} j", days);
    return `${d.toLocaleDateString(locale())} (${ago})`;
}

// Barres horizontales (graphique CSS, sans librairie). r.extra = texte à droite.
function barChart(rows, color) {
    if (!rows.length) return `<p class="scwm-casier-empty">${tl("Aucune donnée.")}</p>`;
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
            const key = `${e.name || tl("Expédition")}|${JSON.stringify(e.startDate)}`;
            if (!groups.has(key)) groups.set(key, { name: e.name || tl("Expédition sans nom"), startDate: e.startDate, gmId: e.gmId, startReal: e.startReal ?? null, endReal: null, participants: [] });
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
        window:   { title: tl("Casier"), icon: "fa-solid fa-box-archive", resizable: true },
        position: { width: 760, height: 560 }
    };

    #tab = "dashboard";
    #mondeEtat = { type: "" };   // filtre de l'onglet Monde (conservé entre rendus)
    #selectedId = null;
    #viewGmId = null;   // GM dont on consulte le dashboard depuis « Suivi des GM »

    get title() { return tl("Casier de {0}", game.user.name); }

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
            { key: "expeditions", icon: "fa-route",      label: tl("Expéditions") },
            ...(tmEnabled ? [{ key: "downtime", icon: "fa-hourglass-half", label: `Temps morts${tmDeclared ? ` (${tmDeclared})` : ""}` }] : []),
            ...(cvEnabled ? [{ key: "validation", icon: "fa-id-card", label: `Validation${cvCount ? ` (${cvCount})` : ""}` }] : []),
            ...(mondeActif() ? [{ key: "monde", icon: "fa-book-atlas", label: tl("Monde") }] : [])
        ];
        const statTabs = [
            { key: "gms",         icon: "fa-users-gear",   label: tl("Suivi des GM") },
            { key: "registre",    icon: "fa-address-book", label: tl("Registre") },
            { key: "stats",       icon: "fa-chart-pie",    label: tl("Statistiques") },
            { key: "dispos",      icon: "fa-user-check",   label: tl("Disponibilités") },
            { key: "attendance",  icon: "fa-chart-column", label: tl("Assiduité") },
            { key: "scenesize",   icon: "fa-hard-drive",   label: tl("Poids du monde") }
        ];
        const tabBtn = (t) => `
            <button type="button" class="scwm-casier-tab ${this.#tab === t.key ? "active" : ""}" data-tab="${t.key}">
                <i class="fas ${t.icon}"></i> ${t.label}
            </button>`;
        const tabsHtml = `
            <div class="scwm-casier-tabgroup">${tl("Travail")}</div>
            ${workTabs.map(tabBtn).join("")}
            <div class="scwm-casier-tabgroup">${tl("Statistiques")}</div>
            ${statTabs.map(tabBtn).join("")}`;

        // Liste du livret (colonne gauche) — seulement pour l'onglet Rapports.
        let sideList = "";
        if (this.#tab === "reports") {
            sideList = drafts.length
                ? drafts.map(d => `
                    <div class="scwm-casier-page ${d.id === this.#selectedId ? "active" : ""}" data-draft-id="${esc(d.id)}">
                        <i class="fa-solid fa-scroll"></i>
                        <span class="scwm-casier-page-title">${tl("Rapport — {0}", esc(d.dateDisplay))}</span>
                    </div>`).join("")
                : `<div class="scwm-casier-empty">${tl("Aucun rapport en attente.")}</div>`;
        }

        let detail;
        if (this.#tab === "dashboard")      detail = this.#dashboardDetail(drafts);
        else if (this.#tab === "reports") {
            const draft = drafts.find(d => d.id === this.#selectedId);
            detail = draft ? this.#draftDetail(draft) : `<div class="scwm-casier-placeholder"><i class="fa-solid fa-book-open"></i><p>${tl("Sélectionnez un rapport à finaliser dans le livret.")}</p></div>`;
        }
        else if (this.#tab === "expeditions") detail = this.#expeditionsDetail();
        else if (this.#tab === "downtime")    detail = this.#downtimeDetail();
        else if (this.#tab === "registre")    detail = this.#registreDetail();
        else if (this.#tab === "stats")       detail = this.#statsDetail();
        else if (this.#tab === "dispos")      detail = this.#disposDetail();
        else if (this.#tab === "scenesize")   detail = this.#sceneSizeDetail();
        else if (this.#tab === "attendance")  detail = this.#attendanceDetail();
        else if (this.#tab === "validation")  detail = this.#validationDetail();
        else if (this.#tab === "monde")       detail = ongletMondeHtml(this.#mondeEtat);
        else                                  detail = this.#gmsDetail();

        return `
            <div class="scwm-casier-body">
                <aside class="scwm-casier-side">
                    <div class="scwm-casier-tabs">${tabsHtml}</div>
                    <div class="scwm-casier-pages">${sideList}</div>
                </aside>
                <section class="scwm-casier-content">${detail}${this.#resetZoneFor(this.#tab)}</section>
            </div>`;
    }

    // ---- Réinitialisation (maintenance) : un bouton par catégorie, affiché
    // sur sa page dédiée. Portée : TOUS les MJ (réglages monde). Double
    // confirmation (saisie du mot « RESET ») avant d'agir.
    #resetZoneFor(tab) {
        const zones = {
            reports: [
                { key: "sessionDrafts",       label: tl("Réinitialiser les rapports en attente") },
                { key: "sessionForumThreads", label: tl("Réinitialiser les fils Discord") },
            ],
            attendance: [
                { key: "sessionLog", label: tl("Réinitialiser le journal des sessions (présence, assiduité)") },
            ],
            expeditions: [
                { key: "expeditionRevealedZones", label: tl("Réinitialiser les zones révélées de la carte") },
            ],
        };
        const list = zones[tab];
        if (!list?.length) return "";
        const btn = (b) => `<button type="button" class="scwm-casier-reset" data-reset="${b.key}"`
            + ` style="background:rgba(192,57,43,0.12);border:1px solid rgba(192,57,43,0.5);color:#c0392b;`
            + `border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;">`
            + `<i class="fa-solid fa-trash-can"></i> ${esc(b.label)}</button>`;
        return `
            <div class="scwm-casier-reset-zone" style="margin-top:18px;padding-top:12px;border-top:1px solid rgba(192,57,43,0.35);">
                <div style="font-size:12px;opacity:.85;margin-bottom:6px;color:#c0392b;">
                    ${tl("<i class=\"fa-solid fa-triangle-exclamation\"></i> Réinitialisation — tous les MJ, irréversible")}
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">${list.map(btn).join("")}</div>
            </div>`;
    }

    #resetDefs() {
        return {
            sessionDrafts:           { label: tl("les rapports en attente"),        empty: [] },
            sessionForumThreads:     { label: tl("les fils Discord"),               empty: {} },
            sessionLog:              { label: tl("le journal des sessions (présence, assiduité)"), empty: [] },
            expeditionRevealedZones: { label: tl("les zones révélées de la carte"),  empty: {} },
        };
    }

    async #confirmReset(key) {
        const def = this.#resetDefs()[key];
        if (!def) return;
        const DV2 = foundry.applications.api.DialogV2;
        const content = `
            <p>${tl("Tu vas effacer <strong>{0}</strong> pour <strong>TOUS les MJ</strong>.", esc(def.label))}</p>
            <p style="color:#c0392b;margin:.3em 0;">${tl("<i class=\"fa-solid fa-triangle-exclamation\"></i> Action <strong>irréversible</strong>.")}</p>
            <p>${tl("Tape <strong>RESET</strong> ci-dessous pour confirmer :")}</p>
            <input type="text" class="scwm-reset-input" autocomplete="off" placeholder="RESET" style="width:100%;box-sizing:border-box;" />`;
        const ok = await DV2.wait({
            window: { title: tl("Réinitialiser — confirmation"), icon: "fa-solid fa-trash-can" },
            content,
            rejectClose: false,
            buttons: [
                { action: "cancel", label: tl("Annuler"), icon: "fa-solid fa-xmark", default: true },
                {
                    action: "reset", label: tl("Réinitialiser"), icon: "fa-solid fa-trash-can",
                    callback: (e, b, dlg) => ((dlg.element.querySelector(".scwm-reset-input")?.value || "").trim().toUpperCase() === "RESET")
                },
            ],
        }).catch(() => "cancel");
        if (ok !== true) {
            if (ok === false) ui.notifications?.warn(tl("Réinitialisation annulée : le mot « RESET » n'a pas été saisi correctement."));
            return;
        }
        try {
            await game.settings.set(MOD, key, Array.isArray(def.empty) ? [] : {});
            ui.notifications?.info(tl("Casier : {0} — réinitialisé.", def.label));
        } catch (err) {
            journal.erreur(tl("[WestMarch] Réinitialisation casier :"), err);
            ui.notifications?.error(tl("Échec de la réinitialisation (voir console)."));
        }
        this.render();
        refreshCasierBadge();
    }

    // ---- Onglet Dashboard ----
    #dashboardDetail(drafts) {
        const exps = gmExpeditions();
        return `
            <div class="scwm-casier-detail scwm-casier-dashboard">
                <h2>${tl("<i class=\"fa-solid fa-box-archive\"></i> Casier de {0}", esc(game.user.name))}</h2>
                <p class="scwm-casier-meta">${tl("Tableau de bord du meneur")}</p>

                <div class="scwm-casier-stats">
                    <div class="scwm-casier-stat"><b>${drafts.length}</b><span>${tl("Rapport(s) à finaliser")}</span></div>
                    <div class="scwm-casier-stat"><b>${exps.length}</b><span>${tl("Expédition(s) en cours")}</span></div>
                </div>

                <h3>${tl("Présentation")}</h3>
                <textarea class="scwm-casier-presentation" rows="8"
                    placeholder="${tl("Présentez-vous, vos critères, vos horaires… (visible ici, sauvegardé automatiquement)")}">${esc(getPresentation(game.user.id))}</textarea>
            </div>`;
    }

    // ---- Onglet Expéditions (du GM) ----
    #expeditionsDetail() {
        const exps = gmExpeditions();
        if (!exps.length) return `<div class="scwm-casier-placeholder"><i class="fa-solid fa-route"></i><p>${tl("Aucune expédition en cours.")}</p></div>`;
        return `
            <div class="scwm-casier-detail">
                <h2>${tl("Expéditions en cours")}</h2>
                ${exps.map(x => `
                    <div class="scwm-casier-exp-card ${x.current ? "current" : ""}">
                        <div class="scwm-casier-exp-head">
                            <i class="fa-solid fa-route"></i>
                            <span class="scwm-casier-exp-name">${esc(x.name)}</span>
                            ${x.current ? `<span class="scwm-casier-exp-badge">${tl("En session")}</span>` : ""}
                            <span class="scwm-casier-date">${esc(formatDate(x.startDate))}</span>
                            ${x.sessions != null ? `<span class="scwm-casier-date" style="opacity:.7;">${tl("· {0} session{1}", x.sessions, x.sessions > 1 ? "s" : "")}</span>` : ""}
                        </div>
                        ${x.participants.length ? `<div class="scwm-casier-exp-parts">${x.participants.map(p => esc(p.name)).join(", ")}</div>` : ""}
                    </div>`).join("")}
            </div>`;
    }

    // ---- Onglet Temps morts (panneau embarqué) ----
    #downtimeDetail() {
        return `
            <div class="scwm-casier-detail scwm-casier-downtime">
                <h2>${tl("<i class=\"fa-solid fa-hourglass-half\"></i> Temps morts")}</h2>
                <div class="scwm-tm-embed">${downtimeContentHtml(true)}</div>
                <div class="scwm-casier-actions" style="margin-top:10px;">
                    <button type="button" class="scwm-casier-apply-tm">${tl("<i class=\"fa-solid fa-coins\"></i> Appliquer les gains")}</button>
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
                    <strong>${esc(r.name || tl("Sans nom"))}</strong> — <em>${esc(r.userName)}</em>
                    ${r.concept ? `<br><small>${esc(r.concept)}</small>` : ""}
                </div>
                <div class="scwm-cv-row-actions">
                    <button type="button" class="scwm-cv-approve" data-user="${esc(r.userId)}">${tl("<i class=\"fa-solid fa-check\"></i> Créer &amp; assigner")}</button>
                    <button type="button" class="scwm-cv-reject" data-user="${esc(r.userId)}">${tl("<i class=\"fa-solid fa-times\"></i> Refuser")}</button>
                </div>
            </div>`).join("") : `<div class="scwm-casier-empty">${tl("Aucune demande de création.")}</div>`;

        const pendRows = pend.length ? pend.map(a => {
            // Dépliant des modifications de montée de niveau (si présentes).
            const changes = Array.isArray(a.changes) ? a.changes : [];
            const changesBlock = (a.kind === "levelup" && changes.length) ? `
                <details class="scwm-cv-changes" style="margin-top:6px;">
                    <summary style="cursor:pointer;opacity:.85;font-size:.9em;">${tl("<i class=\"fa-solid fa-list-check\"></i> Modifications de la fiche ({0})", changes.length)}</summary>
                    <ul style="margin:4px 0 0;padding-left:18px;font-size:.85em;opacity:.9;">${changes.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
                </details>` : "";
            return `
            <div class="scwm-casier-cv-row" data-cv-actor="${esc(a.id)}">
                <div class="scwm-cv-info">
                    <strong>${esc(a.name)}</strong> — <em>${esc(a.ownerName)}</em>
                    ${a.kind === "levelup"
                        ? `<span class="scwm-cv-tag scwm-cv-tag-levelup">${tl("<i class=\"fa-solid fa-arrow-up-1-9\"></i> Montée de niveau")}</span>`
                        : `<span class="scwm-cv-tag scwm-cv-tag-creation">${tl("<i class=\"fa-solid fa-user-plus\"></i> Création")}</span>`}
                    ${changesBlock}
                </div>
                <div class="scwm-cv-row-actions">
                    <button type="button" class="scwm-cv-openactor" data-actor="${esc(a.id)}" title="${tl("Ouvrir la fiche")}"><i class="fa-solid fa-user"></i></button>
                    <button type="button" class="scwm-cv-validate" data-actor="${esc(a.id)}">${tl("<i class=\"fa-solid fa-lock\"></i> Valider &amp; verrouiller")}</button>
                    <button type="button" class="scwm-cv-return" data-actor="${esc(a.id)}">${tl("<i class=\"fa-solid fa-rotate-left\"></i> Renvoyer")}</button>
                </div>
            </div>`; }).join("") : `<div class="scwm-casier-empty">${tl("Aucune fiche à valider.")}</div>`;

        return `
            <div class="scwm-casier-detail scwm-casier-validation">
                <h2>${tl("<i class=\"fa-solid fa-id-card\"></i> Validation des personnages")}</h2>
                <div class="scwm-casier-cv-section">
                    <h3>${tl("Demandes de création")}</h3>
                    ${reqRows}
                </div>
                <div class="scwm-casier-cv-section">
                    <h3>${tl("Fiches à valider")}</h3>
                    ${pendRows}
                </div>
            </div>`;
    }

    // ---- Onglet Suivi des GM ----
    #gmsDetail() {
        // Si un GM est sélectionné → on affiche uniquement SON dashboard.
        if (this.#viewGmId) return this.#gmDashboardDetail(this.#viewGmId);

        const gms = gmTracking();
        if (!gms.length) return `<div class="scwm-casier-placeholder"><i class="fa-solid fa-users-gear"></i><p>${tl("Aucun GM.")}</p></div>`;
        return `
            <div class="scwm-casier-detail">
                <h2>${tl("Suivi des GM")}</h2>
                ${gms.map(gm => `
                    <div class="scwm-casier-gm-card ${gm.count ? "active" : ""}">
                        <div class="scwm-casier-gm-head">
                            <i class="fa-solid fa-user-shield"></i>
                            <span class="scwm-casier-gm-name scwm-casier-gm-open" data-gm="${esc(gm.id)}" title="${tl("Voir le dashboard de {0}", esc(gm.name))}">${esc(gm.name)}</span>
                            <span class="scwm-casier-gm-badge">${tl("{0} expédition{1}", gm.count, gm.count > 1 ? "s" : "")}</span>
                        </div>
                        ${gm.exps.length
                            ? `<ul class="scwm-casier-gm-exps">${gm.exps.map(e => `
                                <li>
                                    <strong>${esc(e.name)}</strong>
                                    <span class="scwm-casier-date">(${esc(formatDate(e.startDate))})</span>
                                    ${e.sessions != null ? `<span class="scwm-casier-date" style="opacity:.7;">${tl("· {0} session{1}", e.sessions, e.sessions > 1 ? "s" : "")}</span>` : ""}
                                    <div class="scwm-casier-gm-parts">${e.participants.length ? e.participants.map(esc).join(", ") : tl("Aucun joueur")}</div>
                                </li>`).join("")}</ul>`
                            : `<div class="scwm-casier-gm-line" style="opacity:.6;">${tl("Aucune expédition en cours.")}</div>`}
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
        // Repli : si le JOURNAL DE SESSIONS (bouton « Clore la session ») est
        // vide pour un joueur/MJ, on utilise la date réelle de clôture des
        // EXPÉDITIONS auxquelles il a participé — sinon on afficherait « jamais »
        // alors qu'il a bien joué (les deux sources sont indépendantes).
        for (const e of list) {
            if (!e.endReal) continue;
            if (e.gmId) keepMax(sessGmLast, game.users.get(e.gmId)?.name ?? "MJ inconnu", e.endReal);
            for (const id of (e.participants ?? [])) {
                const a = game.actors.get(id);
                keepMax(sessPlayerLast, a ? playerOf(a) : "?", e.endReal);
            }
        }
        if (!list.length) {
            return `<div class="scwm-casier-placeholder"><i class="fa-solid fa-chart-column"></i>
                <p>${tl("Aucune expédition clôturée pour l'instant. L'assiduité se calcule sur les expéditions terminées.")}</p></div>`;
        }

        // Agrégats EXPÉDITIONS (par joueur / par MJ).
        const players = new Map();   // nom joueur -> count
        const gms     = new Map();   // nom MJ     -> { count, parts }
        for (const e of list) {
            const gmName = e.gmId ? (game.users.get(e.gmId)?.name ?? "MJ inconnu") : tl("— (sans MJ)");
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
                <td>${esc(e.name)}${ns != null ? ` <span style="opacity:.65;">${tl("({0} session{1})", ns, ns > 1 ? "s" : "")}</span>` : ""}</td>
                <td>${esc(formatDate(e.endDate))}</td>
                <td style="font-size:.85em;opacity:.8;">${esc(e.endReal ? new Date(e.endReal).toLocaleDateString(locale()) : "—")}</td>
                <td>${esc(e.gmId ? (game.users.get(e.gmId)?.name ?? "?") : "—")}</td>
                <td style="font-size:.85em;">${e.participants.map(id => esc(game.actors.get(id)?.name ?? "?")).join(", ") || "—"}</td>
            </tr>`;
        }).join("");

        const card = (n, l) => `<div style="flex:1;background:var(--scwm-panel,rgba(255,255,255,.05));border-radius:8px;padding:8px 10px;text-align:center;">
            <div style="font-size:1.5em;font-weight:700;">${n}</div><div style="font-size:.8em;opacity:.7;">${l}</div></div>`;

        return `
            <div class="scwm-casier-detail scwm-casier-attendance" style="overflow:auto;">
                <h2>${tl("<i class=\"fa-solid fa-chart-column\"></i> Assiduité")}</h2>
                <div style="display:flex;gap:10px;margin:0 0 14px;">
                    ${card(totalExp, tl("expéditions clôturées"))}
                    ${card(totalPlayers, tl("joueurs actifs (trimestre)"))}
                    ${card(totalGms, "MJ actifs (trimestre)")}
                </div>

                <div class="scwm-casier-cv-section">
                    <h3>${tl("Expéditions par joueur")} <span style="font-weight:400;font-size:.75em;opacity:.7;">${tl("(nombre · dernière session jouée)")}</span></h3>
                    ${barChart(playerRows, "#8fd19e")}
                </div>

                <div class="scwm-casier-cv-section">
                    <h3>${tl("Expéditions menées par MJ")} <span style="font-weight:400;font-size:.75em;opacity:.7;">${tl("(nombre · dernière session menée)")}</span></h3>
                    ${barChart(gmRows, "#c9a227")}
                    <div style="font-size:.8em;opacity:.7;margin-top:4px;">${gmRows.map(g => `${esc(g.label)} : ${g.parts} participation(s)`).join(" · ")}</div>
                </div>

                <div class="scwm-casier-cv-section">
                    <h3>${tl("Expéditions clôturées (récentes)")}</h3>
                    <table style="width:100%;border-collapse:collapse;font-size:.9em;">
                        <thead><tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,.15);">
                            <th style="padding:3px 4px;">${tl("Expédition")}</th><th style="padding:3px 4px;">${tl("Fin (IG)")}</th><th style="padding:3px 4px;">${tl("Clôturée (IRL)")}</th><th style="padding:3px 4px;">MJ</th><th style="padding:3px 4px;">${tl("Participants")}</th>
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
                : `<div class="scwm-casier-empty">${tl("Aucune présentation renseignée.")}</div>`);
        return `
            <div class="scwm-casier-detail scwm-casier-dashboard">
                <button type="button" class="scwm-casier-gm-back">${tl("<i class=\"fa-solid fa-arrow-left\"></i> Retour au suivi des GM")}</button>
                <h2>${tl("<i class=\"fa-solid fa-box-archive\"></i> Casier de {0}", esc(name))}</h2>
                <p class="scwm-casier-meta">${tl("Tableau de bord du meneur{0}", isSelf ? "" : " — lecture seule")}</p>

                <div class="scwm-casier-stats">
                    <div class="scwm-casier-stat"><b>${drafts.length}</b><span>${tl("Rapport(s) à finaliser")}</span></div>
                    <div class="scwm-casier-stat"><b>${exps.length}</b><span>${tl("Expédition(s) en cours")}</span></div>
                </div>

                <h3>${tl("Présentation")}</h3>
                ${presHtml}
            </div>`;
    }

    #draftDetail(d) {
        const players = (d.players ?? []).map(p => {
            let l = `<strong>${esc(p.name)}</strong> — XP ${p.xpBefore} → ${p.xpAfter}`;
            if (p.xpGained > 0) l += ` (+${p.xpGained})`;
            if (p.levelUp)      l += ` ${tl("⬆ <em>Niveau {0}</em>", p.levelAfter)}`;
            return `<li>${l}</li>`;
        }).join("") || "<li>—</li>";

        const enemies = (d.combatants ?? []).map(e => `<li>${esc(e.name)}${e.cr != null ? ` — CR ${esc(e.cr)}` : ""}</li>`).join("");
        const npcs    = (d.npcs ?? []).map(n => `<li>${esc(n.name)}</li>`).join("");
        const items   = (d.items ?? []).map(i => `<li><strong>${esc(i.playerName)}</strong> — ${esc(i.itemName)}</li>`).join("");

        return `
            <div class="scwm-casier-detail" data-draft-id="${esc(d.id)}">
                <h2>${tl("Rapport de session — {0}", esc(d.dateDisplay))}</h2>
                <p class="scwm-casier-meta">${tl("Meneur : {0}", esc(d.gmName))}</p>

                <h3>${tl("Joueurs")}</h3>
                <ul class="scwm-casier-players">${players}</ul>

                ${this.#tagEditorHtml(d)}

                ${this.#awardEditorHtml(d)}

                ${enemies ? `<h3>${tl("Ennemis rencontrés")}</h3><ul>${enemies}</ul>` : ""}
                ${npcs    ? `<h3>${tl("PNJ rencontrés")}</h3><ul>${npcs}</ul>` : ""}
                ${items   ? `<h3>${tl("Objets récupérés")}</h3><ul>${items}</ul>` : ""}

                <h3>${tl("Notes de session")}</h3>
                <textarea class="scwm-casier-notes" rows="7" placeholder="${tl("Rédigez ou complétez le compte-rendu…")}">${esc(d.notes ?? "")}</textarea>

                <div class="scwm-casier-actions">
                    <button type="button" class="scwm-casier-send">${tl("<i class=\"fa-solid fa-paper-plane\"></i> Clôturer &amp; envoyer sur Discord")}</button>
                    <button type="button" class="scwm-casier-delete">${tl("<i class=\"fa-solid fa-trash\"></i> Supprimer")}</button>
                </div>
            </div>`;
    }

    // Éditeur de l'attribution EN ATTENTE (appliquée seulement à l'envoi).
    #awardEditorHtml(d) {
        const aw = d.pendingAward;
        if (!aw) return "";
        if (aw.type === "stars") {
            const n = Math.max(1, Math.min(3, aw.n || 1));
            const stars = [1, 2, 3].map(i =>
                `<button type="button" class="scwm-casier-star" data-n="${i}"
                    style="background:none;border:none;cursor:pointer;font-size:24px;line-height:1;padding:0 2px;color:${i <= n ? "#e6be3c" : "#888"};">★</button>`
            ).join("");
            return `
                <h3>${tl("<i class=\"fa-solid fa-hourglass-half\"></i> Étoiles à attribuer (en attente d'envoi)")}</h3>
                <div class="scwm-casier-award" data-type="stars" style="display:flex;align-items:center;gap:6px;">
                    ${stars}<span class="scwm-casier-star-count" style="margin-left:8px;font-weight:600;">${tl("{0} étoile{1}", n, n > 1 ? "s" : "")}</span>
                </div>
                <p style="opacity:.7;font-size:.85em;margin:2px 0 0;">${tl("Attribuées à toute la party au moment de l'envoi du rapport.")}</p>`;
        }
        // XP : un champ par PJ.
        const ids = aw.actorIds ?? Object.keys(aw.perActor ?? {});
        const rows = ids.map(id => {
            const name = game.actors.get(id)?.name ?? id;
            const gain = aw.perActor?.[id] ?? 0;
            return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;">
                <label style="flex:1;">${esc(name)}</label>
                <input type="number" min="0" step="1" class="scwm-casier-xp" data-actor-id="${esc(id)}" value="${gain}" style="width:90px;">
            </div>`;
        }).join("") || "<p>—</p>";
        return `
            <h3>${tl("<i class=\"fa-solid fa-hourglass-half\"></i> XP à attribuer (en attente d'envoi)")}</h3>
            <div class="scwm-casier-award" data-type="xp">${rows}</div>
            <p style="opacity:.7;font-size:.85em;margin:2px 0 0;">${tl("Appliquée au moment de l'envoi du rapport.")}</p>`;
    }

    // Éditeur des intrigues (tags) d'un rapport — partagées (réglages) + perso MJ.
    #tagEditorHtml(d) {
        const world = (game.settings.get(MOD, "sessionTags") || []).filter(Boolean);
        const perso = (game.settings.get(MOD, "sessionTagsPersonal") || []).filter(Boolean);
        const sel = new Set(d.tags ?? []);
        // Tags posés sur le rapport mais absents des deux listes → restent visibles.
        const extra = (d.tags ?? []).filter(t => !world.includes(t) && !perso.includes(t));
        const chip = (t) => `
            <label class="scwm-casier-tagchip" style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid rgba(154,123,30,0.5);border-radius:12px;cursor:pointer;font-size:.9em;${sel.has(t) ? "background:rgba(154,123,30,0.18);" : ""}">
                <input type="checkbox" class="scwm-casier-tag" value="${esc(t)}" ${sel.has(t) ? "checked" : ""}> ${esc(t)}
            </label>`;
        const persoAll = [...perso, ...extra];
        return `<h3>${tl("<i class=\"fa-solid fa-puzzle-piece\"></i> Intrigues liées")}</h3>
            ${world.length ? `<div class="scwm-casier-tags" style="display:flex;flex-wrap:wrap;gap:6px;">${world.map(chip).join("")}</div>` : ""}
            <div style="font-size:.85em;opacity:.7;margin:6px 0 2px;">${tl("Mes intrigues (perso)")}</div>
            <div class="scwm-casier-tags scwm-casier-tags-perso" style="display:flex;flex-wrap:wrap;gap:6px;">${persoAll.map(chip).join("") || "<span style='opacity:.5;font-size:.85em;'>—</span>"}</div>
            <div style="display:flex;gap:4px;margin-top:6px;max-width:340px;">
                <input type="text" class="scwm-casier-newtag" placeholder="${tl("Nouvelle intrigue perso…")}" style="flex:1 1 auto;min-width:0;">
                <button type="button" class="scwm-casier-addtag" style="flex:0 0 auto;padding:2px 10px;border-radius:4px;cursor:pointer;border:1px solid rgba(201,162,39,0.4);background:rgba(201,162,39,0.12);color:#c9a227;">${tl("<i class=\"fa-solid fa-plus\"></i> Ajouter")}</button>
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
            const title = inactive ? tl("Joueur inactif — dernière session : {0}", realDateLabel(iso)) : "";
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
                <h2>${tl("<i class=\"fa-solid fa-address-book\"></i> Registre des personnages")}</h2>
                <div class="scwm-reg-toolbar">
                    <input type="text" class="scwm-reg-filter" placeholder="${tl("Filtrer (joueur, perso, classe, espèce)…")}">
                    <span class="scwm-reg-count">${rows.length} PJ</span>
                    <button type="button" class="scwm-reg-csv">${tl("<i class=\"fa-solid fa-file-csv\"></i> Export CSV")}</button>
                </div>
                <p class="scwm-reg-legend">${tl("<i class=\"fa-solid fa-moon\"></i> joueur inactif (aucune session depuis {0} j) · clic sur une ligne = ouvrir la fiche", ACTIVE_DAYS)}</p>
                <table class="scwm-reg-table">
                    <thead><tr>
                        <th class="scwm-reg-sort" data-col="0" data-type="txt">${tl("Joueur")}</th>
                        <th class="scwm-reg-sort" data-col="1" data-type="txt">${tl("Perso")}</th>
                        <th class="scwm-reg-sort" data-col="2" data-type="txt">${tl("Classe(s)")}</th>
                        <th class="scwm-reg-sort" data-col="3" data-type="txt">${tl("Espèce")}</th>
                        <th class="scwm-reg-sort" data-col="4" data-type="num">${tl("Niv")}</th>
                        <th>${tl("Multi")}</th>
                    </tr></thead>
                    <tbody>${body || `<tr><td colspan="6" style="opacity:.6;">${tl("Aucun PJ.")}</td></tr>`}</tbody>
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
            // ~10 lignes visibles au maximum, le reste défile.
            const scroll = entries.length > 10
                ? ' style="max-height:calc(10 * 2em);overflow-y:auto;"' : "";
            return `<div class="scwm-stat-block">
                <h3>${title}</h3>
                <div class="scwm-stat-scroll"${scroll}>
                    <table class="scwm-reg-table"><tbody>
                        ${entries.map(([k, v]) => `<tr><td>${esc(String(k))}</td><td style="text-align:right;">${v}</td></tr>`).join("")
                            || `<tr><td style="opacity:.6;">—</td></tr>`}
                    </tbody></table>
                </div>
            </div>`;
        };
        return `
            <div class="scwm-casier-detail">
                <h2>${tl("<i class=\"fa-solid fa-chart-pie\"></i> Statistiques")}</h2>
                <div class="scwm-casier-stats">
                    <div class="scwm-casier-stat"><b>${st.nbJoueurs}</b><span>${tl("Joueur(s)")}</span></div>
                    <div class="scwm-casier-stat"><b>${st.nbPerso}</b><span>${tl("Personnage(s)")}</span></div>
                    <div class="scwm-casier-stat"><b>${st.multiCount}</b><span>${tl("Multiclassé(s)")}</span></div>
                </div>
                <div class="scwm-stat-grid">
                    ${countTable(tl("Par classe"), st.byClass)}
                    ${countTable(tl("Par sous-classe"), st.bySub)}
                    ${countTable(tl("Par espèce"), st.byRace)}
                    ${countTable(tl("Par joueur"), st.byPlayer)}
                    ${countTable(tl("Distribution des niveaux"), st.byLevel, true)}
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
                title="${inactive ? esc(tl("Joueur inactif — dernière session : {0}", realDateLabel(iso))) : ""}">
                <td>${esc(r.joueur)}${inactive ? ' <i class="fa-solid fa-moon" title="Inactif ce trimestre"></i>' : ""}</td>
                <td>${esc(r.pjs.join(", ")) || "—"}</td>
                <td style="text-align:center;">${r.nb}</td>
                <td style="text-align:center;">${r.open || ""}</td>
                <td style="white-space:nowrap;">${esc(realDateLabel(iso))}</td>
            </tr>`;
        }).join("");
        return `
            <div class="scwm-casier-detail">
                <h2>${tl("<i class=\"fa-solid fa-user-check\"></i> Disponibilités des joueurs")}</h2>
                <p class="scwm-reg-legend">${tl("<i class=\"fa-solid fa-moon\"></i> joueur inactif (aucune session depuis {0} j)", ACTIVE_DAYS)}</p>
                <table class="scwm-reg-table">
                    <thead><tr>
                        <th>${tl("Joueur")}</th><th>${tl("PJ")}</th><th>${tl("Nb PJ")}</th><th>${tl("Expé. en cours")}</th><th>${tl("Dernière session")}</th>
                    </tr></thead>
                    <tbody>${body || `<tr><td colspan="5" style="opacity:.6;">${tl("Aucun joueur.")}</td></tr>`}</tbody>
                </table>
            </div>`;
    }

    // ---- Onglet Poids du monde ----
    #sceneSizeDetail() {
        return `
            <div class="scwm-casier-detail">
                <h2>${tl("<i class=\"fa-solid fa-hard-drive\"></i> Poids du monde")}</h2>
                <div class="scwm-reg-toolbar">
                    <span style="flex:1;font-size:.85em;color:#9a8b70;">
                        ${tl("Poids des documents (données) + de leurs médias (images, audio), tous types confondus :\n                        scènes, acteurs, objets, journaux, tables, cartes, playlists, macros. Le plus lourd d'abord.")}
                    </span>
                    <button type="button" class="scwm-scenesize-calc">${tl("<i class=\"fa-solid fa-rotate\"></i> Recalculer")}</button>
                </div>
                <div class="scwm-scenesize-out">
                    <p style="opacity:.7;">${tl("<i class=\"fa-solid fa-spinner fa-spin\"></i> Calcul en cours…")}</p>
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

        // ---- Onglet Monde : fiches PNJ / lieux / organisations ----
        if (this.#tab === "monde") cablerOngletMonde(root, () => this.render(), this.#mondeEtat);

        // ---- Onglet Poids des scènes : calcul asynchrone + remplissage ----
        if (this.#tab === "scenesize") {
            const out = root.querySelector(".scwm-scenesize-out");
            const run = async () => {
                if (out) out.innerHTML = `<p style="opacity:.7;">${tl("<i class=\"fa-solid fa-spinner fa-spin\"></i> Calcul en cours…")}</p>`;
                try {
                    const res = await measureWorld();
                    if (out) out.innerHTML = worldSizeTablesHtml(res);
                } catch (e) {
                    journal.avert(tl("[casier] poids du monde :"), e);
                    if (out) out.innerHTML = `<p style="color:#c0392b;">${tl("Échec du calcul.")}</p>`;
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
                const header = [tl("Joueur"), tl("Perso"), tl("Classe(s)"), tl("Espèce"), tl("Niveau total"), tl("Multiclasse")];
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

        // ---- Boutons de réinitialisation (maintenance, par page) ----
        root.querySelectorAll(".scwm-casier-reset").forEach(b => b.addEventListener("click", () => this.#confirmReset(b.dataset.reset)));

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

        // Édition des intrigues (tags) du rapport → brouillon + journal synchro.
        root.querySelectorAll(".scwm-casier-tag").forEach(cb => cb.addEventListener("change", async () => {
            const d = myDrafts().find(x => x.id === this.#selectedId);
            if (!d) return;
            const tags = [...root.querySelectorAll(".scwm-casier-tag:checked")].map(c => c.value);
            d.tags = tags;
            await saveSessionDraft(d);
            await setSessionLogTags(d.id, tags);
            // reflet visuel de la puce
            const chip = cb.closest(".scwm-casier-tagchip");
            if (chip) chip.style.background = cb.checked ? "rgba(154,123,30,0.18)" : "";
        }));

        // Créer une intrigue PERSO à la volée dans le Casier.
        const newTagInput = root.querySelector(".scwm-casier-newtag");
        const addPersoTag = async () => {
            const v = (newTagInput?.value || "").trim();
            if (!v) return;
            const d = myDrafts().find(x => x.id === this.#selectedId);
            if (!d) return;
            const perso = game.settings.get(MOD, "sessionTagsPersonal") || [];
            if (!perso.some(x => String(x).toLowerCase() === v.toLowerCase())) {
                try { await game.settings.set(MOD, "sessionTagsPersonal", [...perso, v]); } catch (e) {}
            }
            d.tags = [...new Set([...(d.tags ?? []), v])];
            await saveSessionDraft(d);
            await setSessionLogTags(d.id, d.tags);
            if (newTagInput) newTagInput.value = "";
            this.render();
        };
        root.querySelector(".scwm-casier-addtag")?.addEventListener("click", (e) => { e.preventDefault(); addPersoTag(); });
        newTagInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPersoTag(); } });

        // Édition de l'attribution en attente (étoiles ou XP).
        const awardBox = root.querySelector(".scwm-casier-award");
        if (awardBox?.dataset.type === "stars") {
            const paint = (n) => {
                awardBox.querySelectorAll(".scwm-casier-star").forEach(b => { b.style.color = Number(b.dataset.n) <= n ? "#e6be3c" : "#888"; });
                const c = awardBox.querySelector(".scwm-casier-star-count");
                if (c) c.textContent = tl("{0} étoile{1}", n, n > 1 ? "s" : "");
            };
            awardBox.querySelectorAll(".scwm-casier-star").forEach(b => b.addEventListener("click", async () => {
                const n = Math.max(1, Math.min(3, Number(b.dataset.n) || 1));
                const d = myDrafts().find(x => x.id === this.#selectedId);
                if (!d?.pendingAward) return;
                d.pendingAward.n = n;
                await saveSessionDraft(d);
                paint(n);
            }));
        } else if (awardBox?.dataset.type === "xp") {
            awardBox.querySelectorAll(".scwm-casier-xp").forEach(inp => inp.addEventListener("change", async () => {
                const d = myDrafts().find(x => x.id === this.#selectedId);
                if (!d?.pendingAward) return;
                d.pendingAward.perActor ??= {};
                const g = Math.max(0, Math.round(Number(inp.value) || 0));
                if (g) d.pendingAward.perActor[inp.dataset.actorId] = g;
                else delete d.pendingAward.perActor[inp.dataset.actorId];
                await saveSessionDraft(d);
            }));
        }

        root.querySelector(".scwm-casier-send")?.addEventListener("click", async () => {
            const d = myDrafts().find(x => x.id === this.#selectedId);
            if (!d) return;
            if (notes) d.notes = notes.value;
            const ok = await sendSessionReport(d);
            if (!ok) return;   // avertissement déjà émis (webhook manquant / échec)
            // Attribution différée : appliquée SEULEMENT maintenant, l'envoi ayant réussi.
            if (d.pendingAward) { try { await applyDeferredAward(d.pendingAward); } catch (e) { journal.avert(tl("[WestMarch] Attribution différée :"), e); } }
            await deleteSessionDraft(d.id);
            this.#selectedId = null;
            ui.notifications.info(d.pendingAward ? tl("Rapport envoyé et attribution appliquée.") : tl("Rapport de session envoyé sur Discord."));
            refreshCasierBadge();
            this.render();
        });

        root.querySelector(".scwm-casier-delete")?.addEventListener("click", async () => {
            const d = myDrafts().find(x => x.id === this.#selectedId);
            if (!d) return;
            const ok = await foundry.applications.api.DialogV2.confirm({
                window:  { title: tl("Supprimer le rapport") },
                content: `<p>${tl("Supprimer définitivement le brouillon <strong>Rapport — {0}</strong> ?", esc(d.dateDisplay))}</p>`
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
            <div style="font-size:.92em;opacity:.9;">${pres ? esc(pres).replace(/\n/g, "<br>") : `${tl("<em>Aucune présentation.</em>")}`}</div>
        </div>`;
    }).join("") || `<p>${tl("Aucun MJ.")}</p>`;
    foundry.applications.api.DialogV2.wait({
        window:   { title: tl("Présentations des MJ"), icon: "fa-solid fa-user-shield" },
        position: { width: 480 },
        content:  `<div style="max-height:60vh;overflow:auto;">${cards}</div>`,
        rejectClose: false,
        buttons: [{ action: "close", label: tl("Fermer"), icon: "fa-solid fa-xmark", default: true }]
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
            title:    tl("Casier de {0}", game.user.name),
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
            title:    tl("Présentations des MJ"),
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
                speaker: { alias: tl("Casier") },
                whisper: [game.user.id],
                content: `<div class="scwm-casier-alert">
                    <p>${tl("<i class=\"fa-solid fa-box-archive\"></i> Vous avez <strong>{0}</strong> rapport(s) de session en attente de finalisation.", n)}</p>
                    <button type="button" class="scwm-casier-open">${tl("<i class=\"fa-solid fa-up-right-from-square\"></i> Ouvrir le Casier")}</button>
                </div>`
            });
        }, 1500);
    });
}
