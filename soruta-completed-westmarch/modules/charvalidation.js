// ============================================================
// charvalidation.js — Validation des personnages (tickets)
//
// Flux :
//   1. Le joueur fait une DEMANDE DE CRÉATION (nom + concept). Stockée sur
//      son propre flag utilisateur (aucun GM requis en ligne pour l'émettre).
//   2. N'importe quel GM la valide depuis le Casier → un acteur est créé dans
//      le dossier dédié, dont le joueur devient Propriétaire. Il le construit
//      (y compris via ses imports Plutonium).
//   3. Le joueur SOUMET la fiche pour validation. Un GM la valide → la fiche
//      est VERROUILLÉE : les champs de CONSTRUCTION deviennent non modifiables
//      côté joueur, mais tout ce qui relève du JEU reste libre (tout ce que
//      surveille anticheat.js : préparation de sorts, attunement, équipé,
//      utilisations, emplacements — plus PV, monnaie, conditions, etc.).
//
// Le verrou est sélectif (hooks preUpdate/preCreate/preDelete) et non un
// changement d'ownership : le joueur garde OWNER pour pouvoir jouer.
// La respec / montée de niveau (déverrouillage via xp.js) est prévue pour
// une passe ultérieure.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { commonFolderNewChars, commonFolderPJ } from "./settings.js";

// ---- Frontière construction / jeu -------------------------------------------
// Chemins d'acteur relevant de la CONSTRUCTION (verrouillés).
const BLOCKED_ACTOR_PATHS = [
    "system.abilities", "system.skills", "system.tools", "system.traits", "system.bonuses"
];
// Types d'items de CONSTRUCTION (ajout/retrait verrouillé).
const BUILD_ITEM_TYPES = new Set(["class", "subclass", "background", "race", "feat", "spell"]);
// Sur un item de construction, sous-clés system qui restent du JEU (autorisées).
const ITEM_PLAY_KEYS = { feat: ["uses"], spell: ["preparation", "prepared"] };

const enabled = () => game.settings.get(MOD, "enableCharValidation");
const isLocked = (actor) => actor?.getFlag(MOD, "locked") === true;

// ============================================================
// DONNÉES / ÉTAT
// ============================================================
export function getCreationRequests() {
    return (game.users ?? [])
        .filter(u => !u.isGM && u.getFlag(MOD, "charRequest"))
        .map(u => ({ userId: u.id, userName: u.name, ...u.getFlag(MOD, "charRequest") }));
}
export function getPendingActors() {
    return (game.actors ?? [])
        .filter(a => a.type === "character" && a.getFlag(MOD, "pendingValidation") === true)
        .map(a => ({
            id: a.id,
            name: a.name,
            ownerName: game.users.get(a.getFlag(MOD, "createdFor"))?.name ?? "—",
            // Déjà validé une fois → c'est une montée de niveau / respec ; sinon création.
            kind: a.getFlag(MOD, "validated") === true ? "levelup" : "creation"
        }));
}
export function myCharActor() {
    return game.actors?.find(a => a.getFlag(MOD, "createdFor") === game.user.id) ?? null;
}

// ---- Stock / actifs -------------------------------------------------------
const maxTotal  = () => Number(game.settings.get(MOD, "charMaxTotal"))  || 0;   // 0 = illimité
const maxActive = () => Math.max(1, Number(game.settings.get(MOD, "charMaxActive")) || 2);
const isStock   = (a) => a?.getFlag?.(MOD, "stock") === true;

// Le PJ a-t-il atteint le seuil d'XP pour monter de niveau ? (XP dnd5e :
// value = XP actuelle, max = XP requise pour le niveau suivant.)
function canLevelUp(actor) {
    const xp = actor?.system?.details?.xp;
    if (!xp) return false;
    const value = Number(xp.value) || 0;
    const max   = Number(xp.max)   || 0;
    return max > 0 && value >= max;
}

// Personnages d'un utilisateur : ceux du circuit de validation (createdFor) ET
// ceux qu'il possède directement (Propriétaire), par ex. créés à la main par le
// MJ. Les persos en stock (Observateur) restent inclus via createdFor.
function actorsForUser(userId) {
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    return (game.actors ?? []).filter(a =>
        a.type === "character" &&
        (a.getFlag(MOD, "createdFor") === userId || a.ownership?.[userId] === L.OWNER));
}
function activeCountForUser(userId) {
    return actorsForUser(userId).filter(a => !isStock(a)).length;
}

// GM : (dés)active un personnage — bascule le flag « stock » et l'ownership du
// joueur (Propriétaire si actif, Observateur si en stock).
async function applyCharStock(actorId, stock) {
    if (!game.user.isGM) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const uid = actor.getFlag(MOD, "createdFor");
    if (!uid) return;
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    await actor.update({
        [`flags.${MOD}.stock`]: !!stock,
        [`ownership.${uid}`]: stock ? L.OBSERVER : L.OWNER
    });
}

// Joueur : passe par une requête au GM (changement d'ownership réservé au GM).
async function requestCharStock(actorId, stock) {
    if (game.user.isGM) { await applyCharStock(actorId, stock); return; }
    const gm = game.users.find(u => u.isGM && u.active);
    if (!gm) { ui.notifications?.warn("Aucun MJ en ligne pour (dés)activer ce personnage."); return; }
    try { await gm.query("westmarch.charStock", { actorId, stock }); }
    catch (e) { console.warn(`[${MOD}] charStock :`, e); }
}

async function ensureFolder() {
    const val = commonFolderNewChars();
    const looksLikeId = (s) => /^[A-Za-z0-9]{16}$/.test(s ?? "");
    if (val) {
        // Le sélecteur de dossier stocke un id ; on l'accepte en priorité.
        const byId = game.folders?.get(val);
        if (byId?.type === "Actor") return byId;
        // Sinon on traite la valeur comme un nom de dossier (saisie libre).
        if (!looksLikeId(val)) {
            const byName = game.folders?.find(f => f.type === "Actor" && f.name === val);
            if (byName) return byName;
        }
    }
    const name = (val && !looksLikeId(val)) ? val : "Personnages";
    let f = game.folders?.find(x => x.type === "Actor" && x.name === name);
    if (!f) f = await Folder.create({ name, type: "Actor" });
    return f;
}

// Sous-dossier au nom du joueur, à l'intérieur du dossier parent configuré.
async function ensurePlayerFolder(user) {
    const parent = await ensureFolder();
    const name = user?.name ?? "Joueur";
    let f = game.folders?.find(x =>
        x.type === "Actor" && x.name === name && (x.folder?.id ?? null) === (parent?.id ?? null));
    if (!f) f = await Folder.create({ name, type: "Actor", folder: parent?.id ?? null });
    return f;
}

// Résout le « Dossier des PJ » configuré (setting commonFolderPJ) : accepte un
// id de dossier (stocké par le sélecteur) ou un nom (saisie libre).
function resolvePJFolder() {
    const val = commonFolderPJ();
    if (!val) return null;
    const looksLikeId = (s) => /^[A-Za-z0-9]{16}$/.test(s ?? "");
    const byId = game.folders?.get(val);
    if (byId?.type === "Actor") return byId;
    if (!looksLikeId(val)) {
        const byName = game.folders?.find(f => f.type === "Actor" && f.name === val);
        if (byName) return byName;
    }
    return null;
}

// Crée (une seule fois) un sous-dossier au nom du joueur dans le Dossier des PJ.
// Exécuté côté GM uniquement (la création de dossier requiert des droits GM).
async function ensurePlayerPJFolder(user) {
    if (!game.user.isGM) return null;
    if (!game.settings.get(MOD, "autoPlayerFolder")) return null;
    if (!user || user.isGM) return null;
    const parent = resolvePJFolder();
    if (!parent) return null;                       // aucun Dossier des PJ configuré
    const name = user.name ?? "Joueur";
    let f = game.folders?.find(x =>
        x.type === "Actor" && x.name === name && (x.folder?.id ?? null) === (parent.id ?? null));
    if (!f) {
        f = await Folder.create({ name, type: "Actor", folder: parent.id });
        console.log(`[${MOD}] Sous-dossier PJ créé pour « ${name} ».`);
    }
    return f;
}

// Si l'acteur est rangé dans un sous-dossier « au nom d'un joueur » situé dans
// l'arbre du Dossier des PJ, retourne l'utilisateur correspondant (sinon null).
function findPlayerForActorFolder(actor) {
    const folder = actor?.folder;
    if (!folder) return null;
    const pj = resolvePJFolder();
    if (!pj) return null;
    // Le dossier de l'acteur doit appartenir à l'arbre du Dossier des PJ.
    let inTree = false;
    for (let cur = folder; cur; cur = cur.folder) { if (cur.id === pj.id) { inTree = true; break; } }
    if (!inTree) return null;
    // Le dossier immédiat doit porter le nom d'un joueur (non-GM).
    return (game.users ?? []).find(u => !u.isGM && u.name === folder.name) ?? null;
}

// ---- Actions GM (appelées depuis le Casier) ----
export async function approveCreation(userId) {
    if (!game.user.isGM) return;
    const user = game.users.get(userId);
    if (!user) return;
    const req = user.getFlag(MOD, "charRequest") ?? {};
    const folder = await ensurePlayerFolder(user);   // Joueurs / <nom du joueur>
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    // Si le joueur a déjà atteint sa limite de persos actifs, le nouveau est
    // créé « en stock » (Observateur) ; sinon actif (Propriétaire).
    const asStock = activeCountForUser(userId) >= maxActive();
    const actor = await Actor.create({
        name: req.name || `${user.name} — personnage`,
        type: "character",
        folder: folder.id,
        ownership: { default: L.NONE, [userId]: asStock ? L.OBSERVER : L.OWNER },
        flags: { [MOD]: { createdFor: userId, concept: req.concept || "", validated: false, locked: false, stock: asStock } }
    });
    await user.unsetFlag(MOD, "charRequest");
    ChatMessage.create({
        whisper: [userId],
        speaker: { alias: "Validation" },
        content: `✅ Votre demande de personnage est acceptée. La fiche <strong>${actor?.name}</strong> est dans vos acteurs — construisez-la (imports Plutonium compris) puis soumettez-la pour validation.`
    });
    ui.notifications?.info(`Personnage créé pour ${user.name}.`);
}
export async function rejectCreation(userId) {
    if (!game.user.isGM) return;
    const user = game.users.get(userId);
    if (!user) return;
    await user.unsetFlag(MOD, "charRequest");
    ChatMessage.create({ whisper: [userId], speaker: { alias: "Validation" }, content: "❌ Votre demande de personnage a été refusée. Rapprochez-vous du MJ." });
}
export async function validateActor(actorId) {
    if (!game.user.isGM) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    await actor.update({
        [`flags.${MOD}.locked`]: true,
        [`flags.${MOD}.validated`]: true,
        [`flags.${MOD}.pendingValidation`]: false,
        [`flags.${MOD}.pendingLevelUp`]: false,
        [`flags.${MOD}.levelUpGranted`]: false,
        [`flags.${MOD}.-=levelUpSnapshot`]: null   // nettoie l'instantané de level-up
    });
    const uid = actor.getFlag(MOD, "createdFor");
    if (uid) ChatMessage.create({ whisper: [uid], speaker: { alias: "Validation" }, content: `🔒 <strong>${actor.name}</strong> est validé et verrouillé. Vous pouvez jouer normalement ; les changements de construction passeront par le MJ.` });
    ui.notifications?.info(`${actor.name} validé et verrouillé.`);
}

// ---- Suivi des modifications de montée de niveau ----------------------------
// Instantané de la CONSTRUCTION d'une fiche, pour comparer avant/après level-up.
function buildSnapshot(actor) {
    const items = actor.items ?? [];
    const abilities = {}, skills = {};
    for (const [k, v] of Object.entries(actor.system?.abilities ?? {})) abilities[k] = v.value;
    for (const [k, v] of Object.entries(actor.system?.skills ?? {})) skills[k] = v.value;
    return {
        level: actor.system?.details?.level ?? null,
        hp: actor.system?.attributes?.hp?.max ?? null,
        classes: items.filter(i => i.type === "class").map(i => `${i.name} ${i.system?.levels ?? "?"}`),
        subclasses: items.filter(i => i.type === "subclass").map(i => i.name),
        feats: items.filter(i => i.type === "feat").map(i => i.name),
        spells: items.filter(i => i.type === "spell").map(i => i.name),
        abilities, skills
    };
}
const _abilLabel  = (k) => game.i18n?.localize(CONFIG.DND5E?.abilities?.[k]?.label ?? "") || k.toUpperCase();
const _skillLabel = (k) => game.i18n?.localize(CONFIG.DND5E?.skills?.[k]?.label ?? "") || k;

// Liste lisible des différences entre deux instantanés (before → after).
function buildDiff(b, a) {
    const out = [];
    if (b.level !== a.level) out.push(`Niveau : ${b.level} → ${a.level}`);
    if (b.hp !== a.hp) out.push(`PV max : ${b.hp} → ${a.hp}`);
    a.classes.filter(x => !b.classes.includes(x)).forEach(x => out.push(`Classe : ${x}`));
    a.subclasses.filter(x => !b.subclasses.includes(x)).forEach(x => out.push(`Sous-classe : ${x}`));
    for (const k of Object.keys(a.abilities)) {
        if ((b.abilities[k] ?? null) !== a.abilities[k]) out.push(`${_abilLabel(k)} : ${b.abilities[k]} → ${a.abilities[k]}`);
    }
    const nf = a.feats.filter(x => !b.feats.includes(x));
    if (nf.length) out.push(`Aptitudes ajoutées : ${nf.join(", ")}`);
    const rf = b.feats.filter(x => !a.feats.includes(x));
    if (rf.length) out.push(`Aptitudes retirées : ${rf.join(", ")}`);
    const ns = a.spells.filter(x => !b.spells.includes(x));
    if (ns.length) out.push(`Sorts ajoutés : ${ns.join(", ")}`);
    const sk = Object.keys(a.skills).filter(k => (b.skills[k] ?? 0) !== a.skills[k]).map(_skillLabel);
    if (sk.length) out.push(`Maîtrises modifiées : ${sk.join(", ")}`);
    return out;
}

// Poste au MJ la liste des modifications d'une montée de niveau.
function postLevelUpDiff(actor, changes) {
    const body = changes.length
        ? `<ul style="margin:4px 0 0;padding-left:18px;">${changes.map(c => `<li>${esc(c)}</li>`).join("")}</ul>`
        : "<em>Aucune modification de construction détectée.</em>";
    ChatMessage.create({
        whisper: gmIds(),
        speaker: { alias: "Montée de niveau" },
        content: `⬆️ <strong>${esc(actor.name)}</strong> — modifications apportées à la fiche :${body}`
    });
}

// Demandes de montée de niveau en attente (badge « Level up »).
export function getLevelUpRequests() {
    return (game.actors ?? [])
        .filter(a => a.type === "character" && a.getFlag(MOD, "pendingLevelUp") === true)
        .map(a => ({ id: a.id, name: a.name, ownerName: game.users.get(a.getFlag(MOD, "createdFor"))?.name ?? "—" }));
}

// GM : autorise une montée de niveau — déverrouille la fiche pour l'édition et
// signale à xp.js d'autoriser le changement de niveau (levelUpGranted). Le joueur
// re-soumet ensuite la fiche pour re-validation (qui re-verrouille).
export async function grantLevelUp(actorId) {
    if (!game.user.isGM) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    await actor.update({
        [`flags.${MOD}.levelUpGranted`]: true,
        [`flags.${MOD}.locked`]: false,
        [`flags.${MOD}.pendingLevelUp`]: false,
        // Instantané AVANT montée de niveau → sert à lister les modifications.
        [`flags.${MOD}.levelUpSnapshot`]: buildSnapshot(actor)
    });
    const uid = actor.getFlag(MOD, "createdFor");
    if (uid) ChatMessage.create({ whisper: [uid], speaker: { alias: "Validation" }, content: `⬆️ Montée de niveau autorisée pour <strong>${actor.name}</strong>. Effectuez-la (assistant / Plutonium), puis re-soumettez la fiche pour re-validation.` });
    ui.notifications?.info(`Montée de niveau autorisée pour ${actor.name}.`);
}
export async function returnActor(actorId) {
    if (!game.user.isGM) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    await actor.setFlag(MOD, "pendingValidation", false);
    const uid = actor.getFlag(MOD, "createdFor");
    if (uid) ChatMessage.create({ whisper: [uid], speaker: { alias: "Validation" }, content: `↩️ <strong>${actor.name}</strong> vous est renvoyé pour ajustements avant re-soumission.` });
}
export async function unlockActor(actorId) {
    if (!game.user.isGM) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    await actor.setFlag(MOD, "locked", false);
    const uid = actor.getFlag(MOD, "createdFor");
    if (uid) ChatMessage.create({ whisper: [uid], speaker: { alias: "Validation" }, content: `🔓 <strong>${actor.name}</strong> est déverrouillé : vous pouvez modifier sa construction, puis le re-soumettre.` });
}

// ============================================================
// UI JOUEUR — hub « Mon personnage »
// ============================================================
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

// Tous les personnages du joueur courant (créés par le MJ ou via demande).
export function myCharActors() {
    return actorsForUser(game.user.id);
}

// Sous-fenêtre : formulaire de demande d'un NOUVEAU personnage.
function promptNewCharRequest() {
    new Dialog({
        title: "Demander un nouveau personnage",
        content: `<div class="scwm-cv-hub">
            <div class="form-group"><label>Nom</label><input type="text" name="cv-name" placeholder="Nom du personnage"/></div>
            <div class="form-group"><label>Concept</label><textarea name="cv-concept" rows="3" placeholder="Classe visée, idée générale, historique…"></textarea></div>
        </div>`,
        buttons: {
            send: {
                icon: '<i class="fa-solid fa-paper-plane"></i>', label: "Envoyer la demande",
                callback: async (html) => {
                    const root = html[0] ?? html;
                    const name = root.querySelector("[name=cv-name]")?.value.trim();
                    if (!name) { ui.notifications?.warn("Indiquez un nom."); return; }
                    const concept = root.querySelector("[name=cv-concept]")?.value.trim() ?? "";
                    await game.user.setFlag(MOD, "charRequest", { name, concept, dateISO: new Date().toISOString() });
                    ChatMessage.create({ whisper: gmIds(), speaker: { alias: "Validation" }, content: `📝 <strong>${esc(game.user.name)}</strong> demande la création d'un personnage : « ${esc(name)} ».` });
                    ui.notifications?.info("Demande envoyée.");
                }
            },
            cancel: { icon: '<i class="fa-solid fa-times"></i>', label: "Annuler" }
        },
        default: "send"
    }).render(true);
}

export function openPlayerHub() {
    const req = game.user.getFlag(MOD, "charRequest");
    const actors = myCharActors();

    const nbActive = activeCountForUser(game.user.id);
    const limActive = maxActive();
    const limTotal = maxTotal();
    const atActiveLimit = nbActive >= limActive;
    const atTotalLimit = limTotal > 0 && actors.length >= limTotal;

    // Liste des personnages du joueur, avec statut et actions.
    const rows = actors.map(a => {
        const stock      = isStock(a);
        const locked     = a.getFlag(MOD, "locked");
        const pending    = a.getFlag(MOD, "pendingValidation");
        const lvlPending = a.getFlag(MOD, "pendingLevelUp");
        let status, btns = "";

        const inFlow    = a.getFlag(MOD, "createdFor") === game.user.id;
        const validated = a.getFlag(MOD, "validated");
        if (stock) {
            status = "🔒 en stock (non jouable)";
            const dis = atActiveLimit ? "disabled title=\"Limite de personnages actifs atteinte — mettez-en un en stock d'abord\"" : "";
            btns = `<button type="button" class="scwm-cv-act" data-act="activate" data-id="${a.id}" ${dis}><i class="fa-solid fa-lock-open"></i> Activer</button>`;
        } else {
            if (locked && lvlPending)      status = "verrouillé · ⬆️ montée en attente";
            else if (locked)             {
                status = "🔒 validé & verrouillé";
                // Bouton de montée de niveau uniquement si le PJ a atteint le seuil d'XP.
                if (canLevelUp(a)) btns = `<button type="button" class="scwm-cv-act" data-act="levelup" data-id="${a.id}"><i class="fa-solid fa-arrow-up-1-9"></i> Monter de niveau</button>`;
            }
            else if (pending)              status = "⏳ en attente de validation";
            else if (inFlow || validated) { status = "🛠️ en construction"; btns = `<button type="button" class="scwm-cv-act" data-act="submit" data-id="${a.id}"><i class="fa-solid fa-paper-plane"></i> Soumettre</button>`; }
            else                         { status = "🎭 jouable"; btns = `<button type="button" class="scwm-cv-act" data-act="submit" data-id="${a.id}" title="Soumettre pour validation & verrouillage"><i class="fa-solid fa-paper-plane"></i> Soumettre</button>`; }
            btns += `<button type="button" class="scwm-cv-act" data-act="stock" data-id="${a.id}" title="Mettre en stock"><i class="fa-solid fa-box-archive"></i></button>`;
        }

        return `<div class="scwm-cv-charrow${stock ? " scwm-cv-stocked" : ""}">
            <div class="scwm-cv-charinfo"><strong>${esc(a.name)}</strong><br><span class="scwm-cv-charstatus">${status}</span></div>
            <div class="scwm-cv-charactions">
                <button type="button" class="scwm-cv-act" data-act="open" data-id="${a.id}" title="Ouvrir la fiche"><i class="fa-solid fa-user"></i></button>
                ${btns}
            </div>
        </div>`;
    }).join("") || `<p class="scwm-cv-empty">Vous n'avez pas encore de personnage.</p>`;

    const counters = `<p class="scwm-cv-counters">Actifs : <strong>${nbActive}/${limActive}</strong>${limTotal > 0 ? ` · Total : <strong>${actors.length}/${limTotal}</strong>` : ""}</p>`;

    let createBlock;
    if (req) {
        createBlock = `<p>📝 Votre demande de création (« ${esc(req.name)} ») est en attente de validation.</p>
           <div class="scwm-cv-actions"><button type="button" class="scwm-cv-act" data-act="cancel"><i class="fa-solid fa-times"></i> Annuler la demande</button></div>`;
    } else if (atTotalLimit) {
        createBlock = `<p class="scwm-cv-empty">Nombre maximum de personnages atteint (${limTotal}).</p>`;
    } else {
        createBlock = `<div class="scwm-cv-actions"><button type="button" class="scwm-cv-act" data-act="newreq"><i class="fa-solid fa-plus"></i> Demander un nouveau personnage</button></div>`;
    }

    const content = `<div class="scwm-cv-hub">
        <h3 style="margin-top:0;">Mes personnages</h3>
        ${counters}
        <div class="scwm-cv-charlist">${rows}</div>
        <hr>
        ${createBlock}
    </div>`;

    const dlg = new Dialog({
        title: "Mes personnages — validation",
        content,
        buttons: { close: { icon: '<i class="fa-solid fa-times"></i>', label: "Fermer" } },
        render: (html) => {
            const root = html[0] ?? html;
            const run = async (a, id) => {
                const ac = id ? game.actors.get(id) : null;
                if (a === "newreq") { dlg.close(); promptNewCharRequest(); return; }
                if (a === "cancel") { await game.user.unsetFlag(MOD, "charRequest"); }
                else if (a === "open") { ac?.sheet.render(true); return; }   // garder le hub ouvert
                else if (a === "activate") {
                    if (activeCountForUser(game.user.id) >= maxActive()) {
                        ui.notifications?.warn(`Vous avez déjà ${maxActive()} personnage(s) actif(s). Mettez-en un en stock d'abord.`);
                        return;
                    }
                    await requestCharStock(id, false);
                    ui.notifications?.info(`${ac?.name ?? "Personnage"} activé.`);
                }
                else if (a === "stock") {
                    await requestCharStock(id, true);
                    ui.notifications?.info(`${ac?.name ?? "Personnage"} mis en stock.`);
                }
                else if (a === "submit" && ac) {
                    await ac.setFlag(MOD, "pendingValidation", true);
                    ChatMessage.create({ whisper: gmIds(), speaker: { alias: "Validation" }, content: `📩 <strong>${esc(game.user.name)}</strong> soumet <strong>${esc(ac.name)}</strong> pour validation.` });
                    // Si c'est une re-soumission après montée de niveau : liste des modifs au MJ.
                    const snap = ac.getFlag(MOD, "levelUpSnapshot");
                    if (snap) postLevelUpDiff(ac, buildDiff(snap, buildSnapshot(ac)));
                    ui.notifications?.info("Fiche soumise pour validation.");
                } else if (a === "levelup" && ac) {
                    // Auto-déverrouillage : le joueur monte de niveau lui-même. Les
                    // modifications sont tracées (liste au MJ à la re-soumission),
                    // donc plus besoin d'un accord préalable du MJ.
                    await ac.update({
                        [`flags.${MOD}.levelUpGranted`]: true,
                        [`flags.${MOD}.locked`]: false,
                        [`flags.${MOD}.pendingLevelUp`]: false,
                        [`flags.${MOD}.levelUpSnapshot`]: buildSnapshot(ac)
                    });
                    ChatMessage.create({ whisper: gmIds(), speaker: { alias: "Validation" }, content: `⬆️ <strong>${esc(game.user.name)}</strong> effectue une <strong>montée de niveau</strong> pour <strong>${esc(ac.name)}</strong> (déverrouillage auto ; les modifications seront listées à la re-soumission).` });
                    ui.notifications?.info("Fiche déverrouillée pour la montée de niveau. Effectuez-la, puis re-soumettez-la pour re-verrouiller.");
                }
                dlg.close();
            };
            root.querySelectorAll(".scwm-cv-act").forEach(b => b.addEventListener("click", () => run(b.dataset.act, b.dataset.id)));
        }
    });
    dlg.render(true);
}

// ============================================================
// HOOKS
// ============================================================
export function CharValidationHooks() {
    // Requête d'(dés)activation d'un personnage — traitée par le GM.
    CONFIG.queries["westmarch.charStock"] = async ({ actorId, stock }) => { await applyCharStock(actorId, stock); return true; };

    // ---- Sous-dossier auto au nom du joueur (Dossier des PJ) ----
    // À la connexion d'un joueur, le GM crée son sous-dossier s'il n'existe pas.
    Hooks.on("userConnected", (user, connected) => {
        if (connected) ensurePlayerPJFolder(user);
    });
    // Passe initiale : couvre les joueurs déjà connectés quand le GM arrive.
    Hooks.once("ready", () => {
        if (!game.user.isGM) return;
        for (const u of (game.users ?? [])) if (!u.isGM && u.active) ensurePlayerPJFolder(u);
    });

    // Bouton dans la barre WestMarch pour les JOUEURS.
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!enabled()) return;
        if (game.user.isGM) return;
        if (!controls.westmarch) {
            controls.westmarch = { name: "westmarch", title: "WestMarch", icon: "fa-solid fa-hammer", layer: "tokens", tools: {} };
        }
        controls.westmarch.tools.charValidation = {
            name: "charValidation",
            title: "Mon personnage — demande / validation",
            icon: "fa-solid fa-id-card",
            button: true,
            onChange: () => openPlayerHub(),
            visible: true
        };
    });

    // ---- Verrou sélectif (non-GM, fiche verrouillée) ----
    Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
        if (game.user.isGM || userId !== game.user.id) return;
        if (!enabled() || !isLocked(actor)) return;
        // On ne bloque que si une valeur de CONSTRUCTION change RÉELLEMENT. Comparer
        // à la valeur actuelle évite de rejeter une soumission qui renvoie des champs
        // inchangés (ex. l'enregistrement de la BIOGRAPHIE peut inclure caracs/maîtrises
        // inchangées) → la bio et tout le reste du jeu restent éditables.
        const flat = foundry.utils.flattenObject(changes);
        const constructionChanged = Object.keys(flat).some(k =>
            BLOCKED_ACTOR_PATHS.some(p => k === p || k.startsWith(p + ".")) &&
            !foundry.utils.objectsEqual(flat[k], foundry.utils.getProperty(actor, k)));
        if (constructionChanged) {
            ui.notifications?.warn("Fiche validée : caractéristiques et maîtrises verrouillées. Demandez une modification au MJ.");
            setTimeout(() => actor.sheet?.render(false), 30);   // reverte l'affichage optimiste
            return false;
        }
    });

    Hooks.on("preUpdateItem", (item, changes, options, userId) => {
        if (game.user.isGM || userId !== game.user.id) return;
        if (!enabled()) return;
        const actor = item.parent;
        if (!actor || !isLocked(actor)) return;
        if (!BUILD_ITEM_TYPES.has(item.type)) return;   // inventaire / butin = jeu
        const sys = changes.system;
        if (!sys) return;                                // changement non mécanique
        const allowed = ITEM_PLAY_KEYS[item.type] ?? [];
        if (Object.keys(sys).every(k => allowed.includes(k))) return;   // uniquement du jeu
        ui.notifications?.warn(`Fiche validée : « ${item.name} » est un élément de construction verrouillé.`);
        setTimeout(() => actor.sheet?.render(false), 30);   // reverte l'affichage optimiste
        return false;
    });

    const blockBuildItemCD = (item, _d, _o, userId) => {
        if (game.user.isGM || userId !== game.user.id) return;
        if (!enabled()) return;
        const actor = item.parent;
        if (!actor || !isLocked(actor)) return;
        if (BUILD_ITEM_TYPES.has(item.type)) {
            ui.notifications?.warn("Fiche validée : l'ajout/retrait d'éléments de construction passe par le MJ.");
            return false;
        }
    };
    Hooks.on("preCreateItem", blockBuildItemCD);
    Hooks.on("preDeleteItem", blockBuildItemCD);

    // Bloque les imports PLUTONIUM sur une fiche verrouillée (les items importés
    // via Plutonium portent un flag "plutonium"). Autorisé pendant les fenêtres
    // de création / montée de niveau (fiche déverrouillée). GM jamais bloqué.
    Hooks.on("preCreateItem", (item, data, options, userId) => {
        if (game.user.isGM || userId !== game.user.id) return;
        if (!enabled() || !game.settings.get(MOD, "blockPlayerPlutonium")) return;
        const actor = item.parent;
        if (!actor || !isLocked(actor)) return;   // création / level-up autorisés
        const flags = data?.flags ?? item?.flags ?? {};
        const isPluto = Object.keys(flags).some(k => k.toLowerCase().includes("plutonium"));
        if (isPluto) {
            ui.notifications?.warn("Import Plutonium bloqué : cette fiche est verrouillée. Demandez au MJ d'autoriser une création ou une montée de niveau.");
            return false;
        }
    });

    // ---- Badge d'état dans le répertoire des Acteurs (entre le nom et le
    //      statut d'expédition) : « À valider » / « Level up ». ----
    Hooks.on("renderActorDirectory", (app, html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (root) injectValidationBadges(root);
    });
    Hooks.on("updateActor", (actor, changes) => {
        const f = changes?.flags?.[MOD];
        if (f && ("pendingValidation" in f || "pendingLevelUp" in f || "locked" in f || "validated" in f || "createdFor" in f || "stock" in f || "levelUpGranted" in f)) ui.actors?.render();
    });
    // Nouvelle fiche créée.
    Hooks.on("createActor", async (actor, options, userId) => {
        // Déjà rattachée à un joueur (ex. validation d'une demande) → juste rafraîchir.
        if (actor?.getFlag?.(MOD, "createdFor")) { ui.actors?.render(); return; }
        // PJ créé DIRECTEMENT par le GM dans le sous-dossier d'un joueur :
        // on saute la demande / validation → fiche d'emblée VALIDÉE et VERROUILLÉE.
        if (!enabled()) return;
        if (userId !== game.user.id || !game.user.isGM) return;   // seul le GM créateur agit
        if (actor.type !== "character") return;
        const user = findPlayerForActorFolder(actor);
        if (!user) return;
        const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
        await actor.update({
            ownership: { ...actor.ownership, [user.id]: L.OWNER },
            [`flags.${MOD}.createdFor`]:       user.id,
            [`flags.${MOD}.validated`]:        true,
            [`flags.${MOD}.locked`]:           true,
            [`flags.${MOD}.pendingValidation`]: false,
            [`flags.${MOD}.stock`]:            false
        });
        ChatMessage.create({
            whisper: [user.id],
            speaker: { alias: "Validation" },
            content: `<strong>${actor.name}</strong> a été créé et validé par le MJ. La fiche est verrouillée : tu peux jouer, mais les modifications de construction passent par le MJ.`
        });
        ui.actors?.render();
    });
}

function injectValidationBadges(root) {
    if (!enabled()) return;
    const items = root.querySelectorAll("li.directory-item[data-entry-id], li.directory-item[data-document-id]");
    for (const li of items) {
        const id = li.dataset.entryId ?? li.dataset.documentId;
        const actor = game.actors?.get(id);
        if (!actor || actor.type !== "character") continue;

        li.querySelector(":scope .scwm-cv-badge")?.remove();

        const validated  = actor.getFlag(MOD, "validated") === true;
        const pending    = actor.getFlag(MOD, "pendingValidation") === true;
        const createdFor = actor.getFlag(MOD, "createdFor");
        const levelup    = actor.getFlag(MOD, "pendingLevelUp") === true;

        let b = null;
        if (actor.getFlag(MOD, "stock") === true) b = { cls: "stock", label: "Stock", icon: "fa-lock" };
        else if (pending)                     b = { cls: "pending",  label: "À valider",     icon: "fa-hourglass-half" };
        else if (createdFor && !validated)    b = { cls: "creating", label: "En création",   icon: "fa-user-pen" };
        else if (actor.getFlag(MOD, "levelUpGranted") === true) b = { cls: "building", label: "En construction", icon: "fa-hammer" };
        else if (levelup)                     b = { cls: "levelup",  label: "Level up",      icon: "fa-arrow-up-1-9" };
        if (!b) continue;

        const span = document.createElement("span");
        span.className = `scwm-cv-badge scwm-cv-badge-${b.cls}`;
        span.title = b.label;
        span.innerHTML = `<i class="fa-solid ${b.icon}"></i><span class="scwm-cv-badge-label">${b.label}</span>`;

        const nameEl = li.querySelector(".entry-name, .document-name");
        if (nameEl) nameEl.insertAdjacentElement("afterend", span);
        else li.appendChild(span);
    }
}
