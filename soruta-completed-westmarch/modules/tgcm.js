import { MOD } from "./const.js";
// ============================================================
// tgcm.js — "Protégé TGCM" : token immunisé à la mort
//
// Un token marqué "Protégé TGCM" ne peut jamais passer à 0 PV :
// tout dégât qui l'amènerait à 0 ou moins le laisse à 1 PV.
// Les dégâts s'affichent normalement côté joueurs, l'ennemi reste
// debout — idéal pour les mises en scène dramatiques.
//
// Fonctionnement :
//   • Bouton "Protégé TGCM" dans le HUD du token (GM uniquement).
//   • Indicateur visuel : bouclier doré centré au-dessus du token
//     (rendu uniquement sur le client GM).
//   • Hook preUpdateActor : si les PV résultants seraient ≤ 0 et
//     que le token est protégé, on les force à 1 avant l'écriture.
//
// Le flag est posé sur le TokenDocument (pas sur l'acteur), ce qui
// permet de protéger une instance précise sans affecter l'acteur lié.
// ============================================================

export function TgcmHooks() {

    // ---- Bouton HUD (GM uniquement) ----
    Hooks.on("renderTokenHUD", (hud, html) => {
        _injectTgcmButton(hud, html);
    });

    // ---- Indicateur visuel : bouclier au-dessus du token (GM uniquement) ----
    Hooks.on("drawToken", (token) => {
        _refreshTgcmShield(token);
    });

    Hooks.on("refreshToken", (token) => {
        _refreshTgcmShield(token);
    });

    // ---- Carte chat Midi QOL : masquage HP + floating text dégâts ----
    // renderChatMessageHTML (v13) fire sur TOUS les clients.
    // Midi QOL stocke l'uuid sous la forme "ActorXXXX" (sans le point),
    // fromUuidSync échoue → on extrait l'ID et on passe par game.actors.get().
    // Le vrai montant est dans data-hp-total (dnd5e clamp déjà à 0 avant update).
    Hooks.on("renderChatMessageHTML", (message, html) => {
        html.querySelectorAll(".midi-qol-dmg-row[data-actor-uuid]").forEach(row => {
            const uuid = row.dataset.actorUuid;
            if (!uuid) return;
            // Résolution acteur : fromUuidSync puis fallback game.actors
            let actor = null;
            try { actor = fromUuidSync(uuid); } catch(e) {}
            if (!actor) {
                // Midi QOL : "ActorXXXX" → retirer le préfixe "Actor" (avec ou sans point)
                const id = uuid.replace(/^Actor\.?/, "");
                actor = game.actors.get(id) ?? null;
            }
            if (!actor) {
                // Dernier recours : chercher via token sur la scène active
                const tokenId = uuid.match(/Token\.([^.]+)/)?.[1];
                if (tokenId) actor = canvas.tokens?.placeables?.find(t => t.id === tokenId)?.actor ?? null;
            }
            if (!actor || !_isActorProtected(actor)) return;
            // Masquer la ligne HP
            row.style.display = "none";
            // Afficher les dégâts réels en floating text
            const damage = parseInt(row.querySelector("[data-hp-total]")?.dataset?.hpTotal ?? "0");
            if (damage > 0) setTimeout(() => _showTgcmDamageFloat(actor, damage), 150);
        });
    });

    // ---- Interception des dégâts (pré-update) ----
    // Clamp HP à 1 avant écriture → players ne voient jamais 1→0.
    // L'affichage est géré dans renderChatMessage (tous les clients).
    Hooks.on("preUpdateActor", (actor, changes, options) => {
        const newHP = changes?.system?.attributes?.hp?.value;
        if (newHP === undefined || newHP >= 1) return;
        if (!_isActorProtected(actor)) return;
        changes.system.attributes.hp.value = 1;
        options.diff = false;
    });
}

// ============================================================
// Helpers
// ============================================================

function _injectTgcmButton(hud, html) {
    if (!game.user.isGM) return;

    // v13 ApplicationV2 : hud.document | v12 : hud.object.document | fallback : hud.token
    const tokenDoc = hud.document ?? hud.object?.document ?? hud.token ?? null;
    if (!tokenDoc) return;

    const isActive = tokenDoc.getFlag(MOD, "tgcm") ?? false;

    // Normaliser en HTMLElement
    const root = (html instanceof HTMLElement) ? html : (html[0] ?? null);
    if (!root) return;

    // Éviter le doublon si le hook fire deux fois
    if (root.querySelector(".tgcm-btn")) return;

    // Trouver le bon conteneur — essayer plusieurs sélecteurs
    const target =
        root.querySelector(".col.right") ??
        root.querySelector(".controls-right") ??
        root.querySelector(".right") ??
        root;

    const btn = document.createElement("div");
    btn.className = `control-icon tgcm-btn${isActive ? " active" : ""}`;
    btn.title = `Protégé TGCM${isActive ? " (actif)" : ""}`;
    btn.innerHTML = `<i class="fa-solid fa-shield-alt"></i>`;

    btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = tokenDoc.getFlag(MOD, "tgcm") ?? false;
        await tokenDoc.setFlag(MOD, "tgcm", !current);
        hud.render();
    });

    target.appendChild(btn);
}

function _showTgcmDamageFloat(actor, damage) {
    if (!canvas?.interface) return;
    const placeables = canvas.tokens?.placeables ?? [];
    const tokens = actor.token
        ? [placeables.find(t => t.document === actor.token)]
        : placeables.filter(t => t.actor?.id === actor.id);
    for (const token of tokens) {
        if (!token?.center) continue;
        canvas.interface.createScrollingText(token.center, `-${damage}`, {
            anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
            duration: 2000,
            fill: 0xff0000,
            fontSize: 36,
            stroke: 0x000000,
            strokeThickness: 4,
            jitter: 0.25
        });
    }
}

function _isActorProtected(actor) {
    // Acteur synthétique (token non-lié) : actor.token pointe directement au TokenDocument
    if (actor.token) {
        return actor.token.getFlag(MOD, "tgcm") ?? false;
    }
    // Acteur lié : parcourir tous les tokens de la scène courante
    return (canvas?.tokens?.placeables ?? [])
        .filter(t => t.actor?.id === actor.id)
        .some(t => t.document?.getFlag(MOD, "tgcm") ?? false);
}

function _refreshTgcmShield(token) {
    if (token._tgcmShield) {
        token._tgcmShield.destroy({ children: true });
        token._tgcmShield = null;
    }

    if (!game.user.isGM) return;
    if (!token.document?.getFlag(MOD, "tgcm")) return;

    // Dessine un petit bouclier héraldique vectoriel (pas d'emoji)
    // Forme : pentagone pointu en bas — w=7, h=9 → badge ~14×18 px
    const g = new PIXI.Graphics();
    const w = 4, h = 5;

    // Bouclier minimaliste — fond doré
    g.beginFill(0xf1c40f, 0.95);
    g.lineStyle(1, 0x000000, 0.5);
    g.drawPolygon([-w, -h,  w, -h,  w, 0,  0, h,  -w, 0]);
    g.endFill();

    // Centré en haut du token
    g.x = token.w / 2;
    g.y = h;

    token.addChild(g);
    token._tgcmShield = g;
}
