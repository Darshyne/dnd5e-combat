/**
 * Téléportation de soi (SPEC §16.10) : validation de la destination (`dnd5e.teleport`), planification et clic du moteur,
 * activité d'arrivée. Extrait de runtime/actions.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { cellUnder } from "../adapter/movement.mjs";
import { canSeePoint, isVisionAvailable } from "../adapter/vision.mjs";
import { afterTeleportOptions } from "./teleport-options.mjs";
import { loc, notice, log } from "./shared.mjs";
import { occupiedAt } from "./actions.mjs";

/* -------------------------------------------- */
/*  Téléportation (§16.10)                      */
/* -------------------------------------------- */

/** Refus de la dernière destination, par token : l'intention reprend la visée au lieu d'abandonner. */
const refusedTeleports = new Set();

/**
 * La portée d'une téléportation, dans l'unité de la scène : celle de l'activité native (`teleport.value`, préparée par
 * dnd5e, teleport-data.mjs), sinon celle que le contenu déclare (`teleport`). null : sans limite.
 */
function teleportLimit(activity, scene) {
  const rule = (activity?.type === "teleport") ? { distance: activity.teleport?.value, units: activity.teleport?.units }
    : (activity?.item ? contentOf(activity.item).entry?.teleport : null);
  if ( !rule || !Number.isFinite(Number(rule.distance)) ) return null;
  return lengthIn(Number(rule.distance), rule.units, scene.grid.units);
}

/**
 * `dnd5e.teleport` (activité native « teleport » de dnd5e 6, documents/activity/teleport.mjs) : la destination doit
 * être un espace inoccupé que la créature voit (Pas brumeux, Porte dimensionnelle : « un espace inoccupé… »). La
 * distance, elle, est déjà bornée par la planification du cœur (`maxDistance`). Sur le client qui planifie.
 */
export function onTeleport(activity, plans) {
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
export async function afterTeleport(activity, rule) {
  const next = rule.then ? activity.item?.system.activities?.get(rule.then) : null;
  if ( !next ) return;
  log(`${activity.item.name}: on arrival, ${next.name || next.item.name}`);
  await next.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: true } }, { configure: false })
    .catch(err => console.error(`${MODULE_ID} | teleport arrival activity`, err));
}

/** Planifie une téléportation déclarée, comme le fait l'activité native (dnd5e teleport.mjs, `planTeleport`). */
async function planDeclaredTeleport(activity, object, { distance, units }) {
  let maxDistance = lengthIn(distance, units, canvas.grid.units);
  const plan = await object.planMovement({ allowedActions: ["blink"], direct: true, maxDistance, preventDrop: true });
  if ( !plan ) return null;
  const plans = [{ token: object, plan }];
  // Le même point de contrôle que la téléportation native : notre validation, et quiconque l'écoute.
  if ( Hooks.call("dnd5e.teleport", activity, plans) === false ) return [];
  const moved = await object.document.startMovement(plan.id);
  return [{ token: object, plan, moved }];
}

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
export async function teleportTo(activity, token, { x, y }) {
  const elevation = token._source.elevation ?? 0;
  const plans = [{ token: token.object, plan: { destination: { x, y, elevation } } }];
  if ( Hooks.call("dnd5e.teleport", activity, plans) === false ) return false;
  await token.move([{ x, y, elevation, action: "blink", snapped: true }], { [MODULE_ID]: { cleared: true } });
  return true;
}

/**
 * Intention « se téléporter » (Foulée brumeuse) : le token de la créature est contrôlé, et la planification du cœur
 * s'ouvre aussitôt — celle de l'activité native (`planTeleport`, bouton « Téléporter » de sa carte), ou la même pour un
 * item qui la déclare. BG3 : on choisit la case dans la foulée. Une destination refusée (case prise, pas en vue)
 * rouvre la visée ; Échap l'abandonne.
 * @param {Activity} activity
 * @returns {Promise<boolean>}  true si la créature s'est téléportée.
 */
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
