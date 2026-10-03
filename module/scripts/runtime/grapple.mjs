/**
 * L'empoignade en jeu (SPEC §15.2, règles 2024, glossaire « Agrippé » et « Attaque à mains nues »).
 *
 * Sur le MJ actif :
 *  - l'agrippeur porte une marque visible « Agrippe : <victime> », liée à l'effet Agrippé de la victime :
 *    posée avec lui, retirée avec lui ; supprimer la marque libère la victime (lâcher prise) ;
 *  - « Déplaçable » : quand l'agrippeur marche (pas une téléportation), sa victime le suit, à sa place
 *    relative ou sur la case libre à son contact la plus proche — jamais dans une autre créature ; un pas
 *    `displace`, sans attaque d'opportunité. Le surcoût (déplacement doublé) est dans le plafond du tour
 *    (runtime/actions.mjs) ;
 *  - l'empoignade cesse d'elle-même quand l'agrippeur est neutralisé ou que la distance dépasse sa
 *    portée (poussée, téléportation, victime qu'on n'a pas pu poser).
 * Pour toute créature agrippée : S'échapper (menu contextuel sur son token, ou item d'action de base) —
 * test d'Athlétisme ou d'Acrobaties, le meilleur, contre le DD de l'agrippeur, pour une action.
 * Vitesse 0 : dnd5e la pose déjà (`noMovement`, data/actor/templates/attributes.mjs:533-537) ; le moteur
 * refuse en plus le déplacement volontaire d'un agrippé avec un message clair (runtime/actions.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { grappleHolds } from "../core/conditions.mjs";
import { spendUse } from "../core/turn.mjs";
import {
  grappleEffectsOf, grappleFacts, escapeDcOf, grapplerOf, grappleSceneOf,
  grapplingMarksOf, grapplingMarkData, grappledTokenOf, victimsOf, actorOfEffect
} from "../adapter/grapple.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { swallowerOf } from "../adapter/swallow.mjs";
import { escapeSwallow } from "./swallow.mjs";
import { escapableRestraintsOf } from "../adapter/escape.mjs";
import { ownEndingsOf, endOwn } from "./action-end.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { dragDestination } from "../adapter/movement.mjs";
import { combatantFor, readBudget, writeBudget, isOwnTurn, committedPosition } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

/* -------------------------------------------- */
/*  Tient-elle encore ?                         */
/* -------------------------------------------- */

/** Empoignades dont l'agrippeur est introuvable : signalées une fois, pas à chaque vérification. */
const unknownGrapplers = new Set();

/** Retire les empoignades qui ne tiennent plus, sur la scène donnée. */
async function releaseBrokenGrapples(scene) {
  if ( !scene ) return;
  const factors = readUnitFactors();
  for ( const token of scene.tokens ) {
    for ( const effect of grappleEffectsOf(token.actor) ) {
      // Acteur lié : ses effets suivent tous ses tokens ; on ne juge que dans la scène de l'empoignade.
      const where = grappleSceneOf(effect);
      if ( where && (where !== scene.id) ) continue;
      const facts = grappleFacts(effect, token, factors);
      if ( !facts ) {
        if ( !unknownGrapplers.has(effect.uuid) ) log(`empoignade : agrippeur de ${token.name} introuvable sur sa scène (${scene.name}), rien à juger`);
        unknownGrapplers.add(effect.uuid);
        continue;
      }
      if ( grappleHolds(facts) ) continue;
      await effect.delete();
      log(`empoignade rompue : ${token.name} n'est plus agrippé par ${facts.grappler.name}`
        + ` — distance ${facts.distance?.value} ${facts.distance?.units} (portée ${facts.reach?.value} ${facts.reach?.units}),`
        + ` états de l'agrippeur [${facts.grapplerStatuses.join(", ")}], ${facts.grapplerToken.name} ${facts.grapplerToken._source.x},${facts.grapplerToken._source.y}`
        + ` / ${token.name} ${token._source.x},${token._source.y}`);
      ui.notifications.info(loc("Empoignade.Rompue", { name: token.name, by: facts.grappler.name }));
    }
  }
}

/**
 * Vérification regroupée : les évènements arrivent en rafale (déplacement, effets d'aura, états de tour).
 * Les scènes à vérifier s'ACCUMULENT jusqu'au passage — la dernière demande ne remplace pas les autres.
 */
const pendingScenes = new Set();
let timer = null;
function scheduleCheck(scenes) {
  for ( const scene of scenes ) if ( scene ) pendingScenes.add(scene);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const list = Array.from(pendingScenes);
    pendingScenes.clear();
    for ( const scene of list ) await releaseBrokenGrapples(scene).catch(err => console.error(`${MODULE_ID} | empoignade`, err));
  }, 300);
}

/** Les scènes où un acteur a un token — toutes, pas seulement celle qu'affiche ce client (`Actor#getDependentTokens`). */
function scenesOf(actor) {
  if ( actor.isToken ) return [actor.token?.parent];
  return (actor.getDependentTokens?.({ concreteOnly: true }) ?? []).map(t => t.parent);
}

/* -------------------------------------------- */
/*  La marque de l'agrippeur                    */
/* -------------------------------------------- */

/** Un Agrippé posé avec un agrippeur connu : la marque « Agrippe : <victime> » sur l'agrippeur. */
async function markGrappler(effect) {
  if ( !effect.statuses?.has("grappled") ) return;
  const grappler = grapplerOf(effect);
  const victim = grappledTokenOf(effect);
  if ( !grappler || !victim ) return;
  if ( grapplingMarksOf(grappler).some(m => m.getFlag(MODULE_ID, "grappling").effect === effect.uuid) ) return;
  await grappler.createEmbeddedDocuments("ActiveEffect", [grapplingMarkData(loc("Empoignade.Marque", { name: victim.name }), victim, effect)]);
  log(`empoignade : ${grappler.name} agrippe ${victim.name} (marque posée)`);
}

/** Un effet supprimé : l'Agrippé emporte la marque ; la marque (lâcher prise) emporte l'Agrippé. */
async function unlink(effect) {
  const grappling = effect.getFlag?.(MODULE_ID, "grappling");
  if ( grappling ) {
    const grappled = fromUuidSync(grappling.effect);
    if ( grappled && !grappled._destroyed ) {
      await grappled.delete();
      log(`empoignade : ${effect.parent?.name} lâche prise`);
    }
    return;
  }
  if ( !effect.statuses?.has("grappled") ) return;
  const grappler = grapplerOf(effect);
  const marks = grapplingMarksOf(grappler).filter(m => m.getFlag(MODULE_ID, "grappling").effect === effect.uuid);
  if ( marks.length ) await grappler.deleteEmbeddedDocuments("ActiveEffect", marks.map(m => m.id));
}

/** Les marques par lesquelles ce token agrippe cette victime (vide s'il ne l'agrippe pas). */
export function holdsOf(grapplerToken, victimToken) {
  return grapplingMarksOf(grapplerToken?.actor).filter(m => m.getFlag(MODULE_ID, "grappling").target === victimToken?.uuid);
}

/**
 * §18.23 : relâcher sa victime (règles 2024 : quand on veut, sans action). La marque retirée emporte l'Agrippé de la
 * victime (`unlink`, sur le MJ actif) : le propriétaire de l'agrippeur n'a besoin d'aucun droit sur elle.
 */
export async function releaseGrapple(grapplerToken, victimToken) {
  const marks = holdsOf(grapplerToken, victimToken);
  if ( !marks.length ) return;
  await grapplerToken.actor.deleteEmbeddedDocuments("ActiveEffect", marks.map(m => m.id));
  ui.notifications.info(loc("Empoignade.Relache", { name: grapplerToken.name, target: victimToken.name }));
}

/* -------------------------------------------- */
/*  Traîner sa victime                          */
/* -------------------------------------------- */

/** L'agrippeur a marché : ses victimes suivent. Une téléportation ne traîne personne (l'empoignade cesse). */
async function dragVictims(token, movement, operation) {
  if ( operation?.[MODULE_ID]?.dragged ) return;
  const victims = victimsOf(token);
  if ( !victims.length ) return;
  const passed = movement.passed?.waypoints ?? [];
  if ( passed.some(w => CONFIG.Token.movement.actions[w.action]?.teleport || (w.action === "displace")) ) return;
  const from = movement.origin ?? passed[0];
  const to = committedPosition(token);
  if ( !from ) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = (to.elevation ?? 0) - (from.elevation ?? 0);
  for ( const victim of victims ) {
    // §18.17 : le Tertre errant « engloutit » en agrippant — sa victime est DANS son espace, l'avalement la fait suivre.
    if ( swallowerOf(victim)?.token === token ) continue;
    const pos = committedPosition(victim);
    const spot = dragDestination(victim, token, { x: pos.x + dx, y: pos.y + dy });
    if ( !spot ) { log(`empoignade : ${victim.name} ne peut être posé près de ${token.name}`); continue; }
    await victim.move([{ x: spot.x, y: spot.y, elevation: (pos.elevation ?? 0) + dz, level: to.level, snapped: true, action: "displace" }],
      { [MODULE_ID]: { cleared: true, dragged: true } });
    log(`empoignade : ${token.name} traîne ${victim.name}`);
  }
}

/* -------------------------------------------- */
/*  S'échapper                                  */
/* -------------------------------------------- */

/**
 * §16.54 : se libérer d'une entrave par le test que son item écrit (Enchevêtrement : Force (Athlétisme) contre le DD de
 * sauvegarde des sorts du lanceur). La réussite retire l'effet de la créature, pas le sort : les autres restent pris.
 */
async function escapeRestraint(actor, { effect, item, ability, skill, dc }) {
  const rolls = skill
    ? await actor.rollSkill({ skill, ...(ability ? { ability } : {}), target: dc }, { configure: false })
    : await actor.rollAbilityCheck({ ability, target: dc }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return false;
  const free = total >= dc;
  log(`${actor.name} ${free ? "se libère de" : "ne se libère pas de"} ${item.name} (${total} contre DD ${dc})`);
  ui.notifications.info(loc(free ? "Entrave.Libere" : "Entrave.Rate", { name: actor.name, source: item.name }));
  if ( free ) await effect.delete();
  return free;
}

/** Plusieurs choses dont s'échapper (une empoignade et une entrave…) : laquelle ? La première sans réponse. */
async function pickEscape(actor, options) {
  const answer = await timedWait({
    window: { title: loc("Menu.Echapper"), icon: "fa-solid fa-person-running" },
    content: `<p>${loc("Entrave.Choisir", { name: actor.name })}</p>`,
    buttons: options.map((o, i) => ({ action: String(i), label: o.label, default: i === 0 }))
  }, { fallback: "0" });
  return (answer === null) ? null : options[Number(answer)] ?? null;
}

/** Le test d'évasion, sur le client de celui qui s'échappe. true si libre. */
async function attemptEscape(actor) {
  // §18.21 : avalé par un item qui porte son propre test d'évasion (Cube gélatineux, Tertre errant).
  const swallowed = await escapeSwallow(actor);
  if ( swallowed !== null ) return swallowed;
  const options = [
    ...grappleEffectsOf(actor).slice(0, 1).map(effect => ({ kind: "grapple", effect,
      label: loc("Entrave.Empoignade", { by: grapplerOf(effect)?.name ?? "?" }) })),
    ...escapableRestraintsOf(actor).map(r => ({ kind: "restraint", ...r, label: r.item.name })),
    // §43.2 : les effets auxquels une action du porteur met fin (contenu `actionEnds`) — par le test de l'item (comme une
    // entrave), par la sauvegarde du sort rejouée, ou sans jet.
    ...ownEndingsOf(actor).map(e => e.check
      ? { kind: "restraint", effect: e.effect, item: e.item, ...e.check, label: e.item.name }
      : { kind: "ending", ending: e, label: e.item.name })
  ];
  if ( !options.length ) { ui.notifications.info(loc("Entrave.Rien", { name: actor.name })); return false; }
  const chosen = (options.length === 1) ? options[0] : await pickEscape(actor, options);
  if ( !chosen ) return false;
  if ( chosen.kind === "restraint" ) return escapeRestraint(actor, chosen);
  if ( chosen.kind === "ending" ) return endOwn(chosen.ending);
  const effect = chosen.effect;
  const dc = escapeDcOf(effect);
  if ( dc === null ) { ui.notifications.warn(loc("Empoignade.DDInconnu", { name: actor.name })); return false; }
  const skills = actor.system.skills ?? {};
  const skill = ((skills.acr?.total ?? -Infinity) > (skills.ath?.total ?? -Infinity)) ? "acr" : "ath";
  const rolls = await actor.rollSkill({ skill, target: dc }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return false;
  if ( total >= dc ) {
    await effect.delete();
    log(`${actor.name} s'échappe (${total} contre DD ${dc})`);
    ui.notifications.info(loc("Empoignade.Echappe", { name: actor.name, by: grapplerOf(effect)?.name ?? "" }));
    return true;
  }
  log(`${actor.name} ne s'échappe pas (${total} contre DD ${dc})`);
  ui.notifications.info(loc("Empoignade.Rate", { name: actor.name }));
  return false;
}

/**
 * S'échapper, pour toute créature agrippée (menu contextuel) : par son item d'action de base s'il en a un
 * (légalité et budget comme n'importe quel item), sinon — un PNJ — le test directement, et l'action
 * débitée du budget du tour.
 * @param {TokenDocument} token
 * @param {{event?: Event}} [options]
 */
export async function escapeGrapple(token, { event=null }={}) {
  const actor = token?.actor;
  if ( !actor ) return;
  const item = actor.items.find(i => basicActionOf(i) === "escape");
  const activity = item?.system.activities?.contents?.[0];
  if ( activity ) return activity.use({ event });
  const combatant = combatantFor(actor);
  if ( combatant ) {
    const before = readBudget(combatant);
    await writeBudget(combatant, spendUse(before, { cost: "action", weaponAttack: false, usesSpellSlot: false },
      { isOwnTurn: isOwnTurn(combatant), attacksPerAction: 1 }));
  }
  await attemptEscape(actor);
}

/** S'échapper par l'item, sur le client de l'auteur, après l'utilisation (la carte et le budget sont faits). */
async function onPostUse(activity) {
  if ( basicActionOf(activity.item) !== "escape" ) return;
  await attemptEscape(activity.actor);
}

export function registerGrapple() {
  const check = { executor: true, label: "empoignade : tient-elle encore ?" };
  route("updateToken", (token, changes) => {
    if ( ["x", "y", "elevation", "level"].some(k => k in changes) ) scheduleCheck([token.parent]);
  }, check);
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => {
      const actor = actorOfEffect(effect);   // un token non lié : l'effet est dans son ActorDelta
      if ( actor ) scheduleCheck(scenesOf(actor));
    }, check);
  }
  const marks = { executor: true, label: "empoignade : marque de l'agrippeur" };
  route("createActiveEffect", effect => markGrappler(effect), marks);
  route("deleteActiveEffect", effect => unlink(effect), marks);
  route("moveToken", (token, movement, operation) => dragVictims(token, movement, operation),
    { executor: true, label: "empoignade : la victime suit l'agrippeur" });
  route("dnd5e.postUseActivity", activity => { onPostUse(activity).catch(err => console.error(`${MODULE_ID} | s'échapper`, err)); },
    { label: "s'échapper" });
}
