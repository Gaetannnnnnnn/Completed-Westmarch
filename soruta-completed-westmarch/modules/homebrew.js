// ============================================================
// homebrew.js — Source homebrew pour Plutonium (index local du serveur)
//
// Le module fournit la source homebrew 5etools « West Marches - Contenu
// personnalisé » (homebrew/westmarch-perso.json), avec le background
// « Origine personnalisée ».
//
// Méthode retenue : l'INDEX HOMEBREW LOCAL de Plutonium. Le fichier est servi
// par le serveur dans Data/assets/homebrew/, listé dans index.json, et
// Plutonium le charge pour tout le monde (option « Load Local Homebrew
// Index »), sans réglage chez les joueurs. L'ancienne méthode (coller
// l'adresse du fichier dans « Additional Homebrew Files ») ne marchait que
// pour ceux qui l'avaient ajoutée eux-mêmes : elle n'est plus proposée.
//
// Menu des réglages « Contenu homebrew (Plutonium) » (MJ) : marche à suivre
// avec les commandes à copier, et un bouton qui vérifie ce que le serveur sert.
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";

const FICHIER = "westmarch-perso.json";
const SOURCE_JSON = "WestMarchesPerso";
const route = (p) => foundry.utils?.getRoute?.(p) ?? `/${p}`;
const adresse = (p) => new URL(route(p), window.location.origin).href;

async function copyText(text) {
    if (game.clipboard?.copyPlainText) return game.clipboard.copyPlainText(text);
    return navigator.clipboard.writeText(text);
}

// Teste ce que le serveur sert : index.json, puis le fichier homebrew.
async function verifier() {
    const lignes = [];
    let ok = true;
    try {
        const r = await fetch(route("assets/homebrew/index.json"), { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const liste = (await r.json())?.toImport ?? [];
        if (liste.includes(FICHIER)) lignes.push(`✅ ${tl("index.json trouvé, il liste {0}.", FICHIER)}`);
        else { ok = false; lignes.push(`❌ ${tl("index.json trouvé, mais {0} n'est pas dans « toImport ».", FICHIER)}`); }
    } catch (e) {
        ok = false;
        lignes.push(`❌ ${tl("Pas d'index.json lisible à {0} ({1}).", adresse("assets/homebrew/index.json"), e.message)}`);
    }
    try {
        const r = await fetch(route(`assets/homebrew/${FICHIER}`), { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const src = d?._meta?.sources?.[0]?.json;
        const nb = (d?.background ?? []).length;
        if (src === SOURCE_JSON) lignes.push(`✅ ${tl("{0} servi : source {1}, {2} background(s).", FICHIER, src, nb)}`);
        else { ok = false; lignes.push(`❌ ${tl("{0} servi, mais ce n'est pas la source {1}.", FICHIER, SOURCE_JSON)}`); }
    } catch (e) {
        ok = false;
        lignes.push(`❌ ${tl("{0} introuvable dans assets/homebrew ({1}).", FICHIER, e.message)}`);
    }
    const plutonium = game.modules.get("plutonium")?.active;
    lignes.push(plutonium ? `✅ ${tl("Plutonium est actif.")}` : `⚠️ ${tl("Plutonium n'est pas actif sur ce monde.")}`);
    await foundry.applications.api.DialogV2.prompt({
        window: { title: tl("Vérification du contenu homebrew"), icon: "fa-solid fa-stethoscope" },
        content: `<p style="margin:0;">${lignes.join("<br>")}</p><p style="margin:8px 0 0;">${ok
            ? tl("Côté serveur, tout est en place. Il reste à cocher « Load Local Homebrew Index » dans la Config de Plutonium, puis à recharger.")
            : tl("Reprends les étapes 1 et 2, puis vérifie de nouveau.")}</p>`,
        ok: { label: tl("Fermer") }, rejectClose: false
    }).catch(() => {});
}

export async function openHomebrewDialog() {
    if (!game.user.isGM) return;
    const esc = foundry.utils.escapeHTML;
    const lien = `mkdir -p <Data>/assets/homebrew\nln -sf <Data>/modules/${MOD}/homebrew/${FICHIER} <Data>/assets/homebrew/${FICHIER}`;
    const index = `{\n  "toImport": [\n    "${FICHIER}"\n  ]\n}`;
    const bloc = (cls, texte) => `<div style="position:relative;">
        <pre class="${cls}" style="margin:2px 0 0;padding:6px 8px;padding-right:80px;font-size:11px;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,.25);border-radius:4px;">${esc(texte)}</pre>
        <button type="button" data-copie="${cls}" style="position:absolute;top:4px;right:4px;width:auto;line-height:1;padding:3px 6px;font-size:11px;"><i class="fa-solid fa-copy"></i> ${tl("Copier")}</button></div>`;
    const content = `
    <div style="display:flex;flex-direction:column;gap:8px;padding:2px 0;font-size:13px;">
        <p style="margin:0;">${tl("Le background « Origine personnalisée » est fourni comme source homebrew pour Plutonium. Pour qu'il apparaisse chez <strong>tous les joueurs</strong>, le serveur doit le servir dans son index homebrew local. À faire une seule fois par serveur, par SSH ou SFTP.")}</p>
        <p style="margin:0;font-size:12px;opacity:.85;">${tl("<code>&lt;Data&gt;</code> = le dossier de données de Foundry, celui qui contient <code>modules/</code> et <code>worlds/</code>.")}</p>
        <div><strong>1.</strong> ${tl("Créer le dossier et y placer un lien vers le fichier du module (il suivra les mises à jour du module) :")}${bloc("scwm-hb-lien", lien)}</div>
        <div><strong>2.</strong> ${tl("Créer <code>&lt;Data&gt;/assets/homebrew/index.json</code> avec ce contenu :")}${bloc("scwm-hb-index", index)}</div>
        <div><strong>3.</strong> ${tl("Config de Plutonium (MJ) : cocher <strong>Load Local Homebrew Index</strong>, retirer l'ancienne adresse de <strong>Additional Homebrew Files</strong> si elle y est, puis recharger.")}</div>
        <div><strong>4.</strong> ${tl("Si la World Content Blocklist contient une ligne qui bloque les backgrounds de toutes les sources (<code>* / Background / *</code>), la retirer.")}</div>
        <div><strong>5.</strong> ${tl("Contrôle des sources du module : si la liste des joueurs est remplie, y ajouter <code>{0}</code>.", SOURCE_JSON)}</div>
        <p style="margin:0;font-size:12px;opacity:.85;">${tl("Foundry refuse l'envoi de .json depuis son navigateur de fichiers : il faut passer par le serveur. Si le lien ne marche pas chez ton hébergeur, copie simplement le fichier à la place (à refaire après une mise à jour du module).")}</p>
    </div>`;

    const choix = await foundry.applications.api.DialogV2.wait({
        window:      { title: tl("Contenu homebrew (Plutonium)"), icon: "fa-solid fa-book" },
        position:    { width: 600 },
        rejectClose: false,
        content,
        render: () => {
            document.querySelectorAll("[data-copie]").forEach(b => b.addEventListener("click", async (e) => {
                e.preventDefault();
                const texte = document.querySelector(`.${b.dataset.copie}`)?.textContent ?? "";
                try { await copyText(texte); ui.notifications.info(tl("Copié dans le presse-papiers.")); }
                catch (err) {
                    journal.avert(tl("[{0}] Copie impossible", MOD), err);
                    ui.notifications.warn(tl("Copie impossible : sélectionne le texte et copie-le à la main (Ctrl+C)."));
                }
            }));
        },
        buttons: [
            { action: "verifier", label: tl("Vérifier ce serveur"), icon: '<i class="fa-solid fa-stethoscope"></i>' },
            { action: "close", label: tl("Fermer"), icon: '<i class="fa-solid fa-xmark"></i>', default: true }
        ]
    }).catch(() => null);
    if (choix === "verifier") await verifier();
}

export function HomebrewHooks() {
    try {
        game.settings.registerMenu(MOD, "menu-homebrew", {
            name:  tl("Contenu homebrew (Plutonium)"),
            label: tl("Installer / vérifier"),
            hint:  tl("Marche à suivre pour servir la source homebrew du module (background « Origine personnalisée ») à tous les joueurs via l'index homebrew local de Plutonium, et vérification du serveur."),
            icon:  "fas fa-book",
            type:  class extends foundry.applications.api.ApplicationV2 {
                static DEFAULT_OPTIONS = { id: "scwm-menu-homebrew", window: { title: tl("Contenu homebrew (Plutonium)") } };
                async render() { openHomebrewDialog(); return this; }
                async close()  { return this; }
            },
            restricted: true
        });
    } catch (e) {
        journal.critique(tl("[{0}] registerMenu « Contenu homebrew » échec :", MOD), e);
    }
}
