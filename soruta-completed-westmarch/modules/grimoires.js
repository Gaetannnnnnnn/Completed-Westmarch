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
import { commonFolderPJ } from "./settings.js";
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

// Catégorie d'affichage d'un objet, par type dnd5e.
function categorie(type) {
    if (type === "spell") return "spell";
    if (type === "weapon") return "weapon";
    if (type === "equipment") return "equipment";
    return "autre";
}

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

// Supprime, sur tous les PJ du dossier, les SORTS appartenant aux extensions
// données. Confirmation + mot de passe admin avant d'agir. Renvoie
// { total, pcs } en cas de succès, sinon null.
export async function supprimerSortsParExtension(livres) {
    if (!game.user.isGM) { ui.notifications?.warn(tl("Réservé au MJ.")); return null; }
    const set = new Set((livres ?? []).filter(Boolean));
    if (!set.size) { ui.notifications?.warn(tl("Aucune extension cochée.")); return null; }

    const cibles = [];
    let total = 0;
    for (const a of pjsDuDossier()) {
        const ids = a.items.filter(i => i.type === "spell" && set.has(livreDeItem(i))).map(i => i.id);
        if (ids.length) { total += ids.length; cibles.push({ actor: a, ids }); }
    }
    if (!total) { ui.notifications?.info(tl("Aucun sort à supprimer pour ces extensions.")); return null; }

    const liste = [...set].join(", ");
    const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: tl("Supprimer des sorts par extension"), icon: "fa-solid fa-trash" },
        content: `<p>${tl("Supprimer <b>{0}</b> sort(s) des extensions <b>{1}</b> sur <b>{2}</b> personnage(s) ?", total, liste, cibles.length)}</p>
            <p style="opacity:.8;margin:6px 0 0;"><i class="fa-solid fa-triangle-exclamation"></i> ${tl("Action irréversible — une sauvegarde du monde est conseillée avant.")}</p>`,
        rejectClose: false
    }).catch(() => false);
    if (!ok) return null;

    if (!(await verifierAdmin(tl("Supprimer des sorts par extension")))) return null;

    for (const { actor, ids } of cibles) {
        try { await actor.deleteEmbeddedDocuments("Item", ids, { render: false }); }
        catch (e) { journal.erreur(tl("[{0}] Suppression sorts ({1}) :", MOD, actor.name), e); }
    }
    journal.info(tl("[{0}] {1} sort(s) supprimé(s) par extension ({2}) sur {3} PJ — par {4}.", MOD, total, liste, cibles.length, game.user.name));
    ui.notifications?.info(tl("{0} sort(s) supprimé(s).", total));
    return { total, pcs: cibles.length };
}
