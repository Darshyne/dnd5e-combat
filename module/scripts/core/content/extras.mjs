/**
 * Validation des autres clés d'une entrée (appelée par `validateEntry`). Fonctions pures, aucune dépendance à Foundry.
 */

import { CREATURE_TYPES } from "../eligibility.mjs";
import { ACTION_END_BY, ACTION_END_ROLLS, ACTION_END_STATUSES, ACTION_END_VERBS, EFFECT_ENDS, METAMAGIC_KINDS, ROLL_BONUS_ON, SIZES } from "./enums.mjs";
import { isId, isObject } from "./shared.mjs";
/**
 * Les clés validées hors de `validateEntry` : d'abord celles du Roublard (§20 : parts de plus de l'Attaque sournoise, Frappes
 * rusées), puis toutes celles ajoutées depuis (murs, globes, paliers de PV, rappel de sort…).
 */
export function validateExtras(entry, at, errors) {
  // §293 : « chaque créature de votre choix dans un rayon de… » — la liste des créatures à portée, cochées par le joueur, devient les cibles
  // de l'activité ; `upgrade` : une autre activité (d'un autre item du lanceur) qui peut la remplacer, proposée par une case.
  // §295 : le Déluge de coups ouvre plus de frappes (Credo accru) ; la durée d'un effet de l'item (la donnée se trompe) ; des
  // immunités d'état sans effet dans la donnée (Protégé de dame Nature).
  if ( ("flurryStrikes" in entry) && !(Number.isInteger(entry.flurryStrikes) && (entry.flurryStrikes > 0)) ) errors.push(`${at}flurryStrikes: positive integer`);
  if ( "effectDurations" in entry ) {
    const d = entry.effectDurations;
    // O9h : `{ formula, units }` — une durée tirée une fois par utilisation, la même pour toutes les cibles (Poussière de disparition : 2d4 minutes).
    const okDuration = v => isObject(v) && ((Number.isInteger(v.seconds) && (v.seconds > 0) && Object.keys(v).every(k => k === "seconds"))
      || ((typeof v.formula === "string") && v.formula.trim() && ["seconds", "minutes", "hours"].includes(v.units)
        && Object.keys(v).every(k => ["formula", "units"].includes(k))));
    if ( !isObject(d) || !Object.keys(d).length || !Object.entries(d).every(([id, v]) => isId(id) && okDuration(v)) ) {
      errors.push(`${at}effectDurations: { effect id: { seconds } | { formula, units: seconds|minutes|hours } }`);
    }
  }
  if ( ("grantsConditionImmunities" in entry) && !(Array.isArray(entry.grantsConditionImmunities) && entry.grantsConditionImmunities.length
    && entry.grantsConditionImmunities.every(s => (typeof s === "string") && /^[a-z]+$/.test(s))) ) {
    errors.push(`${at}grantsConditionImmunities: list of condition ids`);
  }
  // §299 : aptitudes tenues par la Rage.
  if ( "duringRage" in entry ) {
    const d = entry.duringRage;
    const ids = k => !(k in d) || (Array.isArray(d[k]) && d[k].length && d[k].every(isId));
    if ( !isObject(d) || !ids("enable") || !ids("post") || !ids("disable") || (("copiesEnd" in d) && (d.copiesEnd !== true))
      || (("cures" in d) && !(Array.isArray(d.cures) && d.cures.every(s => typeof s === "string"))) || (("onStart" in d) && !isId(d.onStart))
      || !Object.keys(d).every(k => ["enable", "post", "disable", "copiesEnd", "cures", "onStart"].includes(k)) ) {
      errors.push(`${at}duringRage: { enable?, post?, disable?, copiesEnd?: true, cures?, onStart? }`);
    }
  }
  // §298 : un sort lancé à la place d'attaques de l'action Attaquer (Magie de guerre).
  if ( "spellsInAttack" in entry ) {
    const s = entry.spellsInAttack;
    if ( !isObject(s) || !Number.isInteger(s.maxLevel) || (s.maxLevel < 0) || (("attacks" in s) && !(Number.isInteger(s.attacks) && (s.attacks > 0)))
      || (("class" in s) && (typeof s.class !== "string")) || !Object.keys(s).every(k => ["maxLevel", "class", "attacks"].includes(k)) ) {
      errors.push(`${at}spellsInAttack: { maxLevel, class?, attacks? }`);
    }
  }
  // §296 : plafond de créatures d'une zone ; réserve de soins ou de PV temporaires à répartir.
  if ( ("zoneMax" in entry) && !(Number.isInteger(entry.zoneMax) && (entry.zoneMax > 0)) ) errors.push(`${at}zoneMax: positive integer`);
  if ( "healPool" in entry ) {
    const h = entry.healPool;
    if ( !isObject(h) || !Array.isArray(h.activities) || !h.activities.length || !h.activities.every(isId)
      || (("cap" in h) && (h.cap !== "halfMax")) || (("temp" in h) && (h.temp !== true)) || (("formula" in h) && (typeof h.formula !== "string"))
      || !Object.keys(h).every(k => ["activities", "cap", "temp", "formula"].includes(k)) ) {
      errors.push(`${at}healPool: { activities, cap?: "halfMax", temp?: true, formula? }`);
    }
  }
  if ( "pickTargets" in entry ) {
    const p = entry.pickTargets;
    if ( !isObject(p) ) errors.push(`${at}pickTargets: { activities, radius, units, upgrade? }`);
    else {
      if ( !Array.isArray(p.activities) || !p.activities.length || !p.activities.every(isId) ) errors.push(`${at}pickTargets.activities: a list of activity ids`);
      // §300 : ou une formule de données de jet (Courroux des mers : « @scale.sea.wrath-range »).
      if ( !((Number.isFinite(p.radius) && (p.radius > 0)) || ((typeof p.radius === "string") && p.radius.trim())) ) errors.push(`${at}pickTargets.radius: positive number or formula`);
      if ( !["ft", "m"].includes(p.units) ) errors.push(`${at}pickTargets.units: ft, m`);
      if ( ("upgrade" in p) && !(isObject(p.upgrade) && (typeof p.upgrade.item === "string") && p.upgrade.item && isId(p.upgrade.activity)) ) {
        errors.push(`${at}pickTargets.upgrade: { item: identifier, activity: activity id }`);
      }
      // §296 : `max` (nombre de créatures), `self` (le lanceur aussi), `check` (qui est coché d'avance), `filter` (« bloodied »).
      if ( ("max" in p) && !(Number.isInteger(p.max) && (p.max > 0)) ) errors.push(`${at}pickTargets.max: positive integer`);
      if ( ("self" in p) && (p.self !== true) ) errors.push(`${at}pickTargets.self: true or absent`);
      if ( ("check" in p) && !["enemies", "allies"].includes(p.check) ) errors.push(`${at}pickTargets.check: enemies, allies`);
      if ( ("filter" in p) && (p.filter !== "bloodied") ) errors.push(`${at}pickTargets.filter: bloodied`);
      for ( const key of Object.keys(p) ) if ( !["activities", "radius", "units", "upgrade", "max", "self", "check", "filter"].includes(key) ) errors.push(`${at}pickTargets.${key}: unknown key`);
    }
  }
  // §188 : une activité qui remplace une attaque — tout l'item (`true`) ou certaines activités (l'Huile : le lancer, pas l'étalage).
  if ( ("replacesAttack" in entry) && (entry.replacesAttack !== true)
    && !(Array.isArray(entry.replacesAttack) && entry.replacesAttack.length && entry.replacesAttack.every(isId)) ) {
    errors.push(`${at}replacesAttack: true, or a list of activity ids`);
  }
  // §188 : une zone inflammable — elle s'embrase (feu, flamme) et brûle `rounds` rounds (`seconds` hors combat).
  if ( "flammable" in entry ) {
    const f = entry.flammable;
    const KEYS = ["ground", "damage", "type", "rounds", "seconds", "on", "frees"];
    if ( !isObject(f) ) errors.push(`${at}flammable: { damage, type, rounds, seconds, on, ground?, frees? }`);
    else {
      if ( ("ground" in f) && (f.ground !== true) ) errors.push(`${at}flammable.ground: true or absent`);
      if ( (typeof f.damage !== "string") || !/^(\d+|\d*d\d+)( ?\+ ?\d+)?$/.test(f.damage) ) errors.push(`${at}flammable.damage: a formula ("5", "2d4")`);
      if ( (typeof f.type !== "string") || !f.type ) errors.push(`${at}flammable.type: damage type`);
      if ( !(Number.isInteger(f.rounds) && (f.rounds > 0)) ) errors.push(`${at}flammable.rounds: positive integer`);
      if ( !(Number.isFinite(f.seconds) && (f.seconds > 0)) ) errors.push(`${at}flammable.seconds: positive number`);
      if ( !Array.isArray(f.on) || !f.on.length || !f.on.every(m => ["enter", "turnStart", "turnEnd"].includes(m)) ) errors.push(`${at}flammable.on: enter, turnStart, turnEnd`);
      if ( ("frees" in f) && ((typeof f.frees !== "string") || !f.frees) ) errors.push(`${at}flammable.frees: a condition id`);
      for ( const key of Object.keys(f) ) if ( !KEYS.includes(key) ) errors.push(`${at}flammable.${key}: unknown key`);
    }
  }
  if ( "sneakAttack" in entry ) {
    const s = entry.sneakAttack;
    if ( (s !== true) && !isObject(s) ) errors.push(`${at}sneakAttack: true, or { dice?, anyWeapon?, alwaysVs? }`);
    else if ( isObject(s) ) {
      if ( ("dice" in s) && !/^\d+d\d+$/.test(String(s.dice)) ) errors.push(`${at}sneakAttack.dice: dice ("5d6")`);
      if ( ("anyWeapon" in s) && (s.anyWeapon !== true) ) errors.push(`${at}sneakAttack.anyWeapon: true or absent`);
      if ( ("alwaysVs" in s) && (!Array.isArray(s.alwaysVs) || !s.alwaysVs.every(x => (typeof x === "string") && x)) ) errors.push(`${at}sneakAttack.alwaysVs: list of creature types`);
      for ( const key of Object.keys(s) ) if ( !["dice", "anyWeapon", "alwaysVs"].includes(key) ) errors.push(`${at}sneakAttack.${key}: unknown key`);
    }
  }
  if ( "sneakBonus" in entry ) {
    const b = entry.sneakBonus;
    if ( !isObject(b) || (typeof b.formula !== "string") || !b.formula.trim() ) errors.push(`${at}sneakBonus: { formula, firstRound? }`);
    else {
      if ( ("firstRound" in b) && (b.firstRound !== true) ) errors.push(`${at}sneakBonus.firstRound: true or absent`);
      for ( const key of Object.keys(b) ) if ( !["formula", "firstRound"].includes(key) ) errors.push(`${at}sneakBonus.${key}: unknown key`);
    }
  }
  if ( "cunningStrikes" in entry ) {
    const c = entry.cunningStrikes;
    if ( !isObject(c) || !Object.keys(c).length ) errors.push(`${at}cunningStrikes: { key: { cost, activity?, requires?, sizeAtMost?, withdraw? } }`);
    else for ( const [key, s] of Object.entries(c) ) {
      const here = `${at}cunningStrikes.${key}`;
      if ( !isObject(s) ) { errors.push(`${here}: an object`); continue; }
      if ( !(Number.isInteger(s.cost) && (s.cost > 0)) ) errors.push(`${here}.cost: positive integer (dice)`);
      if ( ("activity" in s) && !isId(s.activity) ) errors.push(`${here}.activity: activity id (16 characters)`);
      if ( ("requires" in s) && ((typeof s.requires !== "string") || !s.requires) ) errors.push(`${here}.requires: item identifier`);
      if ( ("sizeAtMost" in s) && !SIZES.includes(s.sizeAtMost) ) errors.push(`${here}.sizeAtMost: ${SIZES.join(", ")}`);
      if ( ("withdraw" in s) && (s.withdraw !== true) ) errors.push(`${here}.withdraw: true or absent`);
      if ( ("keepsHidden" in s) && (s.keepsHidden !== true) ) errors.push(`${here}.keepsHidden: true or absent`);
      if ( !("activity" in s) && !s.withdraw && !s.keepsHidden ) errors.push(`${here}: an activity, withdraw or keepsHidden`);
      for ( const k of Object.keys(s) ) if ( !["cost", "activity", "requires", "sizeAtMost", "withdraw", "keepsHidden"].includes(k) ) errors.push(`${here}.${k}: unknown key`);
    }
  }
  if ( "movesAfter" in entry ) {
    const m = entry.movesAfter;
    const ok = ((typeof m === "string") && m) || (isObject(m) && (typeof m.item === "string") && m.item
      && (!("disengage" in m) || (typeof m.disengage === "boolean")) && Object.keys(m).every(k => ["item", "disengage"].includes(k)));
    if ( !ok ) errors.push(`${at}movesAfter: item identifier, or { item, disengage? }`);
  }
  for ( const key of ["limitedAction", "noActions", "blink"] ) if ( (key in entry) && !isId(entry[key]) ) errors.push(`${at}${key}: effect id (16 characters)`);
  if ( "hpTiers" in entry ) {
    const ok = Array.isArray(entry.hpTiers) && entry.hpTiers.length && entry.hpTiers.every(t => isObject(t)
      && (!("atMost" in t) || Number.isFinite(t.atMost)) && (!("damage" in t) || (t.damage === false))
      && (!("effects" in t) || (Array.isArray(t.effects) && t.effects.every(isId)))
      && (!("statuses" in t) || (Array.isArray(t.statuses) && t.statuses.every(s => typeof s === "string" && s)))
      && (!("zero" in t) || (t.zero === true))
      && (!("activities" in t) || (Array.isArray(t.activities) && t.activities.length && t.activities.every(isId)))
      && Object.keys(t).every(k => ["atMost", "damage", "effects", "statuses", "zero", "activities"].includes(k)));
    if ( !ok ) errors.push(`${at}hpTiers: [{ atMost?: number, damage?: false, effects?: [effect ids], statuses?: [conditions], zero?: true, activities?: [activity ids] }]`);
  }
  if ( ("endsCurses" in entry) && !(Array.isArray(entry.endsCurses) && entry.endsCurses.length && entry.endsCurses.every(s => typeof s === "string" && s)) ) errors.push(`${at}endsCurses: item identifiers`);
  if ( ("tempHpPool" in entry) && !(Number.isFinite(entry.tempHpPool) && (entry.tempHpPool > 0)) ) errors.push(`${at}tempHpPool: positive number`);
  if ( ("revivesFull" in entry) && (entry.revivesFull !== true) ) errors.push(`${at}revivesFull: true or absent`);
  if ( ("pointWall" in entry) && (entry.pointWall !== false) ) errors.push(`${at}pointWall: false or absent`);
  if ( ("cellWall" in entry) && (entry.cellWall !== true) ) errors.push(`${at}cellWall: true or absent`);
  if ( "coverThrough" in entry ) {
    const c = entry.coverThrough;
    const degree = isObject(c) ? c.degree : c;
    if ( !["half", "threeQuarters", "total"].includes(degree)
      || (isObject(c) && !(Object.keys(c).every(k => ["degree", "against"].includes(k)) && (!("against" in c) || (c.against === "rangedWeapon")))) ) {
      errors.push(`${at}coverThrough: "half", "threeQuarters", "total", or { degree, against: "rangedWeapon" }`);
    }
  }
  if ( ("thinWall" in entry) && (entry.thinWall !== true) ) errors.push(`${at}thinWall: true or absent`);
  if ( "wallAura" in entry ) {
    const a = entry.wallAura;
    if ( !(isObject(a) && (typeof a.distance === "number") && (a.distance > 0) && (typeof a.units === "string") && isId(a.activity)
      && Array.isArray(a.on) && a.on.length && a.on.every(m => ["enter", "turnStart", "turnEnd"].includes(m))
      && Object.keys(a).every(k => ["distance", "units", "activity", "on"].includes(k))) ) {
      errors.push(`${at}wallAura: { distance, units, activity, on: [enter|turnStart|turnEnd] }`);
    }
  }
  if ( ("wallSide" in entry) && !(isObject(entry.wallSide) && (typeof entry.wallSide.distance === "number") && (entry.wallSide.distance > 0)
    && (typeof entry.wallSide.units === "string") && Object.keys(entry.wallSide).every(k => ["distance", "units"].includes(k))) ) errors.push(`${at}wallSide: { distance: number > 0, units }`);
  if ( ("walls" in entry) && !(isObject(entry.walls) && (!("move" in entry.walls) || (entry.walls.move === false)) && (!("sight" in entry.walls) || (entry.walls.sight === true))
    && (!("activities" in entry.walls) || (Array.isArray(entry.walls.activities) && entry.walls.activities.every(isId)))
    && (!("ethereal" in entry.walls) || (entry.walls.ethereal === true))
    && Object.keys(entry.walls).every(k => ["move", "sight", "activities", "ethereal"].includes(k))) ) errors.push(`${at}walls: { move?: false, sight?: true, activities?: [activity ids], ethereal?: true }`);
  if ( ("globe" in entry) && !(isObject(entry.globe) && Number.isFinite(entry.globe.radius) && (entry.globe.radius > 0) && (typeof entry.globe.units === "string")
    && Number.isInteger(entry.globe.maxLevel) && (!("everywhere" in entry.globe) || (entry.globe.everywhere === true))
    && Object.keys(entry.globe).every(k => ["radius", "units", "maxLevel", "everywhere"].includes(k))) ) errors.push(`${at}globe: { radius > 0, units, maxLevel, everywhere? }`);
  if ( ("recastCost" in entry) && !["bonus", "action"].includes(entry.recastCost) ) errors.push(`${at}recastCost: bonus | action`);
  if ( ("levitate" in entry) && !(isObject(entry.levitate) && isId(entry.levitate.effect) && Number.isFinite(entry.levitate.height) && (typeof entry.levitate.units === "string")) ) errors.push(`${at}levitate: { effect, height, units }`);
  if ( ("prismatic" in entry) && !(isObject(entry.prismatic) && isId(entry.prismatic.indigo) && isId(entry.prismatic.violet)
    && (!("all" in entry.prismatic) || (entry.prismatic.all === true))
    && (!("activities" in entry.prismatic) || (Array.isArray(entry.prismatic.activities) && entry.prismatic.activities.every(isId)))
    && Object.keys(entry.prismatic).every(k => ["indigo", "violet", "all", "activities"].includes(k))) ) errors.push(`${at}prismatic: { indigo, violet, all?, activities? } (effect / activity ids)`);
  if ( ("barrier" in entry) && !(isObject(entry.barrier) && Number.isFinite(entry.barrier.radius) && (entry.barrier.radius > 0) && (typeof entry.barrier.units === "string")
    && ["exceptTypes", "onlyTypes"].every(k => !(k in entry.barrier) || (Array.isArray(entry.barrier[k]) && entry.barrier[k].every(t => CREATURE_TYPES.includes(t))))
    && (!("shields" in entry.barrier) || (entry.barrier.shields === true)) && (!("endsOnContact" in entry.barrier) || (entry.barrier.endsOnContact === true))
    && Object.keys(entry.barrier).every(k => ["radius", "units", "exceptTypes", "onlyTypes", "shields", "endsOnContact"].includes(k))) ) {
    errors.push(`${at}barrier: { radius > 0, units, exceptTypes?, onlyTypes?, shields?, endsOnContact? }`);
  }
  // O9h : un enduit d'arme (Poison standard) — l'activité qui enduit, celle qui porte les dés, les types de dégâts qui le délivrent.
  if ( "coats" in entry ) {
    const c = entry.coats;
    const ok = isObject(c) && isId(c.activity) && isId(c.damage) && Array.isArray(c.damageTypes) && c.damageTypes.length
      && c.damageTypes.every(t => (typeof t === "string") && /^[a-z]+$/.test(t)) && Number.isInteger(c.seconds) && (c.seconds > 0)
      && (!("ammunition" in c) || (Number.isInteger(c.ammunition) && (c.ammunition > 0)))
      && Object.keys(c).every(k => ["activity", "damage", "damageTypes", "seconds", "ammunition"].includes(k));
    if ( !ok ) errors.push(`${at}coats: { activity, damage (activity ids), damageTypes, seconds, ammunition? }`);
  }
  // O9h : la durée des sorts que l'objet fait lancer (Huile d'insaisissabilité : 8 heures).
  if ( ("castDuration" in entry) && !(isObject(entry.castDuration) && Number.isInteger(entry.castDuration.seconds) && (entry.castDuration.seconds > 0)
    && (Object.keys(entry.castDuration).length === 1)) ) errors.push(`${at}castDuration: { seconds }`);
  // O9h : après certaines activités, une chance que l'objet se retourne contre son porteur (Cor de dévastation : 20 %).
  if ( "backfire" in entry ) {
    const b = entry.backfire;
    const ok = isObject(b) && Array.isArray(b.after) && b.after.length && b.after.every(isId) && Number.isInteger(b.chance) && (b.chance > 0) && (b.chance <= 100)
      && isId(b.activity) && (!("destroys" in b) || (b.destroys === true))
      && Object.keys(b).every(k => ["after", "chance", "activity", "destroys"].includes(k));
    if ( !ok ) errors.push(`${at}backfire: { after (activity ids), chance 1–100, activity, destroys? }`);
  }
  if ( ("saveDisadvantageFor" in entry) && !(Array.isArray(entry.saveDisadvantageFor) && entry.saveDisadvantageFor.length
    && entry.saveDisadvantageFor.every(t => CREATURE_TYPES.includes(t))) ) errors.push(`${at}saveDisadvantageFor: creature types (${CREATURE_TYPES.join(", ")})`);
  if ( "effectEnds" in entry ) {
    const e = entry.effectEnds;
    if ( !isObject(e) || !Object.keys(e).length ) errors.push(`${at}effectEnds: { effect id: ${EFFECT_ENDS.join(" | ")} }`);
    else for ( const [id, when] of Object.entries(e) ) {
      if ( !isId(id) && !/^status:[a-z]+$/.test(id) ) errors.push(`${at}effectEnds.${id}: effect id (16 characters) or status:<condition>`);
      if ( !EFFECT_ENDS.includes(when) ) errors.push(`${at}effectEnds.${id}: ${EFFECT_ENDS.join(", ")}`);
    }
  }
  if ( "actionEnds" in entry ) {
    const e = entry.actionEnds;
    if ( !isObject(e) || !Object.keys(e).length ) errors.push(`${at}actionEnds: { effect id: { by, roll?, verb? } }`);
    else for ( const [id, rule] of Object.entries(e) ) {
      const ok = (isId(id) || /^status:[a-z]+$/.test(id)) && isObject(rule) && ACTION_END_BY.includes(rule.by)
        && (!("roll" in rule) || ACTION_END_ROLLS.includes(rule.roll)) && !((rule.by === "other") && (rule.roll === "save"))
        && (!("verb" in rule) || ACTION_END_VERBS.includes(rule.verb))
        && (!("status" in rule) || ((rule.by === "bearer") && ACTION_END_STATUSES.includes(rule.status)))
        && (!("spell" in rule) || (rule.spell === true)) && (!("turnStart" in rule) || ((rule.turnStart === true) && (rule.by === "bearer")))
        && Object.keys(rule).every(k => ["by", "roll", "verb", "status", "spell", "turnStart"].includes(k));
      if ( !ok ) errors.push(`${at}actionEnds.${id}: { by: ${ACTION_END_BY.join(" | ")}, roll?: ${ACTION_END_ROLLS.join(" | ")} (not "save" for "other"), verb?: ${ACTION_END_VERBS.join(" | ")}, status?: ${ACTION_END_STATUSES.join(" | ")} (bearer) }`);
    }
  }
  if ( "effectThen" in entry ) {
    const e = entry.effectThen;
    if ( !isObject(e) || !Object.keys(e).length ) errors.push(`${at}effectThen: { effect id: effect id }`);
    else for ( const [id, next] of Object.entries(e) ) {
      if ( !isId(id) || !isId(next) || (id === next) ) errors.push(`${at}effectThen.${id}: two distinct effect ids (16 characters)`);
    }
  }
  // §164 : `ranged` (après un coup à distance), `burst` (la sauvegarde aussi autour de la cible), `damage` facultatif avec `save`.
  if ( ("smite" in entry) && !(isObject(entry.smite) && (isId(entry.smite.damage) || (!("damage" in entry.smite) && isId(entry.smite.save)))
    && ["fiends", "save", "effect"].every(k => !(k in entry.smite) || isId(entry.smite[k]))
    && (!("ranged" in entry.smite) || (entry.smite.ranged === true))
    && (!("saveAtMostHp" in entry.smite) || (Number.isInteger(entry.smite.saveAtMostHp) && (entry.smite.saveAtMostHp > 0)))
    && (!("burst" in entry.smite) || (isObject(entry.smite.burst) && Number.isFinite(entry.smite.burst.radius) && (typeof entry.smite.burst.units === "string")))
    && (!("replaces" in entry.smite) || (entry.smite.replaces === true))
    && (!("onMiss" in entry.smite) || (entry.smite.onMiss === "half"))
    && (!("blast" in entry.smite) || (isObject(entry.smite.blast) && isId(entry.smite.blast.activity) && Number.isFinite(entry.smite.blast.radius)
      && (entry.smite.blast.radius > 0) && (typeof entry.smite.blast.units === "string") && (typeof entry.smite.blast.ability === "string")
      && Object.keys(entry.smite.blast).every(k => ["activity", "radius", "units", "ability"].includes(k))))
    && Object.keys(entry.smite).every(k => ["damage", "fiends", "save", "effect", "ranged", "any", "burst", "saveAtMostHp", "replaces", "onMiss", "blast"].includes(k))) ) errors.push(`${at}smite: { damage, fiends?, save?, effect?, ranged?, any?, burst?, replaces?, onMiss?: "half", blast?: { activity, radius, units, ability } } (activity ids, effect id)`);
  if ( ("metamagic" in entry) && !(isObject(entry.metamagic) && isId(entry.metamagic.activity) && METAMAGIC_KINDS.includes(entry.metamagic.kind)
    && Object.keys(entry.metamagic).every(k => ["activity", "kind"].includes(k))) ) errors.push(`${at}metamagic: { activity, kind: ${METAMAGIC_KINDS.join(" | ")} }`);
  // Relevé des trous : `reroll` — sans activité, le d20 relancé avec ce bonus, le nouveau jet imposé, une fois par effet de `during`.
  // §280 : ou, avec une activité qui le paie, le d20 relancé (bonus facultatif), le nouveau jet imposé (Inébranlable) ; `failRefund` : le
  // test encore raté rend ce que l'activité a coûté, et l'item perd une utilisation (Fanfaronnade).
  const reroll = entry.rollBonus?.reroll;
  const paid = isId(entry.rollBonus?.activity);
  const rerollOk = (reroll === undefined) || (isObject(reroll) && Object.keys(reroll).every(k => ["bonus", "during"].includes(k))
    && (!("bonus" in reroll) || ((typeof reroll.bonus === "string") && !!reroll.bonus.trim()))
    && (paid ? !("during" in reroll) : ((typeof reroll.bonus === "string") && (typeof reroll.during === "string") && !!reroll.during)));
  const refundOk = !("failRefund" in (entry.rollBonus ?? {})) || ((entry.rollBonus.failRefund === true) && paid && !reroll && !entry.rollBonus.luck);
  if ( ("rollBonus" in entry) && !(isObject(entry.rollBonus) && (paid || (!!reroll && !("activity" in entry.rollBonus)))
    && rerollOk && refundOk && Array.isArray(entry.rollBonus.on)
    && entry.rollBonus.on.length && entry.rollBonus.on.every(k => ROLL_BONUS_ON.includes(k))
    && ["skills", "statuses"].every(key => !(key in entry.rollBonus) || (Array.isArray(entry.rollBonus[key]) && entry.rollBonus[key].length && entry.rollBonus[key].every(k => (typeof k === "string") && k)))
    && (!("luck" in entry.rollBonus) || (entry.rollBonus.luck === true))
    && (!("succeed" in entry.rollBonus) || (entry.rollBonus.succeed === true))
    && (!("abilities" in entry.rollBonus) || (Array.isArray(entry.rollBonus.abilities) && entry.rollBonus.abilities.length && entry.rollBonus.abilities.every(a => (typeof a === "string") && a)))
    && Object.keys(entry.rollBonus).every(k => ["activity", "on", "skills", "statuses", "luck", "succeed", "abilities", "reroll", "failRefund"].includes(k))) ) errors.push(`${at}rollBonus: { activity (or reroll: { bonus, during }), on: [${ROLL_BONUS_ON.join(" | ")}], skills?, statuses?, luck?: true, succeed?: true, abilities?, reroll?: { bonus? }, failRefund?: true }`);
  if ( ("transpose" in entry) && !(isObject(entry.transpose) && (typeof entry.transpose.summon === "string") && entry.transpose.summon
    && Object.keys(entry.transpose).every(k => k === "summon")) ) errors.push(`${at}transpose: { summon } (identifier of the summoning item)`);
  if ( ("portent" in entry) && !(isObject(entry.portent) && Number.isInteger(entry.portent.dice) && (entry.portent.dice > 0)
    && Object.keys(entry.portent).every(k => k === "dice")) ) errors.push(`${at}portent: { dice } (positive integer)`);
  if ( ("hitRider" in entry) && !(isObject(entry.hitRider) && Object.keys(entry.hitRider).length
    && Object.keys(entry.hitRider).every(k => ["damage", "effect", "status", "sizeAtMost", "slot", "weapon", "oncePerTurn", "save", "item", "pays", "weaponDamage", "whileActive", "push", "unarmed", "melee", "shield", "damageType", "sizeAbove"].includes(k))
    && ["melee", "shield"].every(k => !(k in entry.hitRider) || (entry.hitRider[k] === true))
    && (!("damageType" in entry.hitRider) || ((typeof entry.hitRider.damageType === "string") && !!entry.hitRider.damageType))
    && (!("sizeAbove" in entry.hitRider) || (Number.isInteger(entry.hitRider.sizeAbove) && (entry.hitRider.sizeAbove >= 0)))
    && (!("unarmed" in entry.hitRider) || (entry.hitRider.unarmed === true))
    && (!("push" in entry.hitRider) || (isObject(entry.hitRider.push) && Number.isFinite(entry.hitRider.push.distance) && (entry.hitRider.push.distance > 0)
      && (typeof entry.hitRider.push.units === "string") && !!entry.hitRider.push.units && Object.keys(entry.hitRider.push).every(k => ["distance", "units"].includes(k))))
    && (!("whileActive" in entry.hitRider) || (entry.hitRider.whileActive === true))
    && (!("pays" in entry.hitRider) || ((typeof entry.hitRider.pays === "string") && !!entry.hitRider.pays && !("slot" in entry.hitRider)))
    && (!("weaponDamage" in entry.hitRider) || (entry.hitRider.weaponDamage === true))
    && (!("slot" in entry.hitRider) || (entry.hitRider.slot === "pact"))
    && (!("weapon" in entry.hitRider) || (typeof entry.hitRider.weapon === "string"))
    && (!("oncePerTurn" in entry.hitRider) || (entry.hitRider.oncePerTurn === true))
    && ["damage", "effect", "save"].every(k => !(k in entry.hitRider) || isId(entry.hitRider[k]))
    && (!("item" in entry.hitRider) || (typeof entry.hitRider.item === "string"))
    && (!("status" in entry.hitRider) || (typeof entry.hitRider.status === "string"))
    && (!("sizeAtMost" in entry.hitRider) || SIZES.includes(entry.hitRider.sizeAtMost))) ) {
    errors.push(`${at}hitRider: { damage?, effect?, status?, sizeAtMost?, slot?: "pact", weapon?, oncePerTurn?: true, save?, item?, pays?, weaponDamage?: true, push?: { distance, units }, unarmed?: true, melee?: true, shield?: true, damageType?, sizeAbove? }`);
  }
  if ( ("flurry" in entry) && !(isObject(entry.flurry) && isId(entry.flurry.activity) && Number.isInteger(entry.flurry.strikes) && (entry.flurry.strikes > 0)
    && (!("weapons" in entry.flurry) || (typeof entry.flurry.weapons === "boolean"))
    && Object.keys(entry.flurry).every(k => ["activity", "strikes", "weapons"].includes(k))) ) {
    errors.push(`${at}flurry: { activity, strikes, weapons? }`);
  }
  if ( ("stunningStrike" in entry) && !(isObject(entry.stunningStrike) && isId(entry.stunningStrike.activity) && (typeof entry.stunningStrike.focus === "string")) ) {
    errors.push(`${at}stunningStrike: { activity, focus }`);
  }
  if ( ("openHand" in entry) && !(isObject(entry.openHand) && Object.keys(entry.openHand).length && Object.values(entry.openHand).every(isId)) ) {
    errors.push(`${at}openHand: { key: activity id }`);
  }
  if ( ("byWounds" in entry) && !(isObject(entry.byWounds) && isId(entry.byWounds.healthy) && isId(entry.byWounds.wounded)
    && (Object.keys(entry.byWounds).length === 2)) ) errors.push(`${at}byWounds: { healthy, wounded } (activity ids)`);
  if ( ("rage" in entry) && !(isObject(entry.rage) && isId(entry.rage.effect) && (Object.keys(entry.rage).length === 1)) ) errors.push(`${at}rage: { effect } (effect id)`);
  if ( ("relentless" in entry) && !(isObject(entry.relentless) && isId(entry.relentless.activity) && (Object.keys(entry.relentless).length === 1)) ) {
    errors.push(`${at}relentless: { activity } (activity id)`);
  }
  if ( ("thrownDamage" in entry) && !(Number.isInteger(entry.thrownDamage) && (entry.thrownDamage > 0)) ) errors.push(`${at}thrownDamage: positive integer`);
  if ( ("cunningStrikeMax" in entry) && !(Number.isInteger(entry.cunningStrikeMax) && (entry.cunningStrikeMax >= 1)) ) {
    errors.push(`${at}cunningStrikeMax: integer ≥ 1`);
  }
}
