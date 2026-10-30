/**
 * Validation d'une étape (`do`), d'une déclaration (`triggers`) et d'une aura. Fonctions pures, aucune dépendance à Foundry.
 */

import { CREATURE_TYPES } from "../eligibility.mjs";
import { MOMENTS, OUTCOME_MOMENTS, RESAVE_MOMENTS, BEARER_MOMENTS, TURN_MOMENTS, unknownFacts, normalize, PRE_ATTACK_WINDOWS, DAMAGED_BY } from "../triggers.mjs";
import { ATTACK_STEPS, AURA_AFFECTS, DAMAGE_ON_SAVE, DAMAGE_TO, HIT_WINDOWS, MOVE_MODES, OUTCOME_STEPS, RESAVE_ON_FAIL, STEP_TYPES, VIA } from "./enums.mjs";
import { isId, isObject } from "./shared.mjs";
function validateStep(step, at, errors) {
  if ( !isObject(step) ) return errors.push(`${at}: a step is an object`);
  if ( !STEP_TYPES.includes(step.type) ) return errors.push(`${at}.type: unknown "${step.type}" (${STEP_TYPES.join(", ")})`);
  if ( step.type === "damage" ) {
    if ( ("to" in step) && !DAMAGE_TO.includes(step.to) ) errors.push(`${at}.to: ${DAMAGE_TO.join(", ")}`);
    if ( ("onSave" in step) && !DAMAGE_ON_SAVE.includes(step.onSave) ) errors.push(`${at}.onSave: ${DAMAGE_ON_SAVE.join(", ")}`);
    // Une riposte (ou les dégâts du porteur) peut rejouer l'activité de dégâts de l'item ; un partage (to: "origin") sans
    // formule reprend le montant subi.
    const fromActivity = ["source", "bearer"].includes(step.to) && ("activity" in step);
    const same = (step.to === "origin") && !("formula" in step);
    if ( !fromActivity && !same ) {
      if ( (typeof step.formula !== "string") || !step.formula.trim() ) errors.push(`${at}.formula: formula required`);
      // §161 : une liste de types au choix pour des dégâts bonus (`preDamageRoll`).
      const typeOk = t => (typeof t === "string") && !!t;
      if ( !(typeOk(step.damageType) || (Array.isArray(step.damageType) && step.damageType.length && step.damageType.every(typeOk))) ) errors.push(`${at}.damageType: damage type required`);
    }
  }
  // §74 : `spends` — des dégâts bonus qui dépensent un effet de l'item porté par l'auteur (Frappe du zéphyr : « une fois »).
  if ( (step.type === "damage") && ("spends" in step) && !isId(step.spends) ) errors.push(`${at}.spends: item effect id (16 characters) expected`);
  // §133 : "target" — la créature visée par l'attaque qui ouvre la fenêtre (Protection : l'effet « Protégé » sur l'allié).
  if ( (step.type === "use") && ("target" in step) && !["source", "self", "target"].includes(step.target) ) errors.push(`${at}.target: "source", "self" or "target"`);
  if ( (step.type === "use") && ("advantage" in step) && (step.advantage !== true) ) errors.push(`${at}.advantage: true or absent`);
  if ( (step.type === "use") && ("consume" in step) && (step.consume !== false) ) errors.push(`${at}.consume: false or absent`);
  if ( (step.type === "use") && ("approach" in step) && ((step.approach !== true) || (step.target !== "source")) ) errors.push(`${at}.approach: true, with target: "source"`);
  // §88 : attaque avec une arme de corps à corps de l'acteur (Riposte).
  if ( (step.type === "use") && ("weapon" in step) && ((step.weapon !== true) || (step.target !== "source")) ) errors.push(`${at}.weapon: true, with target: "source"`);
  if ( "margin" in step ) {
    const mg = step.margin;
    const ok = (typeof mg === "object") && mg && Object.keys(mg).length && Object.entries(mg).every(([k, v]) => ["min", "max"].includes(k) && Number.isFinite(v) && (v >= 0));
    if ( !ok ) errors.push(`${at}.margin: { min?, max? } (numbers ≥ 0)`);
  }
  if ( ["use", "replay", "ward", "damage"].includes(step.type) && ("activity" in step) && !isId(step.activity) ) errors.push(`${at}.activity: activity id (16 characters) expected`);
  if ( (step.type === "damage") && ("activity" in step) && !["source", "bearer"].includes(step.to) ) errors.push(`${at}.activity: only for a riposte (to: "source") or the bearer (to: "bearer")`);
  if ( step.type === "move" ) {
    if ( !MOVE_MODES.includes(step.mode) ) errors.push(`${at}.mode: ${MOVE_MODES.join(", ")}`);
    const formula = (typeof step.distance === "string") && step.distance.trim();
    if ( !formula && !(Number.isFinite(step.distance) && (step.distance > 0)) ) errors.push(`${at}.distance: positive number or formula`);
    if ( (typeof step.units !== "string") || !step.units ) errors.push(`${at}.units: unit required`);
    if ( ("follow" in step) && (typeof step.follow !== "boolean") ) errors.push(`${at}.follow: boolean`);
  }
  if ( (step.type === "status") && ((typeof step.status !== "string") || !step.status) ) errors.push(`${at}.status: condition required`);
  if ( (step.type === "lift") && !(Number.isFinite(step.height) && (step.height > 0) && (typeof step.units === "string") && step.units) ) errors.push(`${at}.height, units: elevation required`);
  // §86 : riposte par une sauvegarde — vers l'attaquant, une activité de l'item.
  if ( step.type === "save" ) {
    if ( step.to !== "source" ) errors.push(`${at}.to: "source"`);
    if ( !isId(step.activity) ) errors.push(`${at}.activity: activity id (16 characters) expected`);
  }
  if ( step.type === "mark" ) {
    if ( (typeof step.mark !== "string") || !step.mark ) errors.push(`${at}.mark: mark name required`);
    if ( (typeof step.label !== "string") || !step.label ) errors.push(`${at}.label: translation key required`);
    if ( ("seconds" in step) && !(Number.isFinite(step.seconds) && (step.seconds > 0)) ) errors.push(`${at}.seconds: positive number`);
  }
  if ( (step.type === "consume") && !["target", "source"].includes(step.side) ) errors.push(`${at}.side: "target" or "source"`);
  if ( (step.type === "resave") && ("keep" in step) && (step.keep !== true) ) errors.push(`${at}.keep: true or absent`);
  if ( (step.type === "resave") && ("unlessSeesOrigin" in step) && (step.unlessSeesOrigin !== true) ) errors.push(`${at}.unlessSeesOrigin: true or absent`);
  if ( (step.type === "resave") && ("advantage" in step) && (step.advantage !== true) ) errors.push(`${at}.advantage: true or absent`);
  if ( (step.type === "resave") && ("tally" in step) ) {
    const t = step.tally;
    const count = n => Number.isInteger(n) && (n > 0);
    if ( !isObject(t) || !count(t.successes) || !count(t.failures) || (("status" in t) && ((typeof t.status !== "string") || !t.status))
      || !Object.keys(t).every(k => ["successes", "failures", "status"].includes(k)) ) errors.push(`${at}.tally: { successes, failures, status? } (positive integers, condition)`);
    if ( step.keep === true ) errors.push(`${at}.tally: not applicable with keep`);
  }
  if ( (step.type === "resave") && ("onFail" in step) && !RESAVE_ON_FAIL.includes(step.onFail) ) errors.push(`${at}.onFail: ${RESAVE_ON_FAIL.join(", ")}`);
  if ( (step.type === "attackBonus") && ((typeof step.formula !== "string") || !step.formula.trim()) ) errors.push(`${at}.formula: formula required`);
  // §31 : ce qui s'ajoute au jet de l'activité de réduction (Endurance de la pierre : « ajoutez votre modificateur de Constitution »).
  // §33 : un dé retiré au jet d'attaque (Mots cinglants : « soustrayez le résultat du jet ») — l'attaque est rejugée.
  if ( ["penalty", "bonus"].includes(step.type) && ((typeof step.formula !== "string") || !step.formula.trim()) ) errors.push(`${at}.formula: formula required`);
  if ( (step.type === "reduce") && ("bonus" in step) && ((typeof step.bonus !== "string") || !step.bonus.trim()) ) errors.push(`${at}.bonus: formula`);
}

export function validateTrigger(declaration, at, facts, errors) {
  if ( !isObject(declaration) ) return errors.push(`${at}: a declaration is an object`);
  const d = normalize(declaration);
  if ( !d.on.length ) errors.push(`${at}.on: at least one moment`);
  for ( const m of d.on ) if ( !(m in MOMENTS) ) errors.push(`${at}.on: unknown moment "${m}" (${Object.keys(MOMENTS).join(", ")})`);
  if ( (d.via !== null) && !VIA.includes(d.via) ) errors.push(`${at}.via: ${VIA.join(", ")}`);
  // `fromEffect` : la déclaration ne vaut que pour l'effet de l'item de cet id (Bouclier de feu : chaud OU froid).
  if ( "fromEffect" in declaration ) {
    if ( !isId(declaration.fromEffect) ) errors.push(`${at}.fromEffect: effect id (16 characters)`);
    if ( d.via !== "effect" ) errors.push(`${at}.fromEffect: requires via: "effect"`);
  }
  // §65 : `by: "originSide"` — l'effet ne réagit qu'aux dégâts du lanceur ou de ses alliés (Suggestion).
  if ( "by" in declaration ) {
    if ( !DAMAGED_BY.includes(declaration.by) ) errors.push(`${at}.by: ${DAMAGED_BY.join(", ")}`);
    if ( (d.via !== "effect") || (d.on.length !== 1) || (d.on[0] !== "isDamaged") ) errors.push(`${at}.by: requires via: "effect" and isDamaged as the only moment`);
  }
  // `oncePerTurn` : une part de dégâts bonus qui ne vaut qu'une fois par tour (Attraction de la mort : « une fois par tour »).
  if ( ("oncePerTurn" in declaration) && ((declaration.oncePerTurn !== true) || (d.on.length !== 1) || (d.on[0] !== "preDamageRoll")) ) {
    errors.push(`${at}.oncePerTurn: true, with preDamageRoll as the only moment`);
  }
  // §223 (#12) : `ask` — une part de dégâts bonus que l'auteur choisit de mettre ou non avant le jet (Frappe effroyable) ; `uses` :
  // l'activité de l'item dont elle dépense une utilisation, et sans laquelle elle n'est pas proposée.
  if ( "ask" in declaration ) {
    const a = declaration.ask;
    const ok = (a === true) || (isObject(a) && Object.keys(a).every(k => k === "uses") && (!("uses" in a) || isId(a.uses)));
    if ( !ok ) errors.push(`${at}.ask: true or { uses?: activity id (16 characters) }`);
    if ( (d.on.length !== 1) || (d.on[0] !== "preDamageRoll") ) errors.push(`${at}.ask: preDamageRoll as the only moment`);
  }
  // §129 : `free` — une fenêtre de réaction qui ne coûte pas la Réaction (Chanceux : un point de chance), proposée même si elle est prise.
  if ( ("free" in declaration) && (declaration.free !== true) ) errors.push(`${at}.free: true or absent`);
  if ( !Array.isArray(d.do) || !d.do.length ) errors.push(`${at}.do: at least one step`);
  else {
    d.do.forEach((s, i) => validateStep(s, `${at}.do[${i}]`, errors));
    // Chaque étape va avec ses moments : une poussée n'a de sens qu'à une issue, une sauvegarde répétée qu'au tour.
    const outcome = d.on.some(m => OUTCOME_MOMENTS.includes(m));
    const resave = d.on.length && d.on.every(m => RESAVE_MOMENTS.includes(m));
    const bearer = d.on.length && d.on.every(m => BEARER_MOMENTS.includes(m));
    for ( const s of d.do ) {
      if ( isObject(s) && OUTCOME_STEPS.includes(s.type) && !outcome ) errors.push(`${at}.do: "${s.type}" requires an outcome moment (${OUTCOME_MOMENTS.join(", ")})`);
      if ( isObject(s) && (s.type === "resave") && (!resave || (d.via !== "effect")) ) errors.push(`${at}.do: "resave" requires moments among ${RESAVE_MOMENTS.join(", ")} and via: "effect"`);
      if ( isObject(s) && (s.type === "remove") && (!bearer || (d.via !== "effect")) ) errors.push(`${at}.do: "remove" requires bearer moments (${BEARER_MOMENTS.join(", ")}) and via: "effect"`);
      // §34 : le Désavantage peut aussi venir d'une réaction avant le jet (Esquive des ombres, Éclat protecteur).
      const preAttackReaction = d.on.some(m => PRE_ATTACK_WINDOWS.includes(m)) && d.do.some(x => isObject(x) && (x.type === "use"));
      if ( isObject(s) && ATTACK_STEPS.includes(s.type) && !d.on.includes("preAttackRoll") && !((s.type === "disadvantage") && preAttackReaction) ) errors.push(`${at}.do: "${s.type}" requires the preAttackRoll moment`);
      if ( isObject(s) && (s.type === "consume") && (!d.on.includes("preAttackRoll") || (d.via !== "effect")) ) errors.push(`${at}.do: "consume" requires the preAttackRoll moment and via: "effect"`);
      if ( isObject(s) && (s.type === "ward") && (!d.on.includes("isAttacked") || (d.via !== "effect")) ) errors.push(`${at}.do: "ward" requires the isAttacked moment and via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "source") && ((d.on.length !== 1) || (d.on[0] !== "isHit")) ) errors.push(`${at}.do: a riposte (to: "source") requires isHit as the only moment`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "origin") && ((d.on.length !== 1) || (d.on[0] !== "isDamaged") || (d.via !== "effect")) ) errors.push(`${at}.do: a damage share (to: "origin") requires isDamaged as the only moment and via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "bearer") && (!d.on.length || !d.on.every(m => TURN_MOMENTS.includes(m)) || (d.via !== "effect")) ) errors.push(`${at}.do: the bearer's damage (to: "bearer") requires moments among ${TURN_MOMENTS.join(", ")} and via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && ("onSave" in s) && ((d.on.length !== 1) || (d.on[0] !== "failedSave") || ("to" in s)) ) errors.push(`${at}.do: "onSave" requires failedSave as the only moment, without "to"`);
      if ( isObject(s) && ["halve", "uncrit", "reduce", "miss", "penalty"].includes(s.type) && !((s.type === "penalty") && preAttackReaction) && (!d.on.some(m => HIT_WINDOWS.includes(m)) || !d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "${s.type}" requires the isHit or allyIsHit moment and a "use" reaction`);
      if ( isObject(s) && (s.type === "absorb") && !(d.on.includes("allyIsDamaged") && d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "absorb" requires the allyIsDamaged moment and a "use" reaction`);
      if ( isObject(s) && (s.type === "interpose") && !(d.on.includes("allyIsDamaged") && d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "interpose" requires the allyIsDamaged moment and a "use" reaction`);
      if ( isObject(s) && (s.type === "bonus") && !(d.on.includes("allyAttacks") && preAttackReaction) ) errors.push(`${at}.do: "bonus" requires the allyAttacks moment and a "use" reaction`);
      if ( isObject(s) && (s.type === "endCondition") && (!d.on.includes("gainsCondition") || !d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "endCondition" requires the gainsCondition moment and a "use" reaction`);
    }
  }
  for ( const key of unknownFacts(d.if, facts) ) errors.push(`${at}.if: unknown fact "${key}"`);
}

export function validateAura(aura, at, errors) {
  if ( !isObject(aura) ) return errors.push(`${at}: an object`);
  if ( ("radius" in aura) && !(Number.isFinite(aura.radius) && (aura.radius > 0)) ) errors.push(`${at}.radius: positive number`);
  if ( ("units" in aura) && (typeof aura.units !== "string") ) errors.push(`${at}.units: string`);
  if ( ("affects" in aura) && !AURA_AFFECTS.includes(aura.affects) ) errors.push(`${at}.affects: ${AURA_AFFECTS.join(", ")}`);
  if ( ("includeSelf" in aura) && (typeof aura.includeSelf !== "boolean") ) errors.push(`${at}.includeSelf: boolean`);
  if ( ("effect" in aura) && !isId(aura.effect) ) errors.push(`${at}.effect: effect id (16 characters)`);
  if ( ("radiusFormula" in aura) && (typeof aura.radiusFormula !== "string") ) errors.push(`${at}.radiusFormula: string`);
  if ( ("whileActive" in aura) && (aura.whileActive !== true) ) errors.push(`${at}.whileActive: true or absent`);
  if ( "changes" in aura ) {
    const ok = Array.isArray(aura.changes) && aura.changes.length && aura.changes.every(c => isObject(c)
      && (typeof c.key === "string") && c.key && (typeof c.value === "string") && (typeof c.type === "string") && c.type);
    if ( !ok ) errors.push(`${at}.changes: list of { key, value (string), type }`);
  }
  if ( ("types" in aura) && (!Array.isArray(aura.types) || !aura.types.length || !aura.types.every(t => CREATURE_TYPES.includes(t))) ) {
    errors.push(`${at}.types: creature types (${CREATURE_TYPES.join(", ")})`);
  }
  for ( const key of Object.keys(aura) ) {
    if ( !["radius", "units", "affects", "includeSelf", "effect", "radiusFormula", "whileActive", "changes", "types"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
  }
}
