/**
 * Enchanter l'arme d'une créature choisie (SPEC §16.41, clé `enchantTarget` : Arme élémentaire). dnd5e 6 applique un
 * enchantement par `EnchantActivity#applyEnchantment` (documents/activity/enchant.mjs:151) : durée de l'activité
 * (`getAppliedEffectChanges`, mixin.mjs:1205), lien à la concentration (`flags.dnd5e.dependentOn` : retiré quand elle tombe),
 * restrictions vérifiées (`canEnchant`, enchant.mjs:237 : pas une arme déjà magique…). Ce qui manquait : choisir la créature
 * et son arme (dnd5e attend un glisser-déposer sur la carte), et l'appliquer à l'arme d'un autre personnage (le MJ actif).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";

/** Ce que l'enchantement de cette activité vise (« weapon », « ownWeapon »), ou null. */
export function enchantTargetOf(activity) {
  return (activity?.type === "enchant") && activity.item ? (contentOf(activity.item).entry?.enchantTarget ?? null) : null;
}

/** Les armes de cet acteur, et pour chacune ce qui l'empêche d'être enchantée (null si rien). */
export function enchantableWeapons(activity, actor) {
  return (actor?.items ?? []).filter(i => i.type === "weapon").map(item => {
    const errors = activity.canEnchant?.(item) ?? [];
    return { uuid: item.uuid, name: item.name, img: item.img, refusal: errors.length ? errors.map(e => e.message).join(" ") : null };
  });
}

/** La règle de pacte de l'item (`pact`), ou null. */
export function pactRuleOf(item) {
  return item ? (contentOf(item).entry?.pact ?? null) : null;
}

/** §16.45 : ses propres armes que le pacte accepte (pas l'attaque à mains nues, qui est une arme « naturelle »). */
export function ownPactWeapons(activity) {
  return enchantableWeapons(activity, activity.actor).filter(w => fromUuidSync(w.uuid)?.system?.type?.value !== "natural");
}

/** §16.45 : l'arme de pacte se choisit dans le compendium de dnd5e — corps à corps, courante ou de guerre, non magique. */
export function pickConjuredWeapon() {
  const locked = { documentClass: "Item", types: new Set(["weapon"]), additional: { type: { simpleM: 1, martialM: 1 }, properties: { mgc: -1 } } };
  return dnd5e.applications.CompendiumBrowser.selectOne({ filters: { locked } });
}

/**
 * §16.45 : invoque l'arme dans l'inventaire (une copie de l'arme du compendium, marquée `flags["dnd5e-combat"].conjuredBy` = uuid
 * de l'item du pacte) ; les armes invoquées précédemment par ce pacte disparaissent. Sur le client du lanceur. Rend l'arme.
 */
export async function conjureWeapon(activity, sourceUuid) {
  const actor = activity.actor;
  const source = await fromUuid(sourceUuid);
  if ( !source ) return null;
  const old = actor.items.filter(i => i.getFlag(MODULE_ID, "conjuredBy") === activity.item.uuid).map(i => i.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("Item", old);
  const data = source.toObject();
  delete data._id;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.conjuredBy`, activity.item.uuid);
  foundry.utils.setProperty(data, "system.equipped", true);
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  return item ?? null;
}

/** Applique l'enchantement choisi à l'arme (MJ actif : l'arme peut être celle d'un autre personnage). */
export async function applyEnchantmentTo(activity, item, { profile, message=null, concentration=null }) {
  return activity.applyEnchantment(profile, item, { chatMessage: message, concentration, strict: true });
}
