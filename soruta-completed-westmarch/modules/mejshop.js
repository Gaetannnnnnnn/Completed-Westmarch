import { MOD } from "./const.js";
// ============================================================
// Correctifs pour les boutiques de Monk's Enhanced Journal (MEJ),
// module tiers — on ne touche jamais à ses fichiers, tout passe
// par des hooks de rendu côté westmarch.
// ============================================================
export function MejShopHooks() {

    // ------------------------------------------------------------
    // FIX 1 : bouton "Groupe uniquement" dans la fenêtre "Show to
    // Players" (fenêtre native de Foundry, juste patchée par MEJ
    // pour ajouter le menu "Show As"). Cette fenêtre n'a aucune
    // sélection rapide "ma party" — seulement Select All/Deselect
    // All — d'où la fenêtre énorme à décocher joueur par joueur.
    // Réutilise exactement la logique partyId déjà utilisée dans
    // image.js ("Show Party").
    // ------------------------------------------------------------
    Hooks.on("renderApplicationV2", (application, element) => {
        if (!game.user.isGM) return;
        if (!game.settings.get(MOD, "enableMejShopFix")) return;

        const classes = application.options?.classes ?? [];
        const isShowDialog = classes.includes("journal-show-dialog")
            || element.classList?.contains("journal-show-dialog")
            || !!element.querySelector?.(".journal-show-dialog");
        if (!isShowDialog) return;

        // La fenêtre se positionne parfois trop haut (top négatif) et/ou
        // plus haute que l'écran dès qu'il y a beaucoup de joueurs sur le
        // serveur : son en-tête (la seule zone qui permet de la déplacer)
        // se retrouve hors écran, et tout le contenu ne rentre pas. On la
        // recale dans l'écran et on rend son contenu scrollable.
        element.style.top = "5vh";
        element.style.maxHeight = "90vh";
        const windowContent = element.querySelector(".window-content");
        if (windowContent) {
            windowContent.style.maxHeight = "calc(90vh - 40px)";
            windowContent.style.overflowY = "auto";
        }

        if (element.querySelector(".party-only-show")) return;

        const checkboxes = element.querySelectorAll('[name="players"]');
        if (checkboxes.length === 0) return;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("party-only-show");
        btn.style.marginLeft = "4px";
        btn.textContent = "Groupe uniquement";
        btn.addEventListener("click", () => {
            const myPartyId = game.user.getFlag(MOD, "partyId");
            let matched = 0;
            checkboxes.forEach(cb => {
                const user = game.users.get(cb.value);
                const inMyParty = !!(user && myPartyId && user.getFlag(MOD, "partyId") === myPartyId);
                cb.checked = inMyParty;
                if (inMyParty) matched++;
            });
            if (matched === 0) {
                ui.notifications.warn("Aucun membre de la party connecté.");
            }
        });

        // On pose le bouton juste à côté du premier des deux boutons
        // natifs Select All/Deselect All s'ils existent, sinon juste
        // avant la liste des joueurs.
        const nativeBtn = element.querySelector('[data-action="selectAll"], [data-action="deselectAll"]');
        if (nativeBtn) {
            nativeBtn.after(btn);
        } else {
            const firstCheckboxContainer = checkboxes[0].closest("li, div, .form-group") ?? checkboxes[0];
            firstCheckboxContainer.before(btn);
        }
    });

    // ------------------------------------------------------------
    // FIX 2 : les objets marqués "cachés" dans une boutique MEJ
    // restent visibles aux joueurs. Bug confirmé dans le code
    // source actuel de MEJ (EnhancedJournalSheet.getItemGroups) :
    // il teste "item.hide" (jamais défini) au lieu de "item.hidden"
    // (le champ réellement utilisé par la coche "cacher l'objet"),
    // donc son propre filtre ne retire jamais rien. On corrige ça
    // uniquement côté affichage joueur, sans toucher à MEJ.
    //
    // Approche : on remonte au JournalEntry via plusieurs stratégies
    // (ApplicationV2 : application.document ; V1 : application.object ;
    // fallback UUID depuis les options), on collecte tous les item-ids
    // marqués hidden dans toutes les pages shop, et on retire les lignes
    // [data-id] correspondantes. MutationObserver + setTimeout couvrent
    // les cas où MEJ charge ses items de manière asynchrone.
    // ------------------------------------------------------------
    const _hideMejItems = (application, element) => {
        if (game.user.isGM) return;
        if (!game.settings.get(MOD, "enableMejShopFix")) return;

        // Bail silencieux si l'élément ne contient pas d'items [data-id] :
        // cette fenêtre n'est pas une boutique MEJ (Players, Chat, etc.).
        if (!element.querySelector?.("[data-id]")) return;

        // ── Stratégie 1 : ApplicationV2 (document) ou V1 (object).
        let journal = null;
        const doc = application.document ?? application.object ?? null;
        if (doc instanceof JournalEntry)     journal = doc;
        else if (doc instanceof JournalEntryPage) journal = doc.parent;

        // ── Stratégie 2 : propriétés MEJ spécifiques.
        //    MEJ peut stocker le journal dans journalEntry, options.document,
        //    object.document, object.journalEntry, options.entity (API v10), etc.
        if (!journal) {
            const candidates = [
                application.journalEntry,
                application.options?.journalEntry,
                application.options?.document,
                application.options?.entity,
                application.object?.document,
                application.object?.journalEntry,
            ];
            for (const c of candidates) {
                if (c instanceof JournalEntry)     { journal = c; break; }
                if (c instanceof JournalEntryPage) { journal = c.parent; break; }
            }
        }

        // ── Stratégie 3 : UUID dans les options.
        if (!journal) {
            const uuid = application.options?.uuid
                ?? application.options?.document?.uuid
                ?? application.uuid
                ?? null;
            if (uuid) {
                try {
                    const parsed = fromUuidSync(uuid);
                    if (parsed instanceof JournalEntry)     journal = parsed;
                    else if (parsed instanceof JournalEntryPage) journal = parsed.parent;
                } catch(_) {}
            }
        }

        // ── Stratégie 4 : data-journal-id dans l'élément.
        if (!journal) {
            const jid = element.dataset?.journalId
                ?? element.closest?.("[data-journal-id]")?.dataset?.journalId
                ?? null;
            if (jid) journal = game.journal.get(jid);
        }

        if (!journal) {
            // Log détaillé pour aider le diagnostic : montre les clés disponibles
            // sur l'application et ses options pour trouver la bonne propriété MEJ.
            console.debug(
                "[toolkit] _hideMejItems — JournalEntry introuvable\n",
                "  constructor :", application.constructor?.name,
                "\n  options keys:", Object.keys(application.options ?? {}),
                "\n  object type :", application.object?.constructor?.name ?? typeof application.object,
                "\n  document type:", application.document?.constructor?.name ?? typeof application.document,
            );
            return;
        }

        // ── Collecter tous les ids cachés des pages shop de ce journal.
        const hiddenIds = new Set();
        for (const page of journal.pages.contents) {
            const mejType = foundry.utils.getProperty(page, "flags.monks-enhanced-journal.type");
            if (mejType !== "shop") continue;
            const rawItems = page.getFlag("monks-enhanced-journal", "items") ?? [];
            const arr = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);

            // Log diagnostic : montre la structure réelle des items MEJ pour
            // identifier le nom du champ (hidden vs hide vs autre).
            console.debug(
                `[toolkit] _hideMejItems — page shop "${page.name}" :`,
                `${arr.length} item(s),`,
                "premier item :", arr[0] ? JSON.stringify(arr[0]).slice(0, 200) : "(aucun)"
            );

            // MEJ stocke les items comme objets Foundry bruts : l'identifiant
            // est sur i._id (pas i.id qui est undefined sur un plain object).
            // On accepte hidden ET hide pour couvrir toutes les versions de MEJ.
            arr.forEach(i => {
                const itemId = i._id ?? i.id;
                if ((i?.hidden || i?.hide) && itemId) hiddenIds.add(itemId);
            });
        }

        if (!hiddenIds.size) {
            console.debug("[toolkit] _hideMejItems — aucun item caché dans", journal.name);
            return;
        }
        console.debug("[toolkit] _hideMejItems — ids cachés :", [...hiddenIds]);

        // ── Retirer les rows du DOM.
        const _removeHidden = (root) => {
            let count = 0;
            root.querySelectorAll("[data-id]").forEach(row => {
                if (hiddenIds.has(row.dataset.id)) { row.remove(); count++; }
            });
            if (count) console.debug(`[toolkit] _hideMejItems — ${count} item(s) retiré(s) du DOM`);
        };

        _removeHidden(element);

        // ── Fallback pour les items chargés de façon asynchrone par MEJ.
        // Deux temps : 150 ms (rechargement rapide) et 800 ms (rechargement lent).
        setTimeout(() => _removeHidden(element), 150);
        setTimeout(() => _removeHidden(element), 800);

        // ── MutationObserver : couvre les mutations après les timeouts
        //    (ex. MEJ qui re-render la liste sur scroll ou filtre).
        const observer = new MutationObserver(() => _removeHidden(element));
        observer.observe(element, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 5000);
    };

    // MEJ ApplicationV2
    Hooks.on("renderApplicationV2", (application, element) => {
        _hideMejItems(application, element);
    });

    // MEJ ApplicationV1 (html = jQuery)
    Hooks.on("renderApplication", (application, html, _data) => {
        const element = html instanceof jQuery ? html[0] : (html instanceof Element ? html : null);
        if (element) _hideMejItems(application, element);
    });
}
