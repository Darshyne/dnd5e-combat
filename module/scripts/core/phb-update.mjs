/**
 * §438 : ce qui sépare un objet d'une fiche de sa référence du Manuel des joueurs, depuis le Manuel 3.0.0 (identifiants du SRD de dnd5e
 * 6.1, activités et effets refaits). Pur : les deux côtés sont lus en objets simples (adapter : runtime/diagnostic/checks.mjs).
 *
 * Forme lue : `{ identifier, activities: { id: { type, effects: [id], damage: [formule], level: "min-max" } }, effects: { id: [changement] },
 * advancement: nombre }` — rien de ce qui est propre à la fiche (utilisations dépensées, préparation, nom traduit).
 */

/** Les deux listes ont-elles les mêmes éléments, dans n'importe quel ordre ? */
const sameSet = (a, b) => (a.length === b.length) && a.every(x => b.includes(x));

/**
 * Les raisons de remplacer l'objet par sa référence, dans l'ordre : `identifier`, `activities` (ids ajoutés ou retirés), `effects` (idem),
 * `content` (mêmes ids, contenu différent : type, effets posés, dégâts, porte de niveau d'une activité ; changements d'un effet),
 * `advancement` (la référence porte des avancements que l'objet n'a pas — un choix à refaire sur la fiche). Rien : `[]`.
 */
export function phbDifferences(own, reference) {
  const out = [];
  if ( reference.identifier && (own.identifier !== reference.identifier) ) out.push("identifier");
  const ownActs = Object.keys(own.activities ?? {}), refActs = Object.keys(reference.activities ?? {});
  const ownEffs = Object.keys(own.effects ?? {}), refEffs = Object.keys(reference.effects ?? {});
  if ( !sameSet(ownActs, refActs) ) out.push("activities");
  if ( !sameSet(ownEffs, refEffs) ) out.push("effects");
  const shared = (a, b) => a.filter(id => b.includes(id));
  const differs = shared(ownActs, refActs).some(id => JSON.stringify(own.activities[id]) !== JSON.stringify(reference.activities[id]))
    || shared(ownEffs, refEffs).some(id => JSON.stringify(own.effects[id]) !== JSON.stringify(reference.effects[id]));
  if ( differs ) out.push("content");
  if ( (reference.advancement ?? 0) > (own.advancement ?? 0) ) out.push("advancement");
  return out;
}

/**
 * La forme comparée d'un objet (données source, `toObject()` ou `_source`) : ce qui fait son automatisation, pas son état.
 * @param {object} data      `{ system, effects }` de l'objet.
 */
export function phbShape(data) {
  const system = data?.system ?? {};
  const activities = {};
  for ( const [id, a] of Object.entries(system.activities ?? {}) ) {
    activities[id] = {
      type: a?.type ?? null,
      effects: (a?.effects ?? []).map(e => e?.uuid ?? e?._id ?? null).sort(),
      damage: (a?.damage?.parts ?? []).map(p => (p?.custom?.enabled ? p.custom.formula : `${p?.number ?? ""}d${p?.denomination ?? ""}${p?.bonus ? `+${p.bonus}` : ""}`)),
      level: `${a?.visibility?.level?.min ?? ""}-${a?.visibility?.level?.max ?? ""}`
    };
  }
  const effects = {};
  for ( const e of data?.effects ?? [] ) {
    effects[e._id] = (e.system?.changes ?? e.changes ?? []).map(c => `${c.key}|${c.type ?? c.mode ?? ""}|${c.value}`).sort();
  }
  return { identifier: system.identifier ?? "", activities, effects, advancement: Object.keys(system.advancement ?? {}).length };
}

/** Le `sourceItem` d'un sort donné par une sous-classe renommée (`subclass:<ancien>` → `subclass:<nouveau>`), sinon null. */
export function renamedSourceItem(sourceItem, from, to) {
  return (sourceItem === `subclass:${from}`) ? `subclass:${to}` : null;
}

/** Une donnée d'objet cite-t-elle la sous-classe sous son ancien identifiant (`@scale.<id>.`, `@subclasses.<id>.`) ? */
export function citesSubclass(system, identifier) {
  const text = JSON.stringify(system ?? {});
  return text.includes(`@scale.${identifier}.`) || text.includes(`@subclasses.${identifier}.`);
}
