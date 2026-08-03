import { MOD } from "./const.js";
// ============================================================
// caldate.js — Notification Discord lors d'un changement de jour
// Utilise l'API calendrier native de Foundry v13 :
//   game.time.calendar.timeToComponents(worldTime)
// Compatible avec tout module de calendrier (wgtgm-mini-calendar,
// etc.) sans dépendance tierce.
// ============================================================

// Événements spéciaux du calendrier du serveur (équinoxes, solstices, festivals).
// La comparaison est normalisée (sans accents, insensible à la casse) pour
// absorber les variations de saisie ou de localisation du calendrier.
const CALENDAR_SPECIAL_EVENTS = [
    { month: "Blanche Brebis", day: 19, label: "🌸 Équinoxe de printemps" },
    { month: "Moisson Dorée",  day:  1, label: "🌿 Greengrass"            },
    { month: "Douce Vie",      day: 20, label: "☀️ Solstice d'été"        },
    { month: "Sombrebois",     day:  1, label: "🌞 Midsummer"             },
    { month: "Grise Lumiere",  day:  1, label: "🛡️ Shieldmeet"           },
    { month: "Findefroid",     day:  1, label: "❄️ Midwinter"             },
];

// Normalise une chaîne : minuscules + suppression des diacritiques.
function _normalizeStr(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

let lastSentDateKey = null;

export function CalDateHooks() {

    // Mémoriser le jour courant au démarrage pour ne pas envoyer
    // un message parasite au premier updateWorldTime.
    Hooks.once("ready", () => {
        try {
            const cal = game.time?.calendar;
            if (!cal) return;
            const c = cal.timeToComponents(game.time.worldTime);
            lastSentDateKey = `${c.year}-${c.month}-${c.dayOfMonth}`;
            console.log(`westmarch | CalDate : date initiale mémorisée = ${lastSentDateKey}`);
        } catch(e) {
            console.warn("westmarch | CalDate : impossible de lire la date initiale", e);
        }
    });

    Hooks.on("updateWorldTime", (worldTime) => {
        if (!game.user.isGM) return;

        // Déduplication multi-GM
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;

        const webhookUrl = game.settings.get(MOD, "downtimeWebhookUrl");
        if (!webhookUrl) return;

        try {
            const cal = game.time?.calendar;
            if (!cal) return;

            const c = cal.timeToComponents(worldTime);
            const dateKey = `${c.year}-${c.month}-${c.dayOfMonth}`;

            // N'envoyer qu'en cas de changement de jour
            if (dateKey === lastSentDateKey) return;
            lastSentDateKey = dateKey;

            // Nom du mois localisé + jour 1-indexé
            const monthName   = game.i18n.localize(cal.months.values[c.month]?.name ?? `Mois ${c.month + 1}`);
            const seasonEntry = cal.seasons?.values?.[c.month];
            const seasonName  = seasonEntry ? game.i18n.localize(seasonEntry.name ?? "") : null;
            const displayDay  = c.dayOfMonth + 1;

            const dateStr = seasonName
                ? `${displayDay} ${monthName} ${c.year} — ${seasonName}`
                : `${displayDay} ${monthName} ${c.year}`;

            // Détection d'un événement spécial (équinoxe, solstice, festival)
            const normMonth = _normalizeStr(monthName);
            const special = CALENDAR_SPECIAL_EVENTS.find(e =>
                _normalizeStr(e.month) === normMonth && e.day === displayDay
            );

            const messageContent = special
                ? `📅 La date est maintenant le **${dateStr}**.\n${special.label}`
                : `📅 La date est maintenant le **${dateStr}**.`;

            console.log(`westmarch | CalDate : envoi webhook Discord — ${dateStr}${special ? ` (${special.label})` : ""}`);

            fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: messageContent })
            }).catch(err => console.error("westmarch | Webhook date Discord :", err));

        } catch(e) {
            console.error("westmarch | CalDate : erreur lors du traitement", e);
        }
    });
}
