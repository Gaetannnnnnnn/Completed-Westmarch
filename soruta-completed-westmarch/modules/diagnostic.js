import { MOD } from "./const.js";
import { journal, problemesRecents, INVITATION } from "./log.js";
import { licenceValide, etatLicence } from "./licence.js";
// ============================================================
// diagnostic.js — Bouton « Diagnostic » (paramètres, MJ)
//
// Vérifie d'un coup ce qu'on demande d'habitude quand un MJ signale un
// problème : versions (Foundry, système, module), licence, modules tiers
// nécessaires aux fonctions activées, réglages essentiels (dossiers,
// compendiums, cartes, webhook), joueurs sans personnage, et les derniers
// problèmes de la session. Chaque ligne : ✅ ok, ⚠️ à surveiller, ❌ bloquant,
// ℹ️ information. Bouton « Copier » pour envoyer le résultat sur Discord.
// © 2026 Soruta.
// ============================================================

const lire = (k, def) => { try { return game.settings.get(MOD, k); } catch { return def; } };
const actif = (k) => lire(k, false) === true;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICONES = { ok: "✅", attention: "⚠️", ko: "❌", info: "ℹ️" };
const moduleActif = (id) => !!game.modules?.get(id)?.active;
function dossierActeurs(val) {
    if (!val) return null;
    return game.folders?.get(val) ?? game.folders?.find(f => f.type === "Actor" && f.name === val) ?? null;
}

export function lancerDiagnostic() {
    const sections = [];
    const section = (titre) => { const s = { titre, lignes: [] }; sections.push(s); return (etat, texte) => s.lignes.push({ etat, texte }); };

    // ---- Environnement
    const env = section("Environnement");
    const majeure = parseInt(String(game.version ?? "0").split(".")[0], 10);
    env(majeure >= 13 ? "ok" : "ko", `Foundry ${game.version ?? "?"}${majeure >= 13 ? "" : " — version trop ancienne (v13 minimum)"}`);
    env(game.system?.id === "dnd5e" ? "ok" : "ko", `Système : ${game.system?.id ?? "?"} ${game.system?.version ?? ""}${game.system?.id === "dnd5e" ? "" : " — le module est prévu pour dnd5e"}`);
    env("info", `Module Completed Westmarch ${game.modules?.get(MOD)?.version ?? "?"}`);
    env(licenceValide() ? "ok" : "ko", etatLicence());
    if (actif("moduleDeactivated")) env("ko", "Le module est désactivé (code de désactivation) : rien ne fonctionne tant qu'il n'est pas réactivé (À propos).");

    // ---- Modules tiers
    const mods = section("Modules tiers");
    const besoinMej = actif("mondeEnabled") || actif("enableMejShopFix") || actif("enableMejRestock");
    if (moduleActif("monks-enhanced-journal")) mods("ok", "Monk's Enhanced Journal : actif.");
    else mods(besoinMej ? "ko" : "info", `Monk's Enhanced Journal : absent${besoinMej ? " — nécessaire au Registre du monde et aux boutiques" : ""}.`);
    if (moduleActif("lib-wrapper")) mods("ok", "libWrapper : actif.");
    else mods(actif("enableTokenPortraitButton") ? "attention" : "info", `libWrapper : absent${actif("enableTokenPortraitButton") ? " — le bouton « Voir le portrait » ne marche que pour le propriétaire du jeton" : ""}.`);
    if (actif("rangeFixEnabled")) mods(moduleActif("midi-qol") ? "ok" : "attention", `Midi-QOL : ${moduleActif("midi-qol") ? "actif" : "absent — la correction de portée (Midi Range Fix) ne sert à rien sans lui"}.`);
    if (moduleActif("tidy5e-sheet")) mods("info", "Tidy5e : détecté (les onglets du module y sont ajoutés).");
    if (moduleActif("plutonium")) mods("info", "Plutonium : détecté.");
    mods(game.time?.calendar ? "ok" : "info", game.time?.calendar ? "Calendrier du monde : disponible (dates de jeu dans le Carnet, les Relations, le Bestiaire)." : "Pas de calendrier de jeu : les dates réelles sont utilisées.");

    // ---- Réglages essentiels
    const reg = section("Réglages");
    const pj = lire("commonFolderPJ", "");
    reg(!pj ? "ko" : dossierActeurs(pj) ? "ok" : "ko", !pj ? "Dossier des PJ : non réglé (Relations, Bestiaire, validation ne détectent rien)." : dossierActeurs(pj) ? `Dossier des PJ : « ${dossierActeurs(pj).name} ».` : `Dossier des PJ : « ${pj} » introuvable.`);
    if (actif("relationsEnabled")) {
        const pnj = lire("commonFolderPNJ", "");
        reg(!pnj ? "attention" : dossierActeurs(pnj) ? "ok" : "ko", !pnj ? "Dossier des PNJ : non réglé (aucun PNJ dans les relations)." : dossierActeurs(pnj) ? `Dossier des PNJ : « ${dossierActeurs(pnj).name} ».` : `Dossier des PNJ : « ${pnj} » introuvable.`);
    }
    if (actif("bestiaryEnabled")) {
        const pack = lire("commonPackCreatures", "");
        reg(game.packs?.get(pack) ? "ok" : "ko", game.packs?.get(pack) ? `Compendium des créatures : « ${game.packs.get(pack).title} ».` : "Compendium des créatures : non réglé ou introuvable (le bestiaire ne reconnaît rien).");
    }
    if (actif("enableExpeditionMap")) {
        const ids = [...new Set([lire("expeditionMapSceneId", ""), ...(lire("expeditionMapSceneIds", []) || [])].filter(Boolean))];
        const ok = ids.filter(id => game.scenes?.get(id));
        reg(ok.length ? (ok.length === ids.length ? "ok" : "attention") : "ko", ok.length ? `Carte des expéditions : ${ok.map(id => `« ${game.scenes.get(id).name} »`).join(", ")}${ok.length < ids.length ? ` (${ids.length - ok.length} scène(s) supprimée(s))` : ""}.` : "Carte des expéditions activée mais aucune scène valide déclarée.");
    }
    if (actif("enableDiscordLog")) {
        const url = String(lire("discordLogWebhookUrl", "") || "");
        reg(!url ? "ko" : /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(url) ? "ok" : "attention",
            !url ? "Log Discord activé mais sans URL de webhook." : /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(url) ? "Log Discord : webhook réglé." : "Log Discord : l'URL ne ressemble pas à un webhook Discord.");
        reg(actif("logModuleErrors") ? "ok" : "attention", actif("logModuleErrors") ? "Problèmes du module envoyés dans le log Discord." : "Les problèmes du module ne sont pas envoyés sur Discord (case « Problèmes du module »).");
    } else reg("info", "Log Discord désactivé : les problèmes du module ne restent que dans la console (F12).");
    if (actif("mondeEnabled") && !moduleActif("monks-enhanced-journal")) reg("ko", "Registre du monde activé sans Monk's Enhanced Journal.");

    // ---- Joueurs
    const jou = section("Joueurs");
    const joueurs = (game.users?.contents ?? [...(game.users ?? [])]).filter(u => !u.isGM);
    const sansPerso = joueurs.filter(u => !u.character);
    if (!joueurs.length) jou("info", "Aucun compte joueur.");
    else if (sansPerso.length) jou("attention", `${sansPerso.length} joueur(s) sans personnage choisi (Configuration du joueur) : ${sansPerso.map(u => u.name).join(", ")}. Leurs Relations et leur Bestiaire ne se remplissent pas.`);
    else jou("ok", `${joueurs.length} joueur(s), tous avec un personnage choisi.`);
    const dossierPj = dossierActeurs(pj);
    if (dossierPj) {
        const dans = (a) => { for (let f = a.folder; f; f = f.folder) if (f.id === dossierPj.id) return true; return false; };
        const hors = (game.actors?.contents ?? [...(game.actors ?? [])]).filter(a => a.type === "character" && a.hasPlayerOwner && !dans(a));
        if (hors.length) jou("attention", `${hors.length} personnage(s) de joueur hors du dossier des PJ : ${hors.slice(0, 8).map(a => a.name).join(", ")}${hors.length > 8 ? "…" : ""}.`);
    }

    // ---- Problèmes de la session
    const pb = section("Problèmes détectés depuis le chargement");
    if (!problemesRecents.length) pb("ok", "Aucun.");
    for (const p of problemesRecents.slice(0, 10)) pb("ko", `${p.quand} — ${p.niveau === "conflit" ? "conflit / fonction cassée" : "erreur"} : ${p.texte}${p.detail ? ` (${p.detail})` : ""}`);

    return sections;
}

export function texteDiagnostic(sections) {
    const date = new Date().toLocaleString("fr-FR");
    return [`Diagnostic Completed Westmarch — ${date} — monde « ${game.world?.title ?? "?"} »`,
        `(à joindre à un ticket sur le Discord Althéia : ${INVITATION})`,
        ...sections.flatMap(s => ["", `== ${s.titre} ==`, ...s.lignes.map(l => `${ICONES[l.etat]} ${l.texte}`)])].join("\n");
}

export async function ouvrirDiagnostic() {
    if (!game.user?.isGM) { ui.notifications?.warn("Le diagnostic est réservé au MJ."); return; }
    const uid = "scwm-diagnostic";
    const rendre = () => {
        const sections = lancerDiagnostic();
        const nb = { ko: 0, attention: 0 };
        sections.forEach(s => s.lignes.forEach(l => { if (l.etat in nb) nb[l.etat]++; }));
        const resume = nb.ko ? `❌ ${nb.ko} point(s) bloquant(s)${nb.attention ? `, ⚠️ ${nb.attention} à surveiller` : ""}` : nb.attention ? `⚠️ ${nb.attention} point(s) à surveiller` : "✅ Tout est en ordre";
        return { sections, html: `<div id="${uid}" style="max-height:65vh;overflow-y:auto;padding-right:4px;">
            <p style="margin:0 0 8px;font-weight:700;">${resume}</p>
            ${sections.map(s => `<h3 style="margin:10px 0 4px;font-size:14px;border-bottom:1px solid rgba(201,162,39,.4);">${esc(s.titre)}</h3>
                <ul style="list-style:none;margin:0;padding:0;">${s.lignes.map(l => `<li style="padding:2px 0;">${ICONES[l.etat]} ${esc(l.texte)}</li>`).join("")}</ul>`).join("")}
            <p style="margin:10px 0 0;font-size:.8em;opacity:.7;">« Copier » met ce résultat dans le presse-papiers. Pour le signaler, ouvre un ticket sur le Discord Althéia (pas de message privé, merci) : <a href="${INVITATION}" target="_blank" rel="noopener">${INVITATION}</a></p>
        </div>` };
    };
    let courant = rendre();
    await foundry.applications.api.DialogV2.wait({
        window: { title: "Diagnostic du module", icon: "fa-solid fa-stethoscope" },
        position: { width: 620 },
        rejectClose: false,
        content: courant.html,
        buttons: [
            { action: "copier", label: "Copier", icon: "fa-solid fa-copy", default: true, callback: async () => {
                const texte = texteDiagnostic(courant.sections);
                try {
                    if (game.clipboard?.copyPlainText) game.clipboard.copyPlainText(texte);
                    else await navigator.clipboard.writeText(texte);
                    ui.notifications?.info("Diagnostic copié : colle-le dans un message Discord.");
                } catch (e) { journal.avert("copie du diagnostic", e); ui.notifications?.warn("Copie impossible : sélectionne le texte à la main."); }
            } },
            { action: "fermer", label: "Fermer", icon: "fa-solid fa-xmark" }
        ]
    });
}

// Entrée dans les paramètres du module (MJ), toujours disponible, même
// sans licence : c'est justement utile quand quelque chose ne marche pas.
export function registerDiagnosticMenu() {
    try {
        game.settings.registerMenu(MOD, "menu-diagnostic", {
            name: "Diagnostic",
            label: "Lancer le diagnostic",
            hint: "Vérifie en un clic versions, licence, modules nécessaires, réglages essentiels et problèmes récents. Bouton « Copier » pour joindre le résultat à un ticket sur le Discord Althéia.",
            icon: "fas fa-stethoscope",
            type: class extends foundry.applications.api.ApplicationV2 {
                static DEFAULT_OPTIONS = { id: "scwm-menu-diagnostic", window: { title: "Diagnostic" } };
                async render() { ouvrirDiagnostic(); return this; }
                async close() { return this; }
            },
            restricted: true
        });
    } catch (e) { journal.critique("registerMenu « Diagnostic » échec :", e); }
}
