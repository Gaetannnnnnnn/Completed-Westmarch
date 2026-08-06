import { MOD } from "./const.js";
// ============================================================
// session.js — Journal de session WestMarch
// Capture les données de session et génère un rapport
// ============================================================

import { partyFeatureEnabled } from './settings.js';

// Données capturées en début de session
var sessionData = {
    gmName: null,
    partyId: null,
    players: [],      // { userId, actorId, name, xpBefore }
    enemies: [],      // ids des combats déjà traités
    combatants: [],   // { name, cr, hp, ac, legendaryActions, legendaryResistances }
    items: [],        // { playerName, itemName, itemType }
    sceneId: null
};

// Le bouton est créé UNE SEULE FOIS (singleton) et seulement déplacé
// (jamais recréé) à chaque renderPlayers. Auparavant, le bouton était
// supprimé puis recréé à chaque rendu : si Foundry déclenchait
// renderPlayers deux fois de suite très rapidement (un conteneur
// transitoire suivi du conteneur définitif, par ex. lors d'un
// redimensionnement de fenêtre), le nettoyage par querySelectorAll
// pouvait rater une instance détachée entre les deux passages, la
// laissant orpheline et visible "derrière" le canvas de la carte
// (qui capte alors tous les clics par-dessus, la rendant inerte).
// En réutilisant toujours le même nœud DOM, déplacer == "voler" le
// nœud à son ancien emplacement (un nœud DOM ne peut exister qu'à un
// seul endroit à la fois) : il ne peut donc plus jamais y en avoir
// deux à l'écran simultanément.
let closeBtnSingleton = null;

function getCloseBtnSingleton() {
    if (closeBtnSingleton) return closeBtnSingleton;

    closeBtnSingleton = $(`
        <div class="westmarch-close-session-wrap">
            <button type="button" class="westmarch-close-session">
                <i class="fas fa-book"></i> Clore la session
            </button>
        </div>
    `);
    closeBtnSingleton.find('button').on("click", async (ev) => {
        ev.preventDefault();
        try {
            await closeSession(currentPlayersApp);
        } catch (err) {
            console.error("[WestMarch] Erreur lors de la clôture de session :", err);
            ui.notifications.error("Erreur lors de la clôture de la session (voir console).");
        }
    });
    return closeBtnSingleton;
}

let currentPlayersApp = null;

export function SessionHooks() {

    // Nettoyage ponctuel UNE SEULE FOIS au chargement du module : si un
    // ancien bouton orphelin (créé par une version précédente, buggée,
    // du code) traîne encore dans le document, on le retire avant même
    // de créer notre singleton. Sans ça, l'ancienne instance resterait
    // coincée pour toujours, invisible à notre nouvelle logique qui ne
    // gère plus qu'un seul nœud réutilisé.
    document.querySelectorAll('.westmarch-close-session-wrap').forEach(el => el.remove());

    // ============================================================
    // SECTION : Bouton "Clore la session" sous la liste des joueurs
    // ============================================================
    Hooks.on("renderPlayers", (app, html, data) => {
        currentPlayersApp = app;
        const closeBtn = getCloseBtnSingleton();

        const shouldShow = game.user.isGM
            && !!game.user.getFlag(MOD, "partyId")
            && partyFeatureEnabled("enableSessionLog");

        if (!shouldShow) {
            closeBtn.detach();
            return;
        }

        const root = app.element instanceof HTMLElement ? app.element : app.element?.[0];
        if (!root || !root.isConnected) {
            closeBtn.detach();
            return;
        }

        // IMPORTANT : on cible #players-active (la liste des joueurs EN
        // LIGNE), pas ".players-list" — ce sélecteur matchait en réalité
        // #players-inactive (la liste repliable des joueurs hors-ligne).
        // Le bouton se retrouvait alors coincé entre les deux listes,
        // exactement sur la zone où Foundry capte les clics du chevron
        // de repli/dépli de la liste hors-ligne : cliquer sur le bouton
        // refermait ce chevron au lieu de déclencher la clôture de session.
        //
        // Et surtout : on l'ajoute DEDANS #players-active (append), pas
        // APRÈS (insertAfter) — le cadre blanc arrondi visible à l'écran
        // est le style propre de #players-active lui-même. En l'insérant
        // après, le bouton atterrissait hors du cadre, posé nu sur la
        // carte en dessous : c'est ça qui ressemblait à un élément
        // "fantôme" flottant et sans style depuis le début.
        const activeList = $(root).find('#players-active');
        if (activeList.length) {
            activeList.append(closeBtn);
        } else {
            $(root).append(closeBtn);
        }
    });

    // ============================================================
    // SECTION : Capture des joueurs qui rejoignent la party en cours
    // - Au moment de "Create Party", seul le GM a sa partyId
    //   posée : les joueurs la posent ensuite via "Join Party", donc
    //   après le snapshot initial fait dans startSessionLog(). Sans ce
    //   hook, sessionData.players restait vide (d'où l'absence des
    //   noms/XP dans le journal de session).
    // ============================================================
    Hooks.on("updateUser", (user, changes, options, userId) => {
        if (!sessionData.partyId) return;
        if (changes.flags?.westmarch?.partyId !== sessionData.partyId) return;
        if (sessionData.players.find(p => p.userId === user.id)) return;
        if (!user.character) return;

        sessionData.players.push({
            userId: user.id,
            actorId: user.character.id,
            name: user.character.name,
            xpBefore: user.character.system?.details?.xp?.value ?? 0
        });
    });

    // ============================================================
    // SECTION : Capture des ennemis via le combat tracker
    // ============================================================
    Hooks.on("deleteCombat", async (combat, options, userId) => {
        if (!game.user.isGM) return;
        if (!sessionData.partyId) return;
        if (sessionData.enemies.includes(combat.id)) return;

        sessionData.enemies.push(combat.id);

        combat.combatants.forEach(combatant => {
            const actor = combatant.actor;
            if (!actor) return;
            // Exclure les joueurs de la party
            if (actor.type === "character" && actor.hasPlayerOwner) return;

            // Eviter les doublons
            if (sessionData.combatants.find(e => e.name === actor.name)) return;

            const system = actor.system;
            const entry = {
                name: actor.name,
                type: actor.type,
                cr: system?.details?.cr ?? null,
                hp: system?.attributes?.hp?.max ?? null,
                ac: system?.attributes?.ac?.value ?? null,
                legendaryActions: system?.resources?.legact?.max ?? null,
                legendaryResistances: system?.resources?.legres?.max ?? null
            };
            sessionData.combatants.push(entry);
        });
    });

    // ============================================================
    // SECTION : Capture des items ajoutés aux joueurs
    // ============================================================
    Hooks.on("createItem", (item, options, userId) => {
        if (!sessionData.partyId) return;

        const actor = item.parent;
        if (!actor) return;
        if (actor.type !== "character") return;

        // Vérifier que l'acteur appartient à un joueur de la party
        const owner = game.users.find(u =>
            u.character?.id === actor.id &&
            u.getFlag(MOD, "partyId") === sessionData.partyId
        );
        if (!owner) return;

        // Filtrer uniquement les items d'inventaire
        const inventoryTypes = ["weapon", "equipment", "consumable", "tool", "backpack", "loot"];
        if (!inventoryTypes.includes(item.type)) return;

        sessionData.items.push({
            playerName: actor.name,
            itemName: item.name,
            itemType: item.type
        });
    });
}

// ============================================================
// SECTION : Initialisation de la session (Create Party)
// ============================================================
export function startSessionLog(partyId) {
    const gm = game.user;
    sessionData = {
        gmName: gm.name,
        partyId: partyId,
        players: [],
        enemies: [],
        combatants: [],
        items: [],
        sceneId: gm.viewedScene
    };

    // Snapshot XP de chaque joueur de la party
    game.users.forEach(user => {
        if (user.getFlag(MOD, "partyId") !== partyId) return;
        if (!user.character) return;
        sessionData.players.push({
            userId: user.id,
            actorId: user.character.id,
            name: user.character.name,
            xpBefore: user.character.system?.details?.xp?.value ?? 0
        });
    });

    console.log("[WestMarch] Session démarrée pour la party", partyId);
}

// ============================================================
// SECTION : Fenêtre de clôture de session
// - Attribution d'XP (champ "XP pour tous" + champ par PJ).
// - Champ de NOTES de session (résumé libre).
// - Deux issues : "Clôturer et envoyer" (rapport Discord immédiat) ou
//   "Enregistrer pour plus tard" (brouillon rangé dans le Casier du GM).
// Renvoie : { action: "send"|"draft"|"cancel", notes }.
// L'XP saisi est appliqué dans les deux cas (send et draft).
// ============================================================
function promptSessionClose(partyId) {
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // PJ de la party (membres réels ; repli sur le snapshot de session).
    const seen = new Set();
    const pcs = [];
    for (const user of game.users) {
        if (user.getFlag(MOD, "partyId") !== partyId) continue;
        const actor = user.character;
        if (!actor || seen.has(actor.id)) continue;
        seen.add(actor.id);
        pcs.push({ actorId: actor.id, name: actor.name, currentXp: actor.system?.details?.xp?.value ?? 0 });
    }
    if (!pcs.length) {
        for (const p of sessionData.players) {
            if (seen.has(p.actorId)) continue;
            const actor = game.actors.get(p.actorId);
            if (!actor) continue;
            seen.add(p.actorId);
            pcs.push({ actorId: p.actorId, name: p.name, currentXp: actor.system?.details?.xp?.value ?? 0 });
        }
    }

    const rows = pcs.map(pc => `
        <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
            <label style="flex:1;">${esc(pc.name)}
                <span style="opacity:0.6;font-size:0.85em;">(XP actuel : ${pc.currentXp})</span>
            </label>
            <input type="number" min="0" step="1" class="scwm-xp-pc"
                   data-actor-id="${esc(pc.actorId)}" value="0" style="width:90px;">
        </div>`).join("");

    const xpBlock = pcs.length ? `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;
                        padding-bottom:8px;border-bottom:1px solid var(--color-border-light-tertiary,#bbb);">
                <label style="flex:1;font-weight:bold;">XP pour tous</label>
                <input type="number" min="0" step="1" class="scwm-xp-all" value="0" style="width:90px;">
            </div>
            ${rows}`
        : `<p style="opacity:0.7;">Aucun PJ dans la party — attribution d'XP indisponible.</p>`;

    const content = `
        <form class="scwm-close-form">
            <p style="margin:0 0 8px;">Attribution d'XP de fin de session.</p>
            ${xpBlock}
            <div style="margin-top:10px;">
                <label style="display:block;font-weight:bold;margin-bottom:4px;">Notes de session</label>
                <textarea class="scwm-close-notes" rows="4" style="width:100%;box-sizing:border-box;"
                    placeholder="Résumé, événements marquants… (peut être complété plus tard dans le Casier)"></textarea>
            </div>
        </form>`;

    let resolveFn;
    const done = new Promise(res => { resolveFn = res; });

    const applyXp = async (root) => {
        for (const input of root.querySelectorAll(".scwm-xp-pc")) {
            const gain = Math.max(0, Math.round(Number(input.value) || 0));
            if (!gain) continue;
            const actor = game.actors.get(input.dataset.actorId);
            if (!actor) continue;
            const cur = actor.system?.details?.xp?.value ?? 0;
            await actor.update({ "system.details.xp.value": cur + gain });
        }
    };

    const dlg = new foundry.applications.api.DialogV2({
        window: { title: "Clôture de session", icon: "fas fa-flag-checkered" },
        content,
        buttons: [
            {
                action: "send", label: "Clôturer et envoyer", icon: "fas fa-paper-plane", default: true,
                callback: async (event, button, dialog) => {
                    const root = dialog.element;
                    const notes = root.querySelector(".scwm-close-notes")?.value ?? "";
                    await applyXp(root);
                    resolveFn({ action: "send", notes });
                }
            },
            {
                action: "draft", label: "Enregistrer pour plus tard", icon: "fas fa-box-archive",
                callback: async (event, button, dialog) => {
                    const root = dialog.element;
                    const notes = root.querySelector(".scwm-close-notes")?.value ?? "";
                    await applyXp(root);
                    resolveFn({ action: "draft", notes });
                }
            }
        ],
        rejectClose: false
    });

    // Fermeture manuelle (croix) → on annule la clôture de session.
    const origClose = dlg.close.bind(dlg);
    dlg.close = async (options) => { resolveFn({ action: "cancel" }); return origClose(options); };

    dlg.render({ force: true }).then(() => {
        const root = dlg.element;
        const allInput = root?.querySelector(".scwm-xp-all");
        if (allInput) {
            allInput.addEventListener("input", () => {
                root.querySelectorAll(".scwm-xp-pc").forEach(i => { i.value = allInput.value; });
            });
        }
    });

    return done;
}

// ============================================================
// SECTION : Construction des données de rapport de session
// (réutilisable par la clôture immédiate ET par le Casier).
// ============================================================
function buildReportData(partyId, xpBeforeById, notes) {
    // Liste des PJ : snapshot de session si présent, sinon membres actuels.
    let reportPlayers = sessionData.players;
    if (!reportPlayers.length) {
        const seen = new Set();
        reportPlayers = [];
        for (const user of game.users) {
            if (user.getFlag(MOD, "partyId") !== partyId) continue;
            const actor = user.character;
            if (!actor || seen.has(actor.id)) continue;
            seen.add(actor.id);
            reportPlayers.push({ actorId: actor.id, name: actor.name, xpBefore: xpBeforeById.get(actor.id) ?? (actor.system?.details?.xp?.value ?? 0) });
        }
    }

    const players = reportPlayers.map(p => {
        const actor = game.actors.get(p.actorId);
        const xpAfter = actor?.system?.details?.xp?.value ?? p.xpBefore;
        const levelBefore = getLevelFromXp(p.xpBefore);
        const levelAfter = getLevelFromXp(xpAfter);
        return {
            name: p.name, xpBefore: p.xpBefore, xpAfter,
            xpGained: xpAfter - p.xpBefore,
            levelUp: levelAfter > levelBefore, levelAfter
        };
    });

    // PNJ présents sur la scène capturée
    const scene = game.scenes.get(sessionData.sceneId);
    const npcs = [];
    if (scene) {
        scene.tokens.forEach(token => {
            const actor = token.actor;
            if (!actor || actor.type !== "character" || actor.hasPlayerOwner) return;
            if (npcs.find(n => n.name === actor.name)) return;
            npcs.push({ name: actor.name });
        });
    }

    return {
        id:          foundry.utils.randomID(),
        gmId:        game.user.id,
        gmName:      sessionData.gmName ?? game.user.name,
        partyId,
        dateISO:     new Date().toISOString(),
        dateDisplay: new Date().toLocaleDateString("fr-FR"),
        players,
        combatants:  [...(sessionData.combatants ?? [])],
        npcs,
        items:       [...(sessionData.items ?? [])],
        notes:       notes ?? ""
    };
}

// Construit l'embed Discord à partir des données de rapport.
export function buildSessionEmbed(data) {
    const trunc = (str) => str.length > 1024 ? str.slice(0, 1021) + "…" : str;

    const playersLines = (data.players ?? []).map(p => {
        let l = `**${p.name}** — XP : ${p.xpBefore} → ${p.xpAfter}`;
        if (p.xpGained > 0) l += ` (+${p.xpGained})`;
        if (p.levelUp)      l += ` ⬆ **Level Up ! (Niveau ${p.levelAfter})**`;
        return l;
    });
    const fields = [{ name: "Joueurs", value: trunc(playersLines.join("\n") || "—") }];

    if ((data.combatants ?? []).length > 0) {
        const lines = data.combatants.map(e => {
            let l = `**${e.name}**`;
            if (e.cr !== null && e.cr !== undefined) l += ` — CR ${e.cr}`;
            if (e.hp !== null && e.hp !== undefined) l += ` — HP ${e.hp}`;
            if (e.ac !== null && e.ac !== undefined) l += ` — CA ${e.ac}`;
            if (e.legendaryActions)     l += ` — Actions lég. : ${e.legendaryActions}`;
            if (e.legendaryResistances) l += ` — Résist. lég. : ${e.legendaryResistances}`;
            return l;
        });
        fields.push({ name: "Ennemis rencontrés", value: trunc(lines.join("\n")) });
    }
    if ((data.npcs ?? []).length > 0) {
        fields.push({ name: "PNJ rencontrés", value: trunc(data.npcs.map(n => n.name).join("\n")) });
    }
    if ((data.items ?? []).length > 0) {
        fields.push({ name: "Objets récupérés", value: trunc(data.items.map(i => `**${i.playerName}** — ${i.itemName}`).join("\n")) });
    }
    if (data.notes?.trim()) {
        fields.push({ name: "Notes", value: trunc(data.notes.trim()) });
    }

    return {
        title:       `Rapport de session — ${data.dateDisplay}`,
        description: `**Meneur :** ${data.gmName}`,
        color:       0xe67e22,
        fields
    };
}

// Envoie le rapport sur le webhook Discord. Renvoie true si envoyé.
export async function sendSessionReport(data) {
    const webhookUrl = game.settings.get(MOD, "sessionLogWebhookUrl");
    if (!webhookUrl) {
        ui.notifications.warn("Aucun webhook Discord configuré (Paramètres → Système de Party → URL webhook rapport de session).");
        return false;
    }
    try {
        await fetch(webhookUrl, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ embeds: [buildSessionEmbed(data)] })
        });
        return true;
    } catch (err) {
        console.error("[WestMarch] Webhook rapport de session :", err);
        ui.notifications.warn("Échec de l'envoi du rapport sur Discord (voir console).");
        return false;
    }
}

// ---- Brouillons de rapport (Casier du GM) ------------------
export function getSessionDrafts() {
    const d = game.settings.get(MOD, "sessionDrafts");
    return Array.isArray(d) ? d : [];
}
export async function saveSessionDraft(data) {
    const drafts = getSessionDrafts();
    const i = drafts.findIndex(x => x.id === data.id);
    if (i >= 0) drafts[i] = data; else drafts.push(data);
    await game.settings.set(MOD, "sessionDrafts", drafts);
}
export async function deleteSessionDraft(id) {
    await game.settings.set(MOD, "sessionDrafts", getSessionDrafts().filter(x => x.id !== id));
}

// ============================================================
// SECTION : Clôture de la session
// - "Clôturer et envoyer" → rapport Discord immédiat.
// - "Enregistrer pour plus tard" → brouillon rangé dans le Casier.
// Dans les deux cas : XP appliqué (dans la fenêtre), party quittée.
// ============================================================
async function closeSession(playerListApp) {
    const partyId = sessionData.partyId ?? game.user.getFlag(MOD, "partyId");
    if (!partyId) {
        ui.notifications.warn("Aucune session en cours (aucune party active).");
        return;
    }

    // XP avant attribution (repli pour le calcul du gain).
    const xpBeforeById = new Map();
    for (const user of game.users) {
        if (user.getFlag(MOD, "partyId") !== partyId) continue;
        const actor = user.character;
        if (actor) xpBeforeById.set(actor.id, actor.system?.details?.xp?.value ?? 0);
    }

    const res = await promptSessionClose(partyId);
    if (res.action === "cancel") return;

    // Données du rapport construites AVANT le reset de sessionData.
    const reportData = buildReportData(partyId, xpBeforeById, res.notes);

    if (res.action === "send") {
        const ok = await sendSessionReport(reportData);
        ui.notifications.info(ok ? "Session close — rapport envoyé sur Discord." : "Session close — rapport NON envoyé (voir avertissement).");
    } else if (res.action === "draft") {
        await saveSessionDraft(reportData);
        try { ui.controls?.render?.(); } catch (e) {}   // rafraîchit la pastille du Casier
        ui.notifications.info("Session close — rapport enregistré dans votre Casier (à finaliser plus tard).");
    }

    // Leave Party
    if (game.user.isGM && game.user.id === game.user.getFlag(MOD, 'partyId')) {
        game.users.forEach(user => {
            if (user.getFlag(MOD, "partyId") === game.user.id) {
                user.unsetFlag(MOD, "partyId");
            }
        });
    }
    game.user.unsetFlag(MOD, "partyId").then(() => {
        playerListApp.render();
    });

    // Reset session
    sessionData = { gmName: null, partyId: null, players: [], enemies: [], combatants: [], items: [], sceneId: null };
}

// ============================================================
// SECTION : Calcul du niveau à partir de l'XP (D&D 5e)
// ============================================================
function getLevelFromXp(xp) {
    const thresholds = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
    let level = 1;
    for (let i = 0; i < thresholds.length; i++) {
        if (xp >= thresholds[i]) level = i + 1;
        else break;
    }
    return level;
}