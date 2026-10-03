/**
 * Réserve qui absorbe les dégâts (SPEC §16.11, B14 : Égide arcanique), lue et écrite dans Foundry. Le contenu déclare
 * `absorb` sur l'item (core/content.mjs) ; les PV de la réserve sont les utilisations de l'item (`system.uses` :
 * `value` restant, `max` = 2 × niveau de magicien + mod. d'Int dans le PHB) ; la réserve n'existe qu'une fois créée
 * (`activeAfter` : l'activité « créer l'égide », une utilisation par repos long, dépensée).
 *
 * Vérifié dans dnd5e 6.0.3 : `dnd5e.preApplyDamage(actor, amount, updates, options)` est appelé avant l'écriture, sur le
 * client qui applique (documents/actor/actor.mjs, `applyDamage`) : `updates` se réécrit ; `amount` = dégâts après
 * résistances, avant PV temporaires. L'égide prend les dégâts « à la place » de la créature : avant ses PV temporaires.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";

/** Les réserves actives d'un acteur : `{ item, rule, pool }`. */
export function poolsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.absorb;
    if ( !rule ) continue;
    if ( rule.activeAfter ) {
      const creator = item.system.activities?.get(rule.activeAfter);
      if ( !(creator?.uses?.spent > 0) ) continue;   // pas encore créée depuis le dernier repos
    }
    const pool = Number(item.system.uses?.value) || 0;
    out.push({ item, rule, pool });
  }
  return out;
}

/**
 * §38 : la réserve active d'un AUTRE acteur, désignée par l'uuid de son item (Égide projetée : l'égide du magicien prend les
 * dégâts d'un allié), ou null si elle n'existe pas ou n'est pas créée.
 */
export function poolOfItem(uuid) {
  const item = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return item?.actor ? (poolsOf(item.actor).find(p => p.item === item) ?? null) : null;
}

/**
 * `dnd5e.preApplyDamage` : la réserve absorbe ce qu'elle peut, la mise à jour des PV est recalculée sur le reste.
 * Ce qui a été absorbé est gardé dans `options` (la dépense de la réserve, après l'écriture ; les 0 PV, §17).
 * `options["dnd5e-combat"].absorbInto` (§38) : l'uuid de l'item d'une réserve d'un autre acteur, qui absorbe la première (« si ces
 * dégâts réduisent l'égide à 0 PV, la créature protégée subit le reste » ; `amount` est déjà après résistances, comme le veut le texte).
 */
export function absorbDamage(actor, amount, updates, options) {
  if ( !(amount > 0) ) return;
  const hp = actor?.system?.attributes?.hp;
  if ( !hp ) return;
  let left = amount;
  const spent = [];
  const foreign = poolOfItem(options?.[MODULE_ID]?.absorbInto);
  for ( const { item, pool } of [...(foreign ? [foreign] : []), ...poolsOf(actor)] ) {
    if ( !(left > 0) || !(pool > 0) ) continue;
    const take = Math.min(pool, left);
    left -= take;
    spent.push({ item: item.uuid, name: item.name, take, before: pool });
  }
  if ( !spent.length ) return;
  const absorbed = amount - left;
  // Même calcul que `applyDamage`, sur ce qui reste : les PV temporaires d'abord, puis les PV (bornés à 0).
  const temp = hp.temp ?? 0;
  const deltaTemp = Math.min(temp, left);
  const deltaHp = Math.min(hp.value, left - deltaTemp);
  updates["system.attributes.hp.temp"] = temp - deltaTemp;
  updates["system.attributes.hp.value"] = hp.value - deltaHp;
  options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), absorbed: (options[MODULE_ID]?.absorbed ?? 0) + absorbed, pools: spent };
}

/** `dnd5e.applyDamage` : la réserve dépense ce qu'elle a absorbé, et le chat le dit. */
export async function spendPools(actor, options) {
  const pools = options?.[MODULE_ID]?.pools ?? [];
  for ( const { item: uuid, name, take, before } of pools ) {
    const item = fromUuidSync(uuid, { strict: false });
    if ( !item ) continue;
    await item.update({ "system.uses.spent": (Number(item.system.uses?.spent) || 0) + take });
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor ?? actor }),   // §38 : l'égide projetée parle pour son magicien
      content: `<p>${game.i18n.format("DND5ECOMBAT.Absorbe", { item: name, n: take, rest: Math.max(0, before - take) })}</p>`,
      flags: { [MODULE_ID]: { absorbed: { item: item.system.identifier, actor: actor.uuid, amount: take, rest: Math.max(0, before - take) } } }
    });
  }
  return pools;
}

/**
 * La réserve est créée (`activeAfter` : l'activité « créer l'égide » vient d'être utilisée) : elle part pleine, comme le
 * veut la règle. L'activité du PHB rend `@item.uses.max` utilisations, mais l'item du compendium arrive avec 11
 * utilisations dépensées pour un maximum de 5 au niveau 1 (vu en jeu le 2026-09-24) : rendre le maximum ne la remplit pas.
 */
async function fillOnCreate(message, item) {
  const rule = item ? contentOf(item).entry?.absorb : null;
  const activityId = message.getAssociatedActivity?.()?.id ?? message.system?.activity?.id ?? null;
  if ( !rule?.activeAfter || (activityId !== rule.activeAfter) ) return;
  if ( (Number(item.system.uses?.spent) || 0) === 0 ) return;
  await item.update({ "system.uses.spent": 0 });
}

/**
 * Un sort lancé avec un emplacement recharge les réserves qui le demandent (`recharge: { school, perLevel }` : Égide
 * arcanique : un sort d'abjuration la recharge du double du niveau de l'emplacement). MJ actif uniquement.
 * @param {ChatMessage} message  Le message d'utilisation (`type: "usage"`).
 * @returns {Promise<Array<{name: string, gained: number}>>}
 */
export async function rechargePools(message) {
  const spell = message.getAssociatedItem?.();
  const actor = message.getAssociatedActor?.();
  await fillOnCreate(message, spell);
  const level = Number(message.system?.level) || 0;
  if ( !spell || !actor || (spell.type !== "spell") || (level < 1) ) return [];
  // « Avec un emplacement » : ni tour de magie, ni rituel, ni sort « à volonté » ou par utilisations d'objet.
  const method = spell.system?.method ?? spell.system?.preparation?.mode;
  if ( method && !["spell", "prepared", "always", "pact"].includes(method) ) return [];
  const out = [];
  for ( const { item, rule } of poolsOf(actor) ) {
    const r = rule.recharge;
    if ( !r || (spell.system?.school !== r.school) ) continue;
    const spent = Number(item.system.uses?.spent) || 0;
    const gained = Math.min(spent, r.perLevel * level);
    if ( !(gained > 0) ) continue;
    await item.update({ "system.uses.spent": spent - gained });
    out.push({ name: item.name, gained });
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("DND5ECOMBAT.Recharge", { item: item.name, n: gained, spell: spell.name })}</p>`,
      flags: { [MODULE_ID]: { recharged: { item: item.system.identifier, actor: actor.uuid, amount: gained } } }
    });
  }
  return out;
}
