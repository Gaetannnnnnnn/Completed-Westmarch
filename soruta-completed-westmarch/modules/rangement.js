// ============================================================
// rangement.js — « Où ranger quoi ? » : guide de rangement pour les MJ
//
// Les fonctions du module ne reconnaissent un PJ, un PNJ ou une créature que
// s'ils sont rangés au bon endroit (dossiers et compendiums communs). Ce
// fichier produit, à partir des RÉGLAGES RÉELS du monde :
//   - un JOURNAL « Où ranger quoi ? (MJ) », réservé aux MJ, généré par un
//     bouton des paramètres (catégorie « Dossiers & Compendiums ») et remis à
//     jour tout seul quand les réglages concernés changent ;
//   - page 1 : le guide ; page 2 : une VÉRIFICATION de ce qui est mal rangé
//     (PJ hors du dossier des PJ, jetons non reconnus, réglages vides…).
//
// © 2026 Soruta.
// ============================================================

import { MOD } from "./const.js";

import { journal } from "./log.js";
import { tl, locale, memeNom } from "./i18n.js";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lire = (k, def = "") => { try { return game.settings.get(MOD, k); } catch { return def; } };
const actif = (k) => lire(k, false) === true;
const FLAG_GUIDE = "guideRangement";

// Réglages dont le guide dépend (le journal publié est régénéré s'ils changent).
const CLES_SUIVIES = ["commonFolderPJ", "commonFolderPNJ", "commonFolderNewChars", "commonPackPNJ", "commonPackCemetery",
    "commonPackCreatures", "commonPackCraft", "gmAutoFolderParent", "autoPlayerFolder", "relationsEnabled", "bestiaryEnabled",
    "enableCharValidation", "tmEnabled", "enableHarvest", "enableExpeditionMap", "expeditionMapSceneId", "expeditionMapSceneIds",
    "expeditionMapTemplateFolder", "mondeEnabled", "mondePackPerson", "mondePackOrg", "mondeFolderPlace"];

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
    if (!val) return `<span class="scwm-rg-ko">${tl("<i class=\"fa-solid fa-triangle-exclamation\"></i> non réglé")}</span>`;
    if (!existe) return `<span class="scwm-rg-ko">${tl("<i class=\"fa-solid fa-triangle-exclamation\"></i> « {0} » introuvable", esc(val))}</span>`;
    return `<strong>${esc(nom)}</strong>`;
}

const nomPackRegistre = (cle, defaut) => {
    const id = lire(cle);
    return id ? valeur(id, nomPack(id), !!game.packs.get(id)) : `${tl("<strong>{0}</strong> (créé au premier besoin)", esc(defaut))}`;
};

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

    section("fa-user-shield", tl("Personnages des joueurs (PJ)"), `
        <p>${tl("Dossier d'acteurs des PJ : {0} (sous-dossiers compris).", valeur(pj, nomDossier(pj), !!dossierActeurs(pj)))}</p>
        <ul>
            <li>${tl("Un PJ doit être un acteur de type <em>personnage</em> rangé dans ce dossier. <strong>C'est indispensable</strong> : les Relations et le Bestiaire ne détectent les rencontres que pour le jeton d'un PJ de ce dossier.")}</li>
            ${actif("autoPlayerFolder") ? `<li>${tl("Un sous-dossier au nom de chaque joueur y est créé automatiquement à sa première connexion : range ses PJ dedans.")}</li>` : ""}
            ${actif("enableCharValidation") ? `<li>${tl("Les personnages validés depuis le Casier sont créés dans : {0} / <em>nom du joueur</em>.", valeur(neufs, nomDossier(neufs) || neufs, true))}</li>` : ""}
            <li>${tl("Anciens PJ (morts, retraités) : compendium du cimetière {0}. Ils restent proposés dans les relations.", valeur(packCim, nomPack(packCim), !!game.packs.get(packCim)))}</li>
        </ul>`);

    section("fa-user-tie", tl("PNJ récurrents (alliés, marchands, figures importantes)"), `
        <p>${tl("Dossier d'acteurs des PNJ : {0} (sous-dossiers compris : classe-les par région, faction…).", valeur(pnj, nomDossier(pnj), !!dossierActeurs(pnj)))}</p>
        <ul>
            <li>${tl("<strong>Relations</strong> : un PNJ rangé dans ce dossier s'ajoute tout seul aux relations d'un PJ dès que son jeton est vu par ce PJ. Hors de ce dossier, il n'apparaît jamais.")}</li>
            <li>${tl("PNJ en compendium : {0}. Ils sont proposés dans l'ajout manuel d'une relation.", valeur(packPnj, nomPack(packPnj), !!game.packs.get(packPnj)))}</li>
            <li>${tl("Un PNJ à ne jamais montrer dans les relations (déguisement, espion) : bouton « Exclure » de sa fiche.")}</li>
            ${actif("mondeEnabled") ? `<li>${tl("Sa fiche du monde (Monk's) : bouton <i class=\"fa-solid fa-book-atlas\"></i> de sa fiche d'acteur ; elle est rangée dans le compendium {0}.", nomPackRegistre("mondePackPerson", tl("Registre — PNJ")))}</li>` : ""}
        </ul>`);

    section("fa-dragon", tl("Créatures et monstres"), `
        <p>${tl("Compendium des créatures : {0}.", valeur(packCrea, nomPack(packCrea), !!game.packs.get(packCrea)))}</p>
        <ul>
            <li>${tl("<strong>Bestiaire</strong> : une créature s'ajoute au bestiaire d'un PJ quand il la voit, à condition d'être <strong>importée depuis ce compendium</strong> (glisser-déposer depuis le compendium vers la scène ou les acteurs).")}</li>
            <li>${tl("Une créature fabriquée à la main n'est reconnue que si elle porte <strong>exactement</strong> le nom d'une entrée du compendium. Sinon, ajoute-la d'abord au compendium.")}</li>
            <li>${tl("Ne range pas une créature dans le dossier des PNJ : elle apparaîtrait dans les relations au lieu du bestiaire.")}</li>
            ${actif("enableHarvest") ? `<li>${tl("Récolte : crée tes RollTables, puis associe-les aux créatures (par type ou par nom) avec le bouton « Associations » de la barre WestMarch.")}</li>` : ""}
        </ul>`, actif("bestiaryEnabled") || !!packCrea);

    if (actif("mondeEnabled")) {
        section("fa-book-atlas", tl("Lieux, PNJ et organisations (registre du monde)"), `
            <ul>
                <li>${tl("Fiches PNJ : compendium {0}. Fiches d'organisations : compendium {1}. Ils ne sont chargés qu'à la demande (onglet Monde, « Rédiger ») et n'alourdissent pas la connexion. Pour y écrire, ils doivent être déverrouillés.", nomPackRegistre("mondePackPerson", tl("Registre — PNJ")), nomPackRegistre("mondePackOrg", tl("Registre — Organisations")))}</li>
                <li>${tl("Fiches de lieux : dossier de journaux <strong>{0}</strong> du monde (une épingle de carte ne peut pas pointer vers un compendium).", esc(lire("mondeFolderPlace", tl("Lieux"))))}</li>
                <li>${tl("Un lieu = une fiche « Lieu » de Monk's + <strong>une épingle sur la carte du monde</strong> (bouton « Placer sur la carte » de « Rédiger la fiche », puis clic sur la carte à l'emplacement du lieu). Sans épingle, le lieu n'est jamais découvert par les joueurs.")}</li>
                <li>${tl("Rédiger : onglet « Monde » du Casier, ou clic droit sur le journal → « Rédiger la fiche ».")}</li>
            </ul>`);
    }

    if (actif("enableExpeditionMap")) {
        const ids = [...new Set([lire("expeditionMapSceneId"), ...(lire("expeditionMapSceneIds", []) || [])].filter(Boolean))];
        const cartes = ids.map(id => game.scenes.get(id)?.name).filter(Boolean);
        const modele = lire("expeditionMapTemplateFolder");
        section("fa-map", tl("Carte des expéditions"), `
            <ul>
                <li>${tl("Carte(s) du monde : {0}.", cartes.length ? cartes.map(n => `<strong>${esc(n)}</strong>`).join(", ") : valeur("", ""))}</li>
                <li>${tl("Jetons de groupe : copie le jeton modèle « Token à copier et rennomer »{0}, renomme-le, puis mets-y les PJ du groupe.", modele ? ` (dossier ${valeur(modele, nomDossier(modele), !!dossierActeurs(modele))})` : "")}</li>
            </ul>`);
    }

    if (actif("tmEnabled")) {
        section("fa-hammer", tl("Objets craftables (temps morts)"), `
            <p>${tl("Compendium d'objets : {0}. Un objet fabriqué n'est ajouté automatiquement que s'il se trouve dans ce compendium.", valeur(packCraft, nomPack(packCraft), !!game.packs.get(packCraft)))}</p>`);
    }

    const parent = lire("gmAutoFolderParent");
    if (parent) {
        section("fa-folder-tree", tl("Dossiers personnels des MJ"), `
            <p>${tl("À la connexion de chaque MJ, un sous-dossier à son nom est créé dans <strong>{0}</strong> (Acteurs, Journaux et Scènes) : c'est là qu'il range ses préparations. Ce qui doit être <em>reconnu</em> par le module (PNJ récurrents, créatures) va quand même dans les dossiers ci-dessus.", esc(parent))}</p>`);
    }

    return `<div class="scwm-rg-guide">
        <p>${tl("<em>Page générée à partir des réglages du module (Paramètres → Dossiers &amp; Compendiums). Elle se met à jour toute seule.</em>")}</p>
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
    if (!lire("commonFolderPJ")) ajouter("ko", tl("Le dossier des PJ n'est pas réglé : ni les Relations ni le Bestiaire ne peuvent détecter de rencontre."));
    else if (!pj) ajouter("ko", tl("Le dossier des PJ « {0} » n'existe plus.", lire("commonFolderPJ")));
    if (actif("relationsEnabled") && !lire("commonFolderPNJ")) ajouter("ko", tl("Le dossier des PNJ n'est pas réglé : aucun PNJ n'apparaîtra dans les relations."));
    else if (lire("commonFolderPNJ") && !pnj) ajouter("ko", tl("Le dossier des PNJ « {0} » n'existe plus.", lire("commonFolderPNJ")));
    if (actif("bestiaryEnabled") && !game.packs.get(packCrea)) ajouter("ko", tl("Le compendium des créatures n'est pas réglé ou introuvable : le bestiaire ne reconnaîtra aucune créature."));

    // PJ de joueurs rangés hors du dossier des PJ.
    if (pj) {
        const hors = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner && !dansDossier(a, pj));
        if (hors.length) ajouter("ko", tl("{0} personnage(s) de joueur hors du dossier des PJ : leurs rencontres ne sont pas détectées.", hors.length),
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
        tl("{0} acteur(s) posé(s) sur une scène ne sont ni dans le dossier des PNJ ni reconnus comme créatures : ils n'apparaîtront ni dans les relations ni dans le bestiaire. Si c'est un PNJ récurrent, range-le dans le dossier des PNJ ; si c'est une créature, importe-la depuis le compendium.", inconnus.length),
        inconnus.map(x => ({ uuid: x.a.uuid, nom: x.a.name, info: tl("{0} — sur « {1} »", x.a.folder ? cheminDossier(x.a.folder) : "(racine)", x.scene.name) })));
    if (doubles.length) ajouter("attention",
        tl("{0} créature(s) rangée(s) dans le dossier des PNJ : elles apparaîtront dans les relations ET le bestiaire.", doubles.length),
        doubles.map(x => ({ uuid: x.a.uuid, nom: x.a.name, info: x.a.folder ? cheminDossier(x.a.folder) : "" })));

    // Registre du monde : lieux sans épingle, PNJ / organisations encore dans le monde.
    if (actif("mondeEnabled")) {
        const typeMej = (e) => e.pages?.contents?.[0]?.getFlag?.("monks-enhanced-journal", "type");
        const dehors = game.journal.filter(e => ["person", "organization"].includes(typeMej(e)));
        if (dehors.length) ajouter("attention", tl("{0} fiche(s) PNJ / organisation sont encore des journaux du monde (chargés à chaque connexion). Onglet Monde → « Ranger dans les compendiums ».", dehors.length),
            dehors.map(e => ({ uuid: e.uuid, nom: e.name, info: e.folder?.name ?? "" })));
        const lieux = game.journal.filter(e => e.pages?.contents?.[0]?.getFlag?.("monks-enhanced-journal", "type") === "place");
        const sansEpingle = lieux.filter(e => !game.scenes.some(s => s.notes.some(n => n.entryId === e.id)));
        if (sansEpingle.length) ajouter("attention", tl("{0} fiche(s) de lieu sans épingle sur une carte : elles ne seront jamais découvertes par les joueurs.", sansEpingle.length),
            sansEpingle.map(e => ({ uuid: e.uuid, nom: e.name, info: e.folder?.name ?? "" })));
    }
    return pbs;
}

// Vérification au format journal (liens @UUID, couleurs en ligne).
function verificationJournalHtml(pbs) {
    const date = new Date().toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
    const entete = `<p>${tl("<em>État du monde au {0} (régénéré à chaque clic sur le bouton des paramètres et à chaque changement des dossiers).</em>", esc(date))}</p>`;
    if (!pbs.length) return `${entete}<p style="color:#2e8b57;font-weight:600;">${tl("<i class=\"fa-solid fa-circle-check\"></i> Tout est bien rangé.")}</p>`;
    return entete + pbs.map(p => `
        <h3 style="color:${p.niveau === "ko" ? "#c0392b" : "#d35400"};"><i class="fa-solid ${p.niveau === "ko" ? "fa-circle-xmark" : "fa-triangle-exclamation"}"></i> ${esc(p.titre)}</h3>
        ${p.details.length ? `<ul>
            ${p.details.slice(0, 100).map(d => `<li>@UUID[${d.uuid}]{${esc(d.nom)}} — ${esc(d.info)}</li>`).join("")}
            ${p.details.length > 100 ? `<li>${tl("… et {0} autre(s)", p.details.length - 100)}</li>` : ""}
        </ul>` : ""}`).join("");
}

// ============================================================
// Journal « Où ranger quoi ? (MJ) » — généré depuis les paramètres
// (catégorie « Dossiers & Compendiums »), réservé aux MJ.
// ============================================================
export function trouverGuide() {
    return game.journal?.find(e => e.getFlag?.(MOD, FLAG_GUIDE) === true) ?? null;
}

const PAGE_GUIDE_FR = tl("Où ranger quoi ?"), PAGE_VERIF_FR = tl("Vérification du monde");
const PAGE_GUIDE = tl("Où ranger quoi ?");
const PAGE_VERIF = tl("Vérification du monde");

export async function publierGuide() {
    if (!game.user?.isGM) return null;
    const pages = [
        { name: PAGE_GUIDE, type: "text", text: { content: guideHtml() } },
        { name: PAGE_VERIF, type: "text", text: { content: verificationJournalHtml(await verifierRangement()) } }
    ];
    const existant = trouverGuide();
    if (existant) {
        const maj = [], neuves = [];
        for (const [i, pg] of pages.entries()) {
            const p = existant.pages.contents.find(x => x.name === pg.name || memeNom(x.name, [PAGE_GUIDE_FR, PAGE_VERIF_FR][i])) ?? (i === 0 ? existant.pages.contents[0] : null);
            if (p) maj.push({ _id: p.id, name: pg.name, "text.content": pg.text.content, sort: (i + 1) * 100000 });
            else neuves.push({ ...pg, sort: (i + 1) * 100000 });
        }
        if (maj.length) await existant.updateEmbeddedDocuments("JournalEntryPage", maj);
        if (neuves.length) await existant.createEmbeddedDocuments("JournalEntryPage", neuves);
        return existant;
    }
    return JournalEntry.create({
        name: tl("📌 Où ranger quoi ? (MJ)"),
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
        sort: -100000,
        flags: { [MOD]: { [FLAG_GUIDE]: true } },
        pages: pages.map((pg, i) => ({ ...pg, sort: (i + 1) * 100000 }))
    }, { renderSheet: false });
}

// Bouton des paramètres : (re)génère le journal puis l'ouvre.
export async function genererEtOuvrirGuide() {
    try {
        const deja = !!trouverGuide();
        const e = await publierGuide();
        if (!e) return null;
        ui.notifications?.info(deja ? tl("Journal « Où ranger quoi ? » mis à jour.") : tl("Journal « Où ranger quoi ? » créé (réservé aux MJ)."));
        e.sheet?.render(true);
        return e;
    } catch (err) {
        journal.avert(tl("[{0}] guide de rangement", MOD), err);
        ui.notifications?.error(tl("Échec de la génération du journal « Où ranger quoi ? »."));
        return null;
    }
}

// Bloc affiché dans la catégorie « Dossiers & Compendiums » des paramètres.
export function blocGuideReglagesHtml() {
    const guide = trouverGuide();
    return `
    <div class="scwm-rg-bloc" style="margin:10px 4px 4px;padding:8px 10px;border:1px solid rgba(201,162,39,.45);border-radius:5px;background:rgba(201,162,39,.07);">
        <div style="font-weight:600;">${tl("<i class=\"fa-solid fa-boxes-stacked\"></i> Guide « Où ranger quoi ? » pour les MJ")}</div>
        <p style="margin:3px 0 6px;font-size:.8em;color:#aaa;">${tl("Crée un journal réservé aux MJ qui explique où ranger PJ, PNJ, créatures, lieux… avec les dossiers et compendiums réglés ici, plus une vérification de ce qui est mal rangé dans le monde. Les réglages de cette fenêtre sont enregistrés avant. Le journal se met ensuite à jour tout seul quand ces réglages changent.")}</p>
        <button type="button" class="scwm-rg-generer"><i class="fa-solid fa-book"></i> ${guide ? tl("Mettre à jour et ouvrir le journal") : tl("Générer le journal")}</button>
    </div>`;
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
        t = setTimeout(() => publierGuide().catch(e => journal.avert(tl("[{0}] guide de rangement", MOD), e)), 1000);
    });
}
