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

/** O3 : le Charmé des anneaux de maîtrise élémentaire dure « jusqu'au début de votre prochain tour » (la donnée compte un tour de n'importe qui). */
const CHARMED_UNTIL_NEXT_TURN = Object.freeze({ cN85nWiTzfGzWR7D: "casterTurnStart" });

/** O7 : Fléau élémentaire — « Avantage aux jets d'attaque contre les Élémentaires, qui ont le Désavantage aux leurs contre vous ». */
const ELEMENTAL_BANE = Object.freeze([
  { on: "preAttackRoll", if: { "target.creatureType": "elemental" }, do: [{ type: "advantage" }] },
  { on: "preAttackRoll", defends: true, if: { "source.creatureType": "elemental" }, do: [{ type: "disadvantage" }] }
]);

/** §346 : le clair de lune de l'Épée sélène ; des flammes sur une lame (animation « torch » du cœur). */
const MOONLIGHT = Object.freeze({ bright: 15, dim: 30, units: "ft" });
const FLAMES = Object.freeze({ type: "torch", speed: 2, intensity: 2 });

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
  "ring-of-elemental-command-air": { grantsSpeeds: { fly: "walk" }, effectEnds: CHARMED_UNTIL_NEXT_TURN, triggers: ELEMENTAL_BANE },
  "ring-of-elemental-command-earth": {
    effectEnds: CHARMED_UNTIL_NEXT_TURN, triggers: ELEMENTAL_BANE,
    dataFixes: [{ path: "system.activities.xpuvWA5Jy39MYwCg.spell.challenge", from: { attack: null, save: null, override: false }, value: { attack: null, save: 18, override: true } }]
  },
  // O3 : Coercition élémentaire, « Charmé jusqu'au début de votre prochain tour ».
  "ring-of-elemental-command-fire": { effectEnds: CHARMED_UNTIL_NEXT_TURN, triggers: ELEMENTAL_BANE },
  "ring-of-elemental-command-water": {
    effectEnds: CHARMED_UNTIL_NEXT_TURN, triggers: ELEMENTAL_BANE,
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
  // O8h (§351) : et sa portée minimale (« ne peut pas toucher une cible à 18 m ou moins »), comme le Mangonneau plus bas.
  "trebuchet": {
    minRange: { value: 60, units: "ft" },
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
  // O9a (§354) : « utilisée comme une arme courante de corps à corps » — dnd5e n'ajoute pas la maîtrise à l'attaque d'un consommable
  // (`@prof` y vaut 0 : la maîtrise de l'item) ; celle du personnage.
  "torch": {
    dataFixes: [
      { path: "system.activities.SouNhSdWdnznKCam.consumption.targets", from: [spend("itemUses", 1)], value: [] },
      { path: "system.activities.SouNhSdWdnznKCam.attack.bonus", from: "", value: "@attributes.prof" }
    ]
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
    ],
    // O9a (§354) : « une créature qui peut toucher les liens, l'Entravée comprise, peut prendre une action pour un test de Force
    // (Athlétisme) DD 20 » — celui de l'activité « Break Check » (un nouvel essai raté reste au MJ).
    actionEnds: { IgRS1gR2uBlWZnIK: { by: "bearer", roll: "check" } }
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
  // O4 : comme les autres figurines, le molosse agit juste après son maître.
  "onyx-dog-rare": { summon: { initiative: "after" }, dataFixes: [{ effect: "fMC3o8l8D2GamPbU", path: "transfer", from: true, value: false }] },
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
  // O9e (§358) : « … et les jets d'attaque de sort ont le Désavantage contre vous » (le bouclier tenu).
  "spellguard-shield": { saveAdvantage: ["magic"], triggers: [{ on: "preAttackRoll", defends: true, if: { "activity.isSpell": true }, do: [{ type: "disadvantage" }] }] },
  "robe-of-the-archmagi": { saveAdvantage: ["magic"] },
  "scarab-of-protection": { saveAdvantage: ["magic"] },
  // O9b (§355) : Fléau d'ébène — « quand vous touchez un Céleste ou un Humanoïde, l'attaque inflige aussi 3d6 nécrotiques » ; la donnée les
  // mettait sur chaque coup : retirés de l'attaque, ajoutés au toucher selon le type.
  "ebonbane": {
    saveAdvantage: ["magic"],
    dataFixes: [{ path: "system.activities.SDii9JGqHIjeOxdv.damage.parts", from: [{ number: 3, denomination: 6, types: ["necrotic"] }], value: [] }],
    ...BANE("ebonbane", ["celestial", "humanoid"], "3d6", "necrotic")
  },
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
  // O4 : le lancer « remplace l'une des attaques de l'action Attaque ».
  "holy-water": { saveDamage: { ArV3jMOIvfj5c5y9: "none" }, replacesAttack: ["ArV3jMOIvfj5c5y9"] },
  // Teinture pâle : rien sur une réussite ; l'effet Empoisonné n'était pas relié à la sauvegarde.
  "pale-tincture": {
    saveDamage: { Xm0k8JLnz00jgCg7: "none" },
    // O9a (§354) : « les dégâts du poison ne peuvent être soignés par aucun moyen tant que la créature est Empoisonnée ».
    blocksHealing: true,
    dataFixes: [
      { path: "system.activities.Xm0k8JLnz00jgCg7.effects", from: [], value: [{ _id: "o6ZuvxhWeXsg50MH", onSave: false }] },
      // O9a (§354) : le « PV maximum + 0 » de la donnée (à régler à la main) tombait à 0 une fois appliqué : la cible mourait. Retiré,
      // `blocksHealing` fait le travail.
      { effect: "o6ZuvxhWeXsg50MH", path: "system.changes", from: [{ key: "system.attributes.hp.max", value: 0, type: "add" }], value: [] }
    ]
  },
  // Dard de Lolth : Inconscient « si le jet est raté de 5 ou plus » ; Empoisonné sur tout échec.
  // O3 : « se réveille si elle subit des dégâts ou si une autre créature la secoue (une action) » — Empoisonné reste.
  "lolths-sting": {
    failMargins: { zEQTKqd3uBj660cR: { min: 5 } },
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: "zEQTKqd3uBj660cR", do: [{ type: "remove" }] }],
    actionEnds: { zEQTKqd3uBj660cR: { by: "other", verb: "wake" } }
  },
  // Sceptre-tentacule : la sauvegarde d'Entravé n'inflige rien ; les 3d6 viennent au début des tours de la cible (lot O3).
  // O3 : « 3d6 psychiques au début de chacun de ses tours », sauvegarde répétée à la fin (l'attache à 15 ft et la libération restent au MJ).
  "tentacle-rod": {
    noDamage: ["yuASV7hKz3sa7L5P"],
    triggers: [
      { on: "startOfTurn", via: "effect", fromEffect: "JVnjmXHqpPkyKBXS", do: [{ type: "damage", to: "bearer", activity: "y9MnFdJWUat9KhbD" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "JVnjmXHqpPkyKBXS", do: [{ type: "resave" }] }
    ]
  },
  // Poudre à éternuer : « les Artificiels, Élémentaires, Vases, Plantes et Morts-vivants réussissent automatiquement ».
  // O3 : « refait le jet à la fin de chacun de ses tours ».
  "dust-of-sneezing-and-choking": { includesOrigin: true, triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "AZcO17cLsTHbb0P9", do: [{ type: "resave" }] }], targets: { unaffectedIf: { any: ["construct", "elemental", "ooze", "plant", "undead"].map(t => ({ "target.creatureType": t })) } } },
  // Baume de Keoghtom : « met fin à l'état Empoisonné ».
  "keoghtoms-ointment": { curesAll: ["poisoned"] },
  // Talismans : Désavantage à la sauvegarde pour les Fiélons et Morts-vivants (bien ultime), les Célestes (mal absolu).
  // O9a (§354) : « sur un échec, la cible tombe dans la fissure et est détruite » — Morte ; sur une réussite, les 4d6 de la donnée.
  "talisman-of-pure-good": { saveDisadvantageFor: ["fiend", "undead"], triggers: [{ on: "failedSave", if: { "activity.id": "aXBr8uIgXMNnZdfy" }, do: [{ type: "status", status: "dead" }] }] },
  "talisman-of-ultimate-evil": { saveDisadvantageFor: ["celestial"], triggers: [{ on: "failedSave", if: { "activity.id": "zknPGzuSFtET9BIe" }, do: [{ type: "status", status: "dead" }] }] },

  /* ---- O3 (§337) : fins d'effet, sauvegardes répétées, réveils ---- */

  // « Elle refait le jet à la fin de chacun de ses tours » — Paralysé, Effrayé, Étourdi, Aveuglé, Neutralisé sans fin dans la donnée.
  "wand-of-paralysis": { effectDurations: { AwFDnHD5U7aOOzds: { seconds: 60 } }, triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "AwFDnHD5U7aOOzds", do: [{ type: "resave" }] }] },
  "whelm": { triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "esmyGn6aLpCfWsFm", do: [{ type: "resave" }] }] },
  "gem-of-brightness": { triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "05Lok63szRXdAafx", do: [{ type: "resave" }] }] },
  "pipes-of-haunting": { triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "29Rm9ru4fP60YFj3", do: [{ type: "resave" }] }] },
  // Mucus de charognard rampant : l'effet Paralysé et Empoisonné n'était pas relié à la sauvegarde.
  "carrion-crawler-mucus": {
    triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "a9KfUV3KbbB5wrFY", do: [{ type: "resave" }] }],
    dataFixes: [{ path: "system.activities.StL0A8FviYKfGlQ8.effects", from: [], value: [{ _id: "a9KfUV3KbbB5wrFY", onSave: false }] }]
  },
  // Robe prismatique : « Étourdi jusqu'à la fin de l'effet », la fin de votre prochain tour ; Bâton de tonnerre et de foudre : « jusqu'à la
  // fin de votre prochain tour ».
  "robe-of-scintillating-colors": { effectEnds: { yQoovzqIXdUiUcU4: "casterTurnEnd" } },
  "staff-of-thunder-and-lightning": { effectEnds: { UTstWNbk0NXrKgS6: "casterTurnEnd" } },
  // Poussière de disparition : « juste après une attaque, des dégâts ou un sort, l'état Invisible prend fin pour cette créature ».
  "dust-of-disappearance": { breaksOn: ["attack", "damage", "spell"] },
  // Huile de taggit, Essence d'éther : Empoisonné et Inconscient étaient un seul effet ; la créature « se réveille si elle subit des
  // dégâts » (ou secouée, l'Essence d'éther) et reste Empoisonnée — l'Empoisonné devient un effet à part.
  "oil-of-taggit": SLEEP_POISON("3E9Bg4ZYt098PHwu", "H2a1ShsSWCmSWfW7", "dasTaggitPoison0", 86400),
  "essence-of-ether": SLEEP_POISON("LyJvv1MFK97vRKM5", "izr2j393TujCLu53", "dasEtherPoison00", 28800),

  /* ---- O4 (§338) : coûts, zones, invocations, fumées, lumière ---- */

  // Acide, Feu grégeois : « remplacer l'une des attaques de l'action Attaque par le jet d'une fiole » (l'action entière, sinon).
  "acid": { replacesAttack: ["PnWlLChqr5JsfCJC"] },
  "alchemists-fire": { replacesAttack: ["NVclbplLi9uFhKQE"] },
  // Invocations d'objets : la créature « agit juste après vous » (partage votre initiative) — elles n'entraient pas au combat.
  ...Object.fromEntries(["elemental-gem", "blue-elemental-gem", "emerald-elemental-gem", "red-elemental-gem", "yellow-elemental-gem",
    "baba-yagas-dancing-broom", "bowl-of-commanding-water-elementals", "brazier-of-commanding-fire-elementals",
    "censer-of-controlling-air-elementals", "stone-of-controlling-earth-elementals", "bag-of-tricks", "bronze-griffon-rare", "ebony-fly-rare",
    "golden-lions-rare", "ivory-goats", "marble-elephant-rare", "obsidian-steed-very-rare", "serpentine-owl-rare",
    "silver-raven-uncommon"].map(id => [id, { summon: { initiative: "after" } }])),
  // Cor du Valhalla : les guerriers « lancent leur initiative » et agissent à leur tour.
  "silver-horn-of-valhalla": { summon: { initiative: "own" } },
  // Fumées : « la zone est fortement obscurcie » — Grenade fumigène, Urne fumigène, nuée du Bâton du grand essaim.
  "grenade-smoke": { obscures: true },
  "eversmoking-bottle": { obscures: true },
  "staff-of-swarming-insects": { obscures: true },
  // Masse terrifiante : « chaque créature de votre choix à 9 m de vous » — centrée sur le porteur, alliés épargnés.
  // (O3 : « refait le jet à la fin de chacun de ses tours ».)
  "mace-of-terror": { ranges: { owojSA2KZWmv61Nj: { units: "self" } }, zoneAffects: "enemy",
    triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "amYapIKWPpJZ9EuO", do: [{ type: "resave" }] }] },
  // Carafe intarissable, Geyser : « une créature » dans la ligne, pas toutes.
  // O9a (§354) : Geyser — « sur un échec, la créature tombe À terre » (le texte de la donnée ne pose que les dégâts).
  "decanter-of-endless-water": { zoneMax: 1, zoneAffects: "enemy", triggers: [{ on: "failedSave", if: { "activity.id": "QObmaE8dWI8pIXFE" }, do: [{ type: "status", status: "prone" }] }] },
  // Lanterne de révélation : « brûle 6 heures avec une flasque d'Huile, Lumière vive sur 9 m et faible sur 9 m de plus » (la révélation
  // des créatures invisibles reste au MJ).
  "lantern-of-revealing": { carriedLight: { bright: 30, dim: 60, units: "ft", burn: { value: 6, units: "hour" }, fuel: "oil" } },
  // Sac de haricots magiques (déversé) : l'explosion prend aussi celui qui les verse.
  "bag-of-beans": { includesOrigin: true },

  /* ---- O5b (§340) : dégâts en plus contre un type de créature ---- */

  // Armes enchantées (`<identifiant>-enchanted` : l'arme qui porte l'enchantement, adapter/content.mjs) — Tueuse de dragons : « 3d6 dégâts
  // du type de l'arme de plus si la cible est un Dragon » ; Tueuse de géants : « 2d6 du type de l'arme » contre un Géant (sa sauvegarde
  // contre À terre : lot O5c) ; Vengeresse sacrée : « 2d10 radiants » contre un Fiélon ou un Mort-vivant ; Hache du bourreau : « 2d6
  // tranchants » contre un Humanoïde (les PV temporaires : au MJ).
  // §346 : lumière d'une arme. Épée sélène : « dégainée dans les Ténèbres, la lame répand un clair de lune : Lumière vive sur 4,50 m et
  // faible sur 4,50 m de plus » (dégainer : menu de l'objet), l'objet lui-même ou l'arme qu'il enchante. Langue de feu : « ces flammes
  // répandent une Lumière vive sur 12 m et faible sur 12 m de plus », tant que l'enchantement « Ablaze » est sur l'arme ; flammes du
  // Heaume scintillant (« Burst Into Flames ») : vive sur 3 m, faible sur 3 m de plus.
  "moon-touched-sword": { carriedLight: MOONLIGHT },
  "moon-touched-sword-enchanted": { carriedLight: MOONLIGHT },
  "flame-tongue-enchanted": { carriedLight: { bright: 40, dim: 80, units: "ft", animation: FLAMES, whileEnchanted: "MHnAqxEXBhUbnjPq" } },
  "helm-of-brilliance-enchanted": { carriedLight: { bright: 10, dim: 20, units: "ft", animation: FLAMES, whileEnchanted: "oZBFpi117yOXca3k" } },
  "dragon-slayer-enchanted": BANE("dragon-slayer", ["dragon"], "3d6", "weapon", true),
  // §345 : « …et doit réussir une sauvegarde de Force DD 15 ou tomber À terre » (aucune activité de sauvegarde dans la donnée).
  "giant-slayer-enchanted": { triggers: [...BANE("giant-slayer", ["giant"], "2d6", "weapon", true).triggers,
    { on: "hit", if: { "target.creatureType": "giant" }, do: [{ type: "status", status: "prone", save: { ability: "str", dc: 15 } }] }] },
  "holy-avenger-enchanted": BANE("holy-avenger", ["fiend", "undead"], "2d10", "radiant", true),
  "executioners-axe-enchanted": BANE("executioners-axe", ["humanoid"], "2d6", "slashing", true),
  // Armes qui portent leur propre identifiant — Masse d'anéantissement : « 2d6 radiants » contre un Fiélon ou un Mort-vivant ; Épée
  // radieuse : « 1d8 radiants » contre un Mort-vivant ; Épée de Kas : « 2d10 tranchants » contre un Mort-vivant.
  // O9a (§354) : « à 25 PV ou moins après ces dégâts, sauvegarde de Sagesse DD 15 ou détruite ; sur une réussite, Effrayée » — la donnée
  // posait Effrayé sur un échec et ne détruisait jamais.
  "mace-of-disruption": {
    triggers: [...BANE("mace-of-disruption", ["fiend", "undead"], "2d6", "radiant").triggers,
      { on: "failedSave", if: { "activity.id": "sUoIpd68kJWIxRaU", "target.hpAtMost": 25 }, do: [{ type: "status", status: "dead" }] }],
    savedEffects: ["Z49QSPjltZ1NT28K"]
  },
  // §346 : « la lame lumineuse émet une Lumière vive sur 4,50 m et faible sur 4,50 m de plus » (la lame apparaît et disparaît : menu de
  // l'objet ; régler le rayon par une action Magie reste au MJ).
  "sun-blade": { ...BANE("sun-blade", ["undead"], "1d8", "radiant"), carriedLight: { bright: 15, dim: 30, units: "ft" } },
  "sword-of-kas": BANE("sword-of-kas", ["undead"], "2d10", "slashing"),

  /* ---- O5c (§341) : options au toucher, critiques ---- */

  // Épée acérée (enchantement) : « sur un 20, 14 tranchants de plus et un niveau d'Épuisement » (les 14 : critique de la donnée, lot O1).
  "sword-of-sharpness-enchanted": { triggers: [{ on: "hit", if: { "hit.critical": true }, do: [{ type: "status", status: "exhaustion" }] }] },
  // Bâton percussif : « quand vous touchez, vous pouvez dépenser jusqu'à 3 charges : 1d6 de force par charge » — proposé au jet de dégâts,
  // une charge par proposition (l'activité de dégâts de la donnée coûtait une action).
  "staff-of-striking": { hitRider: { damage: "sviFeLqVM4b4jHvc", item: "staff-of-striking" } },
  // Anneau du bélier : « si l'attaque touche, la cible est repoussée de 1,50 m » (par charge dépensée : une charge, 1,50 m).
  // Dague venimeuse (§345) : « une action Bonus pour enduire la lame ; le poison reste 1 minute ou jusqu'à ce qu'une attaque avec cette
  // arme touche : sauvegarde de Constitution DD 15 ou 2d10 poison et Empoisonné » — la sauvegarde « Poison Save » n'est imposée que sous
  // l'enchantement « Poison Coat », que le coup qui touche retire.
  "dagger-of-venom": { onHit: { save: "VHStJ3hZGwHAHcUQ", whileEnchanted: "f0WvHHwmTfdkF3OP", spends: true } },
  "ring-of-the-ram": { triggers: [{ on: "hit", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }] },

  /* ---- O6 (§342) : réactions d'objets (portés, et harmonisés s'il le faut : adapter/triggers.mjs) ---- */

  // Anneau d'esquive totale : « quand vous ratez une sauvegarde de Dextérité, une Réaction et 1 charge : vous la réussissez ».
  "ring-of-evasion": { rollBonus: { activity: "8uTVtEN7h4Mp33gB", on: ["save"], abilities: ["dex"], succeed: true } },
  // Bâton de l'acrobate : « touché par une attaque, une Réaction et 1 charge : +5 à la CA contre cette attaque » (comme Bouclier).
  "quarterstaff-of-the-acrobat": {
    triggers: [{ on: "isHit", if: { "hit.stoppableBy": 5 }, do: [{ type: "use", activity: "uGF83fO9tijt8I01" }, { type: "penalty", formula: "5" }] }]
  },
  // Gants piégeurs de projectiles : « touché par une attaque à distance ou d'arme lancée, une Réaction : dégâts réduits de 1d10 + Dex ».
  "gloves-of-missile-snaring": {
    triggers: [{ on: "isHit", if: { "activity.isWeapon": true, "activity.isMelee": false }, do: [{ type: "use", activity: "x4IPCLTGbrUwWZxn" }, { type: "reduce" }] }]
  },
  // Bâton du thaumaturge : « une Réaction quand une autre créature lance un sort qui ne cible que vous : le bâton absorbe sa magie, annule
  // son effet et gagne autant de charges que le niveau du sort » (§344). L'explosion au-delà de 50 charges reste au MJ.
  "staff-of-the-magi": { saveAdvantage: ["magic"], triggers: [{ on: "isTargeted", do: [{ type: "use", activity: "QcfPhLX9LBvOnShu" }, { type: "cancel" }] }] },
  // Sceptre d'absorption : « une Réaction pour absorber un sort qui ne cible que vous et ne produit pas de zone d'effet ; son effet est
  // annulé, son énergie stockée » (§344) — l'activité « Absorb Spell » dépense autant d'utilisations que le niveau du sort.
  "rod-of-absorption": { triggers: [{ on: "isTargeted", do: [{ type: "use", activity: "y66MTczY5BQfIonF" }, { type: "cancel" }] }] },
  // O8d (§347) : Bouclier antiprojectiles — « +2 à la CA contre les jets d'attaque à distance, en plus du bonus du bouclier ; quand un
  // attaquant fait un jet d'attaque à distance contre une cible à 1,50 m de vous, vous pouvez prendre une Réaction pour devenir la cible ».
  // L'effet facultatif des données (« Ranged Attack AC Bonus ») reste désactivé : le moteur compte le +2 lui-même.
  "arrow-catching-shield": {
    rangedDefense: { ac: 2 },
    triggers: [{ on: "enemyAttacks", if: { "activity.isAttack": true, "activity.isMelee": false, "target.isSelf": false,
      "target.nearSelf": { distance: 5, units: "ft" } }, do: [{ type: "use", activity: "KZLj6yQjI7Ps1KkW" }, { type: "intercept" }] }]
  },
  // Bouclier d'attraction : Résistance aux dégâts des attaques avec une arme à distance ; malédiction : une telle attaque contre une
  // créature à 3 m du porteur le vise à sa place (la levée de la malédiction reste au MJ).
  "shield-of-missile-attraction": { rangedDefense: { resistance: true, attract: 10 } },
  // O8e (§348) : Hache du berserker — « Désavantage aux jets d'attaque avec les armes autres que celle-ci » (malédiction, harmonisée) ;
  // Arc du serment — « tant que votre ennemi juré vit, Désavantage aux jets d'attaque avec toutes les autres armes » (l'effet « Sworn
  // Enemy » posé par « Swear Oath »). La folie furieuse de la Hache reste au MJ.
  // O9c (§356) : et sa folie furieuse — « chaque fois qu'une autre créature vous blesse : Sagesse DD 15 ou folie furieuse ». Épée
  // vengeresse : même Désavantage avec les autres armes, et « blessé en combat : Sagesse DD 15 ou vous attaquez qui vous a blessé ».
  "berserker-axe-enchanted": { exclusiveWeapon: true, wrath: { kind: "berserk", save: { ability: "wis", dc: 15 } } },
  "sword-of-vengeance-enchanted": { exclusiveWeapon: true, wrath: { kind: "vengeance", save: { ability: "wis", dc: 15 } } },
  // §353 : et contre l'ennemi juré, « Avantage au jet ; la cible ne profite pas d'un abri partiel ou aux trois quarts, et pas de
  // Désavantage à longue portée ». Les 3d6 Perforants : l'activité « Attack Sworn Enemy » des données, à choisir contre lui.
  "oathbow-enchanted": { exclusiveWeapon: { whileEffect: "EWoLqkPJeK9dwYhn" }, swornEnemy: { effect: "EWoLqkPJeK9dwYhn" } },
  // O8f (§349) : invocations hostiles — Le Crâne (Jeu des merveilles) : « un Avatar de la mort apparaît […] disparaît à 0 PV ou à votre
  // mort » ; Parchemin d'invocation de titan : « le titan est Hostile envers toutes les autres créatures et disparaît à 0 PV ». Initiative
  // propre ; « il ne vise que vous » et l'avatar des alliés qui le blessent restent au MJ.
  "skull": { summon: { initiative: "own", hostile: true, vanishesAtZero: true, vanishesWithCaster: true } },
  "scroll-of-titan-summoning": { summon: { initiative: "own", hostile: true, vanishesAtZero: true } },
  // O8h (§351) : armes de siège en tir en cloche — « ne peut pas toucher une cible à 18 m ou moins de lui » (le Trébuchet plus haut ;
  // le tir par-dessus les murs reste au MJ).
  "mangonel": { minRange: { value: 60, units: "ft" } },
  // O9g (§360) : Le Bouffon (Jeu des merveilles) — « Avantage aux Tests d'un d20 pendant 72 h » : l'activité « Card Effect: Advantage » ne
  // posait rien ; un effet de 72 h lui est ajouté (tests de caractéristique, sauvegardes, compétences ; les jets d'attaque restent au MJ).
  "jester": {
    dataFixes: [
      { effect: "dasJesterAdvant0", create: { name: "Jester: Advantage", type: "base", transfer: false, disabled: false, duration: { seconds: 259200 },
        system: { changes: [...["str", "dex", "con", "int", "wis", "cha"].flatMap(a => [
          { key: `system.abilities.${a}.check.roll.mode`, type: "upgrade", value: "1" }, { key: `system.abilities.${a}.save.roll.mode`, type: "upgrade", value: "1" }]),
          ...["acr","ani","arc","ath","dec","his","ins","itm","inv","med","nat","prc","prf","per","rel","slt","ste","sur"].map(k => ({ key: `system.skills.${k}.roll.mode`, type: "upgrade", value: "1" }))] } } },
      { path: "system.activities.6WJ08JWazu3OZign.effects", from: [], value: [{ _id: "dasJesterAdvant0" }] }
    ]
  },
  // O9g (§360) : Anneau d'invisibilité — « une action Magie pour vous donner l'état Invisible » ; la donnée n'a ni activité ni effet :
  // les deux lui sont ajoutés (redevenir visible par une action Bonus, ou en ôtant l'anneau, reste à retirer l'état).
  "ring-of-invisibility": {
    dataFixes: [
      { effect: "dasRingInvisEff0", create: { name: "Invisible", type: "base", transfer: false, disabled: false, statuses: ["invisible"], system: { changes: [] } } },
      { path: "system.activities.dasRingInvisible", value: {
        _id: "dasRingInvisible", type: "utility", name: "Turn Invisible",
        activation: { type: "action", value: null, override: false, condition: "" },
        consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] }, uses: { spent: 0, recovery: [], max: "" },
        range: { override: false, units: "self" },
        target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "self" }, override: false, prompt: false },
        duration: { units: "inst", concentration: false, override: false }, effects: [{ _id: "dasRingInvisEff0" }],
        roll: { prompt: false, visible: false, name: "", formula: "" }
      } }
    ]
  },
  // O9f (§359) : Menottes — « liée, la créature a le Désavantage aux jets d'attaque » ; s'en libérer, l'activité « Escape Check » (le
  // bris, « Burst Check », reste au MJ). Corde d'enchevêtrement — l'Entravée tente l'activité « Escape ».
  "manacles": {
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "hKJK8c3uwhFNdn5m", do: [{ type: "disadvantage" }] }],
    actionEnds: { hKJK8c3uwhFNdn5m: { by: "bearer", roll: "check" } }
  },
  "rope-of-entanglement": { actionEnds: { sYzIZOD83JG2W6wh: { by: "bearer", roll: "check" } } },
  // O9b (§355) : Noirtranchant — « quand vous faites tomber une créature à 0 PV, l'épée la tue et dévore son âme (sauf Créature artificielle
  // ou Mort-vivant) ; vous gagnez des PV temporaires égaux à son maximum de PV » ; Épée voleuse de vie — « sur un 20, 15 nécrotiques en plus
  // (la donnée) et vous gagnez autant de PV temporaires ». Demonomicon d'Iggwilv — « les dégâts de vos sorts contre un Fiélon : le maximum ».
  "blackrazor": { devours: true },
  "sword-of-life-stealing-enchanted": { critFeeds: { amount: 15 } },
  "demonomicon-of-iggwilv": { maxSpellDamageVs: ["fiend"] },
  // O9a (§354) : poisons et pièges — Torpeur : « la Vitesse est divisée par deux tant qu'elle est Empoisonnée ainsi » ; Pierre roulante :
  // « sur un échec, À terre ».
  "torpor": { effectChanges: { "4fBr9e0P9LVogtyq": [{ key: "system.attributes.movement.walk", type: "multiply", value: 0.5 }] } },
  "rolling-stone": { triggers: [{ on: "failedSave", if: { "activity.id": "MLbhL4DqA54XPO0N" }, do: [{ type: "status", status: "prone" }] }] },
  // Voleuse de vie : « une créature de moins de 100 PV […] réussit une sauvegarde de Constitution DD 15 ou est tuée sur le coup ; les
  // Créatures artificielles et les Morts-vivants réussissent d'office » (activité « Life Stealing », jouée sur le 20 naturel ; elle arrive
  // sur l'arme enchantée sous un autre id : la seule sauvegarde de l'arme).
  "nine-lives-stealer-enchanted": { triggers: [{ on: "failedSave", if: { "activity.type": "save", "target.hpAtMost": 99,
    not: { any: [{ "target.creatureType": "construct" }, { "target.creatureType": "undead" }] } }, do: [{ type: "status", status: "dead" }] }] },
  // Sceptre de suzeraineté : « blessée par vous ou vos alliés, la cible cesse d'être Charmée » (comme Charme-personne).
  "rod-of-rulership": { triggers: [{ on: "isDamaged", via: "effect", fromEffect: "x1imiHMHJdzBfnVe", by: "originSide", do: [{ type: "remove" }] }] },
  // §352 : Marteau de tonnerre (posé sur un Maillet d'armes ou un Marteau de guerre) — « si l'attaque lancée touche, la cible et chaque
  // créature à 9 m d'elle autre que vous font une sauvegarde de Constitution DD 17 ou sont Étourdies jusqu'à la fin de votre prochain
  // tour ». L'Étourdi sans sauvegarde des données (« Hurl Hammer ») ne passe jamais (`effectsIf` faux : la cible n'est pas l'auteur) ;
  // le Fléau des géants reste au MJ.
  "hammer-of-thunderbolts-enchanted": {
    effectsIf: { "target.isSelf": true },
    triggers: [{ on: "hit", if: { "activity.isMelee": false }, do: [{ type: "status", status: "stunned", save: { ability: "con", dc: 17 }, around: { radius: 30, units: "ft" } }] }],
    effectEnds: { "status:stunned": "casterTurnEnd" }
  },
  // Pierres de Ioun d'absorption : « une Réaction : un sort de niveau 4 (8) ou moins lancé par une créature que vous voyez est annulé ».
  "absorption-ioun-stone": { counter: { level: 4 }, triggers: [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", activity: "VHm5fPkFAnT7Vb01", target: "source" }] }] },
  "greater-absorption-ioun-stone": { counter: { level: 8 }, triggers: [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", activity: "1yWFZf1MJMoNof7b", target: "source" }] }] },
  // Anneau de feuille morte : « vous descendez de 18 m par round et ne subissez pas de dégâts de chute » — sans Réaction.
  // L'anneau n'a aucune activité : une activité « Feuille morte » sans coût lui est ajoutée (`dataFixes`), proposée à la chute sans Réaction.
  "ring-of-feather-falling": {
    triggers: [{ on: "falls", free: true, do: [{ type: "use", activity: "dasFeatherFall00" }, { type: "cancel" }] }],
    dataFixes: [{ path: "system.activities.dasFeatherFall00", value: {
      _id: "dasFeatherFall00", type: "utility", name: "Feather Fall",
      activation: { type: "special", value: null, override: false, condition: "" },
      consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] }, uses: { spent: 0, recovery: [], max: "" }, range: { override: false },
      target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "" }, override: false, prompt: false },
      duration: { units: "inst", concentration: false, override: false }, effects: [], roll: { prompt: false, visible: false, name: "", formula: "" }
    } }]
  },
  // Lame porte-bonheur (enchantement) : « relancer un Test d20 raté, une utilisation par jour ; le nouveau jet est imposé ».
  "luck-blade-enchanted": { rollBonus: { activity: "tXkbUpFL8jBRLpjM", on: ["attack", "save", "check"], reroll: {} } },

  /* ---- O7 (§343) : défenses passives ---- */

  // Cape de déplacement : « les jets d'attaque contre vous ont le Désavantage » — sauf quand l'effet « Displacement Suppressed » est
  // activé (après des dégâts, jusqu'au début de votre prochain tour : bascule du joueur) ou que vous êtes Neutralisé.
  "cloak-of-displacement": {
    triggers: [{ on: "preAttackRoll", defends: true, if: { not: { any: [{ "target.hasEffect": "cloak-of-displacement" }, { "target.hasStatus": "incapacitated" }] } },
      do: [{ type: "disadvantage" }] }]
  },
  // Bracelets de défense : « +2 à la CA si vous ne portez ni armure ni bouclier » — l'effet restait actif avec une armure.
  "bracers-of-defense": { effectWhile: { ycuTEJoi9a8BO6xg: { if: { unarmored: true } } } },
  // Bouclier sentinelle : « Avantage aux jets d'Initiative et aux tests de Sagesse (Perception) » — seule l'Initiative y était.
  "sentinel-shield": {
    dataFixes: [{ effect: "bHeGysatAXUbusV0", path: "system.changes", from: [change("flags.dnd5e.initiativeAdv", "add", true)],
      value: [change("flags.dnd5e.initiativeAdv", "add", true), change("system.skills.prc.roll.mode", "add", 1)] }]
  },
  // Anneau d'action libre : « la magie ne peut ni réduire votre Vitesse ni vous Paralyser ou vous Entraver » (porté et harmonisé ; la
  // distinction magique / non magique reste au MJ : l'immunité vaut toujours).
  "ring-of-free-action": { grantsConditionImmunities: ["paralyzed", "restrained"] },
  // Chausse-trapes : « sa Vitesse tombe à 0 » — l'effet visait `movement.speed`, valeur que dnd5e recalcule (sans effet).
  "caltrops": { effectChanges: { HsbtDDdiWhk4d7WB: [{ key: "system.attributes.movement.walk", type: "override", value: 0, replace: true }] } },
  // Aiguille empoisonnée : l'effet posé n'a pas l'état Empoisonné.
  "poisoned-needle": { effectStatuses: { waWQ0QcVncE6pU5B: ["poisoned"] } },
  // Le Fou (Jeu de cartes merveilleux) : « Désavantage aux jets de sauvegarde et aux tests pendant 72 heures » — l'effet est vide.
  "fool": { effectChanges: { BkChhqAw5emn7aQp: ["str", "dex", "con", "int", "wis", "cha"].flatMap(a => [
    { key: `system.abilities.${a}.save.roll.mode`, type: "add", value: "-1" }, { key: `system.abilities.${a}.check.roll.mode`, type: "add", value: "-1" }]) } },

  // Morsure de Harkon (Ravenloft) : « +1 aux tests et sauvegardes tant que vous portez le collier » — l'effet n'est pas transféré.
  "harkons-bite": { dataFixes: [{ effect: "EzuxTW39OtnDWoi1", path: "transfer", from: false, value: true }] }
});

/**
 * O5b (§340) : des dégâts en plus quand l'arme touche une créature de ces types — l'arme elle-même (`activity.identifier`), ou l'arme
 * qui porte l'enchantement de cet objet (`activity.enchantedBy`).
 */
function BANE(identifier, types, formula, damageType, enchanted=false) {
  const weapon = enchanted ? { "activity.enchantedBy": identifier } : { "activity.identifier": identifier };
  const target = (types.length > 1) ? { any: types.map(t => ({ "target.creatureType": t })) } : { "target.creatureType": types[0] };
  return { triggers: [{ on: "preDamageRoll", if: { "activity.isAttack": true, ...weapon, ...target }, do: [{ type: "damage", formula, damageType }] }] };
}

/** O3 : un poison qui endort — l'Inconscient se lève sur dégâts ou secoué, l'Empoisonné reste son effet propre. */
function SLEEP_POISON(activity, sleep, poison, seconds) {
  return {
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: sleep, do: [{ type: "remove" }] }],
    actionEnds: { [sleep]: { by: "other", verb: "wake" } },
    dataFixes: [
      { effect: sleep, path: "statuses", from: ["poisoned", "unconscious"], value: ["unconscious"] },
      { effect: sleep, path: "name", from: "Poisoned and Unconscious", value: "Unconscious" },
      { effect: poison, create: { name: "Poisoned", type: "base", transfer: false, disabled: false, statuses: ["poisoned"],
        duration: { value: seconds, units: "seconds", expiry: "turnStart" }, system: { changes: [] } } },
      { path: `system.activities.${activity}.effects`, from: [{ _id: sleep }], value: [{ _id: sleep, onSave: false }, { _id: poison, onSave: false }] }
    ]
  };
}

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
