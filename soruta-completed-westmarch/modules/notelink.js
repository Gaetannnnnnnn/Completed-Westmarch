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

const enabled = () => game.settings.get(MOD, "enableNoteLink");
const OWN = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;

function getGroups() { const g = game.settings.get(MOD, "noteLinkGroups"); return Array.isArray(g) ? g : []; }
async function setGroups(g) { await game.settings.set(MOD, "noteLinkGroups", g); }

// Groupe de carnet commun d'un joueur (ou null).
export function noteGroupOfUser(userId) {
    return getGroups().find(gr => Array.isArray(gr.members) && gr.members.includes(userId)) ?? null;
}

// Joueurs (non-MJ) actuellement dans la party du MJ courant.
function partyMembers() {
    return (game.users ?? []).filter(u => !u.isGM && u.getFlag(MOD, "partyId") === game.user.id);
}

// Retire des membres de leurs groupes existants + révoque leur accès au journal.
async function detachMembers(memberIds) {
    const groups = getGroups();
    for (const gr of groups) {
        const kept = gr.members.filter(id => !memberIds.includes(id));
        if (kept.length === gr.members.length) continue;
        gr.members = kept;
        const j = game.journal.get(gr.journalId);
        if (j) {
            const own = foundry.utils.deepClone(j.ownership ?? {});
            for (const id of memberIds) if (id in own) own[id] = OWN().NONE;
            try { await j.update({ ownership: own }); } catch (e) { console.warn(`[${MOD}] révocation accès carnet :`, e); }
        }
    }
    // On garde les groupes vides hors liste (le journal, lui, reste).
    await setGroups(groups.filter(gr => gr.members.length > 0));
}

// MJ : lie les notes des joueurs de la party → crée un carnet commun.
async function linkParty() {
    if (!game.user.isGM || !enabled()) return;
    const members = partyMembers();
    if (members.length < 1) { ui.notifications?.warn("Aucun joueur dans votre party à lier."); return; }
    const memberIds = members.map(u => u.id);

    // Un seul groupe par joueur : on détache d'abord ces membres de leurs groupes.
    await detachMembers(memberIds);

    const ownership = { default: OWN().NONE };
    for (const id of memberIds) ownership[id] = OWN().OWNER;
    const names = members.map(u => u.name).join(", ");
    let journal;
    try {
        journal = await JournalEntry.create({
            name: `Carnet commun — ${names}`,
            ownership,
            pages: [{ name: "Notes", type: "text", text: { content: "<p></p>", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }],
            flags: { [MOD]: { noteLinkGroup: true } }
        });
    } catch (e) { console.warn(`[${MOD}] création carnet commun :`, e); ui.notifications?.error("Échec de la création du carnet commun."); return; }

    const groups = getGroups();
    groups.push({ id: foundry.utils.randomID(), journalId: journal.id, members: memberIds });
    await setGroups(groups);

    ChatMessage.create({
        whisper: memberIds, speaker: { alias: "Carnet commun" },
        content: `📓 Vos notes sont liées : un <strong>carnet commun</strong> a été créé pour votre groupe. Ouvrez-le depuis vos Journaux ou le bouton « Carnet commun » de l'onglet WestMarch.`
    });
    ui.notifications?.info(`Carnet commun créé pour ${members.length} joueur(s).`);
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
            const names = gr.members.map(id => game.users.get(id)?.name ?? "?").join(", ");
            return `<div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.1);padding:5px 0;">
                <span style="flex:1;">${names || "(vide)"}</span>
                <button type="button" class="nl-open" data-j="${gr.journalId}"><i class="fa-solid fa-book-open"></i></button>
                <button type="button" class="nl-dissolve" data-id="${gr.id}" style="color:#e58f8f;"><i class="fa-solid fa-link-slash"></i> Délier</button>
            </div>`;
        }).join("");
    };
    await DialogV2.wait({
        window: { title: "Carnets communs", icon: "fa-solid fa-users-rectangle" },
        position: { width: 460 },
        content: `<div class="nl-list">${rows()}</div><p style="font-size:.8em;opacity:.7;margin-top:8px;">« Délier » retire l'accès des joueurs ; le carnet (les notes) reste conservé dans les Journaux.</p>`,
        rejectClose: false,
        render: (ev, dlg) => {
            const root = dlg?.element ?? ev?.target?.closest?.(".application") ?? document;
            root.querySelectorAll?.(".nl-open").forEach(b => b.addEventListener("click", () => game.journal.get(b.dataset.j)?.sheet.render(true)));
            root.querySelectorAll?.(".nl-dissolve").forEach(b => b.addEventListener("click", async () => {
                const gr = getGroups().find(g => g.id === b.dataset.id);
                if (!gr) return;
                await detachMembers([...gr.members]);
                b.closest("div")?.remove();
                ui.notifications?.info("Groupe délié (le carnet est conservé).");
            }));
        },
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
                name: "scwmNoteLink", title: "Lier les notes de la party (carnet commun)", icon: "fa-solid fa-link",
                button: true, visible: true, onChange: () => linkParty()
            };
            controls.westmarch.tools.scwmNoteLinkManage = {
                name: "scwmNoteLinkManage", title: "Gérer / délier les carnets communs", icon: "fa-solid fa-users-rectangle",
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
