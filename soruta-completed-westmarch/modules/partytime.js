// ============================================================
// partytime.js — Horloge de party, rations et rattrapage du calendrier
//
// Réglage "enablePartyTime" (sous le Système de Party).
//
// Principe :
//   - Chaque party (identifiée par l'id de son GM, comme partout dans le
//     module) a sa PROPRE horloge, exprimée en secondes comme
//     game.time.worldTime. Elle démarre à l'ouverture de l'expédition
//     (carnet.js) et avance indépendamment du calendrier global.
//   - Le GM avance l'horloge de sa party (bouton « Avancer le temps de la
//     party » du groupe WestMarch) : par heures ou par jours.
//   - À chaque changement de jour franchi, chaque PJ consomme 1 ration
//     (objet « Rations » de son inventaire), sauf s'il est coché « Nourri
//     autrement » (Baie nourricière, Création de nourriture et d'eau,
//     chasse, etc.). Le choix est mémorisé pour la party.
//   - Plus de rations : le module compte les jours sans manger et prévient
//     dans le chat quand le PJ dépasse 3 + mod. de Constitution (min. 1),
//     seuil au-delà duquel les règles donnent un niveau d'Épuisement par
//     jour. Rien n'est appliqué automatiquement : le MJ tranche.
//   - Eau : simple rappel dans le chat à chaque nouveau jour (réglable).
//   - À la clôture de l'expédition (carnet.js), l'horloge de la party est
//     comparée au calendrier global : si la party est plus loin, le
//     calendrier global avance jusqu'à elle (ce qui déclenche au passage la
//     notification Discord de changement de jour de caldate.js).
//
//   - Obscurité (réglage "enablePartyDarkness") : les scènes marquées
//     « Suit l'heure de la party » (menu clic droit du répertoire des
//     scènes) prennent l'obscurité correspondant à l'heure de la party qui
//     s'y trouve. Si deux parties sont sur la même scène, c'est la première
//     arrivée qui garde la main (flag de scène "darknessParty") ; une autre
//     ne la reprend que quand la première n'y a plus de PJ ou a clôturé son
//     expédition.
//
// État partagé : réglage de monde "partyClockState"
//   { [partyId]: { time, fedOther: [actorId], hungry: { [actorId]: jours } } }
// Seuls les GM l'écrivent (réglage de monde).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";

// ── Réglages ───────────────────────────────────────────────────

export function partyTimeEnabled() {
    try {
        return !!game.settings.get(MOD, "enableParty") && !!game.settings.get(MOD, "enablePartyTime");
    } catch { return false; }
}

function waterReminderEnabled() {
    try { return game.settings.get(MOD, "partyTimeWaterReminder") !== false; } catch { return true; }
}

function allClocks() {
    const s = game.settings.get(MOD, "partyClockState");
    return (s && typeof s === "object") ? foundry.utils.deepClone(s) : {};
}

export function getPartyClock(partyId) {
    if (!partyId) return null;
    return allClocks()[partyId] ?? null;
}

async function savePartyClock(partyId, clock) {
    const all = allClocks();
    if (clock) all[partyId] = clock;
    else delete all[partyId];
    await game.settings.set(MOD, "partyClockState", all);
}

// ── Calendrier : conversions ───────────────────────────────────
// On s'appuie sur l'API native de Foundry v13 (game.time.calendar) pour
// lire une date à partir d'un temps en secondes. Pour l'inverse (date →
// secondes), on part du temps global et on décale d'un nombre de jours :
// pas besoin de componentsToTime, dont la forme a varié entre versions.

function secondsPerDay() {
    const d = game.time?.calendar?.days;
    const h = d?.hoursPerDay ?? 24;
    const m = d?.minutesPerHour ?? 60;
    const s = d?.secondsPerMinute ?? 60;
    return h * m * s;
}

function secondsPerHour() {
    const d = game.time?.calendar?.days;
    return (d?.minutesPerHour ?? 60) * (d?.secondsPerMinute ?? 60);
}

function components(time) {
    try { return game.time?.calendar?.timeToComponents(time) ?? null; } catch { return null; }
}

// Début du jour (minuit) contenant `time`.
function dayStart(time) {
    const c = components(time);
    if (!c) return time - (time % secondsPerDay());
    const d = game.time?.calendar?.days;
    const into = ((c.hour ?? 0) * (d?.minutesPerHour ?? 60) + (c.minute ?? 0)) * (d?.secondsPerMinute ?? 60)
               + (c.second ?? 0);
    return time - into;
}

// Nombre de minuits franchis entre deux instants (t2 >= t1).
function daysCrossed(t1, t2) {
    return Math.max(0, Math.round((dayStart(t2) - dayStart(t1)) / secondsPerDay()));
}

// Date du carnet { day (1-indexé), month (0-indexé), year } d'un instant.
export function timeToCarnetDate(time) {
    const c = components(time);
    if (!c) return null;
    return { day: c.dayOfMonth + 1, month: c.month, year: c.year };
}

// Nombre de jours depuis l'an 0 (même calcul que carnet.js / tm.js).
function totalDays(date) {
    const cal    = game.time?.calendar;
    const months = cal?.months?.values ? Array.from(cal.months.values) : [];
    const perYear = months.reduce((s, m) => s + (m?.days ?? 30), 0) || 360;
    let total = (date.year ?? 1) * perYear;
    for (let i = 0; i < (date.month ?? 0); i++) total += months[i]?.days ?? 30;
    return total + ((date.day ?? 1) - 1);
}

// Instant correspondant à une date du carnet, à l'heure `secondsIntoDay`.
function carnetDateToTime(date, secondsIntoDay) {
    const now     = game.time.worldTime;
    const today   = timeToCarnetDate(now);
    if (!today) return now;
    const offset  = totalDays(date) - totalDays(today);
    return dayStart(now) + offset * secondsPerDay() + secondsIntoDay;
}

function sameDate(a, b) {
    return !!a && !!b && a.day === b.day && a.month === b.month && a.year === b.year;
}

export function formatClock(time) {
    const c = components(time);
    if (!c) return "—";
    const cal   = game.time.calendar;
    const mName = game.i18n.localize(cal?.months?.values?.[c.month]?.name ?? tl("Mois {0}", c.month + 1));
    const hh    = String(c.hour ?? 0).padStart(2, "0");
    const mm    = String(c.minute ?? 0).padStart(2, "0");
    return tl("{0} {1} {2}, {3} h {4}", c.dayOfMonth + 1, mName, c.year, hh, mm);
}

// ── Party ──────────────────────────────────────────────────────

function myPartyId() {
    return game.user.getFlag(MOD, "partyId") ?? null;
}

function partyMembers(partyId) {
    return game.users
        .filter(u => !u.isGM && u.getFlag(MOD, "partyId") === partyId && u.character)
        .map(u => u.character)
        .filter(Boolean);
}

// ── Démarrage / clôture (appelés par carnet.js) ────────────────

/** Démarre l'horloge de la party à la date d'ouverture de l'expédition.
 *  Même jour que le calendrier global → heure globale exacte ; autre jour
 *  → 8 h du matin ce jour-là. Une horloge déjà en cours est conservée. */
export async function startPartyClock(partyId, startDate) {
    if (!partyTimeEnabled() || !game.user.isGM || !partyId) return;
    if (getPartyClock(partyId)) return;
    try {
        const now  = game.time.worldTime;
        const time = (!startDate || sameDate(startDate, timeToCarnetDate(now)))
            ? now
            : carnetDateToTime(startDate, 8 * secondsPerHour());
        await savePartyClock(partyId, { time, fedOther: [], hungry: {} });
        await applyPartyDarkness(partyId, time);
        journal.debug(`[partytime] Horloge démarrée pour la party ${partyId} : ${formatClock(time)}`);
    } catch (e) {
        journal.avert(tl("[Party] Impossible de démarrer l'horloge de la party"), e);
    }
}

/** Date à proposer par défaut à la clôture : celle de la party si elle a
 *  une horloge, sinon null (le carnet reprend alors la date globale). */
export function partyCarnetDate(partyId) {
    if (!partyTimeEnabled()) return null;
    const clock = getPartyClock(partyId);
    return clock ? timeToCarnetDate(clock.time) : null;
}

/** Fin d'expédition : rattrapage du calendrier global puis suppression de
 *  l'horloge. `endDate` = date choisie dans la fenêtre de clôture. */
export async function endPartyClock(partyId, endDate) {
    if (!partyTimeEnabled() || !game.user.isGM || !partyId) return;
    const clock = getPartyClock(partyId);
    if (!clock) return;
    try {
        // Instant de fin : l'horloge exacte si la date n'a pas été changée ;
        // sinon la date choisie, à la même heure que l'horloge de la party.
        const clockDate = timeToCarnetDate(clock.time);
        const target = (!endDate || sameDate(endDate, clockDate))
            ? clock.time
            : carnetDateToTime(endDate, clock.time - dayStart(clock.time));

        const now = game.time.worldTime;
        if (target > now) {
            await game.time.advance(target - now);
            ui.notifications.info(tl("[Party] Le calendrier global avance jusqu'à la date de la party : {0}.", formatClock(target)));
        } else {
            ui.notifications.info(tl("[Party] Le calendrier global est déjà plus loin que la party : il ne change pas."));
        }
        await savePartyClock(partyId, null);
        await releasePartyDarkness(partyId);
    } catch (e) {
        journal.erreur(tl("[Party] Erreur lors du rattrapage du calendrier global"), e);
        ui.notifications.error(tl("[Party] Le calendrier global n'a pas pu être mis à jour (voir console)."));
    }
}

// ── Rations ────────────────────────────────────────────────────

function isRation(item) {
    if (item.type !== "consumable") return false;
    const id = item.system?.identifier ?? "";
    if (id === "rations" || id === "ration") return true;
    return /\bration/i.test(item.name ?? "");
}

function rationCount(actor) {
    return actor.items.filter(isRation).reduce((s, i) => s + (Number(i.system?.quantity) || 0), 0);
}

// Retire jusqu'à `n` rations ; renvoie le nombre réellement retiré.
async function consumeRations(actor, n) {
    let left = n;
    const updates = [];
    for (const item of actor.items.filter(isRation)) {
        if (left <= 0) break;
        const q = Number(item.system?.quantity) || 0;
        if (q <= 0) continue;
        const take = Math.min(q, left);
        updates.push({ _id: item.id, "system.quantity": q - take });
        left -= take;
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    return n - left;
}

// Jours tenables sans manger : 3 + mod. de Constitution, minimum 1.
function foodlessLimit(actor) {
    const con = Number(actor.system?.abilities?.con?.mod) || 0;
    return Math.max(1, 3 + con);
}

// ── Avancer le temps ───────────────────────────────────────────

/** Avance l'horloge de la party de `seconds`, consomme les rations et
 *  publie le résumé dans le chat de la party. */
export async function advancePartyTime(partyId, seconds, fedOtherIds) {
    if (!game.user.isGM || !partyId || !(seconds > 0)) return;

    let clock = getPartyClock(partyId)
        ?? { time: game.time.worldTime, fedOther: [], hungry: {} };
    clock.fedOther = Array.isArray(fedOtherIds) ? fedOtherIds : (clock.fedOther ?? []);
    clock.hungry   = clock.hungry ?? {};

    const before = clock.time;
    const after  = before + seconds;
    const days   = daysCrossed(before, after);
    clock.time   = after;

    const lines = [];
    if (days > 0) {
        for (const actor of partyMembers(partyId)) {
            if (clock.fedOther.includes(actor.id)) {
                clock.hungry[actor.id] = 0;
                lines.push(tl("🍃 <strong>{0}</strong> : nourri autrement, aucune ration utilisée.", actor.name));
                continue;
            }
            const eaten  = await consumeRations(actor, days);
            const missed = days - eaten;
            if (missed === 0) {
                clock.hungry[actor.id] = 0;
                lines.push(tl("🍖 <strong>{0}</strong> : {1} ration(s) consommée(s), il en reste {2}.", actor.name, eaten, rationCount(actor)));
                continue;
            }
            // Les jours sans manger s'accumulent depuis le dernier repas.
            const hungry = (eaten > 0 ? 0 : (clock.hungry[actor.id] ?? 0)) + missed;
            clock.hungry[actor.id] = hungry;
            const limit = foodlessLimit(actor);
            let line = tl("⚠️ <strong>{0}</strong> : plus de rations ({1} consommée(s)). {2} jour(s) sans manger.", actor.name, eaten, hungry);
            if (hungry > limit) {
                line += " " + tl("Au-delà de sa limite ({0} jours) : les règles prévoient 1 niveau d'Épuisement par jour supplémentaire. À trancher par le MJ.", limit);
            } else {
                line += " " + tl("Limite avant Épuisement : {0} jours.", limit);
            }
            lines.push(line);
        }
        if (waterReminderEnabled()) {
            lines.push(tl("💧 Pensez à l'eau : chaque PJ boit chaque jour, vérifiez les outres (ou une source à proximité)."));
        }
    }

    await savePartyClock(partyId, clock);
    await applyPartyDarkness(partyId, after);

    const header = days > 0
        ? tl("🕰️ <strong>Le temps passe pour la party</strong> ({0} jour(s) écoulé(s)).<br>Date de la party : <strong>{1}</strong>", days, formatClock(after))
        : tl("🕰️ <strong>Le temps passe pour la party.</strong><br>Date de la party : <strong>{0}</strong>", formatClock(after));
    const content = lines.length ? `${header}<hr>${lines.join("<br>")}` : header;

    // Message du GM de la party : le filtrage du chat (chat.js) le limite
    // aux membres de cette party.
    await ChatMessage.create({ speaker: { alias: tl("Temps de la party") }, content });
}

// ── Obscurité des scènes ───────────────────────────────────────

function darknessEnabled() {
    try { return partyTimeEnabled() && game.settings.get(MOD, "enablePartyDarkness") !== false; } catch { return false; }
}

function num(key, def) {
    try { const n = Number(game.settings.get(MOD, key)); return Number.isFinite(n) ? n : def; } catch { return def; }
}

const TRANSITION_HOURS = 2;

/** Obscurité (0 à 1) pour un instant : nuit pleine avant le lever et après
 *  le coucher, transition de 2 h à l'aube et au crépuscule, 0 en journée. */
export function darknessAt(time) {
    const c = components(time);
    if (!c) return null;
    const perHour = game.time?.calendar?.days?.minutesPerHour ?? 60;
    const h     = (c.hour ?? 0) + (c.minute ?? 0) / perHour;
    const night = Math.min(1, Math.max(0, num("partyDarknessNight", 0.9)));
    const rise  = num("partyDarknessSunrise", 6);
    const set   = num("partyDarknessSunset", 20);
    const T     = TRANSITION_HOURS;
    if (h < rise || h >= set) return night;
    if (h < rise + T)         return night * (1 - (h - rise) / T);
    if (h >= set - T)         return night * ((h - (set - T)) / T);
    return 0;
}

export function sceneFollowsPartyTime(scene) {
    return scene?.getFlag?.(MOD, "followPartyTime") === true;
}

// La party a-t-elle au moins un PJ (token) sur cette scène ?
function partyOnScene(partyId, scene) {
    const ids = new Set(partyMembers(partyId).map(a => a.id));
    return scene.tokens.some(t => ids.has(t.actorId));
}

// La party propriétaire de l'obscurité est-elle toujours « là » ?
// (PJ présents ET expédition en cours, c.-à-d. horloge active)
function ownerStillThere(ownerId, scene) {
    if (!ownerId) return false;
    return !!getPartyClock(ownerId) && partyOnScene(ownerId, scene);
}

/** Règle l'obscurité des scènes « Suit l'heure de la party » où se trouve
 *  la party. La première party arrivée garde la main. */
export async function applyPartyDarkness(partyId, time) {
    // L'obscurité est un plus : une erreur ici ne doit jamais bloquer
    // l'avance du temps ni la consommation des rations.
    try { await _applyPartyDarkness(partyId, time); }
    catch (e) { journal.avert("[partytime] applyPartyDarkness", e); }
}

async function _applyPartyDarkness(partyId, time) {
    if (!darknessEnabled() || !game.user.isGM || !partyId) return;
    const level = darknessAt(time);
    if (level === null) return;
    for (const scene of game.scenes) {
        try {
            if (!sceneFollowsPartyTime(scene) || !partyOnScene(partyId, scene)) continue;
            const owner = scene.getFlag(MOD, "darknessParty");
            if (owner && owner !== partyId && ownerStillThere(owner, scene)) continue;   // la première party garde la main
            const update = {};
            if (owner !== partyId) update[`flags.${MOD}.darknessParty`] = partyId;
            const current = scene.environment?.darknessLevel;
            if (current === undefined || Math.abs(current - level) > 0.001) update["environment.darknessLevel"] = level;
            if (Object.keys(update).length) await scene.update(update);
        } catch (e) {
            journal.avert(tl("[Party] Impossible de régler l'obscurité de la scène {0}", scene.name), e);
        }
    }
}

// Fin d'expédition : la party rend la main sur ses scènes.
async function releasePartyDarkness(partyId) {
    try {
        for (const scene of game.scenes) {
            if (scene.getFlag(MOD, "darknessParty") !== partyId) continue;
            await scene.unsetFlag(MOD, "darknessParty");
        }
    } catch (e) { journal.avert("[partytime] releasePartyDarkness", e); }
}

function sceneFromLi(li) {
    const el = (li instanceof HTMLElement) ? li : li?.[0];
    const id = el?.dataset?.entryId ?? el?.dataset?.documentId
            ?? globalThis.$?.(li)?.attr?.("data-entry-id") ?? globalThis.$?.(li)?.attr?.("data-document-id");
    return game.scenes.get(id);
}

// ── Fenêtre « Avancer le temps de la party » ───────────────────

async function openAdvanceDialog() {
    if (!partyTimeEnabled()) {
        ui.notifications.warn(tl("[Party] L'horloge de party est désactivée dans les réglages du module."));
        return;
    }
    const partyId = myPartyId();
    const members = partyId ? partyMembers(partyId) : [];
    if (!partyId || !members.length) {
        ui.notifications.warn(tl("[Party] Aucun PJ dans votre party. Créez d'abord une party (clic droit sur votre nom dans la liste des joueurs)."));
        return;
    }

    const clock    = getPartyClock(partyId);
    const time     = clock?.time ?? game.time.worldTime;
    const fedOther = clock?.fedOther ?? [];
    const noClock  = !clock
        ? `<p style="margin:0 0 8px;font-size:11px;color:#e67e22;">${tl("Aucune expédition ouverte : l'horloge démarrera à la date du calendrier global.")}</p>`
        : "";

    const rows = members.map(a => `
        <li style="list-style:none;margin:3px 0;display:flex;justify-content:space-between;gap:8px;">
            <span>${foundry.utils.escapeHTML(a.name)} <span style="color:#aaa;font-size:11px;">— ${tl("{0} ration(s)", rationCount(a))}</span></span>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;">
                <input type="checkbox" name="scwm-fed-${a.id}" value="${a.id}" ${fedOther.includes(a.id) ? "checked" : ""}>
                ${tl("Nourri autrement")}
            </label>
        </li>`).join("");

    const content = `
<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
    ${noClock}
    <div>${tl("Date de la party :")} <strong>${formatClock(time)}</strong></div>
    <div style="display:flex;gap:6px;align-items:center;">
        <label>${tl("Avancer de")}</label>
        <input type="number" name="scwm-amount" value="1" min="1" step="1" style="width:70px;">
        <select name="scwm-unit">
            <option value="hours">${tl("heure(s)")}</option>
            <option value="days" selected>${tl("jour(s)")}</option>
        </select>
    </div>
    <div>
        <p style="margin:0 0 4px;font-size:11px;color:#aaa;">${tl("1 ration par PJ et par jour franchi. Cochez ceux qui se nourrissent autrement (sort, chasse, capacité…).")}</p>
        <ul style="margin:0;padding:0;">${rows}</ul>
    </div>
</div>`;

    const readForm = (form) => {
        const ids = members.filter(a => form?.elements?.[`scwm-fed-${a.id}`]?.checked).map(a => a.id);
        const amount = Math.max(0, Math.floor(Number(form?.elements?.["scwm-amount"]?.value) || 0));
        const unit = form?.elements?.["scwm-unit"]?.value === "hours" ? secondsPerHour() : secondsPerDay();
        return { ids, seconds: amount * unit };
    };

    let res = null;
    const action = await foundry.applications.api.DialogV2.wait({
        window:      { title: tl("Avancer le temps de la party") },
        position:    { width: 400 },
        content,
        rejectClose: false,
        buttons: [
            {
                action: "advance", label: tl("Avancer"), icon: '<i class="fa-solid fa-forward"></i>', default: true,
                callback: (ev, btn) => { res = readForm(btn?.form); }
            },
            {
                action: "longrest", label: tl("Repos long (+8 h)"), icon: '<i class="fa-solid fa-campground"></i>',
                callback: (ev, btn) => { res = { ...readForm(btn?.form), seconds: 8 * secondsPerHour() }; }
            },
            { action: "cancel", label: tl("Annuler"), icon: '<i class="fa-solid fa-times"></i>' }
        ]
    });
    if (action === "cancel" || !res || !(res.seconds > 0)) return;

    try {
        await advancePartyTime(partyId, res.seconds, res.ids);
    } catch (e) {
        journal.erreur(tl("[Party] Erreur lors de l'avance du temps de la party"), e);
        ui.notifications.error(tl("[Party] Erreur lors de l'avance du temps (voir console)."));
    }
}

// ── Hooks ──────────────────────────────────────────────────────

export function PartyTimeHooks() {
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM || !partyTimeEnabled()) return;
        if (!controls.westmarch) {
            controls.westmarch = {
                name: "westmarch", title: "WestMarch",
                icon: "fa-solid fa-hammer", layer: "tokens", tools: {}
            };
        }
        controls.westmarch.tools.partyTime = {
            name:     "partyTime",
            title:    tl("Avancer le temps de la party"),
            icon:     "fa-solid fa-hourglass-half",
            button:   true,
            onChange: () => openAdvanceDialog(),
            visible:  true
        };
    });

    // Clic droit sur une scène : la faire suivre (ou non) l'heure de la party.
    Hooks.on("getSceneContextOptions", (app, options) => {
        if (!game.user.isGM || !darknessEnabled()) return;
        options.push(
            {
                name:      tl("Suivre l'heure de la party (obscurité)"),
                icon:      '<i class="fa-solid fa-sun"></i>',
                condition: (li) => { const s = sceneFromLi(li); return !!s && !sceneFollowsPartyTime(s); },
                callback:  async (li) => {
                    const s = sceneFromLi(li);
                    if (!s) return;
                    await s.setFlag(MOD, "followPartyTime", true);
                    ui.notifications.info(tl("[Party] « {0} » suit maintenant l'heure de la party.", s.name));
                }
            },
            {
                name:      tl("Ne plus suivre l'heure de la party"),
                icon:      '<i class="fa-solid fa-moon"></i>',
                condition: (li) => { const s = sceneFromLi(li); return !!s && sceneFollowsPartyTime(s); },
                callback:  async (li) => {
                    const s = sceneFromLi(li);
                    if (!s) return;
                    await s.update({ [`flags.${MOD}.-=followPartyTime`]: null, [`flags.${MOD}.-=darknessParty`]: null });
                    ui.notifications.info(tl("[Party] « {0} » ne suit plus l'heure de la party.", s.name));
                }
            }
        );
    });
}
