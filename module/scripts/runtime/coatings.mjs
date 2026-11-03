/**
 * §345 : un enchantement qu'un coup qui touche consomme (`onHit: { whileEnchanted, spends: true }`) — la Dague venimeuse : « le poison
 * reste 1 minute ou jusqu'à ce qu'une attaque avec cette arme touche une créature ». Sur le MJ actif, au hook de sortie du moteur
 * `dnd5e-combat.resolution` (runtime/engine.mjs), une fois l'attaque tranchée et touchée.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { enchantedBy } from "../adapter/usage.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack ) return;
  if ( !(resolution.targets ?? []).some(t => t.hit === true) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const rule = activity?.item ? contentOf(activity.item).entry?.onHit : null;
  if ( !rule?.spends || !rule.whileEnchanted ) return;
  const spent = enchantedBy(activity.item, rule.whileEnchanted);
  if ( !spent.length ) return;
  await activity.item.deleteEmbeddedDocuments("ActiveEffect", spent.map(e => e.id));
  log(`${activity.item.name}: the hit spends ${spent.map(e => e.name).join(", ")}`);
}

export function registerCoatings() {
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "coatings: enchantment spent by a hit" });
}
