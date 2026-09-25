import { MOD } from "./const.js";
import { partyFeatureEnabled } from './settings.js';
import { registerSoundFilter } from './audio.js';

var tabSelected = "IC";

// ── Habillage des cartes de chat (thème + couleur par joueur) ──
// Pose/retire body.scwm-chat-theme selon le réglage monde, et calcule les
// couleurs de texte lisibles selon la couleur de fond choisie par le joueur.
function _luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// CSS injecté en JS : plus fiable que le fichier du manifeste (sur certains
// hébergements comme The Forge, un NOUVEAU fichier .css d'un module n'est pas
// injecté sans relancer le monde). Ici, le style suit toujours le code.
const CHAT_CARDS_CSS = `
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message {
    --dnd5e-chat-background: var(--scwm-chat-bg);
    --dnd5e-border-gold: 1px solid var(--scwm-chat-gold);
    --dnd5e-background-card: rgba(255,255,255,0.35);
    --dnd5e-chat-button-background: rgba(154,123,30,0.12);
    --dnd5e-chat-button-border: rgba(154,123,30,0.5);
    --color-text-primary: var(--scwm-chat-fg);
    --color-text-secondary: var(--scwm-chat-fg2);
    --color-text-tertiary: var(--scwm-chat-fg2);
    background: var(--scwm-chat-bg) !important;
    color: var(--scwm-chat-fg) !important;
    box-shadow: 0 2px 10px rgba(0,0,0,0.35);
}
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .title { color: var(--scwm-chat-gold); text-shadow: none; }
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .subtitle { color: var(--scwm-chat-fg2); }
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .message-sender .avatar:not(.token) img,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .description .summary > img {
    border: 1px solid var(--scwm-chat-gold) !important; border-radius: 4px; box-shadow: 0 0 5px rgba(0,0,0,0.3);
}
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons { display:flex; flex-direction:column; gap: 6px; }
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons > button,
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons > a,
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons button,
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons a[data-action] {
    display: flex; align-items: center; justify-content: center;
    box-sizing: border-box;
    border: 1px solid rgba(154,123,30,0.6);
    background: linear-gradient(180deg, rgba(154,123,30,0.20), rgba(154,123,30,0.06));
    color: var(--scwm-chat-fg, inherit) !important; border-radius: 6px; font-weight: 700;
    width: 100%; min-height: 38px; font-size: 14px; letter-spacing: .3px; text-decoration: none;
    transition: box-shadow .15s, background .15s, border-color .15s, color .15s;
}
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons > button:hover,
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons > a:hover,
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons button:hover,
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons a[data-action]:hover {
    border-color: #e67e22; background: rgba(230,126,34,0.16); box-shadow: 0 0 8px rgba(230,126,34,0.4);
}
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .pills .pill {
    border: 1px solid rgba(154,123,30,0.4); background: rgba(154,123,30,0.10); border-radius: 3px; color: var(--scwm-chat-fg);
}
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message p.supplement > strong { color: var(--scwm-chat-gold); }
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .description { box-shadow: inset 0 0 0 1px rgba(154,123,30,0.15); }
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .dice-total { border-color: rgba(154,123,30,0.45); }

/* « Sort listé 3 fois » : on masque l'en-tête répété (icône + nom) sur les
   cartes qui ne sont QU'UN JET (attaque/dégâts contiennent un .dice-result),
   pour ne garder l'en-tête complet que sur la carte principale du sort. */
body.scwm-chat :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message:has(.chat-card .dice-result) .chat-card > .card-header,
body.scwm-chat :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message:has(.dice-result) .card-header.description {
    display: none !important;
}

/* Résultat du jet AFFICHÉ SUR LA CARTE (fond crème) : texte foncé lisible.
   On NE touche PAS à la fenêtre de détail au survol (.dice-tooltip / .dice-rolls),
   qui a son propre fond sombre et doit garder son texte clair (sinon noir sur noir). */
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .dice-formula,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .dice-total,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .dice-result > .total > .value,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .dice-result > .total > .label {
    color: var(--scwm-chat-fg) !important;
}

/* ══════════════════════════════════════════════════════════════════════
   Look « dnd5e 5.3.3 » posé sur le DOM 6.0.3 : en-tête large avec grosse
   icône encadrée + titre gras + sous-titre italique, filets de séparation
   type parchemin, description ouverte et lisible, pied de page à filet.
   Portée : toutes les cartes d'objet (attaque, dégâts, sort, activité).
   ══════════════════════════════════════════════════════════════════════ */

/* Cadre général de la carte */
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card {
    border-radius: 5px;
    overflow: hidden;
}

/* En-tête 5.3.3 : icône + noms sur une ligne, séparé du corps par un filet */
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .card-header .summary,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card section.description > header.summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 2px 7px;
    margin: 0;
    border-bottom: 2px groove rgba(154,123,30,0.40);
}
/* Grosse icône encadrée gold (comme 5.3.3) */
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .summary > img {
    width: 40px !important;
    height: 40px !important;
    flex: 0 0 40px;
    object-fit: cover;
    border: 2px solid var(--scwm-chat-gold) !important;
    border-radius: 4px;
    box-shadow: 0 0 4px rgba(0,0,0,0.3);
}
/* Titre gras + sous-titre italique discret */
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .name-stacked { line-height: 1.15; }
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .title {
    font-size: 15px; font-weight: 700; letter-spacing: .2px;
}
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .subtitle {
    font-size: 11px; font-style: italic; opacity: .85;
}
/* Le chevron natif : discret, poussé à droite */
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .summary > i,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .summary > .collapser-icon {
    margin-left: auto; opacity: .55; font-size: 12px;
}

/* Description confortable et lisible (elle est ouverte par défaut, cf. JS) */
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .card-header .collapsible-content .details,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card section.description .collapsible-content-inner,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .card-content {
    padding: 7px 3px 3px;
    font-size: 13px;
    line-height: 1.42;
}

/* Pied de page à filet, tags espacés (5.3.3) */
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card .card-footer.pills,
body.scwm-chat-theme :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .chat-card ul.card-footer {
    border-top: 2px groove rgba(154,123,30,0.40);
    padding-top: 6px;
    margin-top: 4px;
    gap: 4px;
}

/* Boutons : un peu d'air au-dessus de la rangée large */
body.scwm-chat-bigbtn :is(#chat-log, .chat-log, .chat-popout, .chat-sidebar, #chat-notifications) .message .card-buttons { margin-top: 7px; }

`;

export function applyChatCardPrefs() {
    const body = document.body;
    if (!body) return;
    const get = (k, d) => { try { const v = game.settings.get(MOD, k); return v === undefined ? d : v; } catch { return d; } };

    const master = !!get("enableChatCards", true);
    const theme  = master && get("chatCardsTheme", true) !== false;
    const bigBtn = master && get("chatCardsBigButtons", true) !== false;

    body.classList.toggle("scwm-chat",        master);
    body.classList.toggle("scwm-chat-theme",  theme);
    body.classList.toggle("scwm-chat-bigbtn", bigBtn);

    const color = get("chatCardColor", "#f4ecd8") || "#f4ecd8";
    body.style.setProperty("--scwm-chat-bg", color);
    const dark = _luminance(color) < 0.5;   // fond sombre → texte clair
    body.style.setProperty("--scwm-chat-fg",  dark ? "#f2ead4" : "#2a2418");
    body.style.setProperty("--scwm-chat-fg2", dark ? "#c9bd99" : "#5c5240");
    body.style.setProperty("--scwm-chat-gold", dark ? "#e8cc6a" : "#9a7b1e");

    // Style injecté (fiable quel que soit l'hébergement). Toujours présent : ses
    // règles sont scopées par les classes body ci-dessus, donc sans effet si off.
    let st = document.getElementById("scwm-chat-cards-style");
    if (!st) { st = document.createElement("style"); st.id = "scwm-chat-cards-style"; document.head.appendChild(st); }
    if (st.textContent !== CHAT_CARDS_CSS) st.textContent = CHAT_CARDS_CSS;
}

export function ChatHooks() {
    Hooks.on("renderChatMessageHTML", (message, html, messageData) => renderChatMessageHTML(message, html, messageData));
    Hooks.on("renderChatLog", async (log, html, data) => await renderChatLog(log, html, data));

    Hooks.once("ready", () => applyChatCardPrefs());

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

}

export function ReloadChat() {
    changeTab(tabSelected);
}

// ============================================================
// SECTION : Filtrage des messages du chat par party
// - Les joueurs ne voient que les messages de leur party
// ============================================================
function renderChatMessageHTML(message, html, messageData) {
    // Look 5.3.3 : description ouverte par défaut + jets dépliés.
    try {
        if (game.settings.get(MOD, "enableChatCards")) {
            const root = html instanceof HTMLElement ? html : html?.[0];
            if (root) {
                // Ouvrir la description AVANT insertion dans le DOM (synchrone) :
                // la carte est peinte déjà ouverte, donc aucune animation/flash.
                // On retire seulement l'état « replié » : le chevron reste
                // fonctionnel (un clic ré-ajoute .collapsed → repli manuel).
                try {
                    root.querySelectorAll(
                        ".chat-card .card-header.collapsible.collapsed, .chat-card section.description.collapsible.collapsed"
                    ).forEach(s => s.classList.remove("collapsed"));
                } catch (e) {}
                // Déplier les jets de dés par défaut (dés + bonus + provenance).
                if (game.settings.get(MOD, "chatCardsExpandDice") !== false) {
                    requestAnimationFrame(() => {
                        try { root.querySelectorAll(".dice-roll:not(.expanded)").forEach(r => r.classList.add("expanded")); } catch (e) {}
                    });
                }
            }
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

    // En v13, les contrôles sont dans .control-buttons (dans #chat-controls).
    // On cherche depuis document car le footer est rendu par la Sidebar parente,
    // pas par le ChatLog — il n'est pas dans log.element au moment du hook.
    const controlButtons = document.querySelector('#chat-controls .control-buttons, .control-buttons');
    if (!controlButtons) {
        console.warn("[westmarch] Boutons party chat : .control-buttons introuvable.");
        return;
    }
    const $controlButtons = $(controlButtons);

    const $btnClear  = _makePartyBtn("clearParty",  "fa-users-slash", "Effacer les messages de ma party uniquement");
    const $btnImport = _makePartyBtn("importParty", "fa-file-import",  "Importer des messages (JSON / .txt)");

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
            window: { title: "Exporter le chat" },
            content: `<p>Choisir le format d'export :</p>`,
            buttons: [
                { label: "Texte (.txt)",              action: "txt",  default: true },
                { label: "JSON (mise en forme complète)", action: "json" },
                { label: "Annuler",                   action: "cancel" },
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
        ui.notifications.warn("Tu n'as pas de party configurée. Utilise le bouton de suppression standard.");
        return;
    }

    const toDelete = game.messages
        .filter(m => m.author?.getFlag(MOD, "partyId") === myPartyId)
        .map(m => m.id);

    if (!toDelete.length) {
        ui.notifications.info("Aucun message de ta party à effacer.");
        return;
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Effacer les messages de ma party" },
        content: `<p>Supprimer <strong>${toDelete.length} message(s)</strong> de ta party uniquement ?</p>
                  <p><em>Les messages des autres parties resteront intacts.</em></p>`,
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
                    if (!Array.isArray(raw)) throw new Error("Le fichier JSON ne contient pas un tableau de messages.");
                    data = raw.map(({ _id, ...rest }) => rest);

                    if (!data.length) { ui.notifications.warn("Aucun message trouvé."); return resolve(); }
                    await ChatMessage.createDocuments(data);
                    ui.notifications.info(`${data.length} message(s) importé(s).`);
                    return resolve();
                }

                // Format export natif Foundry (.txt) — texte brut, style à choisir
                data = _parseFoundryExport(text);
                if (!data.length) {
                    ui.notifications.warn("Aucun message trouvé dans le fichier.");
                    return resolve();
                }

                const tab = await foundry.applications.api.DialogV2.wait({
                    window: { title: `Importer ${data.length} message(s)` },
                    content: `<p>Dans quel onglet importer les messages ?</p>`,
                    buttons: [
                        { label: "Personnages", action: "ic"    },
                        { label: "Rolls",       action: "other", default: true },
                        { label: "Joueurs",     action: "ooc"   },
                        { label: "Annuler",     action: "cancel" },
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
                ui.notifications.info(`${toCreate.length} message(s) importé(s).`);
            } catch (err) {
                ui.notifications.error(`Erreur d'import : ${err.message}`);
                console.error("[westmarch] Import chat :", err);
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
        ui.notifications.warn("Aucun message à exporter.");
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
    ui.notifications.info(`${messages.length} message(s) exporté(s) en JSON.`);
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
