/**
 * §436 : l'antimagie, règles pures. dnd5e 6.1 porte le statut `antimagic` (posé par le comportement de région `dnd5e.antimagic`) et
 * suspend lui-même les effets `system.magical` et les bonus des objets magiques d'un acteur qui le porte ; le moteur ajoute ce que le
 * système ne fait pas (refuser de lancer, protéger les cibles, borner la téléportation) et marque les effets magiques comme le ferait la
 * migration de dnd5e.
 */

/** L'identifiant du statut de dnd5e 6.1 (`CONFIG.DND5E.statusEffects.antimagic`). */
export const ANTIMAGIC_STATUS = "antimagic";

/** Le type du comportement de région de dnd5e 6.1 qui pose le statut. */
export const ANTIMAGIC_BEHAVIOR = "dnd5e.antimagic";

/**
 * Un item dont les effets sont magiques — la règle de la migration de dnd5e (`_migrateEffectMagical`) : un sort, un parchemin, ou un
 * item à la propriété `mgc` ; §436 : ou une capacité que le contenu dit magique (`magical`).
 * @param {{type?: string, subtype?: string, properties?: Iterable<string>, magical?: boolean}} item
 */
export function isMagicalSource(item) {
  if ( !item ) return false;
  if ( item.magical === true ) return true;
  if ( item.type === "spell" ) return true;
  if ( (item.type === "consumable") && (item.subtype === "scroll") ) return true;
  return new Set(item.properties ?? []).has("mgc");
}

/**
 * Une utilisation que le champ interdit à qui s'y tient, et dont il protège qui s'y tient : un sort lancé (parchemin compris), ou une
 * activité d'un objet magique — sauf l'attaque d'une arme magique, qui frappe comme une arme ordinaire (dnd5e retire déjà son bonus,
 * `magicAvailable`).
 * @param {{spellCast?: boolean, item?: object, activityType?: string, magical?: boolean}} use
 */
export function isMagicalUse({ spellCast=false, item=null, activityType=null, magical=false }={}) {
  // §436 : une activité `cast` (sort lancé par une capacité ou un objet) ; une capacité que le contenu dit magique (`magical`).
  if ( spellCast || magical || (activityType === "cast") ) return true;
  if ( !isMagicalSource(item) ) return false;
  return !((item.type === "weapon") && (activityType === "attack"));
}

/**
 * Faut-il marquer `system.magical` sur cet effet ? Un effet ordinaire (type `base`, pas un état ni une concentration), pas encore
 * marqué, dont l'item d'origine est magique.
 * @param {{type?: string, magical?: boolean, statuses?: Iterable<string>}} effect
 * @param {object|null} originItem   comme pour isMagicalSource
 */
export function shouldMarkMagical(effect, originItem) {
  if ( !effect || effect.magical ) return false;
  if ( (effect.type ?? "base") !== "base" ) return false;
  const statuses = new Set(effect.statuses ?? []);
  if ( statuses.has("concentrating") || statuses.has(ANTIMAGIC_STATUS) ) return false;
  return isMagicalSource(originItem);
}

/**
 * Une activité que dnd5e cache **seulement** à cause du statut antimagie, et que le moteur peut donc proposer de forcer : dnd5e la refuse
 * (`canUse` faux) parce qu'elle exige la magie (`visibility.requireMagic`, mis sur tout sort et toute activité « cast ») et que l'item
 * n'en a plus (`magicAvailable` faux sous le statut), l'item lui-même reste utilisable, et c'est une utilisation magique. Toute autre
 * raison de la cacher (harmonisation, identification, niveau) n'est pas levée par le forçage : pas de proposition.
 * @param {{inAntimagic?: boolean, canUse?: boolean, itemCanUse?: boolean, requireMagic?: boolean, magicAvailable?: boolean,
 *   otherHidden?: boolean, magicalUse?: boolean}} facts
 */
export function blockedByAntimagic({ inAntimagic=false, canUse=true, itemCanUse=true, requireMagic=false, magicAvailable=true,
  otherHidden=false, magicalUse=false }={}) {
  return inAntimagic && !canUse && (itemCanUse !== false) && requireMagic && (magicAvailable === false) && !otherHidden && magicalUse;
}
