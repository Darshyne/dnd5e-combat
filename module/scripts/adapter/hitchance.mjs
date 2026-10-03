/**
 * La chance de toucher lue dans Foundry pour le cœur (core/hitchance.mjs, SPEC §15.3) : ce que le
 * jet d'attaque de dnd5e ferait, sans le lancer.
 *
 *  - bonus : `AttackActivityData#getAttackData` (data/activity/attack-data.mjs:274), celui-là même
 *    que le jet utilise (documents/activity/attack.mjs:258), avec le mode d'attaque, la
 *    caractéristique et la munition que le jet retiendrait (derniers choix mémorisés sur l'item,
 *    attack.mjs:92-117). Les dés du bonus (Bénédiction) sont lus terme à terme ;
 *  - avantage, désavantage : ceux du système (`D20RollModificationField.combineFields`, les
 *    mêmes champs que attack.mjs:121-124 — Empoisonné, effets actifs, règles appliquées) plus
 *    ceux du moteur (adapter/conditions.mjs, les mêmes qu'au jet) ; les deux à la fois = jet normal ;
 *  - seuil de critique : `criticalThreshold` de l'activité (attack-data.mjs:130) ;
 *  - CA : celle que dnd5e écrit sur le jet (`attributes.ac.value`), plus l'abri du moteur
 *    (adapter/cover.mjs), comme au verdict (runtime/engine.mjs) ; un état d'abri posé à la main est
 *    déjà dans la CA.
 *
 * Non compris : Chanceux (halfelin), Précision elfique, réactions de la
 * cible (Bouclier).
 */

import { hitChance, saveFailChance } from "../core/hitchance.mjs";
import { attackModifiers, netMode, isAutoCritical, autoFailSave } from "../core/conditions.mjs";
import { saveAdvantageAgainst, fightingAdvantageFor, bestSaveAbility } from "./saves.mjs";
import { conditionImmunitiesOf } from "./facts.mjs";
import { attackContext } from "./conditions.mjs";
import { coverFor } from "./cover.mjs";
import { readUnitFactors } from "./units.mjs";

/**
 * Le bonus d'une formule, séparé en partie fixe et dés. null si la formule a autre chose qu'une
 * somme de nombres et de dés simples (multiplication, dés modifiés…).
 * @returns {{flat: number, dice: Array<{number: number, faces: number, sign: 1|-1}>}|null}
 */
export function splitBonus(formula, data) {
  const { Die, NumericTerm, OperatorTerm } = foundry.dice.terms;
  let roll;
  try { roll = new Roll(formula || "0", data); }
  catch { return null; }
  let flat = 0;
  const dice = [];
  let sign = 1;
  for ( const term of roll.terms ) {
    if ( term instanceof OperatorTerm ) {
      if ( term.operator === "-" ) sign = -sign;
      else if ( term.operator !== "+" ) return null;
      continue;
    }
    if ( term instanceof Die ) {
      if ( term.modifiers?.length || !Number.isInteger(term.number) || !Number.isInteger(term.faces) ) return null;
      dice.push({ number: term.number, faces: term.faces, sign });
    }
    else if ( term instanceof NumericTerm ) flat += sign * term.number;
    else if ( term.isDeterministic ) {
      try { flat += sign * new Roll(term.formula).evaluateSync().total; }
      catch { return null; }
    }
    else return null;
    sign = 1;
  }
  return { flat, dice };
}

/** Le mode d'attaque, la caractéristique et la munition que le jet retiendrait. */
function rollChoices(activity, attackMode=null) {
  const item = activity.item;
  const last = item.getFlag?.("dnd5e", `last.${activity.id}`) ?? {};
  const modes = item.system.attackModes ?? [];
  const mode = attackMode ?? (modes.find(m => m.value === last.attackMode) ? last.attackMode : modes[0]?.value);
  const ammoOptions = item.system.ammunitionOptions ?? [];
  const ammunition = (last.ammunition !== undefined) ? last.ammunition : ammoOptions[0]?.value;
  return { attackMode: mode ?? null, ability: last.ability, ammunition: ammunition || undefined };
}

/**
 * Chance qu'une attaque touche une cible.
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity           Une activité d'attaque.
 * @param {object} [options]
 * @param {string|null} [options.attackMode]
 * @param {object} [options.posA]       Position de l'attaquant au bout de son approche.
 * @param {{advantage?: boolean, disadvantage?: boolean}} [options.keys]  Touches d'avantage et de
 *   désavantage de dnd5e (Alt / Ctrl par défaut), que le système ajoute au jet (dice/d20-roll.mjs:83-84).
 * @returns {{hit: number, critical: number, ac: number|null, baseAc: number|null, cover: object|null,
 *            mode: 1|0|-1, advantage: object[], disadvantage: object[], system: {advantage: boolean, disadvantage: boolean}}|null}
 *   null : pas une attaque, ou rien d'assez sûr pour l'afficher.
 */
export function hitChanceOf(attacker, target, activity, { attackMode=null, posA, keys={} }={}) {
  if ( (activity?.type !== "attack") || !attacker?.actor || !target?.actor ) return null;
  const baseAc = target.actor.system.attributes?.ac?.value;
  if ( !Number.isFinite(baseAc) ) return null;

  const choices = rollChoices(activity, attackMode);
  const { data, parts } = activity.getAttackData(choices);
  const bonus = splitBonus(parts.join(" + "), data);
  if ( !bonus ) return null;

  const actor = activity.actor;
  const rollData = activity.getRollData({ roll: { ability: choices.ability, attackMode: choices.attackMode } });
  const Field = dnd5e.dataModels.shared.D20RollModificationField;
  const system = Field.combineFields(actor.system, [
    `abilities.${rollData.roll.ability}.attack.roll`, "rolls.attack", `rolls.attack.${activity.getActionType(choices.attackMode)}`
  ], { rules: { category: "attack", actor, item: activity.item, rollData } });

  const factors = readUnitFactors();
  const context = attackContext(attacker, target, activity, choices.attackMode, factors, { posA });
  const ours = attackModifiers(context);
  const advantage = !!system.advantage || !!keys.advantage || (ours.advantage.length > 0);
  const disadvantage = !!system.disadvantage || !!keys.disadvantage || (ours.disadvantage.length > 0);
  const mode = netMode({ advantage: advantage ? [1] : [], disadvantage: disadvantage ? [1] : [] });

  const cover = coverFor(attacker, target, { posA, quiet: true });
  const ac = cover ? ((cover.bonus === null) ? null : baseAc + cover.bonus) : baseAc;
  const chance = hitChance({
    ac, bonus: bonus.flat, dice: bonus.dice, mode,
    critical: activity.criticalThreshold ?? 20,
    autoCritical: isAutoCritical(context.target, context.adjacent)
  });
  return { ...chance, ac, baseAc, cover, mode, advantage: ours.advantage, disadvantage: ours.disadvantage,
    system: { advantage: !!system.advantage, disadvantage: !!system.disadvantage },
    keys: { advantage: !!keys.advantage, disadvantage: !!keys.disadvantage } };
}

/**
 * Chance qu'une cible rate la sauvegarde d'une activité (§15.3) : ce que ferait son jet de sauvegarde, sans le lancer —
 * construit comme dnd5e le construit (`Actor5e#rollSavingThrow` → `#rollD20Test`, dnd5e 6.0.3) : champs
 * `abilities.<car>.save.roll` et `rolls.ability.save` combinés (bonus de règle, avantage, désavantage), parts
 * (modificateur, maîtrise, bonus, abri en Dextérité) par `D20Roll.constructParts`, réduction d'état (épuisement) par
 * `addConditionRollReduction` ; plus ce que le moteur y met (adapter/saves.mjs, `saveRollArguments`) : le bonus propre de
 * l'activité, l'avantage de `saveAdvantageAgainst` (Résistance à la magie, Ascendance féerique…) et de `fightingAdvantageFor`
 * (Charme-personne). Échec d'office : `autoFailSave` ; sans objet : immunité à tous les états posés, sans dégâts.
 * Plusieurs caractéristiques au choix (Lutte) : la meilleure pour la cible, comme elle la choisirait.
 * @returns {{fail: number, dc: number, ability: string, bonus: number, dice: object[], mode: 1|0|-1, autoFail: string|null,
 *   immune: boolean, legendary: number, advantage: string[], disadvantage: string[]}|null}
 */
export function saveChanceOf(caster, target, activity) {
  const actor = target?.actor;
  if ( (activity?.type !== "save") || !actor?.system?.abilities ) return null;
  const dc = activity.save?.dc?.value;
  const abilities = Array.from(activity.save?.ability ?? []).filter(a => actor.system.abilities[a]);
  if ( !Number.isFinite(dc) || !abilities.length ) return null;
  const ability = (abilities.length > 1) ? bestSaveAbility(actor, abilities) : abilities[0];
  const data = actor.system.abilities[ability];

  const rollData = actor.getRollData({ roll: true });
  Object.assign(rollData.roll ??= {}, { ability, proficient: data?.save?.prof?.multiplier >= 1, type: "ability" });
  const Field = dnd5e.dataModels.shared.D20RollModificationField;
  const { bonus: ruleBonus, ...options } = Field.combineFields(actor.system, [`abilities.${ability}.save.roll`, "rolls.ability.save"],
    { rules: { category: "save", actor, rollData } });
  const built = CONFIG.Dice.D20Roll.constructParts({
    mod: data?.mod,
    prof: data?.save?.prof?.hasProficiency ? data.save.prof.term : null,
    ruleBonus,
    cover: (ability === "dex") ? actor.system.attributes?.ac?.cover : null
  }, rollData);
  actor.addConditionRollReduction?.(built.parts, built.data);
  const own = splitBonus(built.parts.join(" + "), built.data);
  const extra = activity.save?.bonus ? splitBonus(String(activity.save.bonus), activity.getRollData()) : { flat: 0, dice: [] };
  if ( !own || !extra ) return null;

  const advantage = [];
  const disadvantage = [];
  if ( options.advantage ) advantage.push("sheet");
  if ( options.disadvantage ) disadvantage.push("sheet");
  if ( saveAdvantageAgainst(actor, activity) ) advantage.push("saveAdvantage");
  if ( fightingAdvantageFor(activity, target) ) advantage.push("fighting");
  const mode = netMode({ advantage, disadvantage });

  const statuses = Array.from(actor.statuses ?? []);
  const autoFail = autoFailSave(statuses, ability);
  const posed = (activity.effects ?? []).flatMap(ref => Array.from(ref.effect?.statuses ?? []));
  const immunities = conditionImmunitiesOf(actor);
  const immune = !(activity.damage?.parts?.length) && (posed.length > 0) && posed.every(s => immunities.includes(s));
  const bonus = own.flat + extra.flat;
  const dice = [...own.dice, ...extra.dice];
  return {
    fail: saveFailChance({ dc, bonus, dice, mode, autoFail: !!autoFail, immune }),
    dc, ability, bonus, dice, mode, autoFail, immune,
    legendary: actor.system.resources?.legres?.value ?? 0,
    advantage, disadvantage
  };
}
