/**
 * O9h (§363) : un objet qui peut se retourner contre son porteur (`backfire: { after, chance, activity, destroys? }` — Cor de dévastation :
 * « chaque fois que vous utilisez l'action Magie pour souffler dans le cor, il y a 20 % de chances qu'il explose : 10d6 dégâts de force
 * au souffleur, et le cor est détruit »). MJ actif, au hook de sortie du moteur `dnd5e-combat.resolution` (l'action tranchée), ou, faute
 * de résolution (personne dans la zone), un peu après la carte d'utilisation : un d100 en clair ; `chance` ou moins, l'activité de dégâts
 * `activity` frappe le porteur, puis l'objet est détruit.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

/** Les cartes d'utilisation déjà jugées (une seule fois par souffle). */
const judged = new Set();
/** Le délai laissé à une résolution avant de juger sans elle. */
const FALLBACK_MS = 15000;

function ruleOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.backfire : null;
  return (rule && rule.after.includes(activity.id)) ? rule : null;
}

async function judge(messageId, activity) {
  if ( !messageId || judged.has(messageId) ) return;
  judged.add(messageId);
  const rule = ruleOf(activity);
  const item = activity?.item;
  const actor = item?.actor;
  if ( !rule || !actor || !actor.items.has(item.id) ) return;
  const roll = await new Roll("1d100").evaluate();
  const blows = roll.total <= rule.chance;
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc(blows ? "Explosion.Explose" : "Explosion.Tient", { item: item.name, n: rule.chance }),
    flags: { [MODULE_ID]: { backfire: { item: item.name, roll: roll.total, blows } } } });
  log(`${item.name}: backfire roll ${roll.total} (${rule.chance}% or less) → ${blows ? "explodes" : "holds"}`);
  if ( !blows ) return;
  const token = tokenOf(actor);
  if ( token ) {
    await inflict({ step: { activity: rule.activity }, item, targetUuid: token.uuid,
      speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: loc("Explosion.Degats", { item: item.name, name: actor.name }),
      flags: { backfire: { item: item.name } } });
    notice(token, loc("Explosion.Explose", { item: item.name, n: rule.chance }), "refused", { all: true });
  }
  if ( rule.destroys ) {
    await item.delete();
    log(`${item.name}: destroyed`);
  }
}

function onResolution(resolution) {
  if ( resolution?.step !== STEPS.DONE ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  if ( !ruleOf(activity) ) return;
  enqueue(`backfire:${activity.item.uuid}`, () => judge(resolution.origin ?? resolution.carrier ?? resolution.id, activity));
}

function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
  const activity = message.getAssociatedActivity?.();
  if ( !ruleOf(activity) ) return;
  // Sans résolution du moteur (personne dans le cône), le jet se fait quand même, un peu après.
  setTimeout(() => {
    if ( game.messages.get(message.id)?.getFlag(MODULE_ID, "resolution") ) return;   // la résolution s'en charge
    enqueue(`backfire:${activity.item.uuid}`, () => judge(message.id, activity));
  }, FALLBACK_MS);
}

export function registerBackfire() {
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "backfire: explosion chance not rolled" });
  route("createChatMessage", onUsage, { executor: true, label: "backfire: explosion chance not rolled" });
}
