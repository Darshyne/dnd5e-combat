/**
 * Ordre imposé (SPEC §16.59) : Injonction. MJ actif.
 *  - La résolution close (`dnd5e-combat.resolution`, DONE), chaque cible qui a raté sa sauvegarde reçoit l'effet de l'ordre.
 *    L'ordre : celui que l'intention a fixé sur la carte (`flags["dnd5e-combat"].order`, un scénario), sinon demandé à
 *    l'auteur (adapter/choices.mjs, `askChoice` : son client, puis le MJ ; sans réponse, le premier).
 *  - Au début du tour de la cible (`combatTurnChange`), l'ordre s'exécute : À terre (Rampe), ce qu'elle tient lâché (Lâche),
 *    marche vers le lanceur ou loin de lui (Approche, Fuis, par l'A* du moteur), puis le tour s'achève — plus d'action,
 *    d'action Bonus ni de déplacement (budget : `stopped`). L'effet tombe à la fin de ce tour (contenu : `remove`).
 * Ce qui reste au MJ : une créature qui ne comprend pas l'ordre, l'ordre qui la mettrait en danger évident, les ordres hors
 * de la liste du sort.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { orderPlan } from "../core/orders.mjs";
import { contentOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { orderOn, orderEffectData, dropHeld } from "../adapter/orders.mjs";
import { readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { movementCap, walkToGap, gapBetween } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

const handled = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || handled.has(resolution.origin) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const item = activity?.item;
  const orders = item ? contentOf(item).entry?.orders : null;
  if ( !orders?.length ) return;
  handled.add(resolution.origin);
  const failed = (resolution.targets ?? []).filter(t => t.save && !t.save.success);
  if ( !failed.length ) return;
  const usage = game.messages.get(resolution.origin);
  let order = usage?.getFlag(MODULE_ID, "order");
  if ( !orders.includes(order) ) {
    const caster = activity.actor;
    const answer = caster ? await askChoice(caster, { actor: caster.uuid, item: item.name, prompt: loc("Ordre.Choisir"),
      options: orders.map(o => ({ id: o, label: loc(`Ordre.${o}.Nom`) })) }) : null;
    order = orders.includes(answer?.id) ? answer.id : orders[0];
  }
  const sp = usage?.speaker ?? {};
  const fromToken = (sp.scene && sp.token) ? `Scene.${sp.scene}.Token.${sp.token}` : null;
  const label = loc(`Ordre.${order}.Nom`);
  for ( const t of failed ) {
    const token = await fromUuid(t.token);
    if ( !token?.actor ) continue;
    await token.actor.createEmbeddedDocuments("ActiveEffect", [orderEffectData({ item, activity, order, label, fromToken, message: usage })]);
    log(`${item.name} : ${token.name} doit obéir — ${label}`);
    notice(token, label, "reaction");
  }
}

/** L'ordre s'exécute au début du tour de celui qui le porte. */
async function obey(combatant) {
  const token = combatant?.token;
  const held = orderOn(token?.actor);
  if ( !held || held.done ) return;
  const plan = orderPlan(held.order);
  if ( !plan ) return;
  // La remise à neuf du budget (runtime/turn.mjs, inscrite avant) part au même changement de tour : on la laisse arriver.
  await pause(600);
  await held.effect.setFlag(MODULE_ID, "order", { ...held.effect.getFlag(MODULE_ID, "order"), done: true });
  const caster = held.from ? await fromUuid(held.from) : null;
  const lines = [loc(`Ordre.${held.order}.Execute`, { name: token.name, caster: caster?.name ?? "" })];
  if ( plan.prone ) await token.actor.toggleStatusEffect("prone", { active: true });
  if ( plan.drop ) {
    const dropped = await dropHeld(token);
    lines.push(dropped.items.length ? loc(dropped.pile ? "Ordre.LacheTas" : "Ordre.LacheInventaire", { items: dropped.items.join(", ") })
      : loc("Ordre.RienEnMain", { name: token.name }));
  }
  let arrived = false;
  if ( plan.move && caster ) {
    if ( plan.move === "toward" ) arrived = await walkToGap(token, caster, 0);
    else {
      const movement = movementOf(combatant, readUnitFactors());
      const left = Math.max(0, movementCap(token) - (movement?.spent ?? 0));
      const cells = Math.floor(left / token.parent.grid.distance);
      if ( cells > 0 ) await walkToGap(token, caster, gapBetween(token, caster) + cells);
    }
  }
  // Le combat a pu finir pendant la marche (fenêtre d'attaque d'opportunité, animation) : plus de tour à achever.
  const alive = !!game.combats.get(combatant.parent?.id)?.combatants.get(combatant.id);
  if ( alive && ((plan.ends === "always") || ((plan.ends === "ifArrived") && arrived)) ) {
    await writeBudget(combatant, { ...readBudget(combatant), action: 0, bonus: 0, stopped: true });
    lines.push(loc("Ordre.TourAcheve", { name: token.name }));
  }
  log(`${token.name} obéit (${held.order}) : ${lines.slice(1).join(" ") || "—"}`);
  notice(token, loc(`Ordre.${held.order}.Nom`), "reaction");
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ token }),
    content: lines.map(l => `<p>${foundry.utils.escapeHTML(l)}</p>`).join("")
  });
}

export function registerOrders() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`order:${resolution?.origin}`, () => onResolution(resolution)),
    { executor: true, label: "ordre imposé : effet non posé" });
  route("combatTurnChange", (combat, prior, current) => {
    const combatant = combat.combatants.get(current?.combatantId);
    if ( combatant?.token ) return enqueue(`obey:${combatant.token.uuid}`, () => obey(combatant));
  }, { executor: true, label: "ordre imposé : non exécuté" });
}
