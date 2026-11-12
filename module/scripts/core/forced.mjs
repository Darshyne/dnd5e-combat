/**
 * §408 (issue #44, lot 1) : ce qu'un joueur a passé outre en confirmant la fenêtre de légalité. Pur : aucune dépendance à Foundry.
 */

/**
 * Les raisons vraiment passées outre. « Utiliser ma Réaction » hors de son tour (une attaque d'opportunité) règle les soucis de budget :
 * ce n'est pas forcer. Les autres raisons (portée, état, vue…) restent passées outre. Doublons retirés, ordre gardé.
 * @param {object} choice
 * @param {string[]} choice.lines         Toutes les raisons de la fenêtre.
 * @param {string[]} [choice.budgetLines] Celles qui viennent du budget du tour (tour, action dépensée…).
 * @param {string} choice.action          Le bouton choisi : "go", "reaction", autre (renoncé).
 * @returns {string[]}  vide quand rien n'a été passé outre.
 */
export function forcedReasons({ lines, budgetLines=[], action }) {
  if ( (action !== "go") && (action !== "reaction") ) return [];
  const skip = (action === "reaction") ? new Set(budgetLines) : new Set();
  return [...new Set((lines ?? []).filter(l => l && !skip.has(l)))];
}

/**
 * §411 : une raison de refus relevée au clic (visée, menu) part-elle avec l'utilisation (`issues`) ? Non quand la fenêtre de légalité ou
 * `engage` la relèvent elles-mêmes : portée, autre plan, Chaîne d'éclairs (cibles désignées), contact (`engage`). La ligne de vue part
 * seulement quand le geste ne passe pas par `engage` (`blind` : visée multiple d'un sort à cibles).
 * @param {string} kind  `outOfRange`, `blind`, `plane`, `chain`, `contact` ou `other`.
 * @param {{blind?: boolean}} [options]
 */
export function forwardsIssue(kind, { blind=false }={}) {
  if ( kind === "blind" ) return blind;
  return !["outOfRange", "plane", "chain", "contact"].includes(kind);
}

/** §411 : les raisons d'une utilisation, réunies sans doublon (ordre gardé, vides retirés). */
export function mergeIssues(...lists) {
  return [...new Set(lists.flat().filter(l => (typeof l === "string") && l))];
}

/** §412 : la clé d'un ensemble de raisons (clés stables), sans ordre ni doublon — la mémoire d'un refus forcé. */
export function forcedKey(keys) {
  return [...new Set((keys ?? []).filter(Boolean).map(String))].sort().join(",");
}

/** §417 : ce que devient un refus du moteur. `level` : selon le niveau d'automatisation — aujourd'hui la fenêtre, à tous les niveaux. */
export const REFUSAL_MODES = Object.freeze(["level", "window", "notice", "strict", "off"]);

/**
 * §417 : le réglage « Action impossible » traduit en gestes. `window` : la fenêtre s'ouvre ; `proceed` : true = l'action part sans
 * attendre, false = elle ne peut pas partir (fenêtre sans « utiliser quand même »), null = celui qui agit décide ; `warn` : un avis à
 * l'écran de celui qui agit ; `report` : le MJ et la table sont prévenus, la carte marquée. Le MJ garde toujours la main : en refus strict,
 * il a la fenêtre entière.
 * @param {string} mode
 * @param {{isGM?: boolean}} [who]
 */
export function refusalOutcome(mode, { isGM=false }={}) {
  const m = (!REFUSAL_MODES.includes(mode) || (mode === "level")) ? "window" : mode;
  if ( m === "off" ) return { mode: m, window: false, proceed: true, warn: false, report: false };
  if ( m === "notice" ) return { mode: m, window: false, proceed: true, warn: true, report: true };
  if ( (m === "strict") && !isGM ) return { mode: m, window: true, proceed: false, warn: false, report: false };
  return { mode: m, window: true, proceed: null, warn: false, report: true };
}
