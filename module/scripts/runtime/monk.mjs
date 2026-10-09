/**
 * Le Moine (SPEC §24) : ce qui suit un coup. Sur le MJ actif, une fois l'attaque résolue et ses dégâts appliqués
 * (`dnd5e-combat.resolution`) :
 *  - Frappe étourdissante : une fois par tour, après un coup d'une arme de moine ou d'une frappe à mains nues, s'il reste un point
 *    de concentration, la question au moine (`askChoice` : le joueur, sinon le MJ) ; oui : le point dépensé, la sauvegarde de
 *    Constitution de l'item jouée sur la cible (Étourdi sur un échec ; ralentie et l'attaque suivante contre elle avec l'Avantage
 *    sur une réussite — contenu `savedEffects`, `effectEnds`) ;
 *  - Technique de la main ouverte : après un coup d'une frappe du Déluge de coups (carte marquée `flurry`), la question :
 *    Déstabiliser, Repousser ou Renverser — l'activité de l'item jouée sur la cible.
 * Arts martiaux et Déluge de coups (coût des frappes) : runtime/turn.mjs ; la visée des frappes du Déluge : ui/pointer.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { currentTurnKey } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc } from "./shared.mjs";

/** La règle d'un item de l'acteur (et l'item), ou null. */
function ruleOf(actor, key) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.[key];
    if ( rule ) return { item, rule };
  }
  return null;
}

/** Une frappe à mains nues, ou une arme de moine (arme courante de corps à corps, arme de guerre de corps à corps Légère). */
function monkWeapon(activity) {
  const item = activity?.item;
  if ( (activity?.type !== "attack") || !item ) return false;
  if ( (identifierOf(item).id === "unarmed-strike") || (activity.attack?.type?.classification === "unarmed") ) return true;
  const type = item.system?.type?.value;
  return (item.type === "weapon") && ((type === "simpleM") || ((type === "martialM") && item.system.properties?.has?.("lgt")));
}

/** Les utilisations restantes de l'item de cet identifiant, et l'item. */
function focusOf(actor, identifier) {
  const item = actor?.items?.find(i => identifierOf(i).id === identifier);
  const left = Number(item?.system?.uses?.value);
  return { item, left: Number.isFinite(left) ? left : 0 };
}

function speakerToken(message) {
  const { scene, token } = message?.speaker ?? {};
  return game.scenes.get(scene)?.tokens.get(token) ?? null;
}

async function stunningStrike(source, target, activity) {
  const found = ruleOf(source.actor, "stunningStrike");
  if ( !found || !monkWeapon(activity) ) return;
  const key = currentTurnKey();
  if ( key && (source.actor.getFlag(MODULE_ID, "stunTurn") === key) ) return;   // « une fois par tour »
  const focus = focusOf(source.actor, found.rule.focus);
  if ( !focus.item || (focus.left < 1) ) return;
  const save = found.item.system.activities?.get(found.rule.activity);
  if ( !save ) return;
  const answer = await askChoice(source.actor, {
    actor: source.actor.uuid, item: found.item.name,
    prompt: loc("Moine.Etourdissante.Question", { name: target.name, n: focus.left }),
    options: [{ id: "no", label: loc("Moine.Non") }, { id: "yes", label: loc("Moine.Etourdissante.Oui") }]
  });
  if ( answer?.id !== "yes" ) return log(`${found.item.name}: ${source.name} does not attempt to stun ${target.name}`);
  if ( key ) await source.actor.setFlag(MODULE_ID, "stunTurn", key);
  await focus.item.update({ "system.uses.spent": (Number(focus.item.system.uses.spent) || 0) + 1 });
  log(`${found.item.name}: ${source.name} spends a point, ${target.name} makes a Constitution saving throw`);
  await strikeAgainst(save, source, target, { flavor: "DND5ECOMBAT.Moine.Carte" });
}

async function openHand(source, target) {
  const found = ruleOf(source.actor, "openHand");
  if ( !found ) return;
  const choices = Object.entries(found.rule).map(([key, id]) => ({ key, activity: found.item.system.activities?.get(id) })).filter(c => c.activity);
  if ( !choices.length ) return;
  const answer = await askChoice(source.actor, {
    actor: source.actor.uuid, item: found.item.name,
    prompt: loc("Moine.MainOuverte.Question", { name: target.name }),
    options: [...choices.map(c => ({ id: c.key, label: loc(`Moine.MainOuverte.${c.key}`) })), { id: "none", label: loc("Moine.Non") }]
  });
  const chosen = choices.find(c => c.key === answer?.id);
  if ( !chosen ) return log(`${found.item.name}: nothing against ${target.name}`);
  log(`${found.item.name}: ${chosen.key} against ${target.name}`);
  await strikeAgainst(chosen.activity, source, target, { flavor: "DND5ECOMBAT.Moine.Carte" });
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack ) return;
  const usage = game.messages.get(resolution.origin ?? "");
  const attackMessage = game.messages.get(resolution.attack?.messageId ?? "");
  const source = speakerToken(attackMessage) ?? speakerToken(usage);
  const activity = fromUuidSync(resolution.activity, { strict: false });
  if ( !source?.actor || !activity ) return;
  for ( const t of resolution.targets ?? [] ) {
    if ( t.hit !== true ) continue;
    const target = fromUuidSync(t.token, { strict: false });
    if ( !target?.actor || ((target.actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    if ( usage?.getFlag(MODULE_ID, "flurry") ) await openHand(source, target);
    await stunningStrike(source, target, activity);
  }
}

export function registerMonk() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`monk:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "Monk: Stunning Strike or Open Hand Technique not offered" });
}
