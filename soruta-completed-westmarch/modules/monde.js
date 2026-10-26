// ============================================================
// monde.js — Registre du monde (PNJ, lieux, organisations)
//
// En West Marches, tous les MJ doivent savoir ce qu'est un lieu, qui est un
// PNJ, où il se trouve et ce qui s'y est passé. Ce fichier s'appuie sur
// Monk's Enhanced Journal (MEJ), qui reste la source : chaque PNJ / lieu /
// organisation est une fiche MEJ (une entrée de journal, une page « person »,
// « place » ou « organization »). Le module ajoute :
//
//   - un MODÈLE DE RÉDACTION commun : des rubriques courtes, réglables par type
//     dans les paramètres, saisies dans la fenêtre « Rédiger la fiche ». Le
//     texte de la page MEJ est généré à partir de ces rubriques ; les rubriques
//     « secret MJ » deviennent des blocs secrets natifs de Foundry, jamais
//     montrés aux joueurs même si la page leur est révélée ;
//   - les LIENS : acteur ↔ fiche PNJ (lien natif MEJ), scène ↔ fiche lieu,
//     lieu principal d'un PNJ et PNJ présents sur les cartes d'un lieu, écrits
//     dans les relations natives de MEJ (onglet Relations) ;
//   - les RELATIONS PJ ↔ PNJ du module (relations.js), recopiées sur la fiche ;
//   - un onglet « Monde » dans le Casier pour tout retrouver ;
//   - les ÉPINGLES : un lieu est représenté par une note posée sur la carte du
//     monde (les scènes de « Carte des expéditions »). Le module la retrouve
//     (« Voir sur la carte »), peut la poser (« Placer sur la carte »), et s'en
//     sert pour la DÉCOUVERTE : un lieu dont l'épingle est sur une case explorée
//     par le personnage d'un joueur devient lisible par ce joueur (partie non
//     secrète), ce qui fait aussi apparaître l'épingle sur sa carte.
//
// Données propres au module, sur la page MEJ : flags[MOD].fiche =
//   { rubriques: {id: texte}, historique: [...], texteLibre, scenes: [ids],
//     hash, maj, majPar }
// Rien n'est jamais écrasé en silence : si le texte d'une page a été modifié
// directement dans MEJ, les mises à jour automatiques (« Actualiser »)
// ne réécrivent pas le texte ; la fenêtre « Rédiger » prévient et propose de
// garder l'ancien texte dans « Notes ».
//
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { expeditionSceneIds, getExplored, zonesMap } from "./map.js";

const MEJ = "monks-enhanced-journal";
const NONE = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
const OBSERVER = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
const HISTORIQUE_AFFICHE = 30;  // lignes écrites dans le texte de la page

export const TYPES = {
    person:       { label: "PNJ",          pluriel: "PNJ",           icon: "fa-user",         packKey: "mondePackPerson", packFolderKey: "mondePackPersonFolder", packLabel: "Registre — PNJ" },
    place:        { label: "Lieu",         pluriel: "Lieux",         icon: "fa-location-dot", dossierKey: "mondeFolderPlace", dossier: "Lieux" },
    organization: { label: "Organisation", pluriel: "Organisations", icon: "fa-people-group", packKey: "mondePackOrg", packFolderKey: "mondePackOrgFolder", packLabel: "Registre — Organisations" }
};

export const RUBRIQUES_DEFAUT = {
    person: [
        { id: "phrase",    label: "En une phrase",   secret: false },
        { id: "role",      label: "Rôle",            secret: false },
        { id: "ou",        label: "Où le trouver",   secret: false },
        { id: "veut",      label: "Ce qu'il veut",   secret: true  },
        { id: "sait",      label: "Ce qu'il sait",   secret: true  },
        { id: "accroches", label: "Accroches",       secret: true  },
        { id: "etat",      label: "État actuel",     secret: true  }
    ],
    place: [
        { id: "phrase",    label: "En une phrase",   secret: false },
        { id: "ambiance",  label: "Ambiance",        secret: false },
        { id: "qui",       label: "Qui s'y trouve",  secret: false },
        { id: "quoi",      label: "Ce qu'on y fait", secret: false },
        { id: "dangers",   label: "Dangers",         secret: true  },
        { id: "secrets",   label: "Secrets",         secret: true  },
        { id: "etat",      label: "État actuel",     secret: true  }
    ],
    organization: [
        { id: "phrase",    label: "En une phrase",   secret: false },
        { id: "objectifs", label: "Objectifs",       secret: false },
        { id: "membres",   label: "Membres clés",    secret: false },
        { id: "ou",        label: "Où les trouver",  secret: false },
        { id: "secrets",   label: "Secrets",         secret: true  },
        { id: "etat",      label: "État actuel",     secret: true  }
    ]
};

// Clés de réglages dessinées par ce fichier dans sa catégorie.
export const MONDE_KEYS = new Set(["mondeRubriques"]);

// ============================================================
// Réglages
// ============================================================
export function registerMondeSettings() {
    const w = (type, def, extra = {}) => ({ scope: "world", config: false, type, default: def, requiresReload: false, ...extra });
    game.settings.register(MOD, "mondeEnabled", w(Boolean, false, {
        name: "Registre du monde",
        hint: "Fiches de PNJ, lieux et organisations rédigées sur un modèle commun dans Monk's Enhanced Journal, reliées aux acteurs, aux scènes et à la carte du monde. Nécessite Monk's Enhanced Journal."
    }));
    game.settings.register(MOD, "mondeDecouverte", w(Boolean, true, {
        name: "Découverte des lieux par le brouillard",
        hint: "Un lieu dont l'épingle est posée sur la carte du monde devient lisible par un joueur dès que l'un de ses personnages a exploré cette case (ou si la case est une zone toujours éclairée). L'épingle apparaît alors sur sa carte ; les secrets MJ restent cachés. Réglable lieu par lieu (auto / toujours caché / visible par tous)."
    }));
    game.settings.register(MOD, "mondeDecouverteMessage", w(Boolean, true, {
        name: "Prévenir le joueur d'un lieu découvert",
        hint: "Message privé au joueur dans le chat (« Nouveau lieu découvert : … ») quand un lieu devient visible pour lui."
    }));
    game.settings.register(MOD, "mondeBanniere", w(Boolean, true, {
        name: "Bannière « Nouveau lieu découvert »",
        hint: "Quand un lieu devient visible pour un joueur, son nom s'affiche en grand, en lettres dorées sans fond, au centre de son écran, puis disparaît en fondu (façon jeu en monde ouvert). Seuls les joueurs concernés et connectés la voient."
    }));
    game.settings.register(MOD, "mondeBanniereSon", w(String, "", {
        name: "Son de la bannière",
        hint: "Fichier audio joué à l'apparition de la bannière (facultatif). Laisser vide pour aucun son."
    }));
    game.settings.register(MOD, "mondeEpinglesPartout", w(Boolean, true, {
        name: "Épingles visibles dans tous les modes",
        hint: "Sur la carte du monde, les épingles des lieux restent affichées quel que soit l'outil choisi (jetons, mesures…), pas seulement dans « Notes de journal ». Le nom du lieu s'affiche au survol de l'épingle. Les joueurs ne voient que les lieux qu'ils ont découverts."
    }));
    game.settings.register(MOD, "mondeTailleEpingle", w(Number, 32, {
        name: "Taille des épingles de lieux",
        hint: "Taille affichée des épingles sur la carte, en pixels de carte (8 à 512 ; 32 par défaut). Chaque client l'applique aussitôt, sans recharger.",
        onChange: () => rafraichirEpingles()
    }));
    game.settings.register(MOD, "mondeEpinglesMigrees", w(Boolean, false, { name: "Épingles de lieux converties (interne)" }));
    game.settings.register(MOD, "mondePackPerson", w(String, "", {
        name: "Compendium des fiches PNJ",
        hint: "Compendium de journaux (monde) où ranger les fiches PNJ. Chargé seulement à la demande, il n'alourdit pas la connexion. Vide : le module crée « Registre — PNJ » au premier besoin."
    }));
    game.settings.register(MOD, "mondePackOrg", w(String, "", {
        name: "Compendium des fiches d'organisations",
        hint: "Compendium de journaux (monde) où ranger les fiches d'organisations. Vide : le module crée « Registre — Organisations » au premier besoin."
    }));
    game.settings.register(MOD, "mondePackPersonFolder", w(String, "", {
        name: "Dossier des fiches PNJ dans le compendium",
        hint: "Nom d'un dossier DANS le compendium des PNJ où ranger les nouvelles fiches (créé s'il n'existe pas). Vide : racine du compendium."
    }));
    game.settings.register(MOD, "mondePackOrgFolder", w(String, "", {
        name: "Dossier des fiches d'organisations dans le compendium",
        hint: "Nom d'un dossier DANS le compendium des organisations (créé s'il n'existe pas). Vide : racine du compendium."
    }));
    game.settings.register(MOD, "mondeFolderPlace", w(String, "Lieux", {
        name: "Dossier des fiches de lieux",
        hint: "Nom du dossier de journaux (dans le monde) où ranger les nouvelles fiches de lieux, créé s'il n'existe pas. Les lieux restent dans le monde : une épingle de carte ne peut pas pointer vers un compendium."
    }));
    game.settings.register(MOD, "mondeRubriques", w(Object, RUBRIQUES_DEFAUT, { name: "Rubriques des fiches" }));
}

const lire = (k, def) => { try { return game.settings.get(MOD, k); } catch { return def; } };
export const mejActif = () => !!game.modules?.get(MEJ)?.active;
export const mondeActif = () => lire("mondeEnabled", false) === true && mejActif();

// ============================================================
// Fonctions pures (testables sans Foundry)
// ============================================================
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function normaliserRubriques(raw) {
    const src = (raw && typeof raw === "object") ? raw : {};
    const out = {};
    for (const type of Object.keys(TYPES)) {
        const liste = Array.isArray(src[type]) ? src[type] : RUBRIQUES_DEFAUT[type];
        const vus = new Set();
        out[type] = liste
            .filter(r => r && String(r.label ?? "").trim())
            .map((r, i) => {
                let id = String(r.id ?? "").replace(/[^A-Za-z0-9_-]/g, "") || `r${i}`;
                while (vus.has(id)) id += "x";
                vus.add(id);
                return { id, label: String(r.label).trim().slice(0, 60), secret: !!r.secret };
            });
    }
    return out;
}

// Texte saisi → HTML : paragraphes (ligne vide), retours à la ligne, listes
// à puces (lignes commençant par « - »). Les liens @UUID[…]{…} sont conservés
// tels quels : Foundry les rend cliquables à l'affichage.
export function texteEnHtml(t) {
    const blocs = String(t ?? "").replace(/\r/g, "").split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    return blocs.map(b => {
        const lignes = b.split("\n").map(l => l.trim()).filter(Boolean);
        if (lignes.every(l => /^[-•*]\s+/.test(l)))
            return `<ul>${lignes.map(l => `<li>${esc(l.replace(/^[-•*]\s+/, ""))}</li>`).join("")}</ul>`;
        return `<p>${lignes.map(esc).join("<br>")}</p>`;
    }).join("");
}

// Empreinte courte d'un texte (pour savoir si la page a été retouchée à la main).
export function empreinte(s) {
    const t = String(s ?? "").replace(/\s+/g, "");
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

const NIVEAUX_RELATION = { "-3": "Haine totale", "-2": "Hostilité", "-1": "Méfiance", "0": "Neutre", "1": "Sympathie", "2": "Amitié", "3": "Loyauté" };

const secretHtml = (id, revele, inner) =>
    `<section class="secret${revele ? " revealed" : ""}" id="secret-scwm-${id}">${inner}</section>`;

// Texte complet de la page. ctx = { relationsPJ: [{pj, niveau, type, note}],
//   scenes: [{id, name}], revelees: Set(ids de blocs secrets révélés) }
export function genererContenu(type, fiche, rubriques, ctx = {}) {
    const rev = ctx.revelees ?? new Set();
    const parts = [];
    for (const r of rubriques[type] ?? []) {
        const val = fiche?.rubriques?.[r.id];
        if (!String(val ?? "").trim()) continue;
        const bloc = `<h3>${esc(r.label)}</h3>${texteEnHtml(val)}`;
        parts.push(r.secret ? secretHtml(r.id, rev.has(r.id), bloc) : bloc);
    }
    if (type === "person" && ctx.relationsPJ?.length) {
        const li = ctx.relationsPJ.map(x => {
            const niv = NIVEAUX_RELATION[String(x.niveau ?? 0)] ?? "Neutre";
            const signe = Number(x.niveau) > 0 ? `+${x.niveau}` : `${x.niveau ?? 0}`;
            return `<li><strong>${esc(x.pj)}</strong> — ${niv} (${signe})${x.type ? ` · ${esc(x.type)}` : ""}${x.note ? ` · ${esc(x.note)}` : ""}</li>`;
        }).join("");
        parts.push(secretHtml("relations", rev.has("relations"), `<h3>Relations avec les PJ</h3><ul>${li}</ul>`));
    }
    if (type === "place" && ctx.scenes?.length) {
        const li = ctx.scenes.map(s => `<li>@UUID[Scene.${s.id}]{${esc(s.name)}}</li>`).join("");
        parts.push(secretHtml("cartes", rev.has("cartes"), `<h3>Cartes locales</h3><ul>${li}</ul>`));
    }
    if (String(fiche?.texteLibre ?? "").trim()) {
        parts.push(`<h3>Notes</h3>${fiche.texteLibre}`);
    }
    const hist = (fiche?.historique ?? []).slice(-HISTORIQUE_AFFICHE).reverse();
    if (hist.length) {
        const li = hist.map(h => `<li><strong>${esc(h.date)}</strong> — ${esc(h.mj)}${h.pj?.length ? ` — ${esc(h.pj.join(", "))}` : ""}${h.texte ? ` : ${esc(h.texte)}` : ""}</li>`).join("");
        parts.push(secretHtml("historique", rev.has("historique"), `<h3>Historique des sessions</h3><ul>${li}</ul>`));
    }
    return parts.join("\n");
}

// Première ligne non vide (pour les champs courts de MEJ : rôle, lieu).
export const premiereLigne = (t) => String(t ?? "").split("\n").map(l => l.replace(/^[-•*]\s+/, "").trim()).find(Boolean) ?? "";

// ============================================================
// Accès aux fiches
// ============================================================
export const pageDe = (entry) => entry?.pages?.contents?.[0] ?? null;

export function typeDe(entry) {
    const page = pageDe(entry);
    const t = page?.getFlag?.(MEJ, "type") ?? entry?.getFlag?.(MEJ, "type");
    return TYPES[t] ? t : null;
}
// Fiches du MONDE seulement (les lieux, et d'éventuelles anciennes fiches PNJ /
// organisations pas encore rangées en compendium). Synchrone.
export function toutesLesFiches() {
    return (game.journal?.contents ?? []).filter(e => typeDe(e)).map(e => ({ entry: e, page: pageDe(e), type: typeDe(e) }));
}

// Compendium configuré pour un type (null pour les lieux, ou si non réglé).
export function packDe(type) {
    const k = TYPES[type]?.packKey;
    const id = k ? lire(k, "") : "";
    return id ? (game.packs?.get(id) ?? null) : null;
}
// Compendium d'un type, créé (compendium du monde) s'il n'existe pas encore.
async function packPour(type) {
    let p = packDe(type);
    if (p) return p;
    const label = TYPES[type].packLabel;
    p = game.packs.find(x => x.documentName === "JournalEntry" && x.metadata?.packageType === "world" && (x.metadata?.label === label || x.title === label)) ?? null;
    if (!p) {
        const Cls = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
        p = await Cls.createCompendium({ label, type: "JournalEntry" });
    }
    await game.settings.set(MOD, TYPES[type].packKey, p.collection);
    return p;
}
function verifierDeverrouille(pack) {
    if (pack?.locked) throw new Error(`Le compendium « ${pack.title ?? pack.collection} » est verrouillé : déverrouille-le (clic droit sur le compendium) pour y écrire.`);
}

// Toutes les fiches : monde + compendiums PNJ / organisations (chargés ici,
// seulement quand on en a besoin : onglet Monde, « Actualiser », recherche).
export async function chargerFiches() {
    const out = toutesLesFiches();
    const vus = new Set();
    for (const type of ["person", "organization"]) {
        const p = packDe(type);
        if (!p || vus.has(p.collection)) continue;
        vus.add(p.collection);
        try {
            for (const d of await p.getDocuments()) if (typeDe(d)) out.push({ entry: d, page: pageDe(d), type: typeDe(d) });
        } catch (e) { journal.avert(`[${MOD}] lecture du compendium ${p.collection}`, e); }
    }
    return out;
}
export const ficheDe = (page) => foundry.utils.deepClone(page?.getFlag?.(MOD, "fiche") ?? {});
export const rubriques = () => normaliserRubriques(lire("mondeRubriques", RUBRIQUES_DEFAUT));

// Fiche PNJ d'un acteur : lien posé par le module, sinon lien natif MEJ
// (recherché dans le monde puis dans le compendium des PNJ).
export async function ficheDeActeur(actor) {
    if (!actor) return null;
    const uuid = actor.getFlag?.(MOD, "fichePage");
    let viaFlag = null;
    try { viaFlag = uuid ? await fromUuid(uuid) : null; } catch {}
    if (viaFlag && typeDe(viaFlag) === "person") return viaFlag;
    const lie = (e) => typeDe(e) === "person" && pageDe(e)?.getFlag(MEJ, "actor")?.id === actor.id;
    const monde = game.journal.find(lie);
    if (monde) return monde;
    const p = packDe("person");
    if (!p) return null;
    try { return (await p.getDocuments()).find(lie) ?? null; } catch { return null; }
}
// Fiche lieu d'une scène.
export function ficheDeScene(scene) {
    if (!scene) return null;
    const uuid = scene.getFlag?.(MOD, "fichePage");
    const viaFlag = uuid ? fromUuidSync(uuid) : null;
    if (viaFlag && typeDe(viaFlag) === "place") return viaFlag;
    return game.journal.find(e => typeDe(e) === "place" && (ficheDe(pageDe(e)).scenes ?? []).includes(scene.id)) ?? null;
}
function acteurDe(page) {
    const lien = page?.getFlag?.(MEJ, "actor");
    if (!lien) return null;
    return (lien.id && game.actors.get(lien.id)) || (lien.uuid ? fromUuidSync(lien.uuid) : null);
}

// Relations PJ → ce PNJ, lues dans relations.js (flag relationsList des PJ).
function relationsVers(actor) {
    if (!actor) return [];
    const out = [];
    for (const pj of game.actors) {
        if (pj.type !== "character" || !pj.hasPlayerOwner) continue;
        const rel = (pj.getFlag(MOD, "relationsList") ?? []).find(r => r.targetId === actor.id);
        if (rel) out.push({ pj: pj.name, niveau: rel.level ?? 0, type: rel.type ?? "", note: rel.note ?? "" });
    }
    return out.sort((a, b) => a.pj.localeCompare(b.pj, "fr"));
}

// Blocs secrets actuellement révélés sur la page (à préserver à la réécriture).
function blocsReveles(html) {
    const out = new Set();
    try {
        const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
        doc.querySelectorAll('section.secret.revealed[id^="secret-scwm-"]').forEach(s => out.add(s.id.slice("secret-scwm-".length)));
    } catch {}
    return out;
}

// La page a-t-elle été modifiée directement (texte ≠ dernier texte généré) ?
export function texteModifie(page) {
    const contenu = page?.text?.content ?? "";
    if (!String(contenu).trim()) return false;
    const f = page?.getFlag?.(MOD, "fiche");
    return !f?.hash || f.hash !== empreinte(contenu);
}

// ============================================================
// Épingles (notes de carte) et cartes du monde
// ============================================================
// Cartes du monde = scènes déclarées dans « Carte des expéditions ».
export function cartesDuMonde() {
    try { return expeditionSceneIds().filter(id => game.scenes.get(id)); } catch { return []; }
}
const estCarteDuMonde = (sceneId) => cartesDuMonde().includes(sceneId);

// Toutes les épingles pointant vers cette entrée : [{ scene, note }].
export function epinglesDe(entry) {
    const out = [];
    if (!entry) return out;
    for (const scene of game.scenes) {
        for (const note of scene.notes ?? []) if (note.entryId === entry.id) out.push({ scene, note });
    }
    return out;
}
const epinglesMonde = (entry) => epinglesDe(entry).filter(p => estCarteDuMonde(p.scene.id));

// Case hexagonale d'un point, avec la grille de la scène (sans l'afficher).
function caseDe(scene, x, y) {
    try { const o = scene.grid.getOffset({ x, y }); return `${o.i}.${o.j}`; } catch { return null; }
}

export async function voirSurLaCarte(entry) {
    const p = epinglesMonde(entry)[0] ?? epinglesDe(entry)[0];
    if (!p) { ui.notifications?.warn(`« ${entry?.name} » n'a pas d'épingle sur une carte.`); return; }
    if (canvas?.scene?.id !== p.scene.id) await p.scene.view();
    try { await canvas.animatePan({ x: p.note.x, y: p.note.y, scale: Math.max(canvas.stage.scale.x, 1) }); } catch {}
    try { canvas.ping?.({ x: p.note.x, y: p.note.y }); } catch {}
}

// Attend un clic gauche sur la carte affichée : renvoie { x, y } (coordonnées
// de la scène) ou null (clic droit, Échap ou 2 minutes sans clic).
function attendreClicCarte() {
    return new Promise((resolve) => {
        const vue = canvas?.app?.view;
        if (!vue) { resolve(null); return; }
        let fini = false;
        const finir = (r) => {
            if (fini) return; fini = true;
            window.removeEventListener("pointerdown", surClic, true);
            window.removeEventListener("keydown", surTouche, true);
            window.removeEventListener("contextmenu", bloquer, true);
            clearTimeout(minuterie);
            document.body.classList.remove("scwm-pose-epingle");
            vue.style.cursor = "";
            resolve(r);
        };
        const bloquer = (ev) => { if (ev.target === vue) { ev.preventDefault(); ev.stopPropagation(); } };
        const surClic = (ev) => {
            if (ev.target !== vue) return;            // clic dans une fenêtre : ignoré
            ev.preventDefault(); ev.stopPropagation();
            if (ev.button !== 0) { finir(null); return; }
            let pt = null;
            try { pt = canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY }); } catch {}
            if (!pt) {
                const r = vue.getBoundingClientRect();
                pt = canvas.stage.worldTransform.applyInverse({ x: ev.clientX - r.left, y: ev.clientY - r.top });
            }
            finir({ x: pt.x, y: pt.y });
        };
        const surTouche = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finir(null); } };
        const minuterie = setTimeout(() => finir(null), 120000);
        window.addEventListener("pointerdown", surClic, true);
        window.addEventListener("keydown", surTouche, true);
        window.addEventListener("contextmenu", bloquer, true);
        vue.style.cursor = "crosshair";
    });
}

// Centre de la case (hex) d'un point, pour que l'épingle tombe pile sur la case cliquée.
function centreCase(scene, x, y) {
    try { const c = canvas.grid.getCenterPoint(scene.grid.getOffset({ x, y })); if (Number.isFinite(c?.x)) return c; } catch {}
    return { x, y };
}

// Icône des épingles de lieux : petite épingle fine plantée dans la carte,
// pointe au centre de l'image (donc pile sur le point de la note).
// Le nom du lieu s'affiche au survol (étiquette native de la note).
export const ICONE_EPINGLE = `modules/${MOD}/assets/epingle.svg`;
const TAILLE_EPINGLE = 32;   // minimum accepté par Foundry pour une note

// Notes de lieux sur la carte du monde → épingle fine, quelle que soit leur
// icône (livre, logo de Monk's…). Faite UNE fois pour les notes existantes
// (réglage caché mondeEpinglesMigrees), puis à la création de chaque note de
// lieu : une icône changée ensuite à la main par le MJ est respectée.
async function convertirIcones(entry) {
    for (const { scene, note } of epinglesDe(entry)) {
        if (!estCarteDuMonde(scene.id)) continue;
        if (note.texture?.src === ICONE_EPINGLE && note.iconSize === TAILLE_EPINGLE) continue;
        await scene.updateEmbeddedDocuments("Note", [{ _id: note.id, "texture.src": ICONE_EPINGLE, iconSize: TAILLE_EPINGLE }]);
    }
}
export async function migrerEpingles() {
    if (lire("mondeEpinglesMigrees", false) === true) return 0;
    let n = 0;
    for (const { entry, type } of toutesLesFiches()) if (type === "place") { await convertirIcones(entry); n++; }
    await game.settings.set(MOD, "mondeEpinglesMigrees", true);
    return n;
}

// Épingles visibles hors du mode « Notes de journal » sur la carte du monde.
// Foundry cache les notes quand leur calque n'est pas actif (sauf si l'option
// « Afficher les notes » est cochée) : on fait comme cette option, mais
// seulement sur la carte du monde. Les épingles restent survolables (nom au
// survol) ; elles sont assez petites pour ne pas gêner les jetons.
export function afficherEpinglesPartout() {
    try {
        const calque = canvas?.notes;
        if (!calque || !canvas.scene || calque.active) return;
        if (!mondeActif() || lire("mondeEpinglesPartout", true) !== true || !estCarteDuMonde(canvas.scene.id)) return;
        let toggle = false;
        try { toggle = game.settings.get("core", "notesDisplayToggle") === true; } catch {}
        if (toggle) return;   // déjà affichées (et cliquables) par Foundry
        if (calque.objects) calque.objects.visible = true;
        calque.interactiveChildren = true;
    } catch (e) { journal.avert(`[${MOD}] épingles`, e); }
}

// Foundry dessine chaque note sur un carré sombre (fond de la ControlIcon) :
// on le masque pour nos épingles, qui apparaissent seules sur la carte. Le
// cadre de survol reste visible en mode « Notes de journal » (pour éditer).
export function epingleSansFond(note) {
    try {
        const ci = note?.controlIcon;
        if (!ci || note?.document?.texture?.src !== ICONE_EPINGLE) return;
        if (ci.bg) { ci.bg.visible = false; ci.bg.alpha = 0; }
        if (ci.border && !note.layer?.active) ci.border.visible = false;
        // Taille affichée (réglage mondeTailleEpingle) : Foundry impose 32 px
        // minimum à une note, on met donc l'icône à l'échelle à l'affichage,
        // centrée sur le point de la note (là où tombe la pointe).
        const taille = tailleEpingle();
        const base = Number(note.document.iconSize) || TAILLE_EPINGLE;
        const k = taille / base;
        ci.scale?.set?.(k, k);
        ci.position?.set?.(-base * k / 2, -base * k / 2);
    } catch {}
}
export const TAILLE_MIN = 8, TAILLE_MAX = 512;
export function tailleEpingle() {
    const n = Number(lire("mondeTailleEpingle", TAILLE_EPINGLE));
    return Number.isFinite(n) ? Math.min(TAILLE_MAX, Math.max(TAILLE_MIN, Math.round(n))) : TAILLE_EPINGLE;
}
// Réapplique la taille / le fond à toutes les épingles affichées.
export function rafraichirEpingles() {
    try { for (const n of canvas?.notes?.placeables ?? []) epingleSansFond(n); } catch {}
}

export async function viderEtiquettes(entry, ancien) {
    for (const { scene, note } of epinglesDe(entry)) {
        const t = String(note.text ?? "");
        if (!t) continue;
        const fige = ancien !== undefined ? t === ancien : (t !== entry.name && /^Nouveau (lieu|pnj|organisation)$/i.test(t));
        if (fige) await scene.updateEmbeddedDocuments("Note", [{ _id: note.id, text: "" }]);
    }
}

// Pose une épingle sur une carte du monde : affiche la carte, puis le MJ
// clique à l'endroit du lieu (Échap / clic droit = annuler). L'étiquette de
// l'épingle n'est pas figée : elle suit le nom du journal.
export async function placerSurLaCarte(entry, sceneId) {
    const scene = game.scenes.get(sceneId ?? cartesDuMonde()[0]);
    if (!scene) { ui.notifications?.warn("Aucune carte du monde : déclare-la dans Paramètres → Carte des expéditions."); return false; }
    if (canvas?.scene?.id !== scene.id) await scene.view();
    ui.notifications?.info(`Clique sur la carte à l'emplacement de « ${entry.name} » (Échap ou clic droit pour annuler).`);
    const pt = await attendreClicCarte();
    if (!pt) { ui.notifications?.info("Pose de l'épingle annulée."); return false; }
    const { x, y } = centreCase(scene, pt.x, pt.y);
    _silencieux.add(entry.id);   // poser une épingle n'est pas une découverte par le groupe
    await scene.createEmbeddedDocuments("Note", [{ entryId: entry.id, x: Math.round(x), y: Math.round(y), texture: { src: ICONE_EPINGLE }, iconSize: TAILLE_EPINGLE }]);
    try { canvas.ping?.({ x, y }); } catch {}
    ui.notifications?.info(`Épingle de « ${entry.name} » posée.`);
    return true;
}

// ============================================================
// Découverte des lieux par le brouillard de la carte des expéditions
// ============================================================
export const decouverteActive = () => mondeActif() && lire("mondeDecouverte", true) === true;

// Mode de visibilité d'un lieu : "auto" (découverte), "cache", "tous".
// Sans choix enregistré : une fiche déjà ouverte aux joueurs reste « tous ».
export function modeVisibilite(entry) {
    const f = ficheDe(pageDe(entry));
    if (["auto", "cache", "tous"].includes(f.visibilite)) return f.visibilite;
    return (entry?.ownership?.default ?? 0) >= OBSERVER() ? "tous" : "auto";
}

// Joueurs (ids) dont un personnage a exploré la case d'une épingle du lieu,
// ou dont la case est une zone toujours éclairée (ville).
export function joueursAyantDecouvert(entry) {
    const out = new Set();
    const joueurs = game.users.filter(u => !u.isGM);
    let zones = {};
    try { zones = zonesMap(); } catch {}
    for (const { scene, note } of epinglesMonde(entry)) {
        const cle = caseDe(scene, note.x, note.y);
        if (!cle) continue;
        if ((zones[scene.id] ?? []).includes(cle)) { joueurs.forEach(u => out.add(u.id)); continue; }
        for (const u of joueurs) {
            if (out.has(u.id)) continue;
            const persos = game.actors.filter(a => a.type === "character" && a.testUserPermission(u, "OWNER"));
            if (persos.some(a => getExplored(a, scene.id).includes(cle))) out.add(u.id);
        }
    }
    return out;
}

// Applique la découverte à toutes les fiches de lieux. Seul le MJ actif écrit.
// Le module ne retire que les accès qu'il a lui-même donnés (decouvertPar).
// Lieux dont l'épingle vient d'être posée ou déplacée par le MJ : leur
// prochain calcul donne les accès sans bannière ni message (ce n'est pas le
// groupe qui a découvert le lieu, c'est le MJ qui l'a placé).
const _silencieux = new Set();
export const marquerSilencieux = (entryId) => { if (entryId) _silencieux.add(entryId); };

export async function appliquerDecouverte({ notifier = true } = {}) {
    if (!game.user?.isGM || !decouverteActive()) return 0;
    const actif = game.users.activeGM;
    if (actif && actif.id !== game.user.id) return 0;
    let n = 0;
    for (const { entry, page, type } of toutesLesFiches()) {
        if (type !== "place") continue;
        const mode = modeVisibilite(entry);
        if (mode === "tous") continue;
        const f = ficheDe(page);
        const premiereFois = !Array.isArray(f.decouvertPar);
        const silence = premiereFois || _silencieux.delete(entry.id);
        const geres = new Set(f.decouvertPar ?? []);
        const cible = mode === "auto" ? joueursAyantDecouvert(entry) : new Set();
        const update = {};
        const nouveaux = [];
        for (const uid of cible) {
            if (geres.has(uid)) continue;
            if ((entry.ownership?.[uid] ?? -1) >= OBSERVER()) continue;   // accès déjà donné à la main : pas géré ici
            update[`ownership.${uid}`] = OBSERVER();
            nouveaux.push(uid);
            geres.add(uid);
        }
        for (const uid of [...geres]) {
            if (cible.has(uid)) continue;
            update[`ownership.-=${uid}`] = null;
            geres.delete(uid);
        }
        const liste = [...geres];
        if (!Object.keys(update).length && !premiereFois) continue;
        if (Object.keys(update).length) await entry.update(update);
        // Joueurs déjà prévenus une fois : pas de second message pour ce lieu.
        const prevenus = new Set(f.prevenus ?? (premiereFois ? liste : []));
        const aPrevenir = nouveaux.filter(uid => !prevenus.has(uid));
        aPrevenir.forEach(uid => prevenus.add(uid));
        await page.update({ [`flags.${MOD}.fiche.decouvertPar`]: liste, [`flags.${MOD}.fiche.prevenus`]: [...prevenus] });
        n++;
        if (notifier && !silence && aPrevenir.length && lire("mondeBanniere", true)) {
            const son = String(lire("mondeBanniereSon", "") || "");
            for (const uid of aPrevenir) {
                const u = game.users.get(uid);
                if (!u?.active) continue;   // joueur hors ligne : pas de bannière (le message reste dans le chat)
                u.query("westmarch.lieuDecouvert", { nom: entry.name, son }, { timeout: 10000 }).catch(() => {});
            }
        }
        if (notifier && !silence && aPrevenir.length && lire("mondeDecouverteMessage", true)) {
            try {
                await ChatMessage.create({
                    whisper: aPrevenir, speaker: { alias: "Carte du monde" },
                    content: `<i class="fa-solid fa-location-dot"></i> Nouveau lieu découvert : @UUID[${entry.uuid}]{${esc(entry.name)}}`
                });
            } catch {}
        }
    }
    return n;
}

let _minuterieDecouverte = null;
export function planifierDecouverte() {
    if (!game.user?.isGM) return;
    clearTimeout(_minuterieDecouverte);
    _minuterieDecouverte = setTimeout(() => appliquerDecouverte().catch(e => journal.avert(`[${MOD}] découverte`, e)), 1500);
}

// ============================================================
// Bannière « Nouveau lieu découvert » (affichée chez le joueur)
// ============================================================
const CSS_BANNIERE = `
.scwm-decouverte { position: fixed; left: 0; right: 0; top: 20%; z-index: 10000; pointer-events: none;
    text-align: center; opacity: 0; transform: scale(.97); transition: opacity 1.2s ease, transform 4.5s ease-out; }
.scwm-decouverte.visible { opacity: 1; transform: scale(1); }
.scwm-decouverte-sur { font-family: "Signika", sans-serif; font-size: 20px; letter-spacing: .4em; text-transform: uppercase;
    color: #ecd89a; text-shadow: 0 0 4px #000, 0 0 12px #000, 0 0 24px rgba(0,0,0,.8); }
.scwm-decouverte-nom { font-family: "Enchanted Land", "Modesto Condensed", serif; font-size: clamp(64px, 9vw, 128px); line-height: 1.05;
    margin-top: .05em; padding: 0 .3em;
    background: linear-gradient(180deg, #fff6cf 0%, #f0cd5a 40%, #c8961f 75%, #8f6412 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 2px 2px rgba(0,0,0,.95)) drop-shadow(0 0 14px rgba(0,0,0,.75)); }`;

const _fileBannieres = [];
let _bannierEnCours = false;

// Affiche (à la suite, si plusieurs) le nom d'un lieu découvert, sans fond.
export function afficherBanniere(nom, son = "") {
    _fileBannieres.push({ nom: String(nom ?? ""), son: String(son ?? "") });
    if (!_bannierEnCours) _suivante();
}
function _suivante() {
    const b = _fileBannieres.shift();
    if (!b) { _bannierEnCours = false; return; }
    _bannierEnCours = true;
    if (!document.getElementById("scwm-decouverte-css")) {
        const st = document.createElement("style");
        st.id = "scwm-decouverte-css";
        st.textContent = CSS_BANNIERE;
        document.head.appendChild(st);
    }
    const el = document.createElement("div");
    el.className = "scwm-decouverte";
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `<div class="scwm-decouverte-sur">Nouveau lieu découvert</div><div class="scwm-decouverte-nom">${esc(b.nom)}</div>`;
    document.body.appendChild(el);
    if (b.son) {
        try {
            const AH = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
            let vol = 0.8;
            try { vol = game.settings.get("core", "globalInterfaceVolume") ?? 0.8; } catch {}
            AH?.play?.({ src: b.son, volume: vol, autoplay: true, loop: false }, false);
        } catch (e) { journal.avert(`[${MOD}] son de la bannière`, e); }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("visible")));
    setTimeout(() => el.classList.remove("visible"), 1200 + 2800);          // apparition + affichage
    setTimeout(() => { el.remove(); _suivante(); }, 1200 + 2800 + 1300);    // fondu de sortie
}

// À enregistrer sur tous les clients : le MJ actif cible chaque joueur concerné.
export function enregistrerQueryBanniere() {
    try { CONFIG.queries["westmarch.lieuDecouvert"] = async ({ nom, son }) => { afficherBanniere(nom, son); return true; }; }
    catch (e) { journal.avert(`[${MOD}] query bannière`, e); }
}

// ============================================================
// Écriture
// ============================================================
async function dossier(type) {
    if (!TYPES[type]?.dossierKey) return null;
    const nom = String(lire(TYPES[type].dossierKey, TYPES[type].dossier) || "").trim();
    if (!nom) return null;
    const existant = game.folders.find(f => f.type === "JournalEntry" && f.name === nom && !f.folder);
    if (existant) return existant;
    return Folder.create({ name: nom, type: "JournalEntry" });
}

// Dossier (par son nom) DANS le compendium d'un type, créé au besoin. null = racine.
export async function dossierDansPack(type, pack) {
    const cle = TYPES[type]?.packFolderKey;
    const nom = cle ? String(lire(cle, "") || "").trim() : "";
    if (!nom || !pack) return null;
    const existant = [...(pack.folders ?? [])].find(f => f.name === nom && !f.folder);
    if (existant) return existant;
    return Folder.create({ name: nom, type: "JournalEntry" }, { pack: pack.collection });
}

// Dossier des lieux : créé dès que le registre est actif, et les fiches de
// lieux restées à la racine des journaux y sont rangées.
export async function preparerDossierLieux() {
    if (!game.user?.isGM || !mondeActif()) return null;
    const f = await dossier("place");
    if (!f) return null;
    const aRanger = toutesLesFiches().filter(x => x.type === "place" && !x.entry.folder && !x.entry.pack);
    for (const { entry } of aRanger) await entry.update({ folder: f.id });
    if (aRanger.length) ui.notifications?.info(`${aRanger.length} fiche(s) de lieu rangée(s) dans le dossier « ${f.name} ».`);
    return f;
}

// Crée une fiche MEJ comme MEJ le fait lui-même : une entrée, une page texte
// portant le type MEJ dans ses flags. Réservée aux MJ (ownership par défaut : aucun).
export async function creerFiche(type, { name, img, actor, scene } = {}) {
    if (!TYPES[type]) throw new Error(`type inconnu : ${type}`);
    const pack = TYPES[type].packKey ? await packPour(type) : null;
    verifierDeverrouille(pack);
    const folder = pack ? await dossierDansPack(type, pack) : await dossier(type);
    const flagsMej = { type, relationships: {} };
    if (type === "person") flagsMej.attributes = {};
    if (actor) flagsMej.actor = { id: actor.id, uuid: actor.uuid, img: actor.img, name: actor.name };
    const nom = name || actor?.name || scene?.name || `Nouveau ${TYPES[type].label.toLowerCase()}`;
    const fiche = { rubriques: {}, historique: [], scenes: scene ? [scene.id] : [] };
    const entry = await JournalEntry.create({
        name: nom,
        folder: folder?.id ?? null,
        ownership: { default: NONE() },
        flags: { [MEJ]: { img: `modules/${MEJ}/assets/${type}.png` } },
        pages: [{
            name: nom, type: "text",
            src: img || actor?.img || scene?.thumb || undefined,
            text: { content: "" },
            flags: { [MEJ]: flagsMej, [MOD]: { fiche } }
        }]
    }, { renderSheet: false, ...(pack ? { pack: pack.collection } : {}) });
    if (actor) await actor.setFlag(MOD, "fichePage", entry.uuid);
    if (scene) await scene.setFlag(MOD, "fichePage", entry.uuid);
    return entry;
}

// Relation MEJ dans les deux sens (format natif : clé = id de l'entrée).
export async function lierMej(a, b) {
    if (!a || !b || a.id === b.id) return;
    for (const [x, y] of [[a, b], [b, a]]) {
        const page = pageDe(x);
        if (!page) continue;
        const rel = page.getFlag(MEJ, "relationships");
        if (Array.isArray(rel)) continue;   // ancien format : MEJ le convertira lui-même
        if (rel?.[y.id]) continue;
        await page.setFlag(MEJ, `relationships.${y.id}`, { id: y.id, uuid: y.uuid, hidden: false, relationship: "" });
    }
}

// PNJ présents (jetons) sur les cartes d'un lieu → relations MEJ lieu ↔ PNJ.
async function lierPnjDesCartes(entry, sceneIds) {
    for (const id of sceneIds ?? []) {
        const scene = game.scenes.get(id);
        if (!scene) continue;
        const vus = new Set();
        for (const t of scene.tokens) {
            const a = t.actor;
            if (!a || a.hasPlayerOwner || vus.has(a.id)) continue;
            vus.add(a.id);
            const fp = await ficheDeActeur(game.actors.get(a.id) ?? a);
            if (fp) await lierMej(entry, fp);
        }
    }
}

// Réécrit le texte de la page à partir des données (fiche). force = écraser
// même si la page a été modifiée à la main (choix explicite dans « Rédiger »).
export async function ecrireFiche(entry, fiche, { force = false } = {}) {
    if (entry?.pack) verifierDeverrouille(game.packs.get(entry.pack));
    const page = pageDe(entry);
    const type = typeDe(entry);
    if (!page || !type) return false;
    const update = {};
    const modifie = texteModifie(page);
    fiche.maj = new Date().toISOString();
    fiche.majPar = game.user.name;
    if (!modifie || force) {
        const actor = type === "person" ? acteurDe(page) : null;
        const html = genererContenu(type, fiche, rubriques(), {
            relationsPJ: actor ? relationsVers(actor) : [],
            scenes: (fiche.scenes ?? []).map(id => game.scenes.get(id)).filter(Boolean).map(s => ({ id: s.id, name: s.name })),
            revelees: blocsReveles(page.text?.content)
        });
        update["text.content"] = html;
        fiche.hash = empreinte(html);
    }
    // Champs courts natifs de MEJ (en-tête de la fiche et liste des relations).
    if (type === "person") {
        const r = fiche.rubriques ?? {};
        if (r.role !== undefined) update[`flags.${MEJ}.role`] = premiereLigne(r.role);
        if (r.ou !== undefined) update[`flags.${MEJ}.location`] = premiereLigne(r.ou);
    }
    update[`flags.${MOD}.fiche`] = fiche;
    await page.update(update);
    return !modifie || force;
}

// Recalcule le texte (relations PJ, cartes) sans rien changer d'autre.
export async function actualiserFiche(entry) {
    return ecrireFiche(entry, ficheDe(pageDe(entry)));
}

// Ouvre la fiche dans MEJ (ou la fenêtre de journal standard).
export async function ouvrirFiche(entry) {
    if (!entry) return;
    try { if (await game.MonksEnhancedJournal?.openJournalEntry?.(entry)) return; } catch {}
    entry.sheet?.render(true);
}

export async function basculerVisibilite(entry) {
    if (entry?.pack) {
        ui.notifications?.info(`« ${entry.name} » est rangée en compendium : réservée aux MJ (les joueurs ne voient pas ce compendium).`);
        return false;
    }
    if (typeDe(entry) === "place" && decouverteActive()) {
        const suivant = { auto: "tous", tous: "cache", cache: "auto" }[modeVisibilite(entry)];
        await definirModeLieu(entry, suivant);
        ui.notifications?.info(`« ${entry.name} » : ${LIBELLE_MODE[suivant]}.`);
        return suivant;
    }
    const visible = (entry.ownership?.default ?? 0) >= OBSERVER();
    await entry.update({ "ownership.default": visible ? NONE() : OBSERVER() });
    ui.notifications?.info(visible ? `« ${entry.name} » : réservée aux MJ.` : `« ${entry.name} » : visible par les joueurs (les secrets restent cachés).`);
    return !visible;
}

const LIBELLE_MODE = {
    auto: "découvert par le brouillard (auto)",
    cache: "toujours caché aux joueurs",
    tous: "visible par tous les joueurs"
};
async function definirModeLieu(entry, mode) {
    const page = pageDe(entry);
    await page.setFlag(MOD, "fiche.visibilite", mode);
    const def = entry.ownership?.default ?? 0;
    if (mode === "tous" && def < OBSERVER()) await entry.update({ "ownership.default": OBSERVER() });
    if (mode !== "tous" && def >= OBSERVER()) await entry.update({ "ownership.default": NONE() });
    await appliquerDecouverte();
}

// ============================================================
// Fenêtre « Rédiger la fiche »
// ============================================================
function optionsFiches(type, selId, sauf) {
    const liste = toutesLesFiches().filter(f => f.type === type && f.entry.id !== sauf)
        .sort((a, b) => a.entry.name.localeCompare(b.entry.name, "fr"));
    return [`<option value="">— aucun —</option>`,
        ...liste.map(f => `<option value="${f.entry.id}" ${f.entry.id === selId ? "selected" : ""}>${esc(f.entry.name)}</option>`)].join("");
}

export async function redigerFiche(entry) {
    if (!game.user.isGM) return;
    const type = typeDe(entry);
    const page = pageDe(entry);
    if (!type || !page) { ui.notifications?.warn("Ce journal n'est pas une fiche PNJ, lieu ou organisation de Monk's Enhanced Journal."); return; }

    const fiche = ficheDe(page);
    fiche.rubriques ??= {};
    // Pré-remplissage depuis les champs natifs de MEJ s'ils existent déjà.
    if (type === "person") {
        if (!fiche.rubriques.role && page.getFlag(MEJ, "role")) fiche.rubriques.role = page.getFlag(MEJ, "role");
        if (!fiche.rubriques.ou && page.getFlag(MEJ, "location")) fiche.rubriques.ou = page.getFlag(MEJ, "location");
    }
    const rubs = rubriques()[type];
    const modifie = texteModifie(page);
    const jamaisRedigee = !fiche.hash;
    const uid = `scwm-monde-${foundry.utils.randomID()}`;
    const visible = (entry.ownership?.default ?? 0) >= OBSERVER();
    const actor = type === "person" ? acteurDe(page) : null;
    const lieuActuel = type === "person"
        ? Object.keys(page.getFlag(MEJ, "relationships") ?? {}).find(id => typeDe(game.journal.get(id)) === "place") ?? ""
        : "";

    const champs = rubs.map(r => `
        <label style="display:block;margin:6px 0 2px;font-weight:600;">${esc(r.label)}
            ${r.secret ? `<span style="font-weight:400;font-size:.8em;color:#e0a96d;"><i class="fa-solid fa-lock"></i> secret MJ</span>` : ""}</label>
        <textarea class="scwm-monde-rub" data-id="${esc(r.id)}" rows="2"
            style="width:100%;box-sizing:border-box;resize:vertical;">${esc(fiche.rubriques[r.id] ?? "")}</textarea>`).join("");

    let liens = "";
    if (type === "person") {
        liens = `
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
            <span style="flex:0 0 120px;font-weight:600;">Acteur lié</span>
            <div class="scwm-monde-acteur" style="flex:1;padding:4px 8px;border:1px dashed rgba(201,162,39,.5);border-radius:4px;min-height:22px;">
                ${actor ? `<i class="fa-solid fa-user"></i> ${esc(actor.name)}` : `<span style="opacity:.6;">Glisse un acteur ici</span>`}</div>
            <input type="hidden" class="scwm-monde-acteur-id" value="${actor?.id ?? ""}">
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
            <span style="flex:0 0 120px;font-weight:600;">Lieu principal</span>
            <select class="scwm-monde-lieu" style="flex:1;">${optionsFiches("place", lieuActuel)}</select>
        </div>`;
    } else if (type === "place") {
        const sc = new Set(fiche.scenes ?? []);
        const opts = game.scenes.contents.filter(s => !estCarteDuMonde(s.id)).sort((a, b) => a.name.localeCompare(b.name, "fr"))
            .map(s => `<option value="${s.id}" ${sc.has(s.id) ? "selected" : ""}>${esc(s.name)}</option>`).join("");
        const pins = epinglesMonde(entry);
        const mondes = cartesDuMonde().map(id => game.scenes.get(id));
        const etatEpingle = pins.length
            ? `<i class="fa-solid fa-location-dot" style="color:#7fd1a0;"></i> ${pins.map(p => esc(p.scene.name)).join(", ")}
               <button type="button" class="scwm-monde-voir" style="margin-left:6px;padding:1px 8px;">Voir</button>`
            : mondes.length
                ? `<span style="opacity:.7;">Pas d'épingle sur la carte du monde.</span>
                   ${mondes.length > 1 ? `<select class="scwm-monde-carte" style="width:auto;">${mondes.map(sc => `<option value="${sc.id}">${esc(sc.name)}</option>`).join("")}</select>` : ""}
                   <button type="button" class="scwm-monde-placer" style="margin-left:6px;padding:1px 8px;">Placer sur la carte</button>`
                : `<span style="opacity:.7;">Aucune carte du monde déclarée (Paramètres → Carte des expéditions).</span>`;
        liens = `
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
            <span style="flex:0 0 120px;font-weight:600;">Épingle</span>
            <div style="flex:1;">${etatEpingle}</div>
        </div>
        <div style="margin-top:6px;">
            <span style="font-weight:600;">Cartes locales de ce lieu</span>
            <span style="font-size:.8em;opacity:.7;"> (intérieurs, donjons… Ctrl + clic pour plusieurs) — les PNJ posés dessus sont reliés au lieu</span>
            <select class="scwm-monde-scenes" multiple size="5" style="width:100%;margin-top:3px;">${opts}</select>
        </div>`;
    }

    const alerte = modifie ? `
        <div style="margin:0 0 8px;padding:6px 8px;border:1px solid rgba(230,126,34,.6);border-radius:4px;background:rgba(230,126,34,.1);font-size:.88em;">
            <i class="fa-solid fa-triangle-exclamation"></i>
            ${jamaisRedigee ? "Cette page contient déjà un texte écrit dans Monk's." : "Le texte de cette page a été modifié directement dans Monk's depuis la dernière rédaction."}
            Enregistrer ici réécrit le texte à partir des rubriques.
            <label style="display:flex;gap:6px;align-items:center;margin-top:4px;cursor:pointer;">
                <input type="checkbox" class="scwm-monde-garder" ${jamaisRedigee ? "checked" : ""}>
                Conserver le texte actuel dans la rubrique « Notes »</label>
        </div>` : "";

    const content = `
    <div id="${uid}" style="max-height:70vh;overflow-y:auto;padding-right:4px;">
        ${alerte}
        <div style="display:flex;gap:8px;align-items:center;">
            <span style="flex:0 0 120px;font-weight:600;"><i class="fa-solid ${TYPES[type].icon}"></i> ${TYPES[type].label}</span>
            <input type="text" class="scwm-monde-nom" value="${esc(entry.name)}" style="flex:1;">
        </div>
        ${liens}
        ${type === "place" && decouverteActive() ? `
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;">
            <span style="flex:0 0 120px;font-weight:600;">Joueurs</span>
            <select class="scwm-monde-mode" style="flex:1;">
                ${["auto", "cache", "tous"].map(k => `<option value="${k}" ${modeVisibilite(entry) === k ? "selected" : ""}>${LIBELLE_MODE[k].replace(/^./, c => c.toUpperCase())}</option>`).join("")}
            </select>
        </div>
        <p style="margin:2px 0 0 128px;font-size:.8em;opacity:.7;">Auto : visible pour un joueur dès qu'un de ses personnages a exploré la case de l'épingle (${joueursAyantDecouvert(entry).size} joueur(s) actuellement). Les rubriques « secret MJ » restent toujours cachées.</p>` : `
        ${entry.pack ? `<p style="margin:10px 0 0;font-size:.85em;opacity:.8;"><i class="fa-solid fa-box-archive"></i> Fiche rangée dans le compendium « ${esc(game.packs.get(entry.pack)?.title ?? entry.pack)} » : réservée aux MJ.</p>` : `
        <label style="display:flex;gap:6px;align-items:center;margin-top:10px;cursor:pointer;">
            <input type="checkbox" class="scwm-monde-visible" ${visible ? "checked" : ""}>
            Visible par les joueurs <span style="font-size:.8em;opacity:.7;">(les rubriques « secret MJ » restent toujours cachées)</span></label>`}`}
        <p style="margin:8px 0 0;font-size:.8em;opacity:.7;">Phrases courtes. Ligne vide = nouveau paragraphe ; « - » en début de ligne = liste. Glisse un acteur, un journal ou une scène dans une rubrique pour y insérer un lien.</p>
        ${champs}
    </div>`;

    const enregistrer = async (ouvrir) => {
        const root = document.getElementById(uid);
        if (!root) return;
        const f = ficheDe(page);
        f.rubriques = {};
        root.querySelectorAll(".scwm-monde-rub").forEach(t => { f.rubriques[t.dataset.id] = t.value; });
        if (root.querySelector(".scwm-monde-garder")?.checked) {
            const actuel = page.text?.content ?? "";
            f.texteLibre = [f.texteLibre, actuel].filter(x => String(x ?? "").trim()).join("\n");
        }
        if (type === "place") f.scenes = [...(root.querySelector(".scwm-monde-scenes")?.selectedOptions ?? [])].map(o => o.value);

        const nom = root.querySelector(".scwm-monde-nom")?.value.trim();
        if (nom && nom !== entry.name) { await entry.update({ name: nom }); await page.update({ name: nom }); }

        if (type === "person") {
            const actorId = root.querySelector(".scwm-monde-acteur-id")?.value;
            const a = actorId ? game.actors.get(actorId) : null;
            if (a && a.id !== actor?.id) {
                await page.setFlag(MEJ, "actor", { id: a.id, uuid: a.uuid, img: a.img, name: a.name });
                await a.setFlag(MOD, "fichePage", entry.uuid);
            }
            const lieuId = root.querySelector(".scwm-monde-lieu")?.value;
            if (lieuId) await lierMej(entry, game.journal.get(lieuId));
        }
        if (type === "place") {
            for (const id of f.scenes) await game.scenes.get(id)?.setFlag(MOD, "fichePage", entry.uuid);
            await lierPnjDesCartes(entry, f.scenes);
        }
        await ecrireFiche(entry, f, { force: true });

        const modeSel = root.querySelector(".scwm-monde-mode");
        if (modeSel) {
            if (modeSel.value !== ficheDe(page).visibilite) await definirModeLieu(entry, modeSel.value);
        } else {
            const vis = !!root.querySelector(".scwm-monde-visible")?.checked;
            if (vis !== visible) await entry.update({ "ownership.default": vis ? OBSERVER() : NONE() });
        }
        ui.notifications?.info(`Fiche « ${entry.name} » enregistrée.`);
        if (ouvrir) ouvrirFiche(entry);
    };

    let dialogue = null;
    const cabler = (_ev, dlg) => {
        const root = document.getElementById(uid);
        if (!root) return;
        dialogue = dlg ?? null;
        // Si Foundry / Monk's ouvre le journal juste créé, la fenêtre de
        // rédaction repasse devant.
        for (const ms of [150, 600, 1200]) setTimeout(() => { try { dialogue?.bringToFront?.(); } catch {} }, ms);
        const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
        const donnees = (ev) => { try { return TE.getDragEventData(ev); } catch { return null; } };
        // Glisser un document dans une rubrique → lien @UUID.
        root.querySelectorAll(".scwm-monde-rub").forEach(t => {
            t.addEventListener("dragover", ev => ev.preventDefault());
            t.addEventListener("drop", async ev => {
                const d = donnees(ev);
                if (!d?.uuid) return;
                ev.preventDefault();
                const doc = await fromUuid(d.uuid);
                const lien = `@UUID[${d.uuid}]{${doc?.name ?? "lien"}}`;
                const pos = t.selectionStart ?? t.value.length;
                t.value = t.value.slice(0, pos) + lien + t.value.slice(pos);
            });
        });
        // Épingle : voir / placer sur la carte du monde.
        root.querySelector(".scwm-monde-voir")?.addEventListener("click", (e) => { e.preventDefault(); voirSurLaCarte(entry); });
        root.querySelector(".scwm-monde-placer")?.addEventListener("click", async (e) => {
            e.preventDefault();
            const bouton = e.currentTarget;
            // Le nom tapé est appliqué tout de suite (l'épingle affiche le nom du journal).
            const nom = root.querySelector(".scwm-monde-nom")?.value.trim();
            if (nom && nom !== entry.name) { await entry.update({ name: nom }); await page.update({ name: nom }); }
            // La fenêtre se réduit le temps de cliquer sur la carte.
            try { await dialogue?.minimize?.(); } catch {}
            let pose = false;
            try { pose = await placerSurLaCarte(entry, root.querySelector(".scwm-monde-carte")?.value); }
            finally { try { await dialogue?.maximize?.(); dialogue?.bringToFront?.(); } catch {} }
            if (pose && bouton?.isConnected) bouton.outerHTML = `<span style="color:#7fd1a0;">Épingle posée.</span>`;
        });
        // Glisser un acteur sur la zone « Acteur lié ».
        const zone = root.querySelector(".scwm-monde-acteur");
        zone?.addEventListener("dragover", ev => ev.preventDefault());
        zone?.addEventListener("drop", async ev => {
            const d = donnees(ev);
            if (d?.type !== "Actor" || !d.uuid) return;
            ev.preventDefault();
            const a = await fromUuid(d.uuid);
            if (!a || a.pack) { ui.notifications?.warn("Glisse un acteur du monde (pas d'un compendium)."); return; }
            root.querySelector(".scwm-monde-acteur-id").value = a.id;
            zone.innerHTML = `<i class="fa-solid fa-user"></i> ${esc(a.name)}`;
        });
    };

    await foundry.applications.api.DialogV2.wait({
        window: { title: `Rédiger la fiche — ${entry.name}`, icon: `fa-solid ${TYPES[type].icon}` },
        position: { width: 560 },
        rejectClose: false,
        content,
        render: (ev, dlg) => cabler(ev, dlg),
        buttons: [
            { action: "save", label: "Enregistrer", icon: "fa-solid fa-save", default: true, callback: () => enregistrer(false) },
            { action: "open", label: "Enregistrer et ouvrir", icon: "fa-solid fa-book-open", callback: () => enregistrer(true) },
            { action: "cancel", label: "Annuler", icon: "fa-solid fa-xmark" }
        ]
    });
}

// Ouvre (ou crée) la fiche d'un acteur / d'une scène, puis « Rédiger ».
export async function ficheActeur(actor) {
    let entry = await ficheDeActeur(actor);
    if (!entry) entry = await creerFiche("person", { actor });
    if (entry) await redigerFiche(entry);
}
export async function ficheScene(scene) {
    let entry = ficheDeScene(scene);
    if (!entry) entry = await creerFiche("place", { scene });
    if (entry) await redigerFiche(entry);
}
export async function nouvelleFiche(type) {
    const entry = await creerFiche(type, {});
    if (entry) await redigerFiche(entry);
    return entry;
}

// ============================================================
// Onglet « Monde » du Casier
// ============================================================
function derniereSessionDe(gmId) {
    const log = lire("sessionLog", []);
    const dates = (Array.isArray(log) ? log : []).filter(s => s.gmId === gmId).map(s => s.dateISO).filter(Boolean).sort();
    return dates.at(-1) ?? null;
}
const modifieLe = (f) => Math.max(f.page?._stats?.modifiedTime ?? 0, f.entry?._stats?.modifiedTime ?? 0);
const nomUtilisateur = (id) => game.users.get(id)?.name ?? "";

function iconeVisibilite(f, visible) {
    if (f.entry.pack) return `<i class="fa-solid fa-box-archive" style="opacity:.6;" title="Rangée dans le compendium « ${esc(game.packs.get(f.entry.pack)?.title ?? f.entry.pack)} » : réservée aux MJ"></i>`;
    if (f.type === "place" && decouverteActive()) {
        const mode = modeVisibilite(f.entry);
        const nb = mode === "auto" ? (ficheDe(f.page).decouvertPar ?? []).length : 0;
        const ic = { auto: ["fa-binoculars", "color:#c9a227;"], tous: ["fa-eye", "color:#7fd1a0;"], cache: ["fa-eye-slash", "opacity:.6;"] }[mode];
        return `<a class="scwm-monde-visible" data-uuid="${f.entry.uuid}" title="Joueurs : ${LIBELLE_MODE[mode]}${mode === "auto" ? ` — découvert par ${nb} joueur(s)` : ""}. Cliquer pour changer.">
            <i class="fa-solid ${ic[0]}" style="${ic[1]}"></i>${mode === "auto" && nb ? `<sup>${nb}</sup>` : ""}</a>`;
    }
    return `<a class="scwm-monde-visible" data-uuid="${f.entry.uuid}" title="${visible ? "Visible par les joueurs — cliquer pour réserver aux MJ" : "Réservée aux MJ — cliquer pour révéler aux joueurs"}">
        <i class="fa-solid ${visible ? "fa-eye" : "fa-eye-slash"}" style="${visible ? "color:#7fd1a0;" : "opacity:.6;"}"></i></a>`;
}

// Coquille affichée tout de suite ; le contenu (qui charge les compendiums)
// est rempli par cablerOngletMonde.
export function ongletMondeHtml() {
    return `<div class="scwm-monde-hote"><div class="scwm-casier-detail"><h2><i class="fa-solid fa-book-atlas"></i> Monde — PNJ, lieux, organisations</h2>
        <p style="opacity:.7;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des fiches…</p></div></div>`;
}

async function contenuMondeHtml(etat = {}) {
    if (!mejActif()) return `<div class="scwm-casier-detail"><h2><i class="fa-solid fa-book-atlas"></i> Monde</h2>
        <p>Monk's Enhanced Journal n'est pas actif : le registre du monde s'appuie sur ses fiches.</p></div>`;
    const derniere = derniereSessionDe(game.user.id);
    const depuis = derniere ? Date.parse(derniere) : 0;
    const fiches = (await chargerFiches()).sort((a, b) => a.entry.name.localeCompare(b.entry.name, "fr"));
    const aRanger = fiches.filter(f => f.type !== "place" && !f.entry.pack).length;
    const rubs = rubriques();
    const lignes = fiches.map(f => {
        const fiche = ficheDe(f.page);
        const t = TYPES[f.type];
        const premier = rubs[f.type]?.[0];
        const resume = premier ? premiereLigne(fiche.rubriques?.[premier.id]) : "";
        const mod = modifieLe(f);
        const par = nomUtilisateur(f.page?._stats?.lastModifiedBy ?? f.entry?._stats?.lastModifiedBy);
        const recent = depuis && mod > depuis;
        const visible = (f.entry.ownership?.default ?? 0) >= OBSERVER();
        const avert = texteModifie(f.page) ? ` <i class="fa-solid fa-pen-to-square" title="Texte modifié directement dans Monk's : ouvre « Rédiger » pour le reprendre"></i>` : "";
        let lien = "";
        if (f.type === "person") { const a = acteurDe(f.page); if (a) lien = `<a class="scwm-monde-acteur-ouvrir" data-actor="${a.id}" title="Ouvrir l'acteur"><i class="fa-solid fa-user"></i></a>`; }
        if (f.type === "place") {
            const pins = epinglesMonde(f.entry).length || epinglesDe(f.entry).length;
            if (pins) lien = `<a class="scwm-monde-epingle" data-uuid="${f.entry.uuid}" title="Voir sur la carte"><i class="fa-solid fa-location-dot"></i></a>`;
            if ((fiche.scenes ?? []).length) lien += ` <a class="scwm-monde-scene-ouvrir" data-scene="${fiche.scenes[0]}" title="Ouvrir la carte locale"><i class="fa-solid fa-map"></i></a>`;
            if (!pins) lien = `<i class="fa-solid fa-location-dot" style="opacity:.25;" title="Pas d'épingle sur une carte"></i> ` + lien;
        }
        return `<tr class="scwm-monde-ligne" data-type="${f.type}" data-recent="${recent ? 1 : 0}"
                    data-texte="${esc((f.entry.name + " " + Object.values(fiche.rubriques ?? {}).join(" ")).toLowerCase())}">
            <td title="${t.label}"><i class="fa-solid ${t.icon}"></i></td>
            <td><a class="scwm-monde-ouvrir" data-uuid="${f.entry.uuid}"><strong>${esc(f.entry.name)}</strong></a>${avert}
                ${resume ? `<div style="font-size:.85em;opacity:.75;">${esc(resume)}</div>` : ""}</td>
            <td style="white-space:nowrap;font-size:.85em;">${mod ? new Date(mod).toLocaleDateString("fr-FR") : ""}${par ? `<br><span style="opacity:.7;">${esc(par)}</span>` : ""}${recent ? ` <i class="fa-solid fa-circle" style="color:#e67e22;font-size:.6em;" title="Modifiée depuis ta dernière session"></i>` : ""}</td>
            <td style="white-space:nowrap;text-align:right;">
                ${lien}
                <a class="scwm-monde-rediger" data-uuid="${f.entry.uuid}" title="Rédiger la fiche"><i class="fa-solid fa-pen"></i></a>
                ${iconeVisibilite(f, visible)}
            </td>
        </tr>`;
    }).join("");
    const filtre = etat.type ?? "";
    const btnType = (k, lbl) => `<button type="button" class="scwm-monde-filtre-type ${filtre === k ? "active" : ""}" data-type="${k}"
        style="${filtre === k ? "border-color:#c9a227;color:#c9a227;font-weight:700;" : ""}">${lbl}</button>`;
    const compte = (k) => fiches.filter(f => f.type === k).length;
    return `
    <div class="scwm-casier-detail scwm-monde">
        <h2><i class="fa-solid fa-book-atlas"></i> Monde — PNJ, lieux, organisations</h2>
        <div class="scwm-reg-toolbar" style="flex-wrap:wrap;gap:6px;">
            <button type="button" class="scwm-monde-nouveau" data-type="person"><i class="fa-solid fa-plus"></i> PNJ</button>
            <button type="button" class="scwm-monde-nouveau" data-type="place"><i class="fa-solid fa-plus"></i> Lieu</button>
            <button type="button" class="scwm-monde-nouveau" data-type="organization"><i class="fa-solid fa-plus"></i> Organisation</button>
            <span style="flex:1 1 auto;"></span>
            <button type="button" class="scwm-monde-actualiser" title="Recalcule les relations PJ et les cartes de toutes les fiches"><i class="fa-solid fa-rotate"></i> Actualiser</button>
        </div>
        ${aRanger ? `<div style="margin:4px 0 8px;padding:6px 8px;border:1px solid rgba(201,162,39,.45);border-radius:4px;background:rgba(201,162,39,.08);font-size:.9em;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span style="flex:1 1 250px;"><i class="fa-solid fa-box-archive"></i> ${aRanger} fiche(s) PNJ / organisation encore dans le monde. Les ranger dans les compendiums allège la connexion.</span>
            <button type="button" class="scwm-monde-ranger"><i class="fa-solid fa-box-archive"></i> Ranger dans les compendiums</button>
        </div>` : ""}
        <div class="scwm-reg-toolbar" style="flex-wrap:wrap;gap:6px;">
            <input type="text" class="scwm-monde-recherche" placeholder="Rechercher (nom ou contenu)…" style="flex:1 1 200px;">
            ${btnType("", `Tous (${fiches.length})`)}${btnType("person", `PNJ (${compte("person")})`)}${btnType("place", `Lieux (${compte("place")})`)}${btnType("organization", `Organisations (${compte("organization")})`)}
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;" title="${derniere ? `Ta dernière session : ${new Date(derniere).toLocaleDateString("fr-FR")}` : "Aucune session enregistrée pour toi"}">
                <input type="checkbox" class="scwm-monde-recent" ${derniere ? "" : "disabled"}> Modifiées depuis ma dernière session</label>
        </div>
        <table class="scwm-reg-table">
            <thead><tr><th></th><th>Fiche</th><th>Modifiée</th><th></th></tr></thead>
            <tbody>${lignes || `<tr><td colspan="4" style="opacity:.6;">Aucune fiche PNJ, lieu ou organisation dans Monk's pour l'instant.</td></tr>`}</tbody>
        </table>
    </div>`;
}

export async function cablerOngletMonde(root, rerendre, etat = {}) {
    const hote = root?.querySelector(".scwm-monde-hote");
    if (hote) {
        try { hote.innerHTML = await contenuMondeHtml(etat); }
        catch (e) { journal.avert(`[${MOD}] onglet Monde`, e); hote.innerHTML = `<p style="color:#e58f8f;">Impossible de charger les fiches : ${esc(e.message)}</p>`; return; }
    }
    const box = root?.querySelector(".scwm-monde");
    if (!box) return;
    box.querySelector(".scwm-monde-ranger")?.addEventListener("click", async () => { if (await rangerDansCompendiums()) rerendre(); });
    const appliquer = () => {
        const q = (box.querySelector(".scwm-monde-recherche")?.value ?? "").trim().toLowerCase();
        const recent = !!box.querySelector(".scwm-monde-recent")?.checked;
        box.querySelectorAll(".scwm-monde-ligne").forEach(tr => {
            const ok = (!etat.type || tr.dataset.type === etat.type)
                && (!q || tr.dataset.texte.includes(q))
                && (!recent || tr.dataset.recent === "1");
            tr.style.display = ok ? "" : "none";
        });
    };
    box.querySelector(".scwm-monde-recherche")?.addEventListener("input", appliquer);
    box.querySelector(".scwm-monde-recent")?.addEventListener("change", appliquer);
    box.querySelectorAll(".scwm-monde-filtre-type").forEach(b => b.addEventListener("click", () => { etat.type = b.dataset.type; rerendre(); }));
    box.querySelectorAll(".scwm-monde-nouveau").forEach(b => b.addEventListener("click", async () => {
        try { await nouvelleFiche(b.dataset.type); } catch (e) { ui.notifications?.error(e.message); }
        rerendre();
    }));
    box.querySelector(".scwm-monde-actualiser")?.addEventListener("click", async () => {
        let n = 0, sautees = 0;
        for (const f of await chargerFiches()) {
            if (f.type === "place") await lierPnjDesCartes(f.entry, ficheDe(f.page).scenes);
            if (!ficheDe(f.page).hash) continue;          // jamais rédigée ici : on n'y touche pas
            (await actualiserFiche(f.entry)) ? n++ : sautees++;
        }
        await appliquerDecouverte();
        ui.notifications?.info(`${n} fiche(s) actualisée(s)${sautees ? `, ${sautees} laissée(s) telle(s) quelle(s) car modifiée(s) à la main` : ""}.`);
        rerendre();
    });
    box.addEventListener("click", async (ev) => {
        const a = ev.target.closest("a");
        if (!a || !box.contains(a)) return;
        ev.preventDefault();
        const entry = a.dataset.uuid ? await fromUuid(a.dataset.uuid) : null;
        if (a.classList.contains("scwm-monde-ouvrir")) ouvrirFiche(entry);
        else if (a.classList.contains("scwm-monde-rediger")) { await redigerFiche(entry); rerendre(); }
        else if (a.classList.contains("scwm-monde-visible")) { await basculerVisibilite(entry); rerendre(); }
        else if (a.classList.contains("scwm-monde-acteur-ouvrir")) game.actors.get(a.dataset.actor)?.sheet?.render(true);
        else if (a.classList.contains("scwm-monde-scene-ouvrir")) game.scenes.get(a.dataset.scene)?.view();
        else if (a.classList.contains("scwm-monde-epingle")) voirSurLaCarte(entry);
    });
    appliquer();
}

// ============================================================
// Rangement des fiches PNJ / organisations du monde dans les compendiums
// ============================================================
export async function rangerDansCompendiums() {
    const aDeplacer = toutesLesFiches().filter(f => f.type !== "place");
    if (!aDeplacer.length) return false;
    const epinglees = aDeplacer.filter(f => epinglesDe(f.entry).length);
    const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Ranger dans les compendiums" },
        content: `<p>${aDeplacer.length} fiche(s) PNJ / organisation vont être déplacées dans leurs compendiums (chargés seulement à la demande).</p>
            <p>Les liens sont conservés : acteurs, relations Monk's, liens @UUID dans les fiches. Les fiches du monde sont ensuite supprimées.</p>
            ${epinglees.length ? `<p style="color:#e0a96d;"><i class="fa-solid fa-triangle-exclamation"></i> ${epinglees.length} d'entre elles ont une épingle sur une carte (${epinglees.map(f => esc(f.entry.name)).join(", ")}) : une épingle ne peut pas pointer vers un compendium, elle ne fonctionnera plus.</p>` : ""}`
    });
    if (!ok) return false;
    const correspondances = new Map();   // ancien uuid → nouveau document
    try {
        for (const f of aDeplacer) {
            const pack = await packPour(f.type);
            verifierDeverrouille(pack);
            const data = f.entry.toObject();
            data.folder = (await dossierDansPack(f.type, pack))?.id ?? null;
            const neuf = await JournalEntry.create(data, { pack: pack.collection, keepId: true });
            correspondances.set(f.entry.uuid, neuf);
        }
    } catch (e) {
        ui.notifications?.error(`Rangement interrompu : ${e.message}`);
        journal.avert(`[${MOD}] rangement`, e);
        return false;
    }
    // Remplace les anciens uuid partout : relations Monk's, liens @UUID, acteurs.
    const remplacer = (txt) => {
        let t = String(txt ?? "");
        for (const [ancien, neuf] of correspondances) t = t.split(ancien).join(neuf.uuid);
        return t;
    };
    for (const f of await chargerFiches()) {
        const page = pageDe(f.entry);
        if (!page) continue;
        const update = {};
        const rel = foundry.utils.deepClone(page.getFlag(MEJ, "relationships") ?? {});
        let relModif = false;
        if (!Array.isArray(rel)) for (const r of Object.values(rel)) {
            const n = correspondances.get(r?.uuid);
            if (n) { r.uuid = n.uuid; relModif = true; }
        }
        if (relModif) update[`flags.${MEJ}.relationships`] = rel;
        const contenu = page.text?.content ?? "";
        const nouveau = remplacer(contenu);
        if (nouveau !== contenu) update["text.content"] = nouveau;
        const fiche = ficheDe(page);
        if (fiche.rubriques) {
            const r2 = Object.fromEntries(Object.entries(fiche.rubriques).map(([k, v]) => [k, remplacer(v)]));
            if (JSON.stringify(r2) !== JSON.stringify(fiche.rubriques)) update[`flags.${MOD}.fiche.rubriques`] = r2;
            // le texte a été réécrit ici même : l'empreinte suit pour ne pas le croire « modifié à la main »
            if (update["text.content"] && fiche.hash === empreinte(contenu)) update[`flags.${MOD}.fiche.hash`] = empreinte(nouveau);
        }
        if (Object.keys(update).length) {
            try { await page.update(update); } catch (e) { journal.avert(`[${MOD}] mise à jour des liens de ${f.entry.name}`, e); }
        }
    }
    for (const a of game.actors) {
        const n = correspondances.get(a.getFlag(MOD, "fichePage"));
        if (n) await a.setFlag(MOD, "fichePage", n.uuid);
    }
    for (const f of aDeplacer) await f.entry.delete();
    ui.notifications?.info(`${aDeplacer.length} fiche(s) rangée(s) dans les compendiums.`);
    return true;
}

// ============================================================
// Éditeur des rubriques (réglages)
// ============================================================
const BTN = "border-radius:4px;cursor:pointer;";
function ligneRubriqueHtml(r = {}) {
    return `<div class="scwm-mr-ligne" data-id="${esc(r.id ?? "")}" style="display:flex;gap:4px;align-items:center;margin:3px 0;">
        <input type="text" class="scwm-mr-label" value="${esc(r.label ?? "")}" placeholder="Nom de la rubrique" style="flex:1 1 auto;min-width:0;">
        <label style="display:inline-flex;align-items:center;gap:3px;font-size:.85em;white-space:nowrap;cursor:pointer;" title="Bloc secret : jamais montré aux joueurs">
            <input type="checkbox" class="scwm-mr-secret" ${r.secret ? "checked" : ""}> <i class="fa-solid fa-lock"></i></label>
        <button type="button" class="scwm-mr-monter" title="Monter" style="${BTN}width:26px;"><i class="fa-solid fa-arrow-up"></i></button>
        <button type="button" class="scwm-mr-suppr" title="Retirer" style="${BTN}width:26px;border:1px solid rgba(192,57,43,0.4);background:rgba(192,57,43,0.12);color:#e58f8f;"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

export function mondeControlHtml(key) {
    if (!MONDE_KEYS.has(key)) return null;
    const rubs = rubriques();
    const blocs = Object.entries(TYPES).map(([type, t]) => `
        <details class="scwm-mr-type" data-type="${type}" ${type === "person" ? "open" : ""} style="margin:4px 0;">
            <summary style="cursor:pointer;font-weight:600;"><i class="fa-solid ${t.icon}"></i> ${t.pluriel}</summary>
            <div class="scwm-mr-liste">${rubs[type].map(ligneRubriqueHtml).join("")}</div>
            <button type="button" class="scwm-mr-ajout" style="${BTN}margin-top:2px;padding:2px 8px;font-size:.85em;border:1px solid rgba(201,162,39,0.4);background:rgba(201,162,39,0.12);color:#c9a227;">
                <i class="fa-solid fa-plus"></i> Ajouter une rubrique</button>
        </details>`).join("");
    return `<div class="scwm-set scwm-mr" data-key="mondeRubriques" style="padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <label style="display:block;font-weight:600;margin:0 0 2px;">Rubriques des fiches</label>
        <p style="margin:0 0 4px;font-size:.8em;color:#999;">Les rubriques de la fenêtre « Rédiger la fiche », dans l'ordre. <i class="fa-solid fa-lock"></i> = secret MJ (bloc secret de Foundry, jamais visible des joueurs). Renommer une rubrique garde son contenu ; la retirer le masque de la fiche (il reste enregistré).</p>
        ${blocs}
        <a class="scwm-mr-defaut" style="font-size:.8em;cursor:pointer;color:#e58f8f;">Revenir aux rubriques par défaut</a>
    </div>`;
}

export function cablerMonde(root) {
    const box = root?.querySelector(".scwm-mr");
    if (!box) return;
    box.addEventListener("click", (e) => {
        const b = e.target.closest("button, a");
        if (!b || !box.contains(b)) return;
        if (b.classList.contains("scwm-mr-ajout")) {
            e.preventDefault();
            b.closest(".scwm-mr-type")?.querySelector(".scwm-mr-liste")?.insertAdjacentHTML("beforeend", ligneRubriqueHtml({ id: `r${foundry.utils.randomID(6)}` }));
        } else if (b.classList.contains("scwm-mr-suppr")) {
            e.preventDefault();
            b.closest(".scwm-mr-ligne")?.remove();
        } else if (b.classList.contains("scwm-mr-monter")) {
            e.preventDefault();
            const l = b.closest(".scwm-mr-ligne");
            if (l?.previousElementSibling) l.parentElement.insertBefore(l, l.previousElementSibling);
        } else if (b.classList.contains("scwm-mr-defaut")) {
            e.preventDefault();
            for (const [type, liste] of Object.entries(RUBRIQUES_DEFAUT)) {
                const cont = box.querySelector(`.scwm-mr-type[data-type="${type}"] .scwm-mr-liste`);
                if (cont) cont.innerHTML = liste.map(ligneRubriqueHtml).join("");
            }
        }
    });
}

export function lireMonde(key, root) {
    if (key !== "mondeRubriques") return undefined;
    const box = root?.querySelector(".scwm-mr");
    if (!box) return undefined;
    const out = {};
    box.querySelectorAll(".scwm-mr-type").forEach(d => {
        out[d.dataset.type] = [...d.querySelectorAll(".scwm-mr-ligne")].map(l => ({
            id: l.dataset.id, label: l.querySelector(".scwm-mr-label")?.value ?? "", secret: !!l.querySelector(".scwm-mr-secret")?.checked
        }));
    });
    return normaliserRubriques(out);
}

// ============================================================
// Points d'entrée : bouton sur les fiches d'acteurs, menus contextuels
// ============================================================
const estPnj = (a) => a instanceof Actor && !a.pack && !a.hasPlayerOwner && (a.type === "npc" || a.type === "character");

export function MondeHooks() {
    enregistrerQueryBanniere();
    // Bouton d'en-tête « Fiche du monde » sur les fiches de PNJ (MJ).
    Hooks.on("renderApplicationV2", (app, element) => {
        try {
            if (!game.user?.isGM || !mondeActif()) return;
            const actor = app?.document;
            if (!estPnj(actor)) return;
            const root = (element instanceof HTMLElement) ? element : element?.[0];
            const header = root?.querySelector(".window-header");
            if (!header || header.querySelector(".scwm-monde-btn")) return;
            const lie = !!actor.getFlag(MOD, "fichePage");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.classList.add("header-control", "icon", "fa-solid", "fa-book-atlas", "scwm-monde-btn");
            btn.dataset.tooltip = lie ? "Fiche du monde (Monk's) — rédiger" : "Créer la fiche du monde de ce PNJ";
            if (lie) btn.style.color = "#c9a227";
            btn.addEventListener("click", () => ficheActeur(actor));
            const title = header.querySelector(".window-title");
            if (title) title.insertAdjacentElement("afterend", btn);
            else header.insertBefore(btn, header.querySelector(".close"));
        } catch (e) { journal.avert(`[${MOD}] bouton fiche du monde :`, e); }
    });

    const idDe = (li) => li?.dataset?.entryId ?? li?.dataset?.documentId ?? li?.dataset?.sceneId ?? li?.dataset?.actorId;

    // Journaux : « Rédiger la fiche » sur les fiches PNJ / lieu / organisation.
    const ajouter = (options, opt) => { if (!options.some(o => o.name === opt.name)) options.push(opt); };
    Hooks.on("getJournalEntryContextOptions", (app, options) => {
        ajouter(options, {
            name: "Rédiger la fiche (Westmarch)",
            icon: '<i class="fa-solid fa-pen"></i>',
            condition: li => game.user.isGM && mondeActif() && !!typeDe(game.journal.get(idDe(li))),
            callback: li => redigerFiche(game.journal.get(idDe(li)))
        });
    });
    // Acteurs : « Fiche du monde ».
    Hooks.on("getActorContextOptions", (app, options) => {
        ajouter(options, {
            name: "Fiche du monde (Westmarch)",
            icon: '<i class="fa-solid fa-book-atlas"></i>',
            condition: li => game.user.isGM && mondeActif() && estPnj(game.actors.get(idDe(li))),
            callback: li => ficheActeur(game.actors.get(idDe(li)))
        });
    });
    // Scènes : « Fiche du lieu » (navigation et répertoire).
    const optionScene = (app, options) => {
        ajouter(options, {
            name: "Fiche du lieu (Westmarch)",
            icon: '<i class="fa-solid fa-location-dot"></i>',
            condition: li => game.user.isGM && mondeActif() && !!game.scenes.get(idDe(li)) && !estCarteDuMonde(idDe(li)),
            callback: li => ficheScene(game.scenes.get(idDe(li)))
        });
    };
    Hooks.on("getSceneContextOptions", optionScene);
    Hooks.on("getSceneDirectoryEntryContextOptions", optionScene);

    // Découverte : recalcul (différé, MJ actif seulement) quand l'exploration,
    // les épingles, les zones éclairées ou les propriétaires changent.
    const siDecouverte = (f) => (...args) => { if (game.user?.isGM && decouverteActive() && f(...args)) planifierDecouverte(); };
    Hooks.on("updateActor", siDecouverte((a, ch) =>
        foundry.utils.hasProperty(ch, `flags.${MOD}.exploredHexes`) || "ownership" in (ch ?? {})));
    // Épingle posée ou déplacée par le MJ : accès donnés sans bannière.
    Hooks.on("createNote", siDecouverte((n) => { marquerSilencieux(n?.entryId); return true; }));
    Hooks.on("updateNote", siDecouverte((n, ch) => {
        if ("x" in (ch ?? {}) || "y" in (ch ?? {}) || "entryId" in (ch ?? {})) marquerSilencieux(n?.entryId);
        return true;
    }));
    Hooks.on("deleteNote", siDecouverte(() => true));

    // Étiquette d'épingle figée sur l'ancien nom (ex. « Nouveau lieu ») :
    // vidée pour qu'elle suive le nom du journal.
    Hooks.on("preUpdateJournalEntry", (entry, ch) => {
        if (!game.user?.isGM || !("name" in (ch ?? {})) || ch.name === entry.name) return;
        const ancien = entry.name;
        setTimeout(() => viderEtiquettes(entry, ancien).catch(() => {}), 0);
    });
    Hooks.once("ready", () => {
        if (!game.user?.isGM || !mondeActif() || (game.users.activeGM && game.users.activeGM.id !== game.user.id)) return;
        for (const { entry, type } of toutesLesFiches()) if (type === "place") viderEtiquettes(entry).catch(() => {});
        migrerEpingles().catch(e => journal.avert(`[${MOD}] épingles`, e));
        preparerDossierLieux().catch(e => journal.avert(`[${MOD}] dossier des lieux`, e));
    });
    // Note d'un lieu posée sur la carte du monde (glisser-déposer du journal,
    // outil Notes…) → épingle fine, par le client qui l'a créée.
    Hooks.on("createNote", (note, _o, userId) => {
        if (userId !== game.user?.id || !mondeActif() || !note?.parent || !estCarteDuMonde(note.parent.id)) return;
        if (note.texture?.src === ICONE_EPINGLE) return;
        const entry = game.journal.get(note.entryId);
        if (!entry || typeDe(entry) !== "place") return;
        note.update({ "texture.src": ICONE_EPINGLE, iconSize: TAILLE_EPINGLE }).catch(() => {});
    });

    // Épingles du monde visibles dans tous les modes (chaque client).
    const reafficher = () => setTimeout(afficherEpinglesPartout, 0);
    Hooks.on("drawNote", epingleSansFond);
    Hooks.on("refreshNote", epingleSansFond);
    Hooks.on("canvasReady", reafficher);
    Hooks.on("deactivateNotesLayer", reafficher);
    Hooks.on("renderSceneControls", reafficher);
    Hooks.on("createNote", reafficher);
    Hooks.on("updateSetting", (st) => { if (String(st?.key ?? "").startsWith(`${MOD}.monde`) || st?.key === "core.notesDisplayToggle") reafficher(); });
    // Registre activé ou dossier des lieux renommé → dossier créé tout de suite (MJ actif).
    Hooks.on("updateSetting", (st) => {
        if (![`${MOD}.mondeEnabled`, `${MOD}.mondeFolderPlace`].includes(st?.key)) return;
        if (game.users.activeGM && game.users.activeGM.id !== game.user?.id) return;
        preparerDossierLieux().catch(() => {});
    });
    Hooks.on("updateSetting", siDecouverte((st) => st?.key === `${MOD}.expeditionRevealedZones`));
    Hooks.on("updateUser", siDecouverte((u, ch) => "character" in (ch ?? {})));
    Hooks.once("ready", () => { if (game.user?.isGM && decouverteActive()) planifierDecouverte(); });
}
