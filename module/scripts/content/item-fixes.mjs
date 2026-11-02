/**
 * O1 (SPEC §335) : défauts de la donnée des objets premium (Guide du maître 2024, Manuel des joueurs 2024, Ravenloft), corrigés par
 * identifiant — clé `dataFixes` (core/data-fixes.mjs), écrite à la création de l'objet et par le diagnostic. Ids d'activités et
 * d'effets relevés dans les packs `equipment` / `items` des modules premium (DMG 2.0.0, PHB 2.2.0, Ravenloft 1.0.1).
 * `from` : la valeur d'origine du module ; une valeur modifiée à la main ne bouge pas.
 */

/** Un changement d'effet, au format des effets de dnd5e 6 (V14 : `system.changes`). */
const change = (key, type, value) => ({ key, value, priority: null, type });
/** Une part de dégâts d'activité. */
const part = (number, denomination, types, bonus="") => ({ custom: { enabled: false, formula: "" }, number, denomination, bonus, types, scaling: { number: 1 } });
const formulaPart = (formula, types) => ({ custom: { enabled: true, formula }, number: null, denomination: 0, bonus: "", types, scaling: { number: 1 } });
const DART = types => [formulaPart("1d6", types)];

/** Une consommation d'utilisations (de l'item ou de l'activité). */
const spend = (type, value) => ({ type, value: String(value), target: "", scaling: {} });

/** Une activité « Recharger » pour une arme à recharge du Guide (modèle : le Fusil automatique). */
const reload = (_id, name, type, shots) => ({
  _id, type: "utility", name,
  activation: { type, value: null, override: false, condition: "" },
  consumption: { scaling: { allowed: false }, spellSlot: true, targets: [spend("itemUses", -shots)] },
  uses: { spent: 0, recovery: [], max: "" }, range: { override: false },
  target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "" }, override: false, prompt: true },
  duration: { units: "inst", concentration: false, override: false }, effects: [], roll: { prompt: false, visible: false, name: "", formula: "" }
});
const reloads = shots => [
  { path: "system.activities.dasReloadAction0", value: reload("dasReloadAction0", "Reload (Action)", "action", shots) },
  { path: "system.activities.dasReloadBonus00", value: reload("dasReloadBonus00", "Reload (Bonus Action)", "bonus", shots) }
];

/** Un effet porté créé sur l'objet. */
const worn = (name, changes) => ({ name, type: "base", transfer: true, disabled: false, statuses: [], system: { changes } });

/** Armure de vulnérabilité : la donnée écrit « bludegoning » ; la Résistance et la Vulnérabilité contondantes ne s'appliquaient pas. */
const vulnerability = (resists) => ["bludgeoning", "piercing", "slashing"].map(t => change(`system.traits.${t === resists ? "dr" : "dv"}.value`, "add", t));
const vulnerabilityFrom = (resists) => vulnerability(resists).map(c => ((c.value === "bludgeoning") ? { ...c, value: "bludegoning" } : c));

/** Baguette des merveilles : aucune de ses activités ne déclare son action (Magie). */
const WONDER_ACTIVITIES = ["Z62czXwABB7SN1lP", "4h4Aazi3L1MmByOt", "76MvwJBXwm1GbzfW", "F6QdFpERu7c4x6cd", "uDrKgJTXIcF0EM33", "yMZ4RIhJV1jvkKaf",
  "DIkFGxynTge6LTPJ", "Go7QGLKLGLggVcNK", "EhdR11nT5sMOi9h5", "cKz4qaK2elWiFRCS", "2x5DGGxGI3bgymqf", "6kTej94dEVrwxM9D", "hohchQU2VPFVUIWG",
  "R4TuLg6r7fTmIMF9", "Wxry2v7kMU16VG7T"];

/** Chapelet mystique : « lancer un sort de perle prend une action Bonus » — les activités suivent l'action du sort. */
const PRAYER_BEADS = ["SEwmmaZFABa5L61F", "i1xNzPeIb7VkHrh6", "yiGuTjneUv0F9NnC", "xjMwMrJpNfh3HZyP", "FGwlSZAUgTaknnt1", "VBwVZg8g1vPZ1xep"];

export const ITEM_FIXES = Object.freeze({
  // Anneaux de maîtrise élémentaire (un identifiant pour les quatre : content/sources.mjs les sépare). Air : « une Vitesse de vol égale à
  // votre Vitesse » — l'effet ne donne que le vol stationnaire. Terre : Mur de pierre au DD 18 de l'anneau, pas à celui du porteur.
  // Eau : « Aquatique, une Vitesse de nage de 18 m » — aucun effet dans la donnée.
  "ring-of-elemental-command-air": { grantsSpeeds: { fly: "walk" } },
  "ring-of-elemental-command-earth": {
    dataFixes: [{ path: "system.activities.xpuvWA5Jy39MYwCg.spell.challenge", from: { attack: null, save: null, override: false }, value: { attack: null, save: 18, override: true } }]
  },
  "ring-of-elemental-command-water": {
    dataFixes: [{ effect: "dasWaterFocus000", create: worn("Water Focus", [change("system.traits.languages.value", "add", "aquan"), change("system.attributes.movement.swim", "upgrade", 60)]) }]
  },
  // Anneau de rayons X : la sauvegarde ratée vise un effet absent ; « vous subissez un niveau d'Épuisement » (runtime/cure.mjs le monte).
  "ring-of-x-ray-vision": {
    dataFixes: [{ effect: "InZzuugyN8PbtKGR", create: { name: "Exhaustion", type: "base", transfer: false, disabled: false, statuses: ["exhaustion"], system: { changes: [] } } }]
  },
  // Baguettes de métamorphose et des toiles : « dépenser 1 charge » — leurs activités ne consomment rien.
  "wand-of-polymorph": { dataFixes: [{ path: "system.activities.dJ9lbA7B6ysE0Md8.consumption.targets", from: [], value: [spend("itemUses", 1)] }] },
  "wand-of-web": { dataFixes: [{ path: "system.activities.P7PnWcum8exAm2EG.consumption.targets", from: [], value: [spend("itemUses", 1)] }] },
  // Baguette des merveilles : l'action Magie, absente de toutes ses activités (aucun coût compté).
  "wand-of-wonder": { dataFixes: WONDER_ACTIVITIES.map(id => ({ path: `system.activities.${id}.activation.type`, from: "", value: "action" })) },
  // Armes à recharge du Guide : sans activité « Recharger » (le Fusil automatique en a deux), l'arme reste vide.
  "antimatter-rifle": { dataFixes: reloads(2) },
  "laser-pistol": { dataFixes: reloads(50) },
  "laser-rifle": { dataFixes: reloads(30) },
  // Trébuchet : le tir dépense les utilisations de l'activité (aucune) au lieu des charges de l'item que « Charger » remplit.
  "trebuchet": {
    dataFixes: [{ path: "system.activities.GkViNDrZd4rImGoq.consumption.targets", from: [{ type: "activityUses", value: "2", scaling: {} }], value: [spend("itemUses", 2)] }]
  },
  // Attaque à mains nues du Guide : « 1 + modificateur de Force » (celle du Manuel), pas « modificateur + maîtrise ».
  "unarmed-strike": {
    dataFixes: [{
      path: "system.damage.base",
      from: { number: null, denomination: 0, types: ["bludgeoning"], custom: { enabled: true, formula: "@mod + @prof" }, scaling: { number: 1 }, bonus: "" },
      value: { number: null, denomination: null, types: ["bludgeoning"], custom: { enabled: false, formula: "" }, scaling: { number: 1 }, bonus: "1 + @mod" }
    }]
  },
  // Sceptre de puissance seigneuriale : les attaques des boutons ne portent ni le dé de l'arme, ni le modificateur, ni le +3. Bouton 1 :
  // une Épée longue magique « qui inflige 2d6 dégâts de feu de plus » ; bouton 2 : une Hache d'armes (+3) ; bouton 3 : une Lance (+3).
  "rod-of-lordly-might": {
    dataFixes: [
      { path: "system.activities.apuqiDlUPRWfQkhf.damage.parts", from: [part(2, 6, ["fire"], "-3")], value: [part(1, 8, ["slashing"], "@mod"), part(2, 6, ["fire"])] },
      { path: "system.activities.BsQ1WDJiSRkltvi5.damage.parts", from: [part(1, 8, ["slashing"])], value: [part(1, 8, ["slashing"], "@mod + 3")] },
      { path: "system.activities.5Mhd70dNk5UBYbXW.damage.parts", from: [part(1, 10, ["slashing"])], value: [part(1, 10, ["slashing"], "@mod + 3")] },
      { path: "system.activities.CVIAWq4QHDwg2R3U.damage.parts", from: [part(1, 8, ["piercing"])], value: [part(1, 6, ["piercing"], "@mod + 3")] }
    ]
  },
  // Cimeterre de célérité : son attaque est en activation « spéciale » (aucun coût compté) ; « une attaque avec lui par une action Bonus
  // à chacun de vos tours » — l'attaque normale prend sa place dans l'action Attaque, une seconde activité porte l'action Bonus.
  "scimitar-of-speed": {
    dataFixes: [
      { path: "system.activities.bV5R1UvwSlRZ3Ffi.activation.type", from: "special", value: "action" },
      { path: "system.activities.bV5R1UvwSlRZ3Ffi.activation.condition", from: "Action or Bonus Action", value: "" },
      { path: "system.activities.dasSpeedBonusAtk", value: {
        _id: "dasSpeedBonusAtk", type: "attack", name: "Bonus Action Attack",
        activation: { type: "bonus", value: null, override: false, condition: "" },
        consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] }, uses: { spent: 0, recovery: [], max: "" }, range: { override: false },
        target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "" }, override: false, prompt: true },
        duration: { units: "inst", concentration: false, override: false },
        attack: { critical: { threshold: null }, flat: false, type: { value: "", classification: "" }, ability: "", bonus: "" },
        damage: { critical: { bonus: "" }, includeBase: true, parts: [] }, effects: []
      } }
    ]
  },
  // Bâton de surpuissance : « +2 à la CA, aux jets de sauvegarde et aux jets d'attaque de sort » — aucun effet porté dans la donnée.
  "staff-of-power": {
    dataFixes: [{ effect: "dasStaffOfPower0", create: worn("Staff of Power", [change("system.attributes.ac.bonus", "add", "+2"),
      change("system.bonuses.abilities.save", "add", "+2"), change("system.bonuses.msak.attack", "add", "+2"), change("system.bonuses.rsak.attack", "add", "+2")]) }]
  },
  // Bâton de flétrissement : « Désavantage aux tests et sauvegardes de Force et de Constitution » — l'effet Flétri est vide.
  "staff-of-withering": {
    dataFixes: [{ effect: "x0R9R2vD4quIgYy2", path: "system.changes", from: [], value: ["str", "con"].flatMap(a => [
      change(`system.abilities.${a}.check.roll.mode`, "add", "-1"), change(`system.abilities.${a}.save.roll.mode`, "add", "-1")]) }]
  },
  // Heaume scintillant : typé armure légère, il remplaçait l'armure portée (Défense sans armure, Armure du mage, formation) : un objet merveilleux.
  "helm-of-brilliance": { dataFixes: [{ path: "system.type.value", from: "light", value: "wondrous" }] },
  // Bâton de dynamite : le lancer est en portée « personnelle » (la sphère tombait sur le lanceur) ; « lancé jusqu'à 18 m ».
  "dynamite-stick": { ranges: { "8vYrGCuiK0BcQ8k9": { value: 60, units: "ft" }, "4aJqDXopO4psnUXg": { value: 60, units: "ft" } } },
  // Torche : son attaque dépense une utilisation que l'item n'a pas (attaque refusée).
  "torch": {
    dataFixes: [{ path: "system.activities.SouNhSdWdnznKCam.consumption.targets", from: [spend("itemUses", 1)], value: [] }]
  },
  // Huile d'affûtage : « l'arme enduite devient une Arme +3 » — l'enchantement de la donnée expire au bout d'une minute.
  "oil-of-sharpness": {
    dataFixes: ["qwUNBZRXUAvDcqDw", "RcpoKs7oJMugW7ib"].flatMap(effect => [
      { effect, path: "duration.value", from: 60, value: null }, { effect, path: "duration.expiry", from: "turnStart", value: null }])
  },
  // Huile d'insaisissabilité : la verser au sol ne consomme pas la fiole.
  "oil-of-slipperiness": { dataFixes: [{ path: "system.activities.IQsAg45adQPcbS86.consumption.targets", from: [], value: [spend("itemUses", 1)] }] },
  // Potion d'amitié avec les animaux : sauvegarde « DD 13 », pas celle du buveur.
  "potion-of-animal-friendship": {
    dataFixes: [{ path: "system.activities.0Ecazu341cv88FXR.spell.challenge", from: { attack: null, save: null, override: false }, value: { attack: null, save: 13, override: true } }]
  },
  // Potion de lecture des pensées : sans utilisation, la boire ne la consomme pas.
  "potion-of-mind-reading": {
    dataFixes: [{ path: "system.uses.max", from: "", value: "1" }, { path: "system.uses.autoDestroy", from: false, value: true }]
  },
  // Potions de soins (Guide, Heroes of the Borderlands) : portée « personnelle », elles ne relevaient pas un allié à 0 PV ; au contact,
  // comme la Potion de soins majeurs.
  "potion-of-healing": { dataFixes: [{ path: "system.activities.ZyWmXem7zzQwFFcF.range.units", from: "self", value: "touch" }] },
  "superior-potion-of-healing": { dataFixes: [{ path: "system.activities.eT46ucSUynLRTs6N.range.units", from: "self", value: "touch" }] },
  "supreme-potion-of-healing": { dataFixes: [{ path: "system.activities.GsHW5KoST4fZ30YX.range.units", from: "self", value: "touch" }] },
  // Fléchettes empoisonnées (piège) : « 1d3 fléchettes, 1d6 de poison chacune » (puis 2d6, 4d6, 7d6 par fléchette selon le niveau).
  // O2 : une sauvegarde réussie évite toutes les fléchettes (la donnée en donnait la moitié).
  "poisoned-darts": {
    saveDamage: { RvICMGIB0eFj7glp: "none", MSTCr3QSYGyolvAe: "none", dmaXYLZqje000jxt: "none", NDPRYh9wNKYZuDbL: "none" },
    dataFixes: [
      { path: "system.activities.RvICMGIB0eFj7glp.damage.parts", from: DART(["poison"]), value: [formulaPart("(1d3)d6", ["poison"])] },
      { path: "system.activities.MSTCr3QSYGyolvAe.damage.parts", from: [formulaPart("(1d3) * 2d6", ["poison"])], value: [formulaPart("(2 * 1d3)d6", ["poison"])] },
      { path: "system.activities.dmaXYLZqje000jxt.damage.parts", from: [part(4, 6, ["poison"])], value: [formulaPart("(4 * 1d3)d6", ["poison"])] },
      { path: "system.activities.NDPRYh9wNKYZuDbL.damage.parts", from: [part(7, 6, ["poison"])], value: [formulaPart("(7 * 1d3)d6", ["poison"])] }
    ]
  },
  "armor-of-vulnerability": {
    dataFixes: [["4JvSdW6SAx9uNYFH", "bludgeoning"], ["4htDgvx8qAmPJhBP", "slashing"], ["DiTXdHv9zE9HriKI", "piercing"]].map(([effect, type]) => ({
      effect, path: "system.changes", from: vulnerabilityFrom(type), value: vulnerability(type) }))
  },
  // Ceinturon des nains : son effet unique est livré désactivé.
  // O2 : « Avantage aux sauvegardes contre l'état Empoisonné ».
  "belt-of-dwarvenkind": { saveAdvantage: ["poisoned"], dataFixes: [{ effect: "HNruvcSEl25DRvjj", path: "disabled", from: true, value: false }] },
  // Cape du prestidigitateur : « une fois par jour » — l'activité ne dépense pas l'utilisation.
  "cape-of-the-mountebank": { dataFixes: [{ path: "system.activities.qsuojT0nn8ZkAY19.consumption.targets", from: [], value: [spend("itemUses", 1)] }] },
  // Cape de la chauve-souris : « une Vitesse de vol de 12 m » — l'effet de vol n'en donne aucune.
  "cloak-of-the-bat": {
    dataFixes: [{ effect: "LOByj7F1KjZdSUMi", path: "system.changes", from: [], value: [change("system.attributes.movement.fly", "upgrade", 40)] }]
  },
  // Œil et Main de Vecna : « 7d6 dégâts nécrotiques, moitié sur une réussite » — l'activité n'a aucune part de dégâts.
  "eye-and-hand-of-vecna": { dataFixes: [{ path: "system.activities.Bgj4VKh3jykOu3P6.damage.parts", from: [], value: [part(7, 6, ["necrotic"])] }] },
  // Gemme de vision : la clé « trueseight » n'existe pas ; la Vision véritable de 36 m.
  "gem-of-seeing": {
    dataFixes: [{ effect: "z8fm5PbP5qz4iJuP", path: "system.changes", from: [change("system.attributes.senses.trueseight", "upgrade", 120)],
      value: [change("system.attributes.senses.ranges.truesight", "upgrade", 120)] }]
  },
  // Gants de nage et d'escalade : « des Vitesses d'escalade et de nage égales à votre Vitesse » — l'effet ajoute 1 ft (le moteur prenait
  // ce pied pour une vraie Vitesse d'escalade) : accordées à part, l'effet garde le +5 en Athlétisme.
  "gloves-of-swimming-and-climbing": {
    grantsSpeeds: { climb: "walk", swim: "walk" },
    dataFixes: [{ effect: "Nh870Ujh6Eqy0RFi", path: "system.changes",
      from: [change("system.skills.ath.bonuses.check", "add", 5), change("system.attributes.movement.climb", "add", 1), change("system.attributes.movement.swim", "add", 1)],
      value: [change("system.skills.ath.bonuses.check", "add", 5)] }]
  },
  // Heaume de télépathie : Suggestion « une fois, jusqu'à la prochaine aube ».
  "helm-of-telepathy": {
    dataFixes: [
      { path: "system.activities.KeNwSWKR7BsH8e9G.uses", from: { spent: 0, recovery: [], max: "" }, value: { spent: 0, recovery: [{ period: "dawn", type: "recoverAll" }], max: "1" } },
      { path: "system.activities.KeNwSWKR7BsH8e9G.consumption.targets", from: [], value: [spend("activityUses", 1)] }
    ]
  },
  // Liens de fer de Bilarro : « ne peut plus servir avant la prochaine aube ».
  "iron-bands-of-bilarro": {
    dataFixes: [
      { path: "system.uses", from: { spent: 0, recovery: [], max: "" }, value: { spent: 0, recovery: [{ period: "dawn", type: "recoverAll" }], max: "1" } },
      { path: "system.activities.YvxUL75GlG2OoFMg.consumption.targets", from: [], value: [spend("itemUses", 1)] }
    ]
  },
  // Pierre de Ioun de vigilance : « Avantage aux jets d'Initiative et aux tests de Sagesse (Perception) » — seule l'Initiative y était.
  "awareness-ioun-stone": {
    dataFixes: [{ effect: "P2rx8Fq56YpwQfSm", path: "system.changes", from: [change("flags.dnd5e.initiativeAdv", "override", 1)],
      value: [change("flags.dnd5e.initiativeAdv", "override", 1), change("system.skills.prc.roll.mode", "add", 1)] }]
  },
  // Pierre de Ioun de vigueur : « +2 en Constitution » — la donnée augmente la Force.
  "fortitude-ioun-stone": {
    dataFixes: [{ effect: "hOigjfupZtZR2cy9", path: "system.changes",
      from: [change("system.abilities.str.value", "add", 2), change("system.abilities.str.value", "downgrade", 20)],
      value: [change("system.abilities.con.value", "add", 2), change("system.abilities.con.value", "downgrade", 20)] }]
  },
  // Flasque de fer : « une créature que vous voyez à 18 m » — la donnée dit « personnelle ».
  "iron-flask": { ranges: { UVei1X4pYM1VZDWv: { value: 60, units: "ft" } } },
  "necklace-of-prayer-beads": {
    dataFixes: PRAYER_BEADS.flatMap(id => [
      { path: `system.activities.${id}.activation.type`, from: "action", value: "bonus" },
      { path: `system.activities.${id}.activation.override`, from: false, value: true }])
  },
  // Chien d'onyx : l'effet du molosse est transféré au porteur de la figurine (vision aveugle de 18 m).
  "onyx-dog-rare": { dataFixes: [{ effect: "fMC3o8l8D2GamPbU", path: "transfer", from: true, value: false }] },
  // Orbe des dragons : « 7 charges, 1d4 + 3 à l'aube » — l'item n'en a aucune, ses sorts payants étaient refusés.
  "orb-of-dragonkind": {
    dataFixes: [{ path: "system.uses.max", from: "", value: "7" }, { path: "system.uses.recovery", from: [], value: [{ period: "dawn", type: "formula", formula: "1d4 + 3" }] }]
  },
  // Amulette de cicatrisation : « un jet de 9 ou moins aux jets contre la mort devient 10 » — aucun effet.
  "periapt-of-wound-closure": {
    dataFixes: [{ effect: "dasPeriaptWound0", create: worn("Periapt of Wound Closure", [change("system.attributes.death.roll.min", "upgrade", 10)]) }]
  },
  // Robe aux étoiles : « +1 aux jets de sauvegarde » — aucun effet.
  "robe-of-stars": { dataFixes: [{ effect: "dasRobeOfStars00", create: worn("Robe of Stars", [change("system.bonuses.abilities.save", "add", "+1")]) }] },
  // Manuel de vivacité : « Lire » renvoie à un effet qui n'est pas celui de l'item ; le bénéfice vient au bout de 48 heures de lecture (au MJ).
  "manual-of-quickness-of-action": { dataFixes: [{ path: "system.activities.MeBH48FuUmQFEhUM.effects", from: [{ _id: "9npFjYvEL3twc99F" }], value: [] }] },
  // Épée acérée : « 14 dégâts tranchants de plus » sur un 20 — la donnée les met en nécrotique.
  "sword-of-sharpness": {
    dataFixes: [{ effect: "nxid1s2CZrB06HH8", path: "system.changes", from: SHARPNESS("14d1[necrotic]"), value: SHARPNESS("14[slashing]") }]
  },
  // Filet : l'activité renvoie à un effet absent (« Caught in Net » a un autre id) ; « remplace une des attaques de l'action Attaque ».
  // O2 : « une créature de taille Très grande ou supérieure réussit automatiquement ».
  "net": {
    replacesAttack: ["3u15g2fvhp6MyN5O"],
    targets: { unaffectedIf: { not: { "target.sizeAtMost": "lg" } } },
    dataFixes: [{ path: "system.activities.3u15g2fvhp6MyN5O.effects", from: [{ _id: "cMQAYD7OnCQK6Ux9", onSave: false }], value: [{ _id: "67ofG0FVqrrkAHKa", onSave: false }] }]
  },
  /* ---- O2 (§336) : sauvegardes et défenses, par les clés existantes ---- */

  // « Avantage aux jets de sauvegarde contre les sorts » — porté et harmonisé (adapter/saves.mjs).
  "mantle-of-spell-resistance": { saveAdvantage: ["magic"] },
  "ring-of-spell-turning": { saveAdvantage: ["magic"] },
  "spellguard-shield": { saveAdvantage: ["magic"] },
  "robe-of-the-archmagi": { saveAdvantage: ["magic"] },
  "scarab-of-protection": { saveAdvantage: ["magic"] },
  "staff-of-the-magi": { saveAdvantage: ["magic"] },
  "ebonbane": { saveAdvantage: ["magic"] },
  // « Avantage aux sauvegardes contre l'état Empoisonné ».
  "necklace-of-adaptation": { saveAdvantage: ["poisoned"] },
  "periapt-of-health": { saveAdvantage: ["poisoned"] },
  // Antidote : « Avantage aux sauvegardes contre l'état Empoisonné pendant 1 heure » — l'effet posé est vide ; il porte désormais la
  // marque que lit adapter/saves.mjs (la fiole est souvent consommée avant que l'effet ne soit posé).
  "antitoxin": {
    dataFixes: [{ effect: "DzWVacNiq6ggXbU9", path: "system.changes", from: [], value: [change("flags.dnd5e-combat.saveAdvantage.poisoned", "override", true)] }]
  },
  // Anneau de chaleur constante : « les dégâts de froid que vous subissez sont réduits de 2d8 ».
  "ring-of-warmth": { damageShield: { worn: "cold", formula: "2d8" } },
  // Eau bénite : « sur une réussite, aucun dégât » (la donnée en donnait la moitié).
  "holy-water": { saveDamage: { ArV3jMOIvfj5c5y9: "none" } },
  // Teinture pâle : rien sur une réussite ; l'effet Empoisonné n'était pas relié à la sauvegarde.
  "pale-tincture": {
    saveDamage: { Xm0k8JLnz00jgCg7: "none" },
    dataFixes: [{ path: "system.activities.Xm0k8JLnz00jgCg7.effects", from: [], value: [{ _id: "o6ZuvxhWeXsg50MH", onSave: false }] }]
  },
  // Dard de Lolth : Inconscient « si le jet est raté de 5 ou plus » ; Empoisonné sur tout échec.
  "lolths-sting": { failMargins: { zEQTKqd3uBj660cR: { min: 5 } } },
  // Sceptre-tentacule : la sauvegarde d'Entravé n'inflige rien ; les 3d6 viennent au début des tours de la cible (lot O3).
  "tentacle-rod": { noDamage: ["yuASV7hKz3sa7L5P"] },
  // Poudre à éternuer : « les Artificiels, Élémentaires, Vases, Plantes et Morts-vivants réussissent automatiquement ».
  "dust-of-sneezing-and-choking": { targets: { unaffectedIf: { any: ["construct", "elemental", "ooze", "plant", "undead"].map(t => ({ "target.creatureType": t })) } } },
  // Baume de Keoghtom : « met fin à l'état Empoisonné ».
  "keoghtoms-ointment": { curesAll: ["poisoned"] },
  // Talismans : Désavantage à la sauvegarde pour les Fiélons et Morts-vivants (bien ultime), les Célestes (mal absolu).
  "talisman-of-pure-good": { saveDisadvantageFor: ["fiend", "undead"] },
  "talisman-of-ultimate-evil": { saveDisadvantageFor: ["celestial"] },

  // Morsure de Harkon (Ravenloft) : « +1 aux tests et sauvegardes tant que vous portez le collier » — l'effet n'est pas transféré.
  "harkons-bite": { dataFixes: [{ effect: "EzuxTW39OtnDWoi1", path: "transfer", from: false, value: true }] }
});

/** Les changements de l'enchantement de l'Épée acérée (seule la part de critique change). */
function SHARPNESS(critical) {
  return [
    change("name", "override", "{} of Sharpness"), change("system.rarity", "override", "veryRare"),
    change("system.description.value", "override", "{}<p>@Embed[Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgSwordOfSharpn caption=false]</p>"),
    change("system.properties", "add", "mgc"), change("system.attunement", "override", "required"),
    change("activities[attack].damage.critical.bonus", "add", critical),
    change("system.price.value", "add", 40000), change("system.price.denomination", "override", "gp")
  ];
}
