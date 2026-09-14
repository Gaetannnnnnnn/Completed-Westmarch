// ============================================================
// notelink.js — Carnet commun (notes liées entre joueurs)
//
// Le MJ « lie » les notes des joueurs présents dans sa party : le module crée
// un JOURNAL PARTAGÉ (« carnet commun »), dont tous les membres liés sont
// propriétaires — ils l'éditent donc nativement, sans aller-retour MJ.
// Le groupe est mémorisé dans un réglage (indépendant de la party) : il SURVIT
// à la dissolution de la party. Un joueur n'appartient qu'à un seul groupe.
// Délier = retirer l'accès des membres ; le journal (les notes) persiste.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { getExpeditions } from "./carnet.js";

const enabled = () => game.settings.get(MOD, "enableNoteLink");
const OWN = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;

function getGroups() { const g = game.settings.get(MOD, "noteLinkGroups"); return Array.isArray(g) ? g : []; }
async function setGroups(g) { await game.settings.set(MOD, "noteLinkGroups", g); }

// Le groupe est lié aux PJ (acteurs). L'accès au JOURNAL, lui, est donné aux
// utilisateurs propriétaires de ces PJ (l'ownership Foundry est par utilisateur).
export function noteGroupOfActor(actorId) {
    return getGroups().find(gr => Array.isArray(gr.members) && gr.members.includes(actorId)) ?? null;
}
// Le carnet commun du PJ ASSIGNÉ de l'utilisateur (ou null).
export function noteGroupOfUser(userId) {
    const a = game.users.get(userId)?.character;
    return a ? noteGroupOfActor(a.id) : null;
}

// PJ (assignés) des joueurs présents dans la party du MJ courant.
function partyActors() {
    const map = new Map();
    for (const u of (game.users ?? [])) {
        if (u.isGM || u.getFlag(MOD, "partyId") !== game.user.id) continue;
        const a = u.character;
        if (a) map.set(a.id, a);
    }
    return [...map.values()];
}
// Utilisateurs (non-MJ) propriétaires d'un PJ.
function ownerUserIds(actor) {
    return (game.users ?? []).filter(u => !u.isGM && actor.testUserPermission?.(u, "OWNER")).map(u => u.id);
}

// Retire des PJ de leurs groupes + révoque l'accès au journal de leurs propriétaires.
async function detachActors(actorIds) {
    const groups = getGroups();
    for (const gr of groups) {
        const removed = gr.members.filter(id => actorIds.includes(id));
        if (!removed.length) continue;
        gr.members = gr.members.filter(id => !actorIds.includes(id));
        const j = game.journal.get(gr.journalId);
        if (j) {
            const own = foundry.utils.deepClone(j.ownership ?? {});
            const uids = new Set();
            for (const aid of removed) { const a = game.actors.get(aid); if (a) ownerUserIds(a).forEach(u => uids.add(u)); }
            for (const uid of uids) if (uid in own) own[uid] = OWN().NONE;
            try { await j.update({ ownership: own }); } catch (e) { console.warn(`[${MOD}] révocation accès carnet :`, e); }
        }
    }
    await setGroups(groups.filter(gr => gr.members.length > 0));
}

// Nom de l'expédition EN COURS menée par ce MJ pour ces PJ (ou null).
function currentExpeditionName(actors) {
    for (const a of actors) {
        for (const e of (getExpeditions(a) ?? [])) {
            if (e.startDate && !e.endDate && e.gmId === game.user.id) return e.name || null;
        }
    }
    return null;
}

// Dossier « Carnet commun » (Journaux), créé au besoin, couleur dédiée.
const COMMON_FOLDER_COLOR = "#c803e2";
async function commonNoteFolder() {
    let f = game.folders?.find(x => x.type === "JournalEntry" && x.name === "Carnet commun" && !x.folder);
    if (!f) {
        try { f = await Folder.create({ name: "Carnet commun", type: "JournalEntry", color: COMMON_FOLDER_COLOR }); } catch (e) { return null; }
    } else if (f.color !== COMMON_FOLDER_COLOR) {
        try { await f.update({ color: COMMON_FOLDER_COLOR }); } catch (e) {}
    }
    return f;
}

// MJ : lie les notes (PJ) des joueurs de la party → crée un carnet commun.
async function linkParty() {
    if (!game.user.isGM || !enabled()) return;
    const actors = partyActors();
    if (actors.length < 1) { ui.notifications?.warn("Aucun PJ de joueur dans votre party à lier."); return; }
    const actorIds = actors.map(a => a.id);

    // Un seul groupe par PJ : on détache d'abord ces PJ de leurs groupes.
    await detachActors(actorIds);

    // Accès donné aux UTILISATEURS propriétaires de ces PJ.
    const ownership = { default: OWN().NONE };
    const userIds = new Set();
    for (const a of actors) ownerUserIds(a).forEach(u => userIds.add(u));
    for (const uid of userIds) ownership[uid] = OWN().OWNER;

    // Nom du carnet = expédition en cours, sinon les noms des PJ en repli.
    const expName = currentExpeditionName(actors);
    const title = expName ? `Carnet commun — ${expName}` : `Carnet commun — ${actors.map(a => a.name).join(", ")}`;
    const folder = await commonNoteFolder();
    let journal;
    try {
        journal = await JournalEntry.create({
            name: title,
            folder: folder?.id ?? null,
            ownership,
            pages: [{ name: "Notes", type: "text", text: { content: "<p></p>", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }],
            flags: { [MOD]: { noteLinkGroup: true } }
        });
    } catch (e) { console.warn(`[${MOD}] création carnet commun :`, e); ui.notifications?.error("Échec de la création du carnet commun."); return; }

    const groups = getGroups();
    groups.push({ id: foundry.utils.randomID(), journalId: journal.id, members: actorIds });
    await setGroups(groups);

    ChatMessage.create({
        whisper: [...userIds], speaker: { alias: "Carnet commun" },
        content: `📓 Vos notes sont liées : un <strong>carnet commun</strong> a été créé pour votre groupe. Ouvrez-le depuis vos Journaux (dossier « Carnet commun ») ou le bouton « Carnet commun » de l'onglet WestMarch.`
    });
    ui.notifications?.info(`Carnet commun créé pour ${actors.length} PJ.`);
}

// Ouvre le carnet commun du joueur courant.
function openMyCommonNote() {
    const gr = noteGroupOfUser(game.user.id);
    const j = gr ? game.journal.get(gr.journalId) : null;
    if (!j) { ui.notifications?.info("Vous n'êtes lié à aucun carnet commun."); return; }
    j.sheet.render(true);
}

// MJ : gérer / délier les carnets communs.
async function openManageGroups() {
    if (!game.user.isGM) return;
    const DialogV2 = foundry.applications.api.DialogV2;
    const rows = () => {
        const groups = getGroups();
        if (!groups.length) return `<p style="opacity:.7;">Aucun carnet commun.</p>`;
        return groups.map(gr => {
            const names = gr.members.map(id => game.actors.get(id)?.name ?? "?").join(", ");
            return `<div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.1);padding:5px 0;">
                <span style="flex:1;">${names || "(vide)"}</span>
                <button type="button" class="nl-open" data-j="${gr.journalId}"><i class="fa-solid fa-book-open"></i></button>
                <button type="button" class="nl-dissolve" data-id="${gr.id}" style="color:#e58f8f;"><i class="fa-solid fa-link-slash"></i> Délier</button>
            </div>`;
        }).join("");
    };
    const wire = (root) => {
        if (!root) return;
        root.querySelector?.(".nl-link")?.addEventListener("click", async () => {
            await linkParty();
            const list = root.querySelector(".nl-list");
            if (list) { list.innerHTML = rows(); wire(root); }
        });
        root.querySelectorAll?.(".nl-open").forEach(b => b.addEventListener("click", () => game.journal.get(b.dataset.j)?.sheet.render(true)));
        root.querySelectorAll?.(".nl-dissolve").forEach(b => b.addEventListener("click", async () => {
            const gr = getGroups().find(g => g.id === b.dataset.id);
            if (!gr) return;
            await detachActors([...gr.members]);
            const list = root.querySelector(".nl-list");
            if (list) { list.innerHTML = rows(); wire(root); }
            ui.notifications?.info("Groupe délié (le carnet est conservé).");
        }));
    };
    await DialogV2.wait({
        window: { title: "Carnets communs", icon: "fa-solid fa-users-rectangle" },
        position: { width: 480 },
        content: `
            <div style="margin:0 0 8px;">
                <button type="button" class="nl-link" style="width:100%;"><i class="fa-solid fa-link"></i> Lier la party actuelle</button>
                <p style="font-size:.78em;opacity:.7;margin:4px 2px 0;">Crée un carnet commun pour les joueurs présents dans ta party. Ceux déjà liés ailleurs rejoignent ce nouveau groupe.</p>
            </div>
            <hr>
            <div class="nl-list">${rows()}</div>
            <p style="font-size:.78em;opacity:.7;margin-top:8px;">« Délier » retire l'accès des joueurs ; le carnet (les notes) reste conservé dans les Journaux.</p>`,
        rejectClose: false,
        render: (ev, dlg) => wire(dlg?.element ?? ev?.target?.closest?.(".application") ?? document),
        buttons: [{ action: "close", label: "Fermer", icon: "fa-solid fa-xmark", default: true }]
    }).catch(() => {});
}

export function NoteLinkHooks() {
    if (!enabled()) return;

    Hooks.on("getSceneControlButtons", (controls) => {
        if (!controls.westmarch) {
            controls.westmarch = { name: "westmarch", title: "WestMarch", icon: "fa-solid fa-hammer", layer: "tokens", tools: {} };
        }
        if (game.user.isGM) {
            controls.westmarch.tools.scwmNoteLink = {
                name: "scwmNoteLink", title: "Carnets communs (lier / délier / gérer)", icon: "fa-solid fa-users-rectangle",
                button: true, visible: true, onChange: () => openManageGroups()
            };
        } else {
            controls.westmarch.tools.scwmCommonNote = {
                name: "scwmCommonNote", title: "Ouvrir mon carnet commun", icon: "fa-solid fa-book-open",
                button: true, visible: !!noteGroupOfUser(game.user.id), onChange: () => openMyCommonNote()
            };
        }
    });
}
