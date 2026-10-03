/**
 * Défenses de sorts (SPEC §16.46), lues et écrites dans Foundry.
 *  - Résistance : quand le moteur applique des dégâts (par type, avant résistances et PV temporaires), le porteur d'un effet
 *    de l'item retire `formula` aux dégâts du type protégé — le profil se reconnaît à `system.origin.profile` de l'effet appliqué (applications/components/effect-application.mjs:255) ; une fois par tour de
 *    combat (marque sur l'effet).
 *  - Vigueur arcanique : dés de vie dépensés (`system.hd.spent` des classes), soin lancé et appliqué.
 */

import { MODULE_ID } from "../constants.mjs";
import { reduceDamageOfType, hitDiceAllowed } from "../core/defenses.mjs";
import { turnKeyOf } from "../core/area.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

const currentTurnKey = () => (game.combat?.started ? turnKeyOf(game.combat.round, game.combat.turn) : null);

/** Les boucliers de dégâts que porte l'acteur : `{ effect, type, rule }`. */
function shieldsOf(actor) {
  const out = [];
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const rule = contentOf(originItemOf(effect))?.entry?.damageShield;
    if ( !rule ) continue;
    // Le profil d'origine : noté par dnd5e sur l'effet appliqué (`system.origin.profile`, effect-application.mjs:255), sinon
    // la source de la copie.
    const source = String(effect._stats?.duplicateSource ?? effect._stats?.compendiumSource ?? "");
    const profile = effect.system?.origin?.profile ?? source.split(".").pop();
    const type = rule.effects[profile];
    if ( type ) out.push({ effect, type, rule });
  }
  return out;
}

/**
 * Réduit les dégâts du type protégé, au moment où le moteur les applique (adapter/messages.mjs, `applyDamageToToken`) : un vrai
 * jet de dé (le cœur V14 ne lance pas un dé de façon synchrone : un 1d4 évalué dans `dnd5e.preCalculateDamage` valait 0), une
 * seule fois par coup (le hook sert aussi aux aperçus de la carte de chat). Rend `{ damages, done: [{ name, type, reduced,
 * rolled }] }`.
 */
export async function applyDamageShields(actor, damages) {
  let out = damages;
  const done = [];
  const key = currentTurnKey();
  for ( const { effect, type, rule } of shieldsOf(actor) ) {
    if ( !out.some(d => (d.type === type) && (d.value > 0)) ) continue;
    if ( rule.oncePerTurn && key && (effect.getFlag(MODULE_ID, "shieldTurn") === key) ) continue;
    const roll = await new Roll(rule.formula).evaluate();
    const result = reduceDamageOfType(out, type, roll.total);
    if ( !result.reduced ) continue;
    out = result.damages;
    if ( rule.oncePerTurn && key ) await effect.setFlag(MODULE_ID, "shieldTurn", key).catch(() => {});
    done.push({ name: effect.name, type, reduced: result.reduced, rolled: roll.total });
  }
  return { damages: out, done };
}

/** La règle de soin par dés de vie de cette activité (`hitDiceHeal`), ou null. */
export function hitDiceHealOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.hitDiceHeal : null;
  return (rule && (rule.activity === activity.id)) ? rule : null;
}

/** Ce que l'acteur peut dépenser : la plus grande taille disponible, combien il en reste, combien la règle permet. */
export function hitDiceChoice(activity, slotLevel) {
  const hd = activity.actor?.system?.attributes?.hd;
  const die = hd?.largestAvailable ?? "d0";
  const available = hd?.bySize?.[die] ?? 0;
  const rule = hitDiceHealOf(activity);
  const spellLevel = Number(activity.item.system.level) || 0;
  return { die, available, max: rule ? hitDiceAllowed({ base: rule.base, spellLevel, slotLevel, available }) : 0 };
}

/**
 * Dépense `count` dés de vie de taille `die` et soigne l'acteur de leur total + le modificateur d'incantation (données de
 * l'activité, `@mod`). Sur le client du lanceur (son personnage). Rend le jet.
 */
export async function spendHitDiceToHeal(activity, die, count) {
  const actor = activity.actor;
  let left = count;
  for ( const cls of Object.values(actor.classes ?? {}) ) {
    if ( (cls.system.hd.denomination !== die) || (left <= 0) ) continue;
    const take = Math.min(left, cls.system.hd.value);
    if ( take > 0 ) await cls.update({ "system.hd.spent": cls.system.hd.spent + take });
    left -= take;
  }
  const spent = count - left;
  if ( !spent ) return null;
  const roll = await new CONFIG.Dice.DamageRoll(`${spent}${die} + @mod`, activity.getRollData(), { type: "healing" }).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${activity.item.name} — ${spent}${die}` });
  await actor.applyDamage([{ value: roll.total, type: "healing" }]);
  return roll;
}
