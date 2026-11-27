// ============================================================
// accroche.js — Accrocher un token à un PJ (porter / mener)
//
// Le MJ accroche un token (PNJ, objet, autre PJ…) au token d'un PJ depuis le
// HUD du token (clic droit → icône chaîne). Ensuite, quand le joueur déplace
// son PJ, le token accroché suit tout seul : le joueur n'a besoin d'aucun droit
// sur lui, c'est le client du MJ connecté qui fait le déplacement.
//
// Deux modes, choisis à l'accrochage :
//   - Porter : le token accroché se pose sur le PJ et fait exactement le même
//     trajet que lui.
//   - Mener  : le token accroché suit derrière, à la distance de l'accrochage,
//     en repassant EXACTEMENT par les cases où le PJ est passé (une « piste »).
//
// Murs : le PJ, lui, respecte les murs. Le token accroché ne va jamais en ligne
// droite vers sa destination : il emprunte le trajet du porteur (porter) ou sa
// piste (mener), donc uniquement des endroits où le PJ est passé. Il ne
// traverse ni ne se cogne aux murs, et l'animation suit le même chemin.
//
// Décrochage : bouton du HUD (MJ), suppression du porteur, ou si quelqu'un
// déplace lui-même le token accroché (son joueur, le MJ à la main…).
// Plusieurs tokens peuvent être accrochés au même PJ ; une boucle (A porte B
// qui porte A) est refusée.
//
// Données : flag de TOKEN `accroche` = { porteur, mode, distance } sur le token
// accroché. La piste de « mener » est gardée en mémoire sur le client du MJ.
// Réglage : enableTokenAccroche (catégorie « Tokens — apparence & HUD »).
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";

const FLAG = "accroche";
const PISTE_MAX = 200;                 // points gardés par porteur
const actif = () => { try { return game.settings.get(MOD, "enableTokenAccroche") === true; } catch { return false; } };
const estMjActif = () => !!game.user?.isGM && (game.users?.activeGM ?? game.user) === game.user;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ------------------------------------------------------------------ géométrie
// Dimensions en pixels d'un token (largeur/hauteur en cases × taille de case).
function taillePx(doc, scene = doc.parent) {
    const g = Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    return { w: (Number(doc.width) || 1) * g, h: (Number(doc.height) || 1) * g, g };
}
// Centre d'un token à partir de son coin haut-gauche.
export function centre(doc, x = doc.x, y = doc.y) {
    const { w, h } = taillePx(doc);
    return { x: x + w / 2, y: y + h / 2 };
}
// Coin haut-gauche pour qu'un token soit centré sur un point.
export function coinPour(doc, c) {
    const { w, h } = taillePx(doc);
    return { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Distance « en cases » (règle dnd5e : une diagonale compte comme une case).
const distCases = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Ajoute des centres à une piste, longueur bornée. Un trajet de Foundry ne
// donne que les angles du chemin : chaque segment est découpé en pas d'une case
// au plus (les points intermédiaires sont sur la ligne réellement parcourue par
// le porteur), pour que « mener » s'arrête à la bonne distance et non au
// dernier angle.
export function prolongerPiste(piste, points, pas = 100) {
    for (const p of points) {
        const der = piste[piste.length - 1];
        if (!der) { piste.push({ x: p.x, y: p.y }); continue; }
        if (dist(der, p) <= 0.5) continue;
        // Pas d'une case au plus, comptés en cases (diagonale = 1) : une
        // diagonale n'est plus coupée en demi-cases.
        const n = Math.max(1, Math.ceil(distCases(der, p) / pas - 1e-6));
        for (let k = 1; k <= n; k++) piste.push({ x: der.x + (p.x - der.x) * k / n, y: der.y + (p.y - der.y) * k / n });
    }
    if (piste.length > PISTE_MAX) piste.splice(0, piste.length - PISTE_MAX);
    return piste;
}

// « Mener » : à partir de la fin de la piste (position du porteur), recule
// d'au moins `distance` (en cases, diagonale = 1) en suivant la piste. Renvoie l'indice du point où
// s'arrête le token mené (toujours un point réellement visité par le porteur).
export function indiceDerriere(piste, distance) {
    let cumul = 0;
    for (let i = piste.length - 1; i > 0; i--) {
        cumul += distCases(piste[i], piste[i - 1]);
        if (cumul >= distance - 0.5) return i - 1;
    }
    return 0;
}

// Points de la piste à parcourir par le token mené : depuis le point le plus
// proche de sa position actuelle (en avançant), jusqu'à l'indice visé.
export function cheminMene(piste, depuis, cible) {
    let iDepart = 0, best = Infinity;
    for (let i = 0; i <= cible; i++) {
        const d = dist(piste[i], depuis);
        if (d <= best) { best = d; iDepart = i; }
    }
    return piste.slice(iDepart + (best < 0.5 ? 1 : 0), cible + 1);
}

// ------------------------------------------------------------------ données
const lireAccroche = (doc) => doc?.getFlag?.(MOD, FLAG) ?? null;
const accrochesDe = (porteur) => (porteur.parent?.tokens ?? []).filter(t => lireAccroche(t)?.porteur === porteur.id);

// Le token `cible` est-il (directement ou non) porté par `doc` ? (anti-boucle)
function portePar(cible, doc) {
    const vus = new Set();
    let cur = cible;
    while (cur && !vus.has(cur.id)) {
        vus.add(cur.id);
        const a = lireAccroche(cur);
        if (!a) return false;
        if (a.porteur === doc.id) return true;
        cur = cur.parent?.tokens?.get(a.porteur);
    }
    return false;
}

// Pistes de « mener », par porteur (client du MJ uniquement).
const PISTES = new Map();
// Tokens que le module est en train de déplacer (pour ne pas les décrocher).
// Compteur par token : deux déplacements rapprochés ne se « libèrent » pas
// l'un l'autre (avec un simple ensemble, la fin du 1er retirait la marque
// pendant le 2e, et le token se décrochait tout seul).
const EN_COURS = new Map();
const marquer   = (id) => EN_COURS.set(id, (EN_COURS.get(id) ?? 0) + 1);
const demarquer = (id) => { const n = (EN_COURS.get(id) ?? 1) - 1; if (n > 0) EN_COURS.set(id, n); else EN_COURS.delete(id); };
// File d'attente par porteur : les suivis d'un même porteur s'exécutent l'un
// après l'autre (deux déplacements rapides ne lancent plus deux animations
// concurrentes sur le même token accroché).
const FILES = new Map();

// ------------------------------------------------------------------ déplacement
// Extrait le trajet (centres) d'un déplacement : la liste des points passés,
// quelle que soit la forme exposée par la version de Foundry.
function trajetCentres(doc, changes, options) {
    const brut = [];
    const mv = options?.movement?.[doc.id];
    const wps = mv?.passed?.waypoints ?? mv?.waypoints ?? doc.movement?.passed?.waypoints ?? null;
    if (Array.isArray(wps)) for (const w of wps) if (Number.isFinite(w?.x) && Number.isFinite(w?.y)) brut.push(w);
    const fin = { x: changes.x ?? doc.x, y: changes.y ?? doc.y };
    const der = brut[brut.length - 1];
    if (!der || der.x !== fin.x || der.y !== fin.y) brut.push(fin);
    return brut.map(w => centre(doc, w.x, w.y));
}

// Point de départ du porteur (centre) pour ce déplacement, si Foundry le donne.
function origineCentre(doc, options) {
    const o = options?.movement?.[doc.id]?.origin ?? doc.movement?.origin ?? null;
    return (o && Number.isFinite(o.x) && Number.isFinite(o.y)) ? centre(doc, o.x, o.y) : null;
}

// Cale un coin haut-gauche sur la grille (scènes avec grille), pour qu'un
// token mené ne s'arrête jamais à cheval entre deux cases (les points
// intermédiaires d'une diagonale tombaient sur des demi-cases).
function caler(doc, pt) {
    try {
        const scene = doc.parent;
        if (!scene || scene.grid?.type === CONST.GRID_TYPES.GRIDLESS) return pt;
        const p = doc.object?.getSnappedPosition?.(pt)
            ?? canvas?.grid?.getSnappedPoint?.(pt, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX });
        return (p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? { x: Math.round(p.x), y: Math.round(p.y) } : pt;
    } catch { return pt; }
}

// Déplace un token le long d'une suite de centres (animation sur le même
// chemin). Passe par l'API de mouvement de Foundry si elle existe, sinon par
// une mise à jour simple de la position finale.
async function deplacer(doc, centres, elevation) {
    if (!centres.length) return;
    const coins = [];
    for (const c of centres) {
        const p = caler(doc, coinPour(doc, c));
        const der = coins[coins.length - 1] ?? { x: doc.x, y: doc.y };
        if (der.x === p.x && der.y === p.y) continue;           // pas de point en double
        coins.push({ ...p, ...(elevation != null ? { elevation } : {}) });
    }
    if (!coins.length) return;
    marquer(doc.id);
    try {
        if (typeof doc.move === "function") {
            await doc.move(coins, {
                method: "api", autoRotate: true, showRuler: false,
                constrainOptions: { ignoreWalls: true, ignoreCost: true }
            });
        } else {
            const fin = coins[coins.length - 1];
            await doc.update(fin);
        }
    } finally {
        setTimeout(() => demarquer(doc.id), 1500);
    }
}

// Fait suivre les accrochés d'un porteur, un déplacement à la fois.
function suivre(porteur, changes, options) {
    if (!accrochesDe(porteur).length) return Promise.resolve();
    // Données du déplacement lues TOUT DE SUITE (le document changera ensuite).
    const trajet = trajetCentres(porteur, changes, options);
    const origine = origineCentre(porteur, options);
    const elevation = changes.elevation ?? porteur.elevation;
    const prec = FILES.get(porteur.id) ?? Promise.resolve();
    const suite = prec.catch(() => {}).then(() => _suivre(porteur, trajet, origine, elevation));
    FILES.set(porteur.id, suite);
    suite.finally(() => { if (FILES.get(porteur.id) === suite) FILES.delete(porteur.id); }).catch(() => {});
    return suite;
}

async function _suivre(porteur, trajet, origine, elevation) {
    const accroches = accrochesDe(porteur);
    if (!accroches.length) return;
    const g = taillePx(porteur).g;

    // Piste de « mener » : on y ajoute le trajet du porteur. Si elle est vide
    // (rechargement, changement de MJ) ou ne se raccorde pas au point de départ,
    // on la fait partir du point de départ du porteur : sinon le token mené
    // filait en ligne droite vers le 1er point du trajet, à travers les murs.
    const piste = PISTES.get(porteur.id) ?? [];
    PISTES.set(porteur.id, piste);
    const der = piste[piste.length - 1];
    if (origine && (!der || dist(der, origine) > 0.5)) {
        if (der && dist(der, origine) > 2 * g) piste.length = 0;   // piste périmée
        prolongerPiste(piste, [origine], g);
    }
    prolongerPiste(piste, trajet, g);

    for (const t of accroches) {
        const a = lireAccroche(t);
        try {
            if (a.mode === "mener") {
                const cible = indiceDerriere(piste, Number(a.distance) || g);
                const chemin = cheminMene(piste, centre(t), cible);
                await deplacer(t, chemin, elevation);
            } else {
                await deplacer(t, trajet, elevation);
            }
        } catch (e) {
            journal.avert(tl("[{0}] Accroche : déplacement de {1} impossible :", MOD, t.name), e);
        }
    }
}

// ------------------------------------------------------------------ accrocher / décrocher
export async function accrocher(doc, porteur, mode) {
    if (!game.user.isGM || !doc || !porteur || doc.id === porteur.id) return;
    if (portePar(porteur, doc)) {
        ui.notifications?.warn(tl("{0} porte déjà {1} : impossible de faire une boucle.", doc.name, porteur.name));
        return;
    }
    const g = taillePx(porteur).g;
    const distance = Math.max(g, distCases(centre(doc), centre(porteur)));
    await doc.setFlag(MOD, FLAG, { porteur: porteur.id, mode, distance });

    // Piste de départ (mener seulement) : de la position du token mené vers le
    // porteur, si le porteur n'a pas encore de piste. On n'y ajoute JAMAIS la
    // position d'un token accroché : la piste est commune à tous les accrochés
    // du porteur (avant, accrocher un 2e token y insérait un détour que le 1er
    // token mené suivait ensuite).
    if (mode === "mener" && !(PISTES.get(porteur.id)?.length)) {
        PISTES.set(porteur.id, prolongerPiste([], [centre(doc), centre(porteur)], g));
    }
    if (mode === "porter") await deplacer(doc, [centre(porteur)], porteur.elevation);
    ui.notifications?.info(mode === "porter"
        ? tl("{0} porte maintenant {1}.", porteur.name, doc.name)
        : tl("{0} mène maintenant {1}.", porteur.name, doc.name));
}

export async function decrocher(doc, raison = null) {
    if (!lireAccroche(doc)) return;
    await doc.unsetFlag(MOD, FLAG);
    if (raison) ui.notifications?.info(raison);
}

// Fenêtre « Accrocher à… » : PJ de la scène (tokens d'acteurs ayant un joueur).
async function choisirPorteur(doc) {
    const scene = doc.parent;
    const pjs = (scene?.tokens ?? []).filter(t => t.id !== doc.id && t.actor?.hasPlayerOwner && !portePar(t, doc))
        .sort((a, b) => dist(centre(a), centre(doc)) - dist(centre(b), centre(doc)));
    if (!pjs.length) { ui.notifications?.warn(tl("Aucun token de PJ sur cette scène.")); return; }
    const uid = `scwm-accroche-${doc.id}`;
    const g = taillePx(doc).g;
    const cases = (t) => Math.round(dist(centre(t), centre(doc)) / g);
    let choix = null;
    await foundry.applications.api.DialogV2.wait({
        window: { title: tl("Accrocher {0}", doc.name), icon: "fa-solid fa-link" },
        position: { width: 380 },
        rejectClose: false,
        content: `<div id="${uid}">
            <p style="margin:0 0 6px;">${tl("À quel PJ accrocher <strong>{0}</strong> ?", esc(doc.name))}</p>
            <div style="max-height:240px;overflow-y:auto;">
            ${pjs.map((t, i) => `<label style="display:flex;gap:8px;align-items:center;padding:2px 0;">
                <input type="radio" name="porteur" value="${t.id}" ${i === 0 ? "checked" : ""}>
                <img src="${esc(t.texture?.src ?? "icons/svg/mystery-man.svg")}" style="width:26px;height:26px;border:none;object-fit:contain;">
                <span style="flex:1;">${esc(t.name)}</span><span style="opacity:.7;">${tl("{0} case(s)", cases(t))}</span></label>`).join("")}
            </div>
            <p style="margin:8px 0 4px;">${tl("Mode :")}</p>
            <label style="display:block;"><input type="radio" name="mode" value="porter" checked> ${tl("<strong>Porter</strong> — posé sur le PJ, fait le même trajet")}</label>
            <label style="display:block;"><input type="radio" name="mode" value="mener"> ${tl("<strong>Mener</strong> — suit derrière, à la distance actuelle, par le même chemin")}</label>
        </div>`,
        buttons: [
            { action: "ok", label: tl("Accrocher"), icon: "fa-solid fa-link", default: true,
              callback: () => {
                  const root = document.getElementById(uid);
                  choix = {
                      porteur: root?.querySelector('input[name="porteur"]:checked')?.value,
                      mode: root?.querySelector('input[name="mode"]:checked')?.value ?? "porter"
                  };
              } },
            { action: "cancel", label: tl("Annuler"), icon: "fa-solid fa-xmark" }
        ]
    });
    const porteur = choix?.porteur ? scene.tokens.get(choix.porteur) : null;
    if (porteur) await accrocher(doc, porteur, choix.mode);
}

// ------------------------------------------------------------------ hooks
export function AccrocheHooks() {
    // Bouton du HUD (MJ) : accrocher, ou décrocher si déjà accroché.
    Hooks.on("renderTokenHUD", (hud, html) => {
        if (!actif() || !game.user.isGM) return;
        const doc = hud.object?.document;
        if (!doc) return;
        const a = lireAccroche(doc);
        const porteur = a ? doc.parent?.tokens?.get(a.porteur) : null;
        const titre = a
            ? tl("Décrocher de {0}", porteur?.name ?? "?")
            : tl("Accrocher à un PJ (porter / mener)");
        const btn = document.createElement("div");
        btn.className = `control-icon scwm-accroche${a ? " active" : ""}`;
        btn.title = titre;
        btn.dataset.tooltip = titre;
        btn.innerHTML = `<i class="fa-solid ${a ? "fa-link-slash" : "fa-link"}"></i>`;
        btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            if (a) await decrocher(doc, tl("{0} est décroché.", doc.name));
            else await choisirPorteur(doc);
            hud.render?.();
        });
        const el = html instanceof HTMLElement ? html : html?.[0];
        el?.querySelector(".col.right")?.appendChild(btn);
    });

    // Déplacement d'un token (client du MJ actif) : fait suivre ses accrochés,
    // et décroche un token accroché déplacé par quelqu'un d'autre que le module.
    Hooks.on("updateToken", (doc, changes, options) => {
        if (!actif() || !estMjActif()) return;
        if (!("x" in changes) && !("y" in changes)) {
            // Changement d'élévation seul du porteur : ses accrochés suivent.
            if ("elevation" in changes) for (const t of accrochesDe(doc)) {
                if (t.elevation === doc.elevation) continue;
                marquer(t.id);
                t.update({ elevation: doc.elevation }).catch(() => {}).finally(() => setTimeout(() => demarquer(t.id), 1500));
            }
            return;
        }
        const a = lireAccroche(doc);
        if (a && !EN_COURS.has(doc.id)) {
            decrocher(doc, tl("{0} a été déplacé à part : il est décroché de son porteur.", doc.name))
                .catch(e => journal.avert(tl("[{0}] Accroche :", MOD), e));
        }
        suivre(doc, changes, options).catch(e => journal.avert(tl("[{0}] Accroche :", MOD), e));
    });

    // Porteur supprimé : on décroche ce qu'il portait.
    Hooks.on("deleteToken", (doc) => {
        if (!estMjActif()) return;
        PISTES.delete(doc.id);
        FILES.delete(doc.id);
        for (const t of accrochesDe(doc)) decrocher(t).catch(() => {});
    });
}
