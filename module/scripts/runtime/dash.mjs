/**
 * Ruée en ligne droite (SPEC §57, Frappe du vent) : case d'arrivée, créatures traversées, utilisation sans gabarit. Extrait de
 * runtime/actions.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { committedPosition, distanceBetween, usageTokenOf } from "../adapter/turn.mjs";
import { straightCells } from "../core/dash.mjs";
import { describeTarget } from "../adapter/areas.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { transposeOf } from "../adapter/pilot.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { walk, cellOf } from "../adapter/movement.mjs";
import { canSeePoint, isVisionAvailable } from "../adapter/vision.mjs";
import { loc, notice, log } from "./shared.mjs";
import { occupiedAt } from "./actions.mjs";

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
export function dashLimit(token) {
  const movement = token.actor?.system.attributes?.movement;
  const walk = Number(movement?.speeds?.walk ?? movement?.walk);
  if ( !Number.isFinite(walk) ) return null;
  return lengthIn(walk, movement.units ?? token.parent.grid.units, token.parent.grid.units);
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
  let reach = lengthIn(rule.reach, rule.units, grid.units);
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
  log(`${token.name}: ${activity.item.name} to (${to.x}, ${to.y}) — ${targets.map(t => t.name).join(", ") || "nobody"} near the path`);
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
export async function onDashUsed(activity, usageConfig, results) {
  const dash = usageConfig?.[MODULE_ID]?.dash;
  if ( !dash || !results ) return;
  const token = fromUuidSync(dash.token, { strict: false });
  if ( !token?.isOwner ) return;
  await token.move([{ x: dash.x, y: dash.y, elevation: dash.elevation ?? token._source.elevation ?? 0, action: "blink", snapped: true }],
    { [MODULE_ID]: { cleared: true } });
}

/** Le bouton « Placer la zone » de la carte d'une ruée : rien à poser, les cibles sont déjà sur la carte. */
export function onDashTemplate(activity) {
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
