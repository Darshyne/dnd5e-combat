/**
 * §95 : se relever à 0 PV (clé `atZero`, adapter/rise.mjs), sur le MJ actif. Les PV viennent de tomber à 0 sans tuer : la question à
 * la créature (« se relever ? », oui d'abord) ; la sauvegarde si la règle en demande une (Force du tombeau : Charisme, DD 5 + les dégâts
 * subis, relevés au `dnd5e.applyDamage`) ; puis l'activité, utilisée sur elle — ses consommations ou son soin la relèvent. Refusé ou
 * raté : elle tombe comme d'habitude (`ensureDowned`). Comme la Rage implacable (runtime/barbarian.mjs), l'état « à terre » n'est pas
 * posé tant que la décision n'est pas prise (adapter/death.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { riseAtZeroOf, settleRise, resetRise, beginRise, endRise } from "../adapter/rise.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { ensureDowned } from "../adapter/death.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

const lastDamage = new Map();

function onZero(actor) {
  if ( !riseAtZeroOf(actor) ) return;
  return enqueue(`rise:${actor.uuid}`, async () => {
    await new Promise(resolve => setTimeout(resolve, 400));   // dnd5e pose son état à 0 PV sur le client qui a écrit les PV
    const found = riseAtZeroOf(actor);
    if ( !found ) return;
    const { item, rule, activity } = found;
    settleRise(actor);
    beginRise(actor);
    let down = false;
    try { down = await decide(actor, item, rule, activity); }
    finally { endRise(actor); }
    if ( down ) await ensureDowned(actor);
  });
}

/** La décision et ce qui suit ; rend true si la créature doit tomber (refusé, sauvegarde ratée, toujours à 0 PV). */
async function decide(actor, item, rule, activity) {
  {
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name, prompt: loc("Relever.Question", { item: item.name, name: actor.name }),
      options: [{ id: "yes", label: loc("Relever.Oui", { item: activity.name || item.name }) }, { id: "no", label: loc("Relever.Non") }]
    });
    if ( answer?.id !== "yes" ) { log(`${item.name}: ${actor.name} doesn't rise`); return true; }
    if ( rule.save ) {
      let dc = 10;
      try { dc = Math.max(1, Math.round(Roll.safeEval(Roll.replaceFormulaData(rule.save.dc, { ...actor.getRollData(), damage: lastDamage.get(actor.uuid) ?? 0 })))); } catch { /* DD 10 */ }
      const rolls = await actor.rollSavingThrow({ ability: rule.save.ability, target: dc }, { configure: false },
        { data: { flavor: loc("Relever.Carte", { item: item.name, name: actor.name, dc }) } });
      const total = rolls?.[0]?.total;
      if ( !(Number.isFinite(total) && (total >= dc)) ) {
        log(`${item.name}: ${actor.name} fails (${total} vs DC ${dc})`);
        return true;
      }
      log(`${item.name}: ${actor.name} succeeds (${total} vs DC ${dc})`);
    }
    const token = tokenOf(actor);
    if ( token?.object ) canvas.tokens.setTargets([token.id]);
    await activity.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: true } }, { configure: false })
      .catch(err => console.error(`${MODULE_ID} | ${item.name}: rise`, err));
    await new Promise(resolve => setTimeout(resolve, 2500));
    const hp = actor.system.attributes?.hp?.value ?? 0;
    if ( token ) notice(token, loc("Relever.Fait", { name: actor.name, hp }), "gain");
    log(`${item.name}: ${actor.name} rises with ${hp} Hit Points`);
    return hp <= 0;
  }
}

function onHp(actor, value) {
  if ( value === 0 ) return onZero(actor);
  if ( value > 0 ) resetRise(actor);
}

export function registerRise() {
  // Les dégâts subis (Force du tombeau : DD 5 + les dégâts), sur le client qui les applique.
  route("dnd5e.applyDamage", (actor, amount) => { if ( actor && (amount > 0) ) lastDamage.set(actor.uuid, amount); }, { label: "rise: damage not recorded" });
  route("updateActor", (actor, changed) => {
    const v = foundry.utils.getProperty(changed, "system.attributes.hp.value");
    if ( v !== undefined ) return onHp(actor, v);
  }, { executor: true, label: "rise at 0 Hit Points not played" });
  route("updateToken", (token, changed) => {
    const v = foundry.utils.getProperty(changed, "delta.system.attributes.hp.value");
    if ( v !== undefined ) return onHp(token.actor, v);
  }, { executor: true, label: "rise at 0 Hit Points not played (unlinked token)" });
}
