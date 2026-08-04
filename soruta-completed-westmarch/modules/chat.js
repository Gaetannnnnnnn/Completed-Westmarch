import { MOD } from "./const.js";
import { partyFeatureEnabled } from './settings.js';
import { registerSoundFilter } from './audio.js';

var tabSelected = "IC";

export function ChatHooks() {
    Hooks.on("renderChatMessageHTML", (message, html, messageData) => renderChatMessageHTML(message, html, messageData));
    Hooks.on("renderChatLog", async (log, html, data) => await renderChatLog(log, html, data));

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
    if (!partyFeatureEnabled("enableChatFilter")) return;

    if(!isPartyMember(message.author)) {
        $(html).hide();
    }
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
    if (partyFeatureEnabled("enableChatFilter") && !document.querySelector('.tabbed-controls')) {
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

    // Forcer flex-wrap via style inline : priorité absolue, résiste à
    // !important dans les feuilles de style Foundry ou autres modules.
    controlButtons.style.flexWrap  = 'wrap';
    controlButtons.style.height    = 'auto';
    controlButtons.style.maxHeight = 'none';
    controlButtons.style.overflow  = 'visible';
    if (controlButtons.parentElement) {
        controlButtons.parentElement.style.height    = 'auto';
        controlButtons.parentElement.style.maxHeight = 'none';
        controlButtons.parentElement.style.overflow  = 'visible';
    }

    // Architecture 2 lignes via manipulation DOM directe.
    // On déplace physiquement les 3 derniers boutons natifs (filter, export, flush)
    // APRÈS le break dans le DOM. flex-wrap + flex-basis:100% sur le break
    // suffisent à les pousser en ligne 2 — pas besoin de CSS `order`.
    //
    // Résultat DOM dans .control-buttons :
    //   [autres boutons natifs...] [break] [filter] [floppy] [trash] [import] [clear]
    // Résultat visuel :
    //   ligne 1 : boutons avant le break (modes de jet ou conteneur frère)
    //   ligne 2 : filter | floppy | trash | import | clear
    const breakEl = document.createElement("div");
    breakEl.className = "wm-party-break";
    breakEl.setAttribute("data-wm-action", "break");

    const nativeBtns = [...controlButtons.querySelectorAll('button:not([data-wm-action])')];
    const actionBtns = nativeBtns.slice(-3); // filter, floppy, trash

    // 1. Appendre le break après les boutons actuellement en place.
    controlButtons.appendChild(breakEl);
    // 2. Déplacer (pas copier) filter/floppy/trash après le break.
    //    appendChild sur un élément déjà dans le DOM le déplace.
    actionBtns.forEach(btn => controlButtons.appendChild(btn));
    // 3. Nos boutons en fin de ligne 2.
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
