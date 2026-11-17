import { MOD } from "./const.js";
import { journal } from "./log.js";
import { tl } from "./i18n.js";
// ============================================================
// enchantarme.js — Choix de l'arme pour les sorts d'enchantement
//
// Sorts concernés : ceux dont l'activité dnd5e est un « Enchantement » limité
// aux armes (True Strike, Magic Weapon, Shillelagh, Elemental Weapon…).
// Sans ce module, le joueur doit glisser son arme dans la zone « Déposer un
// objet ici » de la carte de chat, à chaque lancement : pénible pour True
// Strike, relancé à chaque tour.
//
// Mise en œuvre : hook dnd5e « postUseActivity » (chez le joueur qui lance le
// sort). On liste les armes de l'acteur que l'enchantement accepte
// (activity.canEnchant), en priorité les armes équipées :
//   - une seule arme équipée → appliquée directement ;
//   - plusieurs → petite fenêtre de choix, la dernière arme choisie pour ce
//     sort est présélectionnée (mémoire locale du navigateur).
// L'application passe par activity.applyEnchantment, exactement comme le
// glisser-déposer du système : durée, concentration, retrait automatique et
// bouton « annuler » de la carte de chat restent ceux de dnd5e.
// Avant d'appliquer, on retire l'enchantement précédent du MÊME sort sur les
// objets du même acteur (évite « Épée (True Strike) (True Strike) » si
// l'ancien n'a pas expiré).
// La zone de dépôt reste dans le chat pour enchanter un autre objet.
//
// Réglage : enableWeaponEnchantPicker (Modifications ciblées → Sorts).
// © 2026 Soruta.
// ============================================================

const CLE = "enableWeaponEnchantPicker";
const actif = () => { try { return game.settings.get(MOD, CLE) === true; } catch { return false; } };

// Mémoire « dernière arme choisie » : par acteur et par sort, dans ce navigateur.
const cleMemoire = (actor, item) =>
    `${MOD}.enchantArme.${actor.id}.${item.system?.identifier || item.name}`;
function lireMemoire(actor, item) {
    try { return localStorage.getItem(cleMemoire(actor, item)); } catch { return null; }
}
function ecrireMemoire(actor, item, armeId) {
    try { localStorage.setItem(cleMemoire(actor, item), armeId); } catch { /* navigateur privé */ }
}

// Le profil d'enchantement vise-t-il les armes à distance ? (ex. True Strike :
// profil « Ranged Weapon »). Sert uniquement à trier la liste.
function profilADistance(activity, profileId) {
    const nom = String(activity.item?.effects?.get?.(profileId)?.name ?? "");
    return /ranged|distance/i.test(nom);
}
const estADistance = (arme) => arme.system?.attackType === "ranged";

// Armes de l'acteur acceptées par cet enchantement, équipées d'abord.
function armesPossibles(activity, actor, message, aDistance) {
    const ok = actor.items.filter(i => i.type === "weapon" && activity.canEnchant(i, { chatMessage: message }) === true);
    const equipees = ok.filter(i => i.system?.equipped);
    const liste = equipees.length ? equipees : ok;
    return liste.sort((a, b) =>
        (aDistance ? estADistance(b) - estADistance(a) : estADistance(a) - estADistance(b))
        || a.name.localeCompare(b.name, game.i18n?.lang || "fr"));
}

async function choisirArme(activity, armes, defaut) {
    const esc = foundry.utils.escapeHTML;
    const lignes = armes.map(a => `
        <label style="display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer;">
            <input type="radio" name="arme" value="${a.id}" ${a.id === defaut ? "checked" : ""} style="flex-shrink:0;">
            <img src="${esc(a.img)}" alt="" width="28" height="28" style="border:none;flex-shrink:0;">
            <span>${esc(a.name)}${a.system?.equipped ? "" : ` <em style="opacity:.6;">(${tl("non équipée")})</em>`}</span>
        </label>`).join("");
    const r = await foundry.applications.api.DialogV2.wait({
        window: { title: tl("{0} — choisir l'arme", activity.item.name), icon: "fa-solid fa-wand-sparkles" },
        position: { width: 360 },
        rejectClose: false,
        content: `<p style="margin:0 0 6px;">${tl("Quelle arme reçoit l'enchantement ?")}</p>${lignes}
            <p style="margin:6px 0 0;font-size:12px;opacity:.75;">${tl("« Plus tard » : la zone de dépôt reste disponible dans le chat.")}</p>`,
        buttons: [
            { action: "ok", label: tl("Enchanter"), icon: "fa-solid fa-check", default: true,
              callback: (_e, bouton) => bouton.form?.elements?.arme?.value ?? null },
            { action: "plusTard", label: tl("Plus tard"), icon: "fa-solid fa-hand" }
        ]
    }).catch(() => null);
    return (r && r !== "plusTard") ? r : null;
}

async function proposer(activity, usageConfig, results) {
    const message = results?.message;
    const actor = activity.actor;
    const profileId = usageConfig?.enchantmentProfile ?? message?.getFlag?.("dnd5e", "use.enchantmentProfile");
    if (!message || !actor || !profileId) return;

    // Concentration : comme le glisser-déposer, on rattache l'enchantement à
    // l'effet de concentration du lancement.
    const concentrationId = message.system?.concentration;
    const concentration = concentrationId ? actor.effects.get(concentrationId) : undefined;
    if (concentrationId && !concentration) return;

    const armes = armesPossibles(activity, actor, message, profilADistance(activity, profileId));
    if (!armes.length) return;   // rien à proposer : la zone de dépôt du chat reste là

    let armeId;
    const equipees = armes.filter(a => a.system?.equipped);
    if (equipees.length === 1 && armes.length === 1) armeId = armes[0].id;
    else {
        const memo = lireMemoire(actor, activity.item);
        const defaut = armes.some(a => a.id === memo) ? memo : armes[0].id;
        armeId = await choisirArme(activity, armes, defaut);
    }
    const arme = armeId ? actor.items.get(armeId) : null;
    if (!arme) return;
    ecrireMemoire(actor, activity.item, arme.id);

    // Retire l'enchantement précédent de CE sort sur les objets de cet acteur.
    const anciens = (globalThis.dnd5e?.registry?.enchantments?.applied?.(activity.uuid) ?? [])
        .filter(e => e?.parent?.actor?.id === actor.id && e.isOwner);
    for (const e of anciens) {
        try { await e.delete({ chatMessageOrigin: message.id }); } catch { /* déjà supprimé */ }
    }

    const ench = await activity.applyEnchantment(profileId, arme, { chatMessage: message, concentration });
    if (ench) ui.notifications?.info(tl("{0} : enchantement appliqué sur {1}.", activity.item.name, arme.name));
}

export function EnchantArmeHooks() {
    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
        if (!actif()) return;
        if (activity?.type !== "enchant" || activity.enchant?.self) return;
        if (activity.restrictions?.type !== "weapon") return;
        proposer(activity, usageConfig, results)
            .catch(e => journal.erreur(tl("[{0}] Choix de l'arme à enchanter :", MOD), e));
    });
}
