import { describe, it, expect } from "vitest";
import { validateEntry, validateTable, mergeEntries, CONTENT_VERSION } from "../module/scripts/core/content.mjs";
import { CONTENT, SHIPPED, registerTable, unregisterTable, registeredTables } from "../module/scripts/content/index.mjs";

const facts = Object.fromEntries(["activity.type", "activity.isAttack", "activity.isSpell", "activity.isWeapon", "activity.identifier", "activity.id",
  "activity.hasProperty", "source.hasStatus", "source.hasEffect", "source.creatureType", "source.allyNearTarget", "source.summonNearTarget", "source.seesTarget",
  "target.hasStatus", "target.hasEffect", "target.hasEffectFrom", "target.sizeAtMost", "target.within", "target.seesSource", "target.creatureType", "target.immuneTo", "activity.isMelee", "target.hasTempHp", "target.atZero", "target.isDead", "damage.hasType", "target.hpAtMost", "condition.gained",
  "target.wounded", "target.bloodied", "source.classLevelAtLeast", "target.nearSelf", "self.seesTarget", "target.hasNotActed", "source.onOwnTurn", "activity.dealsType", "source.hasFeature", "activity.cantripOf", "activity.school", "activity.enchantedBy", "source.wildShaped", "activity.classSpell", "source.resists", "source.nearSelf", "self.seesSource", "source.hasEffectFromTarget"].map(k => [k, true]));
const MOMENTS_LIST = "isHit, isDamaged, leavesReach, enter, turnStart, turnEnd, moves, preDamageRoll, hit, failedSave, startOfTurn, endOfTurn, preAttackRoll, castsSpell, isMissed, enemyTurnEnd, isAttacked, enemyAttacks, allyAttacks, gainsCondition, allyIsHit, allyIsDamaged";

describe("validation d'une entrée", () => {
  it("accepte une entrée complète et bien formée", () => {
    expect(validateEntry({
      triggers: [{ on: "preDamageRoll", if: { "activity.isAttack": true }, do: [{ type: "damage", formula: "1d6", damageType: "necrotic" }] }],
      aura: { radius: 10, units: "ft", affects: "ally", includeSelf: false, effect: "ljMTBKPVmEnLPX1b", radiusFormula: "@scale.paladin.aura" },
      onHit: { save: "udF9lrpAQMvL0b9J" }
    }, { facts })).toEqual([]);
  });

  it("refuse ce qui n'est pas un objet, et les clés inconnues", () => {
    expect(validateEntry("hex", { facts })).toHaveLength(1);
    expect(validateEntry({ reaction: { window: "isHit" } }, { facts })[0]).toMatch(/reaction : clé inconnue/);
  });

  it("déclencheur : moment, étape, fait — chacun contrôlé", () => {
    const errors = validateEntry({ triggers: [{ on: "onHit", if: { "moon.phase": "full" }, do: [{ type: "smite" }] }] }, { facts });
    expect(errors).toEqual([
      `triggers[0].on : moment « onHit » inconnu (${MOMENTS_LIST})`,
      "triggers[0].do[0].type : « smite » inconnu (disarm, use, replay, damage, move, status, resave, remove, halve, uncrit, consume, advantage, disadvantage, ward, attackBonus, endCondition, reduce, miss, penalty, bonus, absorb, interpose, mark, save, breakConcentration)",
      "triggers[0].if : fait « moon.phase » inconnu"
    ]);
    expect(validateEntry({ triggers: [{ on: "isHit" }] }, { facts })).toEqual(["triggers[0].do : au moins une étape"]);
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", do: [{ type: "damage" }] }] }, { facts })).toEqual([
      "triggers[0].do[0].formula : formule requise", "triggers[0].do[0].damageType : type de dégâts requis"
    ]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use", target: "ally" }] }] }, { facts })[0]).toMatch(/target/);
    expect(validateEntry({ triggers: { on: "isHit", do: [{ type: "use" }] } }, { facts })).toEqual([]);   // une seule, sans liste
  });

  it("§36 : « bonus » — un dé ajouté par une réaction avant le jet d'attaque d'un allié", () => {
    const fortune = { on: "allyAttacks", do: [{ type: "use", activity: "nu3AqVu9lyqeFwr3" }, { type: "bonus", formula: "1d6" }] };
    expect(validateEntry({ triggers: [fortune] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ ...fortune, do: [fortune.do[0], { type: "bonus" }] }] }, { facts })).toEqual(["triggers[0].do[1].formula : formule requise"]);
    expect(validateEntry({ triggers: [{ on: "allyAttacks", do: [{ type: "bonus", formula: "1d6" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « bonus » demande le moment allyAttacks et une réaction « use »"]);
    expect(validateEntry({ triggers: [{ ...fortune, on: "enemyAttacks" }] }, { facts }))
      .toEqual(["triggers[0].do : « bonus » demande le moment allyAttacks et une réaction « use »"]);
  });

  it("§38 : `rollBonus` — l'activité et les jets concernés", () => {
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["save", "check"] } }, { facts })).toEqual([]);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["attack"] } }, { facts })).toEqual([]);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["check"], skills: ["ste"] } }, { facts })).toEqual([]);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["damage"] } }, { facts })).toEqual(["rollBonus : { activity, on: [save | check | attack | initiative], skills? }"]);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["check"], skills: [] } }, { facts })).toHaveLength(1);
  });

  it("§38 : « absorb » avec une réaction au moment allyIsDamaged, `use` sans consommation", () => {
    const ward = { on: "allyIsDamaged", do: [{ type: "use", activity: "THaODa86JJaeoWfL", consume: false }, { type: "absorb" }] };
    expect(validateEntry({ triggers: [ward] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ ...ward, on: "isDamaged" }] }, { facts }))
      .toEqual(["triggers[0].do : « absorb » demande le moment allyIsDamaged et une réaction « use »"]);
    expect(validateEntry({ triggers: [{ ...ward, do: [{ type: "use", consume: true }, { type: "absorb" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].consume : false ou absent"]);
  });

  it("§37 : `choice.pool` (effets d'item proposés par une activité) et `resave` { keep, onFail: dodge }", () => {
    expect(validateEntry({ choice: { effects: "one", pool: { PYFPZ4aLWjKJ1tLZ: ["m5aRx9iXnJi2WWPU", "pG5HdDpW8VELR1O3"] } } }, { facts })).toEqual([]);
    expect(validateEntry({ choice: { effects: "one", pool: { court: ["m5aRx9iXnJi2WWPU"] } } }, { facts }))
      .toEqual(["choice.pool : { <id d'activité> : [ids d'effets] } (16 caractères)"]);
    expect(validateEntry({ choice: { effects: "one", pool: { PYFPZ4aLWjKJ1tLZ: [] } } }, { facts })).toHaveLength(1);
    const resave = step => validateEntry({ triggers: [{ on: "startOfTurn", via: "effect", do: [step] }] }, { facts });
    expect(resave({ type: "resave", keep: true, onFail: "dodge" })).toEqual([]);
    expect(resave({ type: "resave", keep: false })).toEqual(["triggers[0].do[0].keep : true ou absent"]);
    expect(resave({ type: "resave", onFail: "flee" })).toEqual(["triggers[0].do[0].onFail : dodge"]);
  });

  it("aura : rayon positif, camp connu, id d'effet à 16 caractères, pas de clé inventée", () => {
    expect(validateEntry({ aura: { radius: -5, affects: "friends", effect: "abc", color: "red" } }, { facts })).toEqual([
      "aura.radius : nombre positif", "aura.affects : ally, enemy, any", "aura.effect : id d'effet (16 caractères)", "aura.color : clé inconnue"
    ]);
    expect(validateEntry({ aura: { radius: 10 } }, { facts })).toEqual([]);
  });

  it("onHit : un id d'activité", () => {
    expect(validateEntry({ onHit: { save: "abc" } }, { facts })).toEqual(["onHit.save : id d'activité (16 caractères)"]);
    expect(validateEntry({ onHit: "udF9lrpAQMvL0b9J" }, { facts })).toHaveLength(1);
  });

  it("choice : effets « one », question facultative, rien d'autre", () => {
    expect(validateEntry({ choice: { effects: "one" } }, { facts })).toEqual([]);
    expect(validateEntry({ choice: { effects: "one", prompt: "Laquelle ?" } }, { facts })).toEqual([]);
    expect(validateEntry({ choice: { effects: "all" } }, { facts })).toEqual(["choice.effects : one"]);
    expect(validateEntry({ choice: { effects: "one", prompt: 3, mode: "x" } }, { facts })).toEqual(["choice.prompt : chaîne", "choice.mode : clé inconnue"]);
    expect(validateEntry({ choice: "one" }, { facts })).toEqual(["choice : un objet"]);
  });

  it("targets (§16.8) : types connus, condition aux faits connus, rien d'autre", () => {
    expect(validateEntry({ targets: { types: ["humanoid"] } }, { facts })).toEqual([]);
    expect(validateEntry({ targets: { unaffectedIf: { "target.immuneTo": "exhaustion" } } }, { facts })).toEqual([]);
    expect(validateEntry({ targets: { types: ["elf"], unaffectedIf: { "moon.phase": 1 }, only: true } }, { facts })).toEqual([
      "targets.types : « elf » inconnu (aberration, beast, celestial, construct, dragon, elemental, fey, fiend, giant, humanoid, monstrosity, ooze, plant, undead)",
      "targets.unaffectedIf : fait « moon.phase » inconnu",
      "targets.only : clé inconnue"
    ]);
    expect(validateEntry({ targets: { types: [] } }, { facts })).toEqual(["targets.types : liste non vide de types de créature"]);
    expect(mergeEntries([{ targets: { types: ["humanoid"] } }, { targets: { unaffectedIf: true } }])).toEqual({ targets: { types: ["humanoid"], unaffectedIf: true } });
  });

  it("une table entière est validée entrée par entrée, préfixée par l'identifiant", () => {
    expect(validateTable({ hex: { triggers: [{ on: "nope", do: [{ type: "use" }] }] }, shield: { triggers: [{ on: "isHit", do: [{ type: "use" }] }] } }, { facts }))
      .toEqual([`hex.triggers[0].on : moment « nope » inconnu (${MOMENTS_LIST})`]);
    expect(validateTable([], { facts })).toHaveLength(1);
  });
});

describe("surcouche : module < monde < item", () => {
  const module = { triggers: [{ on: "isHit", do: [{ type: "use" }] }], aura: { radius: 10, units: "ft", affects: "ally" } };

  it("triggers est remplacé, aura et onHit sont fusionnés champ par champ", () => {
    const merged = mergeEntries([module, { aura: { radius: 30 } }, { triggers: [{ on: "isDamaged", do: [{ type: "use" }] }], onHit: { save: "udF9lrpAQMvL0b9J" } }]);
    expect(merged).toEqual({
      triggers: [{ on: "isDamaged", do: [{ type: "use" }] }],
      aura: { radius: 30, units: "ft", affects: "ally" },
      onHit: { save: "udF9lrpAQMvL0b9J" }
    });
  });

  it("une couche vide ou absente ne dit rien ; rien nulle part = null", () => {
    expect(mergeEntries([module, null, undefined, {}])).toEqual(module);
    expect(mergeEntries([null, {}])).toBe(null);
  });

  it("ne modifie pas les couches d'origine", () => {
    const frozen = JSON.stringify(module);
    mergeEntries([module, { aura: { radius: 30 } }]);
    expect(JSON.stringify(module)).toBe(frozen);
  });
});

describe("contenu livré", () => {
  it("est valide dans le schéma courant", () => {
    expect(CONTENT_VERSION).toBe(1);
    expect(validateTable(CONTENT, { facts })).toEqual([]);
  });

  it("réunit déclencheurs et auras par identifiant", () => {
    expect(Object.keys(CONTENT).sort()).toEqual([
      "abjure-foes", "absorb-elements", "action-surge", "adrenaline-rush", "agile", "alchemists-fire", "ambush",
      "animal-friendship", "animate-objects", "arcane-eye", "arcane-hand", "arcane-vigor", "arcane-ward", "armor-of-agathys",
      "arms-of-hadar", "assassinate", "aura-of-authority", "aura-of-bravery", "aura-of-courage", "aura-of-devotion",
      "aura-of-protection", "aura-of-vitality", "bait-and-switch", "banishing-smite", "beacon-of-hope", "beguiling-defenses",
      "bestow-curse", "bigbys-hand", "bite", "blade-ward", "blazing-movement", "blessed-healer", "blessed-strikes",
      "blinding-smite", "blindness-deafness", "boon-of-dimensional-travel", "brave", "breath-weapon", "bubble-dash",
      "bullseye-lantern", "call-lightning", "calm-emotions", "candle", "careful-spell", "cause-fear", "celestial-revelation",
      "channel-divinity", "channel-divinity-cleric", "charging-horn", "charm-monster", "charm-person", "chill-touch",
      "chromatic-orb", "circle-of-mortality", "cloud-of-daggers", "clouds-jaunt", "command", "commanders-strike",
      "commanding-presence", "confusion", "conjure-animals", "conjure-woodland-beings", "contagion", "continual-flame",
      "cordon-of-arrows", "corrosive-form", "cosmic-omen", "counterspell", "crown-of-madness", "cunning-action",
      "cunning-strike", "cutting-words", "dancing-lights", "dark-ones-blessing", "dark-ones-own-luck", "darkness",
      "daylight", "death-burst", "death-throes", "death-ward", "deathless-agility", "deflect-attacks",
      "delayed-blast-fireball", "devious-strikes", "dimension-door", "disarming-attack", "disciple-of-life", "dispel-magic",
      "distant-spell", "distracting-strike", "divine-fury", "divine-smite", "dominate-beast", "dominate-monster",
      "dominate-person", "draining-kiss", "dread-ambusher", "dreadful-strikes", "dwarven-resilience", "earthquake",
      "eldritch-blast", "eldritch-smite", "elemental-affinity", "elemental-fury", "elemental-weapon", "elixir-of-health",
      "elusive", "empowered-evocation", "energy-drain", "engulf", "enhance-ability", "enlarge-reduce", "ensnaring-strike",
      "entangle", "entangling-trail", "evards-black-tentacles", "evasion", "evasive-footwork", "eyebite", "faerie-fire",
      "fear", "fear-aura", "feinting-attack", "fell-word", "feral-strike", "fetid-aura", "fetid-cloud", "fey-ancestry",
      "find-familiar", "fire-aura", "fire-shield", "fires-burn", "flame-aura", "flame-blade", "flaming-sphere",
      "flask-of-holy-water", "flesh-to-stone", "flyby", "foe-slayer", "fog-cloud", "forbiddance", "forceful-hand",
      "frenzied-rush", "frenzy", "friends", "frosts-chill", "gaseous-form", "giant-insect", "gibbering", "goading-attack",
      "grasping-hand", "grease", "great-weapon-fighting", "great-weapon-master", "greater-portent", "guidance",
      "guiding-bolt", "gust-of-wind", "haste", "healers-kit", "heat-aura", "heat-metal", "heightened-spell",
      "hellish-rebuke", "heroic-warrior", "hex", "hideous-laughter", "hills-tumble", "hold-monster", "hold-person",
      "holy-aura", "holy-water", "hunger-of-hadar", "hunters-mark", "hunters-prey", "hypnotic-pattern", "ice-knife",
      "illusory-self", "improved-cunning-strike", "innate-sorcery", "instinctive-pounce", "invisibility", "invoke-duplicity",
      "lamp", "lantern-hooded", "large-form", "leading-evasion", "lesser-restoration", "life-drain", "lifedrinker", "light",
      "lunar-form", "lunging-attack", "mage-hand", "magic-missile", "magic-resistance", "maneuvering-attack",
      "marshal-undead", "martial-arts", "melfs-acid-arrow", "menacing-attack", "mind-sliver", "minor-illusion",
      "mirror-image", "mislead", "misty-step", "monks-focus", "moonbeam", "moonlight-step", "nimble-escape", "oil",
      "open-hand-technique", "ottos-irresistible-dance", "pack-tactics", "pact-of-the-blade", "parry", "parry-maneuver",
      "pass-without-trace", "path-to-the-grave", "persistent-rage", "phantasmal-force", "phantasmal-killer", "portent",
      "potent-cantrip", "potion-of-animal-friendship", "potion-of-climbing", "potion-of-diminution", "potion-of-flying",
      "potion-of-growth", "potion-of-heroism", "potion-of-invisibility", "potion-of-resistance", "potion-of-vitality",
      "prayer-of-healing", "precise-hunter", "precision-attack", "proboscis", "produce-flame", "projected-ward",
      "protection-from-energy", "protection-from-evil-and-good", "protection-from-poison", "prowl", "psychic-defenses",
      "pushing-attack", "quickened-spell", "radiant-soul", "rage", "raise-dead", "ray-of-enfeeblement", "ray-of-frost",
      "reckless-attack", "regeneration", "relentless-endurance", "relentless-rage", "resistance", "resurrection", "revivify",
      "riposte", "rumbling-movement", "sanctuary", "sanguine-drain", "scorching-ray", "sculpt-spells", "sear-undead",
      "searing-smite", "sentinel-at-deaths-door", "shadow-stealth", "shadowy-dodge", "shield", "shillelagh", "shining-smite",
      "shocking-grasp", "sickening-vapors", "silence", "slam", "sleep", "sleet-storm", "slow", "smelting-charge",
      "sneak-attack", "spare-the-dying", "spell-resistance", "spike-growth", "spirit-guardians", "spirit-shroud",
      "spiritual-weapon", "staggering-smite", "starry-wisp", "steady-aim", "stench", "stinking-cloud", "stomp",
      "stones-endurance", "storm-of-vengeance", "stormborn", "storms-thunder", "studied-attacks", "stunning-strike",
      "subtle-spell", "suggestion", "summon-aberration", "summon-beast", "summon-celestial", "summon-construct",
      "summon-dragon", "summon-elemental", "summon-fey", "summon-fiend", "summon-undead", "sunburst", "supreme-healing",
      "swallow", "sweeping-attack", "swoop", "symbol", "tactical-assessment", "tactical-charge", "tactical-shift",
      "tashas-hideous-laughter", "telekinetic", "thorn-whip", "thrown-weapon-fighting", "thunderous-smite", "thunderwave",
      "tinderbox", "toll-the-dead", "torch", "trampling-charge", "tricksters-transposition", "trip-attack",
      "true-resurrection", "true-strike", "tsunami", "umbral-dagger", "unarmed-strike", "uncanny-dodge", "undead-fortitude",
      "vampiric-bite", "vicious-mockery", "vile-appearance", "vitriolic-sphere", "vow-of-enmity", "wall-of-fire",
      "wall-of-thorns", "war-caster", "war-priest", "warding-bond", "warding-flare", "watery-rush", "web", "weird",
      "wild-companion", "wild-resurgence", "witch-bolt", "wrath-of-the-sea", "wrathful-smite", "yolandes-regal-presence"
    ]);
    expect(CONTENT["aura-of-protection"].aura.radius).toBe(10);
    expect(CONTENT.hex.triggers).toHaveLength(1);
  });
});

/*
 * Contenu d'un autre module (api.content.register / hook dnd5e-combat.registerContent, runtime/content.mjs). Exemple
 * synthétique : un module de campagne qui déclare ses créatures (cercle à PV partagés, seconde phase, dernier rempart) et
 * corrige une entrée livrée. Les tables réelles vivent dans leurs modules (privés) ; le moteur ne les connaît pas.
 */
describe("contenu enregistré par un autre module", () => {
  const TABLE = {
    "exemple-cercle": { sharedHp: true },
    "exemple-seconde-phase": { secondPhase: { activity: "phase2Transform0", keepConditions: false } },
    "exemple-dernier-rempart": { triggers: [{ on: "isDamaged", if: { "target.hpAtMost": 50 }, do: [{ type: "use" }] }], lastStand: { threshold: 50 } },
    "exemple-riposte": { triggers: [{ on: "isMissed", if: { "activity.isMelee": true }, do: [{ type: "use", target: "source", advantage: true }] }] },
    "aura-of-protection": { aura: { radius: 30 } }
  };

  it("se valide dans le même schéma que le contenu livré", () => {
    expect(validateTable(TABLE, { facts })).toEqual([]);
  });

  it("fusionne par-dessus le contenu livré, puis se retire sans trace", () => {
    const before = JSON.stringify(CONTENT);
    expect(registerTable("module-exemple", TABLE)).toEqual(Object.keys(TABLE));
    expect(registeredTables()).toEqual({ "module-exemple": Object.keys(TABLE) });
    expect(CONTENT["exemple-cercle"]).toEqual({ sharedHp: true });
    expect(CONTENT["exemple-seconde-phase"].secondPhase).toEqual({ activity: "phase2Transform0", keepConditions: false });
    // Une entrée livrée est corrigée champ par champ (mergeEntries), pas remplacée.
    expect(CONTENT["aura-of-protection"].aura).toEqual({ ...SHIPPED["aura-of-protection"].aura, radius: 30 });
    expect(SHIPPED["aura-of-protection"].aura.radius).toBe(10);
    expect(SHIPPED["exemple-cercle"]).toBeUndefined();
    expect(validateTable(CONTENT, { facts })).toEqual([]);
    // Réenregistrer la même source remplace sa table.
    registerTable("module-exemple", { "exemple-cercle": { sharedHp: true } });
    expect(CONTENT["exemple-seconde-phase"]).toBeUndefined();
    expect(unregisterTable("module-exemple")).toBe(true);
    expect(registeredTables()).toEqual({});
    expect(JSON.stringify(CONTENT)).toBe(before);
  });

  it("deux modules s'empilent dans l'ordre d'enregistrement", () => {
    registerTable("premier", { "exemple-riposte": TABLE["exemple-riposte"] });
    registerTable("second", { "exemple-riposte": { triggers: [{ on: "isHit", do: [{ type: "use" }] }] } });
    expect(CONTENT["exemple-riposte"].triggers[0].on).toBe("isHit");
    unregisterTable("second");
    expect(CONTENT["exemple-riposte"].triggers[0].on).toBe("isMissed");
    unregisterTable("premier");
    expect(CONTENT["exemple-riposte"]).toBeUndefined();
  });
});

describe("briques (SPEC §16) : étapes d'issue, sœur rejouée, sauvegarde répétée", () => {
  it("move : mode, distance positive, unité — et seulement à une issue", () => {
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "move", mode: "pull", distance: 10, units: "ft" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "move", mode: "throw", distance: 0, units: 5 }] }] }, { facts })).toEqual([
      "triggers[0].do[0].mode : push, pull", "triggers[0].do[0].distance : nombre positif ou formule", "triggers[0].do[0].units : unité requise"
    ]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « move » demande un moment d'issue (hit, failedSave)"]);
  });

  it("status : un état, à une issue", () => {
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "status", status: "prone" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "status" }] }] }, { facts })).toEqual(["triggers[0].do[0].status : état requis"]);
    expect(validateEntry({ triggers: [{ on: "enter", do: [{ type: "status", status: "prone" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « status » demande un moment d'issue (hit, failedSave)"]);
  });

  it("replay : une sœur par id d'activité", () => {
    expect(validateEntry({ triggers: [{ on: "turnStart", do: [{ type: "replay", activity: "dnd5eactivity000" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "turnStart", do: [{ type: "replay", activity: "abc" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].activity : id d'activité (16 caractères) attendu"]);
  });

  it("resave : au tour de la créature, porté par l'effet", () => {
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", do: [{ type: "resave" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « resave » demande des moments parmi startOfTurn, endOfTurn, isDamaged et via: \"effect\""]);
    expect(validateEntry({ triggers: [{ on: "turnEnd", via: "effect", do: [{ type: "resave" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « resave » demande des moments parmi startOfTurn, endOfTurn, isDamaged et via: \"effect\""]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "bearer", do: [{ type: "resave" }] }] }, { facts })[0]).toBe("triggers[0].via : effect");
    // Domination, Fou rire : la sauvegarde se rejoue aussi quand la créature subit des dégâts.
    expect(validateEntry({ triggers: [{ on: ["endOfTurn", "isDamaged"], via: "effect", do: [{ type: "resave" }] }] }, { facts })).toEqual([]);
  });

  it("riposte (B9) : dégâts à l'attaquant, au seul moment isHit — formule et type, ou activité", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", via: "effect", fromEffect: "YbUr13GTnMrootmf", if: { "activity.isMelee": true },
      do: [{ type: "damage", to: "source", formula: "2d8", damageType: "fire" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "damage", to: "source", activity: "OzlTY1z1gup4C2Qq" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "damage", to: "source" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].formula : formule requise", "triggers[0].do[0].damageType : type de dégâts requis"]);
    expect(validateEntry({ triggers: [{ on: ["isHit", "isDamaged"], do: [{ type: "damage", to: "source", formula: "1d8", damageType: "acid" }] }] }, { facts }))
      .toEqual(["triggers[0].do : une riposte (to: \"source\") demande le seul moment isHit"]);
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", do: [{ type: "damage", to: "self", activity: "OzlTY1z1gup4C2Qq", formula: "1", damageType: "fire" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].to : source, origin, bearer", "triggers[0].do[0].activity : seulement pour une riposte (to: \"source\") ou le porteur (to: \"bearer\")"]);
  });

  it("§19 : dégâts d'issue (moitié sur réussite) et dégâts du porteur à son tour", () => {
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "damage", formula: "2d4", damageType: "necrotic", onSave: "half" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "damage", formula: "2d8", damageType: "necrotic" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "damage", formula: "2d8", damageType: "necrotic", onSave: "half" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « onSave » demande le seul moment failedSave, sans « to »"]);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "damage", formula: "2d4", damageType: "necrotic", onSave: "all" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].onSave : half, none"]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "NgglkyjzTbDh5Loa",
      do: [{ type: "damage", to: "bearer", activity: "uAyE5DrJp0YpElcw" }, { type: "remove" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "damage", to: "bearer", formula: "2d8", damageType: "psychic" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "bearer", formula: "2d8", damageType: "psychic" }] }] }, { facts }))
      .toEqual(["triggers[0].do : les dégâts du porteur (to: \"bearer\") demandent des moments parmi startOfTurn, endOfTurn et via: \"effect\""]);
  });

  it("§19 : savedEffects (ids) et ignoresCloseCombat (true)", () => {
    expect(validateEntry({ savedEffects: ["yril8uhQgO1dR507"], ignoresCloseCombat: true }, { facts })).toEqual([]);
    expect(validateEntry({ savedEffects: ["court"], ignoresCloseCombat: "oui" }, { facts }))
      .toEqual(["savedEffects : liste d'ids d'effets (16 caractères)", "ignoresCloseCombat : true ou absent"]);
    expect(mergeEntries([{ savedEffects: ["yril8uhQgO1dR507"] }, { ignoresCloseCombat: true }]))
      .toEqual({ savedEffects: ["yril8uhQgO1dR507"], ignoresCloseCombat: true });
  });

  it("zone déplaçable (B18) : distance positive, unité", () => {
    expect(validateEntry({ movable: { distance: 60, units: "ft" } }, { facts })).toEqual([]);
    expect(validateEntry({ movable: { distance: 0, units: "", speed: 1 } }, { facts }))
      .toEqual(["movable.distance : nombre positif", "movable.units : unité requise", "movable.speed : clé inconnue"]);
  });

  it("invocation (B12) : initiative « after » ou « own », rien d'autre", () => {
    expect(validateEntry({ summon: { initiative: "after" } }, { facts })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "first", count: 2 } }, { facts })).toEqual(["summon.initiative : « after », « own » ou « none »"]);
    expect(validateEntry({ summon: { initiative: "own", count: 2 } }, { facts })).toEqual(["summon.count : clé inconnue"]);
  });

  it("marque consommée (B10) : un côté, au moment preAttackRoll, portée par un effet", () => {
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", via: "effect", do: [{ type: "advantage" }, { type: "consume", side: "target" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", do: [{ type: "consume", side: "both" }] }] }, { facts })).toEqual([
      "triggers[0].do[0].side : « target » ou « source »",
      "triggers[0].do : « consume » demande le moment preAttackRoll et via: \"effect\""
    ]);
  });

  it("réduction (B14) : halve avec une réaction à isHit ; partage vers l'origine ; réserve", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "halve" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "halve" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « halve » demande le moment isHit ou allyIsHit et une réaction « use »"]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "origin" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "damage", to: "origin" }] }] }, { facts }))
      .toEqual(["triggers[0].do : un partage (to: \"origin\") demande le seul moment isDamaged et via: \"effect\""]);
    expect(validateEntry({ absorb: { activeAfter: "Hha69hPMTYWhDE4A", recharge: { school: "abj", perLevel: 2 } } }, { facts })).toEqual([]);
    expect(validateEntry({ absorb: { activeAfter: "x", recharge: { school: "abj", perLevel: 0 }, max: 3 } }, { facts })).toEqual([
      "absorb.activeAfter : id d'activité (16 caractères) attendu", "absorb.recharge.perLevel : nombre positif", "absorb.max : clé inconnue"
    ]);
  });

  it("teleport (B11) : distance positive, unité, activité facultative", () => {
    expect(validateEntry({ teleport: { distance: 30, units: "ft" } }, { facts })).toEqual([]);
    expect(validateEntry({ teleport: { distance: 0, units: "", activity: "x", range: 1 } }, { facts })).toEqual([
      "teleport.distance : nombre positif", "teleport.units : unité requise", "teleport.activity : id d'activité (16 caractères) attendu", "teleport.range : clé inconnue"
    ]);
  });

  it("fromEffect : un id d'effet, avec via: \"effect\" ; trace : true", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", fromEffect: "abc", do: [{ type: "use" }] }] }, { facts }))
      .toEqual(["triggers[0].fromEffect : id d'effet (16 caractères)", "triggers[0].fromEffect : demande via: \"effect\""]);
    expect(validateEntry({ trace: true }, { facts })).toEqual([]);
    expect(validateEntry({ trace: "oui" }, { facts })).toEqual(["trace : true ou { activity?, show?, attack? }"]);
    expect(mergeEntries([{ trace: true }, { aura: { radius: 5 } }])).toEqual({ trace: true, aura: { radius: 5 } });
  });

  it("remove (B8) : l'effet cesse à un moment du porteur, porté par l'effet", () => {
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "remove" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « remove » demande des moments du porteur (startOfTurn, endOfTurn, isAttacked, isDamaged, isHit) et via: \"effect\""]);
    expect(validateEntry({ triggers: [{ on: ["isDamaged", "hit"], via: "effect", do: [{ type: "remove" }] }] }, { facts })[0]).toMatch(/« remove »/);
  });

  it("advantage / disadvantage : seulement avant un jet d'attaque", () => {
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", if: { "source.allyNearTarget": { distance: 5, units: "ft" } }, do: [{ type: "advantage" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", via: "effect", do: [{ type: "disadvantage" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "advantage" }] }] }, { facts })).toEqual(["triggers[0].do : « advantage » demande le moment preAttackRoll"]);
  });

  it("ward : au moment isAttacked, porté par l'effet, activité sœur facultative", () => {
    expect(validateEntry({ triggers: [{ on: "isAttacked", via: "effect", do: [{ type: "ward" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isAttacked", via: "effect", do: [{ type: "ward", activity: "6TdVnZPI3lxQrycI" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isAttacked", via: "effect", do: [{ type: "ward", activity: "x" }] }] }, { facts })).toEqual(["triggers[0].do[0].activity : id d'activité (16 caractères) attendu"]);
    expect(validateEntry({ triggers: [{ on: "isAttacked", do: [{ type: "ward" }] }] }, { facts })).toEqual(["triggers[0].do : « ward » demande le moment isAttacked et via: \"effect\""]);
    expect(validateEntry({ triggers: [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", target: "source" }] }] }, { facts })).toEqual([]);
  });

  it("le contenu livré emploie chaque brique au moins une fois", () => {
    expect(CONTENT["thunderwave"].triggers[0].do[0]).toEqual({ type: "move", mode: "push", distance: 10, units: "ft" });
    expect(CONTENT["thorn-whip"].triggers[0]).toMatchObject({ on: "hit", if: { "target.sizeAtMost": "lg" } });
    expect(CONTENT["stinking-cloud"].triggers[0].do[0].activity).toBe("dnd5eactivity000");
    expect(CONTENT["sleet-storm"].triggers.map(t => t.do[0].type)).toEqual(["replay", "status"]);
    expect(CONTENT["hold-person"].triggers[0]).toMatchObject({ on: "endOfTurn", via: "effect" });
    expect(CONTENT["great-weapon-master"].triggers[0].do[0].damageType).toBe("weapon");
    expect(CONTENT["faerie-fire"].triggers[0]).toMatchObject({ on: "preAttackRoll", via: "effect" });
    expect(CONTENT["pack-tactics"].triggers[0].do[0].type).toBe("advantage");
    expect(CONTENT["protection-from-evil-and-good"].triggers[0].do[0].type).toBe("disadvantage");
    expect(CONTENT["counterspell"].triggers[0]).toMatchObject({ on: "castsSpell", do: [{ type: "use", target: "source" }] });
    expect(CONTENT["sanctuary"].triggers[0]).toMatchObject({ on: "isAttacked", via: "effect", do: [{ type: "ward", activity: "6TdVnZPI3lxQrycI" }] });
  });
});

describe("surcouche : choice", () => {
  it("est fusionné champ par champ, comme aura et onHit", () => {
    const merged = mergeEntries([{ choice: { effects: "one" } }, { choice: { prompt: "Laquelle ?" } }]);
    expect(merged).toEqual({ choice: { effects: "one", prompt: "Laquelle ?" } });
  });

  it("le contenu livré déclare Maléfice à effets exclusifs, et reste valide", () => {
    expect(CONTENT.hex.choice).toEqual({ effects: "one" });
    expect(validateTable(CONTENT, { facts })).toEqual([]);
  });
});

describe("éclat (§16.19) : schéma", () => {
  it("activité, rayon, unité", () => {
    expect(validateEntry({ burst: { activity: "dnd5eactivity100", radius: 5, units: "ft" } }, { facts })).toEqual([]);
    expect(validateEntry({ burst: { activity: "x", radius: -1, units: "", around: 1 } }, { facts })).toEqual([
      "burst.activity : id d'activité (16 caractères) attendu", "burst.radius : nombre positif ou nul", "burst.units : unité requise", "burst.around : clé inconnue"
    ]);
  });
});

describe("relance, éclat après dégâts, début de tour (§16.21) : schéma", () => {
  it("recast, burst.from, atTurnStart", () => {
    expect(validateEntry({ recast: true, atTurnStart: { activity: "0vYjMbBcXaMfGWR2" }, burst: { activity: "dnd5eactivity000", radius: 0, units: "ft", from: ["YPEmwJHX7g68307N"] } }, { facts })).toEqual([]);
    expect(validateEntry({ recast: 1, atTurnStart: { activity: "x" }, burst: { activity: "dnd5eactivity000", radius: 0, units: "ft", from: [] } }, { facts })).toEqual([
      "burst.from : liste d'ids d'activité", "recast : true ou absent", "atTurnStart.activity : id d'activité (16 caractères) attendu"
    ]);
  });
});

describe("brume et soins au maximum (§16.24) : schéma", () => {
  it("obscures, healMax", () => {
    expect(validateEntry({ obscures: true, healMax: true }, { facts })).toEqual([]);
    expect(validateEntry({ obscures: 1, healMax: "oui" }, { facts })).toEqual(["obscures : true ou absent", "healMax : true ou absent"]);
  });
});

describe("capacités des PJ (§16.25) : schéma", () => {
  it("duplicates, saveAdvantage, onFell", () => {
    expect(validateEntry({ duplicates: true, saveAdvantage: ["charmed"], onFell: { activity: "p3YSnjGDlLIbiLpC", radius: 10, units: "ft" } }, { facts })).toEqual([]);
    expect(validateEntry({ duplicates: 3, saveAdvantage: [], onFell: { radius: -1, units: "", extra: 1 } }, { facts })).toEqual(["duplicates : true ou absent",
      "saveAdvantage : liste d'identifiants d'état", "onFell.radius : nombre positif ou nul", "onFell.units : unité requise",
      "onFell.extra : clé inconnue"]);
  });
});

describe("Taille (§16.26) : schéma", () => {
  it("bonusAttack", () => {
    expect(validateEntry({ bonusAttack: { after: ["critical", "felled"], melee: true } }, { facts })).toEqual([]);
    expect(validateEntry({ bonusAttack: { after: ["hit"] } }, { facts })).toEqual(["bonusAttack.after : liste parmi critical, felled"]);
    expect(validateEntry({ bonusAttack: { after: ["critical"], melee: 1, extra: 2 } }, { facts })).toEqual(["bonusAttack.melee : booléen", "bonusAttack.extra : clé inconnue"]);
    expect(CONTENT["great-weapon-master"].bonusAttack).toEqual({ after: ["critical", "felled"], melee: true });
  });
});

describe("projectiles (§16.27) : schéma", () => {
  it("projectiles", () => {
    expect(validateEntry({ projectiles: { count: "2 + @item.level", attack: false } }, { facts })).toEqual([]);
    expect(validateEntry({ projectiles: { count: "" } }, { facts })).toEqual(["projectiles.count : formule attendue"]);
    expect(validateEntry({ projectiles: { count: "3", attack: "oui", extra: 1 } }, { facts })).toEqual(["projectiles.attack : booléen", "projectiles.extra : clé inconnue"]);
    expect(CONTENT["scorching-ray"].projectiles).toEqual({ count: "@item.level + 1", attack: true });
  });
});

describe("rebond (§16.27) : schéma", () => {
  it("leap", () => {
    expect(validateEntry({ leap: { radius: 30, units: "ft", max: "@item.level" } }, { facts })).toEqual([]);
    expect(validateEntry({ leap: { radius: 30, units: "ft" } }, { facts })).toEqual(["leap : { radius, units, max }"]);
    expect(CONTENT["chromatic-orb"].leap).toEqual({ radius: 30, units: "ft", max: "@item.level" });
  });
});

describe("fusion des couches", () => {
  it("garde toutes les clés du schéma que porte le contenu livré", () => {
    for ( const [id, entry] of Object.entries(CONTENT) ) {
      const merged = mergeEntries([entry]);
      for ( const key of Object.keys(entry) ) expect(merged, `${id}.${key}`).toHaveProperty(key);
    }
  });
});

describe("§19.5 : cercles", () => {
  it("sharedHp (true) et secondPhase ({ activity })", () => {
    expect(validateEntry({ sharedHp: true, secondPhase: { activity: "phase2Transform0" } }, { facts })).toEqual([]);
    expect(validateEntry({ sharedHp: 1, secondPhase: { activity: "x", form: "y" } }, { facts }))
      .toEqual(["secondPhase.activity : id d'activité (16 caractères) attendu", "sharedHp : true ou absent"]);
    expect(validateEntry({ secondPhase: { activity: "phase2Transform0", form: "y" } }, { facts })).toEqual(["secondPhase.form : clé inconnue"]);
  });
});

describe("§19.9 : Dhampir et Domaine de la Tombe", () => {
  it("empower ({ damageType, effect, excludeTypes? })", () => {
    expect(validateEntry({ empower: { damageType: "piercing", effect: "j3fPDd7Xi1nx6Xk4", excludeTypes: ["construct", "undead"] } }, { facts })).toEqual([]);
    expect(validateEntry({ empower: { damageType: "", effect: "x", excludeTypes: ["robot"], mode: "heal" } }, { facts })).toEqual([
      "empower.damageType : type de dégâts requis",
      "empower.effect : id d'effet (16 caractères)",
      expect.stringMatching(/^empower\.excludeTypes : types de créature/),
      "empower.mode : clé inconnue"
    ]);
  });

  it("discharge ({ effect, formula, damageTypes, sees? }) et healsDownedMax", () => {
    const ok = { effect: "mQRlujPiGJbczcyZ", formula: "@classes.cleric.levels", damageTypes: ["necrotic", "radiant"], sees: true };
    expect(validateEntry({ discharge: ok, healsDownedMax: true }, { facts })).toEqual([]);
    expect(validateEntry({ discharge: { ...ok, damageTypes: [], sees: 1 }, healsDownedMax: "oui" }, { facts })).toEqual([
      "discharge.damageTypes : liste de types de dégâts", "discharge.sees : true ou absent", "healsDownedMax : true ou absent"
    ]);
  });

  it("oncePerTurn : seulement sur preDamageRoll ; uncrit : avec une réaction à isHit ou allyIsHit", () => {
    const part = [{ type: "damage", formula: "1d4", damageType: "necrotic" }];
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", oncePerTurn: true, do: part }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "hit", oncePerTurn: true, do: [{ type: "status", status: "prone" }] }] }, { facts }))
      .toEqual(["triggers[0].oncePerTurn : true, avec le seul moment preDamageRoll"]);
    expect(validateEntry({ triggers: [{ on: "allyIsHit", if: { "target.bloodied": true }, do: [{ type: "use" }, { type: "halve" }, { type: "uncrit" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "use" }, { type: "uncrit" }] }] }, { facts }))
      .toEqual(["triggers[0].do : « uncrit » demande le moment isHit ou allyIsHit et une réaction « use »"]);
  });

  it("le contenu livré porte les quatre capacités", () => {
    expect(CONTENT["vampiric-bite"].empower.effect).toBe("j3fPDd7Xi1nx6Xk4");
    expect(CONTENT["circle-of-mortality"].triggers).toHaveLength(2);
    expect(CONTENT["circle-of-mortality"].healsDownedMax).toBe(true);
    expect(CONTENT["path-to-the-grave"].discharge.damageTypes).toEqual(["necrotic", "radiant"]);
    expect(CONTENT["sentinel-at-deaths-door"].triggers.map(t => t.on)).toEqual(["isHit", "allyIsHit"]);
  });
});

describe("§67 : une réaction qui rejoint d'abord sa source (use … approach)", () => {
  it("approach : true, avec target source", () => {
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "use", target: "source", approach: true }] }] })).toEqual([]);
  });
  it("sans target source, ou autre valeur : refusé", () => {
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "use", approach: true }] }] }).length).toBeGreaterThan(0);
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "use", target: "source", approach: "oui" }] }] }).length).toBeGreaterThan(0);
  });
});

describe("§67 quater : une activité à l'arrivée d'une téléportation (teleport.then)", () => {
  it("then : un id d'activité", () => {
    expect(validateEntry({ teleport: { distance: 15, units: "ft", activity: "abcdefghijklmnop", then: "ponmlkjihgfedcba" } })).toEqual([]);
    expect(validateEntry({ teleport: { distance: 15, units: "ft", then: "court" } })).toEqual([expect.stringContaining("then")]);
  });
});

describe("§69 : terrain difficile d'une zone (difficultTerrain)", () => {
  it("un objet, types optionnels", () => {
    expect(validateEntry({ difficultTerrain: { types: ["plants"] } })).toEqual([]);
    expect(validateEntry({ difficultTerrain: {} })).toEqual([]);
    expect(validateEntry({ difficultTerrain: true })).toEqual([expect.stringContaining("difficultTerrain")]);
    expect(validateEntry({ difficultTerrain: { types: "plants" } })).toEqual([expect.stringContaining("types")]);
  });
});

describe("§69 : la fusion garde difficultTerrain", () => {
  it("mergeEntries", () => {
    expect(mergeEntries([null, { difficultTerrain: { types: ["plants"] } }]).difficultTerrain).toEqual({ types: ["plants"] });
  });
});

describe("§70 : orage (storm)", () => {
  it("un objet, bonus en dés", () => {
    expect(validateEntry({ storm: { bonus: "1d10" } })).toEqual([]);
    expect(validateEntry({ storm: {} })).toEqual([]);
    expect(validateEntry({ storm: { bonus: "beaucoup" } })).toEqual([expect.stringContaining("bonus")]);
    expect(mergeEntries([null, { storm: { bonus: "1d10" } }]).storm).toEqual({ bonus: "1d10" });
  });
});

describe("§71 : stabilisée à 0 PV, effets sous condition", () => {
  it("stableAtZero : true ; effectsIf : une condition", () => {
    expect(validateEntry({ stableAtZero: true, effectsIf: { "target.atZero": true } }, { facts: { "target.atZero": () => true } })).toEqual([]);
    expect(validateEntry({ stableAtZero: "oui" })).toEqual([expect.stringContaining("stableAtZero")]);
    expect(validateEntry({ effectsIf: "target.atZero" })).toEqual([expect.stringContaining("effectsIf")]);
    const merged = mergeEntries([null, { stableAtZero: true, effectsIf: { "target.atZero": true } }]);
    expect(merged.stableAtZero).toBe(true);
    expect(merged.effectsIf).toEqual({ "target.atZero": true });
  });
});

describe("§72 : sneakAttack en objet", () => {
  it("dés, toute arme, types", () => {
    expect(validateEntry({ sneakAttack: true })).toEqual([]);
    expect(validateEntry({ sneakAttack: { dice: "5d6", anyWeapon: true, alwaysVs: ["undead"] } })).toEqual([]);
    expect(validateEntry({ sneakAttack: { dice: "beaucoup" } })).toEqual([expect.stringContaining("dice")]);
    expect(validateEntry({ sneakAttack: "oui" })).toEqual([expect.stringContaining("sneakAttack")]);
  });
});

describe("§72 : contest", () => {
  it("compétence, compétences opposées, effet", () => {
    expect(validateEntry({ contest: { activity: "zqYhGCNNd41uNShS", skill: "ins", against: ["dec"], effect: "abcdefghijklmnop", exclusive: true } })).toEqual([]);
    expect(validateEntry({ contest: { skill: "insight", against: [], effect: "x" } }).length).toBe(3);
    expect(mergeEntries([null, { contest: { skill: "ins", against: ["dec"], effect: "abcdefghijklmnop" } }]).contest.skill).toBe("ins");
  });
});

describe("§72 : use sur soi", () => {
  it("target: self", () => {
    expect(validateEntry({ triggers: [{ on: "isAttacked", do: [{ type: "use", target: "self", activity: "abcdefghijklmnop" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isAttacked", do: [{ type: "use", target: "ally" }] }] })).toEqual([expect.stringContaining("self")]);
  });
});

describe("§73 : wardsAtZero", () => {
  it("true ou absent, fusionné", () => {
    expect(validateEntry({ wardsAtZero: true })).toEqual([]);
    expect(validateEntry({ wardsAtZero: 1 })).toEqual([expect.stringContaining("wardsAtZero")]);
    expect(mergeEntries([null, { wardsAtZero: true }]).wardsAtZero).toBe(true);
  });
});

describe("§74 : dégâts qui dépensent un effet", () => {
  it("spends : un id d'effet", () => {
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", do: [{ type: "damage", formula: "1d8", damageType: "force", spends: "abcdefghijklmnop" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", do: [{ type: "damage", formula: "1d8", damageType: "force", spends: "x" }] }] })).toEqual([expect.stringContaining("spends")]);
  });
});

describe("§75 : zoneCharges", () => {
  it("entier positif, fusionné", () => {
    expect(validateEntry({ zoneCharges: 4 })).toEqual([]);
    expect(validateEntry({ zoneCharges: 0 })).toEqual([expect.stringContaining("zoneCharges")]);
    expect(mergeEntries([null, { zoneCharges: 4 }]).zoneCharges).toBe(4);
  });
});

describe("§76 : changesForm", () => {
  it("id d'activité, clés connues, fusionné", () => {
    expect(validateEntry({ changesForm: { activity: "aaaaaaaaaaaaaaaa" } })).toEqual([]);
    expect(validateEntry({ changesForm: { activity: "court" } })).toEqual([expect.stringContaining("changesForm.activity")]);
    expect(validateEntry({ changesForm: { activity: "aaaaaaaaaaaaaaaa", quand: 1 } })).toEqual([expect.stringContaining("clé inconnue")]);
    expect(mergeEntries([null, { changesForm: { activity: "aaaaaaaaaaaaaaaa" } }]).changesForm.activity).toBe("aaaaaaaaaaaaaaaa");
  });
});

describe("§78 : forme qui garde ses PV, faveur avec sauvegarde, interposition", () => {
  const A = "aaaaaaaaaaaaaaaa";
  it("keepHp dans changesForm et secondPhase", () => {
    expect(validateEntry({ changesForm: { activity: A, keepHp: true } })).toEqual([]);
    expect(validateEntry({ secondPhase: { activity: A, keepHp: true } })).toEqual([]);
    expect(validateEntry({ changesForm: { activity: A, keepHp: 1 } })).toEqual([expect.stringContaining("keepHp")]);
  });
  it("hitRider : save (id d'activité) et item (identifiant)", () => {
    expect(validateEntry({ hitRider: { damage: A, save: A, item: "shortsword", oncePerTurn: true } })).toEqual([]);
    expect(validateEntry({ hitRider: { damage: A, save: "court" } })).toEqual([expect.stringContaining("hitRider")]);
  });
  it("interpose : au moment allyIsDamaged, avec une réaction use", () => {
    expect(validateEntry({ triggers: [{ on: "allyIsDamaged", do: [{ type: "use" }, { type: "interpose" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "interpose" }] }] })).toEqual([expect.stringContaining("interpose")]);
  });
});
