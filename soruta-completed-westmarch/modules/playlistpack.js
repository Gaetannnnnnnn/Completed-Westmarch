import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
// ============================================================
// playlistpack.js — Voir les pistes d'une playlist rangée en compendium
//
// Foundry ne montre, dans un compendium de playlists, que le nom des
// playlists : leur fiche ne liste pas les pistes. Ce module ajoute sur chaque
// playlist du compendium un bouton 🎵 (et l'entrée « Voir les pistes » du
// clic droit) qui ouvre une fenêtre :
//   - liste des pistes (nom, fichier) ;
//   - ▶ Écouter : aperçu LOCAL (chez le MJ seulement, rien n'est diffusé) ;
//   - Importer dans le monde.
//
// Rien n'est chargé à l'avance : à l'ouverture, seul CE document est lu dans
// le compendium (quelques Ko de texte) ; un fichier audio n'est lu que si l'on
// clique ▶, en continu, et il est arrêté à la fermeture de la fenêtre.
// MJ uniquement. Réglage : enablePlaylistPackViewer.
// © 2026 Soruta.
// ============================================================

const actif = () => { try { return game.settings.get(MOD, "enablePlaylistPackViewer") !== false; } catch { return false; } };
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const fichier = (p) => decodeURIComponent(String(p ?? "").split("/").pop() || "");

let _apercu = null;      // son en cours d'aperçu
let _apercuId = null;
async function arreterApercu() {
    try { await _apercu?.stop?.(); } catch { /* */ }
    _apercu = null; _apercuId = null;
}
async function jouerApercu(snd) {
    await arreterApercu();
    const AH = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    // 2e argument false : lecture locale, aucune diffusion aux autres clients.
    _apercu = await AH.play({ src: snd.path, volume: Math.min(1, Number(snd.volume) || 0.5), loop: false }, false);
    _apercuId = snd._id ?? snd.id;
    return _apercu;
}

export async function voirPistes(pack, id) {
    if (!game.user.isGM || !pack || !id) return;
    let pl;
    try { pl = await pack.getDocument(id); } catch (e) { journal.avert(tl("[{0}] Lecture de la playlist :", MOD), e); }
    if (!pl) { ui.notifications?.warn(tl("Playlist introuvable dans le compendium.")); return; }
    const sons = [...(pl.sounds ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name)));

    const lignes = sons.map(s => `
        <div class="scwm-pp-ligne" data-son="${esc(s.id)}" style="display:flex;align-items:center;gap:8px;padding:4px 2px;border-bottom:1px solid rgba(201,162,39,.15);">
            <button type="button" class="scwm-pp-play" data-son="${esc(s.id)}" data-tooltip="${tl("Écouter (chez vous seulement)")}"
                style="flex:0 0 28px;width:28px;height:26px;padding:0;margin:0;"><i class="fa-solid fa-play"></i></button>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                <div style="font-size:11px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${esc(s.path)}">${esc(fichier(s.path))}</div>
            </div>
        </div>`).join("");

    const content = `<div class="scwm-pp">
        <p style="margin:0 0 6px;font-size:12px;opacity:.8;">${tl("{0} piste(s). L'écoute est un aperçu chez vous seulement : les joueurs n'entendent rien.", sons.length)}</p>
        <div style="max-height:55vh;overflow-y:auto;">${lignes || `<em style="opacity:.7;">${tl("Aucune piste.")}</em>`}</div>
    </div>`;

    await foundry.applications.api.DialogV2.wait({
        window: { title: tl("Pistes — {0}", pl.name), icon: "fa-solid fa-music" },
        position: { width: 460 },
        rejectClose: false,
        content,
        render: (_ev, app) => {
            const root = app?.element;
            root?.querySelectorAll(".scwm-pp-play").forEach(b => b.addEventListener("click", async () => {
                const snd = sons.find(x => x.id === b.dataset.son);
                if (!snd) return;
                const enCours = _apercuId === snd.id;
                root.querySelectorAll(".scwm-pp-play i").forEach(i => { i.className = "fa-solid fa-play"; });
                if (enCours) { await arreterApercu(); return; }
                try {
                    const son = await jouerApercu(snd);
                    b.querySelector("i").className = "fa-solid fa-stop";
                    son?.addEventListener?.("end", () => { if (_apercuId === snd.id) { b.querySelector("i").className = "fa-solid fa-play"; _apercu = null; _apercuId = null; } });
                } catch (e) {
                    journal.avert(tl("[{0}] Aperçu audio :", MOD), e);
                    ui.notifications?.warn(tl("Impossible de lire « {0} » (fichier manquant ?).", snd.name));
                }
            }));
        },
        buttons: [
            { action: "importer", label: tl("Importer dans le monde"), icon: "fa-solid fa-file-import" },
            { action: "fermer", label: tl("Fermer"), icon: "fa-solid fa-xmark", default: true }
        ],
        submit: async (r) => {
            await arreterApercu();
            if (r !== "importer") return;
            try {
                const doc = await game.playlists.importFromCompendium(pack, id);
                ui.notifications?.info(tl("Playlist « {0} » importée dans le monde.", doc?.name ?? pl.name));
            } catch (e) {
                journal.erreur(tl("[{0}] Import de la playlist :", MOD), e);
                ui.notifications?.error(tl("Import impossible (voir console)."));
            }
        }
    }).catch(() => null);
    await arreterApercu();   // fermeture par la croix
}

// Id d'une entrée de compendium (v13+ : data-entry-id ; avant : data-document-id).
const idDe = (li) => li?.dataset?.entryId ?? li?.dataset?.documentId;

export function PlaylistPackHooks() {
    // Bouton 🎵 sur chaque playlist d'un compendium de playlists.
    Hooks.on("renderCompendium", (app, html) => {
        try {
            if (!actif() || !game.user.isGM) return;
            const pack = app?.collection;
            if (pack?.documentName !== "Playlist") return;
            const root = (html instanceof HTMLElement) ? html : (html?.[0] ?? app.element);
            root?.querySelectorAll("[data-entry-id], [data-document-id]").forEach(li => {
                if (li.querySelector(".scwm-pp-btn") || !idDe(li)) return;
                const b = document.createElement("a");
                b.className = "scwm-pp-btn";
                b.dataset.tooltip = tl("Voir les pistes");
                b.innerHTML = `<i class="fa-solid fa-music"></i>`;
                b.style.cssText = "margin-left:auto;padding:0 6px;color:#c9a227;cursor:pointer;flex:0 0 auto;";
                b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); voirPistes(pack, idDe(li)); });
                li.appendChild(b);
            });
        } catch (e) { journal.avert(tl("[{0}] Bouton des pistes (compendium) :", MOD), e); }
    });

    // Clic droit sur une playlist du compendium → « Voir les pistes ».
    const ajouter = (app, options) => {
        if (!actif() || !game.user.isGM) return;
        const pack = app?.collection;
        if (pack?.documentName !== "Playlist") return;
        if (options.some(o => o.name === tl("Voir les pistes"))) return;
        options.unshift({
            name: tl("Voir les pistes"),
            icon: '<i class="fa-solid fa-music"></i>',
            condition: () => true,
            callback: (li) => voirPistes(pack, idDe(li instanceof HTMLElement ? li : li?.[0]))
        });
    };
    Hooks.on("getCompendiumEntryContext", ajouter);
    Hooks.on("getCompendiumContextOptions", ajouter);
}
