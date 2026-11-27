import { MOD } from "./const.js";
import { journal } from "./log.js";
import { partyFeatureEnabled } from './settings.js';
import { registerSoundFilter } from './audio.js';
import { tl } from "./i18n.js";

var tabSelected = "IC";

// CSS injecté en JS : plus fiable que le fichier du manifeste (sur certains
// hébergements comme The Forge, un NOUVEAU fichier .css d'un module n'est pas
// injecté sans relancer le monde). Ici, le style suit toujours le code.
// Portée commune : le conteneur de chat en v13/v14.
const SCOPE = ":is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications)";

// ══════════════════════════════════════════════════════════════════════
//  Cartes de chat colorées par joueur — fonctionnement NATIF préservé
//  (option « enableChatPlayerCards », indépendante de l'ancien reskin).
//  On NE reconstruit RIEN : boutons, jets et repli des descriptions restent
//  gérés par dnd5e. On se contente, pour chaque message :
//    • de teinter le fond avec une version MATE et SOMBRE (mélangée de noir)
//      de la couleur de profil de l'auteur (celle de la liste des joueurs) ;
//    • d'ajouter un filet d'accent à gauche dans cette même couleur, pour
//      reconnaître le joueur d'un coup d'œil ;
//    • d'ajouter un séparateur plus marqué quand l'auteur change (les
//      messages consécutifs d'un même joueur forment un bloc).
//  Le texte passe en clair pour rester lisible sur le fond sombre ; les
//  cartes dnd5e suivent la variable --dnd5e-chat-background, donc elles se
//  teintent sans qu'on touche à leur structure.
// ══════════════════════════════════════════════════════════════════════

export const cartesJoueurActives = () => {
    try { return !!game.settings.get(MOD, "enableChatPlayerCards"); } catch { return false; }
};

function _rgbInt(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// Couleur de profil → version mate (désaturée vers le gris) puis sombre
// (mélangée de noir) : agréable en fond de carte, jamais criarde.
function _matteSombre(rgb) {
    const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    const MAT = 0.70;     // garde 70 % de la chroma → mat
    const SOMBRE = 0.30;  // 30 % de la luminosité → foncé, mélangé au noir
    const f = (v) => Math.round(Math.max(0, Math.min(255, (lum + (v - lum) * MAT) * SOMBRE)));
    return `rgb(${f(rgb.r)}, ${f(rgb.g)}, ${f(rgb.b)})`;
}
function _couleurAuteur(el) {
    const id = el?.dataset?.messageId;
    const m = id ? game.messages.get(id) : null;
    const author = m?.author ?? null;
    const raw = author ? (author.color?.css ?? author.color ?? "") : "";
    return _rgbInt(String(raw));
}
// Pose la teinte + l'accent sur un message (idempotent).
function appliquerCarteJoueur(el) {
    if (!el || !el.classList || !el.dataset) return;
    const rgb = _couleurAuteur(el);
    if (!rgb) { el.classList.remove("scwm-pcard"); return; }
    const matte = _matteSombre(rgb);
    el.style.setProperty("--dnd5e-chat-background", matte);
    el.style.setProperty("--scwm-pc", `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
    el.style.background = matte;
    el.classList.add("scwm-pcard");
}

// Séparateurs : on balaie les messages dans l'ordre et on marque
// « scwm-newspeaker » le premier d'une suite d'un même auteur. Les messages
// masqués (filtre party / onglets) sont ignorés pour ne pas casser les blocs.
let _logEl = null;
let _sepScheduled = false;
function planifierSeparateurs() {
    if (_sepScheduled) return;
    _sepScheduled = true;
    requestAnimationFrame(() => {
        _sepScheduled = false;
        try { rebalayerSeparateurs(_logEl ?? document.querySelector("#chat-log, .chat-log")); } catch (e) {}
    });
}
function rebalayerSeparateurs(logEl) {
    const msgs = logEl?.querySelectorAll?.(".chat-message");
    if (!msgs) return;
    let prev = null;
    msgs.forEach(el => {
        if (el.style.display === "none") return;
        if (!el.classList.contains("scwm-pcard")) { el.classList.remove("scwm-newspeaker"); return; }
        const id = el.dataset.messageId;
        const m = id ? game.messages.get(id) : null;
        const aid = m?.author?.id ?? "?";
        el.classList.toggle("scwm-newspeaker", aid !== prev);
        prev = aid;
    });
}

const PCOLOR_CSS = `
/* Carte colorée par joueur : fond mat sombre (teinte de profil) + accent. */
body.scwm-pcolor ${SCOPE} .message.scwm-pcard {
    --dnd5e-border-gold: 1px solid rgba(255,255,255,0.12);
    --color-text-primary: #ece6da;
    --color-text-secondary: #cfc7b5;
    --color-text-tertiary: #cfc7b5;
    color: #ece6da;
    border-left: 4px solid var(--scwm-pc, #666) !important;
    border-radius: 4px;
    box-shadow: 0 1px 5px rgba(0,0,0,0.35);
}
/* En-tête lisible (nom, horodatage, destinataire du chuchotement). */
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .message-sender,
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .message-timestamp,
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .message-metadata,
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .whisper-to {
    color: #ece6da !important; opacity: 1 !important;
}
/* Texte de la carte dnd5e lisible sur le fond sombre (on ne touche qu'aux
   couleurs de texte, jamais à la structure). */
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .chat-card .card-header .title { color: #e8cc6a; text-shadow: none; }
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .chat-card .card-header .subtitle,
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .chat-card .card-description .wrapper,
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .chat-card .card-flavor,
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .chat-card p.supplement {
    color: #e8e2d4;
}
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .chat-card p.supplement > strong { color: #e8cc6a; }
/* Barres de dés : texte clair garanti sur leur fond sombre. */
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .dice-roll .dice-formula,
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .dice-roll .dice-total,
body.scwm-pcolor ${SCOPE} .message.scwm-pcard .dice-roll .dice-formula * {
    color: #efe7cf !important;
}
/* Séparateur : messages d'un même joueur collés, auteur suivant détaché. */
body.scwm-pcolor ${SCOPE} .message.scwm-pcard { margin-top: 2px; }
body.scwm-pcolor ${SCOPE} .message.scwm-pcard.scwm-newspeaker {
    margin-top: 11px;
    border-top: 1px solid rgba(255,255,255,0.10);
    padding-top: 6px;
}
`;

export function applyPlayerCardPrefs() {
    const body = document.body;
    if (!body) return;
    const on = cartesJoueurActives();
    body.classList.toggle("scwm-pcolor", on);

    let st = document.getElementById("scwm-pcolor-style");
    if (!st) { st = document.createElement("style"); st.id = "scwm-pcolor-style"; document.head.appendChild(st); }
    if (st.textContent !== PCOLOR_CSS) st.textContent = PCOLOR_CSS;

    // (Ré)appliquer sur tout le log existant, ou nettoyer si on coupe.
    const log = _logEl ?? document.querySelector("#chat-log, .chat-log");
    if (log) {
        log.querySelectorAll?.(".chat-message").forEach(el => {
            if (on) { appliquerCarteJoueur(el); }
            else {
                el.classList.remove("scwm-pcard", "scwm-newspeaker");
                el.style.removeProperty("--dnd5e-chat-background");
                el.style.removeProperty("--scwm-pc");
                el.style.removeProperty("background");
            }
        });
        if (on) planifierSeparateurs();
    }
}


// ── Observateur du ChatLog ──
// dnd5e RE-REND la carte à chaque clic sur un bouton (Attaque/Dégâts…), et le
// hook par message ne couvre pas toujours les nouvelles cartes. Un
// MutationObserver ré-applique la teinte par joueur dès qu'une carte apparaît
// OU est re-rendue en place (idempotent → pas de boucle).
let _chatObs = null;
function observeChatLog(logEl) {
    if (!logEl || !(logEl instanceof HTMLElement)) return;
    if (_chatObs) _chatObs.disconnect();
    _chatObs = new MutationObserver((mutations) => {
        const targets = new Set();
        for (const m of mutations) {
            m.addedNodes.forEach(n => { if (n instanceof HTMLElement) targets.add(n); });
            if (m.target instanceof HTMLElement) targets.add(m.target);
        }
        if (!targets.size) return;
        requestAnimationFrame(() => {
            try {
                if (!cartesJoueurActives()) return;
                targets.forEach(n => {
                    const msg = n.closest?.(".chat-message") ?? n;
                    if (msg?.classList?.contains?.("chat-message")) appliquerCarteJoueur(msg);
                    else msg?.querySelectorAll?.(".chat-message").forEach(appliquerCarteJoueur);
                });
                planifierSeparateurs();
            } catch (e) {}
        });
    });
    _logEl = logEl;
    _chatObs.observe(logEl, { childList: true, subtree: true });
}

export function ChatHooks() {
    Hooks.on("renderChatMessageHTML", (message, html, messageData) => renderChatMessageHTML(message, html, messageData));
    Hooks.on("renderChatLog", async (log, html, data) => await renderChatLog(log, html, data));

    Hooks.once("ready", () => applyPlayerCardPrefs());

    // Injection des boutons GM au chargement initial (ready garantit que
    // #chat-controls est dans le DOM) ET à chaque re-render du ChatLog
    // (renderChatLog efface les boutons injectés → il faut réinjecter).
    // Le guard dans _injectPartyChatButtons évite le double-inject.
    if (game.user?.isGM) {
        Hooks.once("ready", () => setTimeout(_injectPartyChatButtons, 300));
    }

    // ============================================================
    // Coupe le son de jet de dés (audio.js) quand il provient d'un
    // message dont l'auteur n'est pas de notre party — voir audio.js
    // pour le pourquoi (le son est diffusé à toute la table, sans
    // notion de party, indépendamment du masquage visuel ci-dessus).
    // ============================================================
    registerSoundFilter((src) => {
        if (!partyFeatureEnabled("enableChatFilter")) return false;
        if (!src || src !== CONFIG.sounds.dice) return false;

        // Le son qu'on est sur le point de jouer vient forcément du
        // DERNIER message de chat créé portant ce son (un jet de dés) :
        // on le retrouve pour savoir si son auteur est de notre party.
        const msg = [...game.messages].reverse().find(m => m.sound === src);
        return msg ? !isPartyMember(msg.author) : false;
    });

    // ============================================================
    // Dice So Nice : par défaut l'animation 3D est diffusée à TOUTE la table.
    // ------------------------------------------------------------
    // IMPORTANT : le hook diceSoNiceRollStart se déclenche sur le client QUI
    // LANCE le dé — donc l'auteur y est toujours « nous-mêmes ». Tester
    // « l'auteur est-il de MA party ? » ne marche donc jamais (on est
    // toujours de notre propre party) : c'était le bug. La bonne approche est
    // de définir, côté lanceur, la liste des spectateurs autorisés
    // (context.users) = les membres de la party de l'AUTEUR. DSN ne diffuse
    // alors l'animation 3D qu'à cette party ; les autres parties ne voient
    // rien. Raisonnement identique quel que soit le client (basé sur le flag
    // de l'auteur, pas sur le spectateur).
    // ============================================================
    Hooks.on("diceSoNiceRollStart", (messageId, context) => {
        try {
            if (!partyFeatureEnabled("enableChatFilter")) return;
            const msg = messageId ? game.messages.get(messageId) : null;
            let author = msg?.author ?? null;
            if (!author && context) {
                const u = context.user ?? context.author ?? context.userId;
                author = (u && typeof u === "object") ? u : (u ? game.users.get(u) : null);
            }
            if (!author) return;

            const pid = author.getFlag(MOD, "partyId");
            if (!pid) return;   // auteur non assigné à une party → pas de restriction

            // Spectateurs = tous les utilisateurs partageant la partyId de
            // l'auteur (le flag est commun : joueurs de la party + leur GM).
            const viewers = game.users.filter(u => u.getFlag(MOD, "partyId") === pid).map(u => u.id);
            if (!viewers.includes(author.id)) viewers.push(author.id);
            if (viewers.length && context) context.users = viewers;
        } catch (e) {}
    });

}

export function ReloadChat() {
    changeTab(tabSelected);
}

// ============================================================
// SECTION : Filtrage des messages du chat par party
// - Les joueurs ne voient que les messages de leur party
// ============================================================
function renderChatMessageHTML(message, html, messageData) {
    // Reskin 5.3.x sur le DOM 6.0 (l'observateur du ChatLog assure le suivi des
    // re-renders après clic sur un bouton ; ici on traite le rendu initial).
    // Carte colorée par joueur (natif préservé) : teinte + accent + séparateur.
    try {
        if (cartesJoueurActives()) {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const msg = root?.classList?.contains?.("chat-message") ? root : root?.closest?.(".chat-message");
            if (msg) { appliquerCarteJoueur(msg); planifierSeparateurs(); }
        }
    } catch (e) {}

    if (!partyFeatureEnabled("enableChatFilter")) return;

    if(!isPartyMember(message.author)) {
        $(html).hide();
    }
    // Onglets IC / Autre / OOC désactivés → on n'applique aucun filtre par type.
    if (!game.settings.get(MOD, "enableChatTabs")) return;
    switch(tabSelected) {
        case "IC":
            if(message.style != CONST.CHAT_MESSAGE_STYLES.IC) {
                $(html).hide();
                $('#'+Object.keys(CONST.CHAT_MESSAGE_STYLES).find(key => CONST.CHAT_MESSAGE_STYLES[key] === message.style)+"Notification").show();
            }
            break;
        case "OTHER":
            if(message.style != CONST.CHAT_MESSAGE_STYLES.OTHER) {
                $(html).hide();
                $('#'+Object.keys(CONST.CHAT_MESSAGE_STYLES).find(key => CONST.CHAT_MESSAGE_STYLES[key] === message.style)+"Notification").show();
            }
            break;
        case "OOC":
            if(message.style != CONST.CHAT_MESSAGE_STYLES.OOC) {
                $(html).hide();
                $('#'+Object.keys(CONST.CHAT_MESSAGE_STYLES).find(key => CONST.CHAT_MESSAGE_STYLES[key] === message.style)+"Notification").show();
            }
            break;
    }
}

async function renderChatLog(log, html, data) {
    // Catch-all reskin + observateur : rebalaie tout le log au (re)rendu de la
    // sidebar, puis surveille les nouvelles cartes et les re-renders en place.
    try {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (cartesJoueurActives()) {
            _logEl = root;
            root?.querySelectorAll?.(".chat-message").forEach(appliquerCarteJoueur);
            planifierSeparateurs();
            observeChatLog(root);
        }
    } catch (e) {}

    // Éviter la duplication des tabs si renderChatLog fire plusieurs fois
    if (partyFeatureEnabled("enableChatFilter") && game.settings.get(MOD, "enableChatTabs") && !document.querySelector('.tabbed-controls')) {
        const _rt = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
        const htmlContent = await _rt("modules/soruta-completed-westmarch/templates/chat/tabbedchatlog-nav.hbs", {
            activetab: tabSelected
        });
        $(html).prepend(htmlContent);

        $('.tabbed-controls').on('click', '.ui-control', function() {
            changeTab($(this).data('tab'));
        });

        changeTab("IC");
    }

    // Réinjecter les boutons GM à chaque re-render (la sidebar efface les
    // éléments injectés, y compris le capture listener sur le bouton export).
    // Délai 300ms : #chat-controls est rendu par la Sidebar après le ChatLog.
    if (game.user?.isGM) {
        setTimeout(_injectPartyChatButtons, 300);
    }
}

// ============================================================
// SECTION : Gestion des messages de party (GM)
// - Vider uniquement les messages de la party courante
// - Export / Import JSON pour sauvegarde/restauration
// ============================================================

function _injectPartyChatButtons() {
    // Supprimer les anciens boutons (re-render repart de zéro).
    document.querySelectorAll('[data-wm-action]').forEach(el => el.remove());
    try { if (game.settings.get(MOD, "enableChatTools") === false) return; } catch {}

    // En v13, les contrôles sont dans .control-buttons (dans #chat-controls).
    // On cherche depuis document car le footer est rendu par la Sidebar parente,
    // pas par le ChatLog — il n'est pas dans log.element au moment du hook.
    const controlButtons = document.querySelector('#chat-controls .control-buttons, .control-buttons');
    if (!controlButtons) {
        journal.critique("[westmarch] Boutons party chat : .control-buttons introuvable.");
        return;
    }
    const $controlButtons = $(controlButtons);

    const $btnClear  = _makePartyBtn("clearParty",  "fa-users-slash", tl("Effacer les messages de ma party uniquement"));
    const $btnImport = _makePartyBtn("importParty", "fa-file-import",  tl("Importer des messages (JSON / .txt)"));

    // Ajout de nos deux boutons à la fin de la rangée native (une seule ligne,
    // sans forcer de wrap ni de débordement — évite les boutons flottant sur la carte).
    controlButtons.appendChild($btnImport[0]);
    controlButtons.appendChild($btnClear[0]);

    // stopPropagation : empêche Foundry d'intercepter le clic via sa gestion
    // des .ui-control (qui ouvrirait le FilePicker natif → "map" au lieu du JSON).
    $btnClear.on("click",  (e) => { e.stopPropagation(); e.preventDefault(); _clearPartyMessages(); });
    $btnImport.on("click", (e) => { e.stopPropagation(); e.preventDefault(); _importPartyChatJSON(); });

    // Intercepter le bouton export natif (floppy disk) pour proposer txt ou JSON.
    // Listener en capture sur le conteneur parent → priorité sur le handler Foundry.
    let _skipExport = false;
    controlButtons.addEventListener("click", async (e) => {
        const btn = e.target.closest('button[data-action="export"]');
        if (!btn || _skipExport) return;
        e.stopPropagation();
        e.preventDefault();

        const choice = await foundry.applications.api.DialogV2.wait({
            window: { title: tl("Exporter le chat") },
            content: `<p>${tl("Choisir le format d'export :")}</p>`,
            buttons: [
                { label: "Texte (.txt)",              action: "txt",  default: true },
                { label: tl("JSON (mise en forme complète)"), action: "json" },
                { label: tl("Annuler"),                   action: "cancel" },
            ],
            rejectClose: false,
        });

        if (!choice || choice === "cancel") return;
        if (choice === "txt") {
            // Relancer le clic natif en court-circuitant notre intercepteur
            _skipExport = true;
            btn.click();
            _skipExport = false;
        } else {
            await _exportPartyChatJSON();
        }
    }, { capture: true });
}

function _makePartyBtn(action, iconClass, title) {
    // Style v13 : icône FA directement comme classe sur le bouton (comme fa-trash, fa-filter…)
    return $(`<button type="button" class="ui-control icon fa-solid ${iconClass} wm-party-btn" data-wm-action="${action}" data-tooltip="${title}" aria-label="${title}"></button>`);
}

async function _clearPartyMessages() {
    const myPartyId = game.user.getFlag(MOD, "partyId");
    if (!myPartyId) {
        ui.notifications.warn(tl("Tu n'as pas de party configurée. Utilise le bouton de suppression standard."));
        return;
    }

    const toDelete = game.messages
        .filter(m => m.author?.getFlag(MOD, "partyId") === myPartyId)
        .map(m => m.id);

    if (!toDelete.length) {
        ui.notifications.info(tl("Aucun message de ta party à effacer."));
        return;
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: tl("Effacer les messages de ma party") },
        content: `<p>${tl("Supprimer <strong>{0} message(s)</strong> de ta party uniquement ?", toDelete.length)}</p>
                  <p>${tl("<em>Les messages des autres parties resteront intacts.</em>")}</p>`,
    });
    if (!confirmed) return;

    await ChatMessage.deleteDocuments(toDelete);
}

async function _importPartyChatJSON() {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".txt,.json";
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return resolve();
            try {
                const text = await file.text();
                let data;

                if (file.name.endsWith(".json")) {
                    // JSON exporté par notre outil → style et mise en forme préservés
                    const raw = JSON.parse(text);
                    if (!Array.isArray(raw)) throw new Error(tl("Le fichier JSON ne contient pas un tableau de messages."));
                    data = raw.map(({ _id, ...rest }) => rest);

                    if (!data.length) { ui.notifications.warn(tl("Aucun message trouvé.")); return resolve(); }
                    await ChatMessage.createDocuments(data);
                    ui.notifications.info(tl("{0} message(s) importé(s).", data.length));
                    return resolve();
                }

                // Format export natif Foundry (.txt) — texte brut, style à choisir
                data = _parseFoundryExport(text);
                if (!data.length) {
                    ui.notifications.warn(tl("Aucun message trouvé dans le fichier."));
                    return resolve();
                }

                const tab = await foundry.applications.api.DialogV2.wait({
                    window: { title: `Importer ${data.length} message(s)` },
                    content: `<p>${tl("Dans quel onglet importer les messages ?")}</p>`,
                    buttons: [
                        { label: tl("Personnages"), action: "ic"    },
                        { label: tl("Rolls"),       action: "other", default: true },
                        { label: tl("Joueurs"),     action: "ooc"   },
                        { label: tl("Annuler"),     action: "cancel" },
                    ],
                    rejectClose: false,
                });
                if (!tab || tab === "cancel") return resolve();

                const styleMap = {
                    ic:    CONST.CHAT_MESSAGE_STYLES.IC,
                    other: CONST.CHAT_MESSAGE_STYLES.OTHER,
                    ooc:   CONST.CHAT_MESSAGE_STYLES.OOC,
                };
                const toCreate = data.map(m => ({ ...m, style: styleMap[tab] ?? CONST.CHAT_MESSAGE_STYLES.OTHER }));
                await ChatMessage.createDocuments(toCreate);
                ui.notifications.info(tl("{0} message(s) importé(s).", toCreate.length));
            } catch (err) {
                ui.notifications.error(`Erreur d'import : ${err.message}`);
                journal.erreur("[westmarch] Import chat :", err);
            }
            resolve();
        };
        input.click();
    });
}

// Export JSON des messages de la party (mise en forme complète préservée).
async function _exportPartyChatJSON() {
    const myPartyId = game.user.getFlag(MOD, "partyId");
    const messages  = myPartyId
        ? game.messages.filter(m => m.author?.getFlag(MOD, "partyId") === myPartyId)
        : [...game.messages];

    if (!messages.length) {
        ui.notifications.warn(tl("Aucun message à exporter."));
        return;
    }

    const data = messages.map(m => m.toObject());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/octet-stream" });
    const url  = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `chat-${game.world?.id ?? "world"}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(tl("{0} message(s) exporté(s) en JSON.", messages.length));
}

// Parse le fichier .txt produit par l'export natif Foundry.
// Format réel :
//   [7/27/2026, 6:14:19 PM] Nom GM
//   contenu ligne 1
//   contenu ligne 2
//   ---------------------------
function _parseFoundryExport(text) {
    const messages = [];

    // Séparateur : ligne de tirets (au moins 3)
    const blocks = text.split(/\n-{3,}\n?/).map(b => b.trim()).filter(Boolean);

    for (const block of blocks) {
        const lines = block.split("\n");
        if (!lines.length) continue;

        // Première ligne : [timestamp] Nom [role optionnel]
        const headerMatch = lines[0].match(/^\[(.+?)\]\s+(.+)$/);
        if (!headerMatch) continue;

        const [, timeStr, authorRaw] = headerMatch;
        // Supprimer le suffixe de rôle Foundry (GM, Trusted, Assistant GM…)
        const alias = authorRaw.replace(/\s+(GM|Trusted|Player|Assistant\s+GM)$/i, "").trim() || authorRaw.trim();

        // Contenu = toutes les lignes suivantes
        const content = lines.slice(1).join("\n").trim();
        if (!content) continue;

        // Chercher l'utilisateur par nom exact, puis par préfixe du champ brut
        const user = game.users.find(u => u.name === alias)
                  ?? game.users.find(u => authorRaw.toLowerCase().startsWith(u.name.toLowerCase()));

        messages.push({
            content,
            speaker:   { alias },
            user:      user?.id ?? game.user.id,
            timestamp: new Date(timeStr).getTime() || Date.now(),
            style:     CONST.CHAT_MESSAGE_STYLES.IC,
        });
    }

    return messages;
}

function changeTab(tab) {
    tabSelected = tab;
    $('.tabbed-controls').find('.ui-control').attr('aria-pressed', "false");
    $('.tabbed-controls').find('.'+tab).attr('aria-pressed', "true");
    var lastMessage = undefined;
    $.each($('.chat-message'), function(i, item){
        let message = game.messages.get($(item).data('message-id'));
        if(Object.keys(CONST.CHAT_MESSAGE_STYLES).find(key => CONST.CHAT_MESSAGE_STYLES[key] === message.style) == tab && isPartyMember(message.author)) {
            $(item).show();
            lastMessage = message;
        } else {
            $(item).hide();
        }
    });
    if (lastMessage) {
        const lastElement = $(`.chat-message[data-message-id="${lastMessage.id}"]`);
        if (lastElement.length) {
          lastElement[0].scrollIntoView({ behavior: "smooth", block: "end" });
        }
      }
    $('#'+tab+'Notification').hide();
}

function isPartyMember(user) {
    return user.getFlag(MOD, "partyId") == game.user.getFlag(MOD, "partyId") || !game.user.getFlag(MOD, "partyId");
}
