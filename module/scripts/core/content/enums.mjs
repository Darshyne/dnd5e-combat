/**
 * Les énumérations du schéma du contenu (core/content.mjs) : versions, types d'étape, moments, valeurs permises. Fonctions pures, aucune dépendance à Foundry.
 */
/** Version du schéma. Une surcouche d'une autre version est ignorée avec un avertissement. */
export const CONTENT_VERSION = 1;

export const STEP_TYPES = Object.freeze(["lift", "disarm", "use", "replay", "damage", "move", "status", "resave", "remove", "halve", "uncrit", "consume", "advantage", "disadvantage", "ward", "attackBonus", "endCondition", "reduce", "miss", "penalty", "bonus", "absorb", "interpose", "mark", "save", "breakConcentration"]);
/** Les fenêtres « touché » : la créature touchée elle-même, ou une autre qui réagit pour elle (Sentinelle au seuil de la mort). */
export const HIT_WINDOWS = Object.freeze(["isHit", "allyIsHit"]);
/** Les actions de base qu'une activité peut prendre au coût de son activation (`basicActions`). */
export const BASIC_ACTION_KINDS = Object.freeze(["dash", "disengage", "dodge", "hide", "help"]);   // §72 : « help » (Maître des tactiques)
/** Les tailles de dnd5e, de la plus petite à la plus grande (`actorSizes`). */
export const SIZES = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);
/** §206 : cette taille est-elle au moins `min` ? Une taille inconnue compte comme Moyenne. */
export const sizeAtLeast = (size, min) => SIZES.indexOf(SIZES.includes(size) ? size : "med") >= SIZES.indexOf(min);
/** Les étapes qui ne valent qu'avant un jet d'attaque (moment preAttackRoll). */
export const ATTACK_STEPS = Object.freeze(["advantage", "disadvantage", "attackBonus"]);
export const MOVE_MODES = Object.freeze(["push", "pull"]);
/** Les destinataires d'une étape `damage` : l'attaquant (riposte), le lanceur de l'effet (partage), le porteur (son tour). */
export const DAMAGE_TO = Object.freeze(["source", "origin", "bearer"]);
/** La part des dégâts d'issue sur une sauvegarde réussie (`damage` au moment failedSave). */
export const DAMAGE_ON_SAVE = Object.freeze(["half", "none"]);
/** Les étapes qui ne s'exécutent qu'à l'application d'une résolution (moments hit, failedSave). */
export const OUTCOME_STEPS = Object.freeze(["lift", "move", "status", "disarm", "mark", "breakConcentration"]);
export const VIA = Object.freeze(["effect"]);
export const AURA_AFFECTS = Object.freeze(["ally", "enemy", "any"]);
/** §16.47 : ce que fait le porteur d'un effet `breaksOn` pour le faire cesser. */
export const BREAK_MOMENTS = Object.freeze(["attack", "damage", "spell", "save"]);
/** Quand un effet d'item prend fin (`effectEnds`, §23) : au début ou à la fin du prochain tour du lanceur, au début ou à la fin du prochain tour du porteur. */
export const EFFECT_ENDS = Object.freeze(["casterTurnStart", "casterTurnEnd", "bearerTurnStart", "bearerTurnEnd"]);
/** §258 : fins génériques (`endsWhen`) — l'armure enfilée, le moment où la distance au lanceur se juge, ce qui compte comme « personne
 * d'affecté ». */
export const ENDS_ARMOR = Object.freeze(["any", "heavy"]);
export const ENDS_APART_AT = Object.freeze(["move", "casterTurnEnd"]);
export const ENDS_UNAFFECTED = Object.freeze(["failedSave", "noHits", "noTargets"]);
/** Ce qui ouvre une attaque en action Bonus (`bonusAttack.after`). */
export const BONUS_ATTACK_AFTER = Object.freeze(["critical", "felled"]);

export const ENTRY_KEYS = Object.freeze(["smite", "metamagic", "endurance", "replacesAttack", "hitRider", "potentCantrip", "sculptSpells", "supremeHealing", "discipleOfLife", "blessedHealer", "martialArts", "flurry", "stunningStrike", "openHand", "effectEnds", "effectThen", "actionEnds", "blocksHealing", "noOpportunityAttacks", "byWounds", "oneAttack", "rage", "persistentRage", "reckless", "relentless", "grantsAction", "movesAfter", "studiedAttacks", "heroicWarrior", "greatWeaponFighting", "thrownDamage", "sneakAttack", "sneakBonus", "cunningStrikes", "cunningStrikeMax", "evasion", "elusive", "holdsStill", "empower", "discharge", "healsDownedMax", "failMargins", "reactions", "lastStand", "forOneAttack", "basicActions", "sharedHp", "secondPhase", "savedEffects", "ignoresCloseCombat", "triggers", "aura", "onHit", "choice", "targets", "trace", "teleport", "lineDash", "absorb", "summon", "movable", "burst", "recast", "atTurnStart", "bolt", "obscures", "healMax", "duplicates", "saveAdvantage", "onFell", "bonusAttack", "reactiveSpell", "projectiles", "leap", "light", "revealsInvisible", "effectsExpire", "usageLimits", "enchantTarget", "ranges", "tether", "pact", "damageShield", "hitDiceHeal", "breaksOn", "noReactions", "cures", "advantageIfFighting", "emanation", "regeneration", "fortitude", "noOpportunity", "drain", "swallow", "resize", "orders", "portent", "dispel", "counter", "zoneEffects", "rollBonus", "transpose", "stabilizes", "carriedLight", "kindles", "curesAll", "potionEffect", "castTargets", "effectChanges", "difficultTerrain", "storm", "stableAtZero", "effectsIf", "contest", "wardsAtZero", "zoneCharges", "noDamage", "selfZone", "zoneAffects", "pendingDie", "rolledAc", "swapPlaces", "sweep", "commandStrike", "casterPulse", "zoneEnd", "afterTeleport", "saveDamage", "onNatural1", "searchBonus", "atZero", "afterSneak", "effectStatuses", "changesForm", "actionOrBonus", "sharesSpace", "placesSummons", "lifesteal", "rerollInitiative", "savageAttacker", "initiativeSwap", "healingRerolls", "effectWhile", "rangedFeat", "piercer", "critMark", "grappleDamage", "haltOnReaction", "concentrationBreaker", "interposeShield", "elementalAdept", "ignoresResistance", "quickStand", "quickSearch", "opportunityDisadvantage", "peerlessAim", "fortifiedHealing", "overwhelmingStrike", "spellRecall", "lastStandHeal", "reactiveStrike", "ritualAdept", "slotRecovery", "fleeOnFailedSave", "halfOnMiss", "saveDisadvantageFor", "limitedAction", "noActions", "hpTiers", "endsCurses", "tempHpPool", "revivesFull", "seesInvisible", "globe", "blink", "walls", "pointWall", "barrier", "recastCost", "levitate", "prismatic", "wallSide", "cellWall", "coverThrough", "thinWall", "wallAura", "scatter", "flammable", "climbsCeilings", "grantsSpeeds", "climbsOnTurn", "slippery", "notOnSlippery", "saveAdvantageSize", "jump", "burns", "etherealShift", "encloses", "willingFails", "keepsConcentration", "spellDamageTypes", "critMove", "combatInspiration", "endsOwnConditions", "regainOnInitiative", "grantsResistances", "scoreFloor", "cantripRange", "fleetStep", "extraFirstTurn", "endsWhen", "banishes", "singleAttack", "wardsConditions", "noAttacksOrSpells", "afterSmite", "maxDamage", "maxNextHit", "weaponDamageTypes"]);
export const CHOICE_EFFECTS = Object.freeze(["one"]);
/** §38, §90 : les jets auxquels un `rollBonus` s'ajoute. */
export const ROLL_BONUS_ON = Object.freeze(["save", "check", "attack", "initiative"]);
/** §37 : ce qu'une sauvegarde répétée ratée impose en plus (`resave.onFail`) : l'action Esquiver (Malédiction). */
export const RESAVE_ON_FAIL = Object.freeze(["dodge"]);
/** §43.2 : qui fait cesser l'effet par une action, par quel jet, sous quel libellé. */
export const ACTION_END_BY = Object.freeze(["bearer", "other"]);
export const ACTION_END_ROLLS = Object.freeze(["save", "check"]);
export const ACTION_END_VERBS = Object.freeze(["wake"]);
/** §49 : l'état que le porteur se donne en mettant fin à l'effet (feu grégeois : « en vous infligeant l'état À terre »). */
export const ACTION_END_STATUSES = Object.freeze(["prone"]);
/** §32 : les options de Métamagie que le moteur applique au sort suivant. */
export const METAMAGIC_KINDS = Object.freeze(["quickened", "careful", "heightened", "distant", "subtle"]);
/** Les repos qui mettent fin aux effets d'un item (`effectsExpire`) : les événements d'expiration de dnd5e (config.mjs:4750). */
export const EFFECT_EXPIRIES = Object.freeze(["longRest", "shortRest"]);

export const PILOT_COSTS = Object.freeze(["action", "bonus", "free"]);
export const PULSE_MOMENTS = Object.freeze(["turnEnd", "enter", "moves", "turnStart", "casterTurnStart"]);
export const PILOT_ON_CAST = Object.freeze(["use", "command"]);

/** §279 : les genres d'arme qu'une règle peut nommer — « unarmed » (frappe à mains nues) et les types d'arme de dnd5e (config.mjs). */
export const WEAPON_KINDS = Object.freeze(["unarmed", "simpleM", "simpleR", "martialM", "martialR", "natural", "improv", "siege"]);
