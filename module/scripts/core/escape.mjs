/**
 * Se libérer par un test (SPEC §16.54) : « une créature Entravée peut entreprendre une action pour effectuer un test de
 * Force (Athlétisme) contre votre DD de sauvegarde des sorts » — Enchevêtrement, Frappe piégeuse, Tentacules noirs
 * d'Evard ; Filet collant du kuo-toa, Absorber, Submerger dans le Monster Manual. Le test est écrit dans le texte de
 * l'item, en enrichisseur de dnd5e :
 *
 *   [[/check ability=str skill=ath dc=@attributes.spell.dc]]   (sorts du PHB)
 *   [[/check ath dc=@skills.ath.passive format=long]]           (Monster Manual)
 *   [[/skill ath 10]]
 *
 * Forme de l'enrichisseur : dnd5e 6.0.3, `parseConfig` et `enrichCheck` (dnd5e.mjs:32003-32016, :32383) — paires
 * `clé=valeur` ou valeurs seules, rangées d'après ce qu'elles sont (caractéristique, compétence, nombre = DD).
 */

const ENRICHER = /\[\[\/(check|skill)\s+([^\]]*)\]\]/i;

/**
 * Le premier test d'un texte, ou null.
 * @param {string} text
 * @param {{abilities: string[], skills: string[]}} known  clés de `CONFIG.DND5E.abilities` / `.skills`
 * @returns {{ability: string|null, skill: string|null, dc: string}|null}  `dc` : nombre ou formule (`@attributes.spell.dc`)
 */
export function parseEscapeCheck(text, { abilities=[], skills=[] }={}) {
  const m = String(text ?? "").match(ENRICHER);
  if ( !m ) return null;
  const out = { ability: null, skill: null, dc: null };
  for ( const token of m[2].trim().split(/\s+/) ) {
    const [key, value] = token.includes("=") ? token.split("=", 2) : [null, token];
    const v = value.toLowerCase();
    if ( key === "ability" ) out.ability = v;
    else if ( key === "skill" ) out.skill = v.split(/[,|]/)[0];
    else if ( key === "dc" ) out.dc = value;
    else if ( key ) continue;   // format=long, passive…
    else if ( /^\d+$/.test(v) ) out.dc = v;
    else if ( skills.includes(v) ) out.skill = v;
    else if ( abilities.includes(v) ) out.ability = v;
  }
  if ( !out.dc || (!out.ability && !out.skill) ) return null;
  return out;
}

/** Les effets dont on se libère par ce test : Entravé, sans Agrippé (l'empoignade a son propre S'échapper). */
export const escapableStatuses = statuses => statuses.includes("restrained") && !statuses.includes("grappled");
