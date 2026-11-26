// ============================================================
// grimoires.js — Casier : onglet « Extensions »
//
// Recense, pour les personnages du dossier joueurs (réglage commonFolderPJ),
// le contenu par LIVRE SOURCE (« extension » : XPHB, XGE, TCE…) : sorts,
// armes, équipement, autres. Sert de base à l'onglet « Extensions » du
// Casier (casier.js).
//
// Phase 1 (ici) : consultation + suppression des sorts de certaines
// extensions (action protégée par le mot de passe admin du module).
// Phase 2 (à venir) : ajout des sorts d'une extension aux classes à liste
// complète, et repérage des lanceurs « à choix » (magicien…) sous leur
// quota de sorts.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { tl } from "./i18n.js";
import { journal } from "./log.js";
import { commonFolderPJ, commonPackCreatures } from "./settings.js";
import { verifierAdmin } from "./adminpass.js";

export const extensionsActif = () => {
    try { return !!game.settings.get(MOD, "enableCasierExtensions"); } catch { return false; }
};

// Livre source d'un objet (sort, arme, équipement…). On lit system.source
// (objet {book, custom} en dnd5e 6.x, ou chaîne sur d'anciennes données).
export function livreDeItem(i) {
    const s = i?.system?.source;
    const b = (s && typeof s === "object") ? (s.book || s.custom || "") : (s || "");
    return (String(b).trim()) || "(vide)";
}

// Éléments de STRUCTURE du personnage : jamais comptés ni supprimés (les
// effacer retirerait la classe / l'espèce / l'historique et casserait la fiche).
const TYPES_PROTEGES = new Set(["class", "subclass", "background", "race"]);

// Catégorie d'affichage d'un objet, par type dnd5e. null = protégé (ignoré).
function categorie(type) {
    if (TYPES_PROTEGES.has(type)) return null;
    if (type === "spell") return "spell";
    if (type === "weapon") return "weapon";
    if (type === "equipment") return "equipment";
    return "autre";
}

// Libellés FR des types, pour le récapitulatif de suppression.
const LABEL_TYPE = {
    spell: "sorts", weapon: "armes", equipment: "équipements", consumable: "consommables",
    tool: "outils", loot: "objets divers", feat: "aptitudes", container: "contenants",
    backpack: "sacs", tattoo: "tatouages", facility: "installations"
};

// Ensemble des IDs de dossiers : le dossier joueurs + tous ses sous-dossiers.
function dossierEtDescendants(rootId) {
    const root = rootId ? game.folders?.get(rootId) : null;
    if (!root) return null;
    return new Set(game.folders
        .filter(f => f.type === "Actor" && (f.id === root.id || f.ancestors.some(a => a.id === root.id)))
        .map(f => f.id));
}

// Les PJ (type character) du dossier joueurs et de ses sous-dossiers.
function pjsDuDossier() {
    const ids = dossierEtDescendants(commonFolderPJ());
    if (!ids) return [];
    return game.actors.filter(a => a.type === "character" && ids.has(a.folder?.id));
}

// Nom du joueur propriétaire (hors MJ), pour l'affichage.
function joueurDe(actor) {
    const u = game.users?.find(u => !u.isGM && actor.testUserPermission?.(u, "OWNER"));
    return u?.name ?? "";
}

const vide = () => ({ spell: 0, weapon: 0, equipment: 0, autre: 0, total: 0 });

// Collecte complète pour l'onglet. Renvoie :
//   { ok, folderId, pcs: [{ id, name, img, player, perBook, tot }], books }
// où perBook / books sont des maps livre → { spell, weapon, equipment, autre, total }.
export function collectGrimoires() {
    const folderId = commonFolderPJ();
    if (!folderId || !game.folders?.get(folderId)) return { ok: false, folderId, pcs: [], books: {} };

    const books = {};
    const pcs = pjsDuDossier().map(a => {
        const perBook = {};
        const tot = vide();
        for (const i of a.items) {
            const c = categorie(i.type);
            if (!c) continue;   // structure (classe/espèce/historique) : ignorée
            const b = livreDeItem(i);
            (perBook[b] ??= vide());
            perBook[b][c]++; perBook[b].total++;
            tot[c]++; tot.total++;
            (books[b] ??= vide());
            books[b][c]++; books[b].total++;
        }
        return { id: a.id, name: a.name, img: a.img, player: joueurDe(a), perBook, tot };
    }).sort((x, y) => x.name.localeCompare(y.name, "fr", { sensitivity: "base" }));

    return { ok: true, folderId, pcs, books };
}

// Compte, pour un ensemble de livres, le nombre d'éléments par type (contenu
// seulement) sur les PJ du dossier. → { type: n }.
function compterParType(set) {
    const parType = {};
    for (const a of pjsDuDossier())
        for (const i of a.items)
            if (!!categorie(i.type) && set.has(livreDeItem(i)))
                parType[i.type] = (parType[i.type] ?? 0) + 1;
    return parType;
}

// Supprime le contenu des livres `set` dont le type ∈ typesSet, sur tous les
// PJ. Mot de passe admin avant d'agir. Renvoie { total, pcs } ou null.
async function supprimerContenu(set, typesSet, liste) {
    const cibles = [];
    const parType = {};
    let total = 0;
    for (const a of pjsDuDossier()) {
        const items = a.items.filter(i => typesSet.has(i.type) && !!categorie(i.type) && set.has(livreDeItem(i)));
        if (!items.length) continue;
        total += items.length;
        cibles.push({ actor: a, ids: items.map(i => i.id) });
        for (const i of items) parType[i.type] = (parType[i.type] ?? 0) + 1;
    }
    if (!total) { ui.notifications?.info(tl("Rien à supprimer pour cette sélection.")); return null; }

    if (!(await verifierAdmin(tl("Supprimer par extension")))) return null;

    for (const { actor, ids } of cibles) {
        try { await actor.deleteEmbeddedDocuments("Item", ids, { render: false }); }
        catch (e) { journal.erreur(tl("[{0}] Suppression par extension ({1}) :", MOD, actor.name), e); }
    }
    const detail = Object.entries(parType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${tl(LABEL_TYPE[t] ?? t)}`).join(", ");
    journal.info(tl("[{0}] {1} élément(s) supprimé(s) ({2}) des extensions ({3}) sur {4} PJ — par {5}.", MOD, total, detail, liste, cibles.length, game.user.name));
    ui.notifications?.info(tl("{0} élément(s) supprimé(s).", total));
    return { total, pcs: cibles.length };
}

// Ouvre la fenêtre de suppression : pour les extensions cochées, propose de
// supprimer par type (cases cochées) ou tout. Puis mot de passe admin.
export async function ouvrirSuppressionParExtension(livres) {
    if (!game.user.isGM) { ui.notifications?.warn(tl("Réservé au MJ.")); return null; }
    const set = new Set((livres ?? []).filter(Boolean));
    if (!set.size) { ui.notifications?.warn(tl("Coche au moins une extension.")); return null; }

    const compte = compterParType(set);
    const types = Object.entries(compte).sort((a, b) => b[1] - a[1]);
    const totalTous = types.reduce((s, [, n]) => s + n, 0);
    if (!totalTous) { ui.notifications?.info(tl("Rien à supprimer pour ces extensions.")); return null; }

    const liste = [...set].join(", ");
    const rows = types.map(([t, n]) => `
        <label class="scwm-del-type">
            <input type="checkbox" name="type" value="${t}">
            <span class="scwm-del-lab">${tl(LABEL_TYPE[t] ?? t)}</span>
            <span class="scwm-del-n">${n}</span>
        </label>`).join("");

    const content = `
        <div class="scwm-del-dialog">
            <p class="scwm-del-ext">${tl("Extensions :")} <b>${liste}</b></p>
            <label class="scwm-del-type scwm-del-all">
                <input type="checkbox" name="all" checked>
                <span class="scwm-del-lab"><b>${tl("Tout supprimer")}</b></span>
                <span class="scwm-del-n">${totalTous}</span>
            </label>
            <div class="scwm-del-types">${rows}</div>
            <p class="scwm-del-note"><i class="fa-solid fa-shield-halved"></i> ${tl("Classe, sous-classe, espèce et historique ne sont jamais supprimés.")}</p>
            <p class="scwm-del-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${tl("Action irréversible — sauvegarde du monde conseillée.")}</p>
        </div>`;

    const choix = await foundry.applications.api.DialogV2.wait({
        window: { title: tl("Supprimer par extension"), icon: "fa-solid fa-trash" },
        content,
        render: (ev, dialog) => {
            try {
                const root = dialog?.element ?? dialog;
                const all = root?.querySelector?.('input[name="all"]');
                const cases = [...(root?.querySelectorAll?.('input[name="type"]') ?? [])];
                if (!all || !cases.length) return;
                const sync = () => cases.forEach(c => { c.checked = all.checked; c.disabled = all.checked; });
                sync();
                all.addEventListener("change", sync);
            } catch (e) { /* non bloquant : les cases restent utilisables à la main */ }
        },
        buttons: [
            {
                action: "ok", label: tl("Supprimer"), icon: "fa-solid fa-trash", default: true,
                callback: (ev, btn) => {
                    const form = btn.form ?? btn.closest(".window-content");
                    const all = form.querySelector('input[name="all"]')?.checked;
                    const sel = [...form.querySelectorAll('input[name="type"]:checked')].map(c => c.value);
                    return { all, types: sel };
                }
            },
            { action: "cancel", label: tl("Annuler"), icon: "fa-solid fa-xmark" }
        ],
        rejectClose: false
    }).catch(() => null);

    if (!choix || typeof choix !== "object") return null;   // annulé / fermé
    const typesSet = choix.all ? new Set(Object.keys(compte)) : new Set(choix.types ?? []);
    if (!typesSet.size) { ui.notifications?.warn(tl("Coche au moins un type (ou « Tout »).")); return null; }
    return await supprimerContenu(set, typesSet, liste);
}

// Liste les extensions (livres sources) présentes dans le compendium des
// créatures, pour éviter les doublons à l'import. Lit l'INDEX du pack (léger,
// pas de chargement des fiches complètes). → { ok, packLabel, total, rows:[[livre,n]] }.
export async function extensionsCompendiumCreatures() {
    const packId = (commonPackCreatures() ?? "").trim();
    const pack = packId ? game.packs.get(packId) : null;
    if (!pack) return { ok: false };
    let index;
    try { index = await pack.getIndex({ fields: ["system.source"] }); }
    catch (e) { return { ok: false, erreur: true }; }
    const books = {};
    for (const e of index) {
        const s = e.system?.source;
        const b = (s && typeof s === "object") ? (s.book || s.custom || "") : (s || "");
        const key = String(b).trim() || "(sans livre)";
        books[key] = (books[key] ?? 0) + 1;
    }
    const rows = Object.entries(books).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr", { sensitivity: "base" }));
    return { ok: true, packLabel: pack.metadata?.label ?? packId, total: index.size ?? rows.reduce((s, [, n]) => s + n, 0), rows };
}

// Détail des éléments (contenu) d'un PJ pour un livre donné — pour le dépliage
// à deux niveaux (joueur → extension → éléments). → [{ cat, type, name, level }].
export function itemsDuLivre(actorId, book) {
    const a = game.actors?.get(actorId);
    if (!a) return [];
    const ordre = { spell: 0, weapon: 1, equipment: 2, autre: 3 };
    return a.items
        .filter(i => !!categorie(i.type) && livreDeItem(i) === book)
        .map(i => ({ cat: categorie(i.type), type: i.type, name: i.name, level: Number(i.system?.level) || 0 }))
        .sort((x, y) => (ordre[x.cat] - ordre[y.cat]) || (x.level - y.level) || x.name.localeCompare(y.name, "fr", { sensitivity: "base" }));
}

// ---------------------------------------------------------------- Phase 2a
// Magiciens sous leur quota de grimoire. Règle PHB : 6 sorts de niveau 1+ au
// niveau 1, puis +2 par niveau de magicien. On compte comme « grimoire » les
// sorts de niveau ≥ 1 en préparation « prepared » (mode du grimoire du
// magicien). Approximation pour un multiclassé (ses sorts d'une autre classe
// préparée gonflent le total) — signalé dans l'onglet.
function niveauDeClasse(actor, ident) {
    const c = actor.items.find(i => i.type === "class" && i.system?.identifier === ident);
    return c ? (Number(c.system?.levels) || 0) : 0;
}
export function analyseLanceurs() {
    const rows = [];
    for (const a of pjsDuDossier()) {
        const niv = niveauDeClasse(a, "wizard");
        if (!niv) continue;
        const quota = 6 + 2 * (niv - 1);
        // Grimoire = sorts de niveau ≥ 1 dont la liste de classes Plutonium
        // contient « Wizard » (isole le magicien, ignore les autres classes
        // d'un multiclassé, compte aussi les sorts non préparés).
        const connus = a.items.filter(i =>
            i.type === "spell" && (Number(i.system?.level) || 0) >= 1 && classesDuSort(i).includes("wizard")
        ).length;
        const multi = a.items.filter(i => i.type === "class").length > 1;
        rows.push({ id: a.id, name: a.name, img: a.img, niv, connus, quota, manque: Math.max(0, quota - connus), multi });
    }
    return rows.sort((x, y) => y.manque - x.manque || x.name.localeCompare(y.name, "fr", { sensitivity: "base" }));
}

// ---------------------------------------------------------------- Phase 2b
// Ajouter à une classe à liste complète tous les sorts d'une extension.
// Classes visées (préparent sur toute leur liste) : identifiant dnd5e → nom
// de classe tel que Plutonium l'écrit dans flags.plutonium.spellClassNames.
export const CLASSES_PLEINES = {
    cleric: "Cleric", druid: "Druid", paladin: "Paladin", artificer: "Artificer", ranger: "Ranger"
};
export const LABEL_CLASSE = {
    cleric: "Clerc", druid: "Druide", paladin: "Paladin", artificer: "Artificier", ranger: "Rôdeur"
};

// Clé unique d'un sort (livre + nom), via le hash Plutonium si présent.
function hashSort(i) {
    return i.flags?.plutonium?.hash || `${String(i.name || "").toLowerCase()}|${livreDeItem(i)}`;
}
// Classes d'un sort (minuscules), depuis les données Plutonium.
function classesDuSort(i) {
    const arr = i.flags?.plutonium?.spellClassNames;
    return Array.isArray(arr) ? arr.map(s => String(s).toLowerCase()) : [];
}
const sortPourClasse = (classesLower, cnLower) => classesLower.some(c => c === cnLower || c.startsWith(cnLower));

// Réservoir de documents de sorts : un exemplaire unique par sort, pris sur
// n'importe quel acteur du monde (Plutonium les a importés quelque part).
function poolSorts() {
    const pool = new Map();
    for (const a of (game.actors ?? [])) {
        for (const i of a.items) {
            if (i.type !== "spell") continue;
            const h = hashSort(i);
            if (pool.has(h)) continue;
            pool.set(h, { hash: h, data: i.toObject(), book: livreDeItem(i), classes: classesDuSort(i) });
        }
    }
    return pool;
}

const acteurAClasse = (a, ident) => a.items.some(i => i.type === "class" && i.system?.identifier === ident);

// Niveau de sort maximum qu'un acteur peut lancer (d'après ses emplacements).
// Les tours de magie (niveau 0) passent toujours.
function niveauMaxLancable(a) {
    const sp = a.system?.spells ?? {};
    let max = 0;
    for (let L = 1; L <= 9; L++) if (Number(sp["spell" + L]?.max) > 0) max = L;
    const pact = Number(sp.pact?.level) || 0;
    if (pact > max) max = pact;
    return max;
}

// Ajoute, sur chaque PJ du dossier ayant l'une des classes choisies, tous les
// sorts de cette classe issus du livre `book` qu'il n'a pas déjà.
// Confirmation (détail par classe) + mot de passe admin. Renvoie { total, pcs }.
export async function ajouterSortsAClasses(book, idents, { plafonner = false } = {}) {
    if (!game.user.isGM) { ui.notifications?.warn(tl("Réservé au MJ.")); return null; }
    const classes = (idents ?? []).filter(id => CLASSES_PLEINES[id]);
    if (!book) { ui.notifications?.warn(tl("Choisis une extension.")); return null; }
    if (!classes.length) { ui.notifications?.warn(tl("Coche au moins une classe.")); return null; }

    const pool = [...poolSorts().values()];
    const candParClasse = {};
    for (const id of classes) {
        const cn = CLASSES_PLEINES[id].toLowerCase();
        candParClasse[id] = pool.filter(e => e.book === book && sortPourClasse(e.classes, cn));
    }

    const plan = [];
    const parClasse = {};
    let total = 0;
    for (const a of pjsDuDossier()) {
        const existants = new Set(a.items.filter(i => i.type === "spell").map(hashSort));
        const cap = plafonner ? niveauMaxLancable(a) : Infinity;   // tours (niv. 0) toujours OK
        const aAjouter = new Map();
        const compte = {};
        for (const id of classes) {
            if (!acteurAClasse(a, id)) continue;
            for (const e of candParClasse[id]) {
                if (existants.has(e.hash) || aAjouter.has(e.hash)) continue;
                if ((Number(e.data.system?.level) || 0) > cap) continue;   // plafonné au niveau lançable
                const d = foundry.utils.deepClone(e.data);
                delete d._id;
                d.system = d.system || {};
                d.system.preparation = { mode: "prepared", prepared: (Number(d.system?.level) || 0) === 0 };
                aAjouter.set(e.hash, d);
                compte[id] = (compte[id] || 0) + 1;
            }
        }
        if (aAjouter.size) {
            plan.push({ actor: a, data: [...aAjouter.values()] });
            total += aAjouter.size;
            for (const id in compte) parClasse[id] = (parClasse[id] || 0) + compte[id];
        }
    }
    if (!total) { ui.notifications?.info(tl("Rien à ajouter : ces personnages ont déjà ces sorts (ou aucun sort de cette classe dans ce livre n'a été trouvé dans le monde).")); return null; }

    const detail = Object.entries(parClasse).sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${n} ${tl(LABEL_CLASSE[id])}`).join(", ");
    const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: tl("Ajouter des sorts à une classe"), icon: "fa-solid fa-wand-magic-sparkles" },
        content: `<p>${tl("Ajouter <b>{0}</b> sort(s) du livre <b>{1}</b> à <b>{2}</b> personnage(s) ?", total, book, plan.length)}</p>
            <p style="margin:4px 0 0;">${tl("Détail :")} ${detail}.</p>
            <p style="opacity:.75;margin:6px 0 0;font-size:.9em;">${tl("Les sorts sont ajoutés au grimoire/liste (non préparés ; les tours de magie restent préparés). Les doublons sont ignorés.")}</p>
            ${plafonner ? `<p style="opacity:.75;margin:3px 0 0;font-size:.9em;"><i class="fa-solid fa-arrows-down-to-line"></i> ${tl("Plafonné : seuls les sorts du niveau lançable par chaque personnage sont ajoutés.")}</p>` : ""}`,
        rejectClose: false
    }).catch(() => false);
    if (!ok) return null;

    if (!(await verifierAdmin(tl("Ajouter des sorts à une classe")))) return null;

    for (const { actor, data } of plan) {
        try { await actor.createEmbeddedDocuments("Item", data, { render: false }); }
        catch (e) { journal.erreur(tl("[{0}] Ajout de sorts ({1}) :", MOD, actor.name), e); }
    }
    journal.info(tl("[{0}] {1} sort(s) ajouté(s) (livre {2}) sur {3} PJ — par {4}.", MOD, total, book, plan.length, game.user.name));
    ui.notifications?.info(tl("{0} sort(s) ajouté(s).", total));
    return { total, pcs: plan.length };
}
