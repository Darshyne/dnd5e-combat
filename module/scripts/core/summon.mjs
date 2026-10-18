/**
 * §197 : à qui appartient une créature invoquée. dnd5e crée l'acteur invoqué au nom de l'utilisateur qui invoque
 * (documents/activity/summon.mjs → `Actor5e.fetchExisting`) : un MJ qui lance le sort depuis la fiche d'un joueur en garde seul la
 * propriété, et le joueur ne peut ni déplacer ni utiliser sa monture (retour de table, issue #9). Les propriétaires (joueurs) du
 * lanceur deviennent aussi propriétaires de la créature.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Le niveau « Propriétaire » de Foundry (`CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER`). */
export const OWNER = 3;

/**
 * La propriété à donner à l'acteur invoqué, ou null s'il n'y a rien à changer : la sienne, plus « Propriétaire » pour chaque joueur
 * qui possède le lanceur (pas le niveau par défaut, pas un MJ).
 * @param {Record<string, number>} casterOwnership   La propriété du lanceur.
 * @param {Record<string, number>} current           Celle de l'acteur invoqué.
 * @param {(userId: string) => boolean} isGM
 * @returns {Record<string, number>|null}
 */
export function summonOwnership(casterOwnership, current, isGM) {
  const players = Object.entries(casterOwnership ?? {})
    .filter(([id, level]) => (id !== "default") && (level >= OWNER) && !isGM(id))
    .map(([id]) => id);
  const missing = players.filter(id => (current?.[id] ?? 0) < OWNER);
  if ( !missing.length ) return null;
  return { ...(current ?? {}), ...Object.fromEntries(missing.map(id => [id, OWNER])) };
}
