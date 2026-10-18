/**
 * §202 : les effets recopiés d'un compendium par le diagnostic du monde (runtime/diagnostic/checks.mjs). L'effet d'un objet magique
 * porte d'ordinaire le nom de l'objet (« Walloping Ammunition » sur « Walloping Ammunition ») ; une traduction qui traduit le nom de
 * l'objet sans celui de ses effets laissait l'effet recopié en anglais (retour de table du 2026-10-18 : « Projectile percutant »,
 * enchantement « Walloping Ammunition »). Un effet qui porte le nom d'origine (anglais) de l'objet prend son nom affiché.
 *
 * Pur : aucune dépendance à Foundry.
 */

/**
 * @param {object[]} effects        Données d'effets (`toObject()`), modifiées sur une copie.
 * @param {string|null} originalName Le nom d'origine de l'objet de référence (`flags.babele.originalName`), ou null.
 * @param {string} displayName       Le nom de l'objet tel qu'il est montré (traduit).
 * @returns {object[]}
 */
export function localizeEffectNames(effects, originalName, displayName) {
  if ( !originalName || !displayName || (originalName === displayName) ) return effects.map(e => ({ ...e }));
  return effects.map(e => ((e.name === originalName) ? { ...e, name: displayName } : { ...e }));
}

/* -------------------------------------------- */
/*  §203 : textes restés dans la langue d'origine */
/* -------------------------------------------- */

/** Un chemin pointé (« system.description.value ») dans des données simples. */
function at(data, path) {
  return path.split(".").reduce((o, k) => ((o == null) ? undefined : o[k]), data);
}

/** Les champs d'un objet que Babele traduit : clé de sa charge d'origine (`flags.babele.originalPayload`) → chemin. */
export const ITEM_FIELDS = Object.freeze([
  ["name", "name"], ["description", "system.description.value"], ["chat", "system.description.chat"],
  ["udescription", "system.unidentified.description"], ["condition", "system.activation.condition"]
]);
/** Ceux d'une activité (dnd5e 6.0), à l'intérieur de `system.activities.<id>`. */
export const ACTIVITY_FIELDS = Object.freeze([["name", "name"], ["condition", "activation.condition"], ["chatFlavor", "description.chatFlavor"]]);
/** Ceux d'un acteur. */
export const ACTOR_FIELDS = Object.freeze([["name", "name"], ["biography", "system.details.biography.value"]]);

/**
 * Un champ resté dans la langue d'origine : sa valeur est encore exactement celle d'origine (non vide), et la référence traduite
 * en donne une autre. Un texte modifié à la main n'est jamais repris.
 */
const stale = (now, original, translated) => (typeof original === "string") && (original !== "") && (now === original)
  && (typeof translated === "string") && (translated !== "") && (translated !== now);

/**
 * §203 : ce qu'il faut réécrire dans un objet pour reprendre la traduction actuelle de sa référence du compendium.
 * @param {object} current     Les données de l'objet du monde (`toObject()`).
 * @param {object} original    La charge d'origine de la référence (`flags.babele.originalPayload`) : les valeurs non traduites.
 * @param {object} translated  Les données de la référence traduite (`toObject()`).
 * @returns {{ update: Object<string, string>, effects: object[], fields: string[] }}  `update` : chemins → valeurs ; `effects` :
 *   mises à jour d'effets ({ _id, name?, description? }) ; `fields` : les champs repris (pour le compte rendu).
 */
export function retranslateItem(current, original, translated) {
  const update = {};
  const fields = [];
  if ( !current || !original || !translated ) return { update, effects: [], fields };
  for ( const [key, path] of ITEM_FIELDS ) {
    const value = at(translated, path);
    if ( stale(at(current, path), original[key], value) ) { update[path] = value; fields.push(key); }
  }
  for ( const [id, activity] of Object.entries(current.system?.activities ?? {}) ) {
    const orig = original.activities?.[id];
    const tr = translated.system?.activities?.[id];
    if ( !orig || !tr ) continue;
    for ( const [key, path] of ACTIVITY_FIELDS ) {
      const value = at(tr, path);
      if ( stale(at(activity, path), orig[key], value) ) { update[`system.activities.${id}.${path}`] = value; fields.push(`activity.${key}`); }
    }
  }
  // Les effets : Babele les traduit par leur nom d'origine. Celui de la référence qui porte le même id, ou le seul s'il n'y en a qu'un.
  const origEffects = Object.values(original.effects ?? {});
  const refEffects = translated.effects ?? [];
  const effects = [];
  for ( const effect of current.effects ?? [] ) {
    const orig = origEffects.find(o => o?.name === effect.name);
    if ( !orig ) continue;
    const ref = refEffects.find(e => e._id === effect._id) ?? (((refEffects.length === 1) && (origEffects.length === 1)) ? refEffects[0] : null);
    if ( !ref ) continue;
    const change = { _id: effect._id };
    if ( stale(effect.name, orig.name, ref.name) ) change.name = ref.name;
    if ( stale(effect.description, orig.description, ref.description) ) change.description = ref.description;
    if ( Object.keys(change).length > 1 ) { effects.push(change); fields.push("effect"); }
  }
  return { update, effects, fields };
}

/**
 * §203 : la même chose pour un acteur (nom, biographie, nom de son token prototype quand il suivait le nom d'origine). Ses objets
 * sont repris un par un (`retranslateItem`).
 */
export function retranslateActor(current, original, translated) {
  const update = {};
  const fields = [];
  if ( !current || !original || !translated ) return { update, fields };
  for ( const [key, path] of ACTOR_FIELDS ) {
    const value = at(translated, path);
    if ( stale(at(current, path), original[key], value) ) { update[path] = value; fields.push(key); }
  }
  // Le token prototype seulement quand la fiche porte son nom d'origine ou traduit : une fiche renommée à la main (« Gray Ooze
  // Glob », tirée de la Vase grise) garde un token à son nom, pas celui de la créature d'origine.
  const token = translated.prototypeToken?.name || translated.name;
  const named = [original.name, translated.name].includes(current.name);
  if ( named && stale(current.prototypeToken?.name, original.name, token) ) { update["prototypeToken.name"] = token; fields.push("token"); }
  return { update, fields };
}
