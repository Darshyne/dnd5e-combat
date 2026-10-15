/**
 * La fusion des couches d'une entrée (module < surcouche du monde < flag de l'item). Fonctions pures, aucune dépendance à Foundry.
 */

import { isObject } from "./shared.mjs";
/**
 * Combine les couches, de la moins à la plus spécifique (module → monde → item). Par clé : une liste (`triggers`, `reactions`,
 * `counter`…) est REMPLACÉE, elle se réécrit entière ; la plupart des objets de réglage (`aura`, `onHit`, `choice`, `targets`… :
 * voir chaque ligne ci-dessous) sont fusionnés champ par champ (corriger un rayon sans redire le reste).
 * @param {Array<object|null|undefined>} layers
 * @returns {object|null}  null si aucune couche ne dit rien.
 */
export function mergeEntries(layers) {
  let out = null;
  for ( const layer of layers ) {
    if ( !isObject(layer) || !Object.keys(layer).length ) continue;
    out ??= {};
    if ( "triggers" in layer ) out.triggers = Array.isArray(layer.triggers) ? [...layer.triggers] : [layer.triggers];
    if ( "aura" in layer ) out.aura = { ...(out.aura ?? {}), ...layer.aura };
    if ( "onHit" in layer ) out.onHit = { ...(out.onHit ?? {}), ...layer.onHit };
    if ( "choice" in layer ) out.choice = { ...(out.choice ?? {}), ...layer.choice };
    if ( "targets" in layer ) out.targets = { ...(out.targets ?? {}), ...layer.targets };
    if ( "trace" in layer ) out.trace = (typeof layer.trace === "object") ? { ...((typeof out.trace === "object") ? out.trace : {}), ...layer.trace } : layer.trace;
    if ( "enchantTarget" in layer ) out.enchantTarget = layer.enchantTarget;
    if ( "ranges" in layer ) out.ranges = { ...(out.ranges ?? {}), ...layer.ranges };
    if ( "tether" in layer ) out.tether = { ...(out.tether ?? {}), ...layer.tether };
    if ( "pact" in layer ) out.pact = { ...(out.pact ?? {}), ...layer.pact };
    if ( "damageShield" in layer ) out.damageShield = { ...(out.damageShield ?? {}), ...layer.damageShield };
    if ( "hitDiceHeal" in layer ) out.hitDiceHeal = { ...(out.hitDiceHeal ?? {}), ...layer.hitDiceHeal };
    if ( "teleport" in layer ) out.teleport = { ...(out.teleport ?? {}), ...layer.teleport };
    if ( "lineDash" in layer ) out.lineDash = { ...(out.lineDash ?? {}), ...layer.lineDash };
    if ( "absorb" in layer ) out.absorb = { ...(out.absorb ?? {}), ...layer.absorb };
    if ( "summon" in layer ) out.summon = { ...(out.summon ?? {}), ...layer.summon };
    if ( "movable" in layer ) out.movable = { ...(out.movable ?? {}), ...layer.movable };
    if ( "burst" in layer ) out.burst = { ...(out.burst ?? {}), ...layer.burst };
    if ( "recast" in layer ) out.recast = layer.recast;
    if ( "obscures" in layer ) out.obscures = layer.obscures;
    if ( "revealsInvisible" in layer ) out.revealsInvisible = layer.revealsInvisible;
    if ( "effectsExpire" in layer ) out.effectsExpire = layer.effectsExpire;
    if ( "usageLimits" in layer ) out.usageLimits = { ...(out.usageLimits ?? {}), ...layer.usageLimits };
    if ( "healMax" in layer ) out.healMax = layer.healMax;
    if ( "duplicates" in layer ) out.duplicates = layer.duplicates;
    if ( "reactiveSpell" in layer ) out.reactiveSpell = layer.reactiveSpell;
    if ( "saveAdvantage" in layer ) out.saveAdvantage = [...layer.saveAdvantage];
    if ( "onFell" in layer ) out.onFell = { ...(out.onFell ?? {}), ...layer.onFell };
    if ( "bonusAttack" in layer ) out.bonusAttack = { ...(out.bonusAttack ?? {}), ...layer.bonusAttack };
    if ( "projectiles" in layer ) out.projectiles = { ...(out.projectiles ?? {}), ...layer.projectiles };
    if ( "leap" in layer ) out.leap = { ...(out.leap ?? {}), ...layer.leap };
    if ( "bolt" in layer ) out.bolt = { ...(out.bolt ?? {}), ...layer.bolt };
    if ( "light" in layer ) out.light = { ...(out.light ?? {}), ...layer.light };
    if ( "atTurnStart" in layer ) out.atTurnStart = { ...(out.atTurnStart ?? {}), ...layer.atTurnStart };
    // §16.47
    if ( "breaksOn" in layer ) out.breaksOn = [...layer.breaksOn];
    if ( "noReactions" in layer ) out.noReactions = layer.noReactions;
    if ( "actionOrBonus" in layer ) out.actionOrBonus = layer.actionOrBonus;   // §77
    if ( "cures" in layer ) out.cures = [...layer.cures];
    if ( "curesAll" in layer ) out.curesAll = [...layer.curesAll];
    if ( "potionEffect" in layer ) out.potionEffect = layer.potionEffect;
    if ( "castTargets" in layer ) out.castTargets = layer.castTargets;
    if ( "effectChanges" in layer ) out.effectChanges = { ...(out.effectChanges ?? {}), ...layer.effectChanges };
    if ( "advantageIfFighting" in layer ) out.advantageIfFighting = layer.advantageIfFighting;
    if ( "emanation" in layer ) out.emanation = { ...(out.emanation ?? {}), ...layer.emanation };
    if ( "regeneration" in layer ) out.regeneration = layer.regeneration;
    if ( "fortitude" in layer ) out.fortitude = layer.fortitude;
    if ( "noOpportunity" in layer ) out.noOpportunity = layer.noOpportunity;
    if ( "sharesSpace" in layer ) out.sharesSpace = layer.sharesSpace;   // §105
    if ( "placesSummons" in layer ) out.placesSummons = layer.placesSummons;   // §109
    if ( "drain" in layer ) out.drain = layer.drain;
    if ( "swallow" in layer ) out.swallow = layer.swallow;
    if ( "savedEffects" in layer ) out.savedEffects = [...layer.savedEffects];
    if ( "ignoresCloseCombat" in layer ) out.ignoresCloseCombat = layer.ignoresCloseCombat;
    if ( "sharedHp" in layer ) out.sharedHp = layer.sharedHp;
    if ( "failMargins" in layer ) out.failMargins = { ...(out.failMargins ?? {}), ...layer.failMargins };
    if ( "resize" in layer ) out.resize = { ...(out.resize ?? {}), ...layer.resize };
    if ( "orders" in layer ) out.orders = [...layer.orders];
    if ( "reactions" in layer ) out.reactions = { ...layer.reactions };
    if ( "lastStand" in layer ) out.lastStand = { ...layer.lastStand };
    if ( "counter" in layer ) out.counter = { ...layer.counter };
    if ( "difficultTerrain" in layer ) out.difficultTerrain = { ...layer.difficultTerrain };   // §69
    if ( "storm" in layer ) out.storm = { ...layer.storm };   // §70
    if ( "stableAtZero" in layer ) out.stableAtZero = layer.stableAtZero;   // §71
    if ( "wardsAtZero" in layer ) out.wardsAtZero = layer.wardsAtZero;   // §73
    if ( "zoneCharges" in layer ) out.zoneCharges = layer.zoneCharges;   // §75
    if ( "noDamage" in layer ) out.noDamage = [...layer.noDamage];   // §81
    if ( "selfZone" in layer ) out.selfZone = JSON.parse(JSON.stringify(layer.selfZone));   // §86
    if ( "zoneAffects" in layer ) out.zoneAffects = layer.zoneAffects;   // §86
    if ( "pendingDie" in layer ) out.pendingDie = { ...layer.pendingDie };   // §89
    if ( "rolledAc" in layer ) out.rolledAc = { ...layer.rolledAc };   // §89
    for ( const key of ["swapPlaces", "sweep", "commandStrike", "zoneEnd", "onNatural1"] ) if ( key in layer ) out[key] = { ...layer[key] };   // §90, §91, §93
    if ( "casterPulse" in layer ) out.casterPulse = JSON.parse(JSON.stringify(layer.casterPulse));   // §91
    if ( "searchBonus" in layer ) out.searchBonus = { ...layer.searchBonus };   // §94
    for ( const key of ["lifesteal", "rerollInitiative"] ) if ( key in layer ) out[key] = { ...layer[key] };   // §120
    if ( "effectStatuses" in layer ) out.effectStatuses = JSON.parse(JSON.stringify(layer.effectStatuses));   // §96
    if ( "atZero" in layer ) out.atZero = JSON.parse(JSON.stringify(layer.atZero));   // §95
    if ( "afterSneak" in layer ) out.afterSneak = { ...layer.afterSneak };   // §95
    if ( "saveDamage" in layer ) out.saveDamage = { ...(out.saveDamage ?? {}), ...layer.saveDamage };   // §92
    if ( "afterTeleport" in layer ) out.afterTeleport = JSON.parse(JSON.stringify(layer.afterTeleport));   // §92
    if ( "effectsIf" in layer ) out.effectsIf = layer.effectsIf;   // §71
    if ( "contest" in layer ) out.contest = { ...layer.contest };   // §72
    if ( "forOneAttack" in layer ) out.forOneAttack = layer.forOneAttack;
    if ( "basicActions" in layer ) out.basicActions = { ...(out.basicActions ?? {}), ...layer.basicActions };
    if ( "secondPhase" in layer ) out.secondPhase = { ...(out.secondPhase ?? {}), ...layer.secondPhase };
    if ( "changesForm" in layer ) out.changesForm = { ...(out.changesForm ?? {}), ...layer.changesForm };   // §76
    // §19.9
    if ( "empower" in layer ) out.empower = { ...(out.empower ?? {}), ...layer.empower };
    if ( "discharge" in layer ) out.discharge = { ...(out.discharge ?? {}), ...layer.discharge };
    if ( "healsDownedMax" in layer ) out.healsDownedMax = layer.healsDownedMax;
    // §20
    for ( const key of ["sneakAttack", "evasion", "elusive", "holdsStill", "cunningStrikeMax", "grantsAction", "movesAfter", "studiedAttacks",
      "heroicWarrior", "greatWeaponFighting", "thrownDamage", "rage", "persistentRage", "reckless", "relentless", "blocksHealing",
      "noOpportunityAttacks", "byWounds", "oneAttack", "martialArts", "flurry", "stunningStrike", "openHand", "smite", "supremeHealing", "discipleOfLife", "blessedHealer", "potentCantrip", "sculptSpells", "endurance", "replacesAttack", "hitRider", "metamagic", "portent", "dispel", "zoneEffects", "rollBonus", "transpose", "stabilizes", "carriedLight", "kindles", "savageAttacker", "initiativeSwap", "healingRerolls", "effectWhile", "rangedFeat", "piercer", "critMark", "grappleDamage", "haltOnReaction", "concentrationBreaker", "interposeShield", "elementalAdept", "ignoresResistance", "quickStand", "quickSearch", "opportunityDisadvantage", "peerlessAim", "fortifiedHealing", "overwhelmingStrike", "spellRecall", "lastStandHeal", "reactiveStrike", "ritualAdept", "slotRecovery", "fleeOnFailedSave", "halfOnMiss", "saveDisadvantageFor", "limitedAction", "noActions", "hpTiers", "endsCurses", "tempHpPool", "revivesFull", "seesInvisible", "globe", "blink", "walls", "pointWall", "barrier", "recastCost", "levitate", "prismatic", "wallSide", "cellWall", "coverThrough", "thinWall", "wallAura"] ) if ( key in layer ) out[key] = layer[key];   // §129–§135, §157
    if ( "effectEnds" in layer ) out.effectEnds = { ...(out.effectEnds ?? {}), ...layer.effectEnds };
    if ( "effectThen" in layer ) out.effectThen = { ...(out.effectThen ?? {}), ...layer.effectThen };
    if ( "actionEnds" in layer ) out.actionEnds = { ...(out.actionEnds ?? {}), ...layer.actionEnds };
    if ( "sneakBonus" in layer ) out.sneakBonus = { ...(out.sneakBonus ?? {}), ...layer.sneakBonus };
    if ( "cunningStrikes" in layer ) out.cunningStrikes = { ...(out.cunningStrikes ?? {}), ...layer.cunningStrikes };
  }
  return out;
}
