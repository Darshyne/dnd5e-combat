/**
 * §120 : l'auteur regagne une part des dégâts qu'il inflige (clé `lifesteal`) — Caresse du vampire : « la cible subit 3d6 dégâts
 * nécrotiques, et vous regagnez des PV égaux à la moitié des dégâts nécrotiques infligés ».
 * Même circuit que la Morsure vampirique (runtime/empower.mjs) : le montant se lit au calcul des dégâts, résistances comprises, sur
 * le client qui les applique ; les PV de l'auteur se rendent une fois ceux de la cible écrits. Pas de question : le soin est dû.
 */

import { MODULE_ID } from "../constants.mjs";
import { lifestealAmount } from "../core/drain.mjs";
import { damageSourceItem } from "../adapter/drain.mjs";
import { contentOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

function onCalculateDamage(actor, damages, options) {
  const item = damageSourceItem(options);
  const rule = item ? contentOf(item).entry?.lifesteal : null;
  if ( !rule || !item.actor || (item.actor === actor) ) return;
  const n = lifestealAmount(damages, rule);
  if ( n > 0 ) (options[MODULE_ID] ??= {}).lifesteal = { n, item: item.uuid };
}

async function onApplyDamage(victim, amount, options) {
  const l = options?.[MODULE_ID]?.lifesteal;
  if ( !l ) return;
  const item = fromUuidSync(l.item, { strict: false });
  const caster = item?.actor;
  if ( !caster?.isOwner || ((caster.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  await caster.applyDamage([{ value: l.n, type: "healing" }]);
  const token = tokenOf(caster);
  if ( token ) notice(token, loc("Vol.Retour", { n: l.n }), "gain");
  log(`${item.name}: ${caster.name} regains ${l.n} HP from ${victim.name}`);
}

export function registerLifesteal() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "life steal: amount not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "life steal: HP not regained" });
}
