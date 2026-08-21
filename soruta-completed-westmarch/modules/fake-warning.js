import { MOD } from "./const.js";
// ============================================================
// fake-warning.js — Faux message de maintenance (farce GM)
// Ajoute un bouton dans la barre d'outils de gauche (icônes de
// contrôle de scène) qui permet au GM d'envoyer un faux message
// d'avertissement jaune ("mise à jour effectuée...") à un joueur
// précis, pour lui faire croire qu'un problème a été réglé.
// ============================================================

import { sendFakeWarning } from './serveur-socket.js';

const DEFAULT_MESSAGE = "Mise à jour effectuée — le problème devrait être résolu.";

export function FakeWarningHooks() {

    // Foundry v13 : "controls" est un objet (record) indexé par nom de
    // groupe, et non plus un tableau comme en v12. On crée notre propre
    // groupe MOD plutôt que d'aller modifier un groupe natif
    // (ex. "tokens"), dont la clé exacte peut varier selon la version.
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM) return;

        // En Foundry v13, le name du groupe DOIT correspondre à la clé dans
        // l'objet controls. onChange (et non onClick) est le bon callback pour
        // les outils button:true — onClick n'existe pas en v13 et est ignoré.
        // Pas besoin d'activeTool : sans lui le groupe s'ouvre normalement.
        // Guard pattern : ne pas écraser les outils déjà ajoutés par d'autres
        // modules (ex. carnet ajoute carnetDate avant celui du serveur en
        // raison de l'ordre alphabétique des IDs de module).
        if (!controls.westmarch) {
            controls.westmarch = {
                name:  "westmarch",
                title: "WestMarch",
                icon:  "fa-solid fa-hammer",
                layer: "tokens",
                tools: {}
            };
        }
        controls.westmarch.tools.fakeWarning = {
            name:     "fakeWarning",
            title:    "Faux message de maintenance",
            icon:     "fa-solid fa-triangle-exclamation",
            button:   true,
            onChange: () => openFakeWarningDialog(),
            visible:  true
        };
    });
}

function openFakeWarningDialog() {
    // Tous les utilisateurs connectés, sauf soi-même
    const targets = game.users.filter(u => u.active && u.id !== game.user.id);
    if (targets.length === 0) {
        ui.notifications.warn("Aucun autre utilisateur connecté.");
        return;
    }

    // Checkboxes groupées : GMs d'abord, puis joueurs
    const gms     = targets.filter(u => u.isGM);
    const players = targets.filter(u => !u.isGM);

    const renderGroup = (users, label) => {
        if (!users.length) return "";
        const rows = users.map(u => `
            <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;">
                <input type="checkbox" class="fw-target-cb" value="${u.id}">
                <span>${u.name}</span>
                ${u.isGM ? `<span style="font-size:10px;color:#c9a227;margin-left:2px;">(GM)</span>` : ""}
            </label>`).join("");
        return `<div style="margin-bottom:6px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;
                        color:#8a7a65;margin-bottom:4px;">${label}</div>
            ${rows}
        </div>`;
    };

    const checkboxes = renderGroup(gms, "GM") + renderGroup(players, "Joueurs");

    const selectAllBtn = `<button type="button" id="fw-select-all"
        style="font-size:11px;padding:2px 8px;border-radius:3px;
               border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);
               color:#ccc;cursor:pointer;">Tout sélectionner</button>`;

    new Dialog({
        title: "Faux message de maintenance",
        content: `
            <div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <strong>Destinataires :</strong>
                        ${selectAllBtn}
                    </div>
                    <div style="padding:6px 8px;border-radius:4px;
                                border:1px solid rgba(255,255,255,0.1);
                                background:rgba(0,0,0,0.15);max-height:160px;overflow-y:auto;">
                        ${checkboxes}
                    </div>
                </div>
                <div>
                    <label style="display:block;margin-bottom:4px;">
                        <strong>Message</strong> <span style="font-size:11px;color:#8a7a65;">(affiché en jaune)</span>
                    </label>
                    <textarea name="westmarch-fake-message" rows="3"
                              style="width:100%;resize:vertical;">${DEFAULT_MESSAGE}</textarea>
                </div>
            </div>
        `,
        render: (html) => {
            const $html = $(html);
            $html.find('#fw-select-all').on('click', function() {
                const cbs = $html.find('.fw-target-cb');
                const allChecked = cbs.toArray().every(cb => cb.checked);
                cbs.prop('checked', !allChecked);
                this.textContent = allChecked ? 'Tout sélectionner' : 'Tout décocher';
            });
        },
        buttons: {
            send: {
                icon:  '<i class="fa-solid fa-paper-plane"></i>',
                label: "Envoyer",
                callback: (html) => {
                    const $html   = $(html);
                    const message = $html.find('[name="westmarch-fake-message"]').val()?.trim();
                    if (!message) return;

                    const userIds = $html.find('.fw-target-cb:checked')
                        .toArray().map(cb => cb.value);
                    if (!userIds.length) {
                        ui.notifications.warn("Sélectionne au moins un destinataire.");
                        return;
                    }

                    const names = [];
                    for (const userId of userIds) {
                        sendFakeWarning(userId, message);
                        names.push(game.users.get(userId)?.name ?? "?");
                    }
                    ui.notifications.info(`Faux message envoyé à : ${names.join(", ")}.`);
                }
            },
            cancel: {
                icon:  '<i class="fa-solid fa-times"></i>',
                label: "Annuler"
            }
        },
        default: "send"
    }, { width: 360 }).render(true);
}
