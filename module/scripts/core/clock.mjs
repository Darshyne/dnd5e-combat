/**
 * §251 : l'horloge en temps réel — hors combat, le temps du monde avance d'une seconde par seconde réelle, pour que les durées que le
 * moteur et ses voisins comptent en temps du monde s'écoulent (zones, invocations, Forme sauvage, torches, huile en feu, délais de
 * fouille, pièges qui se réarment…). Le cœur de Foundry n'avance le temps qu'en combat (6 s par round) ; hors combat, sans module de
 * calendrier, il reste figé.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Les modules qui font déjà tourner l'horloge du monde : actifs, l'horloge du moteur s'efface (sinon le temps avancerait deux fois). */
export const CLOCK_MODULES = Object.freeze([
  "simple-timekeeping", "foundryvtt-simple-calendar", "foundryvtt-simple-calendar-reborn", "calendaria", "about-time"
]);

/** Le pas d'avance, en secondes : un round. Plus fin, chaque pas serait une écriture serveur et un `updateWorldTime` chez tous. */
export const CLOCK_STEP_SECONDS = 6;

/** Au-delà, un écart réel n'est pas du jeu (onglet endormi, machine en veille) : on n'en compte qu'un pas. */
export const CLOCK_MAX_GAP_SECONDS = 60;

/**
 * Pourquoi l'horloge ne tourne pas en ce moment (null : elle tourne).
 * @param {{ enabled: boolean, executor: boolean, rival: string|null, paused: boolean, inCombat: boolean }} state
 * @returns {"off"|"notExecutor"|"rival"|"paused"|"combat"|null}
 */
export function clockHalt({ enabled, executor, rival, paused, inCombat }) {
  if ( !enabled ) return "off";
  if ( !executor ) return "notExecutor";
  if ( rival ) return "rival";
  if ( paused ) return "paused";
  if ( inCombat ) return "combat";
  return null;
}

/**
 * Ce qu'il faut avancer maintenant, en secondes de temps du monde, et le temps réel désormais compté.
 * @param {number|null} counted  Millisecondes réelles déjà comptées (null : l'horloge vient de repartir — on part de maintenant).
 * @param {number} now           Millisecondes réelles.
 * @returns {{ advance: number, counted: number }}  `advance` est un multiple entier de secondes ; le reste attend le pas suivant.
 */
export function clockTick(counted, now) {
  if ( !Number.isFinite(counted) || (now < counted) ) return { advance: 0, counted: now };
  const elapsed = Math.floor((now - counted) / 1000);
  if ( elapsed < CLOCK_STEP_SECONDS ) return { advance: 0, counted };
  if ( elapsed > CLOCK_MAX_GAP_SECONDS ) return { advance: CLOCK_STEP_SECONDS, counted: now };
  return { advance: elapsed, counted: counted + (elapsed * 1000) };
}

/** Le premier module d'horloge actif parmi les ids donnés (`isActive(id)`), ou null. */
export const rivalClock = isActive => CLOCK_MODULES.find(id => isActive(id)) ?? null;
