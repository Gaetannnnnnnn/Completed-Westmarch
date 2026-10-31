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
//   - Section de réglages « Horloge de party » : interrupteur principal
//     (enablePartyTime) + options indépendantes : rations, alerte de faim,
//     rappel de l'eau, résumé dans le chat, rattrapage du calendrier
//     global, obscurité des scènes.
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
//   - Écoulement en temps réel (option) : hors combat et hors pause, une
//     seconde réelle = une seconde de jeu pour la party. L'horloge stocke
//     un temps de base et l'instant réel (heure serveur) où elle s'est mise
//     à courir ; chaque client calcule l'heure courante sans écriture.
//     Le GM de la party « fige » l'horloge quand la party est en pause ou
//     en combat, et la relance ensuite ; une fois par minute, il enregistre
//     l'heure atteinte (et traite les rations si minuit est passé).
//   - Combat (option) : chaque nouveau round du combat de la party ajoute
//     6 secondes (CONFIG.time.roundTime) à son horloge.
//   - Affichage (option) : rectangle à droite de la liste des joueurs
//     (heure avec les secondes), montrant l'heure de SA party (ou du calendrier global hors
//     expédition). Chaque joueur peut la masquer dans Accessibilité.
//
// État partagé : réglage de monde "partyClockState"
//   { [partyId]: { time, anchor, fedOther: [actorId], hungry: { [actorId]: jours } } }
//   time   = heure de la party (secondes) à l'instant `anchor` ;
//   anchor = heure serveur (ms) depuis laquelle l'horloge court, ou null si
//            elle est figée.
// Seul le GM de la party l'écrit (partyId = id de ce GM).
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

// Options de la section « Horloge de party » : chacune se coupe seule.
function opt(key) {
    try { return game.settings.get(MOD, key) !== false; } catch { return true; }
}
const rationsEnabled       = () => opt("partyTimeRations");
const hungerWarningEnabled = () => opt("partyTimeHungerWarning");
const waterReminderEnabled = () => opt("partyTimeWaterReminder");
const chatSummaryEnabled   = () => opt("partyTimeChatSummary");
const catchUpEnabled       = () => opt("partyTimeCatchUp");
const realTimeEnabled      = () => opt("partyTimeRealTime");
const combatRoundsEnabled  = () => opt("partyTimeCombatRounds");
const showClockEnabled     = () => opt("partyTimeShowClock");

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

// ── Temps qui court ────────────────────────────────────────────
// Écart maximal pris en compte depuis le dernier enregistrement : le GM
// enregistre chaque minute ; au-delà de 3 minutes, c'est qu'il n'est plus
// là (déconnecté, monde fermé) et ce temps-là ne compte pas.
const MAX_RUN_GAP_S = 180;

function nowMs() {
    const t = game.time?.serverTime;
    return Number.isFinite(t) ? t : Date.now();
}

/** Heure courante d'une horloge de party (secondes de jeu). */
export function effectiveTime(clock) {
    if (!clock) return game.time.worldTime;
    if (!clock.anchor) return clock.time;
    const elapsed = (nowMs() - clock.anchor) / 1000;
    return clock.time + Math.max(0, Math.min(elapsed, MAX_RUN_GAP_S));
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

/** Démarre l'horloge de la party à l'ouverture de l'expédition, recalée
 *  sur le calendrier global : même jour → heure globale exacte ; autre
 *  date choisie → ce jour-là, à l'heure globale actuelle. Une ancienne
 *  horloge de cette party (expédition mal close) est remplacée. */
export async function startPartyClock(partyId, startDate) {
    if (!partyTimeEnabled() || !game.user.isGM || !partyId) return;
    try {
        const now  = game.time.worldTime;
        const time = (!startDate || sameDate(startDate, timeToCarnetDate(now)))
            ? now
            : carnetDateToTime(startDate, now - dayStart(now));
        if (getPartyClock(partyId)) await releasePartyDarkness(partyId);
        await serial(() => savePartyClock(partyId, { time, anchor: null, fedOther: [], hungry: {} }));
        await applyPartyDarkness(partyId, time);
        scheduleReconcile();   // démarre l'écoulement en temps réel si la party joue
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
    return clock ? timeToCarnetDate(effectiveTime(clock)) : null;
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
        const current   = effectiveTime(clock);
        const clockDate = timeToCarnetDate(current);
        const target = (!endDate || sameDate(endDate, clockDate))
            ? current
            : carnetDateToTime(endDate, current - dayStart(current));

        const now = game.time.worldTime;
        if (!catchUpEnabled()) {
            // Rattrapage désactivé : le calendrier global ne bouge pas.
        } else if (target > now) {
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

// Les écritures d'une même party passent l'une après l'autre (avance
// manuelle, round de combat, enregistrement minute, pause…).
let _queue = Promise.resolve();
function serial(fn) {
    const run = _queue.then(fn, fn);
    _queue = run.catch(() => {});
    return run;
}

/** Avance l'horloge de la party de `seconds` (fenêtre du sablier). */
export function advancePartyTime(partyId, seconds, fedOtherIds) {
    if (!game.user.isGM || !partyId || !(seconds > 0)) return Promise.resolve();
    if (!getPartyClock(partyId)) return Promise.resolve();   // pas d'expédition ouverte
    return commitTime(partyId, (t) => t + seconds, { fedOtherIds, announce: true });
}

/** Enregistre une nouvelle heure pour la party : rations pour chaque
 *  minuit franchi, obscurité, message de chat.
 *  - target(t)  : nouvelle heure à partir de l'heure courante t ;
 *  - announce   : message même sans changement de jour (avance manuelle) ;
 *  - run        : true = l'horloge court ensuite, false = elle est figée,
 *                 undefined = elle garde son état. */
function commitTime(partyId, target, { fedOtherIds, announce = false, run } = {}) {
    return serial(() => _commitTime(partyId, target, { fedOtherIds, announce, run }));
}

async function _commitTime(partyId, target, { fedOtherIds, announce, run }) {
    // L'horloge n'existe que pendant une expédition : sans elle, rien à faire.
    const clock = getPartyClock(partyId);
    if (!clock) return;
    if (Array.isArray(fedOtherIds)) clock.fedOther = fedOtherIds;
    clock.fedOther = clock.fedOther ?? [];
    clock.hungry   = clock.hungry ?? {};

    const before  = effectiveTime(clock);
    const after   = Math.max(before, target(before));
    const days    = daysCrossed(before, after);
    const running = (run === undefined) ? !!clock.anchor : run;
    clock.time    = after;
    clock.anchor  = running ? nowMs() : null;

    const lines  = [];   // résumé : rations consommées (option « Résumé dans le chat »)
    const alerts = [];   // alertes : faim / épuisement et eau (chacune son option)
    if (days > 0 && rationsEnabled()) {
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
            if (!hungerWarningEnabled()) {
                lines.push(tl("🍖 <strong>{0}</strong> : {1} ration(s) consommée(s), il en reste {2}.", actor.name, eaten, rationCount(actor)));
                continue;
            }
            const limit = foodlessLimit(actor);
            let line = tl("⚠️ <strong>{0}</strong> : plus de rations ({1} consommée(s)). {2} jour(s) sans manger.", actor.name, eaten, hungry);
            if (hungry > limit) {
                line += " " + tl("Au-delà de sa limite ({0} jours) : les règles prévoient 1 niveau d'Épuisement par jour supplémentaire. À trancher par le MJ.", limit);
            } else {
                line += " " + tl("Limite avant Épuisement : {0} jours.", limit);
            }
            alerts.push(line);
        }
    }
    if (days > 0 && waterReminderEnabled()) {
        alerts.push(tl("💧 Pensez à l'eau : chaque PJ boit chaque jour, vérifiez les outres (ou une source à proximité)."));
    }

    await savePartyClock(partyId, clock);
    await applyPartyDarkness(partyId, after);

    // Message du GM de la party : le filtrage du chat (chat.js) le limite
    // aux membres de cette party. Résumé coupé → seules les alertes partent.
    if (!announce && days === 0) return;   // simple enregistrement : rien à dire
    let content = "";
    if (chatSummaryEnabled()) {
        const header = days > 0
            ? tl("🕰️ <strong>Le temps passe pour la party</strong> ({0} jour(s) écoulé(s)).<br>Date de la party : <strong>{1}</strong>", days, formatClock(after))
            : tl("🕰️ <strong>Le temps passe pour la party.</strong><br>Date de la party : <strong>{0}</strong>", formatClock(after));
        const body = [...lines, ...alerts];
        content = body.length ? `${header}<hr>${body.join("<br>")}` : header;
    } else if (alerts.length) {
        content = alerts.join("<br>");
    } else {
        if (announce) ui.notifications.info(tl("[Party] Date de la party : {0}.", formatClock(after)));
        return;
    }
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

    const clock = getPartyClock(partyId);
    if (!clock) {
        ui.notifications.warn(tl("[Party] Aucune expédition ouverte : le temps de la party ne s'avance que pendant une expédition. Ouvrez-en une avec le bouton « Date Expédition »."));
        return;
    }
    const time     = effectiveTime(clock);
    const fedOther = clock.fedOther ?? [];

    const rows = !rationsEnabled() ? "" : members.map(a => `
        <li style="list-style:none;margin:3px 0;display:flex;justify-content:space-between;gap:8px;">
            <span>${foundry.utils.escapeHTML(a.name)} <span style="color:#aaa;font-size:11px;">— ${tl("{0} ration(s)", rationCount(a))}</span></span>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;">
                <input type="checkbox" name="scwm-fed-${a.id}" value="${a.id}" ${fedOther.includes(a.id) ? "checked" : ""}>
                ${tl("Nourri autrement")}
            </label>
        </li>`).join("");

    const content = `
<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
    <div>${tl("Date de la party :")} <strong>${formatClock(time)}</strong></div>
    <div style="display:flex;gap:6px;align-items:center;">
        <label>${tl("Avancer de")}</label>
        <input type="number" name="scwm-amount" value="1" min="1" step="1" style="width:70px;">
        <select name="scwm-unit">
            <option value="hours">${tl("heure(s)")}</option>
            <option value="days" selected>${tl("jour(s)")}</option>
        </select>
    </div>
    ${rationsEnabled() ? `<div>
        <p style="margin:0 0 4px;font-size:11px;color:#aaa;">${tl("1 ration par PJ et par jour franchi. Cochez ceux qui se nourrissent autrement (sort, chasse, capacité…).")}</p>
        <ul style="margin:0;padding:0;">${rows}</ul>
    </div>` : ""}
</div>`;

    const readForm = (form) => {
        const ids = rationsEnabled()
            ? members.filter(a => form?.elements?.[`scwm-fed-${a.id}`]?.checked).map(a => a.id)
            : fedOther;
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

// ── Écoulement en temps réel (côté GM de la party) ─────────────
// Seul le GM dont l'id est le partyId écrit l'horloge de sa party.

// Id de la party dont ce GM tient l'horloge (= son propre id), qu'elle soit
// réunie ou non : une party dissoute à la clôture de session doit pouvoir
// être figée.
function ownPartyId() {
    return game.user.isGM ? game.user.id : null;
}

// La party de ce GM est-elle réunie (« Create Party » fait) ?
function partyAssembled(partyId) {
    return game.users.get(partyId)?.getFlag(MOD, "partyId") === partyId;
}

function isPartyPaused(partyId) {
    if (game.paused) return true;
    try {
        const st = game.settings.get(MOD, "partyPauseState");
        return !!st && typeof st === "object" && st[partyId] === true;
    } catch { return false; }
}

// Combat commencé de la party : tagué à son nom (combat.js), ou non tagué
// mais avec un PJ de la party parmi les combattants.
function partyCombats(partyId) {
    const ids = new Set(partyMembers(partyId).map(a => a.id));
    return (game.combats?.contents ?? []).filter(c => {
        const tag = c.getFlag?.(MOD, "partyId");
        if (tag) return tag === partyId;
        return c.combatants?.some(cb => ids.has(cb.actorId));
    });
}

function isPartyInCombat(partyId) {
    return partyCombats(partyId).some(c => c.started);
}

function shouldRun(partyId) {
    return partyTimeEnabled() && realTimeEnabled() && !!getPartyClock(partyId)
        && partyAssembled(partyId) && !isPartyPaused(partyId) && !isPartyInCombat(partyId);
}

// Fige ou relance l'horloge selon l'état de la party.
async function reconcile() {
    const pid = ownPartyId();
    if (!pid) return;
    const clock = getPartyClock(pid);
    if (!clock) return;
    const want = shouldRun(pid);
    if (want && !clock.anchor)  await commitTime(pid, (t) => t, { run: true });
    if (!want && clock.anchor)  await commitTime(pid, (t) => t, { run: false });
}

let _reconcileTimer = null;
function scheduleReconcile() {
    if (!game.user?.isGM) return;
    clearTimeout(_reconcileTimer);
    _reconcileTimer = setTimeout(() => {
        reconcile().catch(e => journal.avert("[partytime] reconcile", e));
    }, 250);
}

// Enregistrement minute : fixe l'heure atteinte (rations si minuit passé,
// obscurité qui suit l'aube et le crépuscule).
async function heartbeat() {
    const pid = ownPartyId();
    if (!pid) return;
    const clock = getPartyClock(pid);
    if (clock?.anchor) await commitTime(pid, (t) => t);
    await reconcile();
}

// ── Rounds de combat : +6 s par round ──────────────────────────
const _roundBefore = new Map();

function onPreUpdateCombat(combat, changed) {
    if ("round" in (changed ?? {})) _roundBefore.set(combat.id, combat.round ?? 0);
}

async function onUpdateCombat(combat, changed) {
    if (!("round" in (changed ?? {}))) return;
    const before = _roundBefore.get(combat.id) ?? 0;
    _roundBefore.delete(combat.id);
    const pid = ownPartyId();
    if (!pid || !partyTimeEnabled() || !combatRoundsEnabled() || !getPartyClock(pid)) return;
    if (!partyCombats(pid).some(c => c.id === combat.id)) return;
    const rounds = (Number(changed.round) || 0) - before;
    if (rounds <= 0) return;   // retour en arrière : on ne remonte pas le temps
    const perRound = Number(CONFIG.time?.roundTime) || 6;
    await commitTime(pid, (t) => t + rounds * perRound, { run: false });
}

// ── Horloge affichée ───────────────────────────────────────────
const WIDGET_ID = "scwm-party-clock";

function widgetVisible() {
    if (!partyTimeEnabled() || !showClockEnabled()) return false;
    try { return game.settings.get(MOD, "a11yPartyClock") !== false; } catch { return true; }
}

function isDaytime(time) {
    const c = components(time);
    if (!c) return true;
    const h = (c.hour ?? 0);
    return h >= num("partyDarknessSunrise", 6) && h < num("partyDarknessSunset", 20);
}

function renderClockWidget() {
    let el = document.getElementById(WIDGET_ID);
    if (!widgetVisible()) { el?.remove(); return; }

    if (!el) {
        el = document.createElement("div");
        el.id = WIDGET_ID;
        el.setAttribute("role", "status");
    }
    if (!el.isConnected) document.body.appendChild(el);
    placeWidget(el);

    const pid   = game.user.getFlag(MOD, "partyId") ?? null;
    const clock = pid ? getPartyClock(pid) : null;
    const time  = clock ? effectiveTime(clock) : game.time.worldTime;
    const c     = components(time);
    if (!c) { el.textContent = ""; return; }

    const mName = game.i18n.localize(game.time.calendar?.months?.values?.[c.month]?.name ?? tl("Mois {0}", c.month + 1));
    const hh    = String(c.hour ?? 0).padStart(2, "0");
    const mm    = String(c.minute ?? 0).padStart(2, "0");
    const ss    = String(Math.floor(c.second ?? 0)).padStart(2, "0");
    const icon  = isDaytime(time) ? "fa-sun" : "fa-moon";
    const label = clock ? tl("Party") : tl("Monde");
    const frozen = clock && realTimeEnabled() && !clock.anchor;
    const html = `
        <div class="scwm-pc-row">
            <i class="fa-solid ${icon}"></i>
            <span class="scwm-pc-time">${hh}:${mm}<span class="scwm-pc-sec">:${ss}</span></span>
        </div>
        <div class="scwm-pc-date">${c.dayOfMonth + 1} ${foundry.utils.escapeHTML(mName)} ${c.year}</div>
        <div class="scwm-pc-label">${label}${frozen ? ` <i class="fa-solid fa-pause" title="${tl("Temps arrêté (pause ou combat)")}"></i>` : ""}</div>`;
    if (el._scwmHtml !== html) { el.innerHTML = html; el._scwmHtml = html; }
    el.title = clock
        ? tl("Heure de votre party : {0}", formatClock(time))
        : tl("Calendrier du monde : {0}", formatClock(time));
}

// Rectangle collé à DROITE de la liste des joueurs, aligné sur son bas.
// Recalculé à chaque rafraîchissement : la liste change de taille quand
// des joueurs se connectent ou quand elle est repliée.
function placeWidget(el) {
    const players = document.getElementById("players");
    const r = players?.getBoundingClientRect?.();
    if (r && r.width > 0 && r.height > 0) {
        el.style.left   = `${Math.round(r.right + 8)}px`;
        el.style.bottom = `${Math.round(window.innerHeight - r.bottom)}px`;
    } else {
        el.style.left   = "10px";
        el.style.bottom = "10px";
    }
}

const WIDGET_CSS = `
#${WIDGET_ID} {
    position: fixed; z-index: 60;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    min-width: 118px; padding: 7px 12px;
    border: 1px solid rgba(201,162,39,0.55); border-radius: 6px;
    background: rgba(10,10,14,0.78); color: #e8dcb5;
    font-size: 12px; line-height: 1.25; text-align: center; pointer-events: auto;
    box-shadow: 0 1px 6px rgba(0,0,0,0.55);
}
#${WIDGET_ID} .scwm-pc-row   { display: flex; align-items: center; gap: 7px; }
#${WIDGET_ID} .fa-sun  { color: #f2c94c; }
#${WIDGET_ID} .fa-moon { color: #9db4e0; }
#${WIDGET_ID} .scwm-pc-time  { font-weight: 700; font-size: 18px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
#${WIDGET_ID} .scwm-pc-sec   { font-size: 13px; opacity: 0.75; }
#${WIDGET_ID} .scwm-pc-date  { opacity: 0.9; white-space: nowrap; }
#${WIDGET_ID} .scwm-pc-label { opacity: 0.6; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
`;

function ensureWidgetCss() {
    if (document.getElementById(`${WIDGET_ID}-style`)) return;
    const st = document.createElement("style");
    st.id = `${WIDGET_ID}-style`;
    st.textContent = WIDGET_CSS;
    document.head.appendChild(st);
}

// ── Hooks ──────────────────────────────────────────────────────

export function PartyTimeHooks() {
    Hooks.once("ready", () => {
        // Horloge affichée : rafraîchie chaque seconde sur tous les clients
        // (lecture seule, aucune écriture).
        ensureWidgetCss();
        renderClockWidget();
        setInterval(() => { try { renderClockWidget(); } catch { /* */ } }, 1000);

        if (!game.user.isGM) return;
        // GM de la party : au chargement, une horloge restée « en marche »
        // pendant que le monde était fermé ne compte que 3 minutes au plus
        // (voir MAX_RUN_GAP_S), puis l'état est recalé.
        scheduleReconcile();
        setInterval(() => { heartbeat().catch(e => journal.avert("[partytime] heartbeat", e)); }, 60 * 1000);
    });

    // Pause, combat ou composition de la party qui change : on fige ou on
    // relance l'horloge.
    Hooks.on("pauseGame",     () => scheduleReconcile());
    Hooks.on("updateSetting", (setting) => {
        if (setting?.key === `${MOD}.partyPauseState` || setting?.key === `${MOD}.partyClockState`) scheduleReconcile();
    });
    Hooks.on("combatStart",   () => scheduleReconcile());
    Hooks.on("deleteCombat",  () => scheduleReconcile());
    Hooks.on("updateUser",    (user, changed) => {
        if (changed?.flags?.[MOD] && "partyId" in changed.flags[MOD]) scheduleReconcile();
        if (changed?.flags?.[MOD]?.["-=partyId"] !== undefined) scheduleReconcile();
    });
    Hooks.on("preUpdateCombat", (combat, changed) => onPreUpdateCombat(combat, changed));
    Hooks.on("updateCombat",    (combat, changed) => {
        scheduleReconcile();
        onUpdateCombat(combat, changed).catch(e => journal.avert("[partytime] round de combat", e));
    });
    Hooks.on("renderPlayers", () => { try { renderClockWidget(); } catch { /* */ } });

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
