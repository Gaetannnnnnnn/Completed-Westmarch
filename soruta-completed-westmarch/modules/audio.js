// ============================================================
// audio.js — Empêche certains sons globaux (jet de dés, début de
// combat / changement de tour) de traverser les parties.
// - Foundry diffuse ces sons à TOUTE la table via un point d'entrée
//   unique et documenté : foundry.audio.AudioHelper.play (méthode
//   STATIQUE, utilisée précisément quand un son doit être joué pour
//   plusieurs utilisateurs à la fois — cf doc officielle Foundry).
//   Concrètement :
//     - le son de jet de dés (ChatMessage.sound) est déclenché dès la
//       création du message, INDÉPENDAMMENT de notre filtrage
//       d'affichage du chat (chat.js, renderChatMessageHTML) qui ne
//       masque le message qu'au RENDU — le son, lui, a déjà été joué
//       avant même ce rendu, pour tout le monde.
//     - le son de thème de combat (réglage client "core.combatTheme",
//       CONFIG.Combat.sounds) est diffusé à toute la table dès qu'un
//       combat démarre ou change de tour, sans aucune notion de party.
// - Plutôt que d'essayer de gagner une course contre un hook interne
//   non documenté (comme pour Monk's TokenBar dans combat.js), on
//   intercepte directement ce point d'entrée unique : chaque "filtre"
//   enregistré ci-dessous reçoit le chemin du son qu'on est sur le
//   point de jouer et décide s'il doit être coupé pour MOI sur cet
//   appel précis (les autres clients exécutent ce même correctif
//   indépendamment, avec leur propre party).
// ============================================================

const filters = [];

// D'autres fichiers (chat.js, combat.js) s'enregistrent ici avec leur
// propre logique : (src) => bool. Si une seule renvoie true, le son
// est coupé pour le client courant.
export function registerSoundFilter(fn) {
    filters.push(fn);
}

export function AudioHooks() {
    Hooks.once("ready", () => {
        const AudioHelper = foundry.audio?.AudioHelper;
        if (!AudioHelper?.play) return;

        const original = AudioHelper.play.bind(AudioHelper);
        AudioHelper.play = function (data, socketOptions) {
            try {
                if (filters.some(fn => fn(data?.src))) {
                    return Promise.resolve(null);
                }
            } catch (e) {
                // En cas d'erreur dans un filtre, on joue le son par sécurité
                // plutôt que de risquer de couper silencieusement tous les sons.
                console.error("westmarch | audio.js : erreur dans un filtre de son", e);
            }
            return original(data, socketOptions);
        };
    });
}
