import { turnKeyOf, shouldTrigger, markHit, entersArea, stepsInside } from "../core/area.mjs";
import { MODULE_ID } from "../constants.mjs";
import { readAreaState, writeAreaState, lastingRegions, isInside, replayAgainst, noteExpiry, expiredRegions } from "../adapter/areas.mjs";
import { positionOf as position } from "../adapter/turn.mjs";
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
    const context = { event, token: token.uuid, turnKey };
    if ( !shouldTrigger(state, context) ) return;
    const usageMessage = game.messages.get(state.usage);
    if ( !usageMessage ) return;
    await writeAreaState(region, { ...state, ...markHit(state, context) });
    log(`${region.name} : ${token.name} (${event})`);
    announce(event, { actor: token.actor, target: token.actor, region: region.uuid, usage: state.usage });
    await replayAgainst(usageMessage, token, { region: region.uuid, event, ...(times > 1 ? { times } : {}) }, { activity: state.activity ?? null });
  });
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
  }
}

/** Un token se déplace : entre-t-il dans une zone, la traverse-t-il, et combien de cases y parcourt-il ? */
function onMoveToken(token, movement) {
  const regions = lastingRegions(token.parent);
  if ( !regions.length ) return;
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
    if ( n > 0 ) tick(region, token, "moves", currentTurnKey(), { times: n });
  }
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
    log(`${name} : durée écoulée, congédié`);
  }
  const gone = expiredRegions(worldTime);
  for ( const region of gone ) {
    const name = region.name;
    await region.delete();
    log(`zone « ${name} » : durée écoulée, retirée`);
  }
}

export function registerAreas() {
  const trigger = { executor: true, label: "zone : déclencheur interrompu" };
  route("createRegion", async region => {
    const at = await noteExpiry(region);
    if ( at !== null ) log(`zone « ${region.name} » : prend fin à l'heure du monde ${at} (dans ${at - game.time.worldTime} s)`);
  }, { executor: true, label: "zone : durée non notée" });
  // §37.4 : effets portés dans la zone (Silence) — le comportement du cœur, qui pose et retire seul.
  route("createRegion", async region => {
    const held = await holdZoneEffects(region);
    if ( held ) log(`zone « ${region.name} » : ${held.effects.join(", ")} porté(s) dedans`);
  }, { executor: true, label: "zone : effets portés non posés" });
  // §69 : terrain difficile perdu par les données (Enchevêtrement du Manuel des joueurs premium…).
  route("createRegion", async region => {
    const behavior = await holdDifficultTerrain(region);
    if ( behavior ) log(`zone « ${region.name} » : terrain difficile posé`);
  }, { executor: true, label: "zone : terrain difficile non posé" });
  route("updateWorldTime", onWorldTime, { executor: true, label: "zone : durée écoulée, non retirée" });
  route("createToken", async tokenDoc => {
    const at = await noteSummonExpiry(tokenDoc);
    if ( at !== null ) log(`${tokenDoc.name} : congédié à l'heure du monde ${at} (dans ${at - game.time.worldTime} s)`);
  }, { executor: true, label: "invocation : durée non notée" });
  route("combatTurnChange", onTurnChange, trigger);
  route("moveToken", onMoveToken, trigger);
  route("updateRegion", onUpdateRegion, trigger);
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "dégâts : dés multipliés (zone), type choisi" });
}
