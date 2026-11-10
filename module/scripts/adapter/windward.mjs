/**
 * §403 : Bourrasque (`windward`) — le surcoût d'un trajet vers le lanceur dans la Ligne qui dure (core/windward.mjs). Les zones : celles
 * de la scène dont l'item déclare `windward`, le lanceur lu sur l'état de la zone (`source`). Coûts : ceux des points du trajet du cœur
 * (`cost`), sinon la distance mesurée sur la grille.
 */

import { windwardExtra } from "../core/windward.mjs";
import { contentOf } from "./content.mjs";
import { lastingRegions, readAreaState, isInside } from "./areas.mjs";

/** Les zones `windward` de la scène, avec le token de leur lanceur. */
function windwardZones(scene) {
  return lastingRegions(scene).map(region => {
    const state = readAreaState(region);
    const item = game.messages.get(state?.usage)?.getAssociatedActivity?.()?.item;
    if ( !item || (contentOf(item).entry?.windward !== true) ) return null;
    const caster = state.source ? fromUuidSync(state.source, { strict: false }) : null;
    return caster ? { region, caster } : null;
  }).filter(Boolean);
}

/**
 * Le surcoût, dans l'unité de la grille, du trajet `origin` → `waypoints` (positions de token), ou 0.
 * @param {TokenDocument} token
 * @param {object} origin
 * @param {object[]} waypoints
 */
export function windwardCost(token, origin, waypoints) {
  const scene = token?.parent;
  if ( !scene || !waypoints?.length ) return 0;
  const zones = windwardZones(scene).filter(z => z.caster !== token);
  if ( !zones.length ) return 0;
  const positions = [origin, ...waypoints].map(w => ({ ...token._source, ...w }));
  let extra = 0;
  for ( const { region, caster } of zones ) {
    const points = positions.map((p, i) => {
      const center = token.getCenterPoint(p);
      const cost = (i === 0) ? 0 : (Number.isFinite(p.cost) ? p.cost
        : scene.grid.measurePath([token.getCenterPoint(positions[i - 1]), center]).distance);
      return { x: center.x, y: center.y, inside: isInside(token, region, p), cost };
    });
    extra += windwardExtra(points, caster.getCenterPoint(caster._source));
  }
  return extra;
}
