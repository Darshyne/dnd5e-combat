import { turnKeyOf, shouldTrigger, markHit, entersArea, stepsInside, siblingFor, hitKey, pulseFor, pulseTargets } from "../core/area.mjs";
import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { readAreaState, writeAreaState, lastingRegions, isInside, replayAgainst, noteExpiry, expiredRegions, pulseAll, zoneCenter, moveZoneTo } from "../adapter/areas.mjs";
import { payWithoutUse } from "../adapter/reactions.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { placeAreaAt } from "../adapter/self-area.mjs";
import { positionOf as position, committedPosition } from "../adapter/turn.mjs";
import { noteSummonExpiry, expiredSummons } from "../adapter/summons.mjs";
import { holdZoneEffects, holdDifficultTerrain } from "../adapter/zone-effects.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { announce } from "./triggers.mjs";
import { log } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
const currentTurnKey = () => turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);

/** Le token peut-il subir la zone ? Pas celui qui l'a posée depuis lui-même, pas un mort. */
function isAffectable(token, state) {
  if ( !token?.actor || (token.uuid === state.exclude) ) return false;
  if ( isObjectToken(token) ) return false;   // un objet piloté ou un tas au sol n'est pas une créature (§16.15, §16.60)
  if ( token.actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) return false;
  // §16.23 : même règle qu'à la pose (core/area.mjs, selectAreaTargets) — alliés ou ennemis du lanceur seulement.
  if ( !["ally", "enemy"].includes(state.affects) || (state.originDisposition === null) || (state.originDisposition === undefined) ) return true;
  const sameSide = token.disposition === state.originDisposition;
  return state.affects === "ally" ? sameSide : !sameSide;
}

/**
 * La zone agit sur un token, si ses règles le veulent et s'il n'a pas déjà été touché ce tour.
 * Les écritures de la mémoire « déjà touché » sont mises en série par région.
 */
function tick(region, token, event, turnKey=currentTurnKey(), { times=1 }={}) {
  return enqueue(`area:${region.id}`, async () => {
    const state = readAreaState(region);
    if ( !state?.usage || !isAffectable(token, state) ) return;
    const context = { event, token: hitKey(state, event, token.uuid), turnKey };
    if ( !shouldTrigger(state, context) ) return;
    const usageMessage = game.messages.get(state.usage);
    if ( !usageMessage ) return;
    await writeAreaState(region, { ...state, ...markHit(state, context) });
    log(`${region.name}: ${token.name} (${event})`);
    announce(event, { actor: token.actor, target: token.actor, region: region.uuid, usage: state.usage });
    await replayAgainst(usageMessage, token, { region: region.uuid, event, ...(times > 1 ? { times } : {}) }, { activity: siblingFor(state, event) });
    // §75 : une zone à nombre de déclenchements (`zoneCharges` : Cordon de flèches, 4 projectiles) tombe au dernier.
    const charges = contentOf(usageMessage.getAssociatedActivity?.()?.item).entry?.zoneCharges;
    if ( charges ) {
      const fired = (Number(readAreaState(region)?.fired) || 0) + 1;
      if ( fired >= charges ) {
        log(`${region.name}: ${fired}/${charges} triggers, the area ends`);
        await region.delete();
      } else {
        await writeAreaState(region, { ...readAreaState(region), fired });
        log(`${region.name}: ${fired}/${charges} triggers`);
      }
    }
  });
}

/**
 * Au sol (Tremblement de terre : « au contact du sol ») : pas plus haut que le bas de son niveau (V14), 0 sur une scène sans niveaux.
 * La zone, elle, a reçu une tranche d'élévation (runtime/space.mjs) qui descend sous le sol : son bas ne dit rien.
 */
function grounded(token) {
  const pos = committedPosition(token);
  const bottom = Number(token.parent?.levels?.get?.(pos.level)?.elevation?.bottom);
  return (Number(pos.elevation) || 0) <= ((Number.isFinite(bottom) ? bottom : 0) + 1e-6);
}

/**
 * §91 : la zone agit au tour de son lanceur (`casterPulse`) — le rejeu numéro n (1 = le premier tour après la pose), l'activité
 * de l'entrée qui le couvre, sur ce qui est dedans (au plus `max`, les ennemis d'abord), ou utilisée par le lanceur (`use`).
 */
function casterPulse(region, caster, at) {
  return enqueue(`area:${region.id}`, async () => {
    const state = readAreaState(region);
    if ( !state?.usage || (state.source !== caster.uuid) ) return;
    const usageMessage = game.messages.get(state.usage);
    const item = usageMessage?.getAssociatedActivity?.()?.item;
    const rule = item ? contentOf(item).entry?.casterPulse : null;
    if ( !rule || (rule.at !== at) ) return;
    const n = (Number(state.pulses) || 0) + 1;
    await writeAreaState(region, { ...state, pulses: n });
    const entry = pulseFor(rule, n);
    const sibling = entry ? item.system.activities?.get(entry.activity) : null;
    if ( !sibling ) { log(`${region.name}: caster's turn ${n}, nothing to replay`); return; }
    // Tsunami : le mur s'éloigne du lanceur avant de frapper.
    if ( rule.away ) await driftAway(region, caster, rule.away);
    if ( entry.pay ) await payWithoutUse(sibling);
    if ( entry.use ) {
      await sibling.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: false } }, { configure: false }, { create: false });
      log(`${region.name}: caster's turn ${n}, "${sibling.name}" used`);
      return;
    }
    const inside = region.parent.tokens.filter(t => isInside(t, region) && isAffectable(t, state) && (!rule.ground || grounded(t)));
    const tokens = pulseTargets(inside, caster.disposition, entry.max);
    if ( !tokens.length ) log(`${region.name}: caster's turn ${n}, nobody in the area`);
    if ( tokens.length ) {
      log(`${region.name}: caster's turn ${n}, "${sibling.name}" on ${tokens.map(t => t.name).join(", ")}`);
      await pulseAll(usageMessage, tokens, sibling, region);
    }
    // « Une fois que la hauteur du mur est de 0 m, le sort prend fin » : l'item n'a plus d'utilisation.
    if ( rule.untilSpent && !((Number(item.system.uses?.value) || 0) > 0) ) {
      log(`${region.name}: no uses left, the spell ends`);
      const effect = concentrationOn(item);
      // La concentration emporte sa zone (runtime/concentration.mjs) ; sans elle, la zone est retirée ici.
      if ( effect ) await item.actor?.endConcentration?.(effect);
      else if ( region.parent?.regions.get(region.id) ) await region.delete().catch(() => {});
    }
  });
}

/** §91 : la zone s'éloigne du lanceur de `distance` (Tsunami : 15 m à chacun de ses tours). */
async function driftAway(region, caster, { distance, units }) {
  const center = zoneCenter(region);
  if ( !center ) return;
  const scene = region.parent;
  const pos = committedPosition(caster);
  const from = { x: pos.x + ((pos.width * scene.grid.sizeX) / 2), y: pos.y + ((pos.height * scene.grid.sizeY) / 2) };
  const dx = center.x - from.x, dy = center.y - from.y;
  const length = Math.hypot(dx, dy);
  if ( !(length > 0) ) return;
  let gridDistance = distance;
  try { gridDistance = convertLength(distance, units, scene.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  const px = gridDistance * (scene.grid.size / scene.grid.distance);
  await moveZoneTo(region, { x: center.x + (dx / length) * px, y: center.y + (dy / length) * px });
  log(`${region.name}: moves away by ${distance} ${units}`);
}

/**
 * §91 : la zone qui dure d'un item à `zoneEnd` vient de tomber (concentration rompue, durée écoulée, retirée) — le lanceur utilise
 * l'activité (sans rien consommer ni fenêtre), puis sa zone est posée au centre de celle qui tombe ; la résolution de zone habituelle
 * suit. MJ actif.
 */
async function onZoneEnd(region) {
  const state = readAreaState(region);
  const usageMessage = state?.usage ? game.messages.get(state.usage) : null;
  const item = usageMessage?.getAssociatedActivity?.()?.item;
  const rule = item ? contentOf(item).entry?.zoneEnd : null;
  const activity = rule ? item.system.activities?.get(rule.activity) : null;
  const caster = state?.source ? fromUuidSync(state.source, { strict: false }) : null;
  const point = zoneCenter(region);
  if ( !activity || !caster?.parent || !point ) return;
  log(`${region.name}: the area ends, "${activity.name}"`);
  const used = await activity.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: false }, consume: false }, { configure: false });
  if ( !used ) return;
  await placeAreaAt(activity, caster, point);
}

/** Fin du tour de l'un, début du tour de l'autre. */
function onTurnChange(combat, prior, current) {
  const scene = combat.scene ?? canvas.scene;
  const ended = combat.combatants.get(prior?.combatantId)?.token;
  const started = combat.combatants.get(current?.combatantId)?.token;
  for ( const region of lastingRegions(scene) ) {
    // La fin d'un tour appartient au tour qui s'achève : une créature déjà touchée pendant ce
    // tour-là (à la pose, en entrant) ne l'est pas de nouveau en le terminant. Vu en jeu.
    if ( ended && (ended.parent === scene) && isInside(ended, region) ) {
      tick(region, ended, "turnEnd", turnKeyOf(prior.round, prior.turn));
    }
    if ( started && (started.parent === scene) && isInside(started, region) ) tick(region, started, "turnStart");
    if ( ended && (readAreaState(region)?.source === ended.uuid) ) casterPulse(region, ended, "turnEnd");
    if ( started && (readAreaState(region)?.source === started.uuid) ) casterPulse(region, started, "turnStart");
  }
}

/**
 * §100 bis : les cases parcourues dans une zone `moves`, par token, le temps d'un déplacement que le cœur découpe en morceaux
 * (points de contrôle d'une marche du moteur, §99 ; régions) : un seul rejeu à la fin, pas un par morceau.
 * @type {Map<TokenDocument, {chain: string, counts: Map<RegionDocument, number>}>}
 */
const crossings = new Map();

/** Le rejeu des cases notées pour ce token (fin du déplacement, ou déplacement arrêté). */
function settleCrossings(token) {
  const pending = crossings.get(token);
  if ( !pending ) return;
  crossings.delete(token);
  for ( const [region, n] of pending.counts ) {
    if ( (n > 0) && region.parent ) tick(region, token, "moves", currentTurnKey(), { times: n });
  }
}

/** Un token se déplace : entre-t-il dans une zone, la traverse-t-il, et combien de cases y parcourt-il ? */
function onMoveToken(token, movement) {
  const chain = movement.chain?.[0] ?? movement.id;
  if ( crossings.get(token)?.chain !== chain ) settleCrossings(token);   // un autre déplacement : le précédent est clos
  const regions = lastingRegions(token.parent);
  if ( regions.length ) {
    const waypoints = [...(movement.passed?.waypoints ?? []), movement.destination].filter(Boolean).map(position);
    let steps = null;
    for ( const region of regions ) {
      const before = isInside(token, region, position(movement.origin));
      if ( entersArea(before, waypoints.map(w => isInside(token, region, w))) ) tick(region, token, "enter");
      // §16.20 : « pour chaque tranche de 1,50 m parcourue » dans la zone — case par case le long du trajet réellement
      // parcouru (téléportation exclue), un seul rejeu aux dés multipliés.
      if ( !readAreaState(region)?.on?.includes("moves") ) continue;
      steps ??= passedCells(token, movement);
      const n = stepsInside(steps.map(p => isInside(token, region, p)));
      if ( !(n > 0) ) continue;
      const entry = crossings.get(token) ?? { chain, counts: new Map() };
      entry.counts.set(region, (entry.counts.get(region) ?? 0) + n);
      crossings.set(token, entry);
    }
  }
  // Le cœur enchaînera un autre morceau (`pending`) : on attend la fin pour rejouer.
  if ( (token.movement?.id === movement.id) && (token.movement.state === "pending") ) return;
  settleCrossings(token);
}

/** Les cases d'arrivée du trajet parcouru par ce segment, départ exclu (vides pour une téléportation). */
function passedCells(token, movement) {
  const passed = movement.passed?.waypoints ?? [];
  if ( !passed.length || passed.every(w => CONFIG.Token.movement.actions[w.action]?.teleport) ) return [];
  const origin = position(movement.origin);
  return token.getCompleteMovementPath([origin, ...passed.map(position)]).slice(1).map(position);
}

/**
 * Dés multipliés (§16.20) : un rejeu `moves` porte `times` dans sa configuration de jet (adapter/messages.mjs) ; chaque
 * terme « XdY » devient « (X × n)dY » — « 2d4 par tranche » parcourue.
 */
function onPreRollDamage(config) {
  // §16.27 : le type de dégâts choisi par l'auteur (Orbe chromatique), pour chaque jet qui le permet.
  const damageType = config?.[MODULE_ID]?.damageType;
  if ( damageType ) for ( const roll of config.rolls ?? [] ) {
    const types = roll.options?.types ?? [];
    if ( types.includes(damageType) ) roll.options.type = damageType;
  }
  const times = config?.[MODULE_ID]?.times;
  if ( !(times > 1) ) return true;
  for ( const roll of config.rolls ?? [] ) {
    roll.parts = (roll.parts ?? []).map(part => String(part).replace(/(\d*)d(\d+)/g, (_, n, faces) => `${(Number(n) || 1) * times}d${faces}`));
  }
  return true;
}

/** La zone elle-même se déplace (Rayon de lune) : elle « entre » sur ceux qu'elle recouvre désormais. */
function onUpdateRegion(region, changes) {
  if ( !readAreaState(region)?.usage || !(("shapes" in changes) || ("attachment" in changes)) ) return;
  for ( const token of region.parent.tokens ) if ( isInside(token, region) ) tick(region, token, "enter");
}

/** §16.37 : l'heure du monde avance (repos, voyage, rounds de combat) — les zones échues disparaissent. MJ actif. */
async function onWorldTime(worldTime) {
  // §16.39 : les créatures invoquées pour une durée (Compagnon sauvage) — et leurs combattants.
  for ( const token of expiredSummons(worldTime) ) {
    const name = token.name;
    for ( const combat of game.combats ) {
      const gone = combat.combatants.filter(c => (c.sceneId === token.parent.id) && (c.tokenId === token.id)).map(c => c.id);
      if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
    }
    await token.delete();
    log(`${name}: duration elapsed, dismissed`);
  }
  const gone = expiredRegions(worldTime);
  for ( const region of gone ) {
    const name = region.name;
    await region.delete();
    log(`area "${name}": duration elapsed, removed`);
  }
}

export function registerAreas() {
  const trigger = { executor: true, label: "area: trigger interrupted" };
  route("createRegion", async region => {
    const at = await noteExpiry(region);
    if ( at !== null ) log(`area "${region.name}": ends at world time ${at} (in ${at - game.time.worldTime} s)`);
  }, { executor: true, label: "area: duration not recorded" });
  // §37.4 : effets portés dans la zone (Silence) — le comportement du cœur, qui pose et retire seul.
  route("createRegion", async region => {
    const held = await holdZoneEffects(region);
    if ( held ) log(`area "${region.name}": ${held.effects.join(", ")} carried inside`);
  }, { executor: true, label: "area: carried effects not applied" });
  // §69 : terrain difficile perdu par les données (Enchevêtrement du Manuel des joueurs premium…).
  route("createRegion", async region => {
    const behavior = await holdDifficultTerrain(region);
    if ( behavior ) log(`area "${region.name}": difficult terrain applied`);
  }, { executor: true, label: "area: difficult terrain not applied" });
  route("updateWorldTime", onWorldTime, { executor: true, label: "area: duration elapsed, not removed" });
  route("deleteRegion", onZoneEnd, { executor: true, label: "area: ended without its activity (zoneEnd)" });
  route("createToken", async tokenDoc => {
    const at = await noteSummonExpiry(tokenDoc);
    if ( at !== null ) log(`${tokenDoc.name}: dismissed at world time ${at} (in ${at - game.time.worldTime} s)`);
  }, { executor: true, label: "summon: duration not recorded" });
  route("combatTurnChange", onTurnChange, trigger);
  route("moveToken", onMoveToken, trigger);
  // Un déplacement arrêté entre deux morceaux (`stopMovement`, appelé sur tous les clients, documents/token.mjs:792) : les cases
  // déjà parcourues comptent.
  route("stopToken", settleCrossings, trigger);
  route("updateRegion", onUpdateRegion, trigger);
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "damage: dice multiplied (area), type chosen" });
}
