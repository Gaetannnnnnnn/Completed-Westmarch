import { MOD } from "./const.js";
import { partyFeatureEnabled } from './settings.js';
import { registerSoundFilter } from './audio.js';

var tabSelected = "IC";
var turndown = undefined;

export function ChatHooks() {
    Hooks.on("renderChatMessageHTML", (message, html, messageData) => renderChatMessageHTML(message, html, messageData));
    Hooks.on("renderChatLog", async (log, html, data) => await renderChatLog(log, html, data));
    Hooks.on("renderSceneConfig", (app, html, data) => renderSceneConfig(app, html, data));
    Hooks.on("chatMessage", (chatLog, message, chatData) => chatMessage(chatLog, message, chatData));

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

    turndown = new TurndownService();
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
    if (!document.querySelector('.tabbed-controls')) {
        const _rt = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
        const htmlContent = await _rt("modules/westmarch/templates/chat/tabbedchatlog-nav.hbs", {
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

// ============================================================
// SECTION : Webhook Discord par scène
// - Envoie les messages IC vers un webhook Discord configuré sur la scène
// - Le webhook se configure via clic droit sur une scène → Configuration
// ============================================================
function renderSceneConfig(app, html, data) {
    if (!game.settings.get(MOD, "enableWebhook")) return;

    $(html).find('.form-group')[2].insertAdjacentHTML('afterend', ('<div class="form-group"><label>WebHook</label><div class="form-fields"><input type="text" name="flags.webhook" value="'+app.object.getFlag(MOD, "webhook")+'"></div></div>'));
    $(html).find('input[name="flags.webhook"]').on('change', function() {
        app.object.setFlag(MOD, "webhook", $(this).val());
    });
}

function chatMessage(chatLog, message, chatData) {
    if (!game.settings.get(MOD, "enableWebhook")) return;

    if(chatData.speaker.actor == null)
        return;

    var webhook = game.scenes.get(game.users.get(chatData.user).viewedScene).getFlag(MOD, "webhook")
    if(webhook && message) {
        let content = turndown.turndown(message);
        let data = {
            content: content,
            username: chatData.speaker.alias,
            avatar_url: game.data.addresses.remote + "/" + game.actors.get(chatData.speaker.actor).img
        };
        fetch(webhook, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
    }
}

//#region Turndown

var TurndownService = (function () {
    'use strict';

    function extend(destination) {
        for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i];
            for (var key in source) {
                if (source.hasOwnProperty(key)) destination[key] = source[key];
            }
        }
        return destination
    }

    function repeat(character, count) {
        return Array(count + 1).join(character)
    }

    var blockElements = [
        'address', 'article', 'aside', 'audio', 'blockquote', 'body', 'canvas',
        'center', 'dd', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
        'figure', 'footer', 'form', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'header', 'hgroup', 'hr', 'html', 'isindex', 'li', 'main', 'menu', 'nav',
        'noframes', 'noscript', 'ol', 'output', 'p', 'pre', 'section', 'table',
        'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
    ];

    function isBlock(node) {
        return blockElements.indexOf(node.nodeName.toLowerCase()) !== -1
    }

    var voidElements = [
        'area', 'base', 'br', 'col', 'command', 'embed', 'hr', 'img', 'input',
        'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'
    ];

    function isVoid(node) {
        return voidElements.indexOf(node.nodeName.toLowerCase()) !== -1
    }

    var voidSelector = voidElements.join();

    function hasVoid(node) {
        return node.querySelector && node.querySelector(voidSelector)
    }

    var rules = {};

    rules.paragraph = {
        filter: 'p',
        replacement: function (content) {
            return '\n\n' + content + '\n\n'
        }
    };

    rules.lineBreak = {
        filter: 'br',
        replacement: function (content, node, options) {
            return options.br + '\n'
        }
    };

    rules.heading = {
        filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        replacement: function (content, node, options) {
            var hLevel = Number(node.nodeName.charAt(1));
            if (options.headingStyle === 'setext' && hLevel < 3) {
                var underline = repeat((hLevel === 1 ? '=' : '-'), content.length);
                return '\n\n' + content + '\n' + underline + '\n\n'
            } else {
                return '\n\n' + repeat('#', hLevel) + ' ' + content + '\n\n'
            }
        }
    };

    rules.blockquote = {
        filter: 'blockquote',
        replacement: function (content) {
            content = content.replace(/^\n+|\n+$/g, '');
            content = content.replace(/^/gm, '> ');
            return '\n\n' + content + '\n\n'
        }
    };

    rules.list = {
        filter: ['ul', 'ol'],
        replacement: function (content, node) {
            var parent = node.parentNode;
            if (parent.nodeName === 'LI' && parent.lastElementChild === node) {
                return '\n' + content
            } else {
                return '\n\n' + content + '\n\n'
            }
        }
    };

    rules.listItem = {
        filter: 'li',
        replacement: function (content, node, options) {
            content = content
                .replace(/^\n+/, '')
                .replace(/\n+$/, '\n')
                .replace(/\n/gm, '\n    ');
            var prefix = options.bulletListMarker + '   ';
            var parent = node.parentNode;
            if (parent.nodeName === 'OL') {
                var start = parent.getAttribute('start');
                var index = Array.prototype.indexOf.call(parent.children, node);
                prefix = (start ? Number(start) + index : index + 1) + '.  ';
            }
            return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '')
        }
    };

    rules.indentedCodeBlock = {
        filter: function (node, options) {
            return (
                options.codeBlockStyle === 'indented' &&
                node.nodeName === 'PRE' &&
                node.firstChild &&
                node.firstChild.nodeName === 'CODE'
            )
        },
        replacement: function (content, node, options) {
            return '\n\n    ' + node.firstChild.textContent.replace(/\n/g, '\n    ') + '\n\n'
        }
    };

    rules.fencedCodeBlock = {
        filter: function (node, options) {
            return (
                options.codeBlockStyle === 'fenced' &&
                node.nodeName === 'PRE' &&
                node.firstChild &&
                node.firstChild.nodeName === 'CODE'
            )
        },
        replacement: function (content, node, options) {
            var className = node.firstChild.className || '';
            var language = (className.match(/language-(\S+)/) || [null, ''])[1];
            var code = node.firstChild.textContent;
            var fenceChar = options.fence.charAt(0);
            var fenceSize = 3;
            var fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm');
            var match;
            while ((match = fenceInCodeRegex.exec(code))) {
                if (match[0].length >= fenceSize) {
                    fenceSize = match[0].length + 1;
                }
            }
            var fence = repeat(fenceChar, fenceSize);
            return '\n\n' + fence + language + '\n' + code.replace(/\n$/, '') + '\n' + fence + '\n\n'
        }
    };

    rules.horizontalRule = {
        filter: 'hr',
        replacement: function (content, node, options) {
            return '\n\n' + options.hr + '\n\n'
        }
    };

    rules.inlineLink = {
        filter: function (node, options) {
            return (
                options.linkStyle === 'inlined' &&
                node.nodeName === 'A' &&
                node.getAttribute('href')
            )
        },
        replacement: function (content, node) {
            var href = node.getAttribute('href');
            var title = node.title ? ' "' + node.title + '"' : '';
            return '[' + content + '](' + href + title + ')'
        }
    };

    rules.referenceLink = {
        filter: function (node, options) {
            return (
                options.linkStyle === 'referenced' &&
                node.nodeName === 'A' &&
                node.getAttribute('href')
            )
        },
        replacement: function (content, node, options) {
            var href = node.getAttribute('href');
            var title = node.title ? ' "' + node.title + '"' : '';
            var replacement;
            var reference;
            switch (options.linkReferenceStyle) {
                case 'collapsed':
                    replacement = '[' + content + '][]';
                    reference = '[' + content + ']: ' + href + title;
                    break
                case 'shortcut':
                    replacement = '[' + content + ']';
                    reference = '[' + content + ']: ' + href + title;
                    break
                default:
                    var id = this.references.length + 1;
                    replacement = '[' + content + '][' + id + ']';
                    reference = '[' + id + ']: ' + href + title;
            }
            this.references.push(reference);
            return replacement
        },
        references: [],
        append: function (options) {
            var references = '';
            if (this.references.length) {
                references = '\n\n' + this.references.join('\n') + '\n\n';
                this.references = [];
            }
            return references
        }
    };

    rules.emphasis = {
        filter: ['em', 'i'],
        replacement: function (content, node, options) {
            if (!content.trim()) return ''
            return options.emDelimiter + content + options.emDelimiter
        }
    };

    rules.strong = {
        filter: ['strong', 'b'],
        replacement: function (content, node, options) {
            if (!content.trim()) return ''
            return options.strongDelimiter + content + options.strongDelimiter
        }
    };

    rules.code = {
        filter: function (node) {
            var hasSiblings = node.previousSibling || node.nextSibling;
            var isCodeBlock = node.parentNode.nodeName === 'PRE' && !hasSiblings;
            return node.nodeName === 'CODE' && !isCodeBlock
        },
        replacement: function (content) {
            if (!content.trim()) return ''
            var delimiter = '`';
            var leadingSpace = '';
            var trailingSpace = '';
            var matches = content.match(/`+/gm);
            if (matches) {
                if (/^`/.test(content)) leadingSpace = ' ';
                if (/`$/.test(content)) trailingSpace = ' ';
                while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + '`';
            }
            return delimiter + leadingSpace + content + trailingSpace + delimiter
        }
    };

    rules.image = {
        filter: 'img',
        replacement: function (content, node) {
            var alt = node.alt || '';
            var src = node.getAttribute('src') || '';
            var title = node.title || '';
            var titlePart = title ? ' "' + title + '"' : '';
            return src ? '![' + alt + ']' + '(' + src + titlePart + ')' : ''
        }
    };

    function Rules(options) {
        this.options = options;
        this._keep = [];
        this._remove = [];
        this.blankRule = { replacement: options.blankReplacement };
        this.keepReplacement = options.keepReplacement;
        this.defaultRule = { replacement: options.defaultReplacement };
        this.array = [];
        for (var key in options.rules) this.array.push(options.rules[key]);
    }

    Rules.prototype = {
        add: function (key, rule) { this.array.unshift(rule); },
        keep: function (filter) { this._keep.unshift({ filter: filter, replacement: this.keepReplacement }); },
        remove: function (filter) { this._remove.unshift({ filter: filter, replacement: function () { return '' } }); },
        forNode: function (node) {
            if (node.isBlank) return this.blankRule
            var rule;
            if ((rule = findRule(this.array, node, this.options))) return rule
            if ((rule = findRule(this._keep, node, this.options))) return rule
            if ((rule = findRule(this._remove, node, this.options))) return rule
            return this.defaultRule
        },
        forEach: function (fn) { for (var i = 0; i < this.array.length; i++) fn(this.array[i], i); }
    };

    function findRule(rules, node, options) {
        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i];
            if (filterValue(rule, node, options)) return rule
        }
        return void 0
    }

    function filterValue(rule, node, options) {
        var filter = rule.filter;
        if (typeof filter === 'string') {
            if (filter === node.nodeName.toLowerCase()) return true
        } else if (Array.isArray(filter)) {
            if (filter.indexOf(node.nodeName.toLowerCase()) > -1) return true
        } else if (typeof filter === 'function') {
            if (filter.call(rule, node, options)) return true
        } else {
            throw new TypeError('`filter` needs to be a string, array, or function')
        }
    }

    function collapseWhitespace(options) {
        var element = options.element;
        var isBlock = options.isBlock;
        var isVoid = options.isVoid;
        var isPre = options.isPre || function (node) { return node.nodeName === 'PRE' };
        if (!element.firstChild || isPre(element)) return
        var prevText = null;
        var prevVoid = false;
        var prev = null;
        var node = next(prev, element, isPre);
        while (node !== element) {
            if (node.nodeType === 3 || node.nodeType === 4) {
                var text = node.data.replace(/[ \r\n\t]+/g, ' ');
                if ((!prevText || / $/.test(prevText.data)) && !prevVoid && text[0] === ' ') {
                    text = text.substr(1);
                }
                if (!text) { node = remove(node); continue }
                node.data = text;
                prevText = node;
            } else if (node.nodeType === 1) {
                if (isBlock(node) || node.nodeName === 'BR') {
                    if (prevText) { prevText.data = prevText.data.replace(/ $/, ''); }
                    prevText = null;
                    prevVoid = false;
                } else if (isVoid(node)) {
                    prevText = null;
                    prevVoid = true;
                }
            } else {
                node = remove(node);
                continue
            }
            var nextNode = next(prev, node, isPre);
            prev = node;
            node = nextNode;
        }
        if (prevText) {
            prevText.data = prevText.data.replace(/ $/, '');
            if (!prevText.data) { remove(prevText); }
        }
    }

    function remove(node) {
        var next = node.nextSibling || node.parentNode;
        node.parentNode.removeChild(node);
        return next
    }

    function next(prev, current, isPre) {
        if ((prev && prev.parentNode === current) || isPre(current)) {
            return current.nextSibling || current.parentNode
        }
        return current.firstChild || current.nextSibling || current.parentNode
    }

    var root = (typeof window !== 'undefined' ? window : {});

    function canParseHTMLNatively() {
        var Parser = root.DOMParser;
        var canParse = false;
        try {
            if (new Parser().parseFromString('', 'text/html')) { canParse = true; }
        } catch (e) {}
        return canParse
    }

    function createHTMLParser() {
        var Parser = function () {};
        if (shouldUseActiveX()) {
            Parser.prototype.parseFromString = function (string) {
                var doc = new window.ActiveXObject('htmlfile');
                doc.designMode = 'on';
                doc.open();
                doc.write(string);
                doc.close();
                return doc
            };
        } else {
            Parser.prototype.parseFromString = function (string) {
                var doc = document.implementation.createHTMLDocument('');
                doc.open();
                doc.write(string);
                doc.close();
                return doc
            };
        }
        return Parser
    }

    function shouldUseActiveX() {
        var useActiveX = false;
        try {
            document.implementation.createHTMLDocument('').open();
        } catch (e) {
            if (window.ActiveXObject) useActiveX = true;
        }
        return useActiveX
    }

    var HTMLParser = canParseHTMLNatively() ? root.DOMParser : createHTMLParser();

    function RootNode(input) {
        var root;
        if (typeof input === 'string') {
            var doc = htmlParser().parseFromString(
                '<x-turndown id="turndown-root">' + input + '</x-turndown>',
                'text/html'
            );
            root = doc.getElementById('turndown-root');
        } else {
            root = input.cloneNode(true);
        }
        collapseWhitespace({ element: root, isBlock: isBlock, isVoid: isVoid });
        return root
    }

    var _htmlParser;
    function htmlParser() {
        _htmlParser = _htmlParser || new HTMLParser();
        return _htmlParser
    }

    function Node(node) {
        node.isBlock = isBlock(node);
        node.isCode = node.nodeName.toLowerCase() === 'code' || node.parentNode.isCode;
        node.isBlank = isBlank(node);
        node.flankingWhitespace = flankingWhitespace(node);
        return node
    }

    function isBlank(node) {
        return (
            ['A', 'TH', 'TD', 'IFRAME', 'SCRIPT', 'AUDIO', 'VIDEO'].indexOf(node.nodeName) === -1 &&
            /^\s*$/i.test(node.textContent) &&
            !isVoid(node) &&
            !hasVoid(node)
        )
    }

    function flankingWhitespace(node) {
        var leading = '';
        var trailing = '';
        if (!node.isBlock) {
            var hasLeading = /^\s/.test(node.textContent);
            var hasTrailing = /\s$/.test(node.textContent);
            var blankWithSpaces = node.isBlank && hasLeading && hasTrailing;
            if (hasLeading && !isFlankedByWhitespace('left', node)) { leading = ' '; }
            if (!blankWithSpaces && hasTrailing && !isFlankedByWhitespace('right', node)) { trailing = ' '; }
        }
        return {leading: leading, trailing: trailing}
    }

    function isFlankedByWhitespace(side, node) {
        var sibling;
        var regExp;
        var isFlanked;
        if (side === 'left') { sibling = node.previousSibling; regExp = / $/; }
        else { sibling = node.nextSibling; regExp = /^ /; }
        if (sibling) {
            if (sibling.nodeType === 3) { isFlanked = regExp.test(sibling.nodeValue); }
            else if (sibling.nodeType === 1 && !isBlock(sibling)) { isFlanked = regExp.test(sibling.textContent); }
        }
        return isFlanked
    }

    var reduce = Array.prototype.reduce;
    var leadingNewLinesRegExp = /^\n*/;
    var trailingNewLinesRegExp = /\n*$/;
    var escapes = [
        [/\\/g, '\\\\'], [/\*/g, '\\*'], [/^-/g, '\\-'], [/^\+ /g, '\\+ '],
        [/^(=+)/g, '\\$1'], [/^(#{1,6}) /g, '\\$1 '], [/`/g, '\\`'],
        [/^~~~/g, '\\~~~'], [/\[/g, '\\['], [/\]/g, '\\]'], [/^>/g, '\\>'],
        [/_/g, '\\_'], [/^(\d+)\. /g, '$1\\. ']
    ];

    function TurndownService(options) {
        if (!(this instanceof TurndownService)) return new TurndownService(options)
        var defaults = {
            rules: rules, headingStyle: 'setext', hr: '* * *',
            bulletListMarker: '*', codeBlockStyle: 'indented', fence: '```',
            emDelimiter: '_', strongDelimiter: '**', linkStyle: 'inlined',
            linkReferenceStyle: 'full', br: '  ',
            blankReplacement: function (content, node) { return node.isBlock ? '\n\n' : '' },
            keepReplacement: function (content, node) { return node.isBlock ? '\n\n' + node.outerHTML + '\n\n' : node.outerHTML },
            defaultReplacement: function (content, node) { return node.isBlock ? '\n\n' + content + '\n\n' : content }
        };
        this.options = extend({}, defaults, options);
        this.rules = new Rules(this.options);
    }

    TurndownService.prototype = {
        turndown: function (input) {
            if (!canConvert(input)) { throw new TypeError(input + ' is not a string, or an element/document/fragment node.') }
            if (input === '') return ''
            var output = process.call(this, new RootNode(input));
            return postProcess.call(this, output)
        },
        use: function (plugin) {
            if (Array.isArray(plugin)) { for (var i = 0; i < plugin.length; i++) this.use(plugin[i]); }
            else if (typeof plugin === 'function') { plugin(this); }
            else { throw new TypeError('plugin must be a Function or an Array of Functions') }
            return this
        },
        addRule: function (key, rule) { this.rules.add(key, rule); return this },
        keep: function (filter) { this.rules.keep(filter); return this },
        remove: function (filter) { this.rules.remove(filter); return this },
        escape: function (string) {
            return escapes.reduce(function (accumulator, escape) {
                return accumulator.replace(escape[0], escape[1])
            }, string)
        }
    };

    function process(parentNode) {
        var self = this;
        return reduce.call(parentNode.childNodes, function (output, node) {
            node = new Node(node);
            var replacement = '';
            if (node.nodeType === 3) { replacement = node.isCode ? node.nodeValue : self.escape(node.nodeValue); }
            else if (node.nodeType === 1) { replacement = replacementForNode.call(self, node); }
            return join(output, replacement)
        }, '')
    }

    function postProcess(output) {
        var self = this;
        this.rules.forEach(function (rule) {
            if (typeof rule.append === 'function') { output = join(output, rule.append(self.options)); }
        });
        return output.replace(/^[\t\r\n]+/, '').replace(/[\t\r\n\s]+$/, '')
    }

    function replacementForNode(node) {
        var rule = this.rules.forNode(node);
        var content = process.call(this, node);
        var whitespace = node.flankingWhitespace;
        if (whitespace.leading || whitespace.trailing) content = content.trim();
        return whitespace.leading + rule.replacement(content, node, this.options) + whitespace.trailing
    }

    function separatingNewlines(output, replacement) {
        var newlines = [
            output.match(trailingNewLinesRegExp)[0],
            replacement.match(leadingNewLinesRegExp)[0]
        ].sort();
        var maxNewlines = newlines[newlines.length - 1];
        return maxNewlines.length < 2 ? maxNewlines : '\n\n'
    }

    function join(string1, string2) {
        var separator = separatingNewlines(string1, string2);
        string1 = string1.replace(trailingNewLinesRegExp, '');
        string2 = string2.replace(leadingNewLinesRegExp, '');
        return string1 + separator + string2
    }

    function canConvert(input) {
        return (
            input != null && (
                typeof input === 'string' ||
                (input.nodeType && (input.nodeType === 1 || input.nodeType === 9 || input.nodeType === 11))
            )
        )
    }

    return TurndownService;

}());

//#endregion