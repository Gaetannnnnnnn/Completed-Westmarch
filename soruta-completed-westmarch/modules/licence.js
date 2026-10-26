// ============================================================
// licence.js — Licence par clé, validée par le serveur licence.altheia.eu
// Soruta — Completed Westmarch
//
// Fonctionnement :
//  1. Le MJ saisit sa clé de licence (ALT-XXXX-XXXX-XXXX-XXXX) une seule fois.
//  2. Le serveur vérifie la clé, enregistre ce monde (nombre de mondes limité
//     par clé) et renvoie un JETON SIGNÉ, valable 7 jours, lié à ce monde.
//  3. Le jeton est gardé dans un réglage monde ; la clé, elle, n'est conservée
//     nulle part (les joueurs ne peuvent donc pas la lire dans les réglages).
//  4. Une fois par jour, le MJ actif renouvelle le jeton auprès du serveur.
//     Serveur injoignable → le jeton reste valable jusqu'à son échéance
//     (période de grâce). Licence révoquée → le serveur refuse, le module s'arrête.
//
// La signature est vérifiée avec la clé PUBLIQUE ci-dessous : elle permet de
// vérifier un jeton, jamais d'en fabriquer un.
// Rappel : tout contrôle exécuté dans le navigateur reste contournable par qui
// modifie ce fichier. Le but est une licence officielle et révocable, pas un
// verrou impossible à forcer.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

import { journal } from "./log.js";
const URL_LICENCE = "https://licence.altheia.eu/validate";

// Clé publique du serveur de licence (générée sur le VPS par generer-cles.mjs).
const CLE_PUBLIQUE = {"kty":"RSA","n":"5qfQNQDRr3KPH7Rpm4jrbe9UuYbLHiIvkdBeODLLtX8CDUnZ52jfcRBmIBwaz3gOhmazsoV_3HKfBJS2Ai0NaE1fBdCAJxK0padQMtghitVXlYVP-No0Uea0CYXsHic56_Cv4rZiMObIIUkvj0pnHewe6f91Jd-M7sFL26Jj94xR3lAAQQf-XePx_SlFjMGZmoQvvR1qciz-4lU1QK0l-4w9epnB8czyFytAWOUNFzoecNzHnTRox-XA5lNBRXPNNQ3PJXZa1alnjvnpS9Rx4yYAtykQPBgIxy-h-PV8NsuDRcMOZStjcAH2PjQr3t2aK1CLD2Wb0PqASAFG25vBjGrrVfAeUbpogOtsXT2D2PVbCZOIxu1iPRyROtccmhr1jq_FewEmPGyG3unEcAuVyTLSL7daA-HunrksBiYXsZ10HbzieBgB2ldKrf0GyPKneY-IgyoUV22i_KheDbDiyuer2Hkx1R9KGqKok8OCxx0nKuJx-Vohzc6Z2Hcg0A_T","e":"AQAB"};

const RENOUVELER_APRES_MS = 24 * 3600 * 1000;   // âge du jeton avant renouvellement
const CONTROLE_TOUTES_MS  = 6 * 3600 * 1000;    // contrôle périodique tant que le monde est ouvert
const AVERTIR_AVANT_MS    = 2 * 24 * 3600 * 1000; // prévient le MJ 2 jours avant l'arrêt
const DELAI_RESEAU_MS     = 10000;

const MESSAGES = {
    cle_invalide:       "Clé de licence inconnue. Vérifie la saisie.",
    revoquee:           "Cette licence a été révoquée.",
    limite:             "Cette clé est déjà utilisée sur le nombre maximal de mondes. Contacte Soruta pour libérer une activation.",
    monde:              "Ce monde n'est plus associé à la licence.",
    jeton_invalide:     "La licence enregistrée dans ce monde n'est pas valide.",
    jeton_trop_ancien:  "La licence de ce monde n'a pas été renouvelée depuis trop longtemps. Ressaisis ta clé.",
    signature:          "La licence enregistrée dans ce monde n'est pas valide.",
    trop_de_tentatives: "Trop de tentatives. Réessaie dans une heure.",
    reseau:             "Serveur de licence injoignable. Vérifie ta connexion, puis réessaie.",
    requete:            "Requête refusée par le serveur de licence."
};
const message = (code) => MESSAGES[code] ?? `Activation impossible (${code ?? "erreur inconnue"}).`;
export const messageLicence = message;

// État de la licence au chargement de la page : sert à savoir s'il faut
// recharger quand le jeton change (activation ou invalidation).
let actifAuDemarrage = false;

// ------------------------------------------------------------------ réglage
export function registerLicenceSettings() {
    game.settings.register(MOD, "licenceJeton", {
        scope: "world", config: false, type: String, default: "",
        // Un simple renouvellement ne recharge rien ; seul un passage
        // actif ↔ inactif recharge les clients connectés.
        onChange: () => { if (licenceValide() !== actifAuDemarrage) foundry.utils.debouncedReload(); }
    });
}

// ------------------------------------------------------------------ lecture du jeton
function deB64url(texte) {
    const b64 = texte.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((texte.length + 3) % 4);
    const bin = atob(b64);
    const octets = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
    return octets;
}

function decouper(jeton) {
    if (typeof jeton !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jeton)) return null;
    const [partie, signature] = jeton.split(".");
    try {
        const contenu = JSON.parse(new TextDecoder().decode(deB64url(partie)));
        return contenu && typeof contenu === "object" ? { partie, signature, contenu } : null;
    } catch (e) { return null; }
}

const jetonActuel = () => game.settings.get(MOD, "licenceJeton") ?? "";
const idMonde = () => game.world?.id;

// Contrôle rapide et synchrone (utilisable au hook « init ») : jeton présent,
// pour CE monde, pas expiré. La signature est vérifiée juste après, au « ready ».
export function licenceValide() {
    const j = decouper(jetonActuel());
    return !!j && j.contenu.v === 1 && j.contenu.monde === idMonde() && Date.now() < j.contenu.exp;
}

// Résumé pour la fenêtre « À propos ».
export function etatLicence() {
    const j = decouper(jetonActuel());
    if (!j) return "Licence : non activée.";
    const jusquA = new Date(j.contenu.exp).toLocaleDateString();
    return licenceValide()
        ? `Licence : active (vérifiée le ${new Date(j.contenu.iat).toLocaleDateString()}, valable sans contact jusqu'au ${jusquA}).`
        : `Licence : expirée le ${jusquA}.`;
}

// ------------------------------------------------------------------ signature
// Vérification RSASSA-PKCS1-v1_5 + SHA-256. Web Crypto quand il existe ; sinon
// (serveur Foundry servi en HTTP, où les navigateurs le désactivent) on fait le
// même calcul en JavaScript pur.
async function signatureValide(jeton) {
    const j = decouper(jeton);
    if (!j) return false;
    const donnees = new TextEncoder().encode(j.partie);
    const signature = deB64url(j.signature);
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
        try {
            const cle = await subtle.importKey("jwk", { ...CLE_PUBLIQUE, alg: "RS256", ext: true },
                { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
            return await subtle.verify("RSASSA-PKCS1-v1_5", cle, signature, donnees);
        } catch (e) { /* on retombe sur le calcul en JavaScript pur */ }
    }
    return verifierPurJs(donnees, signature);
}

const enEntier = (octets) => octets.reduce((n, o) => (n << 8n) | BigInt(o), 0n);
function enOctets(n, longueur) {
    const octets = new Uint8Array(longueur);
    for (let i = longueur - 1; i >= 0; i--) { octets[i] = Number(n & 0xffn); n >>= 8n; }
    return octets;
}
function puissanceModulaire(base, exposant, module) {
    let resultat = 1n;
    base %= module;
    while (exposant > 0n) {
        if (exposant & 1n) resultat = (resultat * base) % module;
        base = (base * base) % module;
        exposant >>= 1n;
    }
    return resultat;
}

// En-tête DER qui précède l'empreinte SHA-256 dans une signature PKCS#1 v1.5.
const DIGEST_INFO_SHA256 = [0x30,0x31,0x30,0x0d,0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x02,0x01,0x05,0x00,0x04,0x20];

function verifierPurJs(donnees, signature) {
    const octetsN = deB64url(CLE_PUBLIQUE.n);
    const k = octetsN.length;
    const n = enEntier(octetsN);
    const e = enEntier(deB64url(CLE_PUBLIQUE.e));
    if (signature.length !== k) return false;
    const s = enEntier(signature);
    if (s >= n) return false;
    const obtenu = enOctets(puissanceModulaire(s, e, n), k);
    // On reconstruit le bloc attendu en entier et on compare octet par octet :
    // pas d'analyse de la structure, donc pas de faille de « parsing ».
    const attendu = new Uint8Array(k);
    const empreinte = sha256(donnees);
    const debutDigest = k - DIGEST_INFO_SHA256.length - empreinte.length;
    attendu[0] = 0x00; attendu[1] = 0x01;
    attendu.fill(0xff, 2, debutDigest - 1);
    attendu[debutDigest - 1] = 0x00;
    attendu.set(DIGEST_INFO_SHA256, debutDigest);
    attendu.set(empreinte, k - empreinte.length);
    let difference = 0;
    for (let i = 0; i < k; i++) difference |= obtenu[i] ^ attendu[i];
    return difference === 0;
}

// SHA-256 (FIPS 180-4), utilisé seulement quand Web Crypto est absent.
const K256 = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
function sha256(message) {
    const longueur = message.length;
    const total = Math.ceil((longueur + 9) / 64) * 64;
    const bloc = new Uint8Array(total);
    bloc.set(message);
    bloc[longueur] = 0x80;
    const vue = new DataView(bloc.buffer);
    vue.setUint32(total - 8, Math.floor(longueur / 0x20000000));
    vue.setUint32(total - 4, (longueur * 8) >>> 0);
    const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotd = (x, n) => (x >>> n) | (x << (32 - n));
    for (let debut = 0; debut < total; debut += 64) {
        for (let i = 0; i < 16; i++) w[i] = vue.getUint32(debut + i * 4);
        for (let i = 16; i < 64; i++) {
            const s0 = rotd(w[i - 15], 7) ^ rotd(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotd(w[i - 2], 17) ^ rotd(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (rotd(e, 6) ^ rotd(e, 11) ^ rotd(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
            const t2 = ((rotd(a, 2) ^ rotd(a, 13) ^ rotd(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const sortie = new Uint8Array(32);
    const vueSortie = new DataView(sortie.buffer);
    for (let i = 0; i < 8; i++) vueSortie.setUint32(i * 4, h[i]);
    return sortie;
}

// Jeton acceptable = bonne signature, ce monde, pas expiré.
async function jetonAcceptable(jeton) {
    const j = decouper(jeton);
    return !!j && j.contenu.v === 1 && j.contenu.monde === idMonde() && Date.now() < j.contenu.exp
        && await signatureValide(jeton);
}

// ------------------------------------------------------------------ appels au serveur
async function appeler(corps) {
    const abandon = new AbortController();
    const minuterie = setTimeout(() => abandon.abort(), DELAI_RESEAU_MS);
    try {
        const reponse = await fetch(URL_LICENCE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(corps),
            signal: abandon.signal
        });
        let donnees = {};
        try { donnees = await reponse.json(); } catch (e) { /* réponse vide */ }
        return { statut: reponse.status, ...donnees };
    } catch (e) {
        return { statut: 0, erreur: "reseau" };
    } finally {
        clearTimeout(minuterie);
    }
}

// Active ce monde avec une clé. Réservé au MJ. Renvoie { ok, erreur? }.
export async function activerLicence(cle) {
    if (!game.user?.isGM) return { ok: false, erreur: "requete" };
    const reponse = await appeler({ cle: String(cle ?? "").trim(), monde: idMonde() });
    if (reponse.jeton && await jetonAcceptable(reponse.jeton)) {
        await game.settings.set(MOD, "licenceJeton", reponse.jeton);
        return { ok: true };
    }
    return { ok: false, erreur: reponse.erreur ?? "signature" };
}

// ------------------------------------------------------------------ au démarrage
// À appeler au hook « init », après registerLicenceSettings().
export function noterEtatInitial() {
    actifAuDemarrage = licenceValide();
    return actifAuDemarrage;
}

// À appeler au hook « ready » quand le module est actif : vérifie la signature
// du jeton, puis le renouvelle si besoin (et toutes les 6 h tant que le monde reste ouvert).
export async function controlerLicence() {
    if (!(await signatureValide(jetonActuel()))) return invalider("signature");
    await renouvelerSiBesoin();
    setInterval(() => renouvelerSiBesoin(), CONTROLE_TOUTES_MS);
}

// Un seul client parle au serveur : le MJ actif (les joueurs ne le contactent jamais).
const estMjResponsable = () => !!game.user?.isGM && (game.users?.activeGM ?? game.user) === game.user;

async function renouvelerSiBesoin() {
    if (!estMjResponsable()) return;
    const j = decouper(jetonActuel());
    if (!j || Date.now() - j.contenu.iat < RENOUVELER_APRES_MS) return;
    const reponse = await appeler({ jeton: jetonActuel(), monde: idMonde() });
    if (reponse.jeton && await jetonAcceptable(reponse.jeton)) {
        await game.settings.set(MOD, "licenceJeton", reponse.jeton);
        return;
    }
    if (reponse.statut === 403) return invalider(reponse.erreur);   // refus explicite : on s'arrête
    // Serveur injoignable ou en panne : le jeton actuel reste valable jusqu'à son échéance.
    if (j.contenu.exp - Date.now() < AVERTIR_AVANT_MS) {
        ui.notifications?.warn(`Soruta — Completed Westmarch : le serveur de licence est injoignable. `
            + `Sans contact d'ici le ${new Date(j.contenu.exp).toLocaleString()}, le module s'arrêtera.`, { permanent: true });
    }
}

// Monde inactif parce que son jeton a expiré (monde resté fermé plus de 7 jours,
// ou serveur de licence en panne) : le MJ tente d'abord un renouvellement
// automatique avec l'ancien jeton, pour ne pas avoir à ressaisir sa clé.
// Renvoie true si la licence est rétablie (les clients rechargent alors seuls).
export async function renouvelerJetonExpire() {
    if (!estMjResponsable()) return false;
    const j = decouper(jetonActuel());
    if (!j || j.contenu.monde !== idMonde()) return false;
    const reponse = await appeler({ jeton: jetonActuel(), monde: idMonde() });
    if (reponse.jeton && await jetonAcceptable(reponse.jeton)) {
        await game.settings.set(MOD, "licenceJeton", reponse.jeton);
        return true;
    }
    if (reponse.statut === 403) await game.settings.set(MOD, "licenceJeton", "");   // inutile de réessayer
    return false;
}

async function invalider(code) {
    journal.info(`[${MOD}] Licence refusée : ${code}`);
    if (game.user?.isGM) {
        ui.notifications?.error(`Soruta — Completed Westmarch : ${message(code)}`, { permanent: true });
        if (estMjResponsable()) await game.settings.set(MOD, "licenceJeton", "");   // recharge tous les clients
    }
}

// ------------------------------------------------------------------ saisie de la clé (MJ)
// Ouvre la fenêtre de saisie tant que la clé n'est pas acceptée ou que le MJ n'annule pas.
export async function proposerActivation() {
    let erreur = "";
    for (;;) {
        const cle = await demanderCle(erreur);
        if (cle == null) return false;                       // annulé
        if (!cle.trim()) { erreur = "Saisis ta clé de licence."; continue; }
        const resultat = await activerLicence(cle);
        if (resultat.ok) {
            ui.notifications?.info("Licence activée. Rechargement…");
            foundry.utils.debouncedReload();
            return true;
        }
        erreur = message(resultat.erreur);
    }
}

async function demanderCle(erreur) {
    const echapper = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    try {
        return await foundry.applications.api.DialogV2.wait({
            window: { title: "Soruta — Completed Westmarch", icon: "fas fa-key" },
            content: `<p style="margin:0 0 8px;">Ce module nécessite une licence. Saisis ta clé pour l'activer sur ce monde.</p>
                      <input type="text" name="scwm-cle" style="width:100%;box-sizing:border-box;font-family:monospace;"
                             placeholder="ALT-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" autofocus>
                      ${erreur ? `<p style="margin:8px 0 0;color:#e06c6c;">${echapper(erreur)}</p>` : ""}`,
            rejectClose: false,
            buttons: [
                { action: "ok", label: "Activer", icon: "fas fa-check", default: true,
                  callback: (ev, btn) => btn.form.elements["scwm-cle"]?.value ?? "" },
                { action: "cancel", label: "Annuler", icon: "fas fa-xmark", callback: () => null }
            ]
        });
    } catch (e) { return null; }
}
