/**
 * Validation d'une entrée de contenu (`validateEntry`) et d'une table entière (`validateTable`). Fonctions pures, aucune dépendance à Foundry.
 */

import { CREATURE_TYPES } from "../eligibility.mjs";
import { ORDERS } from "../orders.mjs";
import { unknownFacts } from "../triggers.mjs";
import { validateAbsorb, validateCarriedLight, validateChoice, validateEmanation, validateLight, validateSummon, validateTargets, validateTeleport } from "./annex.mjs";
import { BASIC_ACTION_KINDS, BONUS_ATTACK_AFTER, BREAK_MOMENTS, EFFECT_EXPIRIES, ENDS_APART_AT, ENDS_ARMOR, ENDS_UNAFFECTED, ENTRY_KEYS, SIZES, WEAPON_KINDS, DAMAGE_TYPES } from "./enums.mjs";
import { validateExtras } from "./extras.mjs";
import { SPELL_COMPONENTS } from "../spell-failure.mjs";
import { isId, isObject } from "./shared.mjs";
import { validateDataFixes } from "../data-fixes.mjs";
import { validateAura, validateTrigger } from "./steps.mjs";
/**
 * Les erreurs d'une entrée. Vide = valide.
 * @param {object} entry
 * @param {{facts: object, at?: string}} options  `facts` : les clés de faits que l'adaptateur fournit.
 * @returns {string[]}
 */
export function validateEntry(entry, { facts={}, at="" }={}) {
  const errors = [];
  if ( !isObject(entry) ) return [`${at || "entry"}: an object`];
  for ( const key of Object.keys(entry) ) if ( !ENTRY_KEYS.includes(key) ) errors.push(`${at}${key}: unknown key (${ENTRY_KEYS.join(", ")})`);
  if ( "triggers" in entry ) {
    const list = Array.isArray(entry.triggers) ? entry.triggers : [entry.triggers];
    list.forEach((d, i) => validateTrigger(d, `${at}triggers[${i}]`, facts, errors));
  }
  if ( "aura" in entry ) validateAura(entry.aura, `${at}aura`, errors);
  if ( "onHit" in entry ) {
    if ( !isObject(entry.onHit) || !isId(entry.onHit.save) ) errors.push(`${at}onHit.save: activity id (16 characters)`);
    // §345 : `whileEnchanted` — seulement tant que l'item porte cet enchantement (profil, id d'effet) ; `spends` : un coup qui touche y
    // met fin (Dague venimeuse : « le poison reste jusqu'à ce qu'une attaque avec cette arme touche »).
    else {
      if ( ("whileEnchanted" in entry.onHit) && !isId(entry.onHit.whileEnchanted) ) errors.push(`${at}onHit.whileEnchanted: effect id (16 characters)`);
      if ( ("spends" in entry.onHit) && ((entry.onHit.spends !== true) || !("whileEnchanted" in entry.onHit)) ) errors.push(`${at}onHit.spends: true, with whileEnchanted`);
      for ( const key of Object.keys(entry.onHit) ) if ( !["save", "whileEnchanted", "spends"].includes(key) ) errors.push(`${at}onHit.${key}: unknown key`);
    }
  }
  // O8d (§347) : défenses contre les seules attaques à distance (Bouclier antiprojectiles, Bouclier d'attraction).
  if ( "rangedDefense" in entry ) {
    const r = entry.rangedDefense;
    if ( !isObject(r) || !Object.keys(r).length ) errors.push(`${at}rangedDefense: { ac?, resistance?, attract? }`);
    else {
      if ( ("ac" in r) && !(Number.isInteger(r.ac) && (r.ac > 0)) ) errors.push(`${at}rangedDefense.ac: positive integer`);
      if ( ("resistance" in r) && (r.resistance !== true) ) errors.push(`${at}rangedDefense.resistance: true or absent`);
      if ( ("attract" in r) && !(Number.isFinite(r.attract) && (r.attract > 0)) ) errors.push(`${at}rangedDefense.attract: distance in feet`);
      for ( const key of Object.keys(r) ) if ( !["ac", "resistance", "attract"].includes(key) ) errors.push(`${at}rangedDefense.${key}: unknown key`);
    }
  }
  // O8e (§348) : Désavantage avec les autres armes — toujours (`true`), ou tant qu'une créature vivante porte l'effet `whileEffect` de l'item.
  if ( "exclusiveWeapon" in entry ) {
    const x = entry.exclusiveWeapon;
    const ok = (x === true) || (isObject(x) && isId(x.whileEffect) && (Object.keys(x).length === 1));
    if ( !ok ) errors.push(`${at}exclusiveWeapon: true or { whileEffect: effect id }`);
  }
  // O8h (§351) : portée minimale d'une arme (armes de siège : « ne peut pas toucher une cible à 18 m ou moins »).
  if ( "minRange" in entry ) {
    const m = entry.minRange;
    if ( !isObject(m) || !(Number.isFinite(m.value) && (m.value > 0)) || (typeof m.units !== "string") || !m.units
      || Object.keys(m).some(k => !["value", "units"].includes(k)) ) errors.push(`${at}minRange: { value: positive number, units }`);
  }
  // §353 : l'ennemi juré (Arc du serment) — la cible qui porte cet effet de l'arme.
  // §371 : `endurance` — true, ou ce qui suit le maintien à 1 PV : un effet de l'item posé sur le porteur, des PV temporaires, les
  // utilisations d'items rendues (par identifiant).
  if ( "endurance" in entry ) {
    const x = entry.endurance;
    const ok = (x === true) || (isObject(x) && Object.keys(x).length && Object.keys(x).every(k => ["effect", "tempHp", "restores"].includes(k))
      && (!("effect" in x) || isId(x.effect)) && (!("tempHp" in x) || ((typeof x.tempHp === "string") && !!x.tempHp.trim()))
      && (!("restores" in x) || (Array.isArray(x.restores) && x.restores.length && x.restores.every(id => (typeof id === "string") && !!id))));
    if ( !ok ) errors.push(`${at}endurance: true or { effect?: effect id, tempHp?: formula, restores?: [identifiers] }`);
  }
  if ( ("swornEnemy" in entry) && !(isObject(entry.swornEnemy) && isId(entry.swornEnemy.effect) && (Object.keys(entry.swornEnemy).length === 1)) ) {
    errors.push(`${at}swornEnemy: { effect: effect id }`);
  }
  // §355 : armes qui nourrissent leur porteur (Noirtranchant, Épée voleuse de vie) ; dégâts de sort maximisés contre des types (Demonomicon).
  if ( ("devours" in entry) && (entry.devours !== true) ) errors.push(`${at}devours: true or absent`);
  if ( ("critFeeds" in entry) && !(isObject(entry.critFeeds) && Number.isInteger(entry.critFeeds.amount) && (entry.critFeeds.amount > 0)
    && (Object.keys(entry.critFeeds).length === 1)) ) errors.push(`${at}critFeeds: { amount: positive integer }`);
  if ( ("maxSpellDamageVs" in entry) && !(Array.isArray(entry.maxSpellDamageVs) && entry.maxSpellDamageVs.length
    && entry.maxSpellDamageVs.every(t => CREATURE_TYPES.includes(t))) ) errors.push(`${at}maxSpellDamageVs: non-empty list of creature types`);
  // §356 : arme maudite qui s'empare de son porteur quand on le blesse.
  if ( "wrath" in entry ) {
    const w = entry.wrath;
    const ok = isObject(w) && ["berserk", "vengeance"].includes(w.kind) && isObject(w.save) && /^[a-z]{3}$/.test(w.save.ability ?? "")
      && Number.isFinite(w.save.dc) && (w.save.dc > 0) && (Object.keys(w).length === 2);
    if ( !ok ) errors.push(`${at}wrath: { kind: berserk|vengeance, save: { ability, dc } }`);
  }
  if ( "choice" in entry ) validateChoice(entry.choice, `${at}choice`, errors);
  if ( "targets" in entry ) validateTargets(entry.targets, `${at}targets`, facts, errors);
  if ( "trace" in entry ) {
    const t = entry.trace;
    if ( isObject(t) ) {
      for ( const key of ["activity", "attack"] ) if ( (key in t) && !isId(t[key]) ) errors.push(`${at}trace.${key}: activity id (16 characters) expected`);
      if ( ("show" in t) && (t.show !== true) ) errors.push(`${at}trace.show: true or absent`);
      for ( const key of Object.keys(t) ) if ( !["activity", "show", "attack"].includes(key) ) errors.push(`${at}trace.${key}: unknown key`);
    }
    else if ( t !== true ) errors.push(`${at}trace: true or { activity?, show?, attack? }`);
  }
  if ( "damageShield" in entry ) {
    const d = entry.damageShield;
    const worn = isObject(d) && ("worn" in d);
    if ( worn && ((typeof d.worn !== "string") || !d.worn || ("effects" in d)) ) errors.push(`${at}damageShield.worn: a damage type (no effects)`);
    if ( !isObject(d) || (!worn && (!isObject(d.effects) || !Object.keys(d.effects).length)) ) errors.push(`${at}damageShield.effects: { effect id: damage type }`);
    else {
      for ( const [id, type] of Object.entries(d.effects ?? {}) ) {
        if ( !isId(id) ) errors.push(`${at}damageShield.effects.${id}: effect id (16 characters)`);
        if ( (typeof type !== "string") || !type ) errors.push(`${at}damageShield.effects.${id}: damage type`);
      }
      if ( (typeof d.formula !== "string") || !d.formula.trim() ) errors.push(`${at}damageShield.formula: formula required`);
      if ( ("oncePerTurn" in d) && (d.oncePerTurn !== true) ) errors.push(`${at}damageShield.oncePerTurn: true or absent`);
      for ( const key of Object.keys(d) ) if ( !["effects", "worn", "formula", "oncePerTurn"].includes(key) ) errors.push(`${at}damageShield.${key}: unknown key`);
    }
  }
  if ( "hitDiceHeal" in entry ) {
    const h = entry.hitDiceHeal;
    if ( !isObject(h) || !isId(h.activity) || !(Number.isInteger(h.base) && (h.base > 0)) ) errors.push(`${at}hitDiceHeal: { activity, base }`);
    else for ( const key of Object.keys(h) ) if ( !["activity", "base"].includes(key) ) errors.push(`${at}hitDiceHeal.${key}: unknown key`);
  }
  if ( "empower" in entry ) {
    const e = entry.empower;
    if ( !isObject(e) ) errors.push(`${at}empower: { damageType, effect, excludeTypes? }`);
    else {
      if ( (typeof e.damageType !== "string") || !e.damageType ) errors.push(`${at}empower.damageType: damage type required`);
      if ( !isId(e.effect) ) errors.push(`${at}empower.effect: effect id (16 characters)`);
      if ( ("excludeTypes" in e) && (!Array.isArray(e.excludeTypes) || !e.excludeTypes.every(t => CREATURE_TYPES.includes(t))) ) {
        errors.push(`${at}empower.excludeTypes: creature types (${CREATURE_TYPES.join(", ")})`);
      }
      for ( const key of Object.keys(e) ) if ( !["damageType", "effect", "excludeTypes"].includes(key) ) errors.push(`${at}empower.${key}: unknown key`);
    }
  }
  if ( "discharge" in entry ) {
    const c = entry.discharge;
    if ( !isObject(c) ) errors.push(`${at}discharge: { effect, formula, damageTypes, sees? }`);
    else {
      if ( !isId(c.effect) ) errors.push(`${at}discharge.effect: effect id (16 characters)`);
      if ( (typeof c.formula !== "string") || !c.formula.trim() ) errors.push(`${at}discharge.formula: formula required`);
      if ( !Array.isArray(c.damageTypes) || !c.damageTypes.length || !c.damageTypes.every(t => (typeof t === "string") && t) ) errors.push(`${at}discharge.damageTypes: list of damage types`);
      if ( ("sees" in c) && (c.sees !== true) ) errors.push(`${at}discharge.sees: true or absent`);
      for ( const key of Object.keys(c) ) if ( !["effect", "formula", "damageTypes", "sees"].includes(key) ) errors.push(`${at}discharge.${key}: unknown key`);
    }
  }
  if ( ("healsDownedMax" in entry) && (entry.healsDownedMax !== true) ) errors.push(`${at}healsDownedMax: true or absent`);
  // §366 : les effets de l'item cessent quand leur LANCEUR fait ceci (Amitié).
  if ( "breaksOnOrigin" in entry ) {
    const b = entry.breaksOnOrigin;
    if ( !Array.isArray(b) || !b.length || !b.every(m => ["attack", "damage", "forcesSave"].includes(m)) ) errors.push(`${at}breaksOnOrigin: list among attack, damage, forcesSave`);
  }
  if ( "breaksOn" in entry ) {
    const b = entry.breaksOn;
    if ( !Array.isArray(b) || !b.length || !b.every(m => BREAK_MOMENTS.includes(m)) ) errors.push(`${at}breaksOn: list among ${BREAK_MOMENTS.join(", ")}`);
  }
  if ( "endsWhen" in entry ) validateEndsWhen(entry.endsWhen, `${at}endsWhen`, errors);
  if ( "afterSmite" in entry ) {
    const a = entry.afterSmite;
    if ( !isObject(a) || !isId(a.effect) || (("smites" in a) && (!Array.isArray(a.smites) || !a.smites.length || !a.smites.every(x => (typeof x === "string") && x)))
      || Object.keys(a).some(k => !["effect", "smites"].includes(k)) ) errors.push(`${at}afterSmite: { effect: effect id, smites?: [identifiers] }`);
  }
  if ( "wardsConditions" in entry ) {
    const w = entry.wardsConditions;
    if ( !isObject(w) || !Array.isArray(w.types) || !w.types.length || !w.types.every(t => CREATURE_TYPES.includes(t))
      || !Array.isArray(w.statuses) || !w.statuses.length || !w.statuses.every(s => (typeof s === "string") && s)
      || Object.keys(w).some(k => !["types", "statuses"].includes(k)) ) errors.push(`${at}wardsConditions: { types: creature types, statuses: [ids] }`);
  }
  if ( ("banishes" in entry) && (!Array.isArray(entry.banishes) || !entry.banishes.length || !entry.banishes.every(isId)) ) {
    errors.push(`${at}banishes: list of effect ids (16 characters)`);
  }
  if ( "emanation" in entry ) validateEmanation(entry.emanation, `${at}emanation`, errors);
  if ( ("noOpportunity" in entry) && !["always", "flying", "afterUse", "whileEffect"].includes(entry.noOpportunity) ) errors.push(`${at}noOpportunity: always, flying, afterUse, whileEffect`);
  if ( ("sharesSpace" in entry) && !["enter", "mutual"].includes(entry.sharesSpace) ) errors.push(`${at}sharesSpace: enter, mutual`);
  if ( ("placesSummons" in entry) && (entry.placesSummons !== true) ) errors.push(`${at}placesSummons: true or absent`);
  if ( ("targetedSummon" in entry) && (entry.targetedSummon !== true) ) errors.push(`${at}targetedSummon: true or absent`);
  if ( ("savedEffects" in entry) && (!Array.isArray(entry.savedEffects) || !entry.savedEffects.length || !entry.savedEffects.every(isId)) ) {
    errors.push(`${at}savedEffects: list of effect ids (16 characters)`);
  }
  if ( "secondPhase" in entry ) {
    const p = entry.secondPhase;
    if ( !isObject(p) || !isId(p.activity) ) errors.push(`${at}secondPhase.activity: activity id (16 characters) expected`);
    else {
      if ( ("keepConditions" in p) && (typeof p.keepConditions !== "boolean") ) errors.push(`${at}secondPhase.keepConditions: boolean`);
      if ( ("keepHp" in p) && (typeof p.keepHp !== "boolean") ) errors.push(`${at}secondPhase.keepHp: boolean`);
      for ( const key of Object.keys(p) ) if ( !["activity", "keepConditions", "keepHp"].includes(key) ) errors.push(`${at}secondPhase.${key}: unknown key`);
    }
  }
  if ( "changesForm" in entry ) {
    const p = entry.changesForm;
    if ( !isObject(p) || !isId(p.activity) ) errors.push(`${at}changesForm.activity: activity id (16 characters) expected`);
    else {
      if ( ("keepConditions" in p) && (typeof p.keepConditions !== "boolean") ) errors.push(`${at}changesForm.keepConditions: boolean`);
      if ( ("keepHp" in p) && (typeof p.keepHp !== "boolean") ) errors.push(`${at}changesForm.keepHp: boolean`);
      for ( const key of Object.keys(p) ) if ( !["activity", "keepConditions", "keepHp"].includes(key) ) errors.push(`${at}changesForm.${key}: unknown key`);
    }
  }
  const isMargin = mg => isObject(mg) && Object.keys(mg).length && Object.entries(mg).every(([k, v]) => ["min", "max"].includes(k) && Number.isFinite(v) && (v >= 0));
  if ( "failMargins" in entry ) {
    const f = entry.failMargins;
    if ( !isObject(f) || !Object.keys(f).length ) errors.push(`${at}failMargins: { effect id: { min?, max? } }`);
    else for ( const [id, mg] of Object.entries(f) ) {
      if ( !isId(id) ) errors.push(`${at}failMargins.${id}: effect id (16 characters)`);
      if ( !isMargin(mg) ) errors.push(`${at}failMargins.${id}: { min?, max? } (numbers ≥ 0)`);
    }
  }
  if ( ("orders" in entry) && (!Array.isArray(entry.orders) || !entry.orders.length || !entry.orders.every(o => ORDERS.includes(o))) ) {
    errors.push(`${at}orders: list of orders among ${ORDERS.join(", ")}`);
  }
  if ( "resize" in entry ) {
    const r = entry.resize;
    if ( !isObject(r) || !Object.keys(r).length ) errors.push(`${at}resize: { effect id: steps }`);
    else for ( const [id, steps] of Object.entries(r) ) {
      if ( !isId(id) ) errors.push(`${at}resize.${id}: effect id (16 characters)`);
      if ( !Number.isInteger(steps) || !steps || (Math.abs(steps) > 5) ) errors.push(`${at}resize.${id}: non-zero integer, from -5 to 5`);
    }
  }
  if ( ("reactions" in entry) && !(isObject(entry.reactions) && Number.isInteger(entry.reactions.perRound) && (entry.reactions.perRound >= 1) && (Object.keys(entry.reactions).length === 1)) ) {
    errors.push(`${at}reactions: { perRound } (integer ≥ 1)`);
  }
  if ( ("counter" in entry) && !(isObject(entry.counter) && Object.keys(entry.counter).every(k => k === "level")
    && (!("level" in entry.counter) || (Number.isInteger(entry.counter.level) && (entry.counter.level >= 0) && (entry.counter.level <= 9)))) ) {
    errors.push(`${at}counter: { level? } (spell level, integer from 0 to 9)`);
  }
  if ( ("lastStand" in entry) && !(isObject(entry.lastStand) && Number.isFinite(entry.lastStand.threshold) && (entry.lastStand.threshold >= 0) && (Object.keys(entry.lastStand).length === 1)) ) {
    errors.push(`${at}lastStand: { threshold } (number ≥ 0)`);
  }
  if ( "basicActions" in entry ) {
    const b = entry.basicActions;
    if ( !isObject(b) || !Object.keys(b).length ) errors.push(`${at}basicActions: { activity id: ${BASIC_ACTION_KINDS.join(" | ")} }`);
    else for ( const [id, kind] of Object.entries(b) ) {
      if ( !isId(id) ) errors.push(`${at}basicActions.${id}: activity id (16 characters)`);
      // §24 : plusieurs actions pour une activité (Défense patiente : Se désengager et Esquiver) ; §65 : une au choix.
      if ( isObject(kind) && !Array.isArray(kind) ) {
        const ok = Array.isArray(kind.choose) && (kind.choose.length >= 2) && kind.choose.every(k => BASIC_ACTION_KINDS.includes(k))
          && (Object.keys(kind).length === 1);
        if ( !ok ) errors.push(`${at}basicActions.${id}: { choose: [at least two among ${BASIC_ACTION_KINDS.join(", ")}] }`);
        continue;
      }
      const kinds = Array.isArray(kind) ? kind : [kind];
      if ( !kinds.length || !kinds.every(k => BASIC_ACTION_KINDS.includes(k)) ) errors.push(`${at}basicActions.${id}: ${BASIC_ACTION_KINDS.join(", ")} (or a list)`);
    }
  }
  // K2 (§323) : `killsAtZero` — true, ou réservé à des types de créature, une taille au plus, des activités de l'item.
  if ( ("killsAtZero" in entry) && (entry.killsAtZero !== true) ) {
    const k = entry.killsAtZero;
    const ok = isObject(k) && Object.keys(k).every(x => ["types", "sizeAtMost", "activities"].includes(x))
      && (!("types" in k) || (Array.isArray(k.types) && k.types.length && k.types.every(t => typeof t === "string" && t)))
      && (!("sizeAtMost" in k) || ["tiny", "sm", "med", "lg", "huge", "grg"].includes(k.sizeAtMost))
      && (!("activities" in k) || (Array.isArray(k.activities) && k.activities.length && k.activities.every(isId)));
    if ( !ok ) errors.push(`${at}killsAtZero: true or { types?, sizeAtMost?, activities? }`);
  }
  for ( const key of ["singleAttack", "noAttacksOrSpells", "noSpells", "knownToOrigin", "upkeep", "keepsProne", "wardsAtZero", "stableAtZero", "dispel", "zoneEffects", "advantageIfFighting", "regeneration", "fortitude", "drain", "swallow", "ignoresCloseCombat", "sharedHp", "forOneAttack", "evasion", "avoidance", "elusive", "holdsStill", "grantsAction", "studiedAttacks", "heroicWarrior", "greatWeaponFighting", "persistentRage", "reckless", "oneAttack", "martialArts", "supremeHealing", "discipleOfLife", "blessedHealer", "potentCantrip", "sculptSpells", "stabilizes", "kindles", "castTargets", "halfOnMiss", "seesInvisible", "scatter", "climbsCeilings", "climbsOnTurn", "slippery", "notOnSlippery", "encloses", "willingFails", "critMove", "combatInspiration", "quietPose", "zoneBound", "effectsFirst", "hitDefense", "enterOnPose", "summonEffectsOnCaster", "sniper"] ) if ( (key in entry) && (entry[key] !== true) ) errors.push(`${at}${key}: true or absent`);
  // §225, lot 4 : passer du plan matériel à l'Éthéré ou inversement (Saut éthéré) ; `others` : les cibles désignées suivent (Foulée éthérée).
  if ( ("etherealShift" in entry) && !((entry.etherealShift === true) || (isObject(entry.etherealShift)
    && Object.keys(entry.etherealShift).every(k => k === "others") && (entry.etherealShift.others === true))) ) {
    errors.push(`${at}etherealShift: true or { others: true }`);
  }
  validateExtras(entry, at, errors);
  // §367 : la fin d'un effet de l'item fait utiliser une activité de l'item autour de son porteur (Esprit de l'ombre).
  if ( "endActivity" in entry ) {
    const e = entry.endActivity;
    if ( !isObject(e) || !Object.keys(e).length ) errors.push(`${at}endActivity: { effect id: { activity, radius, units } }`);
    else for ( const [id, r] of Object.entries(e) ) {
      if ( !isId(id) ) errors.push(`${at}endActivity: "${id}" is not an effect id (16 characters)`);
      if ( !isObject(r) || !isId(r.activity) || !(Number.isFinite(r.radius) && (r.radius > 0)) || (typeof r.units !== "string") || !r.units
        || !Object.keys(r).every(k => ["activity", "radius", "units"].includes(k)) ) errors.push(`${at}endActivity.${id}: { activity, radius, units }`);
    }
  }
  // §367 : pas d'attaque à distance avec une arme dans la zone de l'item (Tempête de vengeance), dès le rejeu `fromPulse` du lanceur.
  if ( ("noRangedWeapons" in entry) && !((entry.noRangedWeapons === true) || (isObject(entry.noRangedWeapons)
    && Number.isInteger(entry.noRangedWeapons.fromPulse) && (entry.noRangedWeapons.fromPulse > 0)
    && (Object.keys(entry.noRangedWeapons).length === 1))) ) errors.push(`${at}noRangedWeapons: true or { fromPulse }`);
  if ( ("drawsOnEnd" in entry) && (!isObject(entry.drawsOnEnd) || !Object.keys(entry.drawsOnEnd).length
    || !Object.entries(entry.drawsOnEnd).every(([id, uuid]) => isId(id) && (typeof uuid === "string") && /RollTable\.[A-Za-z0-9]{16}$/.test(uuid))) ) {
    errors.push(`${at}drawsOnEnd: { effect id: RollTable uuid }`);
  }
  if ( ("catalyst" in entry) && (!isObject(entry.catalyst) || !isId(entry.catalyst.save) || !isId(entry.catalyst.cast) || !isId(entry.catalyst.effect)
    || Object.keys(entry.catalyst).some(k => !["save", "cast", "effect"].includes(k))) ) errors.push(`${at}catalyst: { save, cast, effect } (16-character ids)`);
  if ( ("curesOn" in entry) && !isId(entry.curesOn) ) errors.push(`${at}curesOn: an activity id (16 characters)`);
  if ( ("endsOnUse" in entry) && (!Array.isArray(entry.endsOnUse) || !entry.endsOnUse.length || !entry.endsOnUse.every(isId)) ) errors.push(`${at}endsOnUse: [activity ids]`);
  if ( ("cures" in entry) && (!Array.isArray(entry.cures) || !entry.cures.length || !entry.cures.every(s => (typeof s === "string") && s)) ) {
    errors.push(`${at}cures: list of condition identifiers`);
  }
  // Relevé des trous (2026-10-22) : les sorts dont les dégâts ne rompent pas la concentration (Chasseur implacable : Marque du chasseur).
  if ( ("keepsConcentration" in entry) && (!Array.isArray(entry.keepsConcentration) || !entry.keepsConcentration.length
    || !entry.keepsConcentration.every(s => (typeof s === "string") && s)) ) errors.push(`${at}keepsConcentration: list of item identifiers`);
  // Relevé des trous : les sorts de cette classe qui infligent des dégâts peuvent prendre ces types (Sorts psychiques : psychique).
  if ( "spellDamageTypes" in entry ) {
    const d = entry.spellDamageTypes;
    if ( !isObject(d) || (typeof d.class !== "string") || !d.class || !Array.isArray(d.types) || !d.types.length
      || !d.types.every(t => (typeof t === "string") && t) || !Object.keys(d).every(k => ["class", "types"].includes(k)) ) {
      errors.push(`${at}spellDamageTypes: { class, types } (class identifier, damage types)`);
    }
  }
  // Relevé des trous, §236 : listes de chaînes (états retirés en fin de tour, types de résistance, caractéristiques plancher).
  const strings = v => Array.isArray(v) && v.length && v.every(s => (typeof s === "string") && s);
  for ( const key of ["grantsResistances", "scoreFloor"] ) {
    if ( (key in entry) && !strings(entry[key]) ) errors.push(`${at}${key}: list of identifiers`);
  }
  // §278 : la liste d'états, ou { statuses?, at?, exhaustion?, uses? } (core/self-care.mjs).
  if ( "endsOwnConditions" in entry ) {
    const e = entry.endsOwnConditions;
    const ok = Array.isArray(e) ? strings(e) : (isObject(e) && Object.keys(e).every(k => ["statuses", "at", "exhaustion", "uses"].includes(k))
      && (!("statuses" in e) || strings(e.statuses)) && (!("at" in e) || ["turnStart", "turnEnd"].includes(e.at))
      && ["exhaustion", "uses"].every(k => !(k in e) || (e[k] === true)) && (strings(e.statuses) || (e.exhaustion === true)));
    if ( !ok ) errors.push(`${at}endsOwnConditions: list of statuses, or { statuses?, at?: turnStart|turnEnd, exhaustion?: true, uses?: true }`);
  }
  // §278 : { item, upTo } (§236), ou { items?, exhaustion?, uses? }.
  if ( "regainOnInitiative" in entry ) {
    const r = entry.regainOnInitiative;
    const legacy = isObject(r) && (typeof r.item === "string") && r.item && Number.isInteger(r.upTo) && (r.upTo > 0)
      && Object.keys(r).every(k => ["item", "upTo"].includes(k));
    const wide = isObject(r) && !("item" in r) && Object.keys(r).every(k => ["items", "exhaustion", "uses"].includes(k))
      && (!("items" in r) || strings(r.items)) && (!("exhaustion" in r) || (Number.isInteger(r.exhaustion) && (r.exhaustion > 0)))
      && (!("uses" in r) || (r.uses === true)) && (("items" in r) || ("exhaustion" in r));
    if ( !legacy && !wide ) errors.push(`${at}regainOnInitiative: { item, upTo } or { items?, exhaustion?, uses? } (identifiers, positive integers)`);
  }
  if ( "cantripRange" in entry ) {
    const r = entry.cantripRange;
    if ( !isObject(r) || (typeof r.class !== "string") || !r.class || !isObject(r.add) || !Number.isFinite(r.add.value) || (typeof r.add.units !== "string")
      || (("requires" in r) && ((typeof r.requires !== "string") || !r.requires)) || !Object.keys(r).every(k => ["class", "add", "requires"].includes(k)) ) {
      errors.push(`${at}cantripRange: { class, add: { value, units }, requires? }`);
    }
  }
  if ( ("fleetStep" in entry) && !(isObject(entry.fleetStep) && (typeof entry.fleetStep.item === "string") && entry.fleetStep.item && isId(entry.fleetStep.activity)
    && Object.keys(entry.fleetStep).every(k => ["item", "activity"].includes(k))) ) errors.push(`${at}fleetStep: { item, activity } (identifier, activity id)`);
  if ( ("extraFirstTurn" in entry) && !(isObject(entry.extraFirstTurn) && Number.isFinite(entry.extraFirstTurn.minus) && (entry.extraFirstTurn.minus > 0)
    && Object.keys(entry.extraFirstTurn).every(k => k === "minus")) ) errors.push(`${at}extraFirstTurn: { minus } (positive number)`);
  if ( ("curesAll" in entry) && (!Array.isArray(entry.curesAll) || !entry.curesAll.length || !entry.curesAll.every(s => (typeof s === "string") && s)) ) {
    errors.push(`${at}curesAll: list of condition identifiers`);
  }
  // §285 : sorts de contrôle.
  for ( const key of ["confusion", "noBonus", "forcedAttack"] ) if ( (key in entry) && !isId(entry[key]) ) errors.push(`${at}${key}: effect id (16 characters)`);
  if ( "panic" in entry ) {
    const p = entry.panic;
    const okEnd = e => isObject(e) && Number.isFinite(e.distance) && (e.distance > 0) && (typeof e.units === "string") && e.units && Object.keys(e).every(k => ["distance", "units"].includes(k));
    if ( !isObject(p) || (("effect" in p) && !isId(p.effect)) || (("drop" in p) && (p.drop !== true)) || (("endsAt" in p) && !okEnd(p.endsAt))
      || !Object.keys(p).every(k => ["effect", "drop", "endsAt"].includes(k)) ) errors.push(`${at}panic: { effect?: <effect id>, drop?: true, endsAt?: { distance, units } }`);
  }
  // O1 (§335) : corrections de la donnée premium d'un objet (core/data-fixes.mjs).
  if ( "dataFixes" in entry ) errors.push(...validateDataFixes(entry.dataFixes, at));
  if ( ("includesOrigin" in entry) && (entry.includesOrigin !== true) ) errors.push(`${at}includesOrigin: true or absent`);
  // K7 (§328) : `absorbsDamage` — types de dégâts que le porteur change en soin (Absorption de l'acide du Golem d'argile).
  if ( ("absorbsDamage" in entry) && !(Array.isArray(entry.absorbsDamage) && entry.absorbsDamage.length
    && entry.absorbsDamage.every(s => (typeof s === "string") && /^[a-z]+$/.test(s))) ) errors.push(`${at}absorbsDamage: list of damage types`);
  // C12-j : `regainOnShortRest` — identifiants d'items dont les utilisations reviennent au Repos court.
  if ( ("regainOnShortRest" in entry) && !(Array.isArray(entry.regainOnShortRest) && entry.regainOnShortRest.length
    && entry.regainOnShortRest.every(s => (typeof s === "string") && s)) ) errors.push(`${at}regainOnShortRest: list of item identifiers`);
  // C12-d : `grants` — l'activité `activity` de l'item donnée aux cibles de l'activité `from` (Souffle du dragon).
  if ( ("grants" in entry) && !(isObject(entry.grants) && isId(entry.grants.from) && isId(entry.grants.activity)
    && Object.keys(entry.grants).every(k => ["from", "activity"].includes(k))) ) errors.push(`${at}grants: { from, activity } (activity ids)`);
  // C12-f : `retort` — les dégâts subis renvoyés à l'attaquant qui rate la sauvegarde de la réaction (Défenses envoûtantes).
  if ( ("retort" in entry) && !(isObject(entry.retort) && DAMAGE_TYPES.includes(entry.retort.damageType) && Object.keys(entry.retort).every(k => k === "damageType")) ) {
    errors.push(`${at}retort: { damageType }`);
  }
  // §334 : `noReactions`, `actionOrBonus` — de même, tous les effets ou ceux-là (Rayon ralentissant).
  for ( const key of ["noReactions", "actionOrBonus", "blocksHealing"] ) {
    if ( (key in entry) && (entry[key] !== true) && !(Array.isArray(entry[key]) && entry[key].length && entry[key].every(isId)) ) errors.push(`${at}${key}: true or list of effect ids`);
  }
  // C12-e : `noOpportunityAttacks` — tous les effets de l'item, ou ceux-là (Coup chancelant).
  if ( ("noOpportunityAttacks" in entry) && (entry.noOpportunityAttacks !== true)
    && !(Array.isArray(entry.noOpportunityAttacks) && entry.noOpportunityAttacks.length && entry.noOpportunityAttacks.every(isId)) ) {
    errors.push(`${at}noOpportunityAttacks: true or a list of effect ids`);
  }
  // C12-e : Coup brutal — ses options (poussée ou effet de l'item), le nombre d'options par coup.
  if ( "brutalStrike" in entry ) {
    const b = entry.brutalStrike;
    const okOption = o => isObject(o) && Object.keys(o).every(k => ["push", "effect"].includes(k)) && (("push" in o) || ("effect" in o))
      && (!("effect" in o) || isId(o.effect))
      && (!("push" in o) || (isObject(o.push) && Number.isFinite(o.push.distance) && (o.push.distance > 0) && (typeof o.push.units === "string")));
    if ( !isObject(b) || !Object.keys(b).every(k => ["options", "count"].includes(k))
      || (("options" in b) && !(isObject(b.options) && Object.values(b.options).every(okOption)))
      || (("count" in b) && !(Number.isInteger(b.count) && (b.count > 0))) ) {
      errors.push(`${at}brutalStrike: { options?: { <name>: { push?: { distance, units }, effect?: <effect id> } }, count?: integer }`);
    }
  }
  if ( "effectChanges" in entry ) {
    const e = entry.effectChanges;
    const okChange = c => isObject(c) && (typeof c.key === "string") && c.key && (typeof c.type === "string") && c.type
      && ["string", "number", "boolean"].includes(typeof c.value) && (!("replace" in c) || (c.replace === true))
      && (!("ifCaster" in c) || ((typeof c.ifCaster === "string") && c.ifCaster))
      && Object.keys(c).every(k => ["key", "type", "value", "replace", "ifCaster"].includes(k));
    if ( !isObject(e) || !Object.entries(e).every(([id, list]) => isId(id) && Array.isArray(list) && list.length && list.every(okChange)) ) {
      errors.push(`${at}effectChanges: { <effect id>: [{ key, type, value, replace?, ifCaster? }] }`);
    }
  }
  if ( "grantsSpeeds" in entry ) {
    const g = entry.grantsSpeeds;
    const okSpeed = ([type, value]) => ["burrow", "climb", "fly", "swim"].includes(type) && ((value === "walk") || (Number.isFinite(value) && (value > 0)));
    if ( !isObject(g) || !Object.keys(g).length || !Object.entries(g).every(okSpeed) ) errors.push(`${at}grantsSpeeds: { burrow|climb|fly|swim: "walk" or a positive number }`);
  }
  if ( ("potionEffect" in entry) && !isId(entry.potionEffect) ) errors.push(`${at}potionEffect: effect id (16 characters)`);
  if ( ("enchantTarget" in entry) && !["weapon", "ownWeapon"].includes(entry.enchantTarget) ) errors.push(`${at}enchantTarget: "weapon" or "ownWeapon"`);
  if ( "pact" in entry ) {
    const p = entry.pact;
    if ( !isObject(p) || !Array.isArray(p.damageTypes) || !p.damageTypes.length || !p.damageTypes.every(t => (typeof t === "string") && t) ) {
      errors.push(`${at}pact.damageTypes: list of damage types`);
    }
    else {
      if ( ("ability" in p) && ((typeof p.ability !== "string") || !p.ability) ) errors.push(`${at}pact.ability: ability`);
      for ( const key of Object.keys(p) ) if ( !["damageTypes", "ability"].includes(key) ) errors.push(`${at}pact.${key}: unknown key`);
    }
  }
  // §124 : « self » (sans valeur) — une capacité que les données disent viser une créature, mais qui ne vise que le lanceur.
  const isRange = r => isObject(r) && (((r.units === "self") && !("value" in r))
    || (Number.isFinite(r.value) && (r.value > 0) && (typeof r.units === "string") && !!r.units));
  if ( "ranges" in entry ) {
    if ( !isObject(entry.ranges) ) errors.push(`${at}ranges: { activity id: { value, units } }`);
    else for ( const [id, r] of Object.entries(entry.ranges) ) {
      if ( !isId(id) ) errors.push(`${at}ranges.${id}: activity id (16 characters) expected`);
      if ( !isRange(r) ) errors.push(`${at}ranges.${id}: { value, units }`);
    }
  }
  if ( "tether" in entry ) {
    const t = entry.tether;
    if ( !isObject(t) ) errors.push(`${at}tether: { attack, activity, range }`);
    else {
      for ( const key of ["attack", "activity"] ) if ( !isId(t[key]) ) errors.push(`${at}tether.${key}: activity id (16 characters) expected`);
      if ( !isRange(t.range) ) errors.push(`${at}tether.range: { value, units }`);
      for ( const key of Object.keys(t) ) if ( !["attack", "activity", "range"].includes(key) ) errors.push(`${at}tether.${key}: unknown key`);
    }
  }
  if ( "teleport" in entry ) validateTeleport(entry.teleport, `${at}teleport`, errors);
  if ( "contest" in entry ) {
    const c = entry.contest;
    const skill = x => (typeof x === "string") && /^[a-z]{3}$/.test(x);
    if ( !isObject(c) ) errors.push(`${at}contest: an object`);
    else {
      if ( ("activity" in c) && !isId(c.activity) ) errors.push(`${at}contest.activity: activity id (16 characters) expected`);
      if ( !skill(c.skill) ) errors.push(`${at}contest.skill: skill key ("ins")`);
      if ( !Array.isArray(c.against) || !c.against.length || !c.against.every(skill) ) errors.push(`${at}contest.against: list of skill keys`);
      if ( !isId(c.effect) ) errors.push(`${at}contest.effect: effect id (16 characters) expected`);
      if ( ("exclusive" in c) && (c.exclusive !== true) ) errors.push(`${at}contest.exclusive: true or absent`);
      for ( const key of Object.keys(c) ) if ( !["activity", "skill", "against", "effect", "exclusive"].includes(key) ) errors.push(`${at}contest.${key}: unknown key`);
    }
  }
  if ( ("zoneCharges" in entry) && !((Number.isInteger(entry.zoneCharges) && (entry.zoneCharges > 0)) || ((typeof entry.zoneCharges === "string") && entry.zoneCharges.trim())) ) errors.push(`${at}zoneCharges: positive integer or formula`);
  if ( "selfZone" in entry ) {
    if ( !isObject(entry.selfZone) || !Object.keys(entry.selfZone).length ) errors.push(`${at}selfZone: { activity id: template }`);
    else for ( const [id, t] of Object.entries(entry.selfZone) ) {
      if ( !isId(id) ) errors.push(`${at}selfZone: "${id}" is not an activity id (16 characters)`);
      if ( !isObject(t) || !["radius", "sphere", "circle", "cube", "square"].includes(t.type) ) errors.push(`${at}selfZone.${id}.type: radius, sphere, circle, cube, square`);
      if ( !(Number.isFinite(t?.size) && (t.size > 0)) ) errors.push(`${at}selfZone.${id}.size: positive number`);
      if ( (typeof t?.units !== "string") || !t.units ) errors.push(`${at}selfZone.${id}.units: unit required`);
    }
  }
  // §279 : dégâts maximaux promis par une activité, ou sur la prochaine attaque qui touche le porteur d'un effet ; types en plus d'une arme.
  const kinds = w => Array.isArray(w) && w.length && w.every(k => WEAPON_KINDS.includes(k));
  if ( "maxDamage" in entry ) {
    const m = entry.maxDamage;
    if ( !isObject(m) || !isId(m.activity) || (("weapons" in m) && !kinds(m.weapons)) || (("refundOnHit" in m) && (m.refundOnHit !== true))
      || !Object.keys(m).every(k => ["activity", "weapons", "refundOnHit"].includes(k)) ) {
      errors.push(`${at}maxDamage: { activity, weapons?: [${WEAPON_KINDS.join("|")}], refundOnHit?: true }`);
    }
  }
  // §372 : un id d'effet — seul le porteur de CET effet de l'item (Mise en danger, pas l'effet de Provocation du même item).
  if ( ("maxNextHit" in entry) && (entry.maxNextHit !== true) && !isId(entry.maxNextHit) ) errors.push(`${at}maxNextHit: true, an effect id, or absent`);
  // §281 : l'empoignade de l'auteur — plus grand pour Agripper et Pousser, traîner sans surcoût, Désavantage contre sa prise, abri.
  if ( "grappleSize" in entry ) {
    const g = entry.grappleSize;
    if ( !isObject(g) || !Object.keys(g).length || !Object.keys(g).every(k => ["bonus", "dragFree"].includes(k))
      || (("bonus" in g) && !(Number.isInteger(g.bonus) && (g.bonus > 0))) || (("dragFree" in g) && !Number.isInteger(g.dragFree)) ) {
      errors.push(`${at}grappleSize: { bonus?: positive integer, dragFree?: integer }`);
    }
  }
  // §374 : { activity } — le Désavantage se paie, au choix de l'agrippeur, avec ce que coûte cette activité de l'item (Inexorable : 1 Moxie).
  if ( ("inescapable" in entry) && (entry.inescapable !== true) && !(isObject(entry.inescapable) && isId(entry.inescapable.activity)
    && (Object.keys(entry.inescapable).length === 1)) ) errors.push(`${at}inescapable: true, { activity } or absent`);
  if ( ("grappleCover" in entry) && !["half", "threeQuarters"].includes(entry.grappleCover) ) errors.push(`${at}grappleCover: half | threeQuarters`);
  if ( "weaponDamageTypes" in entry ) {
    const d = entry.weaponDamageTypes;
    if ( !isObject(d) || !kinds(d.weapons) || !Array.isArray(d.types) || !d.types.length || !d.types.every(t => (typeof t === "string") && t)
      || !Object.keys(d).every(k => ["weapons", "types"].includes(k)) ) {
      errors.push(`${at}weaponDamageTypes: { weapons: [${WEAPON_KINDS.join("|")}], types: [damage types] }`);
    }
  }
  if ( ("pendingDie" in entry) && !(isObject(entry.pendingDie) && isId(entry.pendingDie.activity) && ["melee", "target"].includes(entry.pendingDie.against)
    && (Object.keys(entry.pendingDie).length === 2)) ) errors.push(`${at}pendingDie: { activity, against: melee|target }`);
  if ( ("rolledAc" in entry) && !(isObject(entry.rolledAc) && isId(entry.rolledAc.activity) && isId(entry.rolledAc.effect)
    && (!("to" in entry.rolledAc) || (entry.rolledAc.to === "choose"))
    && Object.keys(entry.rolledAc).every(k => ["activity", "effect", "to"].includes(k))) ) errors.push(`${at}rolledAc: { activity, effect, to?: "choose" }`);
  for ( const key of ["swapPlaces", "sweep", "commandStrike", "zoneEnd", "onNatural1"] ) {
    if ( (key in entry) && !(isObject(entry[key]) && isId(entry[key].activity) && (Object.keys(entry[key]).length === 1)) ) errors.push(`${at}${key}: { activity }`);
  }
  if ( ("zoneAffects" in entry) && !["enemy", "ally"].includes(entry.zoneAffects) ) errors.push(`${at}zoneAffects: enemy, ally`);
  if ( ("dropsEffects" in entry) && !(Array.isArray(entry.dropsEffects) && entry.dropsEffects.length && entry.dropsEffects.every(id => /^[A-Za-z0-9]{16}$/.test(id))) ) {
    errors.push(`${at}dropsEffects: list of effect ids (16 characters)`);
  }
  if ( ("noDamage" in entry) && !(Array.isArray(entry.noDamage) && entry.noDamage.length && entry.noDamage.every(id => /^[A-Za-z0-9]{16}$/.test(id))) ) {
    errors.push(`${at}noDamage: list of activity ids (16 characters)`);
  }
  if ( "effectsIf" in entry ) {
    if ( !isObject(entry.effectsIf) ) errors.push(`${at}effectsIf: a condition (object)`);
    else for ( const key of unknownFacts(entry.effectsIf, facts) ) errors.push(`${at}effectsIf: unknown fact "${key}"`);
  }
  if ( "storm" in entry ) {
    const t = entry.storm;
    if ( !isObject(t) ) errors.push(`${at}storm: an object`);
    else {
      if ( ("bonus" in t) && ((typeof t.bonus !== "string") || !/^\d*d\d+$/.test(t.bonus)) ) errors.push(`${at}storm.bonus: dice ("1d10")`);
      for ( const key of Object.keys(t) ) if ( key !== "bonus" ) errors.push(`${at}storm.${key}: unknown key`);
    }
  }
  if ( "difficultTerrain" in entry ) {
    const t = entry.difficultTerrain;
    if ( !isObject(t) ) errors.push(`${at}difficultTerrain: an object`);
    else {
      if ( ("types" in t) && (!Array.isArray(t.types) || !t.types.every(x => (typeof x === "string") && x)) ) errors.push(`${at}difficultTerrain.types: list of strings`);
      if ( ("cost" in t) && !(Number.isFinite(t.cost) && (t.cost > 1) && (t.cost <= 5)) ) errors.push(`${at}difficultTerrain.cost: a multiplier, more than 1, up to 5`);
      if ( ("lingers" in t) && (t.lingers !== "casterNextTurnEnd") ) errors.push(`${at}difficultTerrain.lingers: casterNextTurnEnd`);
      for ( const key of Object.keys(t) ) if ( !["types", "cost", "lingers"].includes(key) ) errors.push(`${at}difficultTerrain.${key}: unknown key`);
    }
  }
  if ( "lineDash" in entry ) {
    const d = entry.lineDash;
    if ( !isObject(d) ) errors.push(`${at}lineDash: an object`);
    else {
      if ( !(Number.isFinite(d.reach) && (d.reach > 0)) ) errors.push(`${at}lineDash.reach: positive number`);
      if ( (typeof d.units !== "string") || !d.units ) errors.push(`${at}lineDash.units: unit required`);
      if ( ("activity" in d) && !isId(d.activity) ) errors.push(`${at}lineDash.activity: activity id (16 characters) expected`);
      for ( const key of Object.keys(d) ) if ( !["reach", "units", "activity"].includes(key) ) errors.push(`${at}lineDash.${key}: unknown key`);
    }
  }
  if ( "absorb" in entry ) validateAbsorb(entry.absorb, `${at}absorb`, errors);
  if ( "movable" in entry ) {
    const m = entry.movable;
    if ( !isObject(m) ) errors.push(`${at}movable: an object`);
    else {
      if ( !(Number.isFinite(m.distance) && (m.distance > 0)) ) errors.push(`${at}movable.distance: positive number`);
      if ( (typeof m.units !== "string") || !m.units ) errors.push(`${at}movable.units: unit required`);
      for ( const key of Object.keys(m) ) if ( !["distance", "units"].includes(key) ) errors.push(`${at}movable.${key}: unknown key`);
    }
  }
  if ( "summon" in entry ) validateSummon(entry.summon, `${at}summon`, errors);
  if ( "burst" in entry ) {
    const b = entry.burst;
    if ( !isObject(b) ) errors.push(`${at}burst: an object`);
    else {
      if ( !isId(b.activity) ) errors.push(`${at}burst.activity: activity id (16 characters) expected`);
      if ( !(Number.isFinite(b.radius) && (b.radius >= 0)) ) errors.push(`${at}burst.radius: non-negative number`);
      if ( (typeof b.units !== "string") || !b.units ) errors.push(`${at}burst.units: unit required`);
      if ( ("from" in b) && (!Array.isArray(b.from) || !b.from.length || !b.from.every(isId)) ) errors.push(`${at}burst.from: list of activity ids`);
      if ( ("affects" in b) && (b.affects !== "enemy") ) errors.push(`${at}burst.affects: "enemy" or absent`);
      for ( const key of Object.keys(b) ) if ( !["activity", "radius", "units", "from", "affects"].includes(key) ) errors.push(`${at}burst.${key}: unknown key`);
    }
  }
  if ( ("recast" in entry) && (entry.recast !== true) ) errors.push(`${at}recast: true or absent`);
  for ( const flag of ["obscures", "healMax", "duplicates", "reactiveSpell", "revealsInvisible"] ) if ( (flag in entry) && (entry[flag] !== true) ) errors.push(`${at}${flag}: true or absent`);
  if ( "light" in entry ) validateLight(entry.light, `${at}light`, errors);
  if ( "carriedLight" in entry ) validateCarriedLight(entry.carriedLight, `${at}carriedLight`, errors);
  if ( "usageLimits" in entry ) {
    const u = entry.usageLimits;
    if ( !isObject(u) ) errors.push(`${at}usageLimits: { activity id: { oncePerTurn?, whenEmpty? } }`);
    else for ( const [id, rule] of Object.entries(u) ) {
      if ( !isId(id) ) errors.push(`${at}usageLimits.${id}: activity id (16 characters) expected`);
      if ( !isObject(rule) ) { errors.push(`${at}usageLimits.${id}: an object`); continue; }
      for ( const flag of ["oncePerTurn", "lowestSlot", "noDialog", "unmoved"] ) if ( (flag in rule) && (rule[flag] !== true) ) errors.push(`${at}usageLimits.${id}.${flag}: true or absent`);
      if ( ("whenEmpty" in rule) && ((typeof rule.whenEmpty !== "string") || !rule.whenEmpty) ) errors.push(`${at}usageLimits.${id}.whenEmpty: item identifier`);
      // §298 : « free » — l'utilisation ne coûte rien au budget (Arme sacrée : « lorsque vous prenez l'action Attaque »).
      if ( ("cost" in rule) && !["action", "bonus", "reaction", "free"].includes(rule.cost) ) errors.push(`${at}usageLimits.${id}.cost: action, bonus, reaction, free`);
      for ( const key of Object.keys(rule) ) if ( !["oncePerTurn", "whenEmpty", "lowestSlot", "noDialog", "cost", "unmoved"].includes(key) ) errors.push(`${at}usageLimits.${id}.${key}: unknown key`);
    }
  }
  if ( ("effectsExpire" in entry) && !EFFECT_EXPIRIES.includes(entry.effectsExpire) ) errors.push(`${at}effectsExpire: ${EFFECT_EXPIRIES.join(", ")}`);
  if ( "bolt" in entry ) {
    const b = entry.bolt;
    if ( !isObject(b) || !(Number.isFinite(b.radius) && (b.radius > 0)) || (typeof b.units !== "string") || !b.units ) errors.push(`${at}bolt: { radius, units }`);
    else for ( const key of Object.keys(b) ) if ( !["radius", "units"].includes(key) ) errors.push(`${at}bolt.${key}: unknown key`);
  }
  if ( ("saveAdvantage" in entry) && (!Array.isArray(entry.saveAdvantage) || !entry.saveAdvantage.length
    || !entry.saveAdvantage.every(s => (typeof s === "string") && s)) ) errors.push(`${at}saveAdvantage: list of condition identifiers`);
  // §208 : ce qui change le saut — élan plus court (Athlète), la Dextérité (Monte-en-l'air), un saut fixe une fois par tour (sort *Saut* :
  // porté par l'effet du sort ; Bottes : objet équipé), la distance doublée après ces activités (Pas du vent). Pieds.
  if ( "jump" in entry ) {
    const j = entry.jump;
    const fixedOk = f => isObject(f) && Number.isFinite(f.distance) && (f.distance > 0) && Number.isFinite(f.cost) && (f.cost >= 0)
      && (!("from" in f) || ["effect", "equipped"].includes(f.from));
    if ( !isObject(j) || !Object.keys(j).length || !Object.keys(j).every(k => ["runUp", "useDex", "fixed", "double"].includes(k))
      || (("runUp" in j) && !(Number.isFinite(j.runUp) && (j.runUp >= 0)))
      || (("useDex" in j) && (j.useDex !== true))
      || (("fixed" in j) && !fixedOk(j.fixed))
      || (("double" in j) && !(Array.isArray(j.double) && j.double.length && j.double.every(isId))) ) {
      errors.push(`${at}jump: { runUp?: feet, useDex?: true, fixed?: { distance, cost, from?: "effect"|"equipped" }, double?: [activity ids] }`);
    }
  }
  // §206 : « une créature de taille G ou supérieure a l'Avantage à ce jet » (Frappe piégeuse).
  // §212 : les effets de l'item qui valent « En feu » (feu grégeois) — ids d'effet, au format d'un `_id`.
  if ( ("burns" in entry) && !(Array.isArray(entry.burns) && entry.burns.length && entry.burns.every(id => /^[A-Za-z0-9]{16}$/.test(id))) ) errors.push(`${at}burns: [effect ids]`);
  if ( ("untypedDamage" in entry) && !DAMAGE_TYPES.includes(entry.untypedDamage) ) errors.push(`${at}untypedDamage: one of ${DAMAGE_TYPES.join(", ")}`);
  if ( "spellFailure" in entry ) {
    const f = entry.spellFailure;
    if ( !isObject(f) || !Number.isInteger(f.chance) || (f.chance < 1) || (f.chance > 100) ) errors.push(`${at}spellFailure: { chance: 1–100, component? }`);
    else if ( ("component" in f) && !SPELL_COMPONENTS.includes(f.component) ) errors.push(`${at}spellFailure.component: one of ${SPELL_COMPONENTS.join(", ")}`);
  }
  if ( ("saveAdvantageSize" in entry) && !SIZES.includes(entry.saveAdvantageSize) ) errors.push(`${at}saveAdvantageSize: one of ${SIZES.join(", ")}`);
  if ( "chain" in entry ) {
    const c = entry.chain;
    if ( !isObject(c) || !(Number.isFinite(c.radius) && (c.radius > 0)) || (typeof c.units !== "string") || !c.units ) errors.push(`${at}chain: { radius, units }`);
    else for ( const key of Object.keys(c) ) if ( !["radius", "units"].includes(key) ) errors.push(`${at}chain.${key}: unknown key`);
  }
  if ( "leap" in entry ) {
    const l = entry.leap;
    if ( !isObject(l) || !(Number.isFinite(l.radius) && (l.radius > 0)) || (typeof l.units !== "string") || !l.units
      || (typeof l.max !== "string") || !l.max.trim() ) errors.push(`${at}leap: { radius, units, max }`);
    else for ( const key of Object.keys(l) ) if ( !["radius", "units", "max"].includes(key) ) errors.push(`${at}leap.${key}: unknown key`);
  }
  if ( "projectiles" in entry ) {
    const p = entry.projectiles;
    if ( !isObject(p) || (typeof p.count !== "string") || !p.count.trim() ) errors.push(`${at}projectiles.count: formula expected`);
    else {
      if ( typeof p.attack !== "boolean" ) errors.push(`${at}projectiles.attack: boolean`);
      for ( const key of Object.keys(p) ) if ( !["count", "attack"].includes(key) ) errors.push(`${at}projectiles.${key}: unknown key`);
    }
  }
  if ( "bonusAttack" in entry ) {
    const b = entry.bonusAttack;
    if ( !isObject(b) || !Array.isArray(b.after) || !b.after.length || !b.after.every(a => BONUS_ATTACK_AFTER.includes(a)) ) {
      errors.push(`${at}bonusAttack.after: list among ${BONUS_ATTACK_AFTER.join(", ")}`);
    }
    else {
      if ( ("melee" in b) && (typeof b.melee !== "boolean") ) errors.push(`${at}bonusAttack.melee: boolean`);
      for ( const key of Object.keys(b) ) if ( !["after", "melee"].includes(key) ) errors.push(`${at}bonusAttack.${key}: unknown key`);
    }
  }
  if ( "onFell" in entry ) {
    const f = entry.onFell;
    if ( !isObject(f) ) errors.push(`${at}onFell: an object`);
    else {
      if ( ("activity" in f) && !isId(f.activity) ) errors.push(`${at}onFell.activity: activity id (16 characters) expected`);
      if ( !(Number.isFinite(f.radius) && (f.radius >= 0)) ) errors.push(`${at}onFell.radius: non-negative number`);
      if ( (typeof f.units !== "string") || !f.units ) errors.push(`${at}onFell.units: unit required`);
      for ( const key of Object.keys(f) ) if ( !["activity", "radius", "units"].includes(key) ) errors.push(`${at}onFell.${key}: unknown key`);
    }
  }
  if ( ("saveDamage" in entry) && !(isObject(entry.saveDamage) && Object.keys(entry.saveDamage).length
    && Object.entries(entry.saveDamage).every(([id, v]) => isId(id) && ["none", "half"].includes(v))) ) errors.push(`${at}saveDamage: { <activity id>: none|half }`);
  if ( ("effectStatuses" in entry) && !(isObject(entry.effectStatuses) && Object.keys(entry.effectStatuses).length
    && Object.entries(entry.effectStatuses).every(([id, list]) => isId(id) && Array.isArray(list?.set ?? list) && (list?.set ?? list).length
      && (list?.set ?? list).every(s => (typeof s === "string") && s))) ) {
    errors.push(`${at}effectStatuses: { <effect id>: [conditions] | { set: [conditions] } }`);
  }
  if ( ("atZero" in entry) && !(isObject(entry.atZero) && isId(entry.atZero.activity)
    && (!("save" in entry.atZero) || (isObject(entry.atZero.save) && (typeof entry.atZero.save.ability === "string") && (typeof entry.atZero.save.dc === "string")))
    && (!("whileEffect" in entry.atZero) || ((typeof entry.atZero.whileEffect === "string") && entry.atZero.whileEffect))
    && Object.keys(entry.atZero).every(k => ["activity", "save", "whileEffect"].includes(k))) ) errors.push(`${at}atZero: { activity, save?: { ability, dc }, whileEffect? }`);
  if ( ("afterSneak" in entry) && !(isObject(entry.afterSneak) && isId(entry.afterSneak.activity) && Number.isFinite(entry.afterSneak.radius)
    && (entry.afterSneak.radius > 0) && (typeof entry.afterSneak.units === "string") && (Object.keys(entry.afterSneak).length === 3)) ) errors.push(`${at}afterSneak: { activity, radius, units }`);
  // §120
  if ( ("lifesteal" in entry) && !(isObject(entry.lifesteal)
    && (!("damageType" in entry.lifesteal) || ((typeof entry.lifesteal.damageType === "string") && entry.lifesteal.damageType))
    && (!("fraction" in entry.lifesteal) || ((typeof entry.lifesteal.fraction === "number") && (entry.lifesteal.fraction > 0) && (entry.lifesteal.fraction <= 1)))
    && Object.keys(entry.lifesteal).every(k => ["damageType", "fraction"].includes(k))) ) errors.push(`${at}lifesteal: { damageType?, fraction? (0 < f <= 1) }`);
  // §135 : faveurs épiques.
  for ( const key of ["peerlessAim", "fortifiedHealing", "overwhelmingStrike", "spellRecall"] ) if ( (key in entry) && (entry[key] !== true) ) errors.push(`${at}${key}: true or absent`);
  if ( ("lastStandHeal" in entry) && !(isObject(entry.lastStandHeal) && isId(entry.lastStandHeal.activity)
    && Object.keys(entry.lastStandHeal).every(k => k === "activity")) ) errors.push(`${at}lastStandHeal: { activity } (activity id)`);
  // §134 : dons du lot 5.
  // §139 : le grimoire du Magicien.
  if ( ("ritualAdept" in entry) && !(entry.ritualAdept && (typeof entry.ritualAdept.class === "string")) ) errors.push(`${at}ritualAdept: { class }`);
  if ( ("slotRecovery" in entry) && !(entry.slotRecovery && (typeof entry.slotRecovery.class === "string")
    && ((entry.slotRecovery.maxLevel === undefined) || Number.isInteger(entry.slotRecovery.maxLevel))) ) errors.push(`${at}slotRecovery: { class, maxLevel? }`);
  for ( const key of ["elementalAdept", "quickSearch", "reactiveStrike", "fleeOnFailedSave", "hardToPerceive"] ) if ( (key in entry) && (entry[key] !== true) ) errors.push(`${at}${key}: true or absent`);
  // O9g (§362) : `{ whileEffect }` — seulement tant que cet effet de l'item s'applique (Bottes de rapidité, talons claqués).
  if ( ("opportunityDisadvantage" in entry) && (entry.opportunityDisadvantage !== true)
    && !(isObject(entry.opportunityDisadvantage) && isId(entry.opportunityDisadvantage.whileEffect) && (Object.keys(entry.opportunityDisadvantage).length === 1)) ) {
    errors.push(`${at}opportunityDisadvantage: true or { whileEffect: effect id }`);
  }
  if ( ("ignoresResistance" in entry) && !(isObject(entry.ignoresResistance) && Array.isArray(entry.ignoresResistance.types) && entry.ignoresResistance.types.length
    && entry.ignoresResistance.types.every(t => (typeof t === "string") && t) && Object.keys(entry.ignoresResistance).every(k => k === "types")) ) {
    errors.push(`${at}ignoresResistance: { types: [damage types] }`);
  }
  if ( ("quickStand" in entry) && !(isObject(entry.quickStand) && Number.isFinite(entry.quickStand.value) && (entry.quickStand.value > 0)
    && (typeof entry.quickStand.units === "string") && entry.quickStand.units && Object.keys(entry.quickStand).every(k => ["value", "units"].includes(k))) ) {
    errors.push(`${at}quickStand: { value, units }`);
  }
  // §133 : réactions de don.
  if ( ("haltOnReaction" in entry) && !(isObject(entry.haltOnReaction) && isId(entry.haltOnReaction.effect)
    && Object.keys(entry.haltOnReaction).every(k => k === "effect")) ) errors.push(`${at}haltOnReaction: { effect } (effect id)`);
  for ( const key of ["concentrationBreaker", "interposeShield"] ) if ( (key in entry) && (entry[key] !== true) ) errors.push(`${at}${key}: true or absent`);
  // §132 : coups.
  if ( ("piercer" in entry) && (entry.piercer !== true) ) errors.push(`${at}piercer: true or absent`);
  if ( ("critMark" in entry) && !(isObject(entry.critMark) && (typeof entry.critMark.damageType === "string") && entry.critMark.damageType
    && ["against", "by"].includes(entry.critMark.side) && Object.keys(entry.critMark).every(k => ["damageType", "side"].includes(k))) ) {
    errors.push(`${at}critMark: { damageType, side: against | by }`);
  }
  if ( ("grappleDamage" in entry) && !(isObject(entry.grappleDamage) && (typeof entry.grappleDamage.formula === "string") && entry.grappleDamage.formula
    && (typeof entry.grappleDamage.damageType === "string") && entry.grappleDamage.damageType
    && Object.keys(entry.grappleDamage).every(k => ["formula", "damageType"].includes(k))) ) errors.push(`${at}grappleDamage: { formula, damageType }`);
  // §131 : dons de tir.
  if ( "rangedFeat" in entry ) {
    const r = entry.rangedFeat;
    if ( !isObject(r) || !["weapon", "crossbow", "spell"].includes(r.kind)
      || !["cover", "closeCombat", "longRange", "offhandModifier", "loading"].every(k => !(k in r) || (r[k] === true))
      || (("spellRange" in r) && !(isObject(r.spellRange) && Number.isFinite(r.spellRange.value) && (r.spellRange.value > 0) && (typeof r.spellRange.units === "string") && r.spellRange.units
        && (!("school" in r.spellRange) || ((typeof r.spellRange.school === "string") && r.spellRange.school))))
      || !Object.keys(r).every(k => ["kind", "cover", "closeCombat", "longRange", "offhandModifier", "loading", "spellRange"].includes(k)) ) {
      errors.push(`${at}rangedFeat: { kind: weapon | crossbow | spell, cover?, closeCombat?, longRange?, offhandModifier?: true, spellRange?: { value, units } }`);
    }
  }
  // §130 : effets de don conditionnels.
  if ( "effectWhile" in entry ) {
    const ARMORS = ["light", "medium", "heavy"];
    const okIf = c => isObject(c) && Object.keys(c).every(k => ["armor", "oneHanded", "inCombat", "abilityAtLeast", "light", "wildShaped", "hasEffect", "unarmored"].includes(k))
      && (!("unarmored" in c) || (c.unarmored === true))
      && (!("wildShaped" in c) || (c.wildShaped === true)) && (!("hasEffect" in c) || ((typeof c.hasEffect === "string") && c.hasEffect))
      && (!("light" in c) || (Array.isArray(c.light) && c.light.length && c.light.every(l => ["dark", "dim", "bright"].includes(l))))
      && (!("armor" in c) || (Array.isArray(c.armor) && c.armor.length && c.armor.every(a => ARMORS.includes(a))))
      && (!("oneHanded" in c) || (c.oneHanded === true)) && (!("inCombat" in c) || (c.inCombat === true))
      && (!("abilityAtLeast" in c) || (isObject(c.abilityAtLeast) && Object.values(c.abilityAtLeast).every(n => Number.isInteger(n) && (n > 0))));
    const okChanges = list => Array.isArray(list) && list.length && list.every(c => isObject(c) && (typeof c.key === "string") && c.key
      && (typeof c.type === "string") && c.type && ("value" in c));
    if ( !isObject(entry.effectWhile) || !Object.keys(entry.effectWhile).length || !Object.entries(entry.effectWhile).every(([id, r]) => isId(id)
      && isObject(r) && (okIf(r.if) || (!("if" in r) && ("changes" in r))) && (!("changes" in r) || okChanges(r.changes)) && Object.keys(r).every(k => ["if", "changes"].includes(k))) ) {
      errors.push(`${at}effectWhile: { <effect id>: { if: { armor?: [light|medium|heavy], oneHanded?: true, inCombat?: true, abilityAtLeast? }, changes? } }`);
    }
  }
  // §129 : dons d'origine du Manuel des joueurs.
  for ( const key of ["savageAttacker", "initiativeSwap", "healingRerolls"] ) {
    if ( (key in entry) && (entry[key] !== true) ) errors.push(`${at}${key}: true or absent`);
  }
  if ( ("rerollInitiative" in entry) && !(isObject(entry.rerollInitiative) && Number.isInteger(entry.rerollInitiative.atMost)
    && (entry.rerollInitiative.atMost >= 1) && (entry.rerollInitiative.atMost < 20)
    && Object.keys(entry.rerollInitiative).every(k => k === "atMost")) ) errors.push(`${at}rerollInitiative: { atMost } (integer 1–19)`);
  if ( ("searchBonus" in entry) && !(isObject(entry.searchBonus) && Object.keys(entry.searchBonus).length
    && (!("formula" in entry.searchBonus) || ((typeof entry.searchBonus.formula === "string") && entry.searchBonus.formula))
    && (!("advantage" in entry.searchBonus) || (entry.searchBonus.advantage === true))
    && Object.keys(entry.searchBonus).every(k => ["formula", "advantage"].includes(k))) ) errors.push(`${at}searchBonus: { formula?, advantage?: true }`);
  if ( "afterTeleport" in entry ) {
    const t = entry.afterTeleport;
    if ( !isObject(t) || !Array.isArray(t.spells) || !t.spells.length || !t.spells.every(x => (typeof x === "string") && x)
      || !Array.isArray(t.options) || !t.options.length || Object.keys(t).some(k => !["spells", "options"].includes(k))
      || !t.options.every(o => isObject(o) && isId(o.activity) && (!("around" in o) || ["left", "arrival"].includes(o.around))
        && Object.keys(o).every(k => ["activity", "around"].includes(k))) ) errors.push(`${at}afterTeleport: { spells: [identifiers], options: [{ activity, around?: left|arrival }] }`);
  }
  if ( "casterPulse" in entry ) {
    const p = entry.casterPulse;
    const int = (n, min) => Number.isInteger(n) && (n >= min);
    // §158 : `by` vide avec `away` — la zone ne fait que dériver (Brume mortelle, Nuage incendiaire : « s'éloigne de 3 m »).
    if ( !isObject(p) || !["turnStart", "turnEnd"].includes(p.at) || !Array.isArray(p.by) || (!p.by.length && !p.away) ) errors.push(`${at}casterPulse: { at: turnStart|turnEnd, by: [ … ] (or [] with away), ground? }`);
    else {
      for ( const flag of ["ground", "untilSpent"] ) if ( (flag in p) && (p[flag] !== true) ) errors.push(`${at}casterPulse.${flag}: true or absent`);
      if ( ("away" in p) && !(isObject(p.away) && Number.isFinite(p.away.distance) && (p.away.distance > 0) && (typeof p.away.units === "string") && p.away.units
        && (Object.keys(p.away).length === 2)) ) errors.push(`${at}casterPulse.away: { distance > 0, units }`);
      for ( const key of Object.keys(p) ) if ( !["at", "by", "ground", "away", "untilSpent"].includes(key) ) errors.push(`${at}casterPulse.${key}: unknown key`);
      p.by.forEach((b, i) => {
        if ( !isObject(b) || !isId(b.activity) || !int(b.from, 1) || (("to" in b) && !int(b.to, b.from))
          || (("max" in b) && !int(b.max, 1)) || (("use" in b) && (b.use !== true)) || (("pay" in b) && (b.pay !== true))
          || Object.keys(b).some(k => !["from", "to", "activity", "max", "use", "pay"].includes(k)) ) errors.push(`${at}casterPulse.by[${i}]: { from ≥ 1, to? ≥ from, activity, max?, use?, pay? }`);
      });
    }
  }
  if ( "atTurnStart" in entry ) {
    const t = entry.atTurnStart;
    if ( !isObject(t) || !isId(t.activity) ) errors.push(`${at}atTurnStart.activity: activity id (16 characters) expected`);
    else for ( const key of Object.keys(t) ) if ( key !== "activity" ) errors.push(`${at}atTurnStart.${key}: unknown key`);
  }
  return errors;
}

/** Les erreurs d'une table entière `{ identifiant: entrée }`. */
export function validateTable(table, { facts={} }={}) {
  if ( !isObject(table) ) return ["the table is an object { identifier: entry }"];
  return Object.entries(table).flatMap(([id, entry]) => validateEntry(entry, { facts, at: `${id}.` }));
}

/**
 * §277 : les erreurs d'une table de sources `{ id de document: identifiant }` — les correspondances qu'un module enregistre avec sa
 * table (`api.content.register(source, table, { sources })`) pour des items qui n'ont pas d'identifiant utilisable, comme
 * content/sources.mjs. Clé : l'id du document (16 caractères) ; valeur : un identifiant en kebab-case.
 * @returns {string[]}
 */
export function validateSources(sources) {
  if ( !isObject(sources) ) return ["sources: an object { document id: identifier } expected"];
  const errors = [];
  for ( const [docId, identifier] of Object.entries(sources) ) {
    if ( !isId(docId) ) errors.push(`sources.${docId}: document id (16 characters) expected`);
    if ( (typeof identifier !== "string") || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(identifier) ) errors.push(`sources.${docId}: kebab-case identifier expected`);
  }
  return errors;
}

/** §258 : `endsWhen: { armor?, apart?, zeroHp?, unaffected?, spell? }` — les fins génériques d'un sort ou d'un effet (core/endings.mjs). */
function validateEndsWhen(w, at, errors) {
  if ( !isObject(w) || !Object.keys(w).length ) return errors.push(`${at}: { armor?, apart?, zeroHp?, unaffected?, spell? }`);
  for ( const key of Object.keys(w) ) if ( !["armor", "apart", "zeroHp", "unaffected", "spell", "casterTargetsOther", "allyDamages", "incapacitated"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
  if ( ("armor" in w) && !ENDS_ARMOR.includes(w.armor) ) errors.push(`${at}.armor: ${ENDS_ARMOR.join(", ")}`);
  if ( "apart" in w ) {
    const a = w.apart;
    if ( !isObject(a) || !(Number(a.distance) > 0) || (typeof a.units !== "string") || !a.units ) errors.push(`${at}.apart: { distance, units, at? }`);
    else {
      if ( ("at" in a) && !ENDS_APART_AT.includes(a.at) ) errors.push(`${at}.apart.at: ${ENDS_APART_AT.join(", ")}`);
      for ( const key of Object.keys(a) ) if ( !["distance", "units", "at"].includes(key) ) errors.push(`${at}.apart.${key}: unknown key`);
    }
  }
  if ( ("zeroHp" in w) && (w.zeroHp !== true) ) errors.push(`${at}.zeroHp: true or absent`);
  // §299 : Neutralisé (ou mort) — le porteur, le lanceur, ou l'un ou l'autre.
  if ( ("incapacitated" in w) && !["bearer", "caster", "either"].includes(w.incapacitated) ) errors.push(`${at}.incapacitated: bearer, caster, either`);
  if ( ("unaffected" in w) && !ENDS_UNAFFECTED.includes(w.unaffected) ) errors.push(`${at}.unaffected: ${ENDS_UNAFFECTED.join(", ")}`);
  for ( const flag of ["spell", "casterTargetsOther", "allyDamages"] ) if ( (flag in w) && (w[flag] !== true) ) errors.push(`${at}.${flag}: true or absent`);
}
