// ============================================================
// adminpass.js — Mot de passe admin du module
//
// Protège les actions de remise à zéro les plus lourdes, pour qu'un autre MJ
// (ou un clic malheureux) ne puisse pas les lancer :
//   - « Préparer l'ouverture du serveur » (casier.js) ;
//   - la réinitialisation du brouillard (map.js, uniquement depuis la fenêtre
//     d'administration) et des zones révélées (bouton du Casier, onglet Expéditions).
//
// Réglages du module → « Administration du module » (MJ) : créer ou changer
// le mot de passe, et lancer ces actions. Si aucun mot de passe n'existe
// encore, le premier MJ qui lance une action protégée le crée.
//
// Stockage : réglage monde « adminPass » = { sel, hash, iter } ; le mot de
// passe n'est jamais enregistré, seulement son empreinte PBKDF2-SHA-256
// (210 000 itérations, sel aléatoire), calculée dans le navigateur avec
// crypto.subtle (page servie en HTTPS). Après une saisie correcte, le client
// ne le redemande pas pendant 5 minutes.
//
// Limite (assumée) : c'est une protection côté navigateur. Un MJ qui maîtrise
// la console peut effacer le réglage ; elle évite les erreurs et les abus
// simples, pas un MJ décidé à contourner le module.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";

const CLE = "adminPass";
const ITER = 210_000;
const MIN = 6;
const DUREE_OK = 5 * 60_000;
let okJusqua = 0;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function empreinte(motDePasse, sel, iter = ITER) {
    if (!globalThis.crypto?.subtle) throw new Error(tl("Chiffrement indisponible : Foundry doit être ouvert en HTTPS."));
    const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(motDePasse), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sel, iterations: iter }, cle, 256);
    return b64(bits);
}

// Comparaison à temps constant (évite de deviner l'empreinte caractère par caractère).
function egal(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}

const stocke = () => { try { return game.settings.get(MOD, CLE) ?? {}; } catch { return {}; } };
export const motDePasseDefini = () => !!stocke().hash;

async function enregistrer(motDePasse) {
    const sel = crypto.getRandomValues(new Uint8Array(16));
    const hash = await empreinte(motDePasse, sel);
    await game.settings.set(MOD, CLE, { sel: b64(sel), hash, iter: ITER, date: new Date().toISOString(), par: game.user.name });
}

async function verifier(motDePasse) {
    const s = stocke();
    if (!s.hash) return false;
    return egal(await empreinte(motDePasse, deb64(s.sel), s.iter || ITER), s.hash);
}

// Petite fenêtre de saisie. `champs` : [{ name, label }]. Renvoie les valeurs ou null.
async function saisir(titre, texte, champs, bouton) {
    const uid = `scwm-admin-${foundry.utils.randomID()}`;
    let res = null;
    await foundry.applications.api.DialogV2.wait({
        window: { title: titre, icon: "fa-solid fa-user-shield" },
        position: { width: 420 },
        rejectClose: false,
        content: `<div id="${uid}">${texte ? `<p style="margin:0 0 8px;">${texte}</p>` : ""}
            ${champs.map((c, i) => `<label style="display:block;margin:4px 0 2px;font-weight:600;">${c.label}</label>
            <input type="password" name="${c.name}" autocomplete="new-password" style="width:100%;box-sizing:border-box;" ${i === 0 ? "autofocus" : ""}>`).join("")}</div>`,
        buttons: [
            { action: "ok", label: bouton, icon: "fa-solid fa-check", default: true,
              callback: () => {
                  const root = document.getElementById(uid);
                  res = Object.fromEntries(champs.map(c => [c.name, root?.querySelector(`[name="${c.name}"]`)?.value ?? ""]));
              } },
            { action: "cancel", label: tl("Annuler"), icon: "fa-solid fa-xmark" }
        ]
    });
    return res;
}

async function creer(intro) {
    const v = await saisir(tl("Créer le mot de passe admin"),
        intro ?? tl("Ce mot de passe protégera les remises à zéro du module (ouverture du serveur, carte d'expédition). Il est commun à tous les MJ : ne le donne qu'à ceux qui doivent pouvoir les lancer."),
        [{ name: "a", label: tl("Nouveau mot de passe ({0} caractères minimum)", MIN) }, { name: "b", label: tl("Confirmer le mot de passe") }],
        tl("Créer"));
    if (!v) return false;
    if (v.a.length < MIN) { ui.notifications?.warn(tl("Mot de passe trop court ({0} caractères minimum).", MIN)); return false; }
    if (v.a !== v.b) { ui.notifications?.warn(tl("Les deux mots de passe ne sont pas identiques.")); return false; }
    await enregistrer(v.a);
    okJusqua = Date.now() + DUREE_OK;
    ui.notifications?.info(tl("Mot de passe admin du module enregistré."));
    return true;
}

/** Demande le mot de passe admin avant une action protégée. Renvoie true si
 *  l'action peut continuer. Le crée s'il n'existe pas encore. */
export async function verifierAdmin(action) {
    if (!game.user.isGM) return false;
    try {
        if (!motDePasseDefini()) {
            return await creer(tl("« {0} » est protégé par le mot de passe admin du module, qui n'existe pas encore. Crée-le maintenant : il sera demandé pour toutes les remises à zéro.", action));
        }
        if (Date.now() < okJusqua) return true;
        const v = await saisir(tl("Mot de passe admin"), tl("« {0} » est protégé. Saisis le mot de passe admin du module.", action),
            [{ name: "p", label: tl("Mot de passe") }], tl("Valider"));
        if (!v) return false;
        if (await verifier(v.p)) { okJusqua = Date.now() + DUREE_OK; return true; }
        ui.notifications?.error(tl("Mot de passe admin incorrect."));
        journal.avert(tl("[{0}] Mot de passe admin incorrect ({1}) pour : {2}", MOD, game.user.name, action));
        return false;
    } catch (e) {
        journal.erreur(tl("[{0}] Mot de passe admin :", MOD), e);
        ui.notifications?.error(e.message);
        return false;
    }
}

async function changer() {
    if (!motDePasseDefini()) return creer();
    const v = await saisir(tl("Changer le mot de passe admin"), "",
        [{ name: "old", label: tl("Mot de passe actuel") }, { name: "a", label: tl("Nouveau mot de passe ({0} caractères minimum)", MIN) }, { name: "b", label: tl("Confirmer le mot de passe") }],
        tl("Changer"));
    if (!v) return false;
    try {
        if (!(await verifier(v.old))) { ui.notifications?.error(tl("Mot de passe admin incorrect.")); return false; }
        if (v.a.length < MIN) { ui.notifications?.warn(tl("Mot de passe trop court ({0} caractères minimum).", MIN)); return false; }
        if (v.a !== v.b) { ui.notifications?.warn(tl("Les deux mots de passe ne sont pas identiques.")); return false; }
        await enregistrer(v.a);
        ui.notifications?.info(tl("Mot de passe admin du module modifié."));
        return true;
    } catch (e) { ui.notifications?.error(e.message); return false; }
}

// ------------------------------------------------------------------ fenêtre des réglages
async function ouvrirAdministration() {
    if (!game.user.isGM) return;
    const s = stocke();
    const etat = s.hash
        ? tl("Mot de passe défini le {0} par {1}.", s.date ? new Date(s.date).toLocaleString(game.i18n?.lang || "fr") : "?", s.par ?? "?")
        : tl("Aucun mot de passe pour l'instant : il sera créé à la première action protégée, ou maintenant avec le bouton ci-dessous.");
    const choix = await foundry.applications.api.DialogV2.wait({
        window: { title: tl("Administration du module"), icon: "fa-solid fa-user-shield" },
        position: { width: 480 },
        rejectClose: false,
        content: `<p style="margin:0 0 6px;">${tl("Actions protégées par le mot de passe admin du module :")}</p>
            <ul style="margin:0 0 8px 18px;padding:0;">
                <li>${tl("<strong>Préparer l'ouverture du serveur</strong> : efface les données de test (rapports, journal des sessions, historique des expéditions, temps morts, fiches de test…).")}</li>
                <li>${tl("<strong>Réinitialisation du brouillard</strong> : brouillard exploré de la carte des expéditions, d'un personnage ou de tous.")}</li>
                <li>${tl("<strong>Zones révélées</strong> de la carte : bouton de l'onglet Expéditions du Casier.")}</li>
            </ul>
            <p style="margin:0;font-size:12px;opacity:.8;"><i class="fa-solid fa-key"></i> ${etat}</p>`,
        buttons: [
            { action: "ouverture", label: tl("Préparer l'ouverture du serveur…"), icon: "fa-solid fa-broom" },
            { action: "carte", label: tl("Réinitialisation du brouillard…"), icon: "fa-solid fa-eraser" },
            { action: "mdp", label: s.hash ? tl("Changer le mot de passe") : tl("Créer le mot de passe"), icon: "fa-solid fa-key" },
            { action: "close", label: tl("Fermer"), icon: "fa-solid fa-xmark" }
        ]
    }).catch(() => null);
    if (choix === "ouverture") (await import("./casier.js")).preparerOuverture();
    else if (choix === "carte") (await import("./map.js")).ouvrirEffacementCarte();
    else if (choix === "mdp") changer();
}

export function AdminPassHooks() {
    game.settings.register(MOD, CLE, { scope: "world", config: false, type: Object, default: {} });
    try { if (game.settings.get(MOD, "enableAdminMenu") === false) return; } catch {}
    try {
        game.settings.registerMenu(MOD, "menu-admin", {
            name: tl("Administration du module"),
            label: tl("Ouvrir"),
            hint: tl("Mot de passe admin, préparation de l'ouverture du serveur, réinitialisation du brouillard."),
            icon: "fas fa-user-shield",
            type: class extends foundry.applications.api.ApplicationV2 {
                static DEFAULT_OPTIONS = { id: "scwm-menu-admin", window: { title: tl("Administration du module") } };
                async render() { ouvrirAdministration(); return this; }
                async close() { return this; }
            },
            restricted: true
        });
    } catch (e) {
        journal.critique(tl("[{0}] registerMenu « Administration » échec :", MOD), e);
    }
}
