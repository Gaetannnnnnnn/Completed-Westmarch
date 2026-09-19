// ============================================================
// combatreminders.js — Assistant de combat contextuel (Phase 1 : réactions)
//
// Dépend de Midi-QOL. Quand un PJ est réellement ciblé par une attaque, on
// propose ses réactions dans un pop-up côté joueur ET on prévient le MJ de sa
// party (« X réfléchit à une réaction… »). Dès que le joueur choisit (ou passe),
// la notification du MJ se ferme.
//
// Phases suivantes (réglages déjà en place) : actions bonus utiles (Smite),
// maîtrises d'arme, avantage/désavantage.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const on = (k) => { try { return game.settings.get(MOD, k); } catch { return false; } };

// ── Détection des réactions d'un acteur (items/activités de type "reaction") ──
function reactionItems(actor) {
    const out = [];
    for (const it of (actor?.items ?? [])) {
        let isReaction = false;
        // dnd5e v4 : activités
        const acts = it.system?.activities;
        if (acts) {
            const list = acts.contents ?? (typeof acts === "object" ? Object.values(acts) : []);
            for (const a of list) { if (a?.activation?.type === "reaction") { isReaction = true; break; } }
        }
        // dnd5e v3 : activation directe
        if (!isReaction && it.system?.activation?.type === "reaction") isReaction = true;
        if (isReaction) out.push(it);
    }
    return out;
}

// Utilisateur JOUEUR (non-MJ) propriétaire et connecté d'un acteur.
function ownerUserOf(actor) {
    return (game.users ?? []).find(u => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")) ?? null;
}
// MJ de la party de cet utilisateur (flag partyId), connecté.
function partyGmOf(user) {
    const gmId = user?.getFlag?.(MOD, "partyId");
    const gm = gmId ? game.users.get(gmId) : null;
    return (gm && gm.isGM && gm.active) ? gm : null;
}

// ── Pop-up JOUEUR : « tu peux réagir » ───────────────────────────────────────
async function showReactionPrompt({ promptId, actorId, attacker, reactionIds }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const items = (reactionIds ?? []).map(id => actor.items.get(id)).filter(Boolean);
    if (!items.length) return;

    const DialogV2 = foundry.applications.api.DialogV2;
    const buttons = items.map(it => ({
        action: it.id,
        label: it.name,
        icon: '<i class="fa-solid fa-bolt"></i>',
        callback: async () => { try { await (it.use?.() ?? it.roll?.()); } catch (e) { console.warn(`[${MOD}] usage réaction :`, e); } }
    }));
    buttons.push({ action: "pass", label: "Passer", icon: '<i class="fa-solid fa-forward"></i>', default: true });

    try {
        await DialogV2.wait({
            window: { title: `Réaction possible${attacker ? ` — attaqué par ${attacker}` : ""}`, icon: "fa-solid fa-bolt" },
            position: { width: 380 },
            content: `<p style="margin:0 0 6px;">Une <strong>réaction</strong> est peut-être utile. Choisis :</p>`,
            buttons,
            rejectClose: false
        });
    } catch (e) {}

    // Résolu → ferme la notif du MJ de la party.
    const gm = partyGmOf(game.user);
    if (gm) gm.query("westmarch.reactClear", { promptId }).catch(() => {});
}

// ── Notif MJ : « X réfléchit à une réaction… » (fermée quand le joueur choisit) ──
const _gmDialogs = new Map();
function showGmNotify({ promptId, player, target, attacker }) {
    try {
        const dlg = new Dialog({
            title: "Réaction en cours",
            content: `<p><strong>${player ?? "?"}</strong> (${target ?? "?"}) réfléchit à une <strong>réaction</strong>`
                   + `${attacker ? ` — attaqué par ${attacker}` : ""}…</p>`,
            buttons: { ok: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Fermer" } },
            default: "ok",
            close: () => _gmDialogs.delete(promptId)
        }, { width: 360 });
        dlg.render(true);
        _gmDialogs.set(promptId, dlg);
    } catch (e) { console.warn(`[${MOD}] notif MJ réaction :`, e); }
}
function clearGmNotify(promptId) {
    const dlg = _gmDialogs.get(promptId);
    _gmDialogs.delete(promptId);
    if (dlg) { try { dlg.close(); } catch (e) {} }
}

// ── Déclencheur : ciblage réel via Midi-QOL (côté client de l'attaquant) ──────
function onPreAttack(workflow) {
    if (!on("enableReactReminder")) return;
    const targets = workflow?.targets ? [...workflow.targets] : [];
    const attacker = workflow?.actor?.name ?? "";
    for (const t of targets) {
        const actor = t?.actor ?? t?.document?.actor;
        if (!actor || actor.type !== "character") continue;
        const reacts = reactionItems(actor);
        if (!reacts.length) continue;
        const owner = ownerUserOf(actor);
        if (!owner) continue;                       // personne (de connecté) pour réagir

        const promptId = foundry.utils.randomID(12);
        const reactionIds = reacts.map(r => r.id);
        // Pop-up chez le joueur ciblé.
        owner.query("westmarch.reactPrompt", { promptId, actorId: actor.id, attacker, reactionIds }).catch(() => {});
        // Notif chez le MJ de sa party.
        const gm = partyGmOf(owner);
        if (gm) gm.query("westmarch.reactNotify", { promptId, player: owner.name, target: actor.name, attacker }).catch(() => {});
    }
}

// ============================================================
// PHASE 3 — Maîtrises d'arme (weapon mastery, D&D 2024)
// Règle : info perso → chuchoté au joueur ; maîtrise qui demande une
// action/un jet → message PUBLIC avec un bouton que seul le MJ peut cliquer.
// ============================================================
const MASTERY = {
    topple: { label: "Topple / Renversement", trigger: "hit",  gm: true,  act: "save",
              desc: "La cible doit réussir un jet de <strong>Sauvegarde de Constitution</strong> ou tomber à terre." },
    graze:  { label: "Graze / Éraflure",       trigger: "miss", gm: true,  act: "graze",
              desc: "Inflige les <strong>dégâts du modificateur</strong> de caractéristique malgré l'échec." },
    cleave: { label: "Cleave / Fendoir",        trigger: "hit",  gm: true,  act: "cleave",
              desc: "<strong>Attaque supplémentaire</strong> contre une autre créature à 1,50 m." },
    push:   { label: "Push / Bousculade",       trigger: "hit",  gm: true,  act: "note",
              desc: "<strong>Pousse</strong> la cible de 3 m en ligne droite (déplacement par le MJ)." },
    slow:   { label: "Slow / Ralentissement",   trigger: "hit",  gm: true,  act: "slow",
              desc: "Réduit la <strong>vitesse</strong> de la cible de 3 m jusqu'au début de ton prochain tour." },
    sap:    { label: "Sap / Sape",              trigger: "hit",  gm: true,  act: "sap",
              desc: "La cible a un <strong>désavantage</strong> à sa prochaine attaque avant ton prochain tour." },
    vex:    { label: "Vex / Harcèlement",       trigger: "hit",  gm: false, act: null,
              desc: "Tu as l'<strong>avantage</strong> à ta prochaine attaque contre cette cible." },
    nick:   { label: "Nick / Estafilade",       trigger: "hit",  gm: false, act: null,
              desc: "Tu peux faire une <strong>attaque d'arme légère supplémentaire</strong> dans l'action d'Attaque." },
};

function masteryDc(attacker, item) {
    try {
        const abil = item?.abilityMod ?? item?.system?.ability ?? "str";
        const mod  = attacker.system?.abilities?.[abil]?.mod ?? 0;
        const prof = attacker.system?.attributes?.prof ?? 2;
        return 8 + prof + mod;
    } catch { return 8; }
}
function abilityDamageMod(attacker, item) {
    try {
        const abil = item?.abilityMod ?? item?.system?.ability ?? "str";
        return Math.max(0, attacker.system?.abilities?.[abil]?.mod ?? 0);
    } catch { return 0; }
}

// Cleave : proposé au joueur, 1×/tour. Clé = combat+combattant+round.tour.
const _cleaveTurn = new Map();
function _cleaveKey(attacker) {
    const c = game.combat;
    return c ? `${c.id}:${attacker.id}:${c.round}.${c.turn}` : `noc:${attacker.id}`;
}
async function offerCleave(attacker, item) {
    if (!attacker?.isOwner) return;                 // seul le contrôleur propose
    const key = _cleaveKey(attacker);
    if (_cleaveTurn.get(key)) return;               // déjà proposé ce tour
    _cleaveTurn.set(key, true);
    const DialogV2 = foundry.applications.api.DialogV2;
    let use = false;
    try {
        use = await DialogV2.confirm({
            window: { title: "Cleave / Fendoir", icon: "fa-solid fa-hand-fist" },
            content: `<p>Utiliser <strong>Cleave</strong> ? Une <strong>attaque supplémentaire</strong> contre une autre créature à 1,50 m (une seule fois par tour).<br><em>Ciblez d'abord la nouvelle créature.</em></p>`,
            rejectClose: false
        });
    } catch { use = false; }
    if (use) { try { await (item.use?.() ?? item.roll?.()); } catch (e) { console.warn(`[${MOD}] attaque de Cleave :`, e); } }
}

// Construit et poste le(s) message(s) de maîtrise à la fin d'une attaque.
function onAttackComplete(workflow) {
    if (!on("enableMasteryReminder")) return;
    const item = workflow?.item;
    const mid  = item?.system?.mastery;
    const m    = mid && MASTERY[mid];
    if (!m) return;

    const attacker = workflow?.actor;
    if (!attacker) return;
    const hit = workflow?.hitTargets ? [...workflow.hitTargets] : [];
    const all = workflow?.targets ? [...workflow.targets] : [];
    const missed = all.filter(t => !hit.includes(t));
    const concern = m.trigger === "miss" ? missed : hit;
    if (!concern.length) return;

    // Cleave : PROPOSÉ AU JOUEUR (avant), une seule fois par tour.
    if (mid === "cleave") { offerCleave(attacker, item); return; }

    // Info perso → chuchoté au joueur propriétaire (via son client si c'est lui).
    if (!m.gm) {
        const owner = ownerUserOf(attacker);
        ChatMessage.create({
            whisper: owner ? [owner.id] : ChatMessage.getWhisperRecipients("GM").map(u => u.id),
            speaker: { alias: "Maîtrise d'arme" },
            content: `<div><strong>${m.label}</strong> — ${attacker.name}<br>${m.desc}</div>`
        });
        return;
    }

    // Maîtrise « action MJ » → un message PUBLIC par cible concernée, avec bouton.
    const dc = masteryDc(attacker, item);
    for (const t of concern) {
        const tActor = t?.actor;
        if (!tActor) continue;
        const btn = m.act === "note" ? "" : `
            <button type="button" class="scwm-mastery-btn"
                    data-act="${m.act}" data-target="${t.document?.uuid ?? ""}"
                    data-attacker="${attacker.uuid}" data-item="${item.id}" data-dc="${dc}"
                    style="margin-top:5px;padding:3px 10px;border-radius:4px;cursor:pointer;">
                <i class="fa-solid fa-dice-d20"></i> ${m.act === "save" ? `Jet CON (DD ${dc})`
                    : m.act === "graze" ? "Appliquer dégâts"
                    : m.act === "cleave" ? "Attaque de Cleave"
                    : m.act === "slow" ? "Appliquer −3 m"
                    : m.act === "sap" ? "Appliquer désavantage" : "Faire"} — MJ
            </button>`;
        ChatMessage.create({
            speaker: { alias: "Maîtrise d'arme" },
            content: `<div class="scwm-mastery-msg">
                <strong>${m.label}</strong> — ${attacker.name} → <strong>${tActor.name}</strong><br>
                ${m.desc}${btn}
                <div style="font-size:11px;opacity:.7;margin-top:3px;">${m.act === "note" ? "À appliquer par le MJ." : "Réservé au MJ."}</div>
            </div>`
        });
    }
}

// Exécution du bouton (MJ uniquement).
async function _runMasteryAction(btn) {
    if (!game.user.isGM) { ui.notifications?.warn("Réservé au MJ."); return; }
    const act      = btn.dataset.act;
    const tDoc     = btn.dataset.target ? fromUuidSync(btn.dataset.target) : null;
    const tActor   = tDoc?.actor ?? tDoc;
    const attacker = btn.dataset.attacker ? fromUuidSync(btn.dataset.attacker) : null;
    const dc       = Number(btn.dataset.dc) || 8;
    try {
        if (act === "save") {
            let roll;
            try { roll = await tActor.rollSavingThrow?.({ ability: "con" }); }
            catch { roll = await tActor.rollAbilitySave?.("con"); }
            const total = roll?.total ?? roll?.[0]?.total;
            const fail = Number.isFinite(total) ? total < dc : null;
            if (fail === true) { try { await tActor.toggleStatusEffect?.("prone", { active: true }); } catch {} }
            ChatMessage.create({ speaker: { alias: "Maîtrise d'arme" },
                content: `Topple — ${tActor.name} : jet CON = <strong>${total ?? "?"}</strong> vs DD ${dc} → ${fail === true ? "<strong>échec, à terre</strong>" : fail === false ? "réussi" : "résultat manuel"}.` });
        } else if (act === "graze") {
            const dmg = abilityDamageMod(attacker, attacker?.items?.get(btn.dataset.item));
            try { await tActor.applyDamage?.(dmg); } catch {}
            ChatMessage.create({ speaker: { alias: "Maîtrise d'arme" }, content: `Graze — ${dmg} dégâts appliqués à ${tActor.name}.` });
        } else if (act === "cleave") {
            const it = attacker?.items?.get(btn.dataset.item);
            try { await (it?.use?.() ?? it?.roll?.()); } catch {}
        } else if (act === "slow") {
            try { await tActor.createEmbeddedDocuments("ActiveEffect", [{
                name: "Slow (maîtrise)", icon: "icons/svg/downgrade.svg",
                duration: { rounds: 1 },
                changes: [{ key: "system.attributes.movement.walk", mode: 2, value: "-10" }]
            }]); } catch {}
            ChatMessage.create({ speaker: { alias: "Maîtrise d'arme" }, content: `Slow — vitesse de ${tActor.name} réduite de 3 m.` });
        } else if (act === "sap") {
            try { await tActor.createEmbeddedDocuments("ActiveEffect", [{
                name: "Sap (maîtrise)", icon: "icons/svg/degen.svg",
                duration: { rounds: 1 },
                changes: [{ key: "flags.midi-qol.disadvantage.attack.all", mode: 0, value: "1" }]
            }]); } catch {}
            ChatMessage.create({ speaker: { alias: "Maîtrise d'arme" }, content: `Sap — ${tActor.name} : désavantage à sa prochaine attaque.` });
        }
        btn.disabled = true;
        btn.style.opacity = "0.5";
    } catch (e) { console.warn(`[${MOD}] action de maîtrise :`, e); }
}

export function CombatRemindersHooks() {
    // Queries (toujours enregistrées : réception des pop-ups / fermetures).
    CONFIG.queries["westmarch.reactPrompt"] = async (data) => { await showReactionPrompt(data); return true; };
    CONFIG.queries["westmarch.reactNotify"] = async (data) => { showGmNotify(data); return true; };
    CONFIG.queries["westmarch.reactClear"]  = async ({ promptId }) => { clearGmNotify(promptId); return true; };

    // Phase 1 — réactions : pre-hook Midi-QOL qui expose déjà les cibles.
    Hooks.on("midi-qol.preAttackRoll", onPreAttack);

    // Phase 3 — maîtrises : après le jet d'attaque (hit/miss connus).
    Hooks.on("midi-qol.AttackRollComplete", onAttackComplete);

    // Clic sur les boutons de maîtrise (délégation globale, MJ uniquement).
    document.addEventListener("click", (e) => {
        const btn = e.target?.closest?.(".scwm-mastery-btn");
        if (btn) { e.preventDefault(); _runMasteryAction(btn); }
    });
}
