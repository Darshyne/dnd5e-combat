/**
 * `damageByCount` (core/damage-by-count.mjs) : Anneau des étoiles filantes. L'utilisation de l'activité `from` note sur l'item le
 * nombre créé ; le jet de dégâts de l'activité déclarée prend la formule de ce nombre. Rien de noté : la donnée reste telle quelle.
 */

import { MODULE_ID } from "../constants.mjs";
import { countOfUse, formulaForCount } from "../core/damage-by-count.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const FLAG = "damageByCount";

async function onPostUse(activity, usageConfig, results) {
  const rules = activity?.item ? contentOf(activity.item).entry?.damageByCount : null;
  if ( !rules || !results?.message || !Object.values(rules).some(r => r.from === activity.id) ) return;
  const count = countOfUse(usageConfig?.scaling);
  await activity.item.setFlag(MODULE_ID, `${FLAG}.${activity.id}`, count);
  log(`${activity.item.name}: ${count} created with ${activity.name}`);
}

function onPreRollDamage(config) {
  const activity = config?.subject;
  const rule = activity?.item ? contentOf(activity.item).entry?.damageByCount?.[activity.id] : null;
  if ( !rule || !config.rolls?.length ) return true;
  const count = activity.item.getFlag(MODULE_ID, `${FLAG}.${rule.from}`);
  const formula = formulaForCount(rule, count);
  if ( !formula ) return true;
  config.rolls[0].parts = [formula];
  log(`${activity.item.name}: ${activity.name} deals ${formula} (${count} created)`);
  return true;
}

export function registerDamageByCount() {
  route("dnd5e.postUseActivity", onPostUse, { label: "damage by count: number not noted" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "damage by count: formula not set" });
}
