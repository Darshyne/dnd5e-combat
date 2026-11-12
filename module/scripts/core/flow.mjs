/**
 * §418 : le « Déroulement » — comment le moteur s'y prend, à côté du niveau d'automatisation qui dit ce qu'il fait (§417). Les règles
 * pures de ses réglages. Pur : aucune dépendance à Foundry.
 */

/** Réglage « Réactions ». `level` : selon le niveau d'automatisation — aujourd'hui « demander à chacun », dès que le niveau les juge. */
export const REACTION_MODES = Object.freeze(["level", "ask", "players", "off"]);

/**
 * Le moteur propose-t-il cette réaction ? `ask` : à chacun (le joueur, ou le MJ pour ses créatures) ; `players` : seulement pour un
 * personnage de joueur — le MJ déclenche lui-même celles de ses créatures ; `off` : jamais, les réactions se jouent à la main.
 * @param {string} mode
 * @param {{playerOwned?: boolean}} [who]  L'acteur qui réagirait appartient-il à un joueur ?
 */
export function offersReaction(mode, { playerOwned=false }={}) {
  const m = (!REACTION_MODES.includes(mode) || (mode === "level")) ? "ask" : mode;
  if ( m === "off" ) return false;
  if ( m === "players" ) return playerOwned === true;
  return true;
}
