/**
 * §181 : les factions — qui est l'ennemi de qui, au-delà de la disposition du token.
 *
 * Un « camp » (side) est ce que l'adaptateur sait d'un token : `{ disposition, faction, uuid, stance }`. La relation entre deux
 * camps vient de la table des factions (réglage de monde + rancunes de la scène) quand **les deux** ont une faction et que la
 * table dit quelque chose de ce couple ; sinon chaque règle garde exactement sa comparaison de dispositions d'avant. Ainsi un
 * monde sans faction, ou un couple que la table laisse à « suivre la disposition », ne change en rien.
 *
 * La table est injectée par l'adaptateur (`useFactionTable`), comme l'aléa : le cœur ne lit aucun réglage.
 */

/** Amical contre Hostile (copie de `reaction.mjs` `areHostile`, sans import croisé). */
function areHostile(a, b) {
  return ((a === 1) && (b === -1)) || ((a === -1) && (b === 1));
}

/** La faction implicite des PJ et de ce que possède un joueur. */
export const PARTY = "party";

/** Les trois relations qu'une case de la matrice peut porter ; absente = suivre la disposition. */
export const RELATIONS = Object.freeze(["hostile", "neutral", "allied"]);

/**
 * Factions génériques proposées (dépôt public : par type de créature, aucun nom de créature). Le nom se traduit par
 * `DCOMBAT.Factions.Generic.<id>`. Elles ne s'appliquent que si le MJ garde les règles par type (réglage `factionRules`).
 */
export const GENERIC_FACTIONS = Object.freeze([
  { id: "wildlife", color: "#6b8e23", rules: { types: ["beast"] } },
  { id: "undead", color: "#5b4b8a", rules: { types: ["undead"] } },
  { id: "aberrations", color: "#8a2b6b", rules: { types: ["aberration"] } },
  { id: "fiends", color: "#a52a2a", rules: { types: ["fiend"] } },
  { id: "monstrosities", color: "#8b5a2b", rules: { types: ["monstrosity"] } },
  { id: "oozes", color: "#3c8d6e", rules: { types: ["ooze"] } },
  { id: "plants", color: "#2e7d32", rules: { types: ["plant"] } }
]);

/**
 * Relations suggérées entre factions génériques (bouton de la matrice, jamais appliquées d'office) : les morts-vivants, les
 * aberrations et les fiélons haïssent tout ce qui n'est pas eux ; le reste s'ignore.
 */
const HATERS = new Set(["undead", "aberrations", "fiends"]);

const EMPTY = Object.freeze({ factions: [], relations: {}, grudges: [] });
let TABLE = EMPTY;

/** La clé d'un couple, indépendante de l'ordre. */
export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Un id de faction : lettres, chiffres, tirets ; pas vide. */
export function validFactionId(id) {
  return (typeof id === "string") && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(id);
}

/**
 * Remettre d'aplomb ce que le réglage contient (le MJ, un import, une ancienne version) : factions valides et uniques, relations
 * connues entre factions connues, `party` toujours présente en tête.
 * @param {object} raw
 * @returns {{factions: object[], relations: Object<string, string>}}
 */
export function normalizeFactions(raw) {
  const seen = new Set([PARTY]);
  const factions = [{ id: PARTY, name: "", color: "#3a7bd5", rules: {}, ...(raw?.factions ?? []).find(f => f?.id === PARTY), id: PARTY }];
  for ( const f of raw?.factions ?? [] ) {
    if ( !f || !validFactionId(f.id) || seen.has(f.id) ) continue;
    seen.add(f.id);
    const rules = {};
    for ( const k of ["types", "subtypes", "identifiers"] ) {
      const list = (f.rules?.[k] ?? []).filter(v => (typeof v === "string") && v.trim()).map(v => v.trim().toLowerCase());
      if ( list.length ) rules[k] = [...new Set(list)];
    }
    factions.push({ id: f.id, name: String(f.name ?? ""), color: /^#[0-9a-f]{6}$/i.test(f.color ?? "") ? f.color : "#888888", rules });
  }
  const relations = {};
  for ( const [key, value] of Object.entries(raw?.relations ?? {}) ) {
    const [a, b] = key.split("|");
    if ( !seen.has(a) || !seen.has(b) || (a === b) || !RELATIONS.includes(value) ) continue;
    relations[pairKey(a, b)] = value;
  }
  return { factions, relations };
}

/** Les relations suggérées pour ces factions (§181) : à fusionner sous celles que le MJ a déjà posées. */
export function suggestedRelations(factions) {
  const ids = factions.map(f => f.id).filter(id => id !== PARTY);
  const out = {};
  for ( const a of ids ) for ( const b of ids ) {
    if ( a >= b ) continue;
    out[pairKey(a, b)] = (HATERS.has(a) || HATERS.has(b)) ? "hostile" : "neutral";
  }
  return out;
}

/**
 * La faction qu'une règle donne à une créature, d'après ses faits (type, sous-type, identifiant de l'acteur) : la première qui
 * correspond, dans l'ordre de la liste ; un identifiant l'emporte sur un sous-type, qui l'emporte sur un type.
 * @param {object[]} factions
 * @param {{type?: string, subtype?: string, identifier?: string}} facts
 * @returns {string|null}
 */
export function factionByRules(factions, { type, subtype, identifier }={}) {
  const low = v => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const subtypes = low(subtype).split(/[,;/]+/).map(s => s.trim()).filter(Boolean);
  for ( const key of ["identifiers", "subtypes", "types"] ) {
    for ( const f of factions ) {
      if ( f.id === PARTY ) continue;
      const list = f.rules?.[key] ?? [];
      if ( !list.length ) continue;
      if ( (key === "identifiers") && identifier && list.includes(low(identifier)) ) return f.id;
      if ( (key === "subtypes") && subtypes.some(s => list.includes(s)) ) return f.id;
      if ( (key === "types") && type && list.includes(low(type)) ) return f.id;
    }
  }
  return null;
}

/**
 * La table que le cœur consulte. `relations` : clé `pairKey` → relation ; `grudges` : couples `[a, b]` d'ids de faction ou
 * d'uuid de token devenus hostiles sur la scène (rancune). Appelée par l'adaptateur à chaque changement.
 */
export function useFactionTable(table) {
  TABLE = table ? { factions: table.factions ?? [], relations: table.relations ?? {}, grudges: table.grudges ?? [] } : EMPTY;
}

/** La table en cours (tests, API). */
export function factionTable() {
  return TABLE;
}

/** Une rancune lie-t-elle ces deux camps ? Par faction ou par token. */
function grudged(a, b, grudges) {
  if ( !grudges.length ) return false;
  const ids = s => [s.faction, s.uuid ?? ((typeof s.token === "string") ? s.token : null)].filter(Boolean);
  const idsA = ids(a), idsB = ids(b);
  return grudges.some(([x, y]) => (idsA.includes(x) && idsB.includes(y)) || (idsA.includes(y) && idsB.includes(x)));
}

/**
 * La relation des factions entre deux camps, ou null quand elle ne dit rien (il faut alors suivre la disposition).
 * @param {{faction?: string|null, uuid?: string|null, stance?: string|null}} a
 * @param {typeof a} b
 * @param {object} [table]
 * @returns {"hostile"|"neutral"|"allied"|null}
 */
export function factionRelation(a, b, table=TABLE) {
  if ( !a || !b ) return null;
  const same = !!a.faction && (a.faction === b.faction);
  if ( grudged(a, b, table.grudges ?? []) ) return "hostile";
  // Une créature qui s'est rendue (darsh-npc, moral) n'est l'ennemie de personne hors de sa faction.
  if ( !same && ((a.stance === "neutral") || (b.stance === "neutral")) ) return "neutral";
  if ( !a.faction || !b.faction ) return null;
  if ( same ) return a.faction === PARTY ? null : "allied";
  const value = table.relations?.[pairKey(a.faction, b.faction)];
  return RELATIONS.includes(value) ? value : null;
}

/** Ennemis ? Sans relation de faction : Amical contre Hostile, comme `areHostile`. */
export function hostileSides(a, b) {
  const r = factionRelation(a, b);
  return r ? r === "hostile" : areHostile(a?.disposition, b?.disposition);
}

/** Même camp ? Sans relation de faction : même disposition. */
export function alliedSides(a, b) {
  const r = factionRelation(a, b);
  return r ? r === "allied" : (a?.disposition === b?.disposition);
}

/**
 * Pour le ciblage (`targeting.mjs` `relationOf`) : « same », « opposed » ou « neutral ». Sans relation de faction, la règle
 * des dispositions d'avant (un neutre ou un secret : « neutral »).
 */
export function targetRelation(a, b) {
  const r = factionRelation(a, b);
  if ( !r ) {
    const mine = a?.disposition, theirs = b?.disposition;
    if ( ![1, -1].includes(mine) || ![1, -1].includes(theirs) ) return "neutral";
    return mine === theirs ? "same" : "opposed";
  }
  return r === "allied" ? "same" : (r === "hostile" ? "opposed" : "neutral");
}

/** La disposition qu'une relation explicite avec les PJ impose (1, 0, -1), ou null quand elle suit le token. */
export function dispositionFor(faction, table=TABLE) {
  if ( !faction || (faction === PARTY) ) return null;
  const value = table.relations?.[pairKey(faction, PARTY)];
  return { hostile: -1, neutral: 0, allied: 1 }[value] ?? null;
}
