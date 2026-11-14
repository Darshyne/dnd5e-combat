import { describe, it, expect } from "vitest";
import { validateEntry, validateTable, validateSources, mergeEntries, CONTENT_VERSION } from "../module/scripts/core/content.mjs";
import { CONTENT, SHIPPED, SOURCES, registerTable, unregisterTable, registeredTables, registerSources, registeredSources } from "../module/scripts/content/index.mjs";
import { effectHolds } from "../module/scripts/core/feats.mjs";

const facts = Object.fromEntries(["activity.type", "activity.isAttack", "activity.isSpell", "activity.isWeapon", "activity.weaponKind", "activity.identifier", "activity.id",
  "activity.hasProperty", "source.hasStatus", "source.hasEffect", "source.creatureType", "source.allyNearTarget", "source.summonNearTarget", "source.seesTarget",
  "target.hasStatus", "target.hasMark", "target.hasEffect", "target.hasEffectFrom", "hit.stoppableBy", "hit.critical", "damage.resisted", "target.grappledBySource", "target.wieldsProperty", "target.isSelf", "self.hasShield", "self.wieldsWeapon", "target.hasFeature", "activity.ability", "target.sizeAtMost", "target.within", "target.seesSource", "target.creatureType", "target.immuneTo", "activity.isMelee", "target.hasTempHp", "target.atZero", "target.isDead", "damage.hasType", "target.hpAtMost", "condition.gained",
  "target.wounded", "target.bloodied", "source.classLevelAtLeast", "target.nearSelf", "self.seesTarget", "target.hasNotActed", "source.onOwnTurn", "activity.dealsType", "source.hasFeature", "source.hasClassFeature", "activity.cantripOf", "activity.school", "activity.enchantedBy", "source.wildShaped", "activity.classSpell", "source.resists", "source.nearSelf", "self.seesSource", "source.hasEffectFromTarget", "source.hasSense", "target.allied"].map(k => [k, true]));
const MOMENTS_LIST = "isHit, isDamaged, leavesReach, enemyDisengages, enter, turnStart, turnEnd, moves, preDamageRoll, hit, failedSave, savedSave, startOfTurn, endOfTurn, originTurnStart, preAttackRoll, castsSpell, isMissed, enemyTurnEnd, isTargeted, isAttacked, enemyAttacks, allyAttacks, gainsCondition, allyIsHit, allyIsDamaged, enemyAttacked, falls, allyFalls";

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
    expect(validateEntry({ reaction: { window: "isHit" } }, { facts })[0]).toMatch(/reaction: unknown key/);
  });

  it("déclencheur : moment, étape, fait — chacun contrôlé", () => {
    const errors = validateEntry({ triggers: [{ on: "onHit", if: { "moon.phase": "full" }, do: [{ type: "smite" }] }] }, { facts });
    expect(errors).toEqual([
      `triggers[0].on: unknown moment "onHit" (${MOMENTS_LIST})`,
      "triggers[0].do[0].type: unknown \"smite\" (lift, disarm, use, replay, damage, move, status, resave, remove, halve, uncrit, consume, advantage, disadvantage, ward, attackBonus, endCondition, reduce, miss, penalty, bonus, absorb, interpose, mark, save, breakConcentration, cancel, intercept, redirect, banish, revertForm)",
      "triggers[0].if: unknown fact \"moon.phase\""
    ]);
    expect(validateEntry({ triggers: [{ on: "isHit" }] }, { facts })).toEqual(["triggers[0].do: at least one step"]);
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", do: [{ type: "damage" }] }] }, { facts })).toEqual([
      "triggers[0].do[0].formula: formula required", "triggers[0].do[0].damageType: damage type required"
    ]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use", target: "ally" }] }] }, { facts })[0]).toMatch(/target/);
    expect(validateEntry({ triggers: { on: "isHit", do: [{ type: "use" }] } }, { facts })).toEqual([]);   // une seule, sans liste
  });

  it("§36 : « bonus » — un dé ajouté par une réaction avant le jet d'attaque d'un allié", () => {
    const fortune = { on: "allyAttacks", do: [{ type: "use", activity: "nu3AqVu9lyqeFwr3" }, { type: "bonus", formula: "1d6" }] };
    expect(validateEntry({ triggers: [fortune] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ ...fortune, do: [fortune.do[0], { type: "bonus" }] }] }, { facts })).toEqual(["triggers[0].do[1].formula: formula required"]);
    expect(validateEntry({ triggers: [{ on: "allyAttacks", do: [{ type: "bonus", formula: "1d6" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"bonus\" requires the allyAttacks moment and a \"use\" reaction"]);
    expect(validateEntry({ triggers: [{ ...fortune, on: "enemyAttacks" }] }, { facts }))
      .toEqual(["triggers[0].do: \"bonus\" requires the allyAttacks moment and a \"use\" reaction"]);
  });

  it("§38 : `rollBonus` — l'activité et les jets concernés", () => {
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["save", "check"] } }, { facts })).toEqual([]);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["attack"] } }, { facts })).toEqual([]);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["check"], skills: ["ste"] } }, { facts })).toEqual([]);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["damage"] } }, { facts })).toEqual(["rollBonus: { activity (or reroll: { bonus, during }), on: [save | check | attack | initiative], skills?, statuses?, luck?: true, succeed?: true, abilities?, reroll?: { bonus? }, failRefund?: true }"]);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["check"], skills: [] } }, { facts })).toHaveLength(1);
    // Relevé des trous : `reroll` sans activité (Concentration fanatique) ; pas les deux, pas de bonus vide.
    expect(validateEntry({ rollBonus: { on: ["save"], reroll: { bonus: "@scale.barbarian.rage-damage", during: "rage" } } }, { facts })).toEqual([]);
    expect(validateEntry({ rollBonus: { on: ["save"] } }, { facts })).toHaveLength(1);
    expect(validateEntry({ rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["save"], reroll: { bonus: "2", during: "rage" } } }, { facts })).toHaveLength(1);
    expect(validateEntry({ rollBonus: { on: ["save"], reroll: { bonus: "", during: "rage" } } }, { facts })).toHaveLength(1);
  });

  it("§38 : « absorb » avec une réaction au moment allyIsDamaged, `use` sans consommation", () => {
    const ward = { on: "allyIsDamaged", do: [{ type: "use", activity: "THaODa86JJaeoWfL", consume: false }, { type: "absorb" }] };
    expect(validateEntry({ triggers: [ward] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ ...ward, on: "isDamaged" }] }, { facts }))
      .toEqual(["triggers[0].do: \"absorb\" requires the allyIsDamaged moment and a \"use\" reaction"]);
    expect(validateEntry({ triggers: [{ ...ward, do: [{ type: "use", consume: true }, { type: "absorb" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].consume: false or absent"]);
  });

  it("§37 : `choice.pool` (effets d'item proposés par une activité) et `resave` { keep, onFail: dodge }", () => {
    expect(validateEntry({ choice: { effects: "one", pool: { PYFPZ4aLWjKJ1tLZ: ["m5aRx9iXnJi2WWPU", "pG5HdDpW8VELR1O3"] } } }, { facts })).toEqual([]);
    expect(validateEntry({ choice: { effects: "one", pool: { court: ["m5aRx9iXnJi2WWPU"] } } }, { facts }))
      .toEqual(["choice.pool: { <activity id>: [effect ids] } (16 characters)"]);
    expect(validateEntry({ choice: { effects: "one", pool: { PYFPZ4aLWjKJ1tLZ: [] } } }, { facts })).toHaveLength(1);
    const resave = step => validateEntry({ triggers: [{ on: "startOfTurn", via: "effect", do: [step] }] }, { facts });
    expect(resave({ type: "resave", keep: true, onFail: "dodge" })).toEqual([]);
    expect(resave({ type: "resave", keep: false })).toEqual(["triggers[0].do[0].keep: true or absent"]);
    expect(resave({ type: "resave", onFail: "flee" })).toEqual(["triggers[0].do[0].onFail: dodge"]);
  });

  it("aura : rayon positif, camp connu, id d'effet à 16 caractères, pas de clé inventée", () => {
    expect(validateEntry({ aura: { radius: -5, affects: "friends", effect: "abc", color: "red" } }, { facts })).toEqual([
      "aura.radius: positive number", "aura.affects: ally, enemy, any, summoner", "aura.effect: effect id (16 characters)", "aura.color: unknown key"
    ]);
    expect(validateEntry({ aura: { radius: 10 } }, { facts })).toEqual([]);
  });

  it("onHit : un id d'activité", () => {
    expect(validateEntry({ onHit: { save: "abc" } }, { facts })).toEqual(["onHit.save: activity id (16 characters)"]);
    expect(validateEntry({ onHit: "udF9lrpAQMvL0b9J" }, { facts })).toHaveLength(1);
  });

  it("choice : effets « one », question facultative, rien d'autre", () => {
    expect(validateEntry({ choice: { effects: "one" } }, { facts })).toEqual([]);
    expect(validateEntry({ choice: { effects: "one", prompt: "Laquelle ?" } }, { facts })).toEqual([]);
    expect(validateEntry({ choice: { effects: "all" } }, { facts })).toEqual(["choice.effects: one"]);
    expect(validateEntry({ choice: { effects: "one", prompt: 3, mode: "x" } }, { facts })).toEqual(["choice.prompt: string", "choice.mode: unknown key"]);
    expect(validateEntry({ choice: "one" }, { facts })).toEqual(["choice: an object"]);
  });

  it("targets (§16.8) : types connus, condition aux faits connus, rien d'autre", () => {
    expect(validateEntry({ targets: { types: ["humanoid"] } }, { facts })).toEqual([]);
    expect(validateEntry({ targets: { unaffectedIf: { "target.immuneTo": "exhaustion" } } }, { facts })).toEqual([]);
    expect(validateEntry({ targets: { types: ["elf"], unaffectedIf: { "moon.phase": 1 }, only: true } }, { facts })).toEqual([
      "targets.types: unknown \"elf\" (aberration, beast, celestial, construct, dragon, elemental, fey, fiend, giant, humanoid, monstrosity, ooze, plant, undead)",
      "targets.unaffectedIf: unknown fact \"moon.phase\"",
      "targets.only: unknown key"
    ]);
    expect(validateEntry({ targets: { types: [] } }, { facts })).toEqual(["targets.types: non-empty list of creature types"]);
    expect(mergeEntries([{ targets: { types: ["humanoid"] } }, { targets: { unaffectedIf: true } }])).toEqual({ targets: { types: ["humanoid"], unaffectedIf: true } });
  });

  it("une table entière est validée entrée par entrée, préfixée par l'identifiant", () => {
    expect(validateTable({ hex: { triggers: [{ on: "nope", do: [{ type: "use" }] }] }, shield: { triggers: [{ on: "isHit", do: [{ type: "use" }] }] } }, { facts }))
      .toEqual([`hex.triggers[0].on: unknown moment "nope" (${MOMENTS_LIST})`]);
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
      "aberrant-anatomy", "abjure-foes", "absorb-elements", "absorption-ioun-stone", "acid", "acid-arrow", "acrobatic-movement",
      "action-surge", "adrenaline-rush", "agile", "aid", "air-element", "air-form", "alchemists-fire", "alert", "alter-self", "ambush",
      "ancient-might", "animal-friendship", "animate-dead", "animate-objects", "animate-trees", "antilife-shell", "antimagic-cone",
      "antimagic-field", "antimatter-rifle", "antitoxin", "arcane-eye", "arcane-gate", "arcane-hand", "arcane-recovery",
      "arcane-sword", "arcane-vigor", "arcane-ward", "armor-of-agathys", "armor-of-vulnerability", "arms-of-hadar",
      "arrow-catching-shield", "aspect-of-the-wilds", "assassinate", "athlete", "aura-of-alacrity", "aura-of-authority",
      "aura-of-bravery", "aura-of-courage", "aura-of-devotion", "aura-of-life", "aura-of-protection", "aura-of-purity",
      "aura-of-vitality", "aura-of-warding", "avatar-of-battle", "avenger-spirit", "avenging-angel", "avoidance",
      "awareness-ioun-stone", "baba-yagas-dancing-broom", "bag-of-beans", "bag-of-tricks", "bait-and-switch", "ball-bearings",
      "banishing-smite", "banishment", "bastion-of-law", "beacon-of-hope", "bead-of-force", "befuddlement", "beguiling-defenses",
      "beguiling-magic", "beguiling-twist", "belt-of-dwarvenkind", "berserker-axe-enchanted", "bestow-curse", "bigbys-hand", "bite",
      "black-tentacles", "blackrazor", "blade-barrier", "blade-ward", "blazing-movement", "blessed-healer", "blessed-strikes",
      "blessed-strikes-potent-spellcasting", "blessing-of-the-trickster", "blinding-smite", "blindness-deafness", "blink",
      "blue-elemental-gem", "blur", "boon-of-combat-prowess", "boon-of-dimensional-travel", "boon-of-energy-resistance",
      "boon-of-fate", "boon-of-fortitude", "boon-of-irresistible-offense", "boon-of-recovery", "boon-of-speed", "boon-of-spell-recall",
      "boon-of-the-night-spirit", "boots-of-speed", "boots-of-striding-and-springing", "bowl-of-commanding-water-elementals",
      "bracers-of-defense", "brave", "brazier-of-commanding-fire-elementals", "breath-weapon", "bronze-griffon-rare", "brutal-strike",
      "brute-spirit", "bubble-dash", "bullseye-lantern", "burnt-othur-fumes", "call-lightning", "calm-emotions", "caltrops", "candle",
      "cape-of-the-mountebank", "captains-charm", "careful-spell", "carrion-crawler-mucus", "cause-fear", "celestial-revelation",
      "censer-of-controlling-air-elementals", "chain-lightning", "channel-divinity", "channel-divinity-cleric", "charger",
      "charging-horn", "charm-monster", "charm-person", "chill-touch", "chromatic-orb", "circle-of-mortality", "circle-of-power",
      "clairvoyant-combatant", "cloak-of-arachnida", "cloak-of-displacement", "cloak-of-elvenkind", "cloak-of-the-bat",
      "clockwork-cavalcade", "cloud-of-daggers", "cloudkill", "clouds-jaunt", "combat-inspiration", "command", "commanders-strike",
      "commanding-presence", "compelled-duel", "compulsion", "confusion", "conjure-animals", "conjure-barrage", "conjure-celestial",
      "conjure-elemental", "conjure-fey", "conjure-minor-elementals", "conjure-volley", "conjure-woodland-beings", "consume-life",
      "contact-other-plane", "contagion", "continual-flame", "cordon-of-arrows", "corrosive-form", "cosmic-omen", "countercharm",
      "counterspell", "coward-spirit", "create-undead", "crossbow-expert", "crown-of-madness", "crusaders-mantle", "crusher",
      "cunning-action", "cunning-strike", "cutting-words", "dagger-of-venom", "dancing-lights", "dark-ones-blessing",
      "dark-ones-own-luck", "darkness", "darkness-aura", "daylight", "death-burst", "death-curse", "death-throes", "death-ward",
      "deathless-agility", "deathly-stench", "deathly-teleport", "decanter-of-endless-water", "defense", "defensive-duelist",
      "defensive-tactics", "deflect-attacks", "deflect-blow", "delayed-blast-fireball", "demiplane", "demonomicon-of-iggwilv",
      "destructive-wave", "devious-strikes", "devour-intellect", "dimension-door", "disarming-attack", "disciple-of-life",
      "disciplined-survivor", "disintegrate", "dispel-evil-and-good", "dispel-magic", "dissonant-whispers", "distant-spell",
      "distracting-strike", "divine-fury", "divine-smite", "divine-word", "dominate-beast", "dominate-mind", "dominate-monster",
      "dominate-person", "draconic-flight", "draconic-strike", "dragon-slayer-enchanted", "dragons-breath", "draining-kiss",
      "draining-swipe", "dread-ambusher", "dreadful-strikes", "dueling", "dust-of-disappearance", "dust-of-sneezing-and-choking",
      "dwarven-resilience", "dynamite-stick", "earth-element", "earthquake", "ebonbane", "ebony-fly-rare", "echoing-soul",
      "elder-champion", "eldritch-blast", "eldritch-smite", "elemental-adept", "elemental-affinity", "elemental-attunement",
      "elemental-epitome", "elemental-fury", "elemental-fury-potent-spellcasting", "elemental-gem", "elemental-weapon",
      "elixir-of-health", "elusive", "emerald-elemental-gem", "empowered-channeling", "empowered-evocation", "energy-drain", "engulf",
      "enhance-ability", "enlarge-reduce", "ensnaring-strike", "entangle", "entangling-trail", "enthrall", "esoteric-ward",
      "essence-of-ether", "ethereal-jaunt", "ethereal-stride", "etherealness", "evards-black-tentacles", "evasion", "evasive-footwork",
      "eversmoking-bottle", "executioners-axe-enchanted", "expeditious-retreat", "eye-and-hand-of-vecna", "eye-rays", "eyebite",
      "faerie-fire", "faithful-hound", "fanatical-focus", "fear", "fear-aura", "feather-fall", "feign-death", "feinting-attack",
      "fell-word", "feral-pounce", "feral-strike", "fetid-aura", "fetid-cloud", "fey-ancestry", "find-familiar", "find-steed",
      "finger-of-death", "fire-aura", "fire-element", "fire-form", "fire-shield", "fires-burn", "flame-aura", "flame-blade",
      "flame-tongue-enchanted", "flaming-sphere", "flask-of-holy-water", "fleet-step", "flesh-to-stone", "flyby", "foe-slayer",
      "fog-cloud", "font-of-inspiration", "fool", "forbiddance", "forbidden-knowledge", "forcecage", "forceful-hand", "foresight",
      "form-of-dread", "fortitude-ioun-stone", "fortune-teller-spirit", "fount-of-moonlight", "freedom-of-movement", "frenzied-rush",
      "frenzy", "friends", "frosts-chill", "full-of-stars", "gaseous-form", "gate", "gathered-whispers", "geas", "gem-of-brightness",
      "gem-of-seeing", "ghost-walk", "giant-insect", "giant-slayer-enchanted", "gibbering", "globe-of-invulnerability",
      "gloves-of-missile-snaring", "gloves-of-swimming-and-climbing", "goading-attack", "golden-lions-rare", "grant-save-advantage",
      "grappler", "grasping-hand", "grasping-vine", "grave-dust-flight", "grease", "great-weapon-fighting", "great-weapon-master",
      "greater-absorption-ioun-stone", "greater-portent", "greater-restoration", "grenade-smoke", "guardian-of-faith", "guidance",
      "guiding-bolt", "gust-of-wind", "hail-of-thorns", "hammer-of-thunderbolts-enchanted", "hand-of-healing",
      "hand-of-ultimate-mercy", "harkons-bite", "haste", "heal", "healer", "healers-kit", "heat-aura", "heat-metal",
      "heavy-armor-master", "heightened-focus", "heightened-spell", "hellish-rebuke", "helm-of-brilliance",
      "helm-of-brilliance-enchanted", "helm-of-telepathy", "heroic-warrior", "heroism", "hex", "hideous-laughter", "hills-tumble",
      "hold-monster", "hold-person", "holy-aura", "holy-avenger-enchanted", "holy-nimbus", "holy-water", "hooded-lantern",
      "horn-of-blasting", "hunger-of-hadar", "hunger-of-yeenoghu", "hunters-mark", "hunters-prey", "hypnotic-pattern", "ice-knife",
      "ice-spear", "ice-storm", "illusory-self", "imprisonment", "improved-brutal-strike", "improved-brutal-strike-2",
      "improved-circle-forms", "improved-cunning-strike", "improved-elemental-fury", "improved-illusions", "improved-war-magic",
      "improved-warding-flare", "incendiary-cloud", "indomitable", "indomitable-might", "innate-sorcery", "insect-plague",
      "inspiring-smite", "instinctive-pounce", "interception", "intimidating-presence", "investment-of-the-chain-master",
      "invisibility", "invoke-duplicity", "iron-bands-of-bilarro", "iron-flask", "ivory-goats", "jallarzis-storm-of-radiance",
      "jester", "jolt-to-life", "jump", "keoghtoms-ointment", "knowledge-from-a-past-life", "lamp", "lantern-bullseye",
      "lantern-hooded", "lantern-of-revealing", "large-form", "laser-pistol", "laser-rifle", "lay-on-hands", "leading-evasion",
      "lesser-restoration", "levitate", "life-drain", "lifedrinker", "light", "lightning-arrow", "limited-foresight", "living-shadow",
      "lolths-sting", "lordly-presence", "luck-blade-enchanted", "lucky", "lunar-form", "lunging-attack", "lupin-howl", "luring-song",
      "mace-of-disruption", "mace-of-terror", "mage-armor", "mage-hand", "mage-slayer", "magic-missile", "magic-resistance",
      "magic-weapon", "magnificent-mansion", "manacles", "maneuvering-attack", "mangonel", "mantle-of-spell-resistance",
      "manual-of-quickness-of-action", "marble-elephant-rare", "marshal-undead", "martial-arts", "mass-cure-wounds", "mass-heal",
      "mass-suggestion", "maze", "medium-armor-master", "melfs-acid-arrow", "menacing-attack", "mind-corrosion", "mind-sliver",
      "mind-spike", "mindless-rage", "minor-illusion", "mirror-image", "mislead", "mist-walker", "misty-escape", "misty-form",
      "misty-step", "mm-beholder-eye-rays", "mm-homunculus-bite", "mm-pseudodragon-sting", "mm-wereboar-gore", "mm-wight-life-drain",
      "modify-memory", "monks-focus", "moon-touched-sword", "moon-touched-sword-enchanted", "moonbeam", "moonlight-step",
      "mordenkainens-faithful-hound", "mordenkainens-magnificent-mansion", "mordenkainens-sword", "natures-ward", "natures-wrath",
      "necklace-of-adaptation", "necklace-of-prayer-beads", "necrotic-husk", "negative-energy-cone", "net", "nimble-escape",
      "nine-lives-stealer-enchanted", "noxious-miasma", "oathbow-enchanted", "observant", "obsidian-steed-very-rare", "oil",
      "oil-of-sharpness", "oil-of-slipperiness", "oil-of-taggit", "onyx-dog-rare", "open-hand-technique", "orb-of-dragonkind",
      "otilukes-freezing-sphere", "otilukes-resilient-sphere", "ottos-irresistible-dance", "pack-tactics", "pact-of-the-blade",
      "pact-of-the-chain", "pale-tincture", "parry", "parry-maneuver", "pass-without-trace", "path-to-the-grave", "perfect-focus",
      "periapt-of-health", "periapt-of-wound-closure", "persistent-rage", "phantasmal-creatures", "phantasmal-force",
      "phantasmal-killer", "phantom-steed", "physicians-touch", "piercer", "pipes-of-haunting", "plant-growth", "poison-basic",
      "poisoned-darts", "poisoned-needle", "poisoner", "polearm-master", "polymorph", "portent", "possession", "potent-cantrip",
      "potion-of-animal-friendship", "potion-of-climbing", "potion-of-diminution", "potion-of-flying", "potion-of-growth",
      "potion-of-healing", "potion-of-heroism", "potion-of-invisibility", "potion-of-mind-reading", "potion-of-pugilism",
      "potion-of-resistance", "potion-of-vitality", "power-of-shadow", "power-word-fortify", "power-word-heal", "power-word-kill",
      "power-word-stun", "prayer-of-healing", "precise-hunter", "precision-attack", "preserve-life", "priest-spirit",
      "primal-companion", "primal-knowledge", "prismatic-spray", "prismatic-wall", "proboscis", "produce-flame", "project-image",
      "projected-ward", "protection", "protection-from-energy", "protection-from-evil-and-good", "protection-from-poison", "prowl",
      "psionic-power", "psychic-defenses", "psychic-skewer", "psychic-spells", "psychic-veil", "pushing-attack",
      "quarterstaff-of-the-acrobat", "quickened-spell", "radiant-soul", "radiant-teleport", "rage", "rage-of-the-wilds", "raise-dead",
      "rally", "ray-of-enfeeblement", "ray-of-frost", "reactive", "reanimated-companion", "reckless-attack", "red-elemental-gem",
      "regenerate", "regeneration", "relentless-endurance", "relentless-hunter", "relentless-rage", "remarkable-athlete",
      "remove-curse", "rend-mind", "repelling-blast", "resilient-sphere", "resistance", "restoring-touch", "resurrection",
      "retaliation", "revelation-in-flesh", "reverse-gravity", "revivify", "ring-of-elemental-command-air",
      "ring-of-elemental-command-earth", "ring-of-elemental-command-fire", "ring-of-elemental-command-water", "ring-of-evasion",
      "ring-of-feather-falling", "ring-of-free-action", "ring-of-invisibility", "ring-of-spell-turning", "ring-of-the-ram",
      "ring-of-warmth", "ring-of-x-ray-vision", "riposte", "ritual-adept", "robe-of-scintillating-colors", "robe-of-stars",
      "robe-of-the-archmagi", "rod-of-absorption", "rod-of-lordly-might", "rod-of-rulership", "rolling-stone", "rope-of-entanglement",
      "rumbling-movement", "sacred-weapon", "sanctuary", "sanguine-drain", "savage-attacker", "scarab-of-protection",
      "scimitar-of-speed", "scorching-ray", "scroll-of-protection", "scroll-of-protection-aberration-enchanted",
      "scroll-of-protection-beast-enchanted", "scroll-of-protection-celestial-enchanted", "scroll-of-protection-construct-enchanted",
      "scroll-of-protection-dragon-enchanted", "scroll-of-protection-elemental-enchanted", "scroll-of-protection-fey-enchanted",
      "scroll-of-protection-fiend-enchanted", "scroll-of-protection-giant-enchanted", "scroll-of-protection-humanoid-enchanted",
      "scroll-of-protection-monstrosity-enchanted", "scroll-of-protection-ooze-enchanted", "scroll-of-protection-plant-enchanted",
      "scroll-of-protection-undead-enchanted", "scroll-of-titan-summoning", "sculpt-spells", "sear-undead", "searing-smite",
      "searing-vengeance", "second-skin", "second-story-work", "see-invisibility", "self-restoration", "sentinel",
      "sentinel-at-deaths-door", "sentinel-shield", "serpentine-owl-rare", "shade-spirit", "shadow-stealth", "shadow-veil",
      "shadow-walk", "shadowy-dodge", "shadowy-teleport", "sharp-eye-ravenloft", "sharpshooter", "shatter", "shield", "shield-master",
      "shield-of-missile-attraction", "shillelagh", "shining-smite", "shocking-grasp", "sickening-vapors", "silence",
      "silver-horn-of-valhalla", "silver-needle", "silver-raven-uncommon", "skulker", "skull", "slam", "slasher", "sleep",
      "sleet-storm", "slippers-of-spider-climbing", "slow", "slow-fall", "smelting-charge", "smite-of-protection", "sneak-attack",
      "soldier-feature", "soul-of-vengeance", "spare-the-dying", "speedy", "spell-resistance", "spell-sniper", "spellguard-shield",
      "spider-climb", "spike-growth", "spirit-guardians", "spirit-shroud", "spiritual-weapon", "staff-of-power", "staff-of-striking",
      "staff-of-swarming-insects", "staff-of-the-magi", "staff-of-thunder-and-lightning", "staff-of-withering", "staggering-smite",
      "starry-wisp", "steady-aim", "steel-wind-strike", "stench", "steps-of-the-fey", "stinking-cloud", "stomp",
      "stone-of-controlling-earth-elementals", "stones-endurance", "storm-of-radiance", "storm-of-vengeance", "stormborn", "storms-thunder",
      "studied-attacks", "stunning-strike", "subtle-spell", "suggestion", "summon-aberration", "summon-beast", "summon-celestial",
      "summon-construct", "summon-dragon", "summon-elemental", "summon-fey", "summon-fiend", "summon-undead", "sun-blade", "sunbeam",
      "sunburst", "superior-inspiration", "superior-potion-of-healing", "supreme-healing", "supreme-potion-of-healing",
      "supreme-sneak", "survivor-ravenloft", "swallow", "swarm", "sweeping-attack", "swift-quiver", "swoop", "sword-of-kas",
      "sword-of-life-stealing-enchanted", "sword-of-sharpness", "sword-of-sharpness-enchanted", "sword-of-vengeance-enchanted",
      "symbiotic-being", "symbol", "synaptic-static", "tactical-assessment", "tactical-charge", "tactical-mind", "tactical-shift",
      "talisman-of-pure-good", "talisman-of-ultimate-evil", "tashas-hideous-laughter", "tavern-brawler", "telekinesis", "telekinetic",
      "telekinetic-thrust", "teleport", "tentacle-rod", "terrifying-aura", "thiefs-reflexes", "thorn-whip", "thrown-weapon-fighting",
      "thunderous-smite", "thunderwave", "tinderbox", "toll-the-dead", "torch", "torpor", "toxic-escape", "trampling-charge",
      "travel-along-the-tree", "trebuchet", "tricksters-transposition", "trip-attack", "true-resurrection", "true-strike", "tsunami",
      "twinned-spell", "umbral-dagger", "unarmed-fighting", "unarmed-strike", "uncanny-dodge", "undead-fortitude", "unraveling-flesh",
      "unseen-servant", "valor-extra-attack", "vampiric-bite", "vampiric-touch", "vanish", "vicious-mockery", "vile-appearance",
      "vine-attack", "viral-aura", "vitality-of-the-tree", "vitriolic-sphere", "vow-of-enmity", "wails-from-the-grave", "wall-of-fire",
      "wall-of-force", "wall-of-ice", "wall-of-stone", "wall-of-thorns", "wand-of-paralysis", "wand-of-polymorph", "wand-of-web",
      "wand-of-wonder", "war-caster", "war-magic", "war-priest", "warding-bond", "warding-charm", "warding-flare", "warp-body",
      "watchers", "water-element", "water-form", "watery-rush", "weakening-breath", "web", "weird", "weird-insight", "whelm",
      "whirling-form", "wild-companion", "wild-resurgence", "wind-wall", "witch-bolt", "word-of-radiance", "wrath-of-the-sea",
      "wrath-of-the-wild", "wrathful-smite", "yellow-elemental-gem", "yolandes-regal-presence", "zealous-presence"
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
      "triggers[0].do[0].mode: push, pull", "triggers[0].do[0].distance: positive number or formula", "triggers[0].do[0].units: unit required"
    ]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"move\" requires an outcome moment (hit, failedSave, savedSave)"]);
  });

  it("status : un état, à une issue", () => {
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "status", status: "prone" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "status" }] }] }, { facts })).toEqual(["triggers[0].do[0].status: condition required"]);
    expect(validateEntry({ triggers: [{ on: "enter", do: [{ type: "status", status: "prone" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"status\" requires an outcome moment (hit, failedSave, savedSave)"]);
  });

  it("replay : une sœur par id d'activité", () => {
    expect(validateEntry({ triggers: [{ on: "turnStart", do: [{ type: "replay", activity: "dnd5eactivity000" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "turnStart", do: [{ type: "replay", activity: "abc" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].activity: activity id (16 characters) expected"]);
  });

  it("resave : au tour de la créature, porté par l'effet", () => {
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", do: [{ type: "resave" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"resave\" requires moments among startOfTurn, endOfTurn, isDamaged and via: \"effect\""]);
    expect(validateEntry({ triggers: [{ on: "turnEnd", via: "effect", do: [{ type: "resave" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"resave\" requires moments among startOfTurn, endOfTurn, isDamaged and via: \"effect\""]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "bearer", do: [{ type: "resave" }] }] }, { facts })[0]).toBe("triggers[0].via: effect");
    // Domination, Fou rire : la sauvegarde se rejoue aussi quand la créature subit des dégâts.
    expect(validateEntry({ triggers: [{ on: ["endOfTurn", "isDamaged"], via: "effect", do: [{ type: "resave" }] }] }, { facts })).toEqual([]);
  });

  it("riposte (B9) : dégâts à l'attaquant, au seul moment isHit — formule et type, ou activité", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", via: "effect", fromEffect: "YbUr13GTnMrootmf", if: { "activity.isMelee": true },
      do: [{ type: "damage", to: "source", formula: "2d8", damageType: "fire" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "damage", to: "source", activity: "OzlTY1z1gup4C2Qq" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "damage", to: "source" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].formula: formula required", "triggers[0].do[0].damageType: damage type required"]);
    expect(validateEntry({ triggers: [{ on: ["isHit", "isDamaged"], do: [{ type: "damage", to: "source", formula: "1d8", damageType: "acid" }] }] }, { facts }))
      .toEqual(["triggers[0].do: a riposte (to: \"source\") requires isHit as the only moment"]);
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", do: [{ type: "damage", to: "self", activity: "OzlTY1z1gup4C2Qq", formula: "1", damageType: "fire" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].to: source, origin, bearer", "triggers[0].do[0].activity: only for a riposte (to: \"source\") or the bearer (to: \"bearer\")"]);
  });

  it("§19 : dégâts d'issue (moitié sur réussite) et dégâts du porteur à son tour", () => {
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "damage", formula: "2d4", damageType: "necrotic", onSave: "half" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "damage", formula: "2d8", damageType: "necrotic" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "damage", formula: "2d8", damageType: "necrotic", onSave: "half" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"onSave\" requires failedSave as the only moment, without \"to\""]);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "damage", formula: "2d4", damageType: "necrotic", onSave: "all" }] }] }, { facts }))
      .toEqual(["triggers[0].do[0].onSave: half, none"]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "NgglkyjzTbDh5Loa",
      do: [{ type: "damage", to: "bearer", activity: "uAyE5DrJp0YpElcw" }, { type: "remove" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "damage", to: "bearer", formula: "2d8", damageType: "psychic" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "bearer", formula: "2d8", damageType: "psychic" }] }] }, { facts }))
      .toEqual(["triggers[0].do: the bearer's damage (to: \"bearer\") requires moments among startOfTurn, endOfTurn, originTurnStart and via: \"effect\""]);
  });

  it("§19 : savedEffects (ids) et ignoresCloseCombat (true)", () => {
    expect(validateEntry({ savedEffects: ["yril8uhQgO1dR507"], ignoresCloseCombat: true }, { facts })).toEqual([]);
    expect(validateEntry({ savedEffects: ["court"], ignoresCloseCombat: "oui" }, { facts }))
      .toEqual(["savedEffects: list of effect ids (16 characters)", "ignoresCloseCombat: true or absent"]);
    expect(mergeEntries([{ savedEffects: ["yril8uhQgO1dR507"] }, { ignoresCloseCombat: true }]))
      .toEqual({ savedEffects: ["yril8uhQgO1dR507"], ignoresCloseCombat: true });
  });

  it("zone déplaçable (B18) : distance positive, unité", () => {
    expect(validateEntry({ movable: { distance: 60, units: "ft" } }, { facts })).toEqual([]);
    expect(validateEntry({ movable: { distance: 0, units: "", speed: 1 } }, { facts }))
      .toEqual(["movable.distance: positive number", "movable.units: unit required", "movable.speed: unknown key"]);
  });

  it("invocation (B12) : initiative « after » ou « own », rien d'autre", () => {
    expect(validateEntry({ summon: { initiative: "after" } }, { facts })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "first", count: 2 } }, { facts })).toEqual(["summon.initiative: \"after\", \"own\" or \"none\""]);
    expect(validateEntry({ summon: { initiative: "own", count: 2 } }, { facts })).toEqual(["summon.count: unknown key"]);
  });

  it("marque consommée (B10) : un côté, au moment preAttackRoll, portée par un effet", () => {
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", via: "effect", do: [{ type: "advantage" }, { type: "consume", side: "target" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", do: [{ type: "consume", side: "both" }] }] }, { facts })).toEqual([
      "triggers[0].do[0].side: \"target\" or \"source\"",
      "triggers[0].do: \"consume\" requires the preAttackRoll moment and via: \"effect\""
    ]);
  });

  it("réduction (B14) : halve avec une réaction à isHit ; partage vers l'origine ; réserve", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "halve" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "halve" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"halve\" requires the isHit or allyIsHit moment and a \"use\" reaction"]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "origin" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "damage", to: "origin" }] }] }, { facts }))
      .toEqual(["triggers[0].do: a damage share (to: \"origin\") requires isDamaged as the only moment and via: \"effect\""]);
    expect(validateEntry({ absorb: { activeAfter: "Hha69hPMTYWhDE4A", recharge: { school: "abj", perLevel: 2 } } }, { facts })).toEqual([]);
    expect(validateEntry({ absorb: { activeAfter: "x", recharge: { school: "abj", perLevel: 0 }, max: 3 } }, { facts })).toEqual([
      "absorb.activeAfter: activity id (16 characters) expected", "absorb.recharge.perLevel: positive number", "absorb.max: unknown key"
    ]);
  });

  it("teleport (B11) : distance positive, unité, activité facultative", () => {
    expect(validateEntry({ teleport: { distance: 30, units: "ft" } }, { facts })).toEqual([]);
    expect(validateEntry({ teleport: { distance: 0, units: "", activity: "x", range: 1 } }, { facts })).toEqual([
      "teleport.distance: positive number", "teleport.units: unit required", "teleport.activity: activity id (16 characters) expected", "teleport.range: unknown key"
    ]);
  });

  it("fromEffect : un id d'effet, avec via: \"effect\" ; trace : true", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", fromEffect: "abc", do: [{ type: "use" }] }] }, { facts }))
      .toEqual(["triggers[0].fromEffect: effect id (16 characters)", "triggers[0].fromEffect: requires via: \"effect\""]);
    expect(validateEntry({ trace: true }, { facts })).toEqual([]);
    expect(validateEntry({ trace: "oui" }, { facts })).toEqual(["trace: true or { activity?, show?, attack? }"]);
    expect(mergeEntries([{ trace: true }, { aura: { radius: 5 } }])).toEqual({ trace: true, aura: { radius: 5 } });
  });

  it("remove (B8) : l'effet cesse à un moment du porteur, porté par l'effet", () => {
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "remove" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"remove\" requires bearer moments (startOfTurn, endOfTurn, isAttacked, isDamaged, isHit, originTurnStart) and via: \"effect\""]);
    expect(validateEntry({ triggers: [{ on: ["isDamaged", "hit"], via: "effect", do: [{ type: "remove" }] }] }, { facts })[0]).toMatch(/"remove"/);
  });

  it("advantage / disadvantage : seulement avant un jet d'attaque", () => {
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", if: { "source.allyNearTarget": { distance: 5, units: "ft" } }, do: [{ type: "advantage" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preAttackRoll", via: "effect", do: [{ type: "disadvantage" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "advantage" }] }] }, { facts })).toEqual(["triggers[0].do: \"advantage\" requires the preAttackRoll moment"]);
  });

  it("ward : au moment isAttacked, porté par l'effet, activité sœur facultative", () => {
    expect(validateEntry({ triggers: [{ on: "isAttacked", via: "effect", do: [{ type: "ward" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isAttacked", via: "effect", do: [{ type: "ward", activity: "6TdVnZPI3lxQrycI" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isAttacked", via: "effect", do: [{ type: "ward", activity: "x" }] }] }, { facts })).toEqual(["triggers[0].do[0].activity: activity id (16 characters) expected"]);
    expect(validateEntry({ triggers: [{ on: "isAttacked", do: [{ type: "ward" }] }] }, { facts })).toEqual(["triggers[0].do: \"ward\" requires the isAttacked moment and via: \"effect\""]);
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
      "burst.activity: activity id (16 characters) expected", "burst.radius: non-negative number", "burst.units: unit required", "burst.around: unknown key"
    ]);
  });
});

describe("relance, éclat après dégâts, début de tour (§16.21) : schéma", () => {
  it("recast, burst.from, atTurnStart", () => {
    expect(validateEntry({ recast: true, atTurnStart: { activity: "0vYjMbBcXaMfGWR2" }, burst: { activity: "dnd5eactivity000", radius: 0, units: "ft", from: ["YPEmwJHX7g68307N"] } }, { facts })).toEqual([]);
    expect(validateEntry({ recast: 1, atTurnStart: { activity: "x" }, burst: { activity: "dnd5eactivity000", radius: 0, units: "ft", from: [] } }, { facts })).toEqual([
      "burst.from: list of activity ids", "recast: true or absent", "atTurnStart.activity: activity id (16 characters) expected"
    ]);
  });
});

describe("brume et soins au maximum (§16.24) : schéma", () => {
  it("obscures, healMax", () => {
    expect(validateEntry({ obscures: true, healMax: true }, { facts })).toEqual([]);
    expect(validateEntry({ obscures: 1, healMax: "oui" }, { facts })).toEqual(["obscures: true or absent", "healMax: true or absent"]);
  });
});

describe("capacités des PJ (§16.25) : schéma", () => {
  it("duplicates, saveAdvantage, onFell", () => {
    expect(validateEntry({ duplicates: true, saveAdvantage: ["charmed"], onFell: { activity: "p3YSnjGDlLIbiLpC", radius: 10, units: "ft" } }, { facts })).toEqual([]);
    expect(validateEntry({ duplicates: 3, saveAdvantage: [], onFell: { radius: -1, units: "", extra: 1 } }, { facts })).toEqual(["duplicates: true or absent",
      "saveAdvantage: list of condition identifiers", "onFell.radius: non-negative number", "onFell.units: unit required",
      "onFell.extra: unknown key"]);
  });
});

describe("Taille (§16.26) : schéma", () => {
  it("bonusAttack", () => {
    expect(validateEntry({ bonusAttack: { after: ["critical", "felled"], melee: true } }, { facts })).toEqual([]);
    expect(validateEntry({ bonusAttack: { after: ["hit"] } }, { facts })).toEqual(["bonusAttack.after: list among critical, felled"]);
    expect(validateEntry({ bonusAttack: { after: ["critical"], melee: 1, extra: 2 } }, { facts })).toEqual(["bonusAttack.melee: boolean", "bonusAttack.extra: unknown key"]);
    expect(CONTENT["great-weapon-master"].bonusAttack).toEqual({ after: ["critical", "felled"], melee: true });
  });
});

describe("projectiles (§16.27) : schéma", () => {
  it("projectiles", () => {
    expect(validateEntry({ projectiles: { count: "2 + @item.level", attack: false } }, { facts })).toEqual([]);
    expect(validateEntry({ projectiles: { count: "" } }, { facts })).toEqual(["projectiles.count: formula expected"]);
    expect(validateEntry({ projectiles: { count: "3", attack: "oui", extra: 1 } }, { facts })).toEqual(["projectiles.attack: boolean", "projectiles.extra: unknown key"]);
    expect(CONTENT["scorching-ray"].projectiles).toEqual({ count: "@item.level + 1", attack: true });
  });
});

describe("rebond (§16.27) : schéma", () => {
  it("leap", () => {
    expect(validateEntry({ leap: { radius: 30, units: "ft", max: "@item.level" } }, { facts })).toEqual([]);
    expect(validateEntry({ leap: { radius: 30, units: "ft" } }, { facts })).toEqual(["leap: { radius, units, max }"]);
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
      .toEqual(["secondPhase.activity: activity id (16 characters) expected", "sharedHp: true or absent"]);
    expect(validateEntry({ secondPhase: { activity: "phase2Transform0", form: "y" } }, { facts })).toEqual(["secondPhase.form: unknown key"]);
  });
});

describe("§19.9 : Dhampir et Domaine de la Tombe", () => {
  it("empower ({ damageType, effect, excludeTypes? })", () => {
    expect(validateEntry({ empower: { damageType: "piercing", effect: "j3fPDd7Xi1nx6Xk4", excludeTypes: ["construct", "undead"] } }, { facts })).toEqual([]);
    expect(validateEntry({ empower: { damageType: "", effect: "x", excludeTypes: ["robot"], mode: "heal" } }, { facts })).toEqual([
      "empower.damageType: damage type required",
      "empower.effect: effect id (16 characters)",
      expect.stringMatching(/^empower\.excludeTypes: creature types/),
      "empower.mode: unknown key"
    ]);
  });

  it("discharge ({ effect, formula, damageTypes, sees? }) et healsDownedMax", () => {
    const ok = { effect: "mQRlujPiGJbczcyZ", formula: "@classes.cleric.levels", damageTypes: ["necrotic", "radiant"], sees: true };
    expect(validateEntry({ discharge: ok, healsDownedMax: true }, { facts })).toEqual([]);
    expect(validateEntry({ discharge: { ...ok, damageTypes: [], sees: 1 }, healsDownedMax: "oui" }, { facts })).toEqual([
      "discharge.damageTypes: list of damage types", "discharge.sees: true or absent", "healsDownedMax: true or absent"
    ]);
  });

  it("oncePerTurn : seulement sur preDamageRoll ; uncrit : avec une réaction à isHit ou allyIsHit", () => {
    const part = [{ type: "damage", formula: "1d4", damageType: "necrotic" }];
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", oncePerTurn: true, do: part }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "hit", oncePerTurn: true, do: [{ type: "status", status: "prone" }] }] }, { facts }))
      .toEqual(["triggers[0].oncePerTurn: true, with preDamageRoll as the only moment"]);
    expect(validateEntry({ triggers: [{ on: "allyIsHit", if: { "target.bloodied": true }, do: [{ type: "use" }, { type: "halve" }, { type: "uncrit" }] }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "use" }, { type: "uncrit" }] }] }, { facts }))
      .toEqual(["triggers[0].do: \"uncrit\" requires the isHit or allyIsHit moment and a \"use\" reaction"]);
  });

  it("§223 ask : dégâts bonus au choix, seulement sur preDamageRoll, avec l'activité dont une utilisation est dépensée", () => {
    const part = [{ type: "damage", formula: "2d6", damageType: "psychic" }];
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", ask: true, do: part }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", oncePerTurn: true, ask: { uses: "DMVf7FTyTC2HCAf9" }, do: part }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", ask: { uses: "court" }, do: part }] }, { facts }))
      .toEqual(["triggers[0].ask: true or { uses?: activity id (16 characters) or a list of them }"]);
    // §438 : une liste (une activité par palier de niveau, Manuel 3.0.0) ; vide, refusée.
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", ask: { uses: ["DMVf7FTyTC2HCAf9", "NGiX54LWGJGvMMwL"] }, do: part }] }, { facts })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "preDamageRoll", ask: { uses: [] }, do: part }] }, { facts })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "hit", ask: true, do: [{ type: "status", status: "prone" }] }] }, { facts }))
      .toEqual(["triggers[0].ask: preDamageRoll as the only moment"]);
    expect(CONTENT["dread-ambusher"].triggers[0].ask).toEqual({ uses: ["DMVf7FTyTC2HCAf9", "NGiX54LWGJGvMMwL"] });
    expect(CONTENT["dreadful-strikes"].triggers[0].ask).toBeUndefined();
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
    expect(validateEntry({ changesForm: { activity: "aaaaaaaaaaaaaaaa", quand: 1 } })).toEqual([expect.stringContaining("unknown key")]);
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

describe("Frappe piégeuse (§206)", async () => {
  const { sizeAtLeast } = await import("../module/scripts/core/content/enums.mjs");
  it("taille G ou supérieure", () => {
    expect(["lg", "huge", "grg"].every(s => sizeAtLeast(s, "lg"))).toBe(true);
    expect(["tiny", "sm", "med", undefined, "xx"].some(s => sizeAtLeast(s, "lg"))).toBe(false);
  });
  it("déclarée comme un châtiment sur toute attaque d'arme, avec l'Avantage par la taille", async () => {
    const { SPELL_RULES } = await import("../module/scripts/content/spell-rules.mjs").catch(() => ({}));
    const entry = SPELL_RULES?.["ensnaring-strike"];
    if ( !entry ) return;
    expect(entry.smite).toEqual({ save: "dnd5eactivity000", any: true });
    expect(entry.saveAdvantageSize).toBe("lg");
  });
});

describe("§277 : sources enregistrées avec une table", () => {
  it("validateSources : id de document de 16 caractères → identifiant en kebab-case", () => {
    expect(validateSources({ tiersDocument001: "exemple-poing" })).toEqual([]);
    expect(validateSources({ court: "exemple", tiersDocument001: "Pas Bon" })).toEqual([
      "sources.court: document id (16 characters) expected", "sources.tiersDocument001: kebab-case identifier expected"
    ]);
    expect(validateSources([])).toEqual(["sources: an object { document id: identifier } expected"]);
  });

  it("s'ajoutent aux sources livrées, la dernière l'emporte, et se retirent avec la table", () => {
    const shipped = { ...SOURCES };
    registerSources("premier", { exempleDocument1: "exemple-un", phbmnvParry00000: "autre-parade" });
    registerTable("premier", {});
    expect(SOURCES.exempleDocument1).toBe("exemple-un");
    expect(SOURCES.phbmnvParry00000).toBe("autre-parade");
    registerSources("second", { exempleDocument1: "exemple-deux" });
    expect(SOURCES.exempleDocument1).toBe("exemple-deux");
    expect(registeredSources()).toEqual({ premier: { exempleDocument1: "exemple-un", phbmnvParry00000: "autre-parade" }, second: { exempleDocument1: "exemple-deux" } });
    registerSources("second", {});
    expect(SOURCES.exempleDocument1).toBe("exemple-un");
    unregisterTable("premier");
    expect(registeredSources()).toEqual({});
    expect(SOURCES).toEqual(shipped);
  });
});

describe("§293 : créatures de votre choix dans un rayon (pickTargets)", () => {
  it("le Renvoi des morts-vivants déclare sa liste et la Calcination à la place", () => {
    // §431 : et « Sear Undead » du Conduit divin (SRD de dnd5e 6.1), proposée si le clerc a l'item Calcination.
    expect(CONTENT["channel-divinity"].pickTargets).toMatchObject({ activities: ["aOptL5pMaj3WtR8S", "rprxorXdFoHbRERZ"], radius: 30, units: "ft",
      upgrade: [{ item: "sear-undead", activity: "fW3U8L8Ca9a6O9Wx" },
        { item: "channel-divinity-cleric", activity: "rprxorXdFoHbRERZ", requires: "sear-undead" }] });
    expect(CONTENT["sear-undead"].pickTargets.activities).toEqual(["fW3U8L8Ca9a6O9Wx"]);
  });
  it("la déclaration est vérifiée", () => {
    expect(validateEntry({ pickTargets: { activities: ["aOptL5pMaj3WtR8S"], radius: 30, units: "ft" } })).toEqual([]);
    expect(validateEntry({ pickTargets: { activities: [], radius: 0, units: "km", upgrade: { item: "" }, extra: 1 } })).toHaveLength(5);
  });
});

describe("§294 : Calcination des morts-vivants — ses propres dégâts ne mettent pas fin au renvoi", async () => {
  const { sameActivity, DAMAGED_BY } = await import("../module/scripts/core/triggers.mjs");
  it("la déclaration ne réagit qu'aux dégâts d'une autre activité", () => {
    expect(CONTENT["sear-undead"].triggers).toEqual([{ on: "isDamaged", via: "effect", fromEffect: "OftTd0Eiwnls76cX", by: "otherActivity", do: [{ type: "remove" }] }]);
    expect(DAMAGED_BY).toContain("otherActivity");
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", by: "otherActivity", do: [{ type: "remove" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", by: "otherActivity", do: [{ type: "remove" }] }] }).length).toBeGreaterThan(0);
  });
  it("compare un UUID d'activité et un id nu", () => {
    const uuid = "Actor.y5Aji4lrsSLuq0TB.Item.GL3bjGsn60rEKt4U.Activity.fW3U8L8Ca9a6O9Wx";
    expect(sameActivity(uuid, uuid)).toBe(true);
    expect(sameActivity(uuid, "fW3U8L8Ca9a6O9Wx")).toBe(true);
    expect(sameActivity(uuid, "aOptL5pMaj3WtR8S")).toBe(false);
    expect(sameActivity(null, uuid)).toBe(false);
  });
});

describe("§295 : repasse terme par terme, lot C1 (corrections déclaratives)", async () => {
  const { versatileGrip } = await import("../module/scripts/core/attack.mjs");
  it("les fins d'effet suivent le texte", () => {
    expect(CONTENT["vicious-mockery"].effectEnds).toEqual({ suEeAQQXl0X2JqzF: "bearerTurnEnd" });
    expect(CONTENT["starry-wisp"].effectEnds).toEqual({ T9kBIL7LS3j0Upwz: "casterTurnEnd" });
    expect(CONTENT["shield"].effectEnds).toEqual({ Bv3EoHGfYCprLdG1: "casterTurnStart" });
    expect(CONTENT["holy-aura"].effectEnds).toEqual({ wqBjgsd2xRnmSm8Z: "bearerTurnEnd" });
    expect(CONTENT["celestial-revelation"].effectEnds).toEqual({ "33dHubd4zYAkSAbE": "casterTurnEnd" });
    expect(CONTENT["gaseous-form"].endsWhen).toEqual({ zeroHp: true });
  });
  it("les sauvegardes répétées oubliées", () => {
    for ( const id of ["natures-wrath", "rend-mind", "synaptic-static", "intimidating-presence", "beguiling-magic"] ) {
      expect(CONTENT[id].triggers).toEqual([{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }]);
    }
    expect(CONTENT["intimidating-presence"].effectDurations).toEqual({ "3LofAPFLZJMQJirN": { seconds: 60 } });
    expect(CONTENT["mass-suggestion"].triggers).toEqual(CONTENT["suggestion"].triggers);
  });
  it("cibles consentantes, effet au choix, dégâts retirés", () => {
    expect(CONTENT["enlarge-reduce"].willingFails).toBe(true);
    expect(CONTENT["levitate"].willingFails).toBe(true);
    expect(CONTENT["levitate"].levitate).toBeTruthy();   // l'entrée d'origine n'est pas écrasée
    expect(CONTENT["gaseous-form"].actionEnds).toBeTruthy();
    expect(CONTENT["beguiling-magic"].choice).toEqual({ effects: "one" });
    expect(CONTENT["imprisonment"].choice).toEqual({ effects: "one" });
    expect(CONTENT["bestow-curse"].noDamage).toEqual(["fkQUKM8bxHgAUcg5"]);
    expect(CONTENT["geas"].noDamage).toEqual(["dnd5eactivity000"]);
    expect(CONTENT["contact-other-plane"].saveDamage).toEqual({ dnd5eactivity000: "none" });
    expect(CONTENT["stones-endurance"].triggers[0].do).toEqual([{ type: "use", activity: "vrWhAQ6Bj4gznxHq" }, { type: "reduce" }]);
  });
  it("les sources reconnues sous l'identifiant de la règle", () => {
    expect(SOURCES.n2qsI3p9HBVQIjeK).toBe("hex");
    expect(SOURCES.phbrgeAssasinate).toBe("assassinate");
  });
  it("les nouvelles clés sont vérifiées", () => {
    expect(validateEntry({ flurryStrikes: 3, effectDurations: { "3LofAPFLZJMQJirN": { seconds: 60 } }, grantsConditionImmunities: ["poisoned"] })).toEqual([]);
    expect(validateEntry({ flurryStrikes: 0 })).toHaveLength(1);
    expect(validateEntry({ effectDurations: { "3LofAPFLZJMQJirN": { rounds: 1 } } })).toHaveLength(1);
    expect(validateEntry({ grantsConditionImmunities: ["Poisoned"] })).toHaveLength(1);
    expect(validateEntry({ effectWhile: { CKLB1VHUlPsgOJxp: { changes: [{ key: "system.attributes.senses.ranges.darkvision", type: "add", value: "60" }] } } })).toEqual([]);
    expect(validateEntry({ effectWhile: { CKLB1VHUlPsgOJxp: {} } })).toHaveLength(1);
    for ( const id of ["heightened-focus", "natures-ward", "blessing-of-the-trickster", "aspect-of-the-wilds", "soldier-feature", "lay-on-hands"] ) {
      expect(validateEntry(CONTENT[id])).toEqual([]);
    }
  });
  it("Duel : une arme Polyvalente se prend à une main", () => {
    const modes = ["oneHanded", "twoHanded"];
    expect(versatileGrip({ mode: null, modes, explicit: false, otherHandBusy: false })).toBe("twoHanded");
    expect(versatileGrip({ mode: null, modes, explicit: false, otherHandBusy: false, prefersOneHand: true })).toBe("oneHanded");
    expect(versatileGrip({ mode: "twoHanded", modes, explicit: true, otherHandBusy: false, prefersOneHand: true })).toBe(null);
  });
});

describe("§296 : repasse, lot C2 (« de votre choix », plafond, réserve)", async () => {
  const { splitPool } = await import("../module/scripts/core/pools.mjs");
  const { selectAreaTargets } = await import("../module/scripts/core/area.mjs");
  it("une réserve se partage à parts égales, chaque part plafonnée, le reste aux autres", () => {
    expect(splitPool(100, [Infinity, Infinity, Infinity, Infinity])).toEqual([25, 25, 25, 25]);
    expect(splitPool(50, [5, 100, 100])).toEqual([5, 23, 22]);
    expect(splitPool(10, [0, 3, 3])).toEqual([0, 3, 3]);
    expect(splitPool(7, [10, 10])).toEqual([4, 3]);
    expect(splitPool(0, [5])).toEqual([0]);
  });
  it("une zone plafonnée garde les plus proches de son centre", () => {
    const c = (token, distance) => ({ token, distance, disposition: -1 });
    const chosen = selectAreaTargets([c("a", 50), c("b", 10), c("c", 30)], { origin: "x", originDisposition: 1, excludeOrigin: true, affects: "enemy", max: 2 });
    expect(chosen.map(t => t.token)).toEqual(["b", "c"]);
    expect(selectAreaTargets([c("a", 50), c("b", 10)], { origin: "x", originDisposition: 1, excludeOrigin: true, affects: "enemy" })).toHaveLength(2);
  });
  it("les déclarations du lot", () => {
    expect(CONTENT["sleep"].zoneAffects).toBe("enemy");
    expect(CONTENT["slow"]).toMatchObject({ zoneAffects: "enemy", zoneMax: 6 });
    expect(CONTENT["preserve-life"].pickTargets).toMatchObject({ self: true, check: "allies", filter: "bloodied", radius: 30 });
    expect(CONTENT["preserve-life"].healPool).toEqual({ activities: ["dnd5eactivity000"], cap: "halfMax", choose: true });
    expect(CONTENT["inspiring-smite"].healPool.temp).toBe(true);
    expect(CONTENT["twinned-spell"].metamagic).toEqual({ activity: "WsG9JmGU7gRGiTRq", kind: "twinned" });
    for ( const id of ["beacon-of-hope", "mass-heal", "preserve-life", "inspiring-smite", "clockwork-cavalcade", "twinned-spell", "slow"] ) {
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
  });
  it("les nouvelles clés sont vérifiées", () => {
    expect(validateEntry({ zoneMax: 0 })).toHaveLength(1);
    expect(validateEntry({ healPool: { activities: [], cap: "full" } })).toHaveLength(1);
    expect(validateEntry({ pickTargets: { activities: ["aOptL5pMaj3WtR8S"], radius: 30, units: "ft", max: 0, self: 1, check: "all", filter: "x" } })).toHaveLength(4);
  });
});

describe("§298 : repasse, lot C3 (coût d'action et budget du tour)", async () => {
  const { spendUse, checkUse, freshBudget } = await import("../module/scripts/core/turn.mjs");
  const own = { isOwnTurn: true, attacksPerAction: 3, turnKey: "1-0" };
  it("un sort à la place de deux attaques (Magie de guerre améliorée) en prend deux", () => {
    let b = freshBudget({ reactions: 1 });
    b = spendUse(b, { cost: "action", weaponAttack: true }, own);
    expect(b.attacks).toEqual({ granted: 3, used: 1 });
    const spell = { cost: "action", weaponAttack: true, attackCost: 2 };
    expect(checkUse(b, spell, { isOwnTurn: true })).toEqual([]);
    b = spendUse(b, spell, own);
    expect(b.attacks.used).toBe(3);
    expect(checkUse(b, { cost: "action", weaponAttack: true }, { isOwnTurn: true })).toContain("noAction");
  });
  it("ouvert par le sort, l'action Attaquer garde ses autres attaques", () => {
    const b = spendUse(freshBudget({ reactions: 1 }), { cost: "action", weaponAttack: true, attackCost: 1 }, { ...own, attacksPerAction: 2 });
    expect(b.action).toBe(0);
    expect(b.attacks).toEqual({ granted: 2, used: 1 });
    expect(checkUse(b, { cost: "action", weaponAttack: true }, { isOwnTurn: true })).toEqual([]);
  });
  it("les déclarations du lot", () => {
    expect(CONTENT["war-magic"].spellsInAttack).toEqual({ maxLevel: 0, class: "wizard" });
    expect(CONTENT["improved-war-magic"].spellsInAttack).toEqual({ maxLevel: 2, class: "wizard", attacks: 2 });
    expect(CONTENT["valor-extra-attack"].spellsInAttack).toEqual({ maxLevel: 0 });
    expect(SOURCES.phbbrdExtraAttac).toBe("valor-extra-attack");
    expect(CONTENT["sacred-weapon"].usageLimits.Ew70lNTD8dR3vREt.cost).toBe("free");
    expect(CONTENT["indomitable"].rollBonus.reroll.bonus).toBe("@classes.fighter.levels");
    expect(CONTENT["psionic-power"].hitRider).toMatchObject({ pays: "psionic-power", damage: "FxJXB4BPlBnJLF7q", oncePerTurn: true });
    expect(CONTENT["pact-of-the-chain"].usageLimits.uehA2kfgOCKRIqAs.cost).toBe("action");
    expect(CONTENT["pact-of-the-chain"].summon).toBeTruthy();
    for ( const id of ["indomitable", "war-magic", "improved-war-magic", "psionic-power", "sacred-weapon", "valor-extra-attack", "pact-of-the-chain"] ) {
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
  });
  it("les nouvelles clés sont vérifiées", () => {
    expect(validateEntry({ usageLimits: { Ew70lNTD8dR3vREt: { cost: "gratis" } } })).toHaveLength(1);
    expect(validateEntry({ spellsInAttack: { maxLevel: -1 } })).toHaveLength(1);
    expect(validateEntry({ spellsInAttack: { maxLevel: 0, attacks: 0 } })).toHaveLength(1);
  });
});

describe("§299 : repasse, lot C4 (aptitudes tenues par la Rage, fins sur Neutralisé)", () => {
  it("les déclarations du lot", () => {
    expect(CONTENT["mindless-rage"].duringRage).toEqual({ enable: ["Y9LOXK6Q4vot2cxi"], cures: ["charmed", "frightened"] });
    expect(CONTENT["rage-of-the-wilds"].duringRage).toEqual({ copiesEnd: true });
    expect(CONTENT["primal-knowledge"].duringRage.post).toEqual(["ufbJRsGGW3REMmJm"]);
    expect(CONTENT["vitality-of-the-tree"].duringRage.onStart).toBe("HA6qXLiCmMuEq6r1");
    for ( const id of ["channel-divinity", "channel-divinity-cleric", "sear-undead"] ) expect(CONTENT[id].endsWhen.incapacitated).toBe("caster");
    for ( const id of ["draconic-flight", "form-of-dread"] ) expect(CONTENT[id].endsWhen.incapacitated).toBe("bearer");
    expect(CONTENT["psychic-veil"].breaksOn).toEqual(["attack", "damage", "forcesSave"]);
    expect(CONTENT["zealous-presence"].triggers[0]).toMatchObject({ on: "preAttackRoll", via: "effect", do: [{ type: "advantage" }] });
    for ( const id of ["mindless-rage", "rage-of-the-wilds", "primal-knowledge", "vitality-of-the-tree", "draconic-flight", "psychic-veil", "zealous-presence"] ) {
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
  });
  it("les nouvelles clés sont vérifiées", () => {
    expect(validateEntry({ endsWhen: { incapacitated: "both" } })).toHaveLength(1);
    expect(validateEntry({ duringRage: { enable: ["court"], copiesEnd: 1 } })).toHaveLength(1);
    expect(validateEntry({ breaksOn: ["forcesSave"] })).toEqual([]);
  });
});

describe("§300 : repasse, lot C5 (zones, émanations, entrées)", () => {
  it("les déclarations du lot", () => {
    expect(CONTENT["spirit-guardians"].zoneBound).toBe(true);
    for ( const id of ["sleet-storm", "stinking-cloud"] ) expect(CONTENT[id].quietPose).toBe(true);
    expect(CONTENT["plant-growth"].difficultTerrain).toEqual({ cost: 4 });
    expect(CONTENT["plant-growth"].usageLimits.dnd5eactivity000.cost).toBe("action");
    for ( const id of ["wrath-of-the-sea", "stormborn"] ) {
      expect(CONTENT[id].pickTargets).toMatchObject({ radius: "5 + 5 * min(1, floor(@classes.druid.levels / 6))", max: 1, check: "enemies" });
      expect(CONTENT[id].triggers[0].on).toBe("failedSave");
    }
    expect(CONTENT["aura-of-vitality"].pickTargets).toMatchObject({ radius: 30, max: 1, self: true });
    expect(CONTENT["aura-of-vitality"].atTurnStart).toEqual({ activity: "0vYjMbBcXaMfGWR2" });
    expect(CONTENT["mass-cure-wounds"].pickTargets).toMatchObject({ radius: 60, max: 6, check: "allies" });
    for ( const id of ["spirit-guardians", "sleet-storm", "stinking-cloud", "plant-growth", "wrath-of-the-sea", "stormborn", "aura-of-vitality", "mass-cure-wounds"] ) {
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
  });
  it("les nouvelles clés sont vérifiées", () => {
    expect(validateEntry({ quietPose: 1 })).toHaveLength(1);
    expect(validateEntry({ zoneBound: "oui" })).toHaveLength(1);
    expect(validateEntry({ pickTargets: { activities: ["dnd5eactivity000"], radius: " ", units: "ft" } })).toHaveLength(1);
    expect(validateEntry({ pickTargets: { activities: ["dnd5eactivity000"], radius: "@scale.x.y", units: "ft" } })).toEqual([]);
  });
});

describe("§301 : repasse, lot C6 (réactions et fenêtres jamais proposées)", () => {
  it("les déclarations du lot", () => {
    expect(CONTENT["interception"].triggers[0]).toMatchObject({ on: "allyIsHit", do: [{ type: "use", target: "target" }, { type: "reduce" }] });
    expect(CONTENT["psionic-power"].triggers.map(t => t.on)).toEqual(["isHit", "allyIsHit"]);
    expect(CONTENT["cutting-words"].triggers.map(t => Object.keys(t.if))).toEqual([["target.within", "target.seesSource"], ["source.nearSelf", "self.seesSource"]]);
    expect(CONTENT["retaliation"].triggers[0].do[0]).toEqual({ type: "use", target: "source", weapon: true });
    expect(CONTENT["slow-fall"].triggers[0].on).toBe("falls");
    expect(CONTENT["feather-fall"].triggers[0].on).toEqual(["falls", "allyFalls"]);
    expect(CONTENT["tactical-mind"].rollBonus).toEqual({ activity: "VVEGPoQePVprCF9A", on: ["check"], failRefund: true });
    expect(CONTENT["countercharm"].rollBonus.statuses).toEqual(["charmed", "frightened"]);
    for ( const id of ["interception", "psionic-power", "cutting-words", "retaliation", "slow-fall", "feather-fall", "tactical-mind", "countercharm", "fount-of-moonlight", "misty-escape"] ) {
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
  });
  it("les nouvelles étapes sont contrôlées", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "cancel" }] }] })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "falls", do: [{ type: "use" }, { type: "reduce" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "falls", do: [{ type: "reduce" }] }] })).toHaveLength(1);
  });
});

describe("§302 : repasse, lot C7 (Avantage et Désavantage oubliés)", () => {
  it("les déclarations du lot", () => {
    expect(Object.keys(CONTENT["contagion"].effectChanges)).toHaveLength(6);
    expect(CONTENT["contagion"].effectChanges.S8jxTZQbT8KKSg5V).toEqual([{ key: "system.abilities.str.save.roll.mode", type: "add", value: "-1" }]);
    expect(CONTENT["beguiling-twist"].saveAdvantage).toEqual(["charmed", "frightened"]);
    expect(CONTENT["hypnotic-pattern"].targets.unaffectedIf).toEqual({ "target.hasStatus": "blinded" });
    expect(CONTENT["sleep"].targets.unaffectedIf.any).toContainEqual({ "target.hasFeature": "trance" });
    expect(CONTENT["clairvoyant-combatant"].triggers.map(t => t.do[0].type)).toEqual(["advantage", "disadvantage"]);
    expect(CONTENT["ray-of-enfeeblement"].triggers.at(-1).if["activity.ability"]).toBe("str");
    for ( const id of ["contagion", "beguiling-twist", "hypnotic-pattern", "sleep", "clairvoyant-combatant", "ray-of-enfeeblement"] ) {
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
  });
});

describe("§303 : repasse, lot C8 (sorts à logique propre)", () => {
  it("les déclarations du lot", () => {
    expect(CONTENT["aid"].effectsFirst).toBe(true);
    expect(CONTENT["cordon-of-arrows"].zoneCharges).toBe("2 * @item.level");
    expect(CONTENT["death-ward"].wardsAtZero).toBe(true);
    for ( const id of ["aid", "cordon-of-arrows", "death-ward"] ) expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
  });
  it("les nouvelles clés sont vérifiées", () => {
    expect(validateEntry({ effectsFirst: "oui" })).toHaveLength(1);
    expect(validateEntry({ zoneCharges: 0 })).toHaveLength(1);
    expect(validateEntry({ zoneCharges: " " })).toHaveLength(1);
    expect(validateEntry({ zoneCharges: 4 })).toEqual([]);
  });
});

describe("§304 : repasse, lot C9 (dons : clauses secondaires)", () => {
  it("les déclarations du lot", () => {
    expect(CONTENT["boon-of-fate"].regainOnInitiative).toEqual({ item: "boon-of-fate", upTo: 1 });
    expect(validateEntry(CONTENT["boon-of-fate"], { facts })).toEqual([]);
  });
});

describe("§305 : repasse, lot C10 (invocations, compagnons, familiers)", () => {
  it("les déclarations du lot", () => {
    expect(CONTENT["find-steed"].summon.vanishesWithCaster).toBe(true);
    expect(CONTENT["wild-companion"].summon).toMatchObject({ endsOnLongRest: true, familiar: true });
    expect(CONTENT["wild-companion"].summon.lasts).toBeUndefined();
    expect(CONTENT["investment-of-the-chain-master"].summon).toMatchObject({ initiative: "own", familiar: true });
    expect(CONTENT["phantasmal-creatures"].summon).toMatchObject({ initiative: "after", vanishesAtZero: true });
    for ( const id of ["primal-companion", "reanimated-companion"] ) expect(CONTENT[id].summon).toMatchObject({ initiative: "after", replaces: true, vanishesWithCaster: true });
    for ( const id of ["find-steed", "wild-companion", "investment-of-the-chain-master", "phantasmal-creatures", "primal-companion", "reanimated-companion"] ) {
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
  });
});

describe("§430 : Appel de destrier, données d'avant et d'après le SRD 6.1", () => {
  it("la porte de la monture volante ne vise que l'ancienne activité « Summon Flying Steed »", () => {
    const { minLevels } = CONTENT["find-steed"].summon;
    // dnd5e 6.0.x et le PHB premium : deux activités, la volante (o4YsONnsS8rOOEaS) seulement à partir du niveau 4.
    expect(minLevels).toEqual({ o4YsONnsS8rOOEaS: 4 });
    // SRD 6.1 : une seule activité (dnd5eactivity000), l'effet « Flying Steed » est filtré par dnd5e (level.min 4) — aucune porte ici.
    expect(minLevels.dnd5eactivity000).toBeUndefined();
    expect(validateEntry(CONTENT["find-steed"], { facts })).toEqual([]);
  });
});

describe("§306 : repasse, lot C11 (Métamagie, magie des sous-classes)", () => {
  it("les déclarations du lot", () => {
    expect(CONTENT["improved-illusions"].rangedFeat).toEqual({ kind: "spell", spellRange: { value: 60, units: "ft", school: "ill" } });
    expect(validateEntry(CONTENT["improved-illusions"], { facts })).toEqual([]);
    expect(validateEntry({ rangedFeat: { kind: "spell", spellRange: { value: 60, units: "ft", school: "" } } })).toHaveLength(1);
  });
});

describe("§308 : repasse, lot C12-e (sauvegardes, Avantage, dés ajoutés)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["brutal-strike", "improved-brutal-strike", "improved-brutal-strike-2", "defensive-tactics", "hex", "power-word-stun"] ) {
      expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    }
    expect(Object.keys(CONTENT["brutal-strike"].brutalStrike.options)).toEqual(["forceful", "hamstring"]);
    expect(CONTENT["improved-brutal-strike-2"].brutalStrike.count).toBe(2);
    expect(CONTENT["defensive-tactics"].hitDefense).toBe(true);
    expect(CONTENT["hex"].effectChanges.k2569xtIeXKRReLU).toEqual([{ key: "system.abilities.wis.save.roll.mode", type: "add", value: "-1", ifCaster: "eldritch-hex" }]);
    expect(CONTENT["power-word-stun"].triggers[0].do).toEqual([{ type: "resave", ability: "con" }]);
    expect(CONTENT["modify-memory"].advantageIfFighting).toBe(true);
    expect(validateEntry(CONTENT["prismatic-spray"], { facts })).toEqual([]);
    expect(validateEntry(CONTENT["elemental-attunement"], { facts })).toEqual([]);
  });
  it("les schémas refusent ce qui ne va pas", () => {
    expect(validateEntry({ brutalStrike: { options: { x: {} } } })).toHaveLength(1);
    expect(validateEntry({ brutalStrike: { count: 0 } })).toHaveLength(1);
    expect(validateEntry({ noOpportunityAttacks: ["court"] })).toHaveLength(1);
    expect(validateEntry({ noOpportunityAttacks: ["L9N4evZo1jt46dap"] })).toEqual([]);
    expect(validateEntry({ effectChanges: { L9N4evZo1jt46dap: [{ key: "a", type: "add", value: "1", ifCaster: "" }] } })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", ability: "luck" }] }] })).toHaveLength(1);
  });
});

describe("§309 : repasse, lot C12-b (zones, émanations, auras)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["conjure-celestial", "heat-metal", "jolt-to-life", "aura-of-warding", "aura-of-alacrity", "prismatic-wall", "dimension-door"] ) {
      expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    }
    expect(CONTENT["conjure-celestial"].enterOnPose).toBe(true);
    expect(CONTENT["heat-metal"].savedEffects).toContain("VVQbCUE5W44bF4QU");
    expect(CONTENT["heat-metal"].triggers.some(d => d.do.some(s => (s.type === "disarm") && (s.elseEffect === "VVQbCUE5W44bF4QU")))).toBe(true);
    expect(CONTENT["jolt-to-life"].burst).toMatchObject({ activity: "hTK04U7m016p6lf6", from: ["xg84KvaBJVjFZQpV"], affects: "enemy" });
    expect(CONTENT["dimension-door"].teleport.unseen).toBe(true);
  });
  it("les schémas refusent ce qui ne va pas", () => {
    expect(validateEntry({ enterOnPose: "oui" })).toHaveLength(1);
    expect(validateEntry({ burst: { activity: "hTK04U7m016p6lf6", radius: 10, units: "ft", affects: "ally" } })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "disarm", elseEffect: "court" }] }] })).toHaveLength(1);
    expect(validateEntry({ teleport: { distance: 30, units: "ft", unseen: "oui" } })).toHaveLength(1);
  });
});

describe("§310 : repasse, lot C12-f (dégâts, soins, PV)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["beguiling-defenses", "disintegrate", "physicians-touch", "elemental-epitome", "modify-memory"] ) {
      expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    }
    expect(CONTENT["beguiling-defenses"].retort).toEqual({ damageType: "psychic" });
    expect(CONTENT["disintegrate"].killsAtZero).toBe(true);
    expect(CONTENT["elemental-epitome"].choice).toEqual({ effects: "one" });
  });
  it("les schémas refusent ce qui ne va pas", () => {
    expect(validateEntry({ retort: { damageType: "rien" } })).toHaveLength(1);
    expect(validateEntry({ killsAtZero: 1 })).toHaveLength(1);
  });
});

describe("§311 : repasse, lot C12-c (invocations, compagnons, formes)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["primal-companion", "improved-circle-forms", "full-of-stars", "conjure-woodland-beings"] ) {
      expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    }
    expect(CONTENT["primal-companion"].summon.commanded).toEqual({ activity: "Jtr7GXnCHb85xHg8" });
    expect(CONTENT["conjure-woodland-beings"].basicActions).toEqual({ GAQKUmYcWR3SjxiV: "disengage" });
  });
  it("les conditions d'effectWhile : Forme sauvage, effet d'un item", () => {
    expect(effectHolds({ wildShaped: true }, { wildShaped: false })).toBe(false);
    expect(effectHolds({ wildShaped: true }, { wildShaped: true })).toBe(true);
    expect(effectHolds({ hasEffect: "starry-form" }, { effectsFrom: new Set(["rage"]) })).toBe(false);
    expect(effectHolds({ hasEffect: "starry-form" }, { effectsFrom: new Set(["starry-form"]) })).toBe(true);
    expect(validateEntry({ effectWhile: { Z3dPVHxaYqTIvLPg: { if: { wildShaped: "oui" } } } })).toHaveLength(1);
    expect(validateEntry({ summon: { initiative: "after", commanded: { activity: "court" } } })).toHaveLength(1);
  });
});

describe("§312 : repasse, lot C12-d (budget du tour, coûts)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["dragons-breath", "travel-along-the-tree", "abjure-foes"] ) expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    expect(CONTENT["dragons-breath"].grants).toEqual({ from: "dnd5eactivity000", activity: "61nfYLT1M7MOTibf" });
    expect(CONTENT["abjure-foes"].actionOrBonus).toBe(true);
    expect(validateEntry({ grants: { from: "court", activity: "61nfYLT1M7MOTibf" } })).toHaveLength(1);
  });
});

describe("§313 : repasse, lot C12-g (états, durées, fins d'effet)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["mislead", "hand-of-ultimate-mercy", "perfect-focus", "searing-vengeance", "restoring-touch"] ) expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    expect(CONTENT["mislead"].summonEffectsOnCaster).toBe(true);
    expect(CONTENT["hand-of-ultimate-mercy"].curesAll).toContain("dead");
    expect(CONTENT["perfect-focus"].regainOnInitiative).toEqual({ item: "monks-focus", upTo: 4 });
    expect(validateEntry({ summonEffectsOnCaster: "oui" })).toHaveLength(1);
  });
});

describe("§314 : repasse, lot C12-h (déplacement)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["repelling-blast", "revelation-in-flesh"] ) expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    expect(CONTENT["eldritch-blast"]?.triggers ?? []).toEqual([]);
    expect(CONTENT["repelling-blast"].triggers[0].do).toEqual([{ type: "move", mode: "push", distance: 10, units: "ft" }]);
  });
});

describe("§315 : repasse, lot C12-i (vision, furtivité)", () => {
  it("les déclarations du lot", () => {
    expect(validateEntry(CONTENT["skulker"], { facts })).toEqual([]);
    expect(CONTENT["skulker"].sniper).toBe(true);
    expect(validateEntry({ sniper: 1 })).toHaveLength(1);
  });
});

describe("§316 : repasse, lot C12-a (réactions et fenêtres)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["magic-weapon", "alter-self", "persistent-rage", "deflect-attacks", "disciplined-survivor", "phantasmal-force"] ) {
      expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    }
    expect(CONTENT["magic-weapon"].enchantTarget).toBe("weapon");
    expect(CONTENT["alter-self"].recast).toBe(true);
    expect(CONTENT["persistent-rage"].regainOnInitiative).toEqual({ items: ["rage"], uses: true });
  });
});

describe("§317 : repasse, lot C12-j (divers)", () => {
  it("les déclarations du lot", () => {
    for ( const id of ["font-of-inspiration", "improved-warding-flare", "steel-wind-strike", "protection-from-evil-and-good"] ) {
      expect(validateEntry(CONTENT[id], { facts }), id).toEqual([]);
    }
    expect(CONTENT["font-of-inspiration"].regainOnShortRest).toEqual(["bardic-inspiration"]);
    expect(CONTENT["steel-wind-strike"].projectiles).toEqual({ count: "5", attack: true, onePerTarget: true, teleportNear: { distance: 5, units: "ft" } });
    expect(validateEntry({ regainOnShortRest: [""] })).toHaveLength(1);
  });
});

describe("§352 : étape status — around", () => {
  it("around : { radius, units }", () => {
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "status", status: "stunned", save: { ability: "con", dc: 17 }, around: { radius: 30, units: "ft" } }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "status", status: "stunned", around: { radius: 0, units: "ft" } }] }] }).length).toBe(1);
    expect(validateEntry({ triggers: [{ on: "hit", do: [{ type: "status", status: "stunned", around: 30 }] }] }).length).toBe(1);
  });
});

describe("§353 : swornEnemy", () => {
  it("{ effect: id }", () => {
    expect(validateEntry({ swornEnemy: { effect: "EWoLqkPJeK9dwYhn" } })).toEqual([]);
    expect(validateEntry({ swornEnemy: { effect: "x" } }).length).toBe(1);
    expect(validateEntry({ swornEnemy: true }).length).toBe(1);
  });
});

describe("§403 : écarts moyens, second lot", () => {
  it("durationByLevel : Malédiction", async () => {
    const { durationAtLevel } = await import("../module/scripts/core/durations.mjs");
    const rule = CONTENT["bestow-curse"].durationByLevel;
    expect(durationAtLevel(rule, 3)).toBeNull();
    expect(durationAtLevel(rule, 4)).toEqual({ seconds: 600, concentration: true });
    expect(durationAtLevel(rule, 6)).toEqual({ seconds: 28800, concentration: false });
    expect(durationAtLevel(rule, 8)).toEqual({ seconds: 86400, concentration: false });
    expect(durationAtLevel(rule, 9)).toEqual({ seconds: null, concentration: false });
    expect(validateEntry({ durationByLevel: [{ from: 10 }] })).toHaveLength(1);
    expect(validateEntry({ durationByLevel: [{ from: 4, seconds: 600, extra: 1 }] })).toHaveLength(1);
  });
  it("Frappe du vent d'acier, Choc de vie, Compulsion", () => {
    expect(CONTENT["steel-wind-strike"].projectiles.onePerTarget).toBe(true);
    expect(CONTENT["jolt-to-life"].targets.unaffectedIf["activity.id"]).toBe("xg84KvaBJVjFZQpV");
    expect(CONTENT["compulsion"].compels).toBe(true);
    expect(validateEntry({ projectiles: { count: "5", attack: true, onePerTarget: 1 } })).toHaveLength(1);
  });
});

describe("§403 : aura de l'invocateur", () => {
  it("Invocation d'animaux : seul l'invocateur, à 1,50 m", async () => {
    const { auraRecipients } = await import("../module/scripts/core/aura.mjs");
    expect(CONTENT["grant-save-advantage"].aura.affects).toBe("summoner");
    const source = { token: "pack", disposition: 1, inactive: false, radius: 5, affects: "summoner", includeSelf: false, value: 0, summoners: ["caster"] };
    const near = { disposition: 1, distance: 5, lineOfEffect: true };
    expect(auraRecipients(source, [{ ...near, token: "caster" }, { ...near, token: "ally" }, { token: "pack", distance: 0 }])).toEqual(["caster"]);
    expect(auraRecipients(source, [{ ...near, token: "caster", distance: 10 }])).toEqual([]);
  });
});

describe("§403 : Liberté de mouvement", () => {
  it("les réductions de Vitesse se reconnaissent", async () => {
    const { reducesSpeed, withoutSpeedReductions } = await import("../module/scripts/core/speed-floor.mjs");
    expect(reducesSpeed({ key: "system.attributes.movement.speed", type: "add", value: -10 })).toBe(true);
    expect(reducesSpeed({ key: "system.attributes.movement.speed", type: "multiply", value: 0.5 })).toBe(true);
    expect(reducesSpeed({ key: "system.attributes.movement.walk", type: "override", value: 0 })).toBe(true);
    expect(reducesSpeed({ key: "system.attributes.movement.swim", type: "upgrade", value: 1 })).toBe(false);
    expect(reducesSpeed({ key: "system.attributes.movement.speed", type: "add", value: 10 })).toBe(false);
    expect(reducesSpeed({ key: "system.attributes.ac.bonus", type: "add", value: -2 })).toBe(false);
    expect(withoutSpeedReductions([{ key: "system.attributes.ac.bonus", type: "add", value: -2 },
      { key: "system.attributes.movement.speed", type: "multiply", value: 0.5 }])).toHaveLength(1);
    expect(CONTENT["freedom-of-movement"].keepsSpeed).toBe(true);
  });
});

describe("§403 : Bourrasque", () => {
  it("vers le lanceur dans la ligne : le coût une fois de plus", async () => {
    const { windwardExtra } = await import("../module/scripts/core/windward.mjs");
    const caster = { x: 0, y: 0 };
    const toward = [{ x: 300, y: 0, inside: true }, { x: 200, y: 0, inside: true, cost: 5 }, { x: 100, y: 0, inside: true, cost: 5 }];
    expect(windwardExtra(toward, caster)).toBe(10);
    expect(windwardExtra([...toward].reverse().map((p, i, a) => ({ ...p, cost: i ? 5 : 0 })), caster)).toBe(0);
    expect(windwardExtra([{ x: 300, y: 0, inside: false }, { x: 200, y: 0, inside: false, cost: 5 }], caster)).toBe(0);
    expect(CONTENT["gust-of-wind"].windward).toBe(true);
  });
});
