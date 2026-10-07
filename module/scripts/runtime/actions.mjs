/**
 * Les actions qu'un joueur commande à la souris ou au clavier (SPEC §11, étape 6 bis) — se
 * déplacer, sauter, engager une cible — et ce qui borne tout déplacement, quelle qu'en soit la
 * source : le plafond du tour et les attaques d'opportunité réglées AVANT de bouger.
 *
 * `ui/pointer.mjs` traduit les clics en appels d'ici ; il ne décide rien. Ici, rien n'est lu du
 * DOM : ce qu'une intention a d'optionnel (mode « lancer », jet sans dialogue) arrive en argument.
 * Rien n'est patché : `preMoveToken` est un hook public du cœur.
 */

import { MODULE_ID } from "../constants.mjs";
import { movementAllowance } from "../core/turn.mjs";
import { areHostile } from "../core/reaction.mjs";
import { footprintGap, chooseBasicAttack, dragMultiplier, dragAllowance } from "../core/movement.mjs";
import { convertLength } from "../core/units.mjs";
import { combatantFor, readBudget, movementOf, speedOf, rangeOf, committedPosition, historyCosts, distanceBetween, positionOf, usageTokenOf } from "../adapter/turn.mjs";
import { straightCells } from "../core/dash.mjs";
import { describeTarget } from "../adapter/areas.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { pilotOf, pilotOfActor, commandPlan, commandDistance, commandActivities, summonerToken, isIntangible, groupTokens, transposeOf } from "../adapter/pilot.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { sharesSpaceWith } from "../adapter/space-sharing.mjs";
import { planPath, previewPath, walk, stopAllWalks, continuedFlags, cellUnder, footprintOf, sizeOf, cellOf, stairsEntry, rulerShown } from "../adapter/movement.mjs";
import { hasLineOfSight, canSeePoint, isVisionAvailable } from "../adapter/vision.mjs";
import { victimsOf, sizeRankOf } from "../adapter/grapple.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { fearSources } from "../adapter/conditions.mjs";
import { movesCloser } from "../core/conditions.mjs";
import { cellsAtGap, footprintDistance } from "../core/orders.mjs";

/** Le centre d'un token à sa position validée. */
function centerOf(token) {
  const pos = committedPosition(token);
  const grid = token.parent.grid;
  return { x: pos.x + ((pos.width ?? 1) * grid.sizeX) / 2, y: pos.y + ((pos.height ?? 1) * grid.sizeY) / 2, elevation: pos.elevation };
}
import { opportunityThreats, resolveOpportunity } from "./reactions.mjs";
import { route } from "./router.mjs";
import { afterTeleportOptions } from "./teleport-options.mjs";
import { loc, notice, log } from "./shared.mjs";

/* -------------------------------------------- */
/*  Ce que le tour permet                       */
/* -------------------------------------------- */

/**
 * Plafond de coût du tour (historique compris), ou Infinity hors combat. Un agrippeur qui traîne sa victime
 * (Agrippé, « Déplaçable ») paie double ce qui lui reste, sauf victime TP ou de deux crans plus petite.
 */
export function movementCap(token) {
  const pilot = pilotOf(token);
  if ( pilot ) return pilotCap(token, pilot);
  const combatant = token.actor ? combatantFor(token.actor) : null;
  if ( !combatant ) return Infinity;
  const movement = movementOf(combatant, readUnitFactors());
  if ( !movement ) return Infinity;
  const budget = readBudget(combatant);
  // §16.59 : un tour achevé par un ordre (Injonction : Rampe, Halte…) — plus un pas.
  if ( budget.stopped ) return movement.spent + historyCosts(token).excluded;
  // §17.2 : le cœur ne connaît que son historique ; la hauteur des escaliers et le relevé s'en retirent ici.
  const cap = movementAllowance(budget, movement.speed) - (Number(budget.climbed) || 0) - (Number(budget.stood) || 0);
  // Le plafond se compare à l'historique du CŒUR, qui compte aussi les téléportations (§16.10) : on les y rajoute.
  const excluded = historyCosts(token).excluded;
  const victims = victimsOf(token);
  if ( !victims.length ) return cap + excluded;
  return dragAllowance(cap, movement.spent, dragMultiplier(sizeRankOf(token.actor), victims.map(v => sizeRankOf(v.actor)))) + excluded;
}

/**
 * §16.15 : un objet piloté se déplace de la distance d'une commande, pendant le tour de son lanceur, si une commande est
 * ouverte ou si le lanceur peut encore la payer. Sinon il ne bouge plus (plafond = ce qu'il a déjà parcouru).
 */
export function pilotMove(token, pilot) {
  const plan = commandPlan(pilot, "move");
  if ( !plan.combatant ) return { cap: Infinity, issue: null };
  const { spent, excluded } = historyCosts(token);
  const stuck = issue => ({ cap: spent + excluded, issue });
  if ( !plan.ownTurn ) return stuck("PasSonTour");
  if ( plan.pay && !((readBudget(plan.combatant)[plan.pay] ?? 0) > 0) ) return stuck("PasDeCommande");
  return { cap: commandDistance(pilot, readUnitFactors()) + excluded, issue: null };
}

const pilotCap = (token, pilot) => pilotMove(token, pilot).cap;

/** Une autre créature (visible, non vaincue, dont on ne peut pas partager la case — §105) occupe-t-elle l'emprise du token à cette position ? */
export function occupiedAt(token, position) {
  // §16.15 : la Main de Bigby « n'occupe pas son espace » — ni elle ne gêne, ni elle n'est gênée.
  if ( isIntangible(token) ) return false;
  const mine = { ...cellOf(token, position), ...sizeOf(token) };
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  return token.parent.tokens.some(other => (other !== token) && !other.hidden
    && !other.actor?.statuses?.has(defeated) && (other.object?.visible !== false) && !isIntangible(other) && !sharesSpaceWith(token, other)
    && (footprintGap(mine, footprintOf(other)) === 0));
}

/* -------------------------------------------- */
/*  Téléportation (§16.10)                      */
/* -------------------------------------------- */

/** Refus de la dernière destination, par token : l'intention reprend la visée au lieu d'abandonner. */
const refusedTeleports = new Set();

/**
 * `dnd5e.teleport` (activité native « teleport » de dnd5e 6, documents/activity/teleport.mjs) : la destination doit
 * être un espace inoccupé que la créature voit (Pas brumeux, Porte dimensionnelle : « un espace inoccupé… »). La
 * distance, elle, est déjà bornée par la planification du cœur (`maxDistance`). Sur le client qui planifie.
 */
/**
 * La portée d'une téléportation, dans l'unité de la scène : celle de l'activité native (`teleport.value`, préparée par
 * dnd5e, teleport-data.mjs), sinon celle que le contenu déclare (`teleport`). null : sans limite.
 */
function teleportLimit(activity, scene) {
  const rule = (activity?.type === "teleport") ? { distance: activity.teleport?.value, units: activity.teleport?.units }
    : (activity?.item ? contentOf(activity.item).entry?.teleport : null);
  if ( !rule || !Number.isFinite(Number(rule.distance)) ) return null;
  try { return convertLength(Number(rule.distance), rule.units, scene.grid.units, readUnitFactors()); }
  catch { return Number(rule.distance); }
}

function onTeleport(activity, plans) {
  for ( const { token, plan } of plans ?? [] ) {
    const doc = token?.document;
    const to = plan?.destination;
    if ( !doc || !to ) continue;
    // « Jusqu'à 9 m » (Foulée brumeuse) : la destination du plan est celle du clic — le cœur ne la borne pas toujours.
    const limit = teleportLimit(activity, doc.parent);
    const travelled = (limit !== null) ? distanceBetween(doc, doc, { posB: { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation } }).value : 0;
    if ( (limit !== null) && (travelled > limit + 1e-6) ) {
      ui.notifications.warn(loc("Teleport.TropLoin", { distance: limit, units: doc.parent.grid.units }));
      notice(doc, loc("Retour.TropLoin"));
      refusedTeleports.add(doc.uuid);
      return false;
    }
    if ( occupiedAt(doc, to) ) {
      ui.notifications.warn(loc("Teleport.CaseOccupee"));
      notice(doc, loc("Retour.CaseOccupee"));
      refusedTeleports.add(doc.uuid);
      return false;
    }
    const center = doc.getCenterPoint ? doc.getCenterPoint(to) : { x: to.x, y: to.y };
    if ( isVisionAvailable() && (canSeePoint(doc, { ...center, elevation: to.elevation ?? 0 }) === false) ) {
      ui.notifications.warn(loc("Teleport.NonVue"));
      notice(doc, loc("Retour.NonVue"));
      refusedTeleports.add(doc.uuid);
      return false;
    }
  }
  return true;
}

/**
 * La téléportation de soi qu'une activité déclenche, ou null : l'activité native « teleport » de dnd5e à portée « soi »
 * (sorts SRD), sinon ce que le contenu déclare pour l'item (`teleport`, content/teleports.mjs : le PHB).
 * @returns {{native: true}|{native: false, distance: number, units: string}|null}
 */
export function selfTeleportOf(activity) {
  if ( (activity?.type === "teleport") && (activity.range?.units === "self") && activity.canPlanTeleport ) return { native: true };
  const rule = activity?.item ? contentOf(activity.item).entry?.teleport : null;
  if ( !rule || (rule.activity && (rule.activity !== activity.id)) ) return null;
  return { native: false, distance: rule.distance, units: rule.units, then: rule.then ?? null };
}

/**
 * §67 quater : l'activité que la téléportation déclare pour l'arrivée (`teleport.then` : « elle peut ensuite forcer chaque
 * créature à 1,50 m de sa nouvelle position… »), utilisée aussitôt depuis la nouvelle position — une zone sur soi se pose
 * d'office (runtime/self-area.mjs).
 */
async function afterTeleport(activity, rule) {
  const next = rule.then ? activity.item?.system.activities?.get(rule.then) : null;
  if ( !next ) return;
  log(`${activity.item.name} : à l'arrivée, ${next.name || next.item.name}`);
  await next.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: true } }, { configure: false })
    .catch(err => console.error(`${MODULE_ID} | activité d'arrivée de la téléportation`, err));
}

/** Planifie une téléportation déclarée, comme le fait l'activité native (dnd5e teleport.mjs, `planTeleport`). */
async function planDeclaredTeleport(activity, object, { distance, units }) {
  let maxDistance = distance;
  try { maxDistance = convertLength(distance, units, canvas.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  const plan = await object.planMovement({ allowedActions: ["blink"], direct: true, maxDistance, preventDrop: true });
  if ( !plan ) return null;
  const plans = [{ token: object, plan }];
  // Le même point de contrôle que la téléportation native : notre validation, et quiconque l'écoute.
  if ( Hooks.call("dnd5e.teleport", activity, plans) === false ) return [];
  const moved = await object.document.startMovement(plan.id);
  return [{ token: object, plan, moved }];
}

/**
 * Intention « se téléporter » (Foulée brumeuse) : le token de la créature est contrôlé, et la planification du cœur
 * s'ouvre aussitôt — celle de l'activité native (`planTeleport`, bouton « Téléporter » de sa carte), ou la même pour un
 * item qui la déclare. BG3 : on choisit la case dans la foulée. Une destination refusée (case prise, pas en vue)
 * rouvre la visée ; Échap l'abandonne.
 * @param {Activity} activity
 * @returns {Promise<boolean>}  true si la créature s'est téléportée.
 */
let teleporting = null;

/** La téléportation dont on choisit la destination sur ce client (`{ token, limit }`, portée dans l'unité de la scène), ou null. */
export const currentTeleport = () => teleporting;

/**
 * §67 ter : la planification du cœur (`Token#planMovement`) ne se valide qu'en GLISSANT le token jusqu'à la destination
 * (canvas/placeables/token.mjs, `_prepareDragLeftDropUpdates` : seul le token planifié est interactif) — un clic au sol n'y fait
 * rien. Le clic du moteur (ui/pointer.mjs) choisit donc la case sous la souris : la planification du cœur est fermée, et
 * `teleportSelf` téléporte le token après la même validation (`dnd5e.teleport`). Le glisser du cœur reste possible.
 */
export function teleportClick(point) {
  const tp = teleporting;
  if ( !tp?.token?.parent ) return false;
  const at = tp.token.parent.grid.getTopLeftPoint(cellUnder(tp.token, point));
  tp.chosen = { x: at.x, y: at.y };
  canvas.tokens._cancelMovementPlanning();
  return true;
}

/** Téléporter vers la case choisie d'un clic : la validation de `onTeleport` (et de quiconque écoute), puis un `blink`. */
async function teleportTo(activity, token, { x, y }) {
  const elevation = token._source.elevation ?? 0;
  const plans = [{ token: token.object, plan: { destination: { x, y, elevation } } }];
  if ( Hooks.call("dnd5e.teleport", activity, plans) === false ) return false;
  await token.move([{ x, y, elevation, action: "blink", snapped: true }], { [MODULE_ID]: { cleared: true } });
  return true;
}

export async function teleportSelf(activity) {
  const rule = selfTeleportOf(activity);
  const token = activity?.getUsageToken?.() ?? activity?.actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  const object = token?.object ?? null;
  if ( !rule || !object ) return false;
  teleporting = { token, limit: teleportLimit(activity, token.parent) };
  // §92 : la case quittée, pour les options de la Foulée des fées (créatures à 1,50 m de l'espace quitté).
  const from = { x: token._source.x, y: token._source.y, elevation: token._source.elevation ?? 0, level: token._source.level ?? null };
  const done = async () => { await afterTeleport(activity, rule); await afterTeleportOptions(activity, token, from); return true; };
  try {
    for ( let attempt = 0; attempt < 5; attempt++ ) {
      object.control({ releaseOthers: true });
      refusedTeleports.delete(token.uuid);
      const results = rule.native ? await activity.planTeleport() : await planDeclaredTeleport(activity, object, rule);
      if ( results?.some(r => r.moved) ) return done();
      // §67 ter : une destination choisie d'un clic (`teleportClick`) — la planification du cœur, elle, s'est fermée sans rien.
      const chosen = teleporting.chosen;
      if ( chosen ) {
        teleporting.chosen = null;
        if ( await teleportTo(activity, token, chosen) ) return done();
        continue;   // refusée (case prise, hors de vue, trop loin) : la visée se rouvre
      }
      if ( !refusedTeleports.has(token.uuid) ) return false;   // abandonnée (Échap), pas refusée
    }
    return false;
  } finally { teleporting = null; }
}

/* -------------------------------------------- */
/*  Ruée en ligne droite (§57)                  */
/* -------------------------------------------- */

/** La ruée en ligne droite qu'une activité déclare (`lineDash`), ou null. */
export function lineDashOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.lineDash : null;
  if ( !rule || (rule.activity && (rule.activity !== activity.id)) ) return null;
  return rule;
}

/** « Une distance maximale égale à sa vitesse » : la Vitesse de marche, dans l'unité de la scène (null : aucune). */
function dashLimit(token) {
  const movement = token.actor?.system.attributes?.movement;
  const walk = Number(movement?.speeds?.walk ?? movement?.walk);
  if ( !Number.isFinite(walk) ) return null;
  try { return convertLength(walk, movement.units ?? token.parent.grid.units, token.parent.grid.units, readUnitFactors()); }
  catch { return walk; }
}

/**
 * Ce qui interdit cette case d'arrivée, ou null : trop loin, sur place, occupée, hors de vue, ou un mur sur la ligne droite
 * (la ruée passe les créatures, pas les murs). Rend `[clé de notification, clé du retour au curseur]`.
 */
export function dashProblem(token, to, limit) {
  if ( (cellOf(token, to).i === cellOf(token).i) && (cellOf(token, to).j === cellOf(token).j) ) return ["Ruee.SurPlace", null];
  const travelled = distanceBetween(token, token, { posB: { x: to.x, y: to.y } }).value;
  if ( (limit !== null) && (travelled > limit + 1e-6) ) return ["Teleport.TropLoin", "Retour.TropLoin"];
  if ( occupiedAt(token, to) ) return ["Teleport.CaseOccupee", "Retour.CaseOccupee"];
  const center = token.getCenterPoint ? token.getCenterPoint(to) : { x: to.x, y: to.y };
  if ( isVisionAvailable() && (canSeePoint(token, { ...center, elevation: to.elevation ?? 0 }) === false) ) return ["Teleport.NonVue", "Retour.NonVue"];
  const from = token.getCenterPoint ? token.getCenterPoint(committedPosition(token)) : null;
  if ( from && token.object?.checkCollision(center, { origin: from, type: "move", mode: "any" }) ) return ["Ruee.Mur", "Retour.Mur"];
  return null;
}

/**
 * Les créatures à `reach` ou moins d'un espace que la créature traverse de sa case à `to` (« chaque créature située à 1,50 m
 * ou moins d'un espace qu'il traverse ») : vivantes, non masquées, sur son niveau — alliés compris, elle-même exceptée.
 * Distance du moteur (3D, diagonales de la grille) depuis chaque position du tracé.
 */
export function dashTargets(token, to, rule) {
  const grid = token.parent.grid;
  let reach = rule.reach;
  try { reach = convertLength(rule.reach, rule.units, grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  const path = straightCells(cellOf(token), cellOf(token, to)).map(c => grid.getTopLeftPoint(c));
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  const level = token._source.level ?? null;
  return token.parent.tokens.filter(other => (other !== token) && other.actor && !other.hidden && !isObjectToken(other)
    && !other.actor.statuses?.has(defeated) && ((other._source.level ?? null) === level)
    && path.some(p => distanceBetween(token, other, { posA: { x: p.x, y: p.y } }).value <= reach + 1e-6));
}

/**
 * Ce qui refuse cette case d'arrivée (coin haut-gauche) à la ruée de cette activité, en clair, ou null : la case est bonne.
 * Pour la visée (ui/pointer.mjs), qui le montre au survol et garde la visée ouverte sur un clic refusé.
 * @returns {{text: string, short: string}|null}
 */
export function dashRefusal(activity, destination) {
  const token = usageTokenOf(activity);
  if ( !token || !lineDashOf(activity) ) return { text: "", short: "" };
  const limit = dashLimit(token);
  const problem = dashProblem(token, { x: destination.x, y: destination.y, elevation: token._source.elevation ?? 0 }, limit);
  if ( !problem ) return null;
  const text = loc(problem[0], { distance: limit, units: token.parent.grid.units });
  return { text, short: problem[1] ? loc(problem[1]) : text };
}

/** Les créatures qu'une ruée vers cette case toucherait (aperçu au survol). */
export function dashPreview(activity, destination) {
  const token = usageTokenOf(activity);
  const rule = lineDashOf(activity);
  if ( !token || !rule ) return [];
  return dashTargets(token, { x: destination.x, y: destination.y, elevation: token._source.elevation ?? 0 }, rule);
}

/**
 * Intention « ruée en ligne droite » (Frappe du vent), la case d'arrivée choisie (un clic de la visée, ui/pointer.mjs ; une case
 * donnée par un scénario) : l'activité est utilisée SANS gabarit, avec pour cibles les créatures près du trajet ; le
 * déplacement se fait après l'utilisation (`onDashUsed` : la légalité a pu la suspendre puis la relancer).
 * NB : la planification du cœur (`Token#planMovement`) ne convient pas ici — elle ne se valide qu'en GLISSANT le token
 * (client/canvas/placeables/token.mjs:5093, `_prepareDragLeftDropUpdates`), pas d'un clic sur la case.
 * @param {Activity} activity
 * @param {[object, object, object]} usage   Configurations d'utilisation, de dialogue et de message reçues.
 * @param {{x: number, y: number}} destination  Case d'arrivée (coin haut-gauche).
 * @returns {Promise<boolean>}  true si l'activité a été lancée.
 */
export async function dashStrike(activity, [config, dialog, message]=[], destination) {
  const rule = lineDashOf(activity);
  const token = usageTokenOf(activity);
  if ( !rule || !token || !destination ) return false;
  const refusal = dashRefusal(activity, destination);
  if ( refusal ) throw new Error(refusal.text);
  const to = { x: destination.x, y: destination.y, elevation: token._source.elevation ?? 0 };
  const targets = dashTargets(token, to, rule);
  log(`${token.name} : ${activity.item.name} vers (${to.x}, ${to.y}) — ${targets.map(t => t.name).join(", ") || "personne"} près du trajet`);
  const use = { ...(config ?? {}), create: { ...(config?.create ?? {}), measuredTemplate: false },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), dash: { token: token.uuid, x: to.x, y: to.y, elevation: to.elevation } } };
  const card = foundry.utils.mergeObject(message ?? {}, { data: {
    system: { targets: targets.map(describeTarget) },
    flags: { [MODULE_ID]: { dash: { x: to.x, y: to.y } } }
  } }, { inplace: false });
  const results = await activity.use(use, { ...(dialog ?? {}), configure: false }, card);
  return !!results;
}

/** L'utilisation faite (légalité comprise), la créature se rue : `blink`, ni attaque d'opportunité, ni murs, ni budget. */
async function onDashUsed(activity, usageConfig, results) {
  const dash = usageConfig?.[MODULE_ID]?.dash;
  if ( !dash || !results ) return;
  const token = fromUuidSync(dash.token, { strict: false });
  if ( !token?.isOwner ) return;
  await token.move([{ x: dash.x, y: dash.y, elevation: dash.elevation ?? token._source.elevation ?? 0, action: "blink", snapped: true }],
    { [MODULE_ID]: { cleared: true } });
}

/** Le bouton « Placer la zone » de la carte d'une ruée : rien à poser, les cibles sont déjà sur la carte. */
function onDashTemplate(activity) {
  if ( !lineDashOf(activity) ) return;
  ui.notifications.info(loc("Ruee.PasDeZone", { item: activity.item.name }));
  return false;
}

/**
 * §38.2 : intention « échanger de place avec l'illusion » (Troc du filou), depuis l'illusion ou son lanceur : deux téléportations
 * croisées (`blink` : ni attaque d'opportunité, ni commande facturée — runtime/pilot.mjs ignore une téléportation), qui passent les
 * contrôles de déplacement du moteur (`cleared`) ; le tour de l'échange est noté sur l'illusion (une fois par tour).
 * @param {TokenDocument} token
 * @returns {Promise<boolean>}  true si l'échange a eu lieu.
 */
export async function transpose(token) {
  const pair = transposeOf(token);
  if ( !pair ) { ui.notifications.warn(loc("Troc.Impossible")); return false; }
  const { caster, illusion } = pair;
  const at = t => { const s = t._source; return { x: s.x, y: s.y, elevation: s.elevation ?? 0, level: s.level ?? null }; };
  const from = at(caster);
  const to = at(illusion);
  const options = { constrainOptions: { ignoreWalls: true, ignoreTokens: true }, [MODULE_ID]: { cleared: true } };
  await illusion.move([{ ...from, snapped: true, action: "blink" }], options);
  await caster.move([{ ...to, snapped: true, action: "blink" }], options);
  if ( pair.turnKey ) await illusion.setFlag(MODULE_ID, "transposedTurn", pair.turnKey);
  notice(caster, loc("Troc.Fait", { name: caster.name }), "gain");
  return true;
}

/** Agrippé : Vitesse 0 (dnd5e la pose déjà) — le moteur le dit au lieu de « déplacement épuisé ». */
const isGrappled = token => token.actor?.statuses?.has("grappled") === true;

/** Portée d'une activité en cases, pour un mode d'attaque. null : pas de portée à tenir (soi-même, illimitée). */
export function reachCells(activity, mode=null) {
  const range = rangeOf(activity, mode ?? "melee");
  const grid = canvas.scene.grid;
  const toCells = value => {
    let v = value;
    try { v = convertLength(value, range.units, grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
    return Math.max(1, Math.floor((v / grid.distance) + 1e-6));
  };
  if ( ["self", "spec", "any"].includes(range.units) ) return null;
  if ( range.units === "touch" ) return { normal: 1, long: 1 };
  if ( !range.value ) return (activity.type === "attack") ? { normal: 1, long: 1 } : null;
  return { normal: toCells(range.value), long: toCells(range.long ?? range.value) };
}

/** Les attaques d'arme d'un acteur, et celle qu'un clic sur un ennemi déclenche. */
export function weaponAttacks(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    if ( item.type !== "weapon" ) continue;
    const activity = item.system.activities?.find(a => a.type === "attack");
    if ( !activity ) continue;
    const equipped = (actor.type === "npc") || (item.system.equipped === true);
    if ( !equipped ) continue;
    out.push({ id: activity.uuid, activity, melee: activity.attack?.type?.value !== "ranged", equipped, sort: item.sort ?? 0 });
  }
  return out;
}

/**
 * L'attaque que déclenche un clic sur un ennemi : l'arme de base, ou pour un objet piloté (§16.15) la première attaque
 * de ses commandes (« Move and Attack » de l'Arme spirituelle).
 */
export function basicAttack(actor) {
  const weapon = chooseBasicAttack(weaponAttacks(actor));
  if ( weapon ) return weapon;
  const pilot = pilotOfActor(actor);
  const activity = pilot ? commandActivities(pilot).find(a => a.type === "attack") : null;
  return activity ? { id: activity.uuid, activity, melee: activity.attack?.type?.value !== "ranged" } : null;
}

/** Hostilité, d'après les dispositions. Un objet piloté (disposition « secrète ») prend celle de son lanceur. */
export function hostileTo(me, other) {
  const pilot = pilotOf(me);
  const mine = pilot ? (summonerToken(pilot)?.disposition ?? me.disposition) : me.disposition;
  return areHostile(mine, other.disposition);
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

/**
 * Les attaques d'opportunité d'abord, le déplacement ensuite (déjà contrôlé : preMoveToken ne redemande pas). `flags` : ce
 * que l'opération de déplacement porte en plus sous la clé du module (`follow`, §41.3), lisible dans `updateToken`.
 */
async function walkSafely(token, plan, flags={}) {
  if ( plan.waypoints.length ) {
    previewPath(token, null);
    if ( !(await resolveOpportunity(token, opportunityThreats(token, plan.waypoints))) ) return false;
  }
  return walk(token, plan, { cleared: true, ...flags });
}

/**
 * Aller au point cliqué, sur le niveau affiché — ou sur `level` (niveau de la scène), que seuls les scénarios passent
 * (runtime/testing.mjs) : le MJ du scénario ne regarde pas forcément le niveau d'arrivée.
 */
export async function moveTo(token, point, { action=null, level=null }={}) {
  if ( isGrappled(token) ) return ui.notifications.warn(loc("Empoignade.Immobile", { name: token.name }));
  const cell = cellUnder(token, point);
  // §18.26 : un clic sur un escalier — aller à côté, puis y entrer en marchant : le cœur demande alors monter ou descendre.
  const stairs = (!level || (level === token._source.level)) ? stairsEntry(token, cell) : null;
  const to = stairs ? { cells: stairs.around, level: stairs.level } : { cell, ...(level ? { level } : {}) };
  // §18.25 : le chemin peut passer par une porte fermée — on marche jusqu'à elle, on l'ouvre, on repart (quelques portes au plus).
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, to, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return ui.notifications.warn(loc("Deplacement.AucunChemin"));
    if ( stairs && plan.arrives && !plan.door ) return enterStairs(token, plan, stairs, cell, action);
    if ( !plan.waypoints.length && !plan.door ) {
      if ( !plan.arrives ) ui.notifications.warn(loc("Deplacement.Epuise"));
      return;
    }
    if ( action ) plan.waypoints.forEach(w => { w.action = action; });
    if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return;
    // Pas de porte, ou le déplacement du tour s'épuise avant elle : on s'arrête là.
    if ( !plan.door || !plan.arrives ) return;
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
}

/**
 * §39.1 : marche publique (`api.approach`), pour les modules qui veulent faire aller un token quelque part par le chemin
 * du moteur — A*, portes ouvertes en chemin, attaques d'opportunité, budget du tour — sans qu'il connaisse le module :
 * ils donnent les cases d'arrivée admises (coin haut-gauche du token, sur le niveau `level` ou le sien), le moteur va à la
 * plus proche qu'il atteint. Même boucle que `moveTo`. Aucun effet si le client ne possède pas le token.
 * @param {TokenDocument} token
 * @param {{ cells: {i: number, j: number}[], level?: string|null }} to
 * @returns {Promise<{ arrived: boolean, reason?: "notOwner"|"noCells"|"grappled"|"noPath"|"stopped"|"exhausted" }>}
 */
export async function approach(token, { cells, level=null }={}) {
  if ( !token?.isOwner ) return { arrived: false, reason: "notOwner" };
  if ( !Array.isArray(cells) || !cells.length ) return { arrived: false, reason: "noCells" };
  if ( isGrappled(token) ) return { arrived: false, reason: "grappled" };
  const wanted = cells.map(({ i, j }) => ({ i, j }));
  const to = { cells: wanted, ...(level ? { level } : {}) };
  // Arrivé : sur une des cases ET sur le bon niveau (§41.3 : la même case, un étage plus haut, n'est pas l'arrivée).
  const onGoal = () => {
    if ( level && ((token._source.level ?? null) !== level) ) return false;
    const here = cellOf(token);
    return wanted.some(c => (c.i === here.i) && (c.j === here.j));
  };
  if ( onGoal() ) return { arrived: true };
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, to, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return { arrived: false, reason: "noPath" };
    if ( !plan.waypoints.length && !plan.door ) return onGoal() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return { arrived: false, reason: "stopped" };
    if ( !plan.door ) return onGoal() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( !plan.arrives ) return { arrived: false, reason: "exhausted" };
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
  return onGoal() ? { arrived: true } : { arrived: false, reason: "noPath" };
}

/**
 * §41.3 : rejoindre un autre token — aller au contact, où qu'il soit sur la scène (un autre niveau compris), par le chemin
 * du moteur : la zone d'approche d'une cible (`planPath` avec `target`, comme pour une attaque au contact — une estimation
 * juste, là où une liste de cases autour de lui épuisait la recherche d'un niveau à l'autre), portes ouvertes en chemin,
 * attaques d'opportunité, budget du tour. `flags` : ce que l'opération de déplacement porte (`follow`, voir `walkSafely`).
 * @returns {Promise<{ arrived: boolean, reason?: "notOwner"|"grappled"|"noPath"|"stopped"|"exhausted" }>}
 */
export async function joinToken(token, target, flags={}) {
  if ( !token?.isOwner ) return { arrived: false, reason: "notOwner" };
  if ( isGrappled(token) ) return { arrived: false, reason: "grappled" };
  const there = () => ((token._source.level ?? null) === (target._source.level ?? null))
    && (footprintDistance(footprintOf(token), footprintOf(target)) <= 0);
  if ( there() ) return { arrived: true };
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, { target, reachCells: 1 }, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return { arrived: false, reason: "noPath" };
    if ( !plan.waypoints.length && !plan.door ) return there() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( plan.waypoints.length && !(await walkSafely(token, plan, flags)) ) return { arrived: false, reason: "stopped" };
    if ( !plan.door ) return there() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( !plan.arrives ) return { arrived: false, reason: "exhausted" };
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
  return there() ? { arrived: true } : { arrived: false, reason: "noPath" };
}

/**
 * §41.3 : refaire un trajet déjà fait par un autre token (la piste d'un meneur : ses étapes, changement de niveau compris),
 * sans recherche de chemin — attaques d'opportunité et budget du tour comme toute marche du moteur. Rend false si le
 * déplacement a été refusé ou interrompu.
 */
export async function followTrail(token, waypoints, flags={}) {
  if ( !token?.isOwner || !waypoints?.length || isGrappled(token) ) return false;
  return walkSafely(token, { waypoints: waypoints.map(w => ({ ...w })), beyond: [], arrives: true }, flags);
}

/**
 * §18.26 : marcher jusqu'à la case voisine de l'escalier, puis un pas de marche ordinaire dans la case d'escalier qui la
 * touche (`stairs.entries`, adapter/movement.mjs `stairsEntry`) — pas un `displace`, qui ne déclencherait pas le comportement
 * `changeLevel` du cœur (change-level.mjs:57-62). Le budget du tour et les attaques d'opportunité de ce dernier pas passent
 * par `preMoveToken` comme tout déplacement.
 */
async function enterStairs(token, plan, stairs, cell, action) {
  if ( action ) plan.waypoints.forEach(w => { w.action = action; });
  if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return;
  const here = cellOf(token);
  const entry = stairs.entries?.get(`${here.i},${here.j}`) ?? cell;
  const step = { ...token.parent.grid.getTopLeftPoint(entry), snapped: true, ...(action ? { action } : {}) };
  await token.move([step], { showRuler: rulerShown() });
}

/**
 * §41.2 : prendre l'escalier (l'échelle, l'ascenseur) sous ce point jusqu'au niveau `level`, d'un seul geste — l'A* marche
 * jusqu'à côté et pose le token sur l'escalier de l'autre niveau par un pas `displace` (adapter/movement.mjs), sans le
 * dialogue du cœur ; la hauteur est comptée au budget du tour, les attaques d'opportunité jouées. Le cœur ne change pas
 * la vue d'un MJ avec son token (change-level.mjs:109) : on le fait ici, comme lui.
 */
export async function takeStairs(token, point, level) {
  const origin = token._source.level;
  await moveTo(token, point, { level });
  if ( (token._source.level === level) && (origin !== level) && game.user.isGM && token.parent.isView && (canvas.level?.id === origin) ) {
    await token.parent.view({ level, controlledTokens: [token.id] });
  }
}

/** §18.25 : portes qu'un seul clic de déplacement ouvre en chemin. */
const MAX_DOORS_PER_MOVE = 3;

/** Saut en longueur : ligne droite, au plus la valeur de Force en pieds (avec élan), payée en déplacement. */
export async function jumpTo(token, point) {
  const grid = canvas.scene.grid;
  const cell = cellUnder(token, point);
  const dest = { ...grid.getTopLeftPoint(cell), snapped: true, action: "jump" };
  const distance = grid.measurePath([grid.getCenterPoint(grid.getTopLeftPoint(cellOf(token))), grid.getCenterPoint(dest)]).distance;
  let max = token.actor?.system.abilities?.str?.value ?? 10;
  try { max = convertLength(max, "ft", grid.units, readUnitFactors()); } catch { /* pieds */ }
  if ( distance > max + 1e-6 ) return ui.notifications.warn(loc("Deplacement.SautTropLong", { max: Math.floor(max), units: grid.units }));
  await walkSafely(token, { waypoints: [dest], beyond: [], arrives: true });
}

/**
 * §18.24 : les cases d'où un token touche une porte, de son côté du mur (le côté opposé s'il est exactement dessus : les deux).
 * Le long du mur, une case par pas de grille, décalée d'une demi-emprise perpendiculairement.
 */
function doorSideCells(token, wall) {
  const grid = token.parent.grid;
  const [x1, y1, x2, y2] = wall.document.c;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if ( !length ) return [];
  const dir = { x: (x2 - x1) / length, y: (y2 - y1) / length };
  const normal = { x: -dir.y, y: dir.x };
  const center = centerOf(token);
  const side = Math.sign((normal.x * (center.x - x1)) + (normal.y * (center.y - y1)));
  const { w, h } = sizeOf(token);
  const offset = (Math.max(w, h) * grid.size) / 2;
  const steps = [];
  for ( let t = grid.size / 2; t < length; t += grid.size ) steps.push(t);
  if ( !steps.length ) steps.push(length / 2);
  const cells = new Map();
  for ( const s of side ? [side] : [1, -1] ) {
    for ( const t of steps ) {
      const point = { x: x1 + (dir.x * t) + (normal.x * s * offset), y: y1 + (dir.y * t) + (normal.y * s * offset) };
      const cell = cellUnder(token, point);
      cells.set(`${cell.i},${cell.j}`, cell);
    }
  }
  return Array.from(cells.values());
}

/**
 * §18.24 : s'avancer au contact d'une porte avant d'y agir (ouvrir, fermer, crocheter, forcer). Comme un geste de contact
 * (§18.22), on ne bouge que si l'on y arrive ce tour-ci. true : au contact (ou grille sans cases, où l'on agit sur place).
 */
export async function approachDoor(token, wall) {
  const grid = token.parent.grid;
  if ( grid.isGridless || !grid.isSquare ) return true;
  const cells = doorSideCells(token, wall);
  if ( !cells.length ) return true;
  const here = cellOf(token);
  if ( cells.some(c => (c.i === here.i) && (c.j === here.j)) ) return true;
  if ( isGrappled(token) ) { ui.notifications.warn(loc("Empoignade.Immobile", { name: token.name })); return false; }
  const plan = planPath(token, { cells, level: token._source.level ?? undefined }, { maxCost: movementCap(token) });
  if ( !plan ) { ui.notifications.warn(loc("Deplacement.AucunChemin")); return false; }
  if ( !plan.arrives ) { ui.notifications.warn(loc("Porte.HorsDatteinte")); return false; }
  if ( !plan.waypoints.length ) return true;
  if ( !(await walkSafely(token, plan)) ) return false;
  // Arrêté en route (attaque d'opportunité qui renverse, contrainte du cœur) : on n'agit pas à distance.
  const at = cellOf(token);
  return cells.some(c => (c.i === at.i) && (c.j === at.j));
}

/**
 * §16.59 : marcher jusqu'à être à `gap` cases de `anchor` (0 : au contact — Approche ; plus : Fuis), par l'A* du moteur,
 * dans le budget du tour, pas à pas (attaques d'opportunité comprises). Hors d'atteinte : aussi près que possible.
 * Rend true si le token est arrivé à cet écart.
 */
export async function walkToGap(token, anchor, gap) {
  const grid = token.parent.grid;
  const { sceneX, sceneY, sceneWidth, sceneHeight } = token.parent.dimensions;
  const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
  const bounds = { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j };
  const cells = cellsAtGap(footprintOf(anchor), sizeOf(token), gap, bounds);
  if ( !cells.length || isGrappled(token) ) return false;
  const plan = planPath(token, { cells, level: token._source.level ?? undefined }, { maxCost: movementCap(token) });
  if ( plan?.waypoints?.length ) await walkSafely(token, plan);
  return footprintDistance(footprintOf(token), footprintOf(anchor)) === gap;
}

/** Écart actuel, en cases, entre deux tokens (0 : au contact). */
export const gapBetween = (a, b) => Math.max(0, footprintDistance(footprintOf(a), footprintOf(b)));

/** Mode d'attaque imposé par un clic (« lancer »), lu au jet d'attaque (runtime/turn.mjs). Vie courte. */
const pendingAttacks = new Map();

/**
 * Une utilisation relancée par une porte (runtime/gates.mjs) garde ce qu'on avait décidé : jet sans dialogue, mode,
 * et la confirmation déjà donnée (« Attaquer quand même » à l'utilisation) — sinon le contrôle de portée du jet
 * redemanderait, sans minuteur (vu le 2026-09-24 : « Magicien est hors de portée » après une porte de Sanctuaire).
 */
export function keepPendingAttack(activity, { mode=null, fast=false, confirmed=false }={}) {
  pendingAttacks.set(activity.uuid, { mode, fast, confirmed, at: Date.now() });
}

export function takePendingAttack(activity) {
  const entry = pendingAttacks.get(activity.uuid);
  pendingAttacks.delete(activity.uuid);
  return (entry && ((Date.now() - entry.at) < 30000)) ? entry : null;
}

/**
 * Désigne la cible, s'approche s'il le faut, puis utilise l'activité : les jets viennent après
 * le déplacement. Si le tour ne permet pas d'arriver à portée, on avance et on s'arrête là.
 * @param {TokenDocument} token
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {string|null} [options.mode]   Mode d'attaque imposé (« thrown »).
 * @param {boolean} [options.fast]       Jet d'attaque sans dialogue.
 * @param {Array} [options.usage]        [usageConfig, dialogConfig, messageConfig] d'une utilisation suspendue (visée).
 * @param {string} [options.choice]      Effet exclusif choisi d'avance (id d'effet de l'activité) : la question
 *                                       de l'effet ne sera pas posée (§15.2, « Lutte », « Bousculade : à terre »).
 * @param {Event} [options.event]        Le clic qui a lancé l'action : dnd5e y lit les touches d'avantage et de
 *                                       désavantage (Alt / Ctrl, dice/d20-roll.mjs:83-84) ; il passe au jet par
 *                                       `usageConfig.event` (activity/attack.mjs:69). Sans effet si l'utilisation
 *                                       suspendue porte déjà le sien.
 */
/**
 * §16.29 (décision de l'utilisateur, 2026-09-25) : seule une attaque au corps à corps s'approche de sa cible (clic sur un
 * ennemi : s'avancer puis frapper) — et un objet piloté, qui agit au contact. Un sort, une arme à distance ou lancée ne
 * déplacent jamais la créature : hors de portée, le clic est refusé.
 */
export function approaches(activity, mode=null) {
  if ( pilotOfActor(activity?.actor) ) return true;
  if ( contactAction(activity) ) return true;
  const thrown = String(mode ?? "").includes("thrown");
  return (activity?.type === "attack") && (activity.attack?.type?.value === "melee") && !thrown;
}

/**
 * §18.22 : les gestes de contact des actions de base — attaque à mains nues, Lutte / Bousculade, Soutien. Ils s'approchent
 * de leur cible comme une attaque au corps à corps, mais seulement si elle est valide et atteignable ce tour-ci : sinon,
 * on ne bouge pas.
 */
export function contactAction(activity) {
  const item = activity?.item;
  return (item?.system?.identifier === "unarmed-strike") || (basicActionOf(item) === "help");
}

/**
 * Pourquoi un geste de contact ne vaut pas contre cette cible (texte court), ou null. Soutien : un ennemi ; Lutte /
 * Bousculade : une créature d'au plus une taille de plus que soi (Manuel des joueurs 2024, attaque à mains nues).
 */
export function contactRefusal(token, target, activity) {
  if ( !contactAction(activity) ) return null;
  if ( target === token ) return loc("Retour.PasSoi");
  if ( (basicActionOf(activity.item) === "help") && !hostileTo(token, target) ) return loc("Retour.PasEnnemi");
  if ( (activity.type === "save") && (sizeRankOf(target.actor) > sizeRankOf(token.actor) + 1) ) return loc("Retour.TropGrand");
  return null;
}

/**
 * Où en est une cible pour une activité qui ne s'approche pas : `out` au-delà de la portée longue, `blind` à portée d'une
 * arme à distance ou d'un sort mais sans ligne de vue. null : pas de portée à tenir.
 */
export function rangeStatus(token, target, activity, mode=null) {
  const reach = reachCells(activity, mode);
  if ( !reach ) return null;
  const gap = footprintGap(footprintOf(token), footprintOf(target));
  const out = gap > reach.long;
  const blind = !out && (reach.normal > 1) && !hasLineOfSight(centerOf(token), target);
  return { out, blind, gap, reach };
}

/**
 * §67 : une réaction qui rejoint d'abord la source (« se déplacer jusqu'à sa vitesse vers l'attaquant et l'attaquer »).
 * Hors d'allonge de l'activité, le réacteur s'approche — sa Vitesse entière, quoi qu'il ait dépensé à son tour (c'est
 * la réaction qui donne ce déplacement), sans attaque d'opportunité (`cleared`, comme un déplacement forcé). Hors combat, pas
 * de budget à lire : la Vitesse seule. Rend true si la cible est à portée ensuite.
 * @param {Actor5e} actor            Celui qui réagit.
 * @param {TokenDocument} target     La source de la fenêtre.
 * @param {Activity} activity        L'activité de réaction.
 */
export async function reactionApproach(actor, target, activity) {
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  const reach = reachCells(activity);
  if ( !token?.isOwner || !target || !reach ) return false;
  if ( footprintGap(footprintOf(token), footprintOf(target)) <= reach.normal ) return true;
  // Hors combat (pas de budget de tour), la Vitesse seule, comptée depuis l'historique du cœur tel qu'il est.
  const combatant = combatantFor(actor);
  const movement = combatant ? movementOf(combatant, readUnitFactors())
    : { spent: historyCosts(token).spent, ...(speedOf(actor, readUnitFactors()) ?? { speed: 0 }) };
  if ( !(movement?.speed > 0) || isGrappled(token) ) return false;
  // Le plafond se compare à l'historique du cœur (ce tour-ci) : ce qui est déjà fait, plus la Vitesse que donne la réaction.
  const maxCost = movement.spent + movement.speed + historyCosts(token).excluded;
  const plan = planPath(token, { target, reachCells: reach.normal }, { maxCost });
  if ( !plan?.waypoints.length ) return false;
  await walk(token, plan, { cleared: true });
  log(`${token.name} : rejoint ${target.name} pour sa réaction (${activity.item?.name ?? ""})${plan.arrives ? "" : ", sans l'atteindre"}`);
  return !!plan.arrives;
}

export async function engage(token, target, activity, { mode=null, fast=false, usage=null, event=null, choice=null }={}) {
  // §18.22 : un geste de contact sur une cible qui ne s'y prête pas est refusé avant tout déplacement.
  const refusal = contactRefusal(token, target, activity);
  if ( refusal ) {
    ui.notifications.warn(`${target.name} : ${refusal}`);
    notice(target, refusal);
    return;
  }
  // Hors du corps à corps, on ne bouge pas : hors de portée ou hors de vue, le geste est refusé.
  if ( !approaches(activity, mode) ) {
    const status = rangeStatus(token, target, activity, mode);
    if ( status?.out ) {
      ui.notifications.warn(loc("Deplacement.HorsDePortee", { name: target.name }));
      notice(target, loc("Retour.HorsDePortee"));
      return;
    }
    if ( status?.blind ) {
      ui.notifications.warn(loc("Deplacement.CibleHorsDeVue", { name: target.name }));
      notice(target, loc("Retour.NonVue"));
      return;
    }
  }
  target.object?.setTarget(true, { releaseOthers: true });
  // §16.15 : un objet piloté agit au contact — la portée de « Roll » (9 m) est celle de son déplacement, pas de son effet.
  const reach = pilotOfActor(activity.actor) ? { normal: 1, long: 1 } : reachCells(activity, mode);
  if ( reach && approaches(activity, mode) ) {
    const gap = footprintGap(footprintOf(token), footprintOf(target));
    // P1 : à distance, on ne s'approche que jusqu'à une case d'où l'on VOIT la cible — et si l'on est
    // déjà à portée sans la voir, on cherche une telle case.
    const ranged = reach.normal > 1;
    const seeing = ranged;
    const blind = ranged && (gap <= reach.normal) && !hasLineOfSight(centerOf(token), target);
    if ( (gap > reach.normal) || blind ) {
      const plan = planPath(token, { target, reachCells: reach.normal, seeing }, { maxCost: movementCap(token) });
      const withinLong = !blind && (gap <= reach.long);
      if ( !plan && blind ) return ui.notifications.warn(loc("Deplacement.CibleHorsDeVue", { name: target.name }));
      if ( !plan && !withinLong ) return ui.notifications.warn(loc("Deplacement.AucunChemin"));
      // §18.22 : un geste de contact ne s'avance pas pour rien — hors d'atteinte ce tour-ci, on reste sur place.
      if ( contactAction(activity) && !plan?.arrives && !withinLong ) {
        notice(target, loc("Retour.HorsDePortee"));
        return ui.notifications.warn(loc("Deplacement.CibleHorsDatteinte", { name: target.name }));
      }
      if ( plan?.arrives || !withinLong ) {
        if ( plan && !(await walkSafely(token, plan)) ) return;
        if ( !plan?.arrives ) return ui.notifications.warn(loc("Deplacement.CibleHorsDatteinte", { name: target.name }));
      }
    }
  }
  pendingAttacks.set(activity.uuid, { mode, fast, at: Date.now() });
  const [usageConfig, dialogConfig, original] = usage ?? [{}, {}, {}];
  // dnd5e fige les cibles dans la configuration du message dès la première utilisation
  // (activity/mixin.mjs:239-242) : à ce moment-là il n'y en avait pas. On les laisse se relire.
  const messageConfig = foundry.utils.deepClone(original ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  // Le mode choisi par le clic (« lancer », « main secondaire ») : la légalité le lit à l'utilisation, le
  // budget sur la carte (runtime/turn.mjs) — la main secondaire coûte l'action Bonus, pas l'action.
  if ( mode ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.attackMode`, mode);
  if ( choice ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.choice`, choice);
  const config = { ...usageConfig, [MODULE_ID]: { ...usageConfig?.[MODULE_ID], engaged: true, ...(mode ? { attackMode: mode } : {}), ...(choice ? { choice } : {}) } };
  if ( event && !config.event ) config.event = event;
  await activity.use(config, dialogConfig, messageConfig);
}

/**
 * §16.33 : intention « lancer sur ces créatures » (visée de groupe, ui/pointer.mjs) — l'utilisation suspendue repart, le
 * niveau déjà choisi, avec les créatures désignées pour cibles. dnd5e fige les cibles de la carte dès la première utilisation
 * (activity/mixin.mjs:239-242) : on les laisse se relire.
 * @param {Activity} activity
 * @param {[object, object, object]} usage  Configurations d'utilisation, de fenêtre et de message.
 * @param {string[]} picks                  Uuids des tokens.
 */
export async function castOnTargets(activity, [config, dialog, message], picks) {
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
  for ( const uuid of picks ) fromUuidSync(uuid, { strict: false })?.object?.setTarget(true, { releaseOthers: false, groupSelection: true });
  const messageConfig = foundry.utils.deepClone(message ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  await activity.use({ ...config, [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), engaged: true } }, dialog, messageConfig);
}

/* -------------------------------------------- */
/*  Plafond de déplacement (joueurs)            */
/* -------------------------------------------- */

/**
 * Un joueur ne dépasse pas le déplacement de son tour et ne finit pas sur une case prise, quelle
 * que soit la façon de bouger (clic, glisser, clavier). Le MJ n'est jamais retenu.
 */
function onPreMoveToken(token, movement, operation) {
  if ( !token.actor ) return true;
  if ( !game.user.isGM && !playerMayMove(token, movement) ) return false;
  return opportunityFirst(token, movement, operation);
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
    if ( !(await resolveOpportunity(token, threats)) ) return;
    const again = waypoints.map(({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }) =>
      ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }));
    await token.move(again, { showRuler: rulerShown(), [MODULE_ID]: { cleared: true } });
  })().catch(err => console.error(`${MODULE_ID} | attaque d'opportunité avant déplacement`, err));
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
  let limit = pilot.rule.tether.distance;
  try { limit = convertLength(limit, pilot.rule.tether.units, token.parent.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  return distanceBetween(caster, token, { posB: positionOf(destination) }).value <= limit + 1e-6;
}

/** À l'arrivée, l'objet est-il à `cluster` d'un autre objet du même sort ? Vrai s'il est seul. */
function nearAnother(token, pilot, destination) {
  const others = groupTokens(pilot).filter(t => t !== token);
  if ( !others.length || !destination ) return true;
  let limit = pilot.rule.cluster.distance;
  try { limit = convertLength(limit, pilot.rule.cluster.units, token.parent.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  const at = positionOf(destination);
  return others.some(other => distanceBetween(other, token, { posB: at }).value <= limit + 1e-6);
}

/* -------------------------------------------- */

export function registerActions() {
  route("dnd5e.teleport", onTeleport, { cancellable: true, label: "téléportation : destination" });
  route("dnd5e.postUseActivity", onDashUsed, { label: "ruée en ligne droite : déplacement" });
  route("dnd5e.preCreateMeasuredTemplate", onDashTemplate, { cancellable: true, label: "ruée en ligne droite : pas de zone" });
  route("preMoveToken", onPreMoveToken, { cancellable: true, label: "déplacement : plafond et attaques d'opportunité" });
  // §99 : la pause arrête les marches du moteur lancées depuis ce client (chacun arrête les siennes, Hooks.callAll partout).
  route("pauseGame", paused => { if ( paused ) stopAllWalks(); }, { label: "pause : arrêt des marches" });
}
