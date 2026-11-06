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

/**
 * §383 (issue #38) : ce qu'une activité « summon » laisse choisir — plusieurs profils (Convocation de céleste : Vengeur / Défenseur),
 * plusieurs tailles (illusions) ou plusieurs types de créature (Appel de familier : céleste, fée, fiélon). dnd5e ne le demande que
 * dans sa fenêtre d'utilisation (applications/activity/summon-usage-dialog.mjs) ; un appel qui la saute (`configure: false` : barre
 * d'actions, manette) garde le premier de chaque, sans rien demander.
 * @param {{ profiles?: number, sizes?: number, types?: number }} counts
 * @returns {{ profile: boolean, size: boolean, type: boolean, any: boolean }}
 */
export function summonChoices({ profiles=0, sizes=0, types=0 }={}) {
  const profile = profiles > 1;
  const size = (profiles > 0) && (sizes > 1);
  const type = (profiles > 0) && (types > 1);
  return { profile, size, type, any: profile || size || type };
}

/**
 * §383 : faut-il ouvrir la fenêtre « Choisir la forme » du moteur à ce lancement ? Seulement si dnd5e ne la montre pas (`configure`
 * faux), qu'il y a un choix, que quelque chose sera invoqué (pose prévue, invocation forcée par le contenu, ou reprise sur des cibles),
 * et que l'appelant n'a ni déjà choisi (`chosen`) ni confirmé d'office (`confirmed` : relances du moteur, connecteur, scénarios).
 */
export function asksSummonForm({ configure, choices, willSummon, chosen=false, confirmed=false, otherChoice=false }) {
  if ( configure !== false ) return false;
  if ( chosen || confirmed || otherChoice ) return false;
  return !!choices?.any && !!willSummon;
}
