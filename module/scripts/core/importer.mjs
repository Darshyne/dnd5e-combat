/**
 * Les importeurs d'objets que le diagnostic du monde connaît. Un objet importé peut porter ses activités et ses effets sous
 * d'autres ids que l'objet officiel : les règles du contenu qui citent les ids officiels ne les trouvent pas (§245). Le moteur ne
 * nomme que DDB Importer ; un autre module déclare le sien (`api.diagnostic.registerImporter`), reconnu par un flag que ses objets
 * portent.
 * Fonctions pures.
 */

/** L'importeur que le moteur connaît de lui-même. */
export const DDB_IMPORTER = Object.freeze({ id: "ddb", flag: "ddbimporter" });

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Ce qui manque à la déclaration d'un importeur : `[]` si elle est bonne.
 * @param {{id: string, flag: string, name: string, hint?: string, icon?: string}} def
 *   `id` — minuscules et tirets ; `flag` — la clé de `item.flags` que portent ses objets ; `name`, `hint` — le nom et l'aide de sa
 *   vérification dans le diagnostic, déjà traduits ; `icon` — classes Font Awesome.
 * @param {Array<{id: string, flag: string}>} [known]  Les importeurs déjà déclarés par d'autres modules.
 * @returns {string[]}
 */
export function importerErrors(def, known=[]) {
  const errors = [];
  if ( !def || (typeof def !== "object") ) return ["an object { id, flag, name } is required"];
  if ( (typeof def.id !== "string") || !SLUG.test(def.id) ) errors.push("id: lowercase letters, digits and hyphens");
  if ( (typeof def.flag !== "string") || !def.flag ) errors.push("flag: the key of item.flags its items carry");
  if ( (typeof def.name !== "string") || !def.name.trim() ) errors.push("name: the name of its check, already localized");
  for ( const key of ["hint", "icon"] ) {
    if ( (def[key] !== undefined) && (typeof def[key] !== "string") ) errors.push(`${key}: a string`);
  }
  for ( const other of [DDB_IMPORTER, ...known] ) {
    if ( other.id === def.id ) errors.push(`id: "${def.id}" is already taken`);
    if ( other.flag === def.flag ) errors.push(`flag: "${def.flag}" already belongs to "${other.id}"`);
  }
  return errors;
}

/**
 * Quel importeur a créé cet objet, d'après ses flags : DDB Importer d'abord, puis ceux déclarés, dans l'ordre. Un objet passé par
 * deux importeurs n'est donc compté qu'une fois — par DDB Importer s'il en est (sa synchronisation le recrée, sa réparation sait
 * le verrouiller).
 * @param {object|null|undefined} flags  les flags de l'objet
 * @param {Array<{id: string, flag: string}>} [importers]  les importeurs déclarés par d'autres modules
 * @returns {string|null}  l'id de l'importeur
 */
export function importerOf(flags, importers=[]) {
  if ( !flags ) return null;
  for ( const { id, flag } of [DDB_IMPORTER, ...importers] ) if ( flags[flag] ) return id;
  return null;
}
