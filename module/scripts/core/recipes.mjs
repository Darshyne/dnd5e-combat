/**
 * Les recettes (SPEC §114) : les briques du schéma de contenu (core/content.mjs) dites comme un MJ les pense — « des dégâts
 * bonus », « un état à l'échec », « une zone qui dure » — avec des champs simples, et la façon d'en tirer une entrée du schéma.
 * C'est ce qu'un outil sans code (un créateur de contenu, une fenêtre de réglages) lit pour bâtir ses formulaires : il ne
 * connaît ni les moments, ni les étapes, ni leurs contraintes croisées, la recette les pose.
 *
 *   recipes = [{ type: "bonusDamage", values: { formula: "1d6", damageType: "necrotic", scope: "own" } }, …]
 *   buildEntry(recipes, { identifier: "mon-sort" })  →  { entry: { triggers: [...] }, errors: [] }
 *
 * L'entrée produite se valide ensuite comme tout contenu (`validateEntry`) : une recette ne contourne rien.
 *
 * Les champs sont typés par `kind`. Ceux qui dépendent de Foundry ou de dnd5e (types de dégâts, états, activités de l'item)
 * ne portent que leur genre ; l'outil qui les affiche en tire les choix (CONFIG, l'item en cours). Libellés :
 * `DND5ECOMBAT.Recette.<type>.Nom` / `.Aide`, `DND5ECOMBAT.Recette.Champ.<champ>`, `DND5ECOMBAT.Recette.Valeur.<valeur>`,
 * `DND5ECOMBAT.Recette.Fait.<fait>` (lang/).
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/** Version du catalogue : monte quand une recette change de champs ou de sens (une création enregistrée la porte). */
export const RECIPES_VERSION = 1;

/** Les genres de champ. */
export const FIELD_KINDS = Object.freeze([
  "formula",      // chaîne de dés de dnd5e (« 1d6 », « @prof »)
  "number",       // nombre positif
  "boolean",
  "choice",       // une valeur parmi `options`
  "multi",        // une ou plusieurs valeurs parmi `options`
  "damageType",   // clé de CONFIG.DND5E.damageTypes
  "status",       // id d'un état (CONFIG.statusEffects)
  "units",        // unité de distance (ft, m)
  "activity",     // id d'une activité de l'item (`activityTypes` : filtre facultatif)
  "effect",       // id d'un effet de l'item
  "condition"     // liste de clauses de faits, voir FACTS
]);

const UNITS = ["ft", "m"];

/**
 * Les faits qu'on peut poser en condition, et la forme de leur argument (`arg`). Un sous-ensemble des faits du moteur
 * (adapter/facts.mjs), ceux qui ont un sens pour un MJ ; le test vérifie qu'ils existent tous. `subject` dit de qui il parle :
 * l'auteur de l'action (`source`), la créature visée (`target`), l'action elle-même (`activity`), les dégâts subis (`damage`).
 *
 * Genres d'argument : `true` (fait vrai, rien à saisir), `status`, `identifier` (identifiant d'item), `creatureType`, `size`,
 * `range` ({ distance, units }), `damageTypes` (liste), `number`, `activityType`, `classLevel` ({ class, level }).
 */
export const FACTS = Object.freeze({
  "activity.isAttack": { subject: "activity", arg: "true" },
  "activity.isMelee": { subject: "activity", arg: "true" },
  "activity.isSpell": { subject: "activity", arg: "true" },
  "activity.isWeapon": { subject: "activity", arg: "true" },
  "activity.type": { subject: "activity", arg: "activityType" },
  "activity.dealsType": { subject: "activity", arg: "damageTypes" },
  "source.hasStatus": { subject: "source", arg: "status" },
  "source.hasEffect": { subject: "source", arg: "identifier" },
  "source.creatureType": { subject: "source", arg: "creatureType" },
  "source.seesTarget": { subject: "source", arg: "true" },
  "source.allyNearTarget": { subject: "source", arg: "range" },
  "source.onOwnTurn": { subject: "source", arg: "true" },
  "source.classLevelAtLeast": { subject: "source", arg: "classLevel" },
  "target.hasStatus": { subject: "target", arg: "status" },
  "target.hasEffect": { subject: "target", arg: "identifier" },
  "target.hasEffectFrom": { subject: "target", arg: "identifier" },
  "target.creatureType": { subject: "target", arg: "creatureType" },
  "target.sizeAtMost": { subject: "target", arg: "size" },
  "target.within": { subject: "target", arg: "range" },
  "target.seesSource": { subject: "target", arg: "true" },
  "target.wounded": { subject: "target", arg: "true" },
  "target.bloodied": { subject: "target", arg: "true" },
  "target.hasTempHp": { subject: "target", arg: "true" },
  "target.hpAtMost": { subject: "target", arg: "number" },
  "damage.hasType": { subject: "damage", arg: "damageTypes" }
});

const ACTIVITY_TYPES = ["attack", "save", "damage", "heal", "utility", "cast", "summon", "enchant", "teleport", "check"];
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
const CREATURE_TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];

/** Les valeurs permises d'un argument de fait, quand elles ne viennent pas de CONFIG (pour l'outil qui affiche). */
export const FACT_ARG_OPTIONS = Object.freeze({ activityType: ACTIVITY_TYPES, size: SIZES, creatureType: CREATURE_TYPES, units: UNITS });

const isObject = v => (typeof v === "object") && (v !== null) && !Array.isArray(v);
const filled = v => (v !== undefined) && (v !== null) && (v !== "");

/** Les codes de problème (`issue`) : chacun a son libellé `DND5ECOMBAT.Recette.Erreur.<code>` (test). */
export const ISSUE_CODES = Object.freeze(["required", "unknownRecipe", "unique", "needsIdentifier", "atLeastOneLimit", "unknownFact",
  "expectNumber", "expectRange", "expectClassLevel", "expectDamageType", "expectValue"]);

/**
 * Un problème relevé en construisant une entrée : `code` et `data` pour qu'un outil le traduise
 * (`DND5ECOMBAT.Recette.Erreur.<code>`), `message` en anglais pour la console et les tests.
 */
function issue(at, code, data, text) {
  return { at, code, data, message: `${at}: ${text}` };
}

/** L'argument d'une clause, mis en forme pour le fait (et ses erreurs). */
function factArg(fact, arg, at, errors) {
  const shape = FACTS[fact];
  switch ( shape.arg ) {
    case "true": return true;
    case "number": {
      const n = Number(arg);
      if ( !Number.isFinite(n) ) errors.push(issue(at, "expectNumber", {}, "a number is expected"));
      return n;
    }
    case "range": {
      const distance = Number(arg?.distance);
      if ( !(Number.isFinite(distance) && (distance > 0)) || !UNITS.includes(arg?.units) ) errors.push(issue(at, "expectRange", {}, "{ distance, units } expected"));
      return { distance, units: arg?.units };
    }
    case "classLevel": {
      const level = Number(arg?.level);
      if ( !filled(arg?.class) || !(Number.isInteger(level) && (level > 0)) ) errors.push(issue(at, "expectClassLevel", {}, "{ class, level } expected"));
      return { class: arg?.class, level };
    }
    case "damageTypes": {
      const list = [arg].flat().filter(filled);
      if ( !list.length ) errors.push(issue(at, "expectDamageType", {}, "at least one damage type"));
      return list;
    }
    default: {
      const options = FACT_ARG_OPTIONS[shape.arg];
      if ( !filled(arg) || (options && ![arg].flat().every(a => options.includes(a))) ) errors.push(issue(at, "expectValue", {}, `a value is expected${options ? ` (${options.join(", ")})` : ""}`));
      return arg;
    }
  }
}

/**
 * Une condition du moteur (core/triggers.mjs, `holds`) à partir de clauses `{ fact, arg?, not? }`, toutes requises.
 * Aucune clause : `null` (pas de condition). Les problèmes vont dans `errors` (voir `issue`).
 */
export function buildCondition(clauses=[], { at="condition", errors=[] }={}) {
  const parts = [];
  (Array.isArray(clauses) ? clauses : []).forEach((c, i) => {
    if ( !isObject(c) || !(c.fact in FACTS) ) return errors.push(issue(`${at}[${i}]`, "unknownFact", { fact: String(c?.fact) }, `unknown fact "${c?.fact}"`));
    const part = { [c.fact]: factArg(c.fact, c.arg, `${at}[${i}]`, errors) };
    parts.push(c.not ? { not: part } : part);
  });
  if ( !parts.length ) return null;
  return parts.length === 1 ? parts[0] : { all: parts };
}

/** Deux conditions (ou `null`) en une. */
function both(a, b) {
  if ( !a ) return b ?? null;
  if ( !b ) return a;
  return { all: [a, b] };
}

/** « Seulement les activités de cet objet » : le fait qui le dit, d'après l'identifiant de la création. */
function ownScope(scope, ctx, errors) {
  if ( scope !== "own" ) return null;
  if ( !filled(ctx?.identifier) ) errors.push(issue("scope", "needsIdentifier", {}, "\"this item only\" needs the item's identifier"));
  return { "activity.identifier": ctx?.identifier };
}

/** Une déclaration de déclencheur, sans clés vides. */
function declaration({ on, via=null, condition=null, ...rest }, steps) {
  const d = { on };
  if ( via ) d.via = via;
  if ( condition ) d.if = condition;
  Object.assign(d, rest);
  d.do = steps;
  return d;
}

/**
 * Le catalogue. Chaque recette : `category` (pour ranger), `fields` (`{ key, kind, required?, default?, options?,
 * activityTypes?, when? }` — `when` : `{ champ: valeur | [valeurs] }`, le champ n'a de sens que si…), `keys` (les clés
 * d'entrée qu'elle produit), `unique` (une seule par objet), `build(values, ctx, errors)` → fragment d'entrée, et `example`
 * (des valeurs qui doivent produire une entrée valide : le test le vérifie).
 */
export const RECIPES = Object.freeze({
  // B2 — Maléfice, Voile spirituel, Attraction de la mort.
  bonusDamage: {
    category: "damage",
    keys: ["triggers"],
    fields: [
      { key: "formula", kind: "formula", required: true },
      { key: "damageType", kind: "damageType", required: true },
      { key: "scope", kind: "choice", options: ["own", "all"], default: "own" },
      { key: "oncePerTurn", kind: "boolean", default: false },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const condition = both(ownScope(v.scope ?? "own", ctx, errors), buildCondition(v.condition, { errors }));
      const extra = v.oncePerTurn ? { oncePerTurn: true } : {};
      return { triggers: [declaration({ on: "preDamageRoll", condition, ...extra }, [{ type: "damage", formula: v.formula, damageType: v.damageType }])] };
    },
    example: { formula: "1d6", damageType: "necrotic", scope: "all", condition: [{ fact: "activity.isAttack" }, { fact: "target.hasEffectFrom", arg: "hex" }] }
  },

  // B6 — Lueurs féeriques (porté par un effet), Tactique de meute (porté par l'objet).
  attackModifier: {
    category: "attack",
    keys: ["triggers"],
    fields: [
      { key: "mode", kind: "choice", options: ["advantage", "disadvantage"], required: true },
      { key: "carrier", kind: "choice", options: ["item", "effect"], default: "item" },
      { key: "scope", kind: "choice", options: ["own", "all"], default: "all", when: { carrier: "item" } },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const viaEffect = v.carrier === "effect";
      const condition = both(viaEffect ? null : ownScope(v.scope ?? "all", ctx, errors), buildCondition(v.condition, { errors }));
      return { triggers: [declaration({ on: "preAttackRoll", via: viaEffect ? "effect" : null, condition }, [{ type: v.mode }])] };
    },
    example: { mode: "advantage", carrier: "effect", condition: [{ fact: "target.hasEffect", arg: "faerie-fire" }, { fact: "source.seesTarget" }] }
  },

  // B7 — Frappe occulte (À terre), « Agrippé au toucher » des monstres.
  outcomeStatus: {
    category: "outcome",
    keys: ["triggers"],
    fields: [
      { key: "on", kind: "choice", options: ["hit", "failedSave"], required: true },
      { key: "status", kind: "status", required: true },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      return { triggers: [declaration({ on: v.on, condition: buildCondition(v.condition, { errors }) }, [{ type: "status", status: v.status }])] };
    },
    example: { on: "failedSave", status: "prone" }
  },

  // B3 — Vague tonnante (poussée), Fouet d'épines (traction).
  forcedMove: {
    category: "outcome",
    keys: ["triggers"],
    fields: [
      { key: "on", kind: "choice", options: ["hit", "failedSave"], required: true },
      { key: "mode", kind: "choice", options: ["push", "pull"], default: "push" },
      { key: "distance", kind: "number", required: true },
      { key: "units", kind: "units", default: "ft" },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const step = { type: "move", mode: v.mode ?? "push", distance: Number(v.distance), units: v.units ?? "ft" };
      return { triggers: [declaration({ on: v.on, condition: buildCondition(v.condition, { errors }) }, [step])] };
    },
    example: { on: "failedSave", mode: "push", distance: 10, units: "ft", condition: [{ fact: "target.sizeAtMost", arg: "lg" }] }
  },

  // B4 — Immobilisation de personne : l'effet posé par l'objet rejoue la sauvegarde.
  repeatSave: {
    category: "effect",
    keys: ["triggers"],
    fields: [
      { key: "moments", kind: "multi", options: ["endOfTurn", "startOfTurn", "isDamaged"], default: ["endOfTurn"], required: true }
    ],
    build(v) {
      return { triggers: [declaration({ on: [v.moments ?? ["endOfTurn"]].flat(), via: "effect" }, [{ type: "resave" }])] };
    },
    example: { moments: ["endOfTurn"] }
  },

  // B8 — Sommeil, Motif hypnotique : l'effet tombe quand son porteur subit des dégâts.
  endsOnDamage: {
    category: "effect",
    keys: ["triggers"],
    fields: [],
    build() {
      return { triggers: [declaration({ on: "isDamaged", via: "effect" }, [{ type: "remove" }])] };
    },
    example: {}
  },

  // B1 — Rayon de lune, Esprits gardiens, Nuage de dagues.
  lastingZone: {
    category: "zone",
    keys: ["triggers"],
    fields: [
      { key: "moments", kind: "multi", options: ["enter", "turnStart", "turnEnd", "moves"], default: ["enter", "turnEnd"], required: true },
      { key: "activity", kind: "activity" }
    ],
    build(v) {
      const step = { type: "replay" };
      if ( filled(v.activity) ) step.activity = v.activity;
      return { triggers: [declaration({ on: [v.moments ?? ["enter", "turnEnd"]].flat() }, [step])] };
    },
    example: { moments: ["enter", "turnEnd"] }
  },

  // B5 — Bouclier (touché), Représailles infernales (blessé, vers l'attaquant), Absorption des éléments.
  reaction: {
    category: "reaction",
    keys: ["triggers"],
    fields: [
      { key: "on", kind: "choice", options: ["isHit", "isDamaged", "isMissed"], required: true },
      { key: "activity", kind: "activity" },
      { key: "target", kind: "choice", options: ["self", "source"], default: "self" },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const step = { type: "use" };
      if ( filled(v.activity) ) step.activity = v.activity;
      if ( v.target === "source" ) step.target = "source";
      return { triggers: [declaration({ on: v.on, condition: buildCondition(v.condition, { errors }) }, [step])] };
    },
    example: { on: "isDamaged", target: "source", condition: [{ fact: "target.seesSource" }] }
  },

  // B9 — Bouclier de feu, Forme corrosive : qui touche le porteur subit des dégâts.
  retaliation: {
    category: "defense",
    keys: ["triggers"],
    fields: [
      { key: "formula", kind: "formula", required: true },
      { key: "damageType", kind: "damageType", required: true },
      { key: "carrier", kind: "choice", options: ["item", "effect"], default: "item" },
      { key: "meleeOnly", kind: "boolean", default: true },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const melee = (v.meleeOnly ?? true) ? { "activity.isMelee": true } : null;
      const condition = both(melee, buildCondition(v.condition, { errors }));
      const via = v.carrier === "effect" ? "effect" : null;
      return { triggers: [declaration({ on: "isHit", via, condition }, [{ type: "damage", to: "source", formula: v.formula, damageType: v.damageType }])] };
    },
    example: { formula: "1d8", damageType: "acid", meleeOnly: true }
  },

  // B13 — Aura de protection, Passage sans trace.
  aura: {
    category: "zone",
    keys: ["aura"],
    unique: true,
    fields: [
      { key: "radius", kind: "number", required: true },
      { key: "units", kind: "units", default: "ft" },
      { key: "affects", kind: "choice", options: ["ally", "enemy", "any"], default: "ally" },
      { key: "includeSelf", kind: "boolean", default: false },
      { key: "effect", kind: "effect" },
      { key: "whileActive", kind: "boolean", default: false }
    ],
    build(v) {
      const aura = { radius: Number(v.radius), units: v.units ?? "ft", affects: v.affects ?? "ally", includeSelf: !!v.includeSelf };
      if ( filled(v.effect) ) aura.effect = v.effect;
      if ( v.whileActive ) aura.whileActive = true;
      return { aura };
    },
    example: { radius: 10, units: "ft", affects: "ally", includeSelf: true }
  },

  // B16 — Morsure empoisonnée : l'attaque qui touche impose la sauvegarde d'une autre activité de l'objet.
  hitThenSave: {
    category: "outcome",
    keys: ["onHit"],
    unique: true,
    fields: [{ key: "save", kind: "activity", activityTypes: ["save"], required: true }],
    build(v) {
      return { onHit: { save: v.save } };
    },
    example: { save: "udF9lrpAQMvL0b9J" }
  },

  // B11 — Foulée brumeuse, Porte dimensionnelle.
  teleport: {
    category: "movement",
    keys: ["teleport"],
    unique: true,
    fields: [
      { key: "distance", kind: "number", required: true },
      { key: "units", kind: "units", default: "ft" },
      { key: "activity", kind: "activity" }
    ],
    build(v) {
      const teleport = { distance: Number(v.distance), units: v.units ?? "ft" };
      if ( filled(v.activity) ) teleport.activity = v.activity;
      return { teleport };
    },
    example: { distance: 30, units: "ft" }
  },

  // B12 — Convocations du PHB : la créature joue après son invocateur, et disparaît avec la concentration.
  summon: {
    category: "summon",
    keys: ["summon"],
    unique: true,
    fields: [
      { key: "initiative", kind: "choice", options: ["after", "own", "none"], default: "after" },
      { key: "endsAtZero", kind: "boolean", default: false }
    ],
    build(v) {
      const summon = { initiative: v.initiative ?? "after" };
      if ( v.endsAtZero ) summon.endsAtZero = true;
      return { summon };
    },
    example: { initiative: "after" }
  },

  // §16.40 — « Une fois à chacun de vos tours », coût d'action changé.
  usageLimit: {
    category: "usage",
    keys: ["usageLimits"],
    fields: [
      { key: "activity", kind: "activity", required: true },
      { key: "oncePerTurn", kind: "boolean", default: true },
      { key: "cost", kind: "choice", options: ["", "action", "bonus", "reaction"], default: "" }
    ],
    build(v, ctx, errors) {
      const rule = {};
      if ( v.oncePerTurn ?? true ) rule.oncePerTurn = true;
      if ( filled(v.cost) ) rule.cost = v.cost;
      if ( !Object.keys(rule).length ) errors.push(issue("usageLimit", "atLeastOneLimit", {}, "at least one limit"));
      return { usageLimits: { [v.activity]: rule } };
    },
    example: { activity: "7nAgPNN2dth7SR0D", oncePerTurn: true }
  },

  // Effets de l'objet qui tombent au repos (Armure de mage : repos long).
  effectsExpire: {
    category: "effect",
    keys: ["effectsExpire"],
    unique: true,
    fields: [{ key: "rest", kind: "choice", options: ["longRest", "shortRest"], default: "longRest" }],
    build(v) {
      return { effectsExpire: v.rest ?? "longRest" };
    },
    example: { rest: "longRest" }
  }
});

/** Les clés d'entrée qu'un outil sans code peut produire (les autres restent au contenu écrit à la main). */
export const PUBLIC_KEYS = Object.freeze(Array.from(new Set(Object.values(RECIPES).flatMap(r => r.keys))));

/** Les champs requis vides d'une recette. */
function missing(recipe, values, errors) {
  for ( const f of recipe.fields ) {
    if ( !f.required ) continue;
    if ( f.when && !Object.entries(f.when).every(([k, want]) => [want].flat().includes(values[k] ?? recipe.fields.find(x => x.key === k)?.default)) ) continue;
    const v = values[f.key] ?? f.default;
    if ( !filled(v) || (Array.isArray(v) && !v.length) ) errors.push(issue(f.key, "required", { field: f.key }, "required"));
  }
}

/**
 * L'entrée du schéma tirée d'une liste de recettes. Les déclencheurs s'ajoutent, `usageLimits` se fusionne par activité, une
 * clé `unique` ne vient qu'une fois. `base` : une entrée existante sur laquelle construire (reprise d'un objet), gardée telle
 * quelle — ses déclencheurs passent avant ceux des recettes.
 *
 * Les problèmes sont rendus deux fois : `errors`, des phrases en anglais (console, tests) ; `issues`, de quoi les traduire —
 * `{ recipe, type, at, code, data }`, `recipe` l'indice de la recette, `at` le champ (ou la clause) en cause, `code` une clé
 * de `DND5ECOMBAT.Recette.Erreur`.
 * @param {{type: string, values?: object}[]} recipes
 * @param {{identifier?: string, base?: object|null}} ctx
 * @returns {{entry: object, errors: string[], issues: object[]}}
 */
export function buildEntry(recipes=[], ctx={}) {
  const issues = [];
  const entry = isObject(ctx.base) ? structuredClone(ctx.base) : {};
  const seen = new Set();
  (Array.isArray(recipes) ? recipes : []).forEach((r, i) => {
    const local = [];
    const record = () => issues.push(...local.map(e => ({ recipe: i, type: r?.type ?? null, at: e.at, code: e.code, data: e.data,
      message: `recipes[${i}].${e.message}` })));
    const recipe = RECIPES[r?.type];
    if ( !recipe ) { local.push(issue("type", "unknownRecipe", { type: String(r?.type) }, `unknown recipe "${r?.type}"`)); return record(); }
    if ( recipe.unique && seen.has(r.type) ) { local.push(issue("type", "unique", { type: r.type }, `"${r.type}" only once per item`)); return record(); }
    seen.add(r.type);
    const values = isObject(r.values) ? r.values : {};
    missing(recipe, values, local);
    if ( local.length ) return record();
    const fragment = recipe.build(values, ctx, local);
    record();
    for ( const [key, value] of Object.entries(fragment) ) {
      if ( key === "triggers" ) entry.triggers = [entry.triggers ?? []].flat().concat(value);
      else if ( key === "usageLimits" ) entry.usageLimits = { ...(entry.usageLimits ?? {}), ...value };
      else entry[key] = value;
    }
  });
  return { entry, errors: issues.map(e => e.message), issues };
}
