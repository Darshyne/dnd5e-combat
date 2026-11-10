/**
 * La fusion des couches d'une entrée (module < surcouche du monde < flag de l'item). Fonctions pures, aucune dépendance à Foundry.
 */

import { isObject } from "./shared.mjs";

/**
 * Comment une clé passe d'une couche à la suivante :
 *  - `replace`   la valeur de la couche la plus spécifique, telle quelle ;
 *  - `shallow`   un objet de réglage fusionné champ par champ (corriger un rayon sans redire le reste) ;
 *  - `copy`      un objet remplacé entier (une copie) ; `list` : une liste remplacée entière (une copie) ;
 *  - `deep`      une copie profonde (objets imbriqués) ;
 *  - `triggers`  la liste des déclarations, remplacée entière (une seule déclaration devient une liste) ;
 *  - `trace`     un objet fusionné champ par champ, ou une valeur simple qui le remplace.
 */
const STRATEGIES = Object.freeze({
  replace: (prev, value) => value,
  shallow: (prev, value) => ({ ...(prev ?? {}), ...value }),
  copy: (prev, value) => ({ ...value }),
  list: (prev, value) => [...value],
  deep: (prev, value) => JSON.parse(JSON.stringify(value)),
  triggers: (prev, value) => (Array.isArray(value) ? [...value] : [value]),
  trace: (prev, value) => ((typeof value === "object") ? { ...((typeof prev === "object") ? prev : {}), ...value } : value)
});

/** La stratégie de chaque clé d'entrée (toutes celles de `ENTRY_KEYS`, tests/content.test.mjs), dans l'ordre où elles s'écrivent. */
export const MERGE = Object.freeze({
  triggers: "triggers", endsWhen: "shallow", banishes: "replace", singleAttack: "replace", spellFailure: "replace", untypedDamage: "replace", noAttacksOrSpells: "replace", noSpells: "replace", knownToOrigin: "replace", panic: "replace", confusion: "replace", noBonus: "replace", forcedAttack: "replace", upkeep: "replace", keepsProne: "replace", afterSmite: "replace", wardsConditions: "replace", aura: "shallow", onHit: "shallow", choice: "shallow", targets: "shallow", trace: "trace",
  enchantTarget: "replace", ranges: "shallow", tether: "shallow", pact: "shallow", damageShield: "shallow", rangedDefense: "replace", exclusiveWeapon: "replace", minRange: "replace", swornEnemy: "replace", devours: "replace", critFeeds: "replace", maxSpellDamageVs: "replace", wrath: "replace", hardToPerceive: "replace", coats: "replace", castDuration: "replace", backfire: "replace", gmAlert: "replace", hitFollowUp: "replace",
  hitDiceHeal: "shallow", teleport: "shallow", lineDash: "shallow", absorb: "shallow", summon: "shallow",
  movable: "shallow", burst: "shallow", recast: "replace", obscures: "replace", silences: "replace", revealsInvisible: "replace",
  effectsExpire: "replace", usageLimits: "shallow", healMax: "replace", duplicates: "replace", reactiveSpell: "replace",
  saveAdvantage: "list", onFell: "shallow", bonusAttack: "shallow", projectiles: "shallow", leap: "shallow", chain: "replace", curesOn: "replace", endsOnUse: "replace", drawsOnEnd: "shallow", endActivity: "shallow", noRangedWeapons: "replace", catalyst: "replace",
  bolt: "shallow", light: "shallow", atTurnStart: "shallow", breaksOn: "list", breaksOnOrigin: "list", noReactions: "replace",
  actionOrBonus: "replace", pickTargets: "replace", flurryStrikes: "replace", effectDurations: "shallow", grantsConditionImmunities: "list", zoneMax: "replace", healPool: "copy", spellsInAttack: "copy", duringRage: "copy", quietPose: "replace", zoneBound: "replace", effectsFirst: "replace", hitDefense: "replace", brutalStrike: "replace", enterOnPose: "replace", killsAtZero: "replace", retort: "replace", grants: "replace", summonEffectsOnCaster: "replace", sniper: "replace", checkPoses: "replace", saveAutoSuccess: "replace", fadesOnLongRest: "replace", magicEvasion: "replace", saveAdvantageFrom: "replace", leash: "replace", compels: "replace", durationByLevel: "replace", keepsSpeed: "replace", windward: "replace", formLock: "replace", zoneLasts: "replace", regainOnShortRest: "list", absorbsDamage: "list", dataFixes: "replace", includesOrigin: "replace", cures: "list", curesAll: "list", potionEffect: "replace", castTargets: "replace",
  effectChanges: "shallow", advantageIfFighting: "replace", emanation: "shallow", regeneration: "replace",
  fortitude: "replace", noOpportunity: "replace", sharesSpace: "replace", placesSummons: "replace", targetedSummon: "replace", drain: "replace",
  swallow: "replace", savedEffects: "list", ignoresCloseCombat: "replace", sharedHp: "replace", failMargins: "shallow",
  resize: "shallow", orders: "list", reactions: "copy", lastStand: "copy", counter: "copy", difficultTerrain: "copy",
  storm: "copy", stableAtZero: "replace", wardsAtZero: "replace", zoneCharges: "replace", noDamage: "list", dropsEffects: "list",
  selfZone: "deep", zoneAffects: "replace", pendingDie: "copy", maxDamage: "copy", maxNextHit: "replace", weaponDamageTypes: "copy", grappleSize: "copy", inescapable: "replace", grappleCover: "replace", rolledAc: "copy", swapPlaces: "copy", sweep: "copy",
  commandStrike: "copy", zoneEnd: "copy", onNatural1: "copy", casterPulse: "deep", searchBonus: "copy", lifesteal: "copy",
  rerollInitiative: "copy", effectStatuses: "deep", atZero: "deep", afterSneak: "copy", saveDamage: "shallow",
  afterTeleport: "deep", effectsIf: "replace", contest: "copy", forOneAttack: "replace", basicActions: "shallow",
  secondPhase: "shallow", changesForm: "shallow", empower: "shallow", discharge: "shallow", healsDownedMax: "replace",
  sneakAttack: "replace", evasion: "replace", avoidance: "replace", elusive: "replace", holdsStill: "replace", cunningStrikeMax: "replace",
  grantsAction: "replace", movesAfter: "replace", studiedAttacks: "replace", heroicWarrior: "replace",
  greatWeaponFighting: "replace", thrownDamage: "replace", rage: "replace", persistentRage: "replace", reckless: "replace",
  relentless: "replace", blocksHealing: "replace", noOpportunityAttacks: "replace", byWounds: "replace",
  oneAttack: "replace", martialArts: "replace", flurry: "replace", stunningStrike: "replace", openHand: "replace",
  smite: "replace", supremeHealing: "replace", discipleOfLife: "replace", blessedHealer: "replace",
  potentCantrip: "replace", sculptSpells: "replace", endurance: "replace", replacesAttack: "replace", hitRider: "replace",
  metamagic: "replace", portent: "replace", dispel: "replace", zoneEffects: "replace", rollBonus: "replace", keepsConcentration: "replace", spellDamageTypes: "replace", critMove: "replace", combatInspiration: "replace", endsOwnConditions: "replace", regainOnInitiative: "replace", grantsResistances: "replace", scoreFloor: "replace", cantripRange: "replace", fleetStep: "replace", extraFirstTurn: "replace",
  transpose: "replace", stabilizes: "replace", carriedLight: "replace", kindles: "replace", scatter: "replace", flammable: "replace", climbsCeilings: "replace", grantsSpeeds: "replace", climbsOnTurn: "replace", slippery: "replace", notOnSlippery: "replace", saveAdvantageSize: "replace", jump: "replace", burns: "replace", savageAttacker: "replace",
  initiativeSwap: "replace", healingRerolls: "replace", effectWhile: "replace", rangedFeat: "replace", piercer: "replace",
  critMark: "replace", grappleDamage: "replace", haltOnReaction: "replace", concentrationBreaker: "replace",
  interposeShield: "replace", elementalAdept: "replace", ignoresResistance: "replace", quickStand: "replace",
  quickSearch: "replace", opportunityDisadvantage: "replace", peerlessAim: "replace", fortifiedHealing: "replace",
  overwhelmingStrike: "replace", spellRecall: "replace", lastStandHeal: "replace", reactiveStrike: "replace",
  ritualAdept: "replace", slotRecovery: "replace", fleeOnFailedSave: "replace", halfOnMiss: "replace",
  saveDisadvantageFor: "replace", limitedAction: "replace", noActions: "replace", hpTiers: "replace",
  endsCurses: "replace", tempHpPool: "replace", revivesFull: "replace", standsWithReaction: "replace", seesInvisible: "replace", etherealShift: "replace", encloses: "replace", willingFails: "replace", globe: "replace",
  blink: "replace", walls: "replace", pointWall: "replace", barrier: "replace", recastCost: "replace", levitate: "replace",
  prismatic: "replace", wallSide: "replace", cellWall: "replace", coverThrough: "replace", thinWall: "replace",
  wallAura: "replace", effectEnds: "shallow", effectThen: "shallow", actionEnds: "shallow", sneakBonus: "shallow",
  cunningStrikes: "shallow"
});

/**
 * Combine les couches, de la moins à la plus spécifique (module → monde → item), clé par clé selon `MERGE`.
 * @param {Array<object|null|undefined>} layers
 * @returns {object|null}  null si aucune couche ne dit rien.
 */
export function mergeEntries(layers) {
  let out = null;
  for ( const layer of layers ) {
    if ( !isObject(layer) || !Object.keys(layer).length ) continue;
    out ??= {};
    for ( const [key, how] of Object.entries(MERGE) ) if ( key in layer ) out[key] = STRATEGIES[how](out[key], layer[key]);
  }
  return out;
}
