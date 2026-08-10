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
import { commonFolderNewChars } from "./settings.js";

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
        .map(a => ({ id: a.id, name: a.name, ownerName: game.users.get(a.getFlag(MOD, "createdFor"))?.name ?? "—" }));
}
export function myCharActor() {
    return game.actors?.find(a => a.getFlag(MOD, "createdFor") === game.user.id) ?? null;
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

// ---- Actions GM (appelées depuis le Casier) ----
export async function approveCreation(userId) {
    if (!game.user.isGM) return;
    const user = game.users.get(userId);
    if (!user) return;
    const req = user.getFlag(MOD, "charRequest") ?? {};
    const folder = await ensureFolder();
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const actor = await Actor.create({
        name: req.name || `${user.name} — personnage`,
        type: "character",
        folder: folder.id,
        ownership: { default: L.NONE, [userId]: L.OWNER },
        flags: { [MOD]: { createdFor: userId, concept: req.concept || "", validated: false, locked: false } }
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
        [`flags.${MOD}.levelUpGranted`]: false
    });
    const uid = actor.getFlag(MOD, "createdFor");
    if (uid) ChatMessage.create({ whisper: [uid], speaker: { alias: "Validation" }, content: `🔒 <strong>${actor.name}</strong> est validé et verrouillé. Vous pouvez jouer normalement ; les changements de construction passeront par le MJ.` });
    ui.notifications?.info(`${actor.name} validé et verrouillé.`);
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
        [`flags.${MOD}.pendingLevelUp`]: false
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
function openPlayerHub() {
    const req = game.user.getFlag(MOD, "charRequest");
    const actor = myCharActor();

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let body, actions = "";
    if (req) {
        body = `<p>Votre <strong>demande de création</strong> (« ${esc(req.name)} ») est en attente de validation par un MJ.</p>`;
        actions = `<button type="button" class="scwm-cv-act" data-act="cancel"><i class="fas fa-times"></i> Annuler la demande</button>`;
    } else if (!actor) {
        body = `<p>Vous n'avez pas encore de personnage. Faites une <strong>demande de création</strong> ; une fois validée par un MJ, une fiche sera créée dans vos acteurs.</p>
            <div class="form-group"><label>Nom</label><input type="text" name="cv-name" placeholder="Nom du personnage"/></div>
            <div class="form-group"><label>Concept</label><textarea name="cv-concept" rows="3" placeholder="Classe visée, idée générale, historique…"></textarea></div>`;
        actions = `<button type="button" class="scwm-cv-act" data-act="request"><i class="fas fa-paper-plane"></i> Envoyer la demande</button>`;
    } else {
        const locked = actor.getFlag(MOD, "locked");
        const pending = actor.getFlag(MOD, "pendingValidation");
        const lvlPending = actor.getFlag(MOD, "pendingLevelUp");
        if (locked) {
            if (lvlPending) {
                body = `<p>🔒 <strong>${esc(actor.name)}</strong> est verrouillé. ⏳ Votre <strong>demande de montée de niveau</strong> est en attente de validation par un MJ.</p>`;
            } else {
                body = `<p>🔒 <strong>${esc(actor.name)}</strong> est validé et verrouillé. Jouez normalement ; pour <strong>monter de niveau</strong> ou changer votre construction, faites-en la demande ci-dessous.</p>`;
                actions = `<button type="button" class="scwm-cv-act" data-act="levelup"><i class="fas fa-arrow-up-1-9"></i> Demander une montée de niveau</button>`;
            }
        } else if (pending) {
            body = `<p>⏳ <strong>${esc(actor.name)}</strong> est en attente de validation par un MJ.</p>`;
        } else {
            body = `<p>Votre fiche <strong>${esc(actor.name)}</strong> est en construction. Terminez-la (imports Plutonium compris), puis soumettez-la.</p>`;
            actions = `<button type="button" class="scwm-cv-act" data-act="open"><i class="fas fa-user"></i> Ouvrir la fiche</button>
                       <button type="button" class="scwm-cv-act" data-act="submit"><i class="fas fa-paper-plane"></i> Soumettre pour validation</button>`;
        }
    }

    const dlg = new Dialog({
        title: "Mon personnage — validation",
        content: `<div class="scwm-cv-hub">${body}${actions ? `<div class="scwm-cv-actions">${actions}</div>` : ""}</div>`,
        buttons: { close: { icon: '<i class="fas fa-times"></i>', label: "Fermer" } },
        render: (html) => {
            const root = html[0] ?? html;
            const run = async (a) => {
                if (a === "request") {
                    const name = root.querySelector("[name=cv-name]")?.value.trim();
                    if (!name) { ui.notifications?.warn("Indiquez un nom."); return; }
                    const concept = root.querySelector("[name=cv-concept]")?.value.trim() ?? "";
                    await game.user.setFlag(MOD, "charRequest", { name, concept, dateISO: new Date().toISOString() });
                    ChatMessage.create({ whisper: game.users.filter(u => u.isGM).map(u => u.id), speaker: { alias: "Validation" }, content: `📝 <strong>${esc(game.user.name)}</strong> demande la création d'un personnage : « ${esc(name)} ».` });
                    ui.notifications?.info("Demande envoyée.");
                } else if (a === "cancel") {
                    await game.user.unsetFlag(MOD, "charRequest");
                } else if (a === "open") {
                    myCharActor()?.sheet.render(true);
                } else if (a === "submit") {
                    const ac = myCharActor();
                    if (!ac) return;
                    await ac.setFlag(MOD, "pendingValidation", true);
                    ChatMessage.create({ whisper: game.users.filter(u => u.isGM).map(u => u.id), speaker: { alias: "Validation" }, content: `📩 <strong>${esc(game.user.name)}</strong> soumet <strong>${esc(ac.name)}</strong> pour validation.` });
                    ui.notifications?.info("Fiche soumise pour validation.");
                } else if (a === "levelup") {
                    const ac = myCharActor();
                    if (!ac) return;
                    await ac.setFlag(MOD, "pendingLevelUp", true);
                    ChatMessage.create({ whisper: game.users.filter(u => u.isGM).map(u => u.id), speaker: { alias: "Validation" }, content: `⬆️ <strong>${esc(game.user.name)}</strong> demande une <strong>montée de niveau</strong> pour <strong>${esc(ac.name)}</strong>.` });
                    ui.notifications?.info("Demande de montée de niveau envoyée.");
                }
                dlg.close();
            };
            root.querySelectorAll(".scwm-cv-act").forEach(b => b.addEventListener("click", () => run(b.dataset.act)));
        }
    });
    dlg.render(true);
}

// ============================================================
// HOOKS
// ============================================================
export function CharValidationHooks() {
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
        if (BLOCKED_ACTOR_PATHS.some(p => foundry.utils.hasProperty(changes, p))) {
            ui.notifications?.warn("Fiche validée : caractéristiques et maîtrises verrouillées. Demandez une modification au MJ.");
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

    // ---- Badge d'état dans le répertoire des Acteurs (entre le nom et le
    //      statut d'expédition) : « À valider » / « Level up ». ----
    Hooks.on("renderActorDirectory", (app, html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (root) injectValidationBadges(root);
    });
    Hooks.on("updateActor", (actor, changes) => {
        const f = changes?.flags?.[MOD];
        if (f && ("pendingValidation" in f || "pendingLevelUp" in f || "locked" in f || "validated" in f || "createdFor" in f)) ui.actors?.render();
    });
    // Nouvelle fiche créée (ex. via validation d'une demande) → badge « En création ».
    Hooks.on("createActor", (actor) => {
        if (actor?.getFlag?.(MOD, "createdFor")) ui.actors?.render();
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
        if (pending)                          b = { cls: "pending",  label: "À valider",   icon: "fa-hourglass-half" };
        else if (createdFor && !validated)    b = { cls: "creating", label: "En création", icon: "fa-user-pen" };
        else if (levelup)                     b = { cls: "levelup",  label: "Level up",    icon: "fa-arrow-up-1-9" };
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
