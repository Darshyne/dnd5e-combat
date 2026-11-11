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
import { lightAt, lightOnToken } from "../adapter/illumination.mjs";
import { LIGHT } from "../core/illumination.mjs";
import { afterTeleportOptions } from "./teleport-options.mjs";
import { carryPassengers, choosePassengers } from "./passengers.mjs";
import { loc, notice, log } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";
import { occupiedAt } from "./actions.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { whileAwaiting } from "../adapter/awaiting.mjs";

/* -------------------------------------------- */
/*  Téléportation (§16.10)                      */
/* -------------------------------------------- */

/** Refus de la dernière destination, par token : l'intention demande s'il faut forcer, sinon reprend la visée au lieu d'abandonner. */
const refusedTeleports = new Map();   // §411 : uuid du token → `{ to, lines }`, de quoi forcer

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
    const issues = teleportIssues(activity, doc, to);
    if ( !issues.length ) continue;
    // §411 (issue #44, lot 4) : plus de refus sec. Le déplacement est annulé (le hook est synchrone) ; l'intention (`teleportSelf`,
    // `handleNearSpace`) demande ensuite, et peut forcer la même case.
    notice(doc, loc(issues[0].notice));
    refusedTeleports.set(doc.uuid, { to: { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation ?? 0 }, lines: issues.map(i => i.line) });
    return false;
  }
  return true;
}

/**
 * Ce qui cloche dans une destination de téléportation : `[{ line, notice }]` (phrase de la fenêtre, texte flottant). « Jusqu'à 9 m » ; un
 * espace inoccupé ; §367 Marche dans l'ombre ; une case que l'on voit (C12-b : sauf `teleport.unseen`, Porte dimensionnelle).
 * @param {Activity|null} activity
 * @param {TokenDocument} doc
 * @param {{x: number, y: number, elevation?: number}} to
 */
export function teleportIssues(activity, doc, to) {
  const issues = [];
  // « Jusqu'à 9 m » (Foulée brumeuse) : la destination du plan est celle du clic — le cœur ne la borne pas toujours.
  const limit = teleportLimit(activity, doc.parent);
  const travelled = (limit !== null) ? distanceBetween(doc, doc, { posB: { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation } }).value : 0;
  if ( (limit !== null) && (travelled > limit + 1e-6) ) {
    issues.push({ line: loc("Teleport.TropLoin", { distance: limit, units: doc.parent.grid.units }), notice: "Retour.TropLoin" });
  }
  if ( occupiedAt(doc, to) ) issues.push({ line: loc("Teleport.CaseOccupee"), notice: "Retour.CaseOccupee" });
  const center = doc.getCenterPoint ? doc.getCenterPoint(to) : { x: to.x, y: to.y };
  // §367 : Marche dans l'ombre — « en Pénombre ou dans les Ténèbres, vers un espace … lui aussi en Pénombre ou dans les Ténèbres ».
  const lit = tooBrightFor(activity, doc, { ...center, elevation: to.elevation ?? doc._source.elevation ?? 0 });
  if ( lit ) issues.push({ line: loc(`Teleport.TropEclaire.${lit}`), notice: "Retour.TropEclaire" });
  const unseen = activity?.item ? contentOf(activity.item).entry?.teleport?.unseen === true : false;
  if ( !unseen && isVisionAvailable() && (canSeePoint(doc, { ...center, elevation: to.elevation ?? 0 }) === false) ) {
    issues.push({ line: loc("Teleport.NonVue"), notice: "Retour.NonVue" });
  }
  return issues;
}

/**
 * §411 : la dernière destination refusée de ce token — « Faire quand même » ? Forcé : le token y est téléporté (`blink`, sans la
 * validation), le MJ et la table prévenus. Rend true si c'est fait.
 */
async function forceRefusedTeleport(activity, doc) {
  const refused = refusedTeleports.get(doc.uuid);
  if ( !refused ) return false;
  refusedTeleports.delete(doc.uuid);
  const item = activity?.item ?? null;
  const go = await askAnyway(`${item?.name ?? loc("Teleport.Titre")} — ${doc.name}`, refused.lines, { actor: doc.actor, item, token: doc });
  if ( !go ) return false;
  const { x, y, elevation } = refused.to;
  // Une case prise : dnd5e ne laisse pas finir un déplacement sur une autre créature (canvas/token.mjs, `constrainMovementPath`) sauf
  // `ignoreTokens` — forcer, c'est y aller quand même.
  await doc.move([{ x, y, elevation, action: "blink", snapped: true }], { constrainOptions: { ignoreTokens: true }, [MODULE_ID]: { cleared: true } });
  return true;
}

/**
 * §367 : `teleport.maxLight` — le départ (`"from"`) ou l'arrivée (`"to"`) plus éclairés que la règle ne le permet, ou null. Sans canevas
 * ou sans lumière lisible : rien à redire.
 * @param {Activity} activity
 * @param {TokenDocument} doc
 * @param {{x: number, y: number, elevation?: number}|null} [destination]
 */
export function tooBrightFor(activity, doc, destination=null) {
  const rule = activity?.item ? contentOf(activity.item).entry?.teleport : null;
  if ( !rule?.maxLight || (rule.activity && (rule.activity !== activity.id)) ) return null;
  const limit = (rule.maxLight === "dark") ? LIGHT.DARK : LIGHT.DIM;
  const here = lightOnToken(doc);
  if ( here && (here.level > limit) ) return "from";
  const there = destination ? lightAt(destination) : null;
  if ( there && (there.level > limit) ) return "to";
  return null;
}

/**
 * La téléportation de soi qu'une activité déclenche, ou null : l'activité native « teleport » de dnd5e à portée « soi »
 * (sorts SRD), sinon ce que le contenu déclare pour l'item (`teleport`, content/teleports.mjs : le PHB).
 * @returns {{native: true}|{native: false, distance: number, units: string}|null}
 */
export function selfTeleportOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.teleport : null;
  // §264 : les passagers que le contenu déclare valent aussi pour l'activité native (Porte dimensionnelle du SRD).
  if ( (activity?.type === "teleport") && (activity.range?.units === "self") && activity.canPlanTeleport ) return { native: true, passengers: rule?.passengers ?? null };
  if ( !rule || (rule.activity && (rule.activity !== activity.id)) ) return null;
  return { native: false, distance: rule.distance, units: rule.units, then: rule.then ?? null, passengers: rule.passengers ?? null };
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
  // §264 : qui part avec lui (Porte dimensionnelle), choisi avant le saut ; posé à côté de lui à l'arrivée.
  const passengers = await choosePassengers(token, rule.passengers);
  const done = async () => {
    await carryPassengers(token, passengers);
    await afterTeleport(activity, rule); await afterTeleportOptions(activity, token, from); return true;
  };
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
      }
      if ( !refusedTeleports.has(token.uuid) ) {
        if ( chosen ) continue;
        return false;   // abandonnée (Échap), pas refusée
      }
      // §411 : refusée (case prise, hors de vue, trop loin) — forcer, sinon la visée se rouvre.
      if ( await forceRefusedTeleport(activity, token) ) return done();
    }
    return false;
  } finally { teleporting = null; }
}

/* -------------------------------------------- */
/*  §401 : un espace de votre choix, tout près   */
/* -------------------------------------------- */

export const NEAR_SPACE_QUERY = `${MODULE_ID}.nearSpace`;

/** Au-delà, la planification se ferme d'elle-même (le token reste où il est, ou le MJ actif le décale). */
const NEAR_SPACE_MS = 30000;

/**
 * §401 : Clignotement — « vous revenez dans un espace inoccupé de votre choix, que vous voyez, à 3 m ou moins de l'espace quitté ». Sur le
 * client de celui qui choisit (le joueur du token, sinon le MJ) : rester là (si l'espace est libre) ou choisir la case, par la
 * planification du cœur ou un clic (comme la Foulée brumeuse), validée comme une téléportation (case libre, en vue, à portée). Rend la
 * case choisie `{ x, y }` (le token y est), ou null (il reste où il est).
 * @param {{token: string, distance: number, units: string, mustMove?: boolean, item?: string}} payload
 */
export async function handleNearSpace({ token: uuid, distance, units, mustMove=false, item="", near=null }) {
  const doc = await fromUuid(uuid);
  const object = doc?.object;
  if ( !object ) return null;
  // §402 : `near` (uuids de tokens) — la case est à `distance` de l'une de ces créatures, pas de la position du token (Frappe du vent
  // d'acier : « à 1,50 m de l'une des cibles ») ; le trajet n'est pas borné.
  const anchors = (near ?? []).map(u => fromUuidSync(u, { strict: false })).filter(Boolean);
  const reach = lengthIn(distance, units, doc.parent.grid.units);
  const limit = anchors.length ? Infinity : reach;
  const label = `${Math.round(reach * 10) / 10} ${doc.parent.grid.units}`;
  if ( !mustMove ) {
    const answer = await timedWait({
      window: { title: item || doc.name, icon: "fa-solid fa-person-rays" },
      content: `<p>${foundry.utils.escapeHTML(loc(anchors.length ? "EspaceProche.QuestionCibles" : "EspaceProche.Question", { name: doc.name, distance: label }))}</p>`,
      buttons: [{ action: "stay", label: loc("EspaceProche.Rester"), icon: "fa-solid fa-location-dot", default: true },
        { action: "move", label: loc("EspaceProche.Choisir", { distance: label }), icon: "fa-solid fa-arrows-to-dot" }]
    }, { fallback: "stay", awaiting: { actor: doc.actor, kind: "choice" } });
    if ( answer !== "move" ) return null;
  } else ui.notifications.info(loc("EspaceProche.Occupe", { name: doc.name, distance: label }));
  return whileAwaiting(doc.actor, "choice", async () => {
    teleporting = { token: doc, limit };
    try {
      for ( let attempt = 0; attempt < 5; attempt++ ) {
        object.control({ releaseOthers: true });
        let timer = null;
        const timeout = new Promise(resolve => { timer = setTimeout(() => { canvas.tokens._cancelMovementPlanning?.(); resolve(null); }, NEAR_SPACE_MS); });
        const plan = await Promise.race([object.planMovement({ allowedActions: ["blink"], direct: true, ...(Number.isFinite(limit) ? { maxDistance: limit } : {}), preventDrop: true }), timeout]);
        clearTimeout(timer);
        const chosen = teleporting.chosen;
        teleporting.chosen = null;
        const to = plan?.destination ?? (chosen ? { ...chosen, elevation: doc._source.elevation ?? 0 } : null);
        if ( !to ) return null;
        // Un clic n'est pas borné par la planification du cœur : la portée se relit ici.
        const travelled = distanceBetween(doc, doc, { posB: { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation } }).value;
        // §411 : ce qui cloche (trop loin, case prise, hors de vue) se dit dans une fenêtre — forcer, sinon choisir une autre case.
        const at = { x: to.x, y: to.y, elevation: to.elevation ?? doc._source.elevation ?? 0 };
        const lines = [];
        if ( travelled > limit + 1e-6 ) lines.push(loc("Teleport.TropLoin", { distance: Math.round(limit * 10) / 10, units: doc.parent.grid.units }));
        if ( anchors.length && !anchors.some(a => distanceBetween(doc, a, { posA: at }).value <= reach + 1e-6) ) {
          lines.push(loc("EspaceProche.TropLoinCibles", { distance: label }));
        }
        lines.push(...teleportIssues(null, doc, to).map(i => i.line));
        if ( lines.length && !(await askAnyway(`${item || doc.name} — ${doc.name}`, [...new Set(lines)], { actor: doc.actor, token: doc })) ) continue;
        await doc.move([{ x: to.x, y: to.y, elevation: doc._source.elevation ?? 0, action: "blink", snapped: true }],
          { ...(lines.length ? { constrainOptions: { ignoreTokens: true } } : {}), [MODULE_ID]: { cleared: true } });
        log(`${doc.name}: comes back in the chosen space (${Math.round(travelled * 10) / 10} ${doc.parent.grid.units})`);
        return { x: to.x, y: to.y };
      }
      return null;
    } finally { teleporting = null; }
  });
}
