/**
 * Plafond de déplacement des joueurs (`preMoveToken`) : budget du tour, attaques d'opportunité avant le pas, laisses des
 * objets pilotés. Extrait de runtime/actions.mjs.
 */

import { barrierCrossed } from "../adapter/barriers.mjs";
import { isEthereal, etherealWallBetween } from "../adapter/plane.mjs";
import { MODULE_ID } from "../constants.mjs";
import { combatantFor, distanceBetween, positionOf, readBudget, writeBudget } from "../adapter/turn.mjs";
import { pilotOf, summonerToken, groupTokens } from "../adapter/pilot.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { continuedFlags, walkOptions } from "../adapter/movement.mjs";
import { fearSources, leashesOf } from "../adapter/conditions.mjs";
import { movesCloser } from "../core/conditions.mjs";
import { opportunityThreats, resolveOpportunity, splitForReady } from "./reactions.mjs";
import { scatterStop } from "./scatter.mjs";
import { levelAtLeast } from "./levels.mjs";
import { loc, log } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";
import { forcedKey } from "../core/forced.mjs";
import { windwardCost } from "../adapter/windward.mjs";
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
  // §412 (issue #44, lot 5) : un refus de règle n'est plus sec. Le déplacement est suspendu (`preMoveToken` est synchrone), la fenêtre de
  // légalité dit pourquoi chez qui bouge ; forcé, le même trajet repart marqué `forcedMove` (ces règles ne le rejugent pas : attaques
  // d'opportunité et chausse-trapes, si), le MJ et la table prévenus.
  const flags = operation?.[MODULE_ID] ?? continuedFlags(token, movement);
  if ( !flags?.forcedMove ) {
    const issues = moveIssues(token, movement);
    if ( issues.length ) {
      askToForceMove(token, movement, issues).catch(err => console.error(`${MODULE_ID} | forced movement`, err));
      return false;
    }
  }
  // §187 : chausse-trapes, billes — qui y entre s'arrête sur leur première case (le reste du trajet n'est pas joué).
  if ( !scatterStop(token, movement, operation) ) return false;
  // §117 : les attaques d'opportunité sont une règle générale — niveau Assisté et au-dessus ; au niveau Essentiel, on marche.
  return levelAtLeast("assisted") ? opportunityFirst(token, movement, operation) : true;
}

/**
 * §412 : ce qui retient ce déplacement — `[{ key, line }]` (clé stable, phrase de la fenêtre). §163 Coquille antivie (MJ compris : ce sont ses
 * créatures qu'elle repousse), §225 Mur de force dans l'Éthéré, §402 laisse (MJ compris : c'est la créature qui est tenue) ; pour un joueur
 * seulement (le MJ n'est jamais retenu) : Effrayé, objet piloté trop seul / trop loin / hors de son tour, case prise, Agrippé, déplacement du
 * tour épuisé.
 */
export function moveIssues(token, movement) {
  const issues = [];
  // §163 : téléportation et déplacement forcé (`displace`) : pas une marche. §225 : tout le trajet — un déplacement d'un seul tenant (glisser,
  // clavier) n'a rien dans `pending`, tout est dans `passed` (vu en jeu) ; seul `pending` était lu, si bien qu'un glisser entrait dans la Coquille.
  const steps = [...movement.passed.waypoints, ...movement.pending.waypoints]
    .filter(w => !CONFIG.Token.movement.actions[w.action]?.teleport && (w.action !== "displace"));
  const fence = steps.length ? barrierCrossed(token, steps.map(w => positionOf(w))) : null;
  if ( fence ) issues.push({ key: "barrier", line: loc("Deplacement.Barriere", { name: token.name, item: fence.item.name }) });
  // §225, lot 3 : dans l'Éthéré, les murs se traversent (action « ethereal », `walls: null`), sauf ceux qui arrêtent le voyage éthéré
  // (Mur de force, Cage de force) — MJ compris.
  if ( steps.length && isEthereal(token) ) {
    const origin = movement.origin ?? token._source;
    const centers = [origin, ...steps].map(p => token.getCenterPoint({ ...token._source, ...p }));
    if ( centers.some((c, i) => (i > 0) && etherealWallBetween(token.parent, centers[i - 1], c, token._source.level)) ) {
      issues.push({ key: "forceWall", line: loc("Ethere.MurDeForce", { name: token.name }) });
    }
  }
  // §402 : une laisse (Duel forcé) — pas de pas volontaire au-delà de sa distance du lanceur.
  const held = steps.length ? leashBroken(token, steps) : null;
  if ( held ) issues.push({ key: "leash", line: loc("Deplacement.Laisse", { name: token.name, source: held.source.name, item: held.item.name }) });
  if ( !game.user.isGM ) issues.push(...playerIssues(token, movement));
  return issues;
}

/** Souvenir des refus forcés, par token et raisons : un trajet au clavier (un pas par touche) ne redemande pas la même chose (60 s). */
const forcedMoves = new Map();
const FORCED_MOVE_MS = 60000;

/**
 * §412 : un refus de déplacement d'un autre point de contrôle (`preMoveToken` de l'escalade) — la même fenêtre, la même relance. Synchrone pour
 * l'appelant : il rend `false` aussitôt.
 */
export function forceMoveLater(token, movement, issues) {
  askToForceMove(token, movement, issues).catch(err => console.error(`${MODULE_ID} | forced movement`, err));
}

/** §412 : « Faire quand même » ? Forcé : le même trajet repart marqué `forcedMove` (et `ignoreTokens` pour une case prise). */
async function askToForceMove(token, movement, issues) {
  const memo = `${token.uuid}|${forcedKey(issues.map(i => i.key))}`;
  const remembered = (Date.now() - (forcedMoves.get(memo) ?? 0)) < FORCED_MOVE_MS;
  if ( !remembered ) {
    const go = await askAnyway(loc("Deplacement.Titre", { name: token.name }), issues.map(i => i.line), { actor: token.actor, token });
    if ( !go ) return;
    forcedMoves.set(memo, Date.now());
  }
  const waypoints = [...movement.passed.waypoints, ...movement.pending.waypoints].map(({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }) =>
    ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }));
  const occupied = issues.some(i => i.key === "occupied");
  await token.move(waypoints, { ...walkOptions(movement), ...(occupied ? { constrainOptions: { ignoreTokens: true } } : {}), [MODULE_ID]: { forcedMove: true } });
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
        await token.move(split.first, { ...walkOptions(movement), [MODULE_ID]: { cleared: true } });
        const animation = token.object?.movementAnimationPromise;
        if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, 10000))]);
      }
      if ( !(await resolveOpportunity(token, [split.ready])) ) return;
      if ( split.rest.length ) await token.move(split.rest, walkOptions(movement));
      return;
    }
    if ( !(await resolveOpportunity(token, threats)) ) return;
    const again = waypoints.map(({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }) =>
      ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }));
    await token.move(again, { ...walkOptions(movement), [MODULE_ID]: { cleared: true } });
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

/** §402 : la laisse que ce trajet dépasse (une case au-delà de la distance, plus loin qu'au départ), ou null. */
function leashBroken(token, steps) {
  for ( const leash of leashesOf(token) ) {
    const limit = lengthIn(leash.distance, leash.units, token.parent.grid.units);
    const start = distanceBetween(token, leash.source).value;
    const far = steps.some(w => {
      const d = distanceBetween(token, leash.source, { posA: positionOf(w) }).value;
      return (d > limit + 1e-6) && (d > start + 1e-6);
    });
    if ( far ) return leash;
  }
  return null;
}

function playerIssues(token, movement) {
  const issues = [];
  const fear = approachesFear(token, movement);
  if ( fear ) issues.push({ key: "frightened", line: loc("Deplacement.Effraye", { name: token.name, source: fear.name }) });
  // « Une lumière doit rester à 6 m d'une autre » (`cluster`, §16.17) vaut aussi pour un pas `displace` (escalier de l'A*).
  const pilot = pilotOf(token);
  if ( pilot?.rule.cluster && !nearAnother(token, pilot, movement.destination) ) {
    issues.push({ key: "cluster", line: loc("Pilote.TropSeul", { name: token.name, max: pilot.rule.cluster.distance, units: pilot.rule.cluster.units }) });
  }
  if ( pilot?.rule.tether && !withinTether(token, pilot, movement.destination) ) {
    issues.push({ key: "tether", line: loc("Pilote.TropLoinLanceur", { name: token.name, summoner: pilot.summoner.name, max: pilot.rule.tether.distance, units: pilot.rule.tether.units }) });
  }
  const last = movement.passed.waypoints.at(-1) ?? movement.destination;
  if ( CONFIG.Token.movement.actions[last?.action]?.teleport ) return issues;
  if ( occupiedAt(token, movement.destination) ) issues.push({ key: "occupied", line: loc("Deplacement.CaseOccupee") });
  if ( isGrappled(token) ) issues.push({ key: "grappled", line: loc("Empoignade.Immobile", { name: token.name }) });
  if ( pilot ) return [...issues, ...pilotIssues(token, movement, pilot)];
  if ( !combatantFor(token.actor) ) return issues;
  const allowance = movementCap(token);
  // §403 : Bourrasque — vers le lanceur dans la Ligne, chaque mètre en coûte deux (le surcoût des pas déjà faits est dans le budget).
  const total = movement.history.cost + movement.passed.cost + movement.pending.cost
    + windwardCost(token, movement.origin ?? token._source, [...movement.passed.waypoints, ...movement.pending.waypoints]);
  if ( total > allowance + 1e-6 ) issues.push({ key: "exhausted", line: loc("Deplacement.Epuise") });
  return issues;
}

/**
 * §403 : Bourrasque — après un pas, le MJ actif ajoute au budget du tour (`windward`) le surcoût de ce qui a été parcouru vers le lanceur
 * dans la Ligne ; `movementCap` le retire du plafond. Téléportation et déplacement forcé : pas une marche.
 */
export async function noteWindward(token, movement) {
  const combatant = token?.actor ? combatantFor(token.actor) : null;
  if ( !combatant ) return;
  const steps = (movement?.passed?.waypoints ?? []).filter(w => !CONFIG.Token.movement.actions[w.action]?.teleport && (w.action !== "displace"));
  const extra = steps.length ? windwardCost(token, movement.origin, steps) : 0;
  if ( !(extra > 0) ) return;
  const budget = readBudget(combatant);
  await writeBudget(combatant, { ...budget, windward: (Number(budget.windward) || 0) + extra });
  log(`${token.name}: ${extra} more movement spent against the wind`);
}

/** §16.15 : un objet piloté ne bouge qu'au tour de son lanceur, dans la distance d'une commande qu'il peut payer. */
function pilotIssues(token, movement, pilot) {
  const { cap, issue } = pilotMove(token, pilot);
  const names = { name: token.name, summoner: pilot.summoner.name };
  if ( issue ) return [{ key: `pilot.${issue}`, line: loc(`Pilote.${issue}`, names) }];
  const total = movement.history.cost + movement.passed.cost + movement.pending.cost;
  if ( total > cap + 1e-6 ) return [{ key: "pilotFar", line: loc("Pilote.TropLoin", { ...names, max: pilot.rule.distance, units: pilot.rule.units }) }];
  return [];
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
