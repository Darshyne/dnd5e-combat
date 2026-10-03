/**
 * Zone déplaçable (SPEC §16.14, B18) : Rayon de lune — « une action Magie lors de vos tours suivants pour déplacer le
 * Cylindre de 18 m au maximum ». Relancer le sort quand sa zone est déjà là la déplace (ui/pointer.mjs : la visée d'une
 * case) ; ici, l'intention (sur le client de celui qui agit : distance, tour, budget) et son exécution par le MJ actif
 * (requête : un joueur ne peut pas modifier une région). Les créatures que la zone recouvre désormais font leur
 * sauvegarde : c'est la zone qui « vient sur elles » (runtime/areas.mjs, `onUpdateRegion`).
 */

import { MODULE_ID } from "../constants.mjs";
import { canMoveArea, turnKeyOf } from "../core/area.mjs";
import { checkUse, spendUse, costOf } from "../core/turn.mjs";
import { convertLength } from "../core/units.mjs";
import { activeZoneOf, zoneCenter, moveZoneTo, readAreaState } from "../adapter/areas.mjs";
import { combatantFor, isOwnTurn, readBudget, writeBudget } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { askAnyway } from "./turn.mjs";
import { log, loc } from "./shared.mjs";

export const MOVE_ZONE_QUERY = `${MODULE_ID}.moveZone`;

/** Ce qu'une activité peut déplacer : `{ region, rule, cost }` si son item déclare `movable` et que sa zone est là, sinon null. */
export function movableZoneOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.movable : null;
  if ( !rule ) return null;
  const region = activeZoneOf(activity.item);
  return region ? { region, rule, cost: costOf(activity.activation?.type) } : null;
}

/** La distance dont la zone peut bouger, dans l'unité de la grille. */
export function maxMoveOf(rule) {
  try { return convertLength(rule.distance, rule.units, canvas.grid.units, readUnitFactors()); }
  catch { return rule.distance; }   // unité de la grille
}

/** Ce point est-il trop loin du centre actuel de la zone ? */
export function tooFarForZone(zone, point) {
  const center = zoneCenter(zone.region);
  return !!center && (canvas.grid.measurePath([center, point]).distance > maxMoveOf(zone.rule) + 1e-6);
}

const currentTurnKey = () => turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);

/**
 * Intention « déplacer la zone vers ce point ». Rend `true` quand c'est réglé (déplacée, ou abandon choisi) ; `false`
 * quand le point ne va pas (trop loin) et qu'on peut en choisir un autre.
 * @param {Activity} activity
 * @param {{x: number, y: number}} point
 */
export async function moveZone(activity, point) {
  const zone = movableZoneOf(activity);
  if ( !zone ) return true;
  const { region, rule, cost } = zone;
  if ( tooFarForZone(zone, point) ) {
    ui.notifications.warn(loc("Zone.TropLoin", { item: activity.item.name, max: rule.distance, units: rule.units }));
    return false;
  }
  // Mode souple (§6) : le tour de la pose, le budget — on dit ce qui cloche, le joueur décide.
  const lines = [];
  if ( !canMoveArea(readAreaState(region), currentTurnKey()) ) lines.push(loc("Zone.MemeTour", { item: activity.item.name }));
  const combatant = combatantFor(activity.actor);
  if ( combatant && cost ) {
    for ( const issue of checkUse(readBudget(combatant), { cost, weaponAttack: false, usesSpellSlot: false }, { isOwnTurn: isOwnTurn(combatant) }) ) {
      lines.push(loc(`Souci.${issue}`));
    }
  }
  if ( lines.length && !(await askAnyway(`${activity.item.name} — ${activity.actor?.name ?? ""}`, lines)) ) return true;
  const payload = { region: region.uuid, point: { x: point.x, y: point.y }, actor: activity.actor?.uuid ?? null, cost };
  const gm = game.users.activeGM;
  if ( !gm ) { ui.notifications.warn(loc("Zone.SansMJ")); return true; }
  if ( gm.isSelf ) await handleMoveZone(payload);
  else await gm.query(MOVE_ZONE_QUERY, payload, { timeout: 10000 }).catch(err => console.warn(`${MODULE_ID} | déplacement de zone`, err));
  return true;
}

/** Côté MJ actif : la région se déplace, l'action est décomptée, le chat le dit. */
export async function handleMoveZone({ region: regionUuid, point, actor: actorUuid, cost }) {
  const region = await fromUuid(regionUuid);
  if ( !region ) return false;
  await moveZoneTo(region, point);
  const actor = actorUuid ? await fromUuid(actorUuid) : null;
  const combatant = actor ? combatantFor(actor) : null;
  if ( combatant && cost ) {
    await writeBudget(combatant, spendUse(readBudget(combatant), { cost, weaponAttack: false, usesSpellSlot: false },
      { isOwnTurn: isOwnTurn(combatant), attacksPerAction: 1 }));
  }
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${loc("Zone.Deplacee", { name: actor?.name ?? "", item: region.name })}</p>`,
    flags: { [MODULE_ID]: { zoneMoved: { region: region.uuid, actor: actorUuid, cost } } }
  });
  log(`${region.name} : déplacée par ${actor?.name ?? "?"} (${cost ?? "sans coût"})`);
  return true;
}

export function registerZones() {
  CONFIG.queries[MOVE_ZONE_QUERY] = handleMoveZone;
}
