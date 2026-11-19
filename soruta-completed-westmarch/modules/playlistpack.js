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
//   - ajouter des pistes (cochées, ou une seule avec +) à une playlist du
//     monde existante ou nouvelle, sans importer toute la playlist ;
//   - importer toute la playlist dans le monde ;
//   - ajouter de NOUVELLES musiques depuis le PC du MJ (bouton ou
//     glisser-déposer) : fichiers téléversés sur le serveur puis ajoutés à
//     cette playlist du compendium.
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

// Dernière playlist du monde choisie comme destination (mémoire de ce navigateur).
const CLE_CIBLE = `${MOD}.playlistPack.cible`;
const NOUVELLE = "__nouvelle__";
function lireCible() { try { return localStorage.getItem(CLE_CIBLE); } catch { return null; } }
function ecrireCible(id) { try { localStorage.setItem(CLE_CIBLE, id); } catch { /* navigateur privé */ } }

// Options de la liste « Ajouter à » : playlists du monde, puis « Nouvelle playlist ».
function optionsCibles(choix) {
    const pls = [...game.playlists].sort((a, b) => a.name.localeCompare(b.name, game.i18n?.lang || "fr"));
    const sel = pls.some(p => p.id === choix) ? choix : (pls[0]?.id ?? NOUVELLE);
    return pls.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("")
        + `<option value="${NOUVELLE}" ${sel === NOUVELLE ? "selected" : ""}>${tl("➕ Nouvelle playlist…")}</option>`;
}

// Copie des pistes choisies dans une playlist du monde. Les pistes déjà
// présentes (même fichier) ne sont pas dupliquées. Renvoie la playlist cible.
async function ajouterPistes(sons, cibleId, nomNouvelle, source) {
    if (!sons.length) { ui.notifications?.warn(tl("Cochez au moins une piste.")); return null; }
    let cible = cibleId !== NOUVELLE ? game.playlists.get(cibleId) : null;
    if (!cible) {
        const nom = String(nomNouvelle ?? "").trim() || source.name;
        cible = await Playlist.implementation.create({
            name: nom, mode: source.mode, fade: source.fade, channel: source.channel,
            description: source.description ?? ""
        });
        if (!cible) return null;
    }
    const deja = new Set(cible.sounds.map(s => s.path));
    const aCreer = [];
    let doublons = 0;
    for (const s of sons) {
        if (deja.has(s.path)) { doublons++; continue; }
        const d = s.toObject();
        delete d._id; delete d._stats; delete d.sort;
        d.playing = false; d.pausedTime = null;
        aCreer.push(d);
        deja.add(s.path);
    }
    if (aCreer.length) await cible.createEmbeddedDocuments("PlaylistSound", aCreer);
    ecrireCible(cible.id);
    const msg = tl("{0} piste(s) ajoutée(s) à « {1} ».", aCreer.length, cible.name)
        + (doublons ? " " + tl("{0} déjà présente(s), ignorée(s).", doublons) : "");
    (aCreer.length ? ui.notifications?.info : ui.notifications?.warn)?.call(ui.notifications, msg);
    return cible;
}

// ------------------------------------------------------------------
// Envoi de musiques depuis le PC du MJ vers une playlist du compendium.
// Les fichiers sont téléversés dans les données du serveur (dossier choisi,
// retenu par playlist), puis ajoutés comme pistes de la playlist rangée en
// compendium. Un compendium verrouillé est déverrouillé le temps de l'ajout
// (après confirmation), puis reverrouillé.
// ------------------------------------------------------------------
const FP = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
function sourceEnvoi() {
    try { if (typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge) return "forgevtt"; } catch { /* */ }
    return "data";
}
const CLE_DOSSIERS = `${MOD}.playlistPack.dossiers`;
function lireDossier(pl) {
    try { const m = JSON.parse(localStorage.getItem(CLE_DOSSIERS) || "{}"); if (m[pl.uuid]) return m[pl.uuid]; } catch { /* */ }
    const slug = String(pl.name ?? "playlist").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "playlist";
    return `musique/${slug}`;
}
function ecrireDossier(pl, dossier) {
    try { const m = JSON.parse(localStorage.getItem(CLE_DOSSIERS) || "{}"); m[pl.uuid] = dossier; localStorage.setItem(CLE_DOSSIERS, JSON.stringify(m)); } catch { /* */ }
}
const nettoyerDossier = (d) => String(d ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

function estAudio(f) {
    if (String(f?.type ?? "").startsWith("audio/")) return true;
    const ext = String(f?.name ?? "").split(".").pop().toLowerCase();
    const exts = CONST.AUDIO_FILE_EXTENSIONS ?? {};
    return Array.isArray(exts) ? exts.includes(ext) : ext in exts;
}
// « 01_La_Taverne-du-Nord.mp3 » → « 01 La Taverne du Nord »
const nomPiste = (nom) => String(nom).replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || nom;

// Crée le dossier et ses parents s'ils n'existent pas (Forge : inutile).
async function creerDossier(source, dossier) {
    if (source !== "data" || !dossier) return;
    const parties = dossier.split("/").filter(Boolean);
    for (let i = 1; i <= parties.length; i++) {
        const chemin = parties.slice(0, i).join("/");
        try { await FP().createDirectory(source, chemin, {}); } catch { /* existe déjà */ }
    }
}
// Fichiers déjà présents dans le dossier (pour ne pas en écraser un).
async function fichiersExistants(source, dossier) {
    try {
        const r = await FP().browse(source, dossier);
        return new Set((r?.files ?? []).map(f => decodeURIComponent(f.split("/").pop()).toLowerCase()));
    } catch { return new Set(); }
}
function nomLibre(nom, pris) {
    if (!pris.has(nom.toLowerCase())) return nom;
    const point = nom.lastIndexOf(".");
    const base = point > 0 ? nom.slice(0, point) : nom, ext = point > 0 ? nom.slice(point) : "";
    let n = 2;
    while (pris.has(`${base}-${n}${ext}`.toLowerCase())) n++;
    return `${base}-${n}${ext}`;
}

// Le compendium accepte-t-il l'écriture ? Sinon, proposer de le déverrouiller.
// Renvoie true si l'on peut écrire, et s'il faudra le reverrouiller.
async function deverrouiller(pack) {
    if (!pack.locked) return { ok: true, reverrouiller: false };
    const oui = await foundry.applications.api.DialogV2.confirm({
        window: { title: tl("Compendium verrouillé"), icon: "fa-solid fa-lock" },
        content: `<p>${tl("Le compendium « {0} » est verrouillé. Le déverrouiller le temps d'ajouter les pistes ? Il sera reverrouillé juste après.", esc(pack.metadata?.label ?? pack.collection))}</p>`,
        rejectClose: false
    }).catch(() => false);
    if (!oui) return { ok: false };
    await pack.configure({ locked: false });
    return { ok: true, reverrouiller: true };
}

async function envoyerDepuisPc(pack, pl, fichiers, dossierSaisi, statut) {
    const audios = [...fichiers].filter(estAudio);
    const refuses = fichiers.length - audios.length;
    if (refuses) ui.notifications?.warn(tl("{0} fichier(s) ignoré(s) : ce ne sont pas des fichiers audio.", refuses));
    if (!audios.length) return 0;
    if (!game.user.can?.("FILES_UPLOAD")) { ui.notifications?.error(tl("Vous n'avez pas le droit de téléverser des fichiers sur ce serveur.")); return 0; }

    const verrou = await deverrouiller(pack);
    if (!verrou.ok) return 0;
    const source = sourceEnvoi();
    const dossier = nettoyerDossier(dossierSaisi) || lireDossier(pl);
    ecrireDossier(pl, dossier);
    let ajoutees = 0;
    try {
        await creerDossier(source, dossier);
        const pris = await fichiersExistants(source, dossier);
        let tri = Math.max(0, ...[...pl.sounds].map(s => s.sort ?? 0));
        const aCreer = [];
        for (const [i, f] of audios.entries()) {
            statut?.(tl("Envoi {0}/{1} : {2}", i + 1, audios.length, f.name));
            const nom = nomLibre(f.name, pris);
            const fichier = nom === f.name ? f : new File([f], nom, { type: f.type });
            let res;
            try { res = await FP().upload(source, dossier, fichier, {}, { notify: false }); }
            catch (e) { journal.avert(tl("[{0}] Téléversement de {1} :", MOD, f.name), e); }
            const chemin = res?.path;
            if (!chemin || res?.status === "error") {
                ui.notifications?.error(tl("Échec de l'envoi de « {0} » (taille maximale du serveur ?).", f.name));
                continue;
            }
            pris.add(nom.toLowerCase());
            tri += 100;
            aCreer.push({ name: nomPiste(f.name), path: chemin, volume: 0.5, repeat: false, sort: tri });
        }
        if (aCreer.length) {
            await pl.createEmbeddedDocuments("PlaylistSound", aCreer);
            ajoutees = aCreer.length;
            ui.notifications?.info(tl("{0} musique(s) ajoutée(s) à « {1} » (fichiers dans {2}).", ajoutees, pl.name, dossier));
        }
    } finally {
        statut?.("");
        if (verrou.reverrouiller) { try { await pack.configure({ locked: true }); } catch { /* */ } }
    }
    return ajoutees;
}

export async function voirPistes(pack, id) {
    if (!game.user.isGM || !pack || !id) return;
    let pl;
    try { pl = await pack.getDocument(id); } catch (e) { journal.avert(tl("[{0}] Lecture de la playlist :", MOD), e); }
    if (!pl) { ui.notifications?.warn(tl("Playlist introuvable dans le compendium.")); return; }
    const sons = [...(pl.sounds ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name)));

    const lignes = sons.map(s => `
        <div class="scwm-pp-ligne" data-son="${esc(s.id)}" style="display:flex;align-items:center;gap:8px;padding:4px 2px;border-bottom:1px solid rgba(201,162,39,.15);">
            <input type="checkbox" class="scwm-pp-coche" data-son="${esc(s.id)}" style="flex:0 0 auto;margin:0;" aria-label="${esc(s.name)}">
            <button type="button" class="scwm-pp-play" data-son="${esc(s.id)}" data-tooltip="${tl("Écouter (chez vous seulement)")}"
                style="flex:0 0 28px;width:28px;height:26px;padding:0;margin:0;"><i class="fa-solid fa-play"></i></button>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                <div style="font-size:11px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${esc(s.path)}">${esc(fichier(s.path))}</div>
            </div>
            <button type="button" class="scwm-pp-plus" data-son="${esc(s.id)}" data-tooltip="${tl("Ajouter cette piste à la playlist choisie")}"
                style="flex:0 0 28px;width:28px;height:26px;padding:0;margin:0;"><i class="fa-solid fa-plus"></i></button>
        </div>`).join("");

    const barre = sons.length ? `
        <div class="scwm-pp-barre" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 6px;padding:6px;border:1px solid rgba(201,162,39,.3);border-radius:4px;">
            <label style="display:flex;align-items:center;gap:4px;flex:0 0 auto;white-space:nowrap;"><input type="checkbox" class="scwm-pp-tout" style="margin:0;"> ${tl("Tout")}</label>
            <span style="flex:0 0 auto;opacity:.8;">${tl("Ajouter à")}</span>
            <select class="scwm-pp-cible" style="flex:1 1 140px;min-width:0;">${optionsCibles(lireCible())}</select>
            <input type="text" class="scwm-pp-nom" value="${esc(pl.name)}" placeholder="${tl("Nom de la nouvelle playlist")}" style="flex:1 1 140px;min-width:0;display:none;">
            <button type="button" class="scwm-pp-ajouter" disabled style="flex:0 0 auto;width:auto;margin:0;white-space:nowrap;">
                <i class="fa-solid fa-plus"></i> <span>${tl("Ajouter la sélection")}</span></button>
        </div>` : "";

    const blocPc = `
        <div class="scwm-pp-pc" style="margin:0 0 6px;padding:6px;border:1px dashed rgba(201,162,39,.5);border-radius:4px;">
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">
                <span style="flex:0 0 auto;opacity:.8;">${tl("Dossier")}</span>
                <input type="text" class="scwm-pp-dossier" value="${esc(lireDossier(pl))}" style="flex:1 1 160px;min-width:0;"
                    data-tooltip="${tl("Dossier du serveur où les fichiers sont rangés (créé s'il n'existe pas).")}">
                <button type="button" class="scwm-pp-parcourir" data-tooltip="${tl("Choisir un dossier")}" style="flex:0 0 32px;width:32px;margin:0;"><i class="fa-solid fa-folder-open"></i></button>
                <button type="button" class="scwm-pp-envoyer" style="flex:0 0 auto;width:auto;margin:0;white-space:nowrap;">
                    <i class="fa-solid fa-upload"></i> ${tl("Ajouter depuis mon PC")}</button>
                <input type="file" class="scwm-pp-fichiers" accept="audio/*,.mp3,.ogg,.oga,.opus,.wav,.flac,.m4a,.aac,.webm" multiple hidden>
            </div>
            <div class="scwm-pp-statut" style="margin-top:4px;font-size:11px;opacity:.75;">${tl("…ou glissez des fichiers audio sur cette fenêtre.")}</div>
        </div>`;

    const content = `<div class="scwm-pp">
        <p style="margin:0 0 6px;font-size:12px;opacity:.8;">${tl("{0} piste(s). L'écoute est un aperçu chez vous seulement : les joueurs n'entendent rien.", sons.length)}</p>
        ${blocPc}
        ${barre}
        <div style="max-height:50vh;overflow-y:auto;">${lignes || `<em style="opacity:.7;">${tl("Aucune piste.")}</em>`}</div>
    </div>`;

    await foundry.applications.api.DialogV2.wait({
        window: { title: tl("Pistes — {0}", pl.name), icon: "fa-solid fa-music" },
        position: { width: 540 },
        rejectClose: false,
        content,
        render: (_ev, app) => {
            const root = app?.element;
            if (!root) return;

            // ---- aperçu ▶
            root.querySelectorAll(".scwm-pp-play").forEach(b => b.addEventListener("click", async () => {
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

            // ---- ajout de musiques depuis le PC (dans CETTE playlist du compendium)
            const champDossier = root.querySelector(".scwm-pp-dossier");
            const entree = root.querySelector(".scwm-pp-fichiers");
            const statutEl = root.querySelector(".scwm-pp-statut");
            const texteStatut = statutEl?.textContent ?? "";
            const statut = (t) => { if (statutEl) statutEl.textContent = t || texteStatut; };
            let envoiEnCours = false;
            const envoyer = async (fichiers) => {
                if (envoiEnCours || !fichiers?.length) return;
                envoiEnCours = true;
                try {
                    const n = await envoyerDepuisPc(pack, pl, fichiers, champDossier?.value, statut);
                    if (n) { await arreterApercu(); await app.close(); voirPistes(pack, id); }   // liste à jour
                } catch (e) {
                    journal.erreur(tl("[{0}] Ajout de musiques depuis le PC :", MOD), e);
                    ui.notifications?.error(tl("Ajout impossible (voir console)."));
                } finally { envoiEnCours = false; }
            };
            root.querySelector(".scwm-pp-envoyer")?.addEventListener("click", () => entree?.click());
            entree?.addEventListener("change", () => { const f = [...entree.files]; entree.value = ""; envoyer(f); });
            root.querySelector(".scwm-pp-parcourir")?.addEventListener("click", () => {
                new (FP())({ type: "folder", current: champDossier.value, callback: (p) => { champDossier.value = nettoyerDossier(p); } }).render(true);
            });
            champDossier?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.preventDefault(); });
            const zone = root.querySelector(".scwm-pp-pc");
            root.addEventListener("dragover", (ev) => {
                if (![...(ev.dataTransfer?.types ?? [])].includes("Files")) return;
                ev.preventDefault(); if (zone) zone.style.background = "rgba(201,162,39,.15)";
            });
            root.addEventListener("dragleave", (ev) => { if (!root.contains(ev.relatedTarget) && zone) zone.style.background = ""; });
            root.addEventListener("drop", (ev) => {
                if (!ev.dataTransfer?.files?.length) return;
                ev.preventDefault(); ev.stopPropagation();
                if (zone) zone.style.background = "";
                envoyer([...ev.dataTransfer.files]);
            });

            // ---- ajout dans une playlist du monde
            const cible = root.querySelector(".scwm-pp-cible");
            const nom = root.querySelector(".scwm-pp-nom");
            const tout = root.querySelector(".scwm-pp-tout");
            const btn = root.querySelector(".scwm-pp-ajouter");
            if (!cible || !btn) return;
            const coches = () => [...root.querySelectorAll(".scwm-pp-coche")];
            const majBouton = () => {
                const n = coches().filter(c => c.checked).length;
                btn.disabled = n === 0;
                btn.querySelector("span").textContent = n ? tl("Ajouter la sélection ({0})", n) : tl("Ajouter la sélection");
                tout.checked = n > 0 && n === coches().length;
                tout.indeterminate = n > 0 && n < coches().length;
            };
            const majNom = () => { nom.style.display = cible.value === NOUVELLE ? "" : "none"; };
            majNom();
            cible.addEventListener("change", majNom);
            nom.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); btn.click(); } });
            tout.addEventListener("change", () => { coches().forEach(c => { c.checked = tout.checked; }); majBouton(); });
            root.querySelectorAll(".scwm-pp-coche").forEach(c => c.addEventListener("change", majBouton));

            let occupe = false;
            const lancer = async (ids) => {
                if (occupe) return;
                occupe = true; btn.disabled = true;
                try {
                    const choix = sons.filter(s => ids.includes(s.id));
                    const res = await ajouterPistes(choix, cible.value, nom.value, pl);
                    if (res) {
                        // une playlist créée apparaît dans la liste et reste choisie
                        cible.innerHTML = optionsCibles(res.id);
                        majNom();
                        coches().forEach(c => { c.checked = false; });
                    }
                } catch (e) {
                    journal.erreur(tl("[{0}] Ajout de pistes à une playlist :", MOD), e);
                    ui.notifications?.error(tl("Ajout impossible (voir console)."));
                } finally { occupe = false; majBouton(); }
            };
            btn.addEventListener("click", () => lancer(coches().filter(c => c.checked).map(c => c.dataset.son)));
            root.querySelectorAll(".scwm-pp-plus").forEach(b => b.addEventListener("click", () => lancer([b.dataset.son])));
            majBouton();
        },
        buttons: [
            { action: "importer", label: tl("Importer toute la playlist"), icon: "fa-solid fa-file-import" },
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
