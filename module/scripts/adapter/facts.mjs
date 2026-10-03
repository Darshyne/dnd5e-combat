/**
 * Les FAITS sur lesquels une condition du registre peut porter (core/triggers.mjs), lus dans
 * dnd5e 6.0. Séparés des déclarations pour que la validation du contenu (adapter/content.mjs)
 * connaisse les clés sans dépendre du registre.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - un effet posé par le plateau d'effets porte son origine dans `system.origin`
 *    (`activity`, `item`, `effect`, `message`), et `ActiveEffect5e#prepareBaseData` en fait
 *    `effect.origin` (documents/active-effect.mjs:332-335) : on retrouve l'item d'où vient un
 *    effet, donc son identifiant et son acteur.
 */

import { seesBetween, canSee } from "./vision.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { distanceBetween } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { isWithinRange } from "../core/units.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { isDeadActor } from "./death.mjs";
import { isObjectToken } from "./bodies.mjs";
import { hasNotActedYet } from "../core/sneak.mjs";
import { isSpellCast, spellSchoolOf } from "./scrolls.mjs";

/** Rangs de taille de dnd5e (config.mjs, `actorSizes`), pour « de taille G ou inférieure ». */
const SIZE_RANK = Object.freeze({ tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 });

/** Le token d'un acteur sur la scène courante : celui donné, sinon son token lié, sinon le premier posé. */
export function tokenOf(actor, given=null) {
  if ( given ) return given;
  if ( !actor ) return null;
  if ( actor.token ) return actor.token;
  return actor.getActiveTokens?.(true, true)?.[0] ?? null;
}

/** L'item d'où vient un effet posé sur un acteur, ou null. */
export function originItemOf(effect) {
  const origin = effect.system?.origin ?? {};
  const uuid = origin.activity ?? origin.item ?? effect.origin;
  const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  if ( doc ) return doc.documentName === "Item" ? doc : (doc.item ?? null);
  // §53 : l'item n'existe plus (une potion bue, dernière de sa pile) — dnd5e garde une copie de l'item détruit dans le message
  // d'utilisation (`deltas.deleted`, documents/chat-message.mjs `getAssociatedItem`), que l'effet référence.
  if ( uuid && origin.message ) {
    // `origin.message` est un uuid (« ChatMessage.<id> »), vu en jeu le 2026-10-02.
    const stored = game.messages?.get(String(origin.message).split(".").pop())?.getAssociatedItem?.();
    if ( stored?.documentName === "Item" ) return stored;
  }
  // Un effet transféré par un item de l'acteur (don, objet équipé) vit sur l'item lui-même.
  return effect.parent?.documentName === "Item" ? effect.parent : null;
}

/**
 * §16.36 : l'acteur porte-t-il un effet actif d'un item qui l'empêche de bénéficier de l'état Invisible (Poussière d'étoile,
 * Lueurs féeriques : `revealsInvisible`) ? Seulement s'il est Invisible — sinon il n'y a rien à retirer.
 */
export function revealedInvisible(actor) {
  if ( !actor?.statuses?.has?.("invisible") ) return false;
  for ( const effect of actor.appliedEffects ?? actor.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.revealsInvisible === true) ) return true;
  }
  return false;
}

/**
 * L'effet vient-il de l'effet d'item de cet id ? Le plateau d'effets de dnd5e copie l'effet d'item en gardant sa source
 * (`_stats.duplicateSource`, ou `compendiumSource` depuis un compendium : effect-application.mjs, `_prepareEffectData`).
 */
export function comesFromItemEffect(effect, id) {
  if ( effect.id === id ) return true;
  const stats = effect._stats ?? {};
  return [stats.duplicateSource, stats.compendiumSource].some(uuid => typeof uuid === "string" && uuid.endsWith(`.ActiveEffect.${id}`));
}

/**
 * L'acteur porte-t-il un effet actif venant d'un item de cet identifiant — et, si `source` est donné, de cet acteur-là ?
 * `spec` : l'identifiant, ou `{ item, effect }` pour UN effet de l'item (§37 : Malédiction — « Cursed Resilience », pas les
 * autres malédictions du même sort).
 */
function hasEffectFrom(actor, spec, source=null) {
  const identifier = (typeof spec === "string") ? spec : spec?.item;
  const effectId = (typeof spec === "string") ? null : (spec?.effect ?? null);
  // `appliedEffects` (cœur) : les effets de l'acteur ET ceux que ses items lui transfèrent — dnd5e 6 ne recopie plus
  // ces derniers dans `actor.effects` (vu le 2026-09-25, scénario `degats-bonus`).
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    if ( effectId && !comesFromItemEffect(effect, effectId) ) continue;
    const item = originItemOf(effect);
    if ( !item || (identifierOf(item).id !== identifier) ) continue;
    if ( !source || (item.actor?.uuid === source.uuid) ) return true;
  }
  return false;
}

/** « À 10 ft ou moins » entre deux tokens (3D, unité de la grille), ou null si l'un manque. */
function within(a, b, { distance, units }) {
  if ( !a || !b || (a.parent !== b.parent) ) return null;
  try { return isWithinRange(distanceBetween(a, b), { value: distance, units }, readUnitFactors()); }
  catch { return null; }
}

/**
 * Tactique de meute : « au moins un allié de l'attaquant à 5 ft de la cible, qui n'est pas Neutralisé ».
 * Allié = même camp (disposition du token), autre que l'attaquant, sur la même scène, ni vaincu ni caché.
 */
function allyNear(sourceToken, targetToken, range) {
  if ( !sourceToken || !targetToken || (sourceToken.parent !== targetToken.parent) ) return null;
  for ( const other of sourceToken.parent.tokens ) {
    if ( (other === sourceToken) || (other === targetToken) || !other.actor || other.hidden ) continue;
    if ( isObjectToken(other) ) continue;   // un objet piloté (arme, illusion) ou un tas au sol n'est pas un allié (§16.15, §16.60)
    if ( other.disposition !== sourceToken.disposition ) continue;
    const statuses = other.actor.statuses ?? new Set();
    if ( INCAPACITATING.some(s => statuses.has(s)) || statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) continue;
    if ( within(other, targetToken, range) === true ) return true;
  }
  return false;
}

/**
 * Duplicité (§16.18) : un objet invoqué par la source avec l'item `item` est-il à `distance` de la cible, et la cible le
 * voit-elle (sans vision simulée, tenu pour vu) ?
 */
function summonNear(source, targetToken, { item, distance, units }={}) {
  if ( !source || !targetToken ) return null;
  for ( const token of targetToken.parent.tokens ) {
    const origin = token.actor?.getFlag("dnd5e", "summon.origin");
    if ( !origin || token.hidden ) continue;
    const from = fromUuidSync(origin, { strict: false });
    if ( (from?.actor?.uuid !== source.uuid) || (item && (from.system?.identifier !== item)) ) continue;
    if ( within(token, targetToken, { distance, units }) !== true ) continue;
    if ( canSee(targetToken, token) === false ) continue;
    return true;
  }
  return false;
}

/**
 * Assassinat (§20) : au premier round du combat en cours, la cible n'a-t-elle pas encore joué son tour ? Hors combat : non.
 * Le rang de la cible est celui de son token dans l'ordre du combat (`combat.turns`).
 */
function notActedYet(targetToken) {
  const combat = game.combat;
  if ( !combat?.started || !targetToken ) return false;
  const index = combat.turns.findIndex(c => (c.tokenId === targetToken.id) && (c.sceneId === targetToken.parent?.id));
  return hasNotActedYet({ round: combat.round, turn: combat.turn, targetTurn: (index < 0) ? null : index });
}

/** Les types de dégâts qu'une activité peut infliger : ses parts, et les dégâts de base de l'arme qu'elle reprend. */
function damageTypesOf(activity) {
  const out = new Set();
  for ( const part of activity?.damage?.parts ?? [] ) for ( const t of part.types ?? [] ) out.add(t);
  if ( activity?.damage?.includeBase ) for ( const t of activity.item?.system?.damage?.base?.types ?? [] ) out.add(t);
  return Array.from(out);
}

/** Est-ce le tour de cet acteur dans le combat en cours ? Hors combat : non. */
function ownTurn(actor) {
  const current = game.combat?.started ? game.combat.combatant?.actor : null;
  return !!current && !!actor && (current.uuid === actor.uuid);
}

/** Les PV d'un acteur et leur maximum en vigueur (`effectiveMax` : max + tempmax, data/actor/templates/attributes.mjs:468). */
function hpOf(actor) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp ) return null;
  return { value: hp.value ?? 0, max: hp.effectiveMax ?? ((hp.max ?? 0) + (hp.tempmax ?? 0)) };
}
export const isWounded = actor => { const hp = hpOf(actor); return !!hp && (hp.max > 0) && (hp.value < hp.max); };
const isBloodied = actor => { const hp = hpOf(actor); return !!hp && (hp.max > 0) && (hp.value > 0) && (hp.value <= hp.max / 2); };

/** Le type de créature d'un acteur (« undead », « fiend »…), tel que dnd5e le range dans `details.type.value`. */
export const creatureTypeOf = actor => actor?.system?.details?.type?.value ?? null;

/** Les états contre lesquels un acteur est immunisé (`traits.ci` de dnd5e : « charmed », « exhaustion »…). */
export const conditionImmunitiesOf = actor => Array.from(actor?.system?.traits?.ci?.value ?? []);

/**
 * Les faits d'un moment. `source` : qui agit ; `target` : qui subit ; `activity` : ce qui est utilisé ;
 * `sourceToken` / `targetToken` : leurs tokens quand le moment les connaît (sinon retrouvés par l'acteur).
 * Une clé absente ici est inconnue du cœur, et une condition qui l'emploie ne tient jamais.
 */
export function factsFor({ source=null, target=null, activity=null, sourceToken=null, targetToken=null, attackMode=null, damageTypes=null, condition=null, self=null, selfToken=null }={}) {
  const properties = activity?.item?.system?.properties;
  // « Une attaque au corps à corps » : activité d'attaque de type mêlée, sauf un jet en mode lancé ou à distance
  // (même règle que dnd5e, data/activity/attack-data.mjs, `getRollData` : `roll.attack.type`).
  const ranged = !!attackMode && (attackMode.includes("thrown") || (attackMode === "ranged"));
  const isMelee = (activity?.type === "attack") && (activity.attack?.type?.value === "melee") && !ranged;
  return {
    "activity.type": activity?.type ?? null,
    "activity.isAttack": activity?.type === "attack",
    "activity.isSpell": isSpellCast(activity?.item),   // §48 : un parchemin aussi
    "activity.isWeapon": activity?.item?.type === "weapon",
    "activity.isMelee": isMelee,
    "activity.identifier": activity?.item ? identifierOf(activity.item).id : null,
    "activity.id": activity?.id ?? null,
    // §32 : un sort de cette classe (Sorcellerie innée : « sorts d'Ensorceleur ») — `system.sourceClass`, ou la classe de l'acteur.
    "activity.classSpell": cls => (activity?.item?.type === "spell")
      && ((activity.item.system.sourceClass || (activity.item.actor?.classes?.[cls] ? cls : null)) === cls),
    // §32 : l'acteur résiste à ce type de dégâts (Affinité élémentaire : le type choisi est celui de la résistance donnée).
    "source.resists": type => (source?.system?.traits?.dr?.value?.has?.(type) ?? source?.system?.traits?.dr?.value?.includes?.(type)) === true,
    // §29 : l'item porte un enchantement venu d'un item de cet identifiant (arme de pacte : « pact-of-the-blade » ; Décharge
    // répulsive posée sur la Décharge occulte : « repelling-blast »).
    "activity.enchantedBy": id => (activity?.item?.effects ?? []).some(e => !e.disabled && (e.isAppliedEnchantment ?? (e.type === "enchantment"))
      && (identifierOf(originItemOf(e) ?? {}).id === id)),
    // §28 : l'école d'un sort (`system.school` : "evo" Évocation, "abj" Abjuration…) — Évocation améliorée.
    "activity.school": spellSchoolOf(activity?.item),   // §48 : celle du sort d'un parchemin
    // §27 : « tout sort mineur de Clerc » (Incantation puissante) — un tour de magie rangé sous cette classe (`system.sourceClass`) ;
    // un sort ajouté à la main n'en a pas : il compte si l'acteur a cette classe.
    "activity.cantripOf": cls => (activity?.item?.type === "spell") && (Number(activity.item.system.level) === 0)
      && ((activity.item.system.sourceClass || (activity.item.actor?.classes?.[cls] ? cls : null)) === cls),
    // §24 : « ses dégâts comptent des dégâts contondants, perforants ou tranchants » (Parade) — les types des parts de l'activité,
    // et ceux de l'arme si elle les reprend. Sans activité connue (pré-contrôle « peut-il réagir ? », runtime/reactions.mjs,
    // `canReactToHit`), on tient pour oui : la vraie fenêtre, elle, connaît l'attaque.
    "activity.dealsType": types => !activity || damageTypesOf(activity).some(t => [types].flat().includes(t)),
    // Propriété de l'item (clés de dnd5e : "hvy" Lourde, "two" Deux mains, "fin" Finesse, "sil" Argentée…).
    "activity.hasProperty": id => (properties?.has?.(id) ?? properties?.includes?.(id)) === true,
    "source.hasStatus": id => source?.statuses?.has(id) === true,
    "source.hasEffect": id => hasEffectFrom(source, id),
    // §30 : sous une Forme sauvage (dnd5e : l'acteur métamorphosé, `isPolymorphed`) — Attaques primitives, Forme lunaire.
    "source.wildShaped": want => (!!source?.isPolymorphed === want),
    // §26 : « le dé de votre Marque du chasseur passe à d10 » (Tueur implacable) — l'acteur a-t-il un item de cet identifiant ?
    "source.hasFeature": id => (source?.items ?? []).some(i => identifierOf(i).id === id),
    "target.hasStatus": id => target?.statuses?.has(id) === true,
    "target.hasEffect": id => hasEffectFrom(target, id),
    "target.hasEffectFrom": id => hasEffectFrom(target, id, source),
    // §37 : l'attaquant porte un effet que la CIBLE a posé (Malédiction : « Désavantage aux jets d'attaque contre vous »).
    "source.hasEffectFromTarget": id => hasEffectFrom(source, id, target),
    // Type de créature de l'attaquant (Protection contre le mal et le bien : aberration, céleste, élémentaire, fée, fiélon, mort-vivant).
    "source.creatureType": creatureTypeOf(source),
    // §16.8 : le type de la cible (« humanoid »…) et ses immunités aux états (Sommeil : immunité à l'Épuisement).
    "target.creatureType": creatureTypeOf(target),
    "target.immuneTo": id => conditionImmunitiesOf(target).includes(id),
    // Armure d'Agathys : « tant que vous avez ces PV temporaires ». { "target.hasTempHp": true | false }.
    "target.hasTempHp": want => (((target?.system?.attributes?.hp?.temp ?? 0) > 0) === want),
    // §16.47 : Stabilisation — « à 0 point de vie et qui n'est pas morte ».
    "target.atZero": want => ((((target?.system?.attributes?.hp?.value ?? 1) <= 0)) === want),
    "target.isDead": want => (isDeadActor(target) === want),
    // §19.6 : un seuil de PV (par exemple 50 ou moins).
    "target.hpAtMost": n => ((target?.system?.attributes?.hp?.value ?? Infinity) <= n),
    // Domaine de la Tombe : une créature blessée (Attraction de la mort) ; « En sang » (règles
    // 2024 : à la moitié de ses PV ou moins — Sentinelle au seuil de la mort). Maximum en vigueur : `hp.effectiveMax`.
    "target.wounded": want => (isWounded(target) === want),
    // §22 : « à chacun de vos tours » (Fureur divine, Frénésie) — c'est le tour de la source dans le combat en cours.
    "source.onOwnTurn": want => (ownTurn(source) === want),
    // Assassinat (§20) : une créature qui n'a pas encore agi, au premier round du combat.
    "target.hasNotActed": want => (notActedYet(tokenOf(target, targetToken)) === want),
    "target.bloodied": want => (isBloodied(target) === want),
    // « Quand vous atteignez le niveau 11 de clerc » : { class: "cleric", level: 11 } (identifiant de classe de dnd5e).
    "source.classLevelAtLeast": ({ class: cls, level }={}) => ((source?.classes?.[cls]?.system?.levels ?? 0) >= level),
    // Tactique de meute : un allié de l'attaquant, non Neutralisé, à { distance, units } de la cible.
    // Duplicité : l'illusion de l'attaquant à { item, distance, units } de la cible, qui la voit.
    "source.summonNearTarget": rule => summonNear(source, tokenOf(target, targetToken), rule ?? {}) === true,
    "source.allyNearTarget": range => allyNear(tokenOf(source, sourceToken), tokenOf(target, targetToken), range ?? {}) === true,
    // « De taille G ou inférieure » : rang de dnd5e (tiny < sm < med < lg < huge < grg).
    "target.sizeAtMost": size => {
      const rank = SIZE_RANK[target?.system?.traits?.size];
      return (rank !== undefined) && (SIZE_RANK[size] !== undefined) && (rank <= SIZE_RANK[size]);
    },
    // « Une créature située à 10 ft ou moins de vous » : { distance, units }, en 3D (P2). Sans tokens : on ne sait pas, faux.
    "target.within": range => within(tokenOf(source, sourceToken), tokenOf(target, targetToken), range ?? {}) === true,
    // P1 : « une créature que vous pouvez voir ». Quand on ne peut pas le dire (vision hors service,
    // pas de token), on tient pour vu : la vision restreint, elle n'interdit jamais par ignorance.
    "target.seesSource": want => ((seesBetween(target, source) ?? true) === want),
    // « Si l'assaillant voit la cible » (Lueurs féeriques). Même repli : sans vision, on tient pour vu.
    "source.seesTarget": want => ((seesBetween(source, target) ?? true) === want),
    // §19 : fenêtre « blessé » — les dégâts reçus comptent-ils l'un de ces types ? (Absorption des éléments : acide, froid,
    // feu, foudre, tonnerre.) Types inconnus (dégâts hors résolution) : faux.
    "damage.hasType": types => (damageTypes ?? []).some(t => [types].flat().includes(t)),
    // §19.8 : fenêtre « subit un état » — l'état subi est-il l'un de ceux-là ?
    "condition.gained": ids => !!condition && [ids].flat().includes(condition),
    // Fenêtre « un autre est touché » (allyIsHit) : `self` est la créature qui peut réagir, `target` celle qui est touchée —
    // une créature En sang, visible, à 18 m au plus (Sentinelle au seuil de la mort).
    "target.nearSelf": range => within(tokenOf(self, selfToken), tokenOf(target, targetToken), range ?? {}) === true,
    "self.seesTarget": want => ((seesBetween(self, target) ?? true) === want),
    // §34 : l'attaquant à portée du réacteur (Éclat protecteur : une créature visible à 9 m au plus).
    "source.nearSelf": range => within(tokenOf(self, selfToken), tokenOf(source, sourceToken), range ?? {}) === true,
    "self.seesSource": want => ((seesBetween(self, source) ?? true) === want)
  };
}
