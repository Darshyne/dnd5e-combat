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

import { areaShapeOf } from "../core/area-shield.mjs";
import { seesBetween, canSee } from "./vision.mjs";
import { chargedFeet } from "./variants.mjs";
import { lightOnToken, inSunlight } from "./illumination.mjs";
import { inRunningWater } from "./running-water.mjs";
import { LIGHT } from "../core/illumination.mjs";
import { contentOf, identifierOf, enchantmentSourcesOf, hasClassFeature } from "./content.mjs";
import { distanceBetween } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { isWithinRange } from "../core/units.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { speedIsZero } from "../core/movement.mjs";
import { subtypeMatches } from "../core/eligibility.mjs";
import { isDeadActor } from "./death.mjs";
import { spellClassOf } from "./spell-class.mjs";
import { isObjectToken } from "./bodies.mjs";
import { hasNotActedYet } from "../core/sneak.mjs";
import { isSpellCast, spellSchoolOf, scrollSpellOf } from "./scrolls.mjs";
import { knownCastLevel, castLevelAtMost, castLevelAtLeast } from "../core/counter.mjs";
import { grapplerOf } from "./grapple.mjs";
import { areEnemies, areAllies } from "./factions.mjs";
import { isVanilla } from "./vanilla-state.mjs";
import { wearsArmor } from "../core/armor.mjs";
import { attackedMatches } from "../core/attacked-this-turn.mjs";
import { attackedDuring } from "./attacked-this-turn.mjs";

/** §484 : ce token se tient-il en lumière vive (torche, sort, jour) ? Sans token : non. */
const isBright = doc => !!doc && (lightOnToken(doc)?.level === LIGHT.BRIGHT);

/**
 * §491 : les pièces d'armure que l'acteur porte (items `equipment` équipés de type light / medium / heavy / shield ; dnd5e config.mjs
 * `armorTypes`), décrites pour `wearsArmor` (core/armor.mjs) : catégorie, armure de base (`system.type.baseItem`, clé de `armorIds`),
 * identifiant, et la matière imposée par l'item (`flags["dnd5e-combat"].metal`).
 */
export function armorPieces(actor) {
  return (actor?.items ?? []).filter(i => (i.type === "equipment") && i.system?.equipped).map(i => {
    const metal = i.flags?.["dnd5e-combat"]?.metal;
    return { category: i.system.type?.value ?? null, base: i.system.type?.baseItem || null, identifier: i.system.identifier ?? null,
      ...(typeof metal === "boolean" ? { metal } : {}) };
  });
}

/** Rangs de taille de dnd5e (config.mjs, `actorSizes`), pour « de taille G ou inférieure ». */
const SIZE_RANK = Object.freeze({ tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 });

/** Le token d'un acteur sur la scène courante : celui donné, sinon son token lié, sinon le premier posé. */
export function tokenOf(actor, given=null) {
  if ( given ) return given;
  if ( !actor ) return null;
  if ( actor.token ) return actor.token;
  return actor.getActiveTokens?.(true, true)?.[0] ?? null;
}

/**
 * §232 : l'item qui enferme cet acteur (Sphère résiliente d'Otiluke, contenu `encloses`) — un de ses effets actifs en vient — ou null.
 * @param {Actor|null} actor
 * @returns {Item|null}
 */
export function enclosingItem(actor) {
  for ( const effect of actor?.effects ?? [] ) {
    // La concentration du lanceur vient aussi de l'item : elle ne l'enferme pas.
    if ( effect.disabled || effect.isSuppressed || effect.statuses?.has?.("concentrating") ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.encloses === true) ) return item;
  }
  return null;
}

/**
 * §232 : la sphère qui sépare deux acteurs — celle de l'un d'eux quand ce ne sont pas les mêmes (« rien ne la traverse, dans un sens ou
 * dans l'autre »), ou null.
 * @returns {Item|null}
 */
export function enclosureBetween(a, b) {
  if ( !a || !b || (a === b) ) return null;
  return enclosingItem(a) ?? enclosingItem(b);
}

/** L'item d'où vient un effet posé sur un acteur, ou null. */
export function originItemOf(effect) {
  const origin = effect.system?.origin ?? {};
  const uuid = origin.activity ?? origin.item ?? effect.origin;
  const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  // §93 : une origine laissée par la donnée vers l'item du COMPENDIUM (Ravenloft : `origin` écrit dans l'effet du pack) — que
  // `fromUuidSync` ne résout que s'il est déjà en cache, et qui n'est de toute façon pas l'item de l'acteur. L'effet posé depuis
  // l'item de la fiche en garde la trace (`_stats.duplicateSource`, l'effet de cet item) : c'est lui qu'on suit.
  if ( !doc || doc.pack ) {
    // §438 : le Manuel 3.0.0 écrit dans ses effets `system.origin.item` = l'item du COMPENDIUM, qu'une copie garde (dnd5e ne le récrit que
    // quand il applique l'effet lui-même, par l'activité). L'origine écrite sur l'effet (`origin` de la source : dnd5e 6.1 la remplace dans
    // les données préparées par `system.origin`) dit l'item de la fiche qui l'a posé.
    const own = effect._source?.origin;
    const written = (own && (own !== uuid)) ? fromUuidSync(own, { strict: false }) : null;
    const writtenItem = written ? (written.documentName === "Item" ? written : (written.item ?? null)) : null;
    if ( writtenItem && !writtenItem.pack ) return writtenItem;
    const copied = effect._stats?.duplicateSource ? fromUuidSync(effect._stats.duplicateSource, { strict: false }) : null;
    const owner = copied?.parent;
    if ( owner?.documentName === "Item" && !owner.pack ) return owner;
  }
  // Un effet posé par la zone d'une activité (`zoneEffects`) a pour origine le comportement de sa région : la région porte
  // l'activité qui l'a posée (`flags.dnd5e.activity`), d'où l'item (Cercle magique : la marque de qui se tient dans le cercle).
  if ( ["Region", "RegionBehavior"].includes(doc?.documentName) ) {
    const region = (doc.documentName === "Region") ? doc : doc.parent;
    const placed = fromUuidSync(region?.getFlag?.("dnd5e", "activity") ?? "", { strict: false });
    return placed?.item ?? null;
  }
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
 * §485 : les effets que l'acteur porte et dont il peut rejouer la sauvegarde (Indomptable : « un effet ou un état qui l'affecte […] sans
 * effet si cet effet ou cet état ne découlait pas d'un jet de sauvegarde raté »). Un effet actif posé par une activité de sauvegarde
 * (`system.origin.activity` ; pour un effet posé par une attaque à sauvegarde enchaînée, la sauvegarde de son item, comme
 * `saveActivityOf` de runtime/triggers.mjs), venu d'un AUTRE acteur — ni sa propre concentration, ni ses propres effets, ni un effet que
 * l'activité pose sur une sauvegarde réussie (`onSave`), ni un effet laissé à dnd5e (§395).
 * @returns {Array<{effect: ActiveEffect, activity: Activity}>}
 */
export function savableEffectsOf(actor) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed || isVanilla(effect) ) continue;
    if ( effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration") ) continue;
    const uuid = effect.system?.origin?.activity ?? null;
    const origin = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    const item = origin?.item ?? originItemOf(effect);
    if ( !item || (item.actor === actor) ) continue;
    const activity = (origin?.type === "save") ? origin
      : (Array.from(item.system?.activities ?? []).find(a => a.type === "save") ?? null);
    if ( !activity ) continue;
    const applied = (activity.effects ?? []).find(e => comesFromItemEffect(effect, e._id ?? e.id));
    if ( applied?.onSave === true ) continue;
    out.push({ effect, activity });
  }
  return out;
}

/**
 * §16.36 : l'acteur porte-t-il un effet actif d'un item qui l'empêche de bénéficier de l'état Invisible (Poussière d'étoile,
 * Lueurs féeriques : `revealsInvisible`) ? Seulement s'il est Invisible — sinon il n'y a rien à retirer.
 */
export function revealedInvisible(actor, observer=null) {
  if ( !actor?.statuses?.has?.("invisible") ) return false;
  if ( knownTo(actor, observer) ) return true;   // §284 : Épine mentale, contre son lanceur seul
  for ( const effect of actor.appliedEffects ?? actor.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.revealsInvisible === true) ) return true;
  }
  return false;
}

/**
 * §284 : `observer` (acteur) a-t-il lancé sur `actor` un effet actif d'un item `knownToOrigin` (Épine mentale : « vous savez
 * toujours où elle se trouve ; elle ne peut pas se Cacher de vous, et l'état Invisible ne lui apporte rien contre vous ») ?
 */
export function knownTo(actor, observer) {
  if ( !actor || !observer || (actor === observer) ) return false;
  for ( const effect of actor.appliedEffects ?? actor.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.knownToOrigin === true) && (item.actor?.uuid === observer.uuid) ) return true;
  }
  return false;
}

/**
 * §161 : l'observateur voit-il les créatures Invisibles (Détection de l'invisibilité : « vous voyez les créatures et objets
 * Invisibles comme s'ils étaient visibles ») — un effet actif d'un item au contenu `seesInvisible` ?
 */
export function seesInvisible(actor) {
  // §306 : un sens spécial qui nomme les créatures Invisibles (Troisième œil, option Détection de l'invisibilité : « Invisible creatures »).
  if ( /invisib/i.test(actor?.system?.attributes?.senses?.special ?? "") ) return true;
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.seesInvisible === true) ) return true;
  }
  return false;
}

/**
 * §353 : l'attaque à distance faite avec cette arme vise-t-elle son ennemi juré (`swornEnemy` : Arc du serment) — une cible qui porte
 * l'effet `swornEnemy.effect` venu de cette arme ? Rend le nom de l'arme, ou null.
 */
export function swornEnemyOf(activity, targetToken, attackMode=null) {
  const item = activity?.item;
  const rule = item ? contentOf(item).entry?.swornEnemy : null;
  if ( !rule || (activity.type !== "attack") ) return null;
  const ranged = (activity.attack?.type?.value === "ranged") || (attackMode?.startsWith?.("thrown") === true);
  if ( !ranged ) return null;
  const actor = targetToken?.actor;
  const marked = (actor?.effects ?? []).some(e => !e.disabled && comesFromItemEffect(e, rule.effect) && (originItemOf(e) === item));
  return marked ? item.name : null;
}

/**
 * §438 : l'activité de l'item d'origine qui a posé cet effet, quand elle se retrouve — l'origine écrite par dnd5e
 * (`system.origin.activity`, puis `profile` : effect-application.mjs `_prepareEffectData`), sinon la source copiée (`_stats`) comparée aux
 * effets de chaque activité (effet de l'item, ou effet distant `Compendium…` du Manuel 3.0.0 posé par `placeRemoteEffect`).
 * @returns {string|null}
 */
export function originActivityIdOf(effect, item) {
  const activities = item?.system?.activities;
  if ( !effect || !activities ) return null;
  const origin = effect.system?.origin ?? {};
  const fromUuid = typeof origin.activity === "string" ? origin.activity.split(".").pop() : null;
  if ( fromUuid && activities.get?.(fromUuid) ) return fromUuid;
  const stats = effect._stats ?? {};
  const sources = [stats.duplicateSource, stats.compendiumSource].filter(u => typeof u === "string");
  for ( const activity of activities ) {
    for ( const ref of activity.effects ?? [] ) {
      if ( origin.profile && (ref._id === origin.profile) ) return activity.id;
      const uuid = ref.uuid ?? ref.effect?.uuid ?? null;
      if ( uuid && sources.includes(uuid) ) return activity.id;
      if ( sources.some(u => u.endsWith(`.ActiveEffect.${ref._id}`)) ) return activity.id;
    }
  }
  return null;
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
/** §95 : l'acteur porte-t-il un effet actif d'un item de cet identifiant (Forme d'effroi, Courroux sauvage) ? */
export const carriesEffectFrom = (actor, identifier) => hasEffectFrom(actor, identifier);

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
  // §447 : un enchantement actif sur un item de l'acteur compte aussi (Courroux sauvage : le profil de transformation, activé sur l'item
  // lui-même, runtime/enchant.mjs — dnd5e ne transfère jamais un effet cité par une activité, il n'est pas dans `appliedEffects`).
  for ( const owned of actor?.items ?? [] ) {
    for ( const effect of owned.effects ?? [] ) {
      if ( (effect.type !== "enchantment") || effect.disabled ) continue;
      if ( effectId && !comesFromItemEffect(effect, effectId) ) continue;
      const item = originItemOf(effect) ?? owned;
      if ( identifierOf(item).id !== identifier ) continue;
      if ( !source || (item.actor?.uuid === source.uuid) ) return true;
    }
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
    if ( !areAllies(other, sourceToken) ) continue;
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
    if ( (from?.actor?.uuid !== source.uuid) || (item && (identifierOf(from).id !== item)) ) continue;
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

/** Les vitesses préparées d'un acteur (`movement.speeds` de dnd5e 6, `movement` avant), ou null. */
function movementSpeedsOf(actor) {
  const movement = actor?.system?.attributes?.movement;
  return movement ? (movement.speeds ?? movement) : null;
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
/** Le sous-type de la créature est-il celui-là (ou l'un de ceux-là) ? Sans égard à la casse ; sans sous-type : non. */
const subtypeIs = (actor, want) => subtypeMatches(actor?.system?.details?.type?.subtype, want);

/** L'acteur connaît-il une langue, ou est-il télépathe (`traits.languages` de dnd5e : langues, texte libre, télépathie) ? */
export function speaksLanguage(actor) {
  const languages = actor?.system?.traits?.languages;
  if ( !languages ) return false;
  return ((languages.value?.size ?? 0) > 0) || !!languages.custom || (Number(languages.communication?.telepathy?.value ?? 0) > 0);
}

/** Une attaque naturelle de l'acteur inflige-t-elle des dégâts de poison (créature venimeuse) ? L'arme, et ses attaques. */
export function isPoisonous(actor) {
  const poison = types => (types?.has?.("poison") ?? types?.includes?.("poison")) === true;
  const attacksWithPoison = item => Array.from(item.system.activities ?? [])
    .some(a => (a.type === "attack") && (a.damage?.parts ?? []).some(p => poison(p.types)));
  return Array.from(actor?.items ?? []).some(item => (item.type === "weapon") && (item.system?.type?.value === "natural")
    && (poison(item.system.damage?.base?.types) || attacksWithPoison(item)));
}

/**
 * L'acteur porte-t-il de la magie : un effet actif magique (la marque `system.magical` de dnd5e 6.1, que le moteur pose aussi),
 * ou un objet magique (propriété `mgc`) qu'il porte sur lui — équipé, ou simplement porté hors d'un contenant (une potion à la
 * ceinture, une baguette, un anneau pas encore passé au doigt) ? Ce que montre une Détection de la magie sur une créature visible.
 * Un objet magique rangé dans un sac, lui, ne se voit pas : pas d'aura pour lui.
 */
export function carriesMagic(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( !effect.disabled && !effect.isSuppressed && (effect.system?.magical === true) ) return true;
  }
  const magic = properties => (properties?.has?.("mgc") ?? properties?.includes?.("mgc")) === true;
  return Array.from(actor?.items ?? []).some(item => magic(item.system?.properties)
    && ((item.system?.equipped === true) || !item.system?.container));
}

/** Les états contre lesquels un acteur est immunisé (`traits.ci` de dnd5e : « charmed », « exhaustion »…). */
export const conditionImmunitiesOf = actor => Array.from(actor?.system?.traits?.ci?.value ?? []);

/**
 * §268 : les états contre lesquels un acteur est immunisé face à cette source — les siens, plus ceux qu'un effet qu'il porte écarte quand la
 * source est d'un type donné (`wardsConditions` : Protection contre le Mal et le Bien, « la cible ne peut être Charmée ni Effrayée par
 * elles »). Sans source connue : les siens.
 */
export function conditionImmunitiesAgainst(actor, source) {
  const own = conditionImmunitiesOf(actor);
  const type = source ? creatureTypeOf(source) : null;
  if ( !type ) return own;
  const warded = (actor?.effects ?? []).filter(e => !e.disabled && !e.isSuppressed).flatMap(e => {
    const rule = contentOf(originItemOf(e)).entry?.wardsConditions;
    return (rule && rule.types.includes(type)) ? rule.statuses : [];
  });
  return [...new Set([...own, ...warded])];
}

/**
 * §279 : le genre d'une attaque d'arme, pour les règles qui en nomment une liste — « unarmed » (frappe à mains nues, classée ainsi par
 * dnd5e : `attack.type.classification`), sinon le type d'arme de dnd5e (`simpleM`, `martialM`, `natural`, `improv`…).
 */
export function weaponKind(activity) {
  if ( activity?.attack?.type?.classification === "unarmed" ) return "unarmed";
  return activity?.item?.system?.type?.value ?? null;
}

/**
 * §481 : le niveau de lancement d'un sort pour les faits `spell.*` — celui que le moment connaît (`castLevel`), sinon celui que porte
 * l'item : dnd5e met à l'échelle la copie du sort d'un message (`getAssociatedItem({ scaled: true })`,
 * documents/chat-message.mjs:719, `scaledClone` → `flags.dnd5e.scaling`, documents/item.mjs:531), un sort lancé par une activité « cast » prend son niveau (`linkedActivity.spell.level`), un parchemin le sien.
 */
function castLevelKnown(activity, castLevel) {
  const item = activity?.item;
  const scroll = (item && (item.type !== "spell")) ? scrollSpellOf(item) : null;
  return knownCastLevel({
    castLevel, isSpell: (item?.type === "spell") || !!scroll,
    level: scroll ? scroll.level : item?.system?.level,
    scaling: Number(item?.flags?.dnd5e?.scaling) || 0,
    linkedLevel: item?.system?.linkedActivity?.spell?.level ?? null
  });
}

/**
 * Les faits d'un moment. `source` : qui agit ; `target` : qui subit ; `activity` : ce qui est utilisé ;
 * `sourceToken` / `targetToken` : leurs tokens quand le moment les connaît (sinon retrouvés par l'acteur).
 * `castLevel` : le niveau auquel le sort est lancé, quand le moment le connaît (porte `castsSpell`, §481).
 * `turnKey` : le tour dont parlent les faits « ce tour » (§492 : le tour qui vient de finir, à `enemyTurnEnd`) ; sinon le tour en cours.
 * Une clé absente ici est inconnue du cœur, et une condition qui l'emploie ne tient jamais.
 */
/** §505 : deux tokens se recouvrent-ils (au moins une case commune), sur la même scène ? */
export function sharesSpace(a, b) {
  const A = a?.document ?? a;
  const B = b?.document ?? b;
  if ( !A || !B || (A === B) || (A.parent !== B.parent) || !A.parent?.grid ) return false;
  const grid = A.parent.grid;
  const box = t => ({ x: t._source.x, y: t._source.y, w: (t._source.width ?? 1) * grid.sizeX, h: (t._source.height ?? 1) * grid.sizeY });
  const p = box(A);
  const q = box(B);
  const eps = 1;
  return (p.x < q.x + q.w - eps) && (q.x < p.x + p.w - eps) && (p.y < q.y + q.h - eps) && (q.y < p.y + p.h - eps);
}

export function factsFor({ source=null, target=null, activity=null, sourceToken=null, targetToken=null, attackMode=null, damageTypes=null, condition=null, self=null, selfToken=null, resolution=null, castLevel=null, turnKey=null }={}) {
  const properties = activity?.item?.system?.properties;
  const spellLevel = castLevelKnown(activity, castLevel);
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
    // §279 : le genre d'arme (`weaponKind` : "unarmed", "simpleM", "martialM", "improv"…), null hors arme — { "activity.weaponKind": ["unarmed", "simpleM"] }.
    "activity.weaponKind": weaponKind(activity),
    // L'arme de base (`system.type.baseItem` : "longbow", "shortbow"…), null hors arme ou sans base — une arme magique garde la
    // sienne, quel que soit son nom : { "activity.baseItem": ["longbow", "shortbow"] } (Brassards d'archer).
    "activity.baseItem": ((activity?.item?.type === "weapon") && activity.item.system?.type?.baseItem) || null,
    "activity.identifier": activity?.item ? identifierOf(activity.item).id : null,
    "activity.id": activity?.id ?? null,
    // §493 (B13) : la forme de la zone de l'activité (« cone », « line », « sphere »…), null sans zone — { "activity.areaShape": ["cone", "line"] }.
    "activity.areaShape": areaShapeOf(activity),
    // §32 : un sort de cette classe (Sorcellerie innée : « sorts d'Ensorceleur ») — la classe du sort (`spellClassOf`), ou celle de l'acteur.
    "activity.classSpell": cls => (activity?.item?.type === "spell")
      && ((spellClassOf(activity.item) || (activity.item.actor?.classes?.[cls] ? cls : null)) === cls),
    // §32 : l'acteur résiste à ce type de dégâts (Affinité élémentaire : le type choisi est celui de la résistance donnée).
    "source.resists": type => (source?.system?.traits?.dr?.value?.has?.(type) ?? source?.system?.traits?.dr?.value?.includes?.(type)) === true,
    // §29 : l'item porte un enchantement venu d'un item de cet identifiant (arme de pacte : « pact-of-the-blade » ; Décharge
    // répulsive posée sur la Décharge occulte : « repelling-blast »).
    // O5b (§340) : l'objet d'origine retrouvé aussi par l'id de l'effet d'enchantement, quand il n'est plus sur la fiche (adapter/content.mjs).
    "activity.enchantedBy": id => (activity?.item?.effects ?? []).some(e => !e.disabled && (e.isAppliedEnchantment ?? (e.type === "enchantment"))
      && (identifierOf(originItemOf(e) ?? {}).id === id)) || enchantmentSourcesOf(activity?.item).includes(id),
    // §28 : l'école d'un sort (`system.school` : "evo" Évocation, "abj" Abjuration…) — Évocation améliorée.
    "activity.school": spellSchoolOf(activity?.item),   // §48 : celle du sort d'un parchemin
    // §481 : le niveau auquel le sort est lancé (null hors d'un sort) — « un sort de niveau 3 ou moins » : { "spell.castLevelAtMost": 3 }.
    "spell.castLevel": spellLevel,
    "spell.castLevelAtMost": n => castLevelAtMost(spellLevel, n),
    "spell.castLevelAtLeast": n => castLevelAtLeast(spellLevel, n),
    // §27 : « tout sort mineur de Clerc » (Incantation puissante) — un tour de magie rangé sous cette classe (`spellClassOf`) ;
    // un sort ajouté à la main n'en a pas : il compte si l'acteur a cette classe.
    "activity.cantripOf": cls => (activity?.item?.type === "spell") && (Number(activity.item.system.level) === 0)
      && ((spellClassOf(activity.item) || (activity.item.actor?.classes?.[cls] ? cls : null)) === cls),
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
    // §431 : l'acteur a un item de cet identifiant (ou de l'un d'eux) donné par cette classe — `potent-spellcasting`, partagé par le
    // Clerc et le Druide dans le SRD de dnd5e 6.1 : { "source.hasClassFeature": { id: "potent-spellcasting", class: "cleric" } }.
    "source.hasClassFeature": ({ id, class: cls }={}) => hasClassFeature(source, id, cls),
    // §302 : la cible a un item de cet identifiant (Transe : « ne dort pas »).
    "target.hasFeature": id => (target?.items ?? []).some(i => identifierOf(i).id === id),
    // §302 : la caractéristique de l'attaque (dnd5e : `activity.ability`, la meilleure pour une arme de Finesse) — Rayon affaiblissant.
    "activity.ability": id => [id].flat().includes(activity?.ability ?? null),
    "target.hasStatus": id => target?.statuses?.has(id) === true,
    "target.hasEffect": id => hasEffectFrom(target, id),
    "target.hasEffectFrom": id => hasEffectFrom(target, id, source),
    // K1 (§334) : la cible porte cette marque (immunité temporaire après une réussite : `immune:<identifiant>`).
    "target.hasMark": mark => (target?.effects ?? []).some(e => e.flags?.["dnd5e-combat"]?.mark === mark),
    // §133 : la créature visée manie une arme équipée de cette propriété (Duelliste défensif : « Finesse ») ; c'est le réacteur lui-même
    // (Protection : « une cible autre que vous ») ; le réacteur porte un bouclier.
    // §135 : la créature blessée résiste à l'un des types de ces dégâts (Faveur de résistance aux énergies : Redirection d'énergie).
    // §138 : le coup qui vient de toucher `target` deviendrait-il un échec avec n de CA en plus (Bouclier : +5) ? Jamais sur un coup
    // critique (un 20 naturel touche toujours) ; sans résolution connue (avant la fenêtre), on ne l'exclut pas.
    "hit.stoppableBy": n => {
      const hit = (resolution?.targets ?? []).find(t => fromUuidSync(t.token, { strict: false })?.actor === target);
      const total = resolution?.attack?.roll?.total;
      if ( !hit || !Number.isFinite(total) ) return true;
      if ( hit.critical ) return false;
      const ac = Number.isFinite(hit.ac) ? hit.ac : (target?.system?.attributes?.ac?.value ?? 0);
      return total < ac + (hit.cover?.bonus ?? 0) + Number(n);
    },
    // O5c (§341) : le coup qui vient de toucher `target` est un critique (Épée acérée : « sur un 20 au d20 »).
    "hit.critical": want => {
      const hit = (resolution?.targets ?? []).find(t => fromUuidSync(t.token, { strict: false })?.actor === target);
      return !!hit?.critical === want;
    },
    // §489 : le jet d'attaque qui vient de rater `target` est un 1 naturel (échec critique) — le jet relancé par une Parade s'il y en a eu
    // un (`rerolled` de la cible), sinon celui de l'attaque. Riposte « si le nouveau jet est un échec critique ».
    "attack.fumble": want => {
      const hit = (resolution?.targets ?? []).find(t => fromUuidSync(t.token, { strict: false })?.actor === target);
      return ((hit?.rerolled ?? resolution?.attack?.roll)?.isFumble === true) === want;
    },
    // §489 : l'attaquant a dû relancer son jet contre `target` (étape `reroll` d'une réaction de la cible).
    "attack.rerolled": want => {
      const hit = (resolution?.targets ?? []).find(t => fromUuidSync(t.token, { strict: false })?.actor === target);
      return !!hit?.rerolled === want;
    },
    "damage.resisted": want => ((damageTypes ?? []).some(t => target?.system?.traits?.dr?.value?.has?.(t) === true) === want),
    "target.wieldsProperty": prop => (target?.items ?? []).some(i => (i.type === "weapon") && i.system.equipped && i.system.properties?.has?.(prop)),
    "target.isSelf": want => (!!self && !!target && (self === target)) === want,
    // §301 : une arme (pas une arme naturelle) en main — Interception : « vous maniez un bouclier ou une arme courante ou de guerre ».
    "self.wieldsWeapon": want => (self?.items ?? []).some(i => (i.type === "weapon") && i.system.equipped && ["simpleM", "simpleR", "martialM", "martialR"].includes(i.system.type?.value)) === want,
    // §491 : la cible porte une armure — true / false (armure de corps), une catégorie ("heavy", ["medium", "heavy"], "shield"), ou
    // { material: "metal", category? } (Poigne électrique, Métal brûlant). Table des armures de métal : core/armor.mjs.
    "target.wearsArmor": want => wearsArmor(armorPieces(target), want),
    "self.hasShield": want => (self?.items ?? []).some(i => (i.type === "equipment") && (i.system.type?.value === "shield") && i.system.equipped) === want,
    // §132 : la cible est Agrippée par l'attaquant (Lutteur : « l'Avantage aux jets d'attaque contre une créature que vous agrippez »).
    // §334 : l'attaquant a chargé la cible d'au moins tant de pieds en ligne droite juste avant (Défenses de l'Éléphant).
    // §334 : l'attaquant se tient en lumière vive (Sensibilité au soleil, à la lumière).
    "source.inBrightLight": want => ((!!sourceToken && (lightOnToken(sourceToken)?.level === LIGHT.BRIGHT)) === want),
    "source.inSunlight": want => ((!!sourceToken && inSunlight(sourceToken)) === want),
    // §484 : les mêmes faits sur la créature elle-même (`self` : le porteur du trait au début de son tour, celui qui lance un test) et sur
    // la cible — au soleil, en lumière vive, dans de l'eau courante (région ou scène marquée, adapter/running-water.mjs). Sans token : faux.
    "source.inRunningWater": want => (inRunningWater(tokenOf(source, sourceToken)) === want),
    "self.inSunlight": want => ((!!tokenOf(self, selfToken) && inSunlight(tokenOf(self, selfToken))) === want),
    "self.inBrightLight": want => (isBright(tokenOf(self, selfToken)) === want),
    "self.inRunningWater": want => (inRunningWater(tokenOf(self, selfToken)) === want),
    "target.inSunlight": want => ((!!tokenOf(target, targetToken) && inSunlight(tokenOf(target, targetToken))) === want),
    "target.inBrightLight": want => (isBright(tokenOf(target, targetToken)) === want),
    "target.inRunningWater": want => (inRunningWater(tokenOf(target, targetToken)) === want),
    "source.chargedFeet": feet => !!sourceToken && !!targetToken && (chargedFeet(sourceToken, targetToken) >= (Number(feet) || 0)),
    // §505 (B25) : la cible est-elle dans l'espace de la source (une nuée qui partage les cases de ses victimes) — les deux tokens se
    // recouvrent sur la même scène, positions validées (`_source`).
    "target.sharesSpaceWithSource": want => (sharesSpace(tokenOf(source, sourceToken), tokenOf(target, targetToken)) === want),
    "target.grappledBySource": want => ((target?.effects ?? []).some(e => e.statuses?.has?.("grappled") && (grapplerOf(e) === source)) === want),
    // §281 : l'inverse — la source est Agrippée par la cible (un ennemi agrippé par le réacteur finit son tour : Prise finale).
    "source.grappledByTarget": want => ((source?.effects ?? []).some(e => e.statuses?.has?.("grappled") && (grapplerOf(e) === target)) === want),
    // §37 : l'attaquant porte un effet que la CIBLE a posé (Malédiction : « Désavantage aux jets d'attaque contre vous »).
    "source.hasEffectFromTarget": id => hasEffectFrom(source, id, target),
    // Type de créature de l'attaquant (Protection contre le mal et le bien : aberration, céleste, élémentaire, fée, fiélon, mort-vivant).
    "source.creatureType": creatureTypeOf(source),
    // §157 : l'attaquant a l'un de ces sens (`senses.ranges` de dnd5e, data/shared/senses-field.mjs:15) — Flou : « une créature
    // dotée de vision aveugle ou de vision véritable n'est pas affectée ».
    // §164 : la cible est-elle du camp de la source (pas hostile) ? Invocation de céleste : soin pour les alliés, brûlure pour les ennemis.
    "target.allied": want => {
      const s = tokenOf(source, sourceToken), t = tokenOf(target, targetToken);
      return (!!s && !!t && !areEnemies(s, t)) === want;
    },
    "source.hasSense": names => [names].flat().some(n => Number(source?.system?.attributes?.senses?.ranges?.[n]) > 0),
    // §16.8 : le type de la cible (« humanoid »…) et ses immunités aux états (Sommeil : immunité à l'Épuisement).
    "target.creatureType": creatureTypeOf(target),
    // Le sous-type de la cible (`details.type.subtype` de dnd5e : « Demon », « Devil »…), sans égard à la casse — Armure
    // démoniaque : « Désavantage aux jets d'attaque contre les démons ».
    "target.creatureSubtype": want => subtypeIs(target, want),
    // Sens déclarés (`sense.detects`) : la cible connaît une langue ou est télépathe ; elle est venimeuse.
    "target.speaksLanguage": want => (speaksLanguage(target) === want),
    "target.poisonous": want => (isPoisonous(target) === want),
    "target.carriesMagic": want => (carriesMagic(target) === want),
    "target.immuneTo": id => conditionImmunitiesOf(target).includes(id),
    // Armure d'Agathys : « tant que vous avez ces PV temporaires ». { "target.hasTempHp": true | false }.
    "target.hasTempHp": want => (((target?.system?.attributes?.hp?.temp ?? 0) > 0) === want),
    // Cape de déplacement : « tant que votre Vitesse est de 0 ». { "target.speedZero": true | false }.
    "target.speedZero": want => (speedIsZero(movementSpeedsOf(target)) === want),
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
    // `"source"` : « de votre taille ou plus petite » (Bouclier du cavalier) — la taille de l'auteur de l'action.
    "target.sizeAtMost": size => {
      const rank = SIZE_RANK[target?.system?.traits?.size];
      const limit = SIZE_RANK[(size === "source") ? source?.system?.traits?.size : size];
      return (rank !== undefined) && (limit !== undefined) && (rank <= limit);
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
    "self.seesSource": want => ((seesBetween(self, source) ?? true) === want),
    // §447 : le réacteur porte un effet de l'item (Représailles rôdeuses : seulement transformé par le Courroux sauvage).
    "self.hasEffect": id => hasEffectFrom(self, id),
    // §485 : le réacteur porte un effet dont il peut rejouer la sauvegarde (Indomptable) — `savableEffectsOf`.
    "self.hasSavableEffect": want => ((savableEffectsOf(self).length > 0) === want),
    // §492 : la source a attaqué la créature (`self`, sinon `target`) pendant ce tour — true / false, "melee", "ranged" ou une liste.
    // « Quand une créature hostile termine son tour après l'avoir attaquée au corps à corps » : { "source.attackedSelfThisTurn": "melee" }.
    "source.attackedSelfThisTurn": want => attackedMatches(attackedDuring(source, self ?? target, { turn: turnKey }), want)
  };
}
