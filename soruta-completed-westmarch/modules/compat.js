// ============================================================
// compat.js — Shim de compatibilité Dialog (V1) → DialogV2
// ------------------------------------------------------------
// Foundry v14 supprime l'ancienne classe `Dialog` (Application V1).
// Ce module ré-expose une classe `Dialog` à l'API identique à la V1
// (constructeur { title, content, buttons:{…}, default, render, close }
// + 2e argument d'options { width, height, classes, resizable, jQuery },
// instance .render()/.close(), statiques .confirm()/.prompt()) mais
// construite par-dessus `foundry.applications.api.DialogV2`.
//
// Les fichiers du module importent `Dialog` depuis ce shim : les
// appels `new Dialog(...)`, `Dialog.confirm(...)`, `Dialog.prompt(...)`
// existants restent inchangés et fonctionnent en v13 ET v14.
// ============================================================

const DV2 = () => foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2;

// Enveloppe un élément natif en jQuery si disponible (les callbacks V1
// reçoivent historiquement un objet jQuery ; les sites font `html[0] ?? html`
// ou `html.find(...)` — les deux marchent alors).
function jq(el) {
    if (!el) return el;
    try { if (globalThis.jQuery) return globalThis.jQuery(el); } catch (e) {}
    return el;
}

// Convertit les boutons V1 (objet { key: {icon,label,callback,…} }) en
// tableau DialogV2 [{ action, label, icon, default, callback }].
function convertButtons(buttons, def) {
    if (!buttons) return [];
    if (Array.isArray(buttons)) return buttons; // déjà au format V2
    const out = [];
    for (const [key, b] of Object.entries(buttons)) {
        if (!b) continue;
        const entry = {
            action: key,
            label: b.label ?? key,
            default: (def !== undefined && def === key) || !!b.default
        };
        if (b.icon) entry.icon = b.icon;
        if (typeof b.callback === "function") {
            const orig = b.callback;
            entry.callback = async (event, button, dialog) => {
                try { return await orig(jq(dialog?.element), event, button, dialog); }
                catch (e) { console.error("[SCWM compat] button callback", e); }
            };
        }
        out.push(entry);
    }
    return out;
}

export class Dialog {
    constructor(data = {}, options = {}) {
        this.data = data || {};
        this.options = options || {};
        this._dv2 = null;
        this._closed = false;
    }

    get element() { return this._dv2?.element ?? null; }

    async render(/* force */ _f = true) {
        const Cls = DV2();
        const d = this.data;
        const o = this.options;

        const cfg = {
            window: { title: d.title ?? d.window?.title ?? "", icon: d.icon ?? d.window?.icon },
            content: d.content ?? "",
            buttons: convertButtons(d.buttons, d.default),
            rejectClose: false
        };
        if (o.classes) cfg.classes = Array.isArray(o.classes) ? o.classes : [o.classes];
        if (o.resizable) cfg.window.resizable = true;
        const pos = {};
        if (o.width != null) pos.width = o.width;
        if (o.height != null && o.height !== "auto") pos.height = o.height;
        if (Object.keys(pos).length) cfg.position = pos;

        // DialogV2 exige au moins un bouton ; fallback "Fermer" sinon.
        if (!cfg.buttons.length) {
            cfg.buttons = [{ action: "close", label: "Fermer", default: true }];
        }

        this._dv2 = new Cls(cfg);

        // close() V1 : callback de nettoyage à la fermeture.
        if (typeof d.close === "function") {
            const origClose = this._dv2.close.bind(this._dv2);
            const userClose = d.close;
            this._dv2.close = async (opts) => {
                if (!this._closed) {
                    this._closed = true;
                    try { await userClose(jq(this._dv2?.element)); } catch (e) {}
                }
                return origClose(opts);
            };
        }

        await this._dv2.render({ force: true });

        // render() V1 : wiring post-affichage avec l'élément (jQuery).
        if (typeof d.render === "function") {
            try { await d.render(jq(this._dv2.element)); }
            catch (e) { console.error("[SCWM compat] render callback", e); }
        }
        return this;
    }

    async close(options) {
        this._closed = true;
        try { return await this._dv2?.close(options); } catch (e) {}
    }

    static async confirm(cfg = {}) {
        const Cls = DV2();
        const opt = {
            window: { title: cfg.title ?? cfg.window?.title ?? "Confirmation" },
            content: cfg.content ?? "",
            rejectClose: false,
            modal: cfg.modal !== false
        };
        if (typeof cfg.yes === "function") {
            const y = cfg.yes;
            opt.yes = { callback: async (e, b, d) => { await y(jq(d?.element)); return true; } };
        }
        if (typeof cfg.no === "function") {
            const n = cfg.no;
            opt.no = { callback: async (e, b, d) => { await n(jq(d?.element)); return false; } };
        }
        if (cfg.defaultYes === false) opt.defaultYes = false;
        try { return await Cls.confirm(opt); }
        catch (e) { return false; }
    }

    static async prompt(cfg = {}) {
        const Cls = DV2();
        const label = cfg.label ?? cfg.buttons?.ok?.label ?? "OK";
        const cb = cfg.callback ?? cfg.buttons?.ok?.callback;
        const opt = {
            window: { title: cfg.title ?? cfg.window?.title ?? "" },
            content: cfg.content ?? "",
            rejectClose: false,
            modal: cfg.modal !== false,
            ok: {
                label,
                callback: async (e, b, d) => {
                    if (typeof cb === "function") { try { return await cb(jq(d?.element)); } catch (err) {} }
                }
            }
        };
        try { return await Cls.prompt(opt); }
        catch (e) { return null; }
    }
}

export default Dialog;
