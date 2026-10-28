/**
 * Validation d'une entrée de contenu (`validateEntry`) et d'une table entière (`validateTable`). Fonctions pures, aucune dépendance à Foundry.
 */

import { CREATURE_TYPES } from "../eligibility.mjs";
import { ORDERS } from "../orders.mjs";
import { unknownFacts } from "../triggers.mjs";
import { validateAbsorb, validateCarriedLight, validateChoice, validateEmanation, validateLight, validateSummon, validateTargets, validateTeleport } from "./annex.mjs";
import { BASIC_ACTION_KINDS, BONUS_ATTACK_AFTER, BREAK_MOMENTS, EFFECT_EXPIRIES, ENDS_APART_AT, ENDS_ARMOR, ENDS_UNAFFECTED, ENTRY_KEYS, SIZES } from "./enums.mjs";
import { validateExtras } from "./extras.mjs";
import { isId, isObject } from "./shared.mjs";
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
  if ( "breaksOn" in entry ) {
    const b = entry.breaksOn;
    if ( !Array.isArray(b) || !b.length || !b.every(m => BREAK_MOMENTS.includes(m)) ) errors.push(`${at}breaksOn: list among ${BREAK_MOMENTS.join(", ")}`);
  }
  if ( "endsWhen" in entry ) validateEndsWhen(entry.endsWhen, `${at}endsWhen`, errors);
  if ( "emanation" in entry ) validateEmanation(entry.emanation, `${at}emanation`, errors);
  if ( ("noOpportunity" in entry) && !["always", "flying", "afterUse", "whileEffect"].includes(entry.noOpportunity) ) errors.push(`${at}noOpportunity: always, flying, afterUse, whileEffect`);
  if ( ("sharesSpace" in entry) && !["enter", "mutual"].includes(entry.sharesSpace) ) errors.push(`${at}sharesSpace: enter, mutual`);
  if ( ("placesSummons" in entry) && (entry.placesSummons !== true) ) errors.push(`${at}placesSummons: true or absent`);
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
  for ( const key of ["actionOrBonus", "wardsAtZero", "stableAtZero", "dispel", "zoneEffects", "noReactions", "advantageIfFighting", "regeneration", "fortitude", "drain", "swallow", "ignoresCloseCombat", "sharedHp", "forOneAttack", "evasion", "elusive", "holdsStill", "grantsAction", "studiedAttacks", "heroicWarrior", "greatWeaponFighting", "persistentRage", "reckless", "blocksHealing", "noOpportunityAttacks", "oneAttack", "martialArts", "supremeHealing", "discipleOfLife", "blessedHealer", "potentCantrip", "sculptSpells", "endurance", "stabilizes", "kindles", "castTargets", "halfOnMiss", "seesInvisible", "scatter", "climbsCeilings", "climbsOnTurn", "slippery", "notOnSlippery", "encloses", "willingFails", "critMove", "combatInspiration"] ) if ( (key in entry) && (entry[key] !== true) ) errors.push(`${at}${key}: true or absent`);
  // §225, lot 4 : passer du plan matériel à l'Éthéré ou inversement (Saut éthéré) ; `others` : les cibles désignées suivent (Foulée éthérée).
  if ( ("etherealShift" in entry) && !((entry.etherealShift === true) || (isObject(entry.etherealShift)
    && Object.keys(entry.etherealShift).every(k => k === "others") && (entry.etherealShift.others === true))) ) {
    errors.push(`${at}etherealShift: true or { others: true }`);
  }
  validateExtras(entry, at, errors);
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
  for ( const key of ["endsOwnConditions", "grantsResistances", "scoreFloor"] ) {
    if ( (key in entry) && (!Array.isArray(entry[key]) || !entry[key].length || !entry[key].every(s => (typeof s === "string") && s)) ) errors.push(`${at}${key}: list of identifiers`);
  }
  if ( ("regainOnInitiative" in entry) && !(isObject(entry.regainOnInitiative) && (typeof entry.regainOnInitiative.item === "string") && entry.regainOnInitiative.item
    && Number.isInteger(entry.regainOnInitiative.upTo) && (entry.regainOnInitiative.upTo > 0) && Object.keys(entry.regainOnInitiative).every(k => ["item", "upTo"].includes(k))) ) {
    errors.push(`${at}regainOnInitiative: { item, upTo } (identifier, positive integer)`);
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
  if ( "effectChanges" in entry ) {
    const e = entry.effectChanges;
    const okChange = c => isObject(c) && (typeof c.key === "string") && c.key && (typeof c.type === "string") && c.type
      && ["string", "number", "boolean"].includes(typeof c.value) && (!("replace" in c) || (c.replace === true))
      && Object.keys(c).every(k => ["key", "type", "value", "replace"].includes(k));
    if ( !isObject(e) || !Object.entries(e).every(([id, list]) => isId(id) && Array.isArray(list) && list.length && list.every(okChange)) ) {
      errors.push(`${at}effectChanges: { <effect id>: [{ key, type, value, replace? }] }`);
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
  if ( ("zoneCharges" in entry) && !(Number.isInteger(entry.zoneCharges) && (entry.zoneCharges > 0)) ) errors.push(`${at}zoneCharges: positive integer`);
  if ( "selfZone" in entry ) {
    if ( !isObject(entry.selfZone) || !Object.keys(entry.selfZone).length ) errors.push(`${at}selfZone: { activity id: template }`);
    else for ( const [id, t] of Object.entries(entry.selfZone) ) {
      if ( !isId(id) ) errors.push(`${at}selfZone: "${id}" is not an activity id (16 characters)`);
      if ( !isObject(t) || !["radius", "sphere", "circle", "cube", "square"].includes(t.type) ) errors.push(`${at}selfZone.${id}.type: radius, sphere, circle, cube, square`);
      if ( !(Number.isFinite(t?.size) && (t.size > 0)) ) errors.push(`${at}selfZone.${id}.size: positive number`);
      if ( (typeof t?.units !== "string") || !t.units ) errors.push(`${at}selfZone.${id}.units: unit required`);
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
      for ( const key of Object.keys(b) ) if ( !["activity", "radius", "units", "from"].includes(key) ) errors.push(`${at}burst.${key}: unknown key`);
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
      if ( ("cost" in rule) && !["action", "bonus", "reaction"].includes(rule.cost) ) errors.push(`${at}usageLimits.${id}.cost: action, bonus, reaction`);
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
  if ( ("saveAdvantageSize" in entry) && !SIZES.includes(entry.saveAdvantageSize) ) errors.push(`${at}saveAdvantageSize: one of ${SIZES.join(", ")}`);
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
    && Object.entries(entry.effectStatuses).every(([id, list]) => isId(id) && Array.isArray(list) && list.length && list.every(s => (typeof s === "string") && s))) ) {
    errors.push(`${at}effectStatuses: { <effect id>: [conditions] }`);
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
  for ( const key of ["elementalAdept", "quickSearch", "opportunityDisadvantage", "reactiveStrike", "fleeOnFailedSave"] ) if ( (key in entry) && (entry[key] !== true) ) errors.push(`${at}${key}: true or absent`);
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
      || !["cover", "closeCombat", "longRange", "offhandModifier"].every(k => !(k in r) || (r[k] === true))
      || (("spellRange" in r) && !(isObject(r.spellRange) && Number.isFinite(r.spellRange.value) && (r.spellRange.value > 0) && (typeof r.spellRange.units === "string") && r.spellRange.units))
      || !Object.keys(r).every(k => ["kind", "cover", "closeCombat", "longRange", "offhandModifier", "spellRange"].includes(k)) ) {
      errors.push(`${at}rangedFeat: { kind: weapon | crossbow | spell, cover?, closeCombat?, longRange?, offhandModifier?: true, spellRange?: { value, units } }`);
    }
  }
  // §130 : effets de don conditionnels.
  if ( "effectWhile" in entry ) {
    const ARMORS = ["light", "medium", "heavy"];
    const okIf = c => isObject(c) && Object.keys(c).every(k => ["armor", "oneHanded", "inCombat", "abilityAtLeast", "light"].includes(k))
      && (!("light" in c) || (Array.isArray(c.light) && c.light.length && c.light.every(l => ["dark", "dim", "bright"].includes(l))))
      && (!("armor" in c) || (Array.isArray(c.armor) && c.armor.length && c.armor.every(a => ARMORS.includes(a))))
      && (!("oneHanded" in c) || (c.oneHanded === true)) && (!("inCombat" in c) || (c.inCombat === true))
      && (!("abilityAtLeast" in c) || (isObject(c.abilityAtLeast) && Object.values(c.abilityAtLeast).every(n => Number.isInteger(n) && (n > 0))));
    const okChanges = list => Array.isArray(list) && list.length && list.every(c => isObject(c) && (typeof c.key === "string") && c.key
      && (typeof c.type === "string") && c.type && ("value" in c));
    if ( !isObject(entry.effectWhile) || !Object.keys(entry.effectWhile).length || !Object.entries(entry.effectWhile).every(([id, r]) => isId(id)
      && isObject(r) && okIf(r.if) && (!("changes" in r) || okChanges(r.changes)) && Object.keys(r).every(k => ["if", "changes"].includes(k))) ) {
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

/** §258 : `endsWhen: { armor?, apart?, zeroHp?, unaffected?, spell? }` — les fins génériques d'un sort ou d'un effet (core/endings.mjs). */
function validateEndsWhen(w, at, errors) {
  if ( !isObject(w) || !Object.keys(w).length ) return errors.push(`${at}: { armor?, apart?, zeroHp?, unaffected?, spell? }`);
  for ( const key of Object.keys(w) ) if ( !["armor", "apart", "zeroHp", "unaffected", "spell"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
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
  if ( ("unaffected" in w) && !ENDS_UNAFFECTED.includes(w.unaffected) ) errors.push(`${at}.unaffected: ${ENDS_UNAFFECTED.join(", ")}`);
  if ( ("spell" in w) && (w.spell !== true) ) errors.push(`${at}.spell: true or absent`);
}
