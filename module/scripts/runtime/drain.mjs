/**
 * M8 (SPEC §18.16) : le maximum de PV baisse du montant des dégâts subis (Absorption de vie…), ou d'une formule sur une
 * sauvegarde ratée (Drain d'énergie) ; le vampire regagne ce qu'il draine ; réduit à 0, le maximum tue (règles 2024).
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { drainedAmount } from "../core/drain.mjs";
import { setDeathStatus } from "../adapter/death.mjs";
import { drainOf, damageSourceItem, reduceMaximum } from "../adapter/drain.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** Sur le client qui applique les dégâts : la part drainée, gardée pour après l'écriture des PV. */
function onCalculateDamage(actor, damages, options) {
  const item = damageSourceItem(options);
  const rule = drainOf(item);
  if ( !rule?.equal ) return;
  const n = drainedAmount(damages, rule.type, damages.amount);
  if ( n > 0 ) (options[MODULE_ID] ??= {}).drain = { n, item: item.name, source: item.actor?.uuid ?? null, regains: rule.regains };
}

async function drain(actor, n, { item, source=null, regains=false }) {
  const max = await reduceMaximum(actor, n);
  log(`${actor.name} : ${item} — maximum de PV -${n} (${max})`);
  if ( max <= 0 ) {
    await setDeathStatus(actor, "dead");
    log(`${actor.name} : maximum de PV à 0 → Mort`);
  }
  if ( !regains || !source ) return;
  const drinker = fromUuidSync(source, { strict: false });
  if ( !drinker?.isOwner ) return;
  await drinker.applyDamage([{ value: n, type: "healing" }]);
  log(`${drinker.name} : ${item} — regagne ${n} PV`);
}

async function onApplyDamage(actor, amount, options) {
  const d = options?.[MODULE_ID]?.drain;
  if ( d && actor.isOwner ) await drain(actor, d.n, d);
}

/** Drain d'énergie : « Failure: The target's Hit Point maximum decreases by 14 (4d6) » — à la résolution tranchée. MJ actif. */
async function onResolution(resolution) {
  if ( resolution.step !== STEPS.DONE ) return;
  const item = fromUuidSync(resolution.activity ?? "", { strict: false })?.item ?? null;
  const rule = drainOf(item);
  if ( !rule?.fixed ) return;
  for ( const t of resolution.targets ) {
    if ( t.save?.success !== false ) continue;
    const actor = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !actor ) continue;
    const roll = await new Roll(rule.fixed).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor }), flavor: `${item.name} — ${actor.name}` });
    await drain(actor, roll.total, { item: item.name });
  }
}

export function registerDrain() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "drain : part drainée non lue" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "drain : maximum de PV non réduit" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "drain d'énergie : maximum de PV non réduit" });
}
