/**
 * O1 (SPEC §335) : défauts de la donnée d'un objet premium que le moteur corrige — coût d'une activité, charges, DD fixe, parts de
 * dégâts, changements d'un effet porté, effet manquant. Clé de contenu `dataFixes`, par identifiant :
 *   [{ path, value, from? }]                    un champ de l'item (`system.activities.<id>.activation.type` pour une activité)
 *   [{ effect, path, value, from? }]            un champ d'un effet de l'item (`system.changes`, `transfer`, `disabled`, `duration`)
 *   [{ effect, create }]                        l'effet manquant, créé avec cet id (`create` : ses données, sans `_id`)
 * Une correction ne s'applique que si sa cible existe (l'activité, l'effet), que le champ diffère déjà de `value`, et, avec `from`,
 * qu'il vaut encore exactement `from` : une donnée modifiée à la main ne bouge pas. Un tableau se remplace en entier.
 * Écrit par le MJ actif à la création de l'objet (runtime/data-fixes.mjs) et par le diagnostic pour ce qui existe déjà.
 */

/** Un champ d'une activité, qui doit exister (une activité entière, elle, peut être ajoutée : « Recharger »). */
const ACTIVITY_PATH = /^system\.activities\.([A-Za-z0-9]{16})\./;

/** Lecture d'un chemin à points dans un objet simple. */
export function getPath(object, path) {
  return String(path).split(".").reduce((o, k) => ((o === null) || (o === undefined)) ? undefined : o[k], object);
}

/** Égalité de valeurs JSON (ordre des clés d'objet indifférent, ordre des tableaux compté). */
export function sameValue(a, b) {
  if ( a === b ) return true;
  if ( (a === null) || (b === null) || (typeof a !== "object") || (typeof b !== "object") ) return false;
  if ( Array.isArray(a) !== Array.isArray(b) ) return false;
  if ( Array.isArray(a) ) return (a.length === b.length) && a.every((v, i) => sameValue(v, b[i]));
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(k => sameValue(a[k], b[k]));
}

/**
 * La donnée ressemble-t-elle à l'origine déclarée ? Un objet est comparé sur les seules clés que `from` déclare (dnd5e complète la donnée
 * de valeurs par défaut à la création) ; un tableau, élément par élément et de même longueur ; le reste, à l'identique.
 */
export function matchesFrom(current, from) {
  // Un champ nul n'est pas enregistré dans la donnée source : absent vaut null.
  if ( from === null ) return (current === null) || (current === undefined);
  if ( typeof from !== "object" ) return sameValue(current, from);
  if ( Array.isArray(from) ) return Array.isArray(current) && (current.length === from.length) && from.every((v, i) => matchesFrom(current[i], v));
  if ( (current === null) || (typeof current !== "object") || Array.isArray(current) ) return false;
  return Object.entries(from).every(([k, v]) => matchesFrom(current[k], v));
}

/** La correction vaut-elle pour ce champ ? (valeur différente, `from` respecté) */
function wanted(current, fix) {
  if ( ("from" in fix) ? !matchesFrom(current, fix.from) : false ) return false;
  return !matchesFrom(current, fix.value);
}

/**
 * Le plan de correction d'un item, d'après sa donnée source (`item.toObject()` : `system`, `effects` en tableau) et ses corrections.
 * @returns {{ item: object, effects: object[], create: object[], fields: string[] }}  `item` : mise à jour à points ; `effects` :
 *   mises à jour d'effets (`{ _id, <chemin>: valeur }`) ; `create` : effets à créer (avec `_id`) ; `fields` : ce qui change, lisible.
 */
export function dataFixPlan(source, fixes) {
  const plan = { item: {}, effects: [], create: [], fields: [] };
  if ( !Array.isArray(fixes) || !source ) return plan;
  const effects = new Map((source.effects ?? []).map(e => [e._id, e]));
  const effectUpdates = new Map();
  for ( const fix of fixes ) {
    if ( fix.effect ) {
      const effect = effects.get(fix.effect);
      if ( fix.create ) {
        if ( !effect && !plan.create.some(e => e._id === fix.effect) ) {
          plan.create.push({ ...structuredClone(fix.create), _id: fix.effect });
          plan.fields.push(`effect ${fix.effect} (created)`);
        }
        continue;
      }
      if ( !effect || !wanted(getPath(effect, fix.path), fix) ) continue;
      const update = effectUpdates.get(fix.effect) ?? effectUpdates.set(fix.effect, { _id: fix.effect }).get(fix.effect);
      update[fix.path] = structuredClone(fix.value);
      plan.fields.push(`effect ${fix.effect}: ${fix.path}`);
      continue;
    }
    const activity = String(fix.path).match(ACTIVITY_PATH)?.[1];
    if ( activity && !source.system?.activities?.[activity] ) continue;
    if ( !wanted(getPath(source, fix.path), fix) ) continue;
    plan.item[fix.path] = structuredClone(fix.value);
    plan.fields.push(fix.path);
  }
  plan.effects = [...effectUpdates.values()];
  return plan;
}

/** Le plan change-t-il quelque chose ? */
export const planIsEmpty = plan => !plan || (!Object.keys(plan.item).length && !plan.effects.length && !plan.create.length);

/** Validation de la clé `dataFixes` d'une entrée : un message par défaut trouvé. */
export function validateDataFixes(fixes, at="") {
  const ok = Array.isArray(fixes) && fixes.length && fixes.every(f => {
    if ( !f || (typeof f !== "object") || Array.isArray(f) ) return false;
    const keys = Object.keys(f);
    if ( "create" in f ) {
      return (typeof f.effect === "string") && /^[A-Za-z0-9]{16}$/.test(f.effect) && f.create && (typeof f.create === "object")
        && !Array.isArray(f.create) && keys.every(k => ["effect", "create"].includes(k));
    }
    if ( ("effect" in f) && !((typeof f.effect === "string") && /^[A-Za-z0-9]{16}$/.test(f.effect)) ) return false;
    return (typeof f.path === "string") && /^[\w.]+$/.test(f.path) && ("value" in f) && (f.effect || /^(system|name)\b/.test(f.path))
      && keys.every(k => ["effect", "path", "value", "from"].includes(k));
  });
  return ok ? [] : [`${at}dataFixes: [{ path, value, from? } | { effect, path, value, from? } | { effect, create }]`];
}
