/**
 * Plafond de déplacement des joueurs (`preMoveToken`) : budget du tour, attaques d'opportunité avant le pas, laisses des
 * objets pilotés. Extrait de runtime/actions.mjs.
 */

import { barrierCrossed } from "../adapter/barriers.mjs";
import { MODULE_ID } from "../constants.mjs";
import { combatantFor, distanceBetween, positionOf } from "../adapter/turn.mjs";
import { pilotOf, summonerToken, groupTokens } from "../adapter/pilot.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { continuedFlags, rulerShown } from "../adapter/movement.mjs";
import { fearSources } from "../adapter/conditions.mjs";
import { movesCloser } from "../core/conditions.mjs";
import { opportunityThreats, resolveOpportunity, splitForReady } from "./reactions.mjs";
import { scatterStop } from "./scatter.mjs";
import { levelAtLeast } from "./levels.mjs";
import { loc } from "./shared.mjs";
import { isGrappled, movementCap, occupiedAt, pilotMove } from "./actions.mjs";

/* -------------------------------------------- */
/*  Plafond de déplacement (joueurs)            */
/* -------------------------------------------- */

/**
 * Un joueur ne dépasse pas le déplacement de son tour et ne finit pas sur une case prise, quelle
 * que soit la façon de bouger (clic, glisser, clavier). Le MJ n'est jamais retenu.
 */
export function onPreMoveToken(token, movement, operation) {
  if ( !token.actor ) return true;
  // §163 : Coquille antivie — on n'y entre pas en marchant, MJ compris (ce sont ses créatures qu'elle repousse). Téléportation et
  // déplacement forcé (`displace`) : pas une marche.
  const steps = movement.pending.waypoints.filter(w => !CONFIG.Token.movement.actions[w.action]?.teleport && (w.action !== "displace"));
  const fence = steps.length ? barrierCrossed(token, steps.map(w => positionOf(w))) : null;
  if ( fence ) {
    ui.notifications.warn(loc("Deplacement.Barriere", { name: token.name, item: fence.item.name }));
    return false;
  }
  if ( !game.user.isGM && !playerMayMove(token, movement) ) return false;
  // §187 : chausse-trapes, billes — qui y entre s'arrête sur leur première case (le reste du trajet n'est pas joué).
  if ( !scatterStop(token, movement, operation) ) return false;
  // §117 : les attaques d'opportunité sont une règle générale — niveau Assisté et au-dessus ; au niveau Essentiel, on marche.
  return levelAtLeast("assisted") ? opportunityFirst(token, movement, operation) : true;
}

/**
 * Les attaques d'opportunité se règlent AVANT le déplacement : s'il y en a, le déplacement est
 * suspendu (`preMoveToken` est synchrone), les attaques sont jouées, puis le même déplacement
 * repart, marqué comme déjà contrôlé. Vaut pour le clic, le glisser et le clavier, MJ compris.
 */
function opportunityFirst(token, movement, operation) {
  // §99 : un morceau de marche du moteur que le cœur enchaîne lui-même n'a plus les options du moteur — il est déjà contrôlé.
  if ( (operation?.[MODULE_ID] ?? continuedFlags(token, movement))?.cleared ) return true;
  const waypoints = [...movement.passed.waypoints, ...movement.pending.waypoints];
  const threats = opportunityThreats(token, waypoints);
  if ( !threats.length ) return true;
  (async () => {
    // §211 : une action préparée déclenchée en route — le token va jusqu'à la case où il arrive à portée, l'action est proposée, puis
    // la suite repart comme un nouveau déplacement (ses menaces revues depuis là).
    const split = splitForReady(token, waypoints, threats);
    if ( split ) {
      if ( !(await resolveOpportunity(token, split.before)) ) return;
      if ( split.first.length ) {
        await token.move(split.first, { showRuler: rulerShown(), [MODULE_ID]: { cleared: true } });
        const animation = token.object?.movementAnimationPromise;
        if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, 10000))]);
      }
      if ( !(await resolveOpportunity(token, [split.ready])) ) return;
      if ( split.rest.length ) await token.move(split.rest, { showRuler: rulerShown() });
      return;
    }
    if ( !(await resolveOpportunity(token, threats)) ) return;
    const again = waypoints.map(({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }) =>
      ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }));
    await token.move(again, { showRuler: rulerShown(), [MODULE_ID]: { cleared: true } });
  })().catch(err => console.error(`${MODULE_ID} | opportunity attack before movement`, err));
  return false;
}

/**
 * §17.3 : Effrayé — « vous ne pouvez pas vous rapprocher volontairement de la source de votre peur ». Un déplacement forcé
 * ou une téléportation (`displace`, actions `teleport`) n'est pas volontaire au sens du moteur : il passe.
 */
function approachesFear(token, movement) {
  if ( !token.actor?.statuses?.has("frightened") ) return null;
  const steps = movement.pending.waypoints.filter(w => !CONFIG.Token.movement.actions[w.action]?.teleport && (w.action !== "displace"));
  if ( !steps.length ) return null;
  for ( const source of fearSources(token) ) {
    const start = distanceBetween(token, source).value;
    if ( movesCloser(start, steps.map(w => distanceBetween(token, source, { posA: positionOf(w) }).value)) ) return source;
  }
  return null;
}

function playerMayMove(token, movement) {
  const fear = approachesFear(token, movement);
  if ( fear ) {
    ui.notifications.warn(loc("Deplacement.Effraye", { name: token.name, source: fear.name }));
    return false;
  }
  // « Une lumière doit rester à 6 m d'une autre » (`cluster`, §16.17) vaut aussi pour un pas `displace` (escalier de l'A*).
  const pilot = pilotOf(token);
  if ( pilot?.rule.cluster && !nearAnother(token, pilot, movement.destination) ) {
    ui.notifications.warn(loc("Pilote.TropSeul", { name: token.name, max: pilot.rule.cluster.distance, units: pilot.rule.cluster.units }));
    return false;
  }
  if ( pilot?.rule.tether && !withinTether(token, pilot, movement.destination) ) {
    ui.notifications.warn(loc("Pilote.TropLoinLanceur", { name: token.name, summoner: pilot.summoner.name, max: pilot.rule.tether.distance, units: pilot.rule.tether.units }));
    return false;
  }
  const last = movement.passed.waypoints.at(-1) ?? movement.destination;
  if ( CONFIG.Token.movement.actions[last?.action]?.teleport ) return true;

  if ( occupiedAt(token, movement.destination) ) {
    ui.notifications.warn(loc("Deplacement.CaseOccupee"));
    return false;
  }

  if ( isGrappled(token) ) {
    ui.notifications.warn(loc("Empoignade.Immobile", { name: token.name }));
    return false;
  }
  if ( pilot ) return pilotMayMove(token, movement, pilot);
  if ( !combatantFor(token.actor) ) return true;
  const allowance = movementCap(token);
  const total = movement.history.cost + movement.passed.cost + movement.pending.cost;
  if ( total > allowance + 1e-6 ) {
    ui.notifications.warn(loc("Deplacement.Epuise"));
    return false;
  }
  return true;
}

/** §16.15 : un objet piloté ne bouge qu'au tour de son lanceur, dans la distance d'une commande qu'il peut payer. */
function pilotMayMove(token, movement, pilot) {
  const { cap, issue } = pilotMove(token, pilot);
  const names = { name: token.name, summoner: pilot.summoner.name };
  if ( issue ) {
    ui.notifications.warn(loc(`Pilote.${issue}`, names));
    return false;
  }
  const total = movement.history.cost + movement.passed.cost + movement.pending.cost;
  if ( total > cap + 1e-6 ) {
    ui.notifications.warn(loc("Pilote.TropLoin", { ...names, max: pilot.rule.distance, units: pilot.rule.units }));
    return false;
  }
  return true;
}

/** À l'arrivée, l'objet reste-t-il à `tether` de son lanceur (Duplicité : 36 m) ? Vrai sans lanceur sur la scène. */
function withinTether(token, pilot, destination) {
  const caster = summonerToken(pilot);
  if ( !pilot.rule.tether || !caster || (caster.parent !== token.parent) || !destination ) return true;
  let limit = lengthIn(pilot.rule.tether.distance, pilot.rule.tether.units, token.parent.grid.units);
  return distanceBetween(caster, token, { posB: positionOf(destination) }).value <= limit + 1e-6;
}

/** À l'arrivée, l'objet est-il à `cluster` d'un autre objet du même sort ? Vrai s'il est seul. */
function nearAnother(token, pilot, destination) {
  const others = groupTokens(pilot).filter(t => t !== token);
  if ( !others.length || !destination ) return true;
  let limit = lengthIn(pilot.rule.cluster.distance, pilot.rule.cluster.units, token.parent.grid.units);
  const at = positionOf(destination);
  return others.some(other => distanceBetween(other, token, { posB: at }).value <= limit + 1e-6);
}
