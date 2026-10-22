/**
 * Validateurs des objets d'une entrée qui ont leur forme propre : invocation, absorption, téléportation, cibles, choix,
 * lumière, source portée, émanation. Fonctions pures, aucune dépendance à Foundry.
 */

import { CREATURE_TYPES } from "../eligibility.mjs";
import { EMANATION_MOMENTS } from "../emanation.mjs";
import { LIGHT_ON } from "../light.mjs";
import { unknownFacts } from "../triggers.mjs";
import { CHOICE_EFFECTS, PILOT_COSTS, PILOT_ON_CAST, PULSE_MOMENTS } from "./enums.mjs";
import { isId, isObject } from "./shared.mjs";
export function validateSummon(summon, at, errors) {
  if ( !isObject(summon) || !["after", "own", "none"].includes(summon.initiative) ) return errors.push(`${at}.initiative: "after", "own" or "none"`);
  if ( ("endsSpell" in summon) && (summon.endsSpell !== true) ) errors.push(`${at}.endsSpell: true or absent`);
  for ( const flag of ["endsAtZero", "mimic", "endsIfIncapacitated", "castFrom", "familiar", "replaces"] ) {
    if ( (flag in summon) && (summon[flag] !== true) ) errors.push(`${at}.${flag}: true or absent`);
  }
  if ( "lasts" in summon ) {
    const l = summon.lasts;
    if ( !isObject(l) || !["string", "number"].includes(typeof l.value) || (String(l.value).trim() === "")
      || (typeof l.units !== "string") || !l.units ) errors.push(`${at}.lasts: { value, units }`);
  }
  if ( "pulse" in summon ) {
    const u = summon.pulse;
    if ( !isObject(u) ) errors.push(`${at}.pulse: an object`);
    else {
      const named = s => (typeof s === "string") && !!s;
      if ( !(named(u.item) || (Array.isArray(u.item) && u.item.length && u.item.every(named))) ) errors.push(`${at}.pulse.item: item identifier required`);
      if ( !(Number.isFinite(u.radius) && (u.radius > 0)) ) errors.push(`${at}.pulse.radius: positive number`);
      if ( (typeof u.units !== "string") || !u.units ) errors.push(`${at}.pulse.units: unit required`);
      if ( ("on" in u) && (!Array.isArray(u.on) || !u.on.length || !u.on.every(m => PULSE_MOMENTS.includes(m))) ) errors.push(`${at}.pulse.on: ${PULSE_MOMENTS.join(", ")}`);
      if ( ("affects" in u) && !["any", "enemy"].includes(u.affects) ) errors.push(`${at}.pulse.affects: any, enemy`);
      for ( const key of Object.keys(u) ) if ( !["item", "radius", "units", "on", "affects"].includes(key) ) errors.push(`${at}.pulse.${key}: unknown key`);
    }
  }
  if ( "pilot" in summon ) {
    const p = summon.pilot;
    if ( !isObject(p) ) errors.push(`${at}.pilot: an object`);
    else {
      if ( !PILOT_COSTS.includes(p.cost) ) errors.push(`${at}.pilot.cost: ${PILOT_COSTS.join(", ")}`);
      if ( !(Number.isFinite(p.distance) && (p.distance >= 0)) ) errors.push(`${at}.pilot.distance: non-negative number`);
      if ( (typeof p.units !== "string") || !p.units ) errors.push(`${at}.pilot.units: unit required`);
      if ( ("onCast" in p) && !PILOT_ON_CAST.includes(p.onCast) ) errors.push(`${at}.pilot.onCast: ${PILOT_ON_CAST.join(", ")}`);
      if ( ("occupies" in p) && (p.occupies !== false) ) errors.push(`${at}.pilot.occupies: false or absent`);
      for ( const flag of ["shared", "leash"] ) if ( (flag in p) && (p[flag] !== true) ) errors.push(`${at}.pilot.${flag}: true or absent`);
      for ( const key of ["cluster", "tether"] ) {
        if ( !(key in p) ) continue;
        const c = p[key];
        if ( !isObject(c) || !(Number.isFinite(c.distance) && (c.distance > 0)) || (typeof c.units !== "string") || !c.units ) errors.push(`${at}.pilot.${key}: { distance, units }`);
      }
      for ( const key of Object.keys(p) ) if ( !["cost", "distance", "units", "onCast", "occupies", "shared", "cluster", "leash", "tether"].includes(key) ) errors.push(`${at}.pilot.${key}: unknown key`);
    }
  }
  if ( "minLevels" in summon ) {
    const m = summon.minLevels;
    if ( !isObject(m) || !Object.entries(m).every(([id, level]) => isId(id) && Number.isInteger(level) && (level > 0)) ) {
      errors.push(`${at}.minLevels: { activity id: level }`);
    }
  }
  for ( const key of Object.keys(summon) ) if ( !["initiative", "pilot", "endsSpell", "endsAtZero", "pulse", "mimic", "endsIfIncapacitated", "castFrom", "lasts", "familiar", "replaces", "minLevels"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
}

export function validateAbsorb(absorb, at, errors) {
  if ( !isObject(absorb) ) return errors.push(`${at}: an object`);
  if ( ("activeAfter" in absorb) && !isId(absorb.activeAfter) ) errors.push(`${at}.activeAfter: activity id (16 characters) expected`);
  if ( "recharge" in absorb ) {
    const r = absorb.recharge;
    if ( !isObject(r) || (typeof r.school !== "string") || !r.school ) errors.push(`${at}.recharge.school: school required`);
    else if ( !(Number.isFinite(r.perLevel) && (r.perLevel > 0)) ) errors.push(`${at}.recharge.perLevel: positive number`);
  }
  for ( const key of Object.keys(absorb) ) if ( !["activeAfter", "recharge"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
}

export function validateTeleport(teleport, at, errors) {
  if ( !isObject(teleport) ) return errors.push(`${at}: an object`);
  if ( !(Number.isFinite(teleport.distance) && (teleport.distance > 0)) ) errors.push(`${at}.distance: positive number`);
  if ( (typeof teleport.units !== "string") || !teleport.units ) errors.push(`${at}.units: unit required`);
  if ( ("activity" in teleport) && !isId(teleport.activity) ) errors.push(`${at}.activity: activity id (16 characters) expected`);
  if ( ("then" in teleport) && !isId(teleport.then) ) errors.push(`${at}.then: activity id (16 characters) expected`);
  for ( const key of Object.keys(teleport) ) if ( !["distance", "units", "activity", "then"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
}

export function validateTargets(targets, at, facts, errors) {
  if ( !isObject(targets) ) return errors.push(`${at}: an object`);
  if ( "types" in targets ) {
    if ( !Array.isArray(targets.types) || !targets.types.length ) errors.push(`${at}.types: non-empty list of creature types`);
    else for ( const t of targets.types ) if ( !CREATURE_TYPES.includes(t) ) errors.push(`${at}.types: unknown "${t}" (${CREATURE_TYPES.join(", ")})`);
  }
  if ( "unaffectedIf" in targets ) for ( const key of unknownFacts(targets.unaffectedIf, facts) ) errors.push(`${at}.unaffectedIf: unknown fact "${key}"`);
  for ( const key of Object.keys(targets) ) if ( !["types", "unaffectedIf"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
}

export function validateChoice(choice, at, errors) {
  if ( !isObject(choice) ) return errors.push(`${at}: an object`);
  // §53 : `pool` seul relie des effets de l'item à une activité, sans rien à choisir (Héroïsme : la Bénédiction).
  if ( (!("pool" in choice) || ("effects" in choice)) && !CHOICE_EFFECTS.includes(choice.effects) ) errors.push(`${at}.effects: ${CHOICE_EFFECTS.join(", ")}`);
  if ( ("prompt" in choice) && (typeof choice.prompt !== "string") ) errors.push(`${at}.prompt: string`);
  if ( ("pool" in choice) && !(isObject(choice.pool) && Object.entries(choice.pool).every(([a, ids]) => isId(a) && Array.isArray(ids) && ids.length && ids.every(isId))) ) {
    errors.push(`${at}.pool: { <activity id>: [effect ids] } (16 characters)`);
  }
  for ( const key of Object.keys(choice) ) if ( !["effects", "prompt", "pool"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
}

export function validateLight(l, at, errors) {
  if ( !isObject(l) ) return errors.push(`${at}: an object`);
  if ( !LIGHT_ON.includes(l.on) ) errors.push(`${at}.on: ${LIGHT_ON.join(", ")}`);
  for ( const key of ["bright", "dim"] ) {
    if ( (key in l) && !(Number.isFinite(l[key]) && (l[key] >= 0)) ) errors.push(`${at}.${key}: non-negative number`);
  }
  if ( (("bright" in l) || ("dim" in l)) && ((typeof l.units !== "string") || !l.units) ) errors.push(`${at}.units: unit required`);
  if ( (l.on === "effect") && !(l.dim > 0) && !(l.bright > 0) ) errors.push(`${at}: a light effect needs a radius`);
  if ( (l.on === "area") && !l.darkness && !(l.dim > 0) && !(l.bright > 0) ) errors.push(`${at}: a light area needs a radius`);
  if ( (l.on === "wall") && !(l.dim > 0) && !(l.bright > 0) ) errors.push(`${at}: a wall light needs a radius`);
  if ( ("color" in l) && !((typeof l.color === "string") && /^#[0-9a-fA-F]{6}$/.test(l.color)) ) errors.push(`${at}.color: "#rrggbb"`);
  if ( ("animation" in l) && (!isObject(l.animation) || (typeof l.animation.type !== "string")) ) errors.push(`${at}.animation: { type, speed?, intensity? }`);
  for ( const flag of ["darkness", "carried", "single"] ) if ( (flag in l) && (l[flag] !== true) ) errors.push(`${at}.${flag}: true or absent`);
  if ( l.darkness && (l.on !== "area") ) errors.push(`${at}.darkness: only on an area`);
  if ( ("dispels" in l) && !(Number.isInteger(l.dispels) && (l.dispels >= 0)) ) errors.push(`${at}.dispels: spell level (integer)`);
  if ( (l.carried || l.single) && (l.on !== "summon") ) errors.push(`${at}: carried and single only apply to a summon`);
  for ( const key of Object.keys(l) ) {
    if ( !["on", "bright", "dim", "units", "darkness", "dispels", "carried", "single", "color", "animation"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
  }
}

/** §52 : une source de lumière portée. */
export function validateCarriedLight(l, at, errors) {
  if ( !isObject(l) ) return errors.push(`${at}: an object`);
  for ( const key of ["bright", "dim"] ) if ( !(Number.isFinite(l[key]) && (l[key] >= 0)) ) errors.push(`${at}.${key}: non-negative number`);
  if ( (typeof l.units !== "string") || !l.units ) errors.push(`${at}.units: unit required`);
  if ( ("angle" in l) && !(Number.isFinite(l.angle) && (l.angle > 0) && (l.angle < 360)) ) errors.push(`${at}.angle: degrees, between 0 and 360`);
  if ( ("animation" in l) && (!isObject(l.animation) || (typeof l.animation.type !== "string")) ) errors.push(`${at}.animation: { type, speed?, intensity? }`);
  // §121 : durée d'une unité (torche, bougie) ou d'une flasque (lampe, lanterne), et le combustible (identifiant de l'item).
  if ( ("burn" in l) && !(isObject(l.burn) && Number.isFinite(l.burn.value) && (l.burn.value > 0) && ["second", "minute", "hour"].includes(l.burn.units)
    && Object.keys(l.burn).every(k => ["value", "units"].includes(k))) ) errors.push(`${at}.burn: { value > 0, units: second | minute | hour }`);
  if ( ("fuel" in l) && !((typeof l.fuel === "string") && l.fuel) ) errors.push(`${at}.fuel: identifier of the fuel item`);
  if ( ("fuel" in l) && !("burn" in l) ) errors.push(`${at}.fuel: needs burn`);
  for ( const key of Object.keys(l) ) if ( !["bright", "dim", "units", "angle", "animation", "burn", "fuel"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
}

export function validateEmanation(e, at, errors) {
  if ( !isObject(e) ) return errors.push(`${at}: an object`);
  if ( !EMANATION_MOMENTS.includes(e.on) ) errors.push(`${at}.on: ${EMANATION_MOMENTS.join(", ")}`);
  if ( ("affects" in e) && !["any", "enemy"].includes(e.affects) ) errors.push(`${at}.affects: any, enemy`);
  if ( ("sees" in e) && (e.sees !== true) ) errors.push(`${at}.sees: true or absent`);
  if ( ("radius" in e) && !(Number.isFinite(e.radius) && (e.radius > 0)) ) errors.push(`${at}.radius: positive number`);
  if ( (("radius" in e) || ("radiusFormula" in e)) && ((typeof e.units !== "string") || !e.units) ) errors.push(`${at}.units: unit required with a radius`);
  if ( ("radiusFormula" in e) && ((typeof e.radiusFormula !== "string") || !e.radiusFormula) ) errors.push(`${at}.radiusFormula: a formula`);
  if ( ("whileActive" in e) && (e.whileActive !== true) ) errors.push(`${at}.whileActive: true or absent`);
  if ( ("activity" in e) && !isId(e.activity) ) errors.push(`${at}.activity: activity id (16 characters)`);
  for ( const key of Object.keys(e) ) if ( !["on", "affects", "sees", "radius", "radiusFormula", "units", "activity", "whileActive"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
}
