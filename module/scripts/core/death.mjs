/**
 * À 0 point de vie (règles 2024, PHB « Tomber à 0 point de vie »). Fonctions pures, aucune dépendance à Foundry.
 *
 * Ce que dnd5e 6.0.3 fait déjà, et qui n'est PAS repris ici :
 *  - l'état Inconscient à 0 PV (qui porte Neutralisé et ajoute À terre), Mort pour un PNJ ordinaire, selon le
 *    réglage « Auto-Apply Downed » (documents/actor/actor.mjs, `updateDowned`), et leur retrait quand les PV remontent —
 *    mais **en combat seulement, et pas du tout avec le réglage « none »** : le moteur le garantit partout (§17.1,
 *    `downedStatus`) ;
 *  - le jet de sauvegarde contre la mort lui-même : succès et échecs comptés, 20 naturel = 1 PV, 1 naturel = deux
 *    échecs, trois succès = compteurs remis à zéro (data/actor/templates/attributes.mjs, `applyDeathSaveResult`).
 *
 * Ce que le moteur ajoute (ici la règle, l'adaptateur l'écrit) :
 *  - « Dégâts à 0 point de vie » : un échec, deux sur un coup critique, la mort si les dégâts atteignent les PV max ;
 *  - « Mort sur le coup » : tomber à 0 PV avec un reste de dégâts au moins égal aux PV max ;
 *  - le jet contre la mort au début du tour, tant que la créature n'est ni stabilisée ni morte ;
 *  - Stabilisé après trois succès (le système remet les compteurs à zéro sans le dire), Mort après trois échecs.
 */

/** Échecs qui tuent. */
export const DEATH_FAILURES = 3;

/**
 * La créature fait-elle des jets de sauvegarde contre la mort ? Les PJ, et les PNJ que dnd5e marque « importants »
 * (les autres meurent à 0 PV, c'est le système qui le pose).
 * @param {{type: string, important?: boolean}} actor
 */
export function makesDeathSaves({ type, important=false }) {
  return (type === "character") || ((type === "npc") && important);
}

/**
 * Ce que des dégâts font à une créature du point de vue de la mort.
 * @param {object} state
 * @param {number} state.hp         PV avant les dégâts (hors PV temporaires).
 * @param {number} state.max        PV maximum.
 * @param {number} state.through    Dégâts qui passent les PV temporaires (après résistances).
 * @param {boolean} [state.critical]
 * @param {number} [state.failures] Échecs déjà subis.
 * @param {boolean} state.saves     La créature fait des jets contre la mort (`makesDeathSaves`).
 * @returns {{failures: number|null, added: number, dead: boolean, reason: "massive"|"failures"|null, unstable: boolean}}
 *   `failures` : nouveau total d'échecs à écrire (null = inchangé) ; `unstable` : une créature stabilisée ne l'est plus.
 */
export function damageAtZero({ hp, max, through, critical=false, failures=0, saves }) {
  const none = { failures: null, added: 0, dead: false, reason: null, unstable: false };
  if ( !saves || !(through > 0) || !(max > 0) ) return none;
  // Tomber à 0 : seul un reste au moins égal aux PV max tue ; sinon la créature perd connaissance (le système).
  if ( hp > 0 ) {
    const remainder = through - hp;
    return (remainder > 0) && (remainder >= max) ? { ...none, dead: true, reason: "massive" } : none;
  }
  // Déjà à 0 : des dégâts au moins égaux aux PV max tuent ; sinon un échec, deux sur un critique.
  if ( through >= max ) return { ...none, dead: true, reason: "massive", unstable: true };
  const added = critical ? 2 : 1;
  const total = Math.min(DEATH_FAILURES, failures + added);
  return { failures: total, added, dead: total >= DEATH_FAILURES, reason: total >= DEATH_FAILURES ? "failures" : null, unstable: true };
}

/**
 * L'état qu'une créature à 0 PV doit porter et ne porte pas encore (§17.1, demande de l'utilisateur 2026-09-26 : « une
 * créature à 0 PV doit obligatoirement avoir l'état Mort ; un PJ, Inconscient, Neutralisé, À terre »). Mort pour qui ne
 * fait pas de jets contre la mort ou en a raté trois ; Inconscient sinon (dnd5e y ajoute Neutralisé et À terre).
 * `regenerates` (§18.13) : « le troll ne meurt que s'il commence son tour à 0 PV sans régénérer » — Inconscient d'ici là.
 * @param {{hp: number, saves: boolean, statuses: string[], failures?: number, regenerates?: boolean}} state
 * @returns {"dead"|"unconscious"|null}
 */
export function downedStatus({ hp, saves, statuses, failures=0, regenerates=false }) {
  if ( !(hp <= 0) || statuses.includes("dead") ) return null;
  if ( (!saves && !regenerates) || (failures >= DEATH_FAILURES) ) return "dead";
  return statuses.includes("unconscious") ? null : "unconscious";
}

/**
 * La créature est-elle morte ? L'état Mort, ou 0 PV pour une créature qui ne fait pas de jets contre la mort (l'état
 * peut manquer un instant : il est posé après l'écriture des PV).
 * @param {{hp: number, saves: boolean, statuses: string[]}} state
 */
export function isDead({ hp, saves, statuses }) {
  return statuses.includes("dead") || (!saves && (hp <= 0));
}

/**
 * Faut-il un jet contre la mort au début de son tour ?
 * @param {object} state
 * @param {number} state.hp
 * @param {boolean} state.saves     `makesDeathSaves`.
 * @param {string[]} state.statuses
 * @param {number} [state.failures]
 * @param {number} [state.successes]
 */
export function needsDeathSave({ hp, saves, statuses, failures=0, successes=0 }) {
  if ( !saves || (hp > 0) ) return false;
  if ( statuses.includes("dead") || statuses.includes("stable") ) return false;
  return (failures < DEATH_FAILURES) && (successes < DEATH_FAILURES);
}

/**
 * Ce que le moteur pose après un jet contre la mort, d'après l'issue que dnd5e lui donne
 * (`dnd5e.rollDeathSave` : "stable", "death", "revive" ou null).
 * @returns {"stable"|"dead"|null}
 */
export function statusAfterDeathSave(outcome) {
  if ( outcome === "stable" ) return "stable";
  if ( outcome === "death" ) return "dead";
  return null;
}

/**
 * §50 : peut-on stabiliser cette créature (trousse de soins : « stabiliser une créature Inconsciente à 0 point de vie ») ?
 * À 0 PV, ni morte ni déjà stable.
 * @param {{hp: number, statuses: string[]}} state
 */
export function canStabilize({ hp, statuses }) {
  return (hp <= 0) && !statuses.includes("dead") && !statuses.includes("stable");
}
