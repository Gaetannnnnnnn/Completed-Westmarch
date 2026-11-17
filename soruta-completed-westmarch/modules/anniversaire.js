import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
// ============================================================
// anniversaire.js — Anniversaires des personnages dans le chat
//
// Chaque acteur peut recevoir une date d'anniversaire (jour + mois du
// calendrier de Foundry, et facultativement l'année de naissance pour
// annoncer l'âge). Le jour venu, un message de fête apparaît dans le chat.
//
// Saisie : bouton gâteau dans l'en-tête de la fiche, ou clic droit sur
// l'acteur → « Date d'anniversaire ». Le propriétaire de l'acteur (le
// joueur pour son PJ) ou le MJ peut la régler.
//
// Quelle date fait foi :
//   - PJ en expédition (horloge de party ouverte, partytime.js) : la date
//     de SA party ; chaque jour franchi par l'horloge est vérifié ;
//   - sinon (et pour les PNJ) : le calendrier du monde.
// Plusieurs jours franchis d'un coup : chaque jour est vérifié (jusqu'à un an).
//
// Réglages : enableBirthday (PJ), birthdayNpc (PNJ aussi).
// Seul le MJ actif écrit les messages (pas de doublon à plusieurs MJ).
// Données : flag d'acteur `anniversaire` = { jour (1…), mois (0…), annee? }.
// © 2026 Soruta.
// ============================================================

const FLAG = "anniversaire";
const lire = (k, d) => { try { return game.settings.get(MOD, k); } catch { return d; } };
const actifPj  = () => lire("enableBirthday", false) === true;
const actifPnj = () => actifPj() && lire("birthdayNpc", false) === true;
const estMjActif = () => !!game.user?.isGM && (game.users?.activeGM ?? game.user) === game.user;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export const estPj = (a) => a?.type === "character" && !!a.hasPlayerOwner;
const concerne = (a) => estPj(a) ? actifPj() : actifPnj();

export const dateAnniversaire = (a) => {
    const d = a?.getFlag?.(MOD, FLAG);
    return (d && Number.isFinite(d.jour) && Number.isFinite(d.mois)) ? d : null;
};

// ── Calendrier ─────────────────────────────────────────────────
const cal = () => game.time?.calendar ?? null;
const comp = (t) => { try { return cal()?.timeToComponents(t) ?? null; } catch { return null; } };
function secondesParJour() {
    const d = cal()?.days;
    return (d?.hoursPerDay ?? 24) * (d?.minutesPerHour ?? 60) * (d?.secondsPerMinute ?? 60);
}
const mois = () => Array.from(cal()?.months?.values ?? []);
const nomMois = (i) => game.i18n.localize(mois()[i]?.name ?? tl("Mois {0}", i + 1));
const cleJour = (c) => c ? `${c.year}-${c.month}-${c.dayOfMonth}` : null;

// Jours (composantes) strictement après t1 jusqu'à t2 inclus, un par jour.
function joursFranchis(t1, t2) {
    const out = [];
    const spj = secondesParJour();
    const c1 = comp(t1), c2 = comp(t2);
    if (!c1 || !c2 || cleJour(c1) === cleJour(c2) || t2 < t1) return out;
    let t = t1;
    for (let i = 0; i < 400; i++) {
        t += spj;
        const c = comp(Math.min(t, t2));
        if (!c) break;
        if (!out.length || cleJour(out.at(-1)) !== cleJour(c)) out.push(c);
        if (cleJour(c) === cleJour(c2) || t >= t2) break;
    }
    if (!out.length || cleJour(out.at(-1)) !== cleJour(c2)) out.push(c2);
    return out;
}

// ── Message de fête ────────────────────────────────────────────
async function feter(actor, c) {
    const d = dateAnniversaire(actor);
    const age = Number.isFinite(d?.annee) ? c.year - d.annee : null;
    const ageTxt = age && age > 0 ? `<p style="margin:4px 0 0;font-size:1.05em;">${tl("{0} fête aujourd'hui ses <strong>{1} ans</strong> !", esc(actor.name), age)}</p>` : "";
    const content = `
    <div class="scwm-anniv" style="text-align:center;padding:6px 4px;">
        <div style="font-size:2em;line-height:1;">🎂</div>
        <h3 style="margin:6px 0 4px;border:none;">${tl("Joyeux anniversaire, {0} !", esc(actor.name))}</h3>
        ${actor.img ? `<img src="${esc(actor.img)}" alt="" style="width:64px;height:64px;object-fit:cover;border:1px solid #c9a227;border-radius:50%;margin:4px auto;display:block;">` : ""}
        ${ageTxt}
        <p style="margin:6px 0 0;font-size:.85em;opacity:.75;">${c.dayOfMonth + 1} ${esc(nomMois(c.month))} ${c.year}</p>
    </div>`;
    await ChatMessage.create({ speaker: { alias: tl("Anniversaire") }, content });
}

// Vérifie une liste d'acteurs pour une liste de jours.
async function verifier(acteurs, jours) {
    for (const c of jours) {
        for (const a of acteurs) {
            const d = dateAnniversaire(a);
            if (!d || d.jour !== c.dayOfMonth + 1 || d.mois !== c.month) continue;
            try { await feter(a, c); } catch (e) { journal.avert(tl("[{0}] Anniversaire : message impossible pour {1}", MOD, a.name), e); }
        }
    }
}

// PJ dont la date suit l'horloge d'une party en expédition.
function pjEnExpedition() {
    const ids = new Set();
    let etat = {};
    try { etat = game.settings.get(MOD, "partyClockState") ?? {}; } catch {}
    if (!lire("enableParty", false) || !lire("enablePartyTime", false)) return ids;
    for (const u of game.users ?? []) {
        if (u.isGM || !u.character) continue;
        const pid = u.getFlag(MOD, "partyId");
        if (pid && etat[pid]) ids.add(u.character.id);
    }
    return ids;
}
function membresParty(partyId) {
    return (game.users ?? []).filter(u => !u.isGM && u.getFlag(MOD, "partyId") === partyId && u.character).map(u => u.character);
}

// ── Fenêtre « Date d'anniversaire » ────────────────────────────
export async function editerAnniversaire(actor) {
    if (!actor || !(game.user.isGM || actor.isOwner)) return;
    const ms = mois();
    if (!ms.length) { ui.notifications?.warn(tl("Aucun calendrier configuré dans Foundry.")); return; }
    const d = dateAnniversaire(actor);
    const annee = comp(game.time.worldTime)?.year;
    const uid = `scwm-anniv-${foundry.utils.randomID()}`;
    const content = `
    <div id="${uid}" style="display:flex;flex-direction:column;gap:8px;">
        <p style="margin:0;">${tl("Date d'anniversaire de <strong>{0}</strong> (calendrier du serveur) :", esc(actor.name))}</p>
        <div style="display:flex;gap:6px;align-items:center;">
            <input type="number" name="jour" min="1" max="${Math.max(...ms.map(m => Number(m.days) || 30))}" step="1" value="${d?.jour ?? 1}" style="width:70px;">
            <select name="mois" style="flex:1;">${ms.map((m, i) => `<option value="${i}" ${d?.mois === i ? "selected" : ""}>${esc(nomMois(i))}</option>`).join("")}</select>
        </div>
        <label style="display:flex;gap:6px;align-items:center;">${tl("Année de naissance (facultatif, pour annoncer l'âge) :")}
            <input type="number" name="annee" step="1" value="${Number.isFinite(d?.annee) ? d.annee : ""}" placeholder="${annee != null ? annee - 25 : ""}" style="width:90px;"></label>
    </div>`;
    const r = await foundry.applications.api.DialogV2.wait({
        window: { title: tl("Anniversaire — {0}", actor.name), icon: "fa-solid fa-cake-candles" },
        position: { width: 400 },
        rejectClose: false,
        content,
        buttons: [
            { action: "ok", label: tl("Enregistrer"), icon: "fa-solid fa-check", default: true,
              callback: (_e, b) => {
                  const f = b.form?.elements;
                  const mois = Number(f?.mois?.value);
                  const max = Number(ms[mois]?.days) || 30;
                  const jour = Math.min(max, Math.max(1, Math.round(Number(f?.jour?.value) || 1)));
                  const a = String(f?.annee?.value ?? "").trim();
                  return { jour, mois, ...(a !== "" && Number.isFinite(Number(a)) ? { annee: Math.round(Number(a)) } : {}) };
              } },
            ...(d ? [{ action: "effacer", label: tl("Retirer"), icon: "fa-solid fa-trash" }] : []),
            { action: "cancel", label: tl("Annuler"), icon: "fa-solid fa-xmark" }
        ]
    }).catch(() => null);
    if (!r || r === "cancel") return;
    if (r === "effacer") { await actor.unsetFlag(MOD, FLAG); ui.notifications?.info(tl("Anniversaire de {0} retiré.", actor.name)); return; }
    await actor.update({ [`flags.${MOD}.-=${FLAG}`]: null });
    await actor.setFlag(MOD, FLAG, r);
    ui.notifications?.info(tl("Anniversaire de {0} : {1} {2}.", actor.name, r.jour, nomMois(r.mois)));
}

// ── Hooks ──────────────────────────────────────────────────────
let _dernierMonde = null;

export function AnniversaireHooks() {
    Hooks.once("ready", () => { _dernierMonde = game.time?.worldTime ?? null; });

    // Calendrier du monde : PNJ (option) et PJ hors expédition.
    Hooks.on("updateWorldTime", (worldTime) => {
        const avant = _dernierMonde;
        _dernierMonde = worldTime;
        if (!actifPj() || !estMjActif() || avant == null) return;
        const jours = joursFranchis(avant, worldTime);
        if (!jours.length) return;
        const exclus = pjEnExpedition();
        const acteurs = (game.actors ?? []).filter(a => dateAnniversaire(a) && concerne(a) && !(estPj(a) && exclus.has(a.id)));
        verifier(acteurs, jours).catch(e => journal.avert(tl("[{0}] Anniversaire :", MOD), e));
    });

    // Horloge de party (partytime.js) : PJ membres de la party.
    // Appelé par le seul client qui fait avancer l'horloge (le MJ de la party) :
    // pas de filtre « MJ actif », sinon rien ne partirait si ce MJ n'est pas le MJ actif.
    Hooks.on(`${MOD}.partyDaysCrossed`, (partyId, avant, apres) => {
        if (!actifPj() || !game.user?.isGM) return;
        const jours = joursFranchis(avant, apres);
        if (!jours.length) return;
        const acteurs = membresParty(partyId).filter(a => dateAnniversaire(a));
        verifier(acteurs, jours).catch(e => journal.avert(tl("[{0}] Anniversaire :", MOD), e));
    });

    // Bouton gâteau dans l'en-tête des fiches (propriétaire ou MJ).
    Hooks.on("renderApplicationV2", (app, element) => {
        try {
            const actor = app?.document;
            if (!(actor instanceof Actor) || !concerne(actor)) return;
            if (!(game.user.isGM || actor.isOwner)) return;
            const root = (element instanceof HTMLElement) ? element : element?.[0];
            const header = root?.querySelector(".window-header");
            if (!header || header.querySelector(".scwm-anniv-btn")) return;
            const d = dateAnniversaire(actor);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.classList.add("header-control", "icon", "fa-solid", "fa-cake-candles", "scwm-anniv-btn");
            btn.dataset.tooltip = d ? tl("Anniversaire : {0} {1}", d.jour, nomMois(d.mois)) : tl("Définir la date d'anniversaire");
            if (d) btn.style.color = "#c9a227";
            btn.addEventListener("click", async (ev) => { ev.preventDefault(); await editerAnniversaire(actor); app.render?.(); });
            const title = header.querySelector(".window-title");
            if (title) title.insertAdjacentElement("afterend", btn);
            else header.insertBefore(btn, header.querySelector(".close"));
        } catch (e) { journal.avert(tl("[{0}] bouton anniversaire :", MOD), e); }
    });

    // Clic droit sur un acteur → « Date d'anniversaire ».
    const idDe = (li) => li?.dataset?.entryId ?? li?.dataset?.documentId ?? li?.dataset?.actorId;
    Hooks.on("getActorContextOptions", (app, options) => {
        if (options.some(o => o.name === tl("Date d'anniversaire"))) return;
        options.push({
            name: tl("Date d'anniversaire"),
            icon: '<i class="fa-solid fa-cake-candles"></i>',
            condition: li => { const a = game.actors.get(idDe(li)); return !!a && concerne(a) && (game.user.isGM || a.isOwner); },
            callback: li => editerAnniversaire(game.actors.get(idDe(li)))
        });
    });
}

// Pour les tests : calcul des jours franchis.
export { joursFranchis as _joursFranchis };
