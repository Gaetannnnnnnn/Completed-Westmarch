// ============================================================
// rangement.js — « Où ranger quoi ? » : guide de rangement pour les MJ
//
// Les fonctions du module ne reconnaissent un PJ, un PNJ ou une créature que
// s'ils sont rangés au bon endroit (dossiers et compendiums communs). Ce
// fichier produit, à partir des RÉGLAGES RÉELS du monde :
//   - un guide lisible (onglet « Rangement » du Casier), toujours à jour ;
//   - une VÉRIFICATION : ce qui est mal rangé dans le monde (PJ hors du dossier
//     des PJ, jetons de PNJ ou de créatures non reconnus, réglages vides…) ;
//   - un JOURNAL « Où ranger quoi ? (MJ) », réservé aux MJ, publié à la demande
//     et remis à jour tout seul quand les réglages concernés changent.
//
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lire = (k, def = "") => { try { return game.settings.get(MOD, k); } catch { return def; } };
const actif = (k) => lire(k, false) === true;
const FLAG_GUIDE = "guideRangement";

// Réglages dont le guide dépend (le journal publié est régénéré s'ils changent).
const CLES_SUIVIES = ["commonFolderPJ", "commonFolderPNJ", "commonFolderNewChars", "commonPackPNJ", "commonPackCemetery",
    "commonPackCreatures", "commonPackCraft", "gmAutoFolderParent", "autoPlayerFolder", "relationsEnabled", "bestiaryEnabled",
    "enableCharValidation", "tmEnabled", "enableHarvest", "enableExpeditionMap", "expeditionMapSceneId", "expeditionMapSceneIds",
    "expeditionMapTemplateFolder", "mondeEnabled", "mondeFolderPerson", "mondeFolderPlace", "mondeFolderOrg"];

// ---- Résolution des réglages (id ou nom) ----------------------------------
function dossierActeurs(val) {
    if (!val) return null;
    return game.folders.get(val) ?? game.folders.find(f => f.type === "Actor" && f.name === val) ?? null;
}
const nomDossier = (val) => { const f = dossierActeurs(val); return f ? cheminDossier(f) : (val || ""); };
function cheminDossier(f) {
    const parts = [];
    for (let x = f; x; x = x.folder) parts.unshift(x.name);
    return parts.join(" / ");
}
const nomPack = (id) => (id ? (game.packs.get(id)?.title ?? game.packs.get(id)?.metadata?.label ?? id) : "");
function dansDossier(actor, folder) {
    if (!folder) return false;
    for (let f = actor?.folder; f; f = f.folder) if (f.id === folder.id) return true;
    return false;
}

// Valeur affichée d'un réglage : nom en gras, ou alerte s'il est vide / introuvable.
function valeur(val, nom, existe = true) {
    if (!val) return `<span class="scwm-rg-ko"><i class="fa-solid fa-triangle-exclamation"></i> non réglé</span>`;
    if (!existe) return `<span class="scwm-rg-ko"><i class="fa-solid fa-triangle-exclamation"></i> « ${esc(val)} » introuvable</span>`;
    return `<strong>${esc(nom)}</strong>`;
}

// ============================================================
// Le guide (HTML, sans la vérification)
// ============================================================
export function guideHtml() {
    const pj = lire("commonFolderPJ"), pnj = lire("commonFolderPNJ"), neufs = lire("commonFolderNewChars");
    const packPnj = lire("commonPackPNJ"), packCim = lire("commonPackCemetery"), packCrea = lire("commonPackCreatures"), packCraft = lire("commonPackCraft");
    const sections = [];
    const section = (icone, titre, corps, on = true) => {
        if (!on) return;
        sections.push(`<h2><i class="fa-solid ${icone}"></i> ${titre}</h2>${corps}`);
    };

    section("fa-user-shield", "Personnages des joueurs (PJ)", `
        <p>Dossier d'acteurs des PJ : ${valeur(pj, nomDossier(pj), !!dossierActeurs(pj))} (sous-dossiers compris).</p>
        <ul>
            <li>Un PJ doit être un acteur de type <em>personnage</em> rangé dans ce dossier. <strong>C'est indispensable</strong> : les Relations et le Bestiaire ne détectent les rencontres que pour le jeton d'un PJ de ce dossier.</li>
            ${actif("autoPlayerFolder") ? `<li>Un sous-dossier au nom de chaque joueur y est créé automatiquement à sa première connexion : range ses PJ dedans.</li>` : ""}
            ${actif("enableCharValidation") ? `<li>Les personnages validés depuis le Casier sont créés dans : ${valeur(neufs, nomDossier(neufs) || neufs, true)} / <em>nom du joueur</em>.</li>` : ""}
            <li>Anciens PJ (morts, retraités) : compendium du cimetière ${valeur(packCim, nomPack(packCim), !!game.packs.get(packCim))}. Ils restent proposés dans les relations.</li>
        </ul>`);

    section("fa-user-tie", "PNJ récurrents (alliés, marchands, figures importantes)", `
        <p>Dossier d'acteurs des PNJ : ${valeur(pnj, nomDossier(pnj), !!dossierActeurs(pnj))} (sous-dossiers compris : classe-les par région, faction…).</p>
        <ul>
            <li><strong>Relations</strong> : un PNJ rangé dans ce dossier s'ajoute tout seul aux relations d'un PJ dès que son jeton est vu par ce PJ. Hors de ce dossier, il n'apparaît jamais.</li>
            <li>PNJ en compendium : ${valeur(packPnj, nomPack(packPnj), !!game.packs.get(packPnj))}. Ils sont proposés dans l'ajout manuel d'une relation.</li>
            <li>Un PNJ à ne jamais montrer dans les relations (déguisement, espion) : bouton « Exclure » de sa fiche.</li>
            ${actif("mondeEnabled") ? `<li>Sa fiche du monde (Monk's) : bouton <i class="fa-solid fa-book-atlas"></i> de sa fiche d'acteur ; elle est rangée dans le dossier de journaux <strong>${esc(lire("mondeFolderPerson", "PNJ"))}</strong>.</li>` : ""}
        </ul>`);

    section("fa-dragon", "Créatures et monstres", `
        <p>Compendium des créatures : ${valeur(packCrea, nomPack(packCrea), !!game.packs.get(packCrea))}.</p>
        <ul>
            <li><strong>Bestiaire</strong> : une créature s'ajoute au bestiaire d'un PJ quand il la voit, à condition d'être <strong>importée depuis ce compendium</strong> (glisser-déposer depuis le compendium vers la scène ou les acteurs).</li>
            <li>Une créature fabriquée à la main n'est reconnue que si elle porte <strong>exactement</strong> le nom d'une entrée du compendium. Sinon, ajoute-la d'abord au compendium.</li>
            <li>Ne range pas une créature dans le dossier des PNJ : elle apparaîtrait dans les relations au lieu du bestiaire.</li>
            ${actif("enableHarvest") ? `<li>Récolte : crée tes RollTables, puis associe-les aux créatures (par type ou par nom) avec le bouton « Associations » de la barre WestMarch.</li>` : ""}
        </ul>`, actif("bestiaryEnabled") || !!packCrea);

    if (actif("mondeEnabled")) {
        section("fa-book-atlas", "Lieux, PNJ et organisations (registre du monde)", `
            <ul>
                <li>Fiches Monk's rangées dans les dossiers de journaux <strong>${esc(lire("mondeFolderPerson", "PNJ"))}</strong>, <strong>${esc(lire("mondeFolderPlace", "Lieux"))}</strong> et <strong>${esc(lire("mondeFolderOrg", "Organisations"))}</strong> (créés au besoin).</li>
                <li>Un lieu = une fiche « Lieu » de Monk's + <strong>une épingle sur la carte du monde</strong> (bouton « Placer sur la carte » de « Rédiger la fiche »). Sans épingle, le lieu n'est jamais découvert par les joueurs.</li>
                <li>Rédiger : onglet « Monde » du Casier, ou clic droit sur le journal → « Rédiger la fiche ».</li>
            </ul>`);
    }

    if (actif("enableExpeditionMap")) {
        const ids = [...new Set([lire("expeditionMapSceneId"), ...(lire("expeditionMapSceneIds", []) || [])].filter(Boolean))];
        const cartes = ids.map(id => game.scenes.get(id)?.name).filter(Boolean);
        const modele = lire("expeditionMapTemplateFolder");
        section("fa-map", "Carte des expéditions", `
            <ul>
                <li>Carte(s) du monde : ${cartes.length ? cartes.map(n => `<strong>${esc(n)}</strong>`).join(", ") : valeur("", "")}.</li>
                <li>Jetons de groupe : copie le jeton modèle « Token à copier et rennomer »${modele ? ` (dossier ${valeur(modele, nomDossier(modele), !!dossierActeurs(modele))})` : ""}, renomme-le, puis mets-y les PJ du groupe.</li>
            </ul>`);
    }

    if (actif("tmEnabled")) {
        section("fa-hammer", "Objets craftables (temps morts)", `
            <p>Compendium d'objets : ${valeur(packCraft, nomPack(packCraft), !!game.packs.get(packCraft))}. Un objet fabriqué n'est ajouté automatiquement que s'il se trouve dans ce compendium.</p>`);
    }

    const parent = lire("gmAutoFolderParent");
    if (parent) {
        section("fa-folder-tree", "Dossiers personnels des MJ", `
            <p>À la connexion de chaque MJ, un sous-dossier à son nom est créé dans <strong>${esc(parent)}</strong> (Acteurs, Journaux et Scènes) : c'est là qu'il range ses préparations. Ce qui doit être <em>reconnu</em> par le module (PNJ récurrents, créatures) va quand même dans les dossiers ci-dessus.</p>`);
    }

    return `<div class="scwm-rg-guide">
        <p><em>Page générée à partir des réglages du module (Paramètres → Dossiers &amp; Compendiums). Elle se met à jour toute seule.</em></p>
        ${sections.join("\n")}
    </div>`;
}

// ============================================================
// Vérification du monde
// ============================================================
async function indexCreatures() {
    const pack = game.packs.get(lire("commonPackCreatures"));
    if (!pack) return null;
    try { return new Set((await pack.getIndex()).map(e => e.name)); } catch { return null; }
}
function estCreature(actor, packId, noms) {
    if (!packId) return false;
    if (actor.pack === packId) return true;
    const src = actor._stats?.compendiumSource ?? actor.getFlag?.("core", "sourceId") ?? "";
    if (typeof src === "string" && src.startsWith(`Compendium.${packId}.`)) return true;
    return !!noms?.has(actor.name);
}

export async function verifierRangement() {
    const pbs = [];   // { niveau: "ko"|"attention", titre, details: [] }
    const ajouter = (niveau, titre, details = []) => pbs.push({ niveau, titre, details });

    const pj = dossierActeurs(lire("commonFolderPJ"));
    const pnj = dossierActeurs(lire("commonFolderPNJ"));
    const packCrea = lire("commonPackCreatures");
    if (!lire("commonFolderPJ")) ajouter("ko", "Le dossier des PJ n'est pas réglé : ni les Relations ni le Bestiaire ne peuvent détecter de rencontre.");
    else if (!pj) ajouter("ko", `Le dossier des PJ « ${lire("commonFolderPJ")} » n'existe plus.`);
    if (actif("relationsEnabled") && !lire("commonFolderPNJ")) ajouter("ko", "Le dossier des PNJ n'est pas réglé : aucun PNJ n'apparaîtra dans les relations.");
    else if (lire("commonFolderPNJ") && !pnj) ajouter("ko", `Le dossier des PNJ « ${lire("commonFolderPNJ")} » n'existe plus.`);
    if (actif("bestiaryEnabled") && !game.packs.get(packCrea)) ajouter("ko", "Le compendium des créatures n'est pas réglé ou introuvable : le bestiaire ne reconnaîtra aucune créature.");

    // PJ de joueurs rangés hors du dossier des PJ.
    if (pj) {
        const hors = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner && !dansDossier(a, pj));
        if (hors.length) ajouter("ko", `${hors.length} personnage(s) de joueur hors du dossier des PJ : leurs rencontres ne sont pas détectées.`,
            hors.map(a => ({ uuid: a.uuid, nom: a.name, info: a.folder ? cheminDossier(a.folder) : "(racine)" })));
    }

    // Jetons non-PJ posés sur les scènes, ni PNJ (dossier) ni créature reconnue.
    const noms = await indexCreatures();
    const vus = new Map();
    for (const scene of game.scenes) {
        for (const t of scene.tokens) {
            const a = t.actor;
            if (!a || a.hasPlayerOwner || a.type === "group" || vus.has(a.id)) continue;
            const base = game.actors.get(a.id) ?? a;
            const estPnj = pnj && dansDossier(base, pnj);
            const estCrea = estCreature(base, packCrea, noms);
            if (estPnj && estCrea) vus.set(a.id, { a: base, scene, pb: "double" });
            else if (!estPnj && !estCrea && !base.getFlag?.(MOD, "excludedFromRelations")) vus.set(a.id, { a: base, scene, pb: "inconnu" });
            else vus.set(a.id, null);
        }
    }
    const inconnus = [...vus.values()].filter(x => x?.pb === "inconnu");
    const doubles = [...vus.values()].filter(x => x?.pb === "double");
    if (inconnus.length) ajouter("attention",
        `${inconnus.length} acteur(s) posé(s) sur une scène ne sont ni dans le dossier des PNJ ni reconnus comme créatures : ils n'apparaîtront ni dans les relations ni dans le bestiaire. Si c'est un PNJ récurrent, range-le dans le dossier des PNJ ; si c'est une créature, importe-la depuis le compendium.`,
        inconnus.map(x => ({ uuid: x.a.uuid, nom: x.a.name, info: `${x.a.folder ? cheminDossier(x.a.folder) : "(racine)"} — sur « ${x.scene.name} »` })));
    if (doubles.length) ajouter("attention",
        `${doubles.length} créature(s) rangée(s) dans le dossier des PNJ : elles apparaîtront dans les relations ET le bestiaire.`,
        doubles.map(x => ({ uuid: x.a.uuid, nom: x.a.name, info: x.a.folder ? cheminDossier(x.a.folder) : "" })));

    // Registre du monde : lieux sans épingle.
    if (actif("mondeEnabled")) {
        const lieux = game.journal.filter(e => e.pages?.contents?.[0]?.getFlag?.("monks-enhanced-journal", "type") === "place");
        const sansEpingle = lieux.filter(e => !game.scenes.some(s => s.notes.some(n => n.entryId === e.id)));
        if (sansEpingle.length) ajouter("attention", `${sansEpingle.length} fiche(s) de lieu sans épingle sur une carte : elles ne seront jamais découvertes par les joueurs.`,
            sansEpingle.map(e => ({ uuid: e.uuid, nom: e.name, info: e.folder?.name ?? "" })));
    }
    return pbs;
}

function verificationHtml(pbs) {
    if (!pbs.length) return `<p class="scwm-rg-ok"><i class="fa-solid fa-circle-check"></i> Tout est bien rangé.</p>`;
    return pbs.map(p => `
        <div class="scwm-rg-pb scwm-rg-${p.niveau}">
            <div><i class="fa-solid ${p.niveau === "ko" ? "fa-circle-xmark" : "fa-triangle-exclamation"}"></i> ${esc(p.titre)}</div>
            ${p.details.length ? `<details><summary>Voir la liste (${p.details.length})</summary><ul>
                ${p.details.slice(0, 100).map(d => `<li><a class="scwm-rg-ouvrir" data-uuid="${esc(d.uuid)}">${esc(d.nom)}</a> <span style="opacity:.7;">— ${esc(d.info)}</span></li>`).join("")}
                ${p.details.length > 100 ? `<li>… et ${p.details.length - 100} autre(s)</li>` : ""}
            </ul></details>` : ""}
        </div>`).join("");
}

const STYLE = `<style>
    .scwm-rg h2 { font-size: 15px; margin: 14px 0 4px; border-bottom: 1px solid rgba(201,162,39,.35); }
    .scwm-rg-ko { color: #e58f8f; font-weight: 600; }
    .scwm-rg-ok { color: #7fd1a0; font-weight: 600; }
    .scwm-rg-pb { margin: 6px 0; padding: 6px 8px; border-radius: 5px; font-size: 13px; }
    .scwm-rg-pb.scwm-rg-ko { background: rgba(192,57,43,.12); border: 1px solid rgba(192,57,43,.45); color: inherit; font-weight: 400; }
    .scwm-rg-pb.scwm-rg-attention { background: rgba(230,126,34,.10); border: 1px solid rgba(230,126,34,.45); }
    .scwm-rg-pb summary { cursor: pointer; margin-top: 3px; opacity: .85; }
    .scwm-rg a.scwm-rg-ouvrir { cursor: pointer; }
</style>`;

// ============================================================
// Onglet « Rangement » du Casier
// ============================================================
export function ongletRangementHtml() {
    const guide = trouverGuide();
    return `${STYLE}
    <div class="scwm-casier-detail scwm-rg">
        <h2 style="font-size:18px;"><i class="fa-solid fa-boxes-stacked"></i> Où ranger quoi ?</h2>
        <div class="scwm-reg-toolbar" style="flex-wrap:wrap;gap:6px;">
            <button type="button" class="scwm-rg-publier"><i class="fa-solid fa-book"></i> ${guide ? "Ouvrir le journal « Où ranger quoi ? »" : "Publier dans les journaux (MJ)"}</button>
            <button type="button" class="scwm-rg-verifier"><i class="fa-solid fa-magnifying-glass"></i> Revérifier</button>
            <button type="button" class="scwm-rg-reglages"><i class="fa-solid fa-gear"></i> Régler les dossiers</button>
        </div>
        <h2><i class="fa-solid fa-stethoscope"></i> Vérification du monde</h2>
        <div class="scwm-rg-verif"><p style="opacity:.7;"><i class="fa-solid fa-spinner fa-spin"></i> Vérification en cours…</p></div>
        ${guideHtml()}
    </div>`;
}

export function cablerOngletRangement(root, rerendre) {
    const box = root?.querySelector(".scwm-rg");
    if (!box) return;
    const sortie = box.querySelector(".scwm-rg-verif");
    const verifier = async () => {
        if (sortie) sortie.innerHTML = `<p style="opacity:.7;"><i class="fa-solid fa-spinner fa-spin"></i> Vérification en cours…</p>`;
        try { if (sortie) sortie.innerHTML = verificationHtml(await verifierRangement()); }
        catch (e) { console.warn(`[${MOD}] vérification du rangement`, e); if (sortie) sortie.innerHTML = `<p class="scwm-rg-ko">Échec de la vérification.</p>`; }
    };
    verifier();
    box.querySelector(".scwm-rg-verifier")?.addEventListener("click", verifier);
    box.querySelector(".scwm-rg-publier")?.addEventListener("click", async () => {
        const e = trouverGuide() ?? await publierGuide();
        e?.sheet?.render(true);
        rerendre?.();
    });
    box.querySelector(".scwm-rg-reglages")?.addEventListener("click", () => {
        try { new (game.settings.menus.get(`${MOD}.menu-commonFolderPJ`)?.type)().render(true); }
        catch { ui.notifications?.info("Paramètres du jeu → Configurer les modules → Soruta — Completed Westmarch → Dossiers & Compendiums."); }
    });
    box.addEventListener("click", async (ev) => {
        const a = ev.target.closest("a.scwm-rg-ouvrir");
        if (!a) return;
        ev.preventDefault();
        (await fromUuid(a.dataset.uuid))?.sheet?.render(true);
    });
}

// ============================================================
// Journal « Où ranger quoi ? (MJ) »
// ============================================================
export function trouverGuide() {
    return game.journal?.find(e => e.getFlag?.(MOD, FLAG_GUIDE) === true) ?? null;
}

export async function publierGuide() {
    if (!game.user?.isGM) return null;
    const contenu = guideHtml();
    const existant = trouverGuide();
    if (existant) {
        const page = existant.pages.contents[0];
        if (page) await page.update({ "text.content": contenu });
        else await existant.createEmbeddedDocuments("JournalEntryPage", [{ name: existant.name, type: "text", text: { content: contenu } }]);
        return existant;
    }
    return JournalEntry.create({
        name: "📌 Où ranger quoi ? (MJ)",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
        sort: -100000,
        flags: { [MOD]: { [FLAG_GUIDE]: true } },
        pages: [{ name: "Où ranger quoi ?", type: "text", text: { content: contenu } }]
    });
}

// Journal publié : régénéré (MJ actif, différé) quand un réglage suivi change.
export function RangementHooks() {
    let t = null;
    Hooks.on("updateSetting", (setting) => {
        if (!game.user?.isGM || !trouverGuide()) return;
        const actifGM = game.users.activeGM;
        if (actifGM && actifGM.id !== game.user.id) return;
        const cle = String(setting?.key ?? "");
        if (!CLES_SUIVIES.some(k => cle === `${MOD}.${k}`)) return;
        clearTimeout(t);
        t = setTimeout(() => publierGuide().catch(e => console.warn(`[${MOD}] guide de rangement`, e)), 1000);
    });
}
