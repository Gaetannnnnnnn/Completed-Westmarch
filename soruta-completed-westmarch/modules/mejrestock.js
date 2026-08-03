import { MOD } from "./const.js";
// ============================================================
// mejrestock.js — Réapprovisionnement automatique des boutiques MEJ
//
// Quand un article tombe à 0 en boutique (Monk's Enhanced Journal)
// ET que la case "auto" est cochée par le GM, un timer est lancé
// (en jours de calendrier). Au bout du délai, l'article repasse
// automatiquement à 1.
//
// Le décompte restant est affiché en petit et en grisé sous la
// quantité dans la vue boutique, avec une case à cocher par article.
//
// Paramètre : "Réapprovisionnement automatique des boutiques (jours)"
//   → 0 = fonctionnalité désactivée
//
// Stockage :
//   page.flags[MOD]["restock"]        = { itemId: worldTimeExpiry }
//   page.flags[MOD]["restockEnabled"] = { itemId: true/false }
// ============================================================

// IDs des pages en cours de mise à jour par westmarch — évite la récursion
// dans le hook updateJournalEntryPage sans dépendre des options Foundry.
const _restockingPages = new Set();

// Retourne le nombre de secondes dans un jour de calendrier.
// Utilise le calendrier natif Foundry v13 si disponible, sinon 86400.
function getSecondsPerDay() {
    try {
        const cal = game.time?.calendar;
        if (!cal) return 86400;
        if (cal.secondsPerDay) return cal.secondsPerDay;
        const t = cal.time ?? {};
        return (t.hoursInDay ?? 24) * (t.minutesInHour ?? 60) * (t.secondsInMinute ?? 60);
    } catch(e) {
        return 86400;
    }
}

const _raritySettingKey = {
    "common":    "shopRestockDaysCommon",
    "uncommon":  "shopRestockDaysUncommon",
    "rare":      "shopRestockDaysRare",
    "veryrare":  "shopRestockDaysVeryRare",
    "legendary": "shopRestockDaysLegendary",
};

function getRestockDays(rarity = "") {
    const norm = String(rarity).toLowerCase().replace(/[\s_-]/g, "");
    const key  = _raritySettingKey[norm];
    if (key) {
        // Valeur spécifique à la rareté : 0 = désactivé pour cette rareté (pas de fallback global).
        return game.settings.get(MOD, key) ?? 0;
    }
    // Pas de rareté reconnue → fallback global. 0 = pas de fallback.
    return game.settings.get(MOD, "shopRestockDays") ?? 0;
}

function getItemRarity(item) {
    // MEJ copie la rareté soit directement sur l'item, soit dans system.rarity
    return item?.rarity ?? item?.system?.rarity ?? "";
}

// ============================================================
export function MejRestockHooks() {

    // ----------------------------------------------------------
    // 1. Détecter le passage à 0 lors d'une mise à jour de page
    //    (déclenché quand MEJ enregistre un achat)
    //    Le timer ne démarre QUE si la case "auto" est cochée.
    // ----------------------------------------------------------
    Hooks.on("updateJournalEntryPage", async (page, change, options, userId) => {
        if (!game.user.isGM) return;
        // Un seul GM traite l'évènement
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;
        // Éviter la récursion : on ignore les updates posées par westmarch lui-même
        if (_restockingPages.has(page.id)) return;

        if (page.flags?.["monks-enhanced-journal"]?.type !== "shop") return;

        // Vérification globale : feature désactivée par la case à cocher
        if (!game.settings.get(MOD, "enableMejRestock")) return;

        const items   = page.flags?.["monks-enhanced-journal"]?.items ?? {};
        const timers  = foundry.utils.deepClone(page.flags?.[MOD]?.restock        ?? {});
        const enabled = page.flags?.[MOD]?.restockEnabled ?? {};
        const spd     = getSecondsPerDay();
        let   changed = false;

        for (const [itemId, item] of Object.entries(items)) {
            const qty = item.flags?.["monks-enhanced-journal"]?.quantity ?? 1;

            if (qty === 0 && !(itemId in timers) && enabled[itemId]) {
                // Démarrer le timer seulement si la case est cochée
                const itemDays = getRestockDays(getItemRarity(item));
                if (itemDays <= 0) continue; // rareté désactivée
                timers[itemId] = game.time.worldTime + itemDays * spd;
                changed = true;
                console.log(`westmarch | MejRestock : timer lancé pour "${item.name}" (${itemDays} j)`);
            } else if (qty > 0 && (itemId in timers)) {
                // Remis en stock manuellement → annuler le timer
                delete timers[itemId];
                changed = true;
                console.log(`westmarch | MejRestock : timer annulé pour "${item.name}" (remis manuellement)`);
            }
        }

        if (changed) {
            _restockingPages.add(page.id);
            try {
                await page.update({ "flags.toolkit.restock": timers });
            } finally {
                _restockingPages.delete(page.id);
            }
        }
    });

    // ----------------------------------------------------------
    // 2. Vérifier les timers expirés à chaque avancement du temps
    // ----------------------------------------------------------
    Hooks.on("updateWorldTime", async (worldTime) => {
        if (!game.user.isGM) return;
        const activeGM = game.users.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return;

        if (!game.settings.get(MOD, "enableMejRestock")) return;

        for (const journal of game.journal.contents) {
            for (const page of journal.pages.contents) {
                if (page.flags?.["monks-enhanced-journal"]?.type !== "shop") continue;

                const timers = page.flags?.[MOD]?.restock ?? {};
                if (Object.keys(timers).length === 0) continue;

                const newTimers  = foundry.utils.deepClone(timers);
                const updates    = {};
                let   anyExpired = false;

                for (const [itemId, restockAt] of Object.entries(timers)) {
                    if (worldTime < restockAt) continue;

                    // Remettre à 1
                    updates[`flags.monks-enhanced-journal.items.${itemId}.flags.monks-enhanced-journal.quantity`] = 1;
                    delete newTimers[itemId];
                    anyExpired = true;

                    const itemName = page.flags?.["monks-enhanced-journal"]?.items?.[itemId]?.name ?? itemId;
                    console.log(`westmarch | MejRestock : réapprovisionnement de "${itemName}" dans "${journal.name}"`);
                }

                if (anyExpired) {
                    _restockingPages.add(page.id);
                    try {
                        await page.update({ "flags.toolkit.restock": newTimers, ...updates });
                    } finally {
                        _restockingPages.delete(page.id);
                    }
                }
            }
        }
    });

    // ----------------------------------------------------------
    // 3. Afficher la case "auto" et le décompte dans la vue boutique.
    //
    //    Problème de timing MEJ : au moment où renderApplicationV2
    //    fire, l'items-list n'est pas encore dans l'élément (MEJ
    //    la rend en asynchrone). On pose un MutationObserver sur
    //    l'élément app entier et on injecte dès que les items
    //    apparaissent (debounce 50 ms). Filet à 1,5 s en backup.
    // ----------------------------------------------------------
    Hooks.on("renderApplicationV2", (application, element) => {
        if (!game.settings.get(MOD, "enableMejRestock")) return;

        // MEJ stocke l'ID de la page courante dans application.options.pageId
        // (application.document est undefined dans EnhancedJournal)
        const pageId = application.options?.pageId;
        if (!pageId) return;

        // Vérifier que c'est bien une page de type shop
        let shopType = false;
        for (const journal of game.journal.contents) {
            const p = journal.pages.get(pageId);
            if (p) {
                shopType = foundry.utils.getProperty(p, "flags.monks-enhanced-journal.type") === "shop";
                break;
            }
        }
        if (!shopType) return;

        // ----------------------------------------------------------
        // Injection : case à cocher "auto" + décompte si timer actif
        // Relit les flags à chaque appel pour avoir des données fraîches.
        // ----------------------------------------------------------
        function injectRestockUI() {
            let pg = null;
            for (const journal of game.journal.contents) {
                const p = journal.pages.get(pageId);
                if (p) { pg = p; break; }
            }
            if (!pg) return;

            const currentTimers  = pg.getFlag(MOD, "restock")        ?? {};
            const currentEnabled = pg.getFlag(MOD, "restockEnabled")  ?? {};
            const spd = getSecondsPerDay();
            const now = game.time.worldTime;

            element.querySelectorAll(".items-list .item[data-id]").forEach(row => {
                const itemId = row.dataset.id;
                if (!itemId) return;
                if (row.querySelector(".wm-restock-toggle")) return; // déjà injecté

                const qtyDiv     = row.querySelector(".item-detail.item-quantity");
                const controlsDiv = row.querySelector(".item-controls")
                    ?? row.querySelector("[data-action='delete']")?.parentElement
                    ?? row.querySelector("[data-action='edit']")?.parentElement;
                if (!qtyDiv && !controlsDiv) return;

                const isEnabled = !!currentEnabled[itemId];

                // ---- Bouton icône dans les contrôles (style identique aux autres) ----
                const btn = document.createElement("a");
                btn.className = "item-control wm-restock-toggle";
                btn.title     = isEnabled ? "Réapprovisionnement auto : activé" : "Réapprovisionnement auto : désactivé";
                btn.style.cssText = isEnabled
                    ? "color:#4db6ac; cursor:pointer;"
                    : "color:#888; cursor:pointer;";
                btn.innerHTML = '<i class="fa-solid fa-rotate"></i>';

                if (controlsDiv) controlsDiv.prepend(btn);
                else row.appendChild(btn);

                // ---- Décompte sous la quantité si timer actif ----
                const restockAt = currentTimers[itemId];
                if (restockAt !== undefined && qtyDiv) {
                    const daysLeft = Math.ceil((restockAt - now) / spd);
                    const span     = document.createElement("span");
                    span.className = "wm-restock-countdown";
                    span.style.cssText = "color:#888; font-size:0.7em; font-style:italic; display:block; line-height:1.2; white-space:nowrap; text-align:center;";
                    span.textContent   = daysLeft <= 0 ? "réapro imminent" : `dans ${daysLeft} j`;
                    qtyDiv.appendChild(span);
                }

                // ---- Gestion du clic ----
                btn.addEventListener("click", async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    let freshPg = null;
                    for (const j of game.journal.contents) { const p = j.pages.get(pageId); if (p) { freshPg = p; break; } }
                    if (!freshPg) return;

                    const nowEnabled = !!((freshPg.getFlag(MOD, "restockEnabled") ?? {})[itemId]);
                    const newEnabled = foundry.utils.deepClone(freshPg.getFlag(MOD, "restockEnabled") ?? {});
                    newEnabled[itemId] = !nowEnabled;
                    const updates = { "flags.toolkit.restockEnabled": newEnabled };

                    // Mise à jour visuelle immédiate du bouton
                    btn.style.color = newEnabled[itemId] ? "#4db6ac" : "#888";
                    btn.title       = newEnabled[itemId] ? "Réapprovisionnement auto : activé" : "Réapprovisionnement auto : désactivé";

                    if (!newEnabled[itemId]) {
                        // Désactivé → supprimer le timer via clé explicite (évite le merge Foundry)
                        updates[`flags.toolkit.restock.${itemId}`] = null;
                        row.querySelector(".wm-restock-countdown")?.remove();
                    } else {
                        // Activé → si l'article est à 0, (re)lancer le timer (overwrite si existant)
                        const mejItems = freshPg.getFlag("monks-enhanced-journal", "items") ?? {};
                        const itemData = mejItems[itemId];
                        const qty      = itemData?.flags?.["monks-enhanced-journal"]?.quantity ?? 1;
                        if (qty === 0) {
                            const days = getRestockDays(getItemRarity(itemData));
                            updates[`flags.toolkit.restock.${itemId}`] = game.time.worldTime + days * getSecondsPerDay();
                            if (qtyDiv) {
                                const existing = row.querySelector(".wm-restock-countdown");
                                if (existing) {
                                    existing.textContent = `dans ${days} j`;
                                } else {
                                    const s = document.createElement("span");
                                    s.className     = "wm-restock-countdown";
                                    s.style.cssText = "color:#888; font-size:0.7em; font-style:italic; display:block; line-height:1.2; white-space:nowrap; text-align:center;";
                                    s.textContent   = `dans ${days} j`;
                                    qtyDiv.appendChild(s);
                                }
                            }
                        }
                    }

                    _restockingPages.add(freshPg.id);
                    try { await freshPg.update(updates); }
                    finally { _restockingPages.delete(freshPg.id); }
                });
            });
        }

        let debounceTimer = null;
        let safetyTimer   = null;
        const observer = new MutationObserver(() => {
            if (!element.querySelector(".items-list .item[data-id]")) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                observer.disconnect();
                clearTimeout(safetyTimer);
                injectRestockUI();
            }, 50);
        });
        observer.observe(element, { childList: true, subtree: true });
        safetyTimer = setTimeout(() => {
            observer.disconnect();
            clearTimeout(debounceTimer);
            injectRestockUI();
        }, 1500);
    });
}
