// ============================================================
// trade.js — Échange direct entre joueurs (style Dofus)
//
// Fenêtre d'échange synchronisée entre deux joueurs : chacun dépose des
// objets de son inventaire et des monnaies (PC/PA/PE/PO/PP), verrouille son
// offre, puis les deux confirment → l'échange s'exécute.
//
// Arbitrage MJ : un joueur n'a pas la permission de modifier la fiche d'un
// autre. Toute la session est donc gérée par le MJ actif (game.users.activeGM)
// qui détient l'état, valide et exécute le transfert. Les clients n'envoient
// que des actions et affichent l'état renvoyé par le MJ.
//
// Règles d'autorisation (réglage) :
//   - Hors party ET hors expédition : échange libre.
//   - En party sans expédition ouverte : échange interdit.
//   - En expédition : uniquement entre membres de la même expédition
//     (même party + expédition ouverte).
//
// © 2026 Soruta — Tous droits réservés.
// ============================================================

import { MOD } from "./const.js";
import { getExpeditions } from "./carnet.js";

const CURRENCIES = ["pp", "gp", "ep", "sp", "cp"];
const CUR_LABEL  = { pp: "PP", gp: "PO", ep: "PE", sp: "PA", cp: "PC" };
const PHYS_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"]);

const activeGM = () => game.users.activeGM ?? game.users.find(u => u.isGM && u.active);
const uid = () => foundry.utils.randomID();

// ── Règles d'autorisation ───────────────────────────────────
function _state(user) {
    const inParty = !!user.getFlag(MOD, "partyId");
    const actor   = user.character;
    const onExp   = actor ? getExpeditions(actor).some(e => e.startDate && !e.endDate) : false;
    return { inParty, onExp, partyId: user.getFlag(MOD, "partyId") ?? null };
}
// x accepte-t-il d'échanger avec y ?
function _allows(x, y) {
    const sx = _state(x);
    if (!sx.inParty) return true;                 // en ville, libre
    if (sx.inParty && sx.onExp) {                 // en expédition : co-membres seulement
        const sy = _state(y);
        return sy.onExp && sy.partyId && sy.partyId === sx.partyId;
    }
    return false;                                 // en party sans expédition : bloqué
}
export function canTradeWith(a, b) {
    if (!a?.character || !b?.character) return false;
    return _allows(a, b) && _allows(b, a);
}
function tradeBlockReason(a, b) {
    if (!a?.character || !b?.character) return "Chaque joueur doit avoir un personnage assigné.";
    const sa = _state(a);
    if (sa.inParty && !sa.onExp) return "Impossible d'échanger tant que tu es dans une party (hors expédition).";
    if (sa.inParty && sa.onExp && !_allows(a, b)) return "En expédition, tu ne peux échanger qu'avec les membres de ton expédition.";
    if (!_allows(b, a)) return "Ce joueur ne peut pas échanger avec toi actuellement.";
    return "Échange impossible actuellement.";
}

// ============================================================
// CÔTÉ MJ — état des sessions + exécution
// ============================================================
const _sessions = new Map();   // sessionId -> session (uniquement chez le MJ actif)

function _newSession(aId, bId) {
    const s = {
        id: uid(), a: aId, b: bId,
        offer: { [aId]: emptyOffer(), [bId]: emptyOffer() },
        locked: { [aId]: false, [bId]: false },
        confirmed: { [aId]: false, [bId]: false },
        phase: "open"
    };
    _sessions.set(s.id, s);
    return s;
}
const emptyOffer = () => ({ items: [], currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 } });

function _publicSession(s, forUserId) {
    // Vue envoyée à un client : « moi » / « lui » selon forUserId.
    const meId = forUserId, otherId = s.a === forUserId ? s.b : s.a;
    return {
        id: s.id,
        meId, otherId,
        otherName: game.users.get(otherId)?.name ?? "?",
        me:   { offer: s.offer[meId],    locked: s.locked[meId],    confirmed: s.confirmed[meId] },
        them: { offer: s.offer[otherId], locked: s.locked[otherId], confirmed: s.confirmed[otherId] },
        bothLocked: s.locked[s.a] && s.locked[s.b],
        phase: s.phase
    };
}
async function _pushState(s) {
    for (const uId of [s.a, s.b]) {
        const u = game.users.get(uId);
        if (u?.active) u.query("westmarch.tradeState", { session: _publicSession(s, uId) }).catch(() => {});
    }
}
async function _closeSession(s, reason) {
    _sessions.delete(s.id);
    for (const uId of [s.a, s.b]) {
        const u = game.users.get(uId);
        if (u?.active) u.query("westmarch.tradeClosed", { reason }).catch(() => {});
    }
}

// Demande d'échange (A → MJ). Le MJ invite B, puis ouvre chez les deux.
async function gmTradeRequest({ fromUserId, toUserId }) {
    const A = game.users.get(fromUserId), B = game.users.get(toUserId);
    if (!A || !B) return { ok: false, reason: "Joueur introuvable." };
    if (!canTradeWith(A, B)) return { ok: false, reason: tradeBlockReason(A, B) };
    // Une seule session active par joueur.
    for (const s of _sessions.values()) if ([s.a, s.b].includes(fromUserId) || [s.a, s.b].includes(toUserId))
        return { ok: false, reason: "Un échange est déjà en cours." };

    const invite = await B.query("westmarch.tradeInvite", { fromName: A.name }).catch(() => ({ accepted: false }));
    if (!invite?.accepted) {
        A.query("westmarch.tradeNotice", { message: `${B.name} a refusé l'échange.` }).catch(() => {});
        return { ok: true };
    }
    const s = _newSession(fromUserId, toUserId);
    _pushOpen(s);
    return { ok: true };
}
function _pushOpen(s) {
    for (const uId of [s.a, s.b]) {
        const u = game.users.get(uId);
        if (u?.active) u.query("westmarch.tradeOpen", { session: _publicSession(s, uId) }).catch(() => {});
    }
}

async function gmSetOffer({ sessionId, userId, offer }) {
    const s = _sessions.get(sessionId); if (!s) return { ok: false };
    s.offer[userId] = sanitizeOffer(offer);
    s.locked[s.a] = s.locked[s.b] = false;               // toute modif casse les verrous
    s.confirmed[s.a] = s.confirmed[s.b] = false;
    await _pushState(s); return { ok: true };
}
async function gmLock({ sessionId, userId, locked }) {
    const s = _sessions.get(sessionId); if (!s) return { ok: false };
    s.locked[userId] = !!locked;
    if (!locked) { s.confirmed[s.a] = s.confirmed[s.b] = false; }
    await _pushState(s); return { ok: true };
}
async function gmConfirm({ sessionId, userId }) {
    const s = _sessions.get(sessionId); if (!s) return { ok: false };
    if (!(s.locked[s.a] && s.locked[s.b])) return { ok: false, reason: "Les deux offres doivent être verrouillées." };
    s.confirmed[userId] = true;
    if (s.confirmed[s.a] && s.confirmed[s.b]) {
        const res = await executeTrade(s);
        if (res.ok) {
            for (const uId of [s.a, s.b]) game.users.get(uId)?.query("westmarch.tradeDone", {}).catch(() => {});
            _sessions.delete(s.id);
        } else {
            s.confirmed[s.a] = s.confirmed[s.b] = false;
            s.locked[s.a] = s.locked[s.b] = false;
            for (const uId of [s.a, s.b]) game.users.get(uId)?.query("westmarch.tradeNotice", { message: `Échange annulé : ${res.reason}` }).catch(() => {});
            await _pushState(s);
        }
        return { ok: true };
    }
    await _pushState(s); return { ok: true };
}
async function gmCancel({ sessionId }) {
    const s = _sessions.get(sessionId); if (!s) return { ok: false };
    await _closeSession(s, "Échange annulé.");
    return { ok: true };
}

function sanitizeOffer(offer) {
    const out = emptyOffer();
    if (Array.isArray(offer?.items)) out.items = offer.items
        .filter(i => i && i.id).map(i => ({ id: i.id, name: String(i.name ?? ""), img: String(i.img ?? ""), qty: Math.max(1, Number(i.qty) || 1) }));
    for (const c of CURRENCIES) out.currency[c] = Math.max(0, Math.floor(Number(offer?.currency?.[c]) || 0));
    return out;
}

// Transfert atomique (côté MJ, qui a les permissions sur les deux fiches).
async function executeTrade(s) {
    const A = game.users.get(s.a)?.character, B = game.users.get(s.b)?.character;
    if (!A || !B) return { ok: false, reason: "Personnage introuvable." };

    // Validation : chaque offrant possède encore les objets/quantités et l'argent.
    const check = (actor, offer) => {
        for (const it of offer.items) {
            const item = actor.items.get(it.id);
            if (!item) return `objet manquant (${it.name})`;
            if ((item.system?.quantity ?? 1) < it.qty) return `quantité insuffisante (${it.name})`;
        }
        for (const c of CURRENCIES) if ((actor.system?.currency?.[c] ?? 0) < offer.currency[c]) return `${CUR_LABEL[c]} insuffisant`;
        return null;
    };
    const eA = check(A, s.offer[s.a]); if (eA) return { ok: false, reason: `${A.name} : ${eA}` };
    const eB = check(B, s.offer[s.b]); if (eB) return { ok: false, reason: `${B.name} : ${eB}` };

    try {
        await moveItems(A, B, s.offer[s.a].items);
        await moveItems(B, A, s.offer[s.b].items);
        await moveCurrency(A, B, s.offer[s.a].currency);
        await moveCurrency(B, A, s.offer[s.b].currency);
    } catch (e) {
        console.error(`[${MOD}] executeTrade :`, e);
        return { ok: false, reason: "erreur pendant le transfert (voir console MJ)." };
    }
    return { ok: true };
}

async function moveItems(from, to, items) {
    const toCreate = [], toDelete = [], toUpdate = [];
    for (const it of items) {
        const item = from.items.get(it.id);
        if (!item) continue;
        const have = item.system?.quantity ?? 1;
        const data = item.toObject();
        delete data._id;
        if (data.system) data.system.quantity = it.qty;
        // Fusion si le destinataire a déjà un objet identique (même nom + type).
        const existing = to.items.find(x => x.name === item.name && x.type === item.type && (x.system?.quantity != null));
        if (existing) toUpdate.push({ actor: to, _id: existing.id, qty: (existing.system?.quantity ?? 1) + it.qty });
        else toCreate.push(data);

        if (have > it.qty) await item.update({ "system.quantity": have - it.qty });
        else toDelete.push(item.id);
    }
    if (toCreate.length) await to.createEmbeddedDocuments("Item", toCreate);
    for (const u of toUpdate) await u.actor.items.get(u._id)?.update({ "system.quantity": u.qty });
    if (toDelete.length) await from.deleteEmbeddedDocuments("Item", toDelete);
}
async function moveCurrency(from, to, cur) {
    const fromUpd = {}, toUpd = {};
    for (const c of CURRENCIES) {
        const amt = cur[c] || 0; if (!amt) continue;
        fromUpd[`system.currency.${c}`] = (from.system?.currency?.[c] ?? 0) - amt;
        toUpd[`system.currency.${c}`]   = (to.system?.currency?.[c] ?? 0) + amt;
    }
    if (Object.keys(fromUpd).length) await from.update(fromUpd);
    if (Object.keys(toUpd).length)   await to.update(toUpd);
}

// ============================================================
// CÔTÉ CLIENT — envoi d'actions au MJ + fenêtre d'échange
// ============================================================
function _gmSend(name, data) {
    const gm = activeGM();
    if (!gm) { ui.notifications?.warn("Aucun MJ connecté : les échanges nécessitent un MJ en ligne."); return Promise.resolve({ ok: false }); }
    return gm.query(name, data).catch((e) => { console.warn(`[${MOD}] trade ${name}`, e); return { ok: false }; });
}

async function startTradeWith(targetUser) {
    if (!canTradeWith(game.user, targetUser)) {
        ui.notifications?.warn(tradeBlockReason(game.user, targetUser));
        return;
    }
    const res = await _gmSend("westmarch.tradeRequest", { fromUserId: game.user.id, toUserId: targetUser.id });
    if (res && res.ok === false && res.reason) ui.notifications?.warn(res.reason);
    else ui.notifications?.info(`Demande d'échange envoyée à ${targetUser.name}…`);
}

let _tradeApp = null;
function openTradeWindow(session) {
    if (_tradeApp) { _tradeApp.session = session; _tradeApp.render(true); return; }
    _tradeApp = new TradeWindow();
    _tradeApp.session = session;
    _tradeApp.render(true);
}
function updateTradeWindow(session) {
    if (_tradeApp) { _tradeApp.session = session; _tradeApp.render(false); }
}
function closeTradeWindow() { _tradeApp?.close(); _tradeApp = null; }

class TradeWindow extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "scwm-trade",
        classes: ["scwm-trade"],
        window: { title: "Échange", icon: "fas fa-right-left" },
        position: { width: 660, height: 580 }
    };
    session = null;

    async _renderHTML() { return this.#buildHTML(); }
    _replaceHTML(result, content) { content.innerHTML = result; this.#wire(content); }
    async close(opts) { _tradeApp = null; return super.close(opts); }

    #myActor() { return game.user.character; }

    #buildHTML() {
        const s = this.session; if (!s) return "";
        const offerCol = (side, editable) => {
            const o = side.offer;
            const items = o.items.length ? o.items.map(it => `
                <div class="scwm-trade-item" data-id="${it.id}">
                    <img src="${it.img || "icons/svg/item-bag.svg"}">
                    <span class="n">${it.name}</span>
                    <span class="q">×${it.qty}</span>
                    ${editable ? `<a class="scwm-trade-rem" data-id="${it.id}" title="Retirer">✕</a>` : ""}
                </div>`).join("") : `<div class="scwm-trade-empty">— rien —</div>`;
            const cur = CURRENCIES.map(c => editable
                ? `<label class="scwm-cur"><span>${CUR_LABEL[c]}</span><input type="number" min="0" data-cur="${c}" value="${o.currency[c] || 0}"></label>`
                : `<span class="scwm-cur-ro">${CUR_LABEL[c]} ${o.currency[c] || 0}</span>`).join("");
            const lockTxt = side.locked ? `<span class="scwm-lock on"><i class="fa-solid fa-lock"></i> Verrouillé</span>` : `<span class="scwm-lock"><i class="fa-solid fa-lock-open"></i> Non verrouillé</span>`;
            const conf = side.confirmed ? `<span class="scwm-conf on"><i class="fa-solid fa-check"></i> Confirmé</span>` : "";
            return `
                <div class="scwm-trade-col">
                    <h3>${editable ? "Ton offre" : s.otherName}</h3>
                    <div class="scwm-trade-items">${items}</div>
                    ${editable ? `<button type="button" class="scwm-trade-add"><i class="fa-solid fa-plus"></i> Ajouter un objet</button>` : ""}
                    <div class="scwm-trade-cur">${cur}</div>
                    <div class="scwm-trade-status">${lockTxt} ${conf}</div>
                </div>`;
        };
        const canConfirm = s.bothLocked && !s.me.confirmed;
        return `
            <div class="scwm-trade-body">
                <div class="scwm-trade-cols">
                    ${offerCol(s.me, !s.me.locked)}
                    ${offerCol(s.them, false)}
                </div>
                <div class="scwm-trade-actions">
                    <button type="button" class="scwm-trade-lock ${s.me.locked ? "on" : ""}">
                        <i class="fa-solid fa-${s.me.locked ? "lock-open" : "lock"}"></i> ${s.me.locked ? "Déverrouiller" : "Verrouiller mon offre"}
                    </button>
                    <button type="button" class="scwm-trade-confirm" ${canConfirm ? "" : "disabled"}>
                        <i class="fa-solid fa-handshake"></i> Confirmer l'échange
                    </button>
                    <button type="button" class="scwm-trade-cancel"><i class="fa-solid fa-xmark"></i> Annuler</button>
                </div>
            </div>`;
    }

    #wire(root) {
        const s = this.session; if (!s) return;
        const send = (name, extra) => _gmSend(name, { sessionId: s.id, userId: game.user.id, ...extra });

        root.querySelector(".scwm-trade-lock")?.addEventListener("click", () => send("westmarch.tradeLock", { locked: !s.me.locked }));
        root.querySelector(".scwm-trade-confirm")?.addEventListener("click", () => send("westmarch.tradeConfirm", {}));
        root.querySelector(".scwm-trade-cancel")?.addEventListener("click", () => send("westmarch.tradeCancel", {}));

        // Modifier une monnaie → renvoyer l'offre.
        root.querySelectorAll("input[data-cur]").forEach(inp => inp.addEventListener("change", () => {
            const offer = this.#collectOffer(root);
            send("westmarch.tradeSetOffer", { offer });
        }));
        // Retirer un objet.
        root.querySelectorAll(".scwm-trade-rem").forEach(a => a.addEventListener("click", () => {
            const id = a.dataset.id;
            const offer = this.#collectOffer(root);
            offer.items = offer.items.filter(it => it.id !== id);
            send("westmarch.tradeSetOffer", { offer });
        }));
        // Ajouter un objet.
        root.querySelector(".scwm-trade-add")?.addEventListener("click", () => this.#pickItem(root));
    }

    #collectOffer(root) {
        const s = this.session;
        const offer = { items: (s.me.offer.items ?? []).map(it => ({ ...it })), currency: {} };
        for (const c of CURRENCIES) {
            const inp = root.querySelector(`input[data-cur="${c}"]`);
            offer.currency[c] = inp ? Math.max(0, Math.floor(Number(inp.value) || 0)) : (s.me.offer.currency[c] || 0);
        }
        return offer;
    }

    async #pickItem(root) {
        const actor = this.#myActor(); if (!actor) return;
        const already = new Set((this.session.me.offer.items ?? []).map(i => i.id));
        const items = actor.items.filter(i => PHYS_TYPES.has(i.type) && !already.has(i.id));
        if (!items.length) return ui.notifications?.info("Aucun objet à ajouter.");
        const opts = items.map(i => `<option value="${i.id}">${i.name} (×${i.system?.quantity ?? 1})</option>`).join("");
        const content = `<div style="display:flex;flex-direction:column;gap:8px;">
            <label>Objet<br><select name="it" style="width:100%;">${opts}</select></label>
            <label>Quantité<br><input type="number" name="q" value="1" min="1" style="width:100%;"></label>
        </div>`;
        await foundry.applications.api.DialogV2.wait({
            window: { title: "Ajouter un objet à l'échange" }, position: { width: 360 }, rejectClose: false,
            content,
            buttons: [
                { action: "add", default: true, label: "Ajouter", icon: '<i class="fa-solid fa-plus"></i>',
                  callback: (ev, btn) => {
                      const f = btn.form ?? document.querySelector(".dialog");
                      const id = f.querySelector('[name="it"]')?.value;
                      const item = actor.items.get(id); if (!item) return;
                      const max = item.system?.quantity ?? 1;
                      const q = Math.min(max, Math.max(1, Number(f.querySelector('[name="q"]')?.value) || 1));
                      const offer = this.#collectOffer(root);
                      offer.items.push({ id, name: item.name, img: item.img, qty: q });
                      _gmSend("westmarch.tradeSetOffer", { sessionId: this.session.id, userId: game.user.id, offer });
                  } },
                { action: "cancel", label: "Annuler", icon: '<i class="fa-solid fa-xmark"></i>' }
            ]
        });
    }
}

// ============================================================
// HOOKS
// ============================================================
// Style injecté en JS (fiable même si le fichier trade.css du manifeste n'est
// pas chargé sans relancer le monde — cas de certains hébergements).
const TRADE_CSS = `
.scwm-trade-btn { margin-left:6px; color:#c9a227; cursor:pointer; flex:0 0 auto; }
.scwm-trade-btn:hover { color:#fff; text-shadow:0 0 6px #e67e22; }
.scwm-trade .window-content { padding:8px; }
.scwm-trade-body { display:flex; flex-direction:column; gap:10px; height:100%; }
.scwm-trade-cols { display:flex; gap:10px; flex:1 1 auto; min-height:0; }
.scwm-trade-col { flex:1 1 0; display:flex; flex-direction:column; gap:6px; border:1px solid rgba(201,162,39,0.4); border-radius:6px; padding:8px; background:rgba(0,0,0,0.15); min-width:0; }
.scwm-trade-col h3 { margin:0 0 2px; font-size:13px; color:#e8cc6a; border-bottom:1px solid rgba(201,162,39,0.3); padding-bottom:4px; }
.scwm-trade-items { flex:1 1 auto; min-height:90px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; }
.scwm-trade-item { display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:4px; background:rgba(255,255,255,0.04); }
.scwm-trade-item img { width:28px; height:28px; border:none; border-radius:3px; flex:0 0 auto; object-fit:cover; }
.scwm-trade-item .n { flex:1 1 auto; font-size:12px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.scwm-trade-item .q { font-size:12px; color:#c9a227; flex:0 0 auto; }
.scwm-trade-rem { color:#e58f8f; cursor:pointer; flex:0 0 auto; padding:0 4px; }
.scwm-trade-rem:hover { color:#fff; }
.scwm-trade-empty { color:#777; font-style:italic; font-size:12px; padding:6px; text-align:center; }
.scwm-trade-add { font-size:12px; padding:3px 8px; border:1px dashed rgba(201,162,39,0.5); border-radius:4px; background:rgba(201,162,39,0.08); color:#c9a227; cursor:pointer; }
.scwm-trade-add:hover { background:rgba(201,162,39,0.18); color:#fff; }
.scwm-trade-cur { display:flex; flex-wrap:wrap; gap:4px; }
.scwm-cur { display:flex; align-items:center; gap:3px; font-size:11px; }
.scwm-cur span { color:#c9a227; min-width:20px; }
.scwm-cur input { width:46px; height:22px; font-size:11px; padding:0 4px; }
.scwm-cur-ro { font-size:11px; color:#d8cca0; padding:2px 5px; border:1px solid rgba(201,162,39,0.25); border-radius:3px; }
.scwm-trade-status { font-size:11px; display:flex; gap:8px; margin-top:2px; }
.scwm-lock { color:#999; } .scwm-lock.on { color:#8fd19e; } .scwm-conf.on { color:#8fd19e; }
.scwm-trade-actions { display:flex; gap:6px; }
.scwm-trade-actions button { flex:1 1 auto; min-height:32px; border-radius:5px; border:1px solid rgba(201,162,39,0.5); background:rgba(201,162,39,0.12); color:#ecdca0; cursor:pointer; font-weight:600; }
.scwm-trade-actions button:hover:not(:disabled) { background:rgba(201,162,39,0.25); color:#fff; }
.scwm-trade-actions .scwm-trade-lock.on { background:rgba(143,209,158,0.15); border-color:#8fd19e; color:#cdeccf; }
.scwm-trade-actions .scwm-trade-confirm { border-color:#8fd19e; background:rgba(143,209,158,0.15); color:#d8f0da; }
.scwm-trade-actions .scwm-trade-cancel { border-color:rgba(192,57,43,0.5); background:rgba(192,57,43,0.12); color:#e58f8f; }
.scwm-trade-actions button:disabled { opacity:0.45; cursor:default; }
`;
function injectTradeCss() {
    if (document.getElementById("scwm-trade-style")) return;
    const st = document.createElement("style");
    st.id = "scwm-trade-style";
    st.textContent = TRADE_CSS;
    document.head.appendChild(st);
}

export function TradeHooks() {
    injectTradeCss();
    // Handlers CLIENT (reçus depuis le MJ).
    CONFIG.queries["westmarch.tradeInvite"] = async ({ fromName }) => {
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Demande d'échange", icon: "fas fa-right-left" },
            content: `<p><strong>${fromName}</strong> souhaite échanger avec toi. Accepter ?</p>`
        }).catch(() => false);
        return { accepted: !!ok };
    };
    CONFIG.queries["westmarch.tradeOpen"]   = async ({ session }) => { openTradeWindow(session); return true; };
    CONFIG.queries["westmarch.tradeState"]  = async ({ session }) => { updateTradeWindow(session); return true; };
    CONFIG.queries["westmarch.tradeDone"]   = async () => { ui.notifications?.info("Échange effectué."); closeTradeWindow(); return true; };
    CONFIG.queries["westmarch.tradeClosed"] = async ({ reason }) => { if (reason) ui.notifications?.info(reason); closeTradeWindow(); return true; };
    CONFIG.queries["westmarch.tradeNotice"] = async ({ message }) => { ui.notifications?.warn(message); return true; };

    // Handlers MJ (l'état vit chez le MJ actif ; on enregistre partout mais ils
    // ne sont sollicités que sur le client MJ via activeGM()).
    CONFIG.queries["westmarch.tradeRequest"]  = async (d) => gmTradeRequest(d);
    CONFIG.queries["westmarch.tradeSetOffer"] = async (d) => gmSetOffer(d);
    CONFIG.queries["westmarch.tradeLock"]     = async (d) => gmLock(d);
    CONFIG.queries["westmarch.tradeConfirm"]  = async (d) => gmConfirm(d);
    CONFIG.queries["westmarch.tradeCancel"]   = async (d) => gmCancel(d);

    // Bouton « Échanger » dans la liste des joueurs.
    Hooks.on("renderPlayers", (app, html) => {
        if (!game.settings.get(MOD, "enableTrade")) return;
        if (!game.user.character) return;   // il me faut un perso
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;
        root.querySelectorAll("[data-user-id]").forEach(row => {
            const u = game.users.get(row.getAttribute("data-user-id"));
            if (!u || u.id === game.user.id || !u.active || !u.character) return;
            if (row.querySelector(".scwm-trade-btn")) return;
            if (!canTradeWith(game.user, u)) return;
            const btn = document.createElement("a");
            btn.className = "scwm-trade-btn";
            btn.title = `Échanger avec ${u.name}`;
            btn.innerHTML = `<i class="fa-solid fa-right-left"></i>`;
            btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); startTradeWith(u); });
            row.appendChild(btn);
        });
    });
}
