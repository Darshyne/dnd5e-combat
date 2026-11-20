/**
 * Trait qui répond à un type de dégâts subi (`onDamageTaken`, core/damage-traits.mjs) : Gel de l'Élémentaire de l'eau, Aversion au feu du
 * Golem de chair. Les types réellement subis se lisent au calcul des dégâts (`dnd5e.calculateDamage`, comme la Robustesse de la
 * non-vie) ; l'effet du trait est posé sur son porteur une fois les dégâts appliqués (`dnd5e.applyDamage`), par le client du MJ qui
 * les applique. Un effet déjà porté est remplacé : sa durée repart.
 */

import { MODULE_ID } from "../constants.mjs";
import { damageTraitHits } from "../core/damage-traits.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** Les traits du porteur qui déclarent `onDamageTaken`. */
const traitsOf = actor => Array.from(actor?.items ?? []).map(item => ({ item, rule: contentOf(item).entry?.onDamageTaken ?? null }))
  .filter(t => t.rule);

function onCalculateDamage(actor, damages, options) {
  if ( !traitsOf(actor).length ) return;
  (options[MODULE_ID] ??= {}).damageTraitTypes = damages.filter(d => (d.value > 0) && d.type).map(d => d.type);
}

async function onApplyDamage(actor, amount, options) {
  const taken = options?.[MODULE_ID]?.damageTraitTypes;
  if ( !(amount > 0) || !taken?.length || !game.user?.isGM ) return;
  for ( const { item, rule } of traitsOf(actor) ) {
    if ( !damageTraitHits(rule, taken) ) continue;
    const source = item.effects.get(rule.effect);
    if ( !source ) continue;
    const worn = actor.effects.filter(e => (e.origin === item.uuid) && (e.name === source.name)).map(e => e.id);
    if ( worn.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", worn);
    const data = source.toObject();
    delete data._id;
    await actor.createEmbeddedDocuments("ActiveEffect", [{ ...data, origin: item.uuid, transfer: false, disabled: false }]);
    log(`${item.name}: ${actor.name} took ${taken.join(", ")} damage — "${source.name}" applied`);
  }
}

export function registerDamageTraits() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "trait answering a damage type: types not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "trait answering a damage type: effect not applied" });
}
