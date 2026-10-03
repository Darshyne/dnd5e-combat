/**
 * Furtivité (Hide, SPEC §15.2, règles 2024), sur le client de celui qui se cache :
 *  - l'item Furtivité utilisé : test de Discrétion DD 15 ; réussi, un effet Invisible est posé, qui porte le
 *    total (le DD pour vous localiser). La vision simulée fait le reste (avantage de l'attaquant non vu,
 *    qui voit qui) ;
 *  - la Furtivité cesse aussitôt après un jet d'attaque, ou un sort à composante verbale.
 * Être localisé (action Observation d'un ennemi) ou faire du bruit reste au MJ : il retire l'effet.
 * Les conditions (hors de vue de tout ennemi) sont vérifiées par la légalité (runtime/turn.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionOfActivity } from "../adapter/basics.mjs";
import { hiddenEffectsOf, hiddenEffectData } from "../adapter/hide.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";

/** DD du test de Discrétion (règle 2024). */
const HIDE_DC = 15;

async function endHiding(actor, why) {
  const effects = hiddenEffectsOf(actor);
  if ( !effects.length || !actor.isOwner ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
  log(`furtivité : ${actor.name} n'est plus caché (${why})`);
  ui.notifications.info(loc("Furtivite.Fin", { name: actor.name }));
}

async function onPostUse(activity, usageConfig) {
  const actor = activity.actor;
  if ( !actor ) return;
  // L'item Furtivité, ou une activité qui prend l'action Se cacher (Ruse du Roublard, par une action Bonus : §20).
  if ( basicActionOfActivity(activity, usageConfig?.[MODULE_ID]?.basicChoice) === "hide" ) {
    const rolls = await actor.rollSkill({ skill: "ste", target: HIDE_DC }, { configure: false });
    const total = rolls?.[0]?.total;
    if ( !Number.isFinite(total) ) return;
    if ( total < HIDE_DC ) {
      log(`furtivité : ${actor.name} échoue (${total} contre DD ${HIDE_DC})`);
      return ui.notifications.info(loc("Furtivite.Rate", { name: actor.name, total }));
    }
    await actor.deleteEmbeddedDocuments("ActiveEffect", hiddenEffectsOf(actor).map(e => e.id));
    await actor.createEmbeddedDocuments("ActiveEffect", [hiddenEffectData(total, loc("Furtivite.Effet", { dc: total }))]);
    log(`furtivité : ${actor.name} est caché (${total}, DD ${total} pour le localiser)`);
    return ui.notifications.info(loc("Furtivite.Reussie", { name: actor.name, total }));
  }
  // Un sort à composante verbale trahit la cachette.
  if ( isSpellCast(activity.item) && activity.item.system.properties?.has("vocal") ) await endHiding(actor, "sort à composante verbale");
}

export function registerHide() {
  route("dnd5e.postUseActivity", (activity, usageConfig) => { onPostUse(activity, usageConfig).catch(err => console.error(`${MODULE_ID} | furtivité`, err)); },
    { label: "furtivité" });
  // « Vous cessez d'être caché aussitôt après… un jet d'attaque » : après le jet, qui a profité de l'invisibilité.
  route("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    const actor = subject?.actor;
    if ( actor ) endHiding(actor, "jet d'attaque").catch(err => console.error(`${MODULE_ID} | furtivité`, err));
  }, { label: "furtivité : fin au jet d'attaque" });
}
