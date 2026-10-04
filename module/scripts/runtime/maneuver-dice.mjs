/**
 * §89 : dés de manœuvre joués à l'action Bonus (Maître de guerre).
 *
 *  - `pendingDie` `{ activity, against }` : utiliser l'activité PROMET son dé (la première part de dégâts, lue avec les données de
 *    l'acteur : « 1d8 ») au prochain jet de dégâts d'une attaque de l'auteur, dans ce tour — au corps à corps (`"melee"`, Fente :
 *    « si vous touchez d'une attaque au corps à corps ce tour-ci ») ou contre la créature désignée à l'utilisation (`"target"`, Feinte :
 *    « si cette attaque touche »). Promesse portée par l'acteur (`flags.dnd5e-combat.pendingDie`) ; ajoutée au jet de dégâts sur le
 *    client de l'auteur (`dnd5e.preRollDamageV2`, du type du premier jet), puis effacée. Contre une cible : une attaque ratée contre
 *    elle l'efface aussi (« votre prochain jet d'attaque ») — sur le MJ actif, à la résolution. Hors du tour où elle est née : rien.
 *  - `rolledAc` `{ activity, effect }` : utiliser l'activité lance le dé de son `roll` (Jeu de jambes évasif : « lancez le dé et
 *    ajoutez-le à votre CA jusqu'au début de votre prochain tour ») et pose l'effet de l'item sur l'auteur, le bonus de CA écrit
 *    dedans (l'effet de la donnée est vide).
 * Le dé lui-même est payé par la consommation de l'activité (un dé de supériorité), comme dnd5e le fait.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { currentTurnKey } from "../adapter/turn.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const FLAG = "pendingDie";

/** La formule de la première part de dégâts de l'activité, lue avec les données de l'acteur. */
function dieOf(activity) {
  const part = activity?.damage?.parts?.[0];
  const raw = part?.custom?.enabled ? part.custom.formula : ((part?.number && part?.denomination) ? `${part.number}d${part.denomination}` : null);
  return raw ? Roll.replaceFormulaData(raw, activity.getRollData?.() ?? {}) : null;
}

async function onPostUse(activity, usageConfig, results) {
  const entry = activity?.item ? contentOf(activity.item).entry : null;
  const actor = activity?.actor;
  if ( !entry || !actor || !results ) return;
  const pending = (entry.pendingDie?.activity === activity.id) ? entry.pendingDie : null;
  if ( pending ) {
    const formula = dieOf(activity);
    const target = (pending.against === "target") ? (results.message?.system?.targets?.[0]?.token ?? Array.from(game.user.targets)[0]?.document?.uuid ?? null) : null;
    if ( formula ) {
      await actor.setFlag(MODULE_ID, FLAG, { item: activity.item.uuid, name: activity.item.name, formula, against: pending.against, target, turn: currentTurnKey() });
      log(`${activity.item.name} : +${formula} promis au prochain coup ${pending.against === "target" ? "contre la cible" : "au corps à corps"} de ce tour`);
    }
  }
  const rolled = (entry.rolledAc?.activity === activity.id) ? entry.rolledAc : null;
  if ( rolled && activity.roll?.formula ) {
    const roll = await new Roll(activity.roll.formula, activity.getRollData()).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: `${activity.item.name} : ${activity.roll.name || "CA"}` });
    // Après la résolution de l'utilitaire, qui pose l'effet de la donnée (vide) : on le remplace par le nôtre, le bonus écrit dedans.
    await new Promise(r => setTimeout(r, 1500));
    const effect = await placeItemEffect(activity.item, rolled.effect, actor);
    if ( effect ) {
      await effect.update({ "system.changes": [{ key: "system.attributes.ac.bonus", type: "add", value: String(roll.total) }] });
      log(`${activity.item.name} : +${roll.total} à la CA de ${actor.name}`);
    }
  }
}

function onPreRollDamage(config, dialog, message) {
  const activity = config?.subject;
  const actor = activity?.actor;
  const pending = actor?.getFlag(MODULE_ID, FLAG);
  if ( !pending || !config.rolls?.length || (activity.type !== "attack") ) return true;
  if ( pending.turn !== currentTurnKey() ) { actor.unsetFlag(MODULE_ID, FLAG).catch(() => {}); return true; }
  if ( (pending.against === "melee") && (activity.attack?.type?.value !== "melee") ) return true;
  if ( pending.against === "target" ) {
    const targets = foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [];
    if ( !targets.some(t => t.token === pending.target) ) return true;
  }
  const type = config.rolls[0]?.options?.type ?? null;
  config.rolls.push({ data: activity.getRollData(), parts: [pending.formula], options: { type, types: type ? [type] : [], properties: [] } });
  actor.unsetFlag(MODULE_ID, FLAG).catch(() => {});
  log(`${pending.name} : +${pending.formula} ${type ?? ""}`);
  return true;
}

/** Feinte : une attaque RATÉE contre la cible désignée éteint la promesse (« votre prochain jet d'attaque contre elle »). */
async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack ) return;
  const source = fromUuidSync(resolution.source ?? "", { strict: false });
  const actor = source?.actor ?? source;
  const pending = actor?.getFlag?.(MODULE_ID, FLAG);
  if ( !pending || (pending.against !== "target") ) return;
  const missed = (resolution.targets ?? []).some(t => (t.token === pending.target) && (t.hit === false));
  if ( missed ) {
    await actor.unsetFlag(MODULE_ID, FLAG);
    log(`${pending.name} : l'attaque contre la cible a raté, le dé est perdu`);
  }
}

export function registerManeuverDice() {
  route("dnd5e.postUseActivity", onPostUse, { label: "manœuvre : dé promis ou CA non posés" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "manœuvre : dé promis" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "manœuvre : dé promis non éteint" });
}
