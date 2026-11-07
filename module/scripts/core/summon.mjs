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
export function asksSummonForm({ configure, choices, willSummon, chosen=false, confirmed=false, otherChoice=false, always=false }) {
  if ( chosen || confirmed || otherChoice ) return false;
  // §385 : « jusqu'à N » créatures (contenu `chooseCount`) — la fenêtre du moteur, même depuis la fiche : dnd5e ne demande pas combien.
  if ( always ) return !!willSummon;
  if ( configure !== false ) return false;
  return !!choices?.any && !!willSummon;
}

/**
 * §385 : les profils d'invocation permis à un niveau de lancement (`level.min` / `level.max` du profil, comme `availableProfiles` de
 * dnd5e, documents/activity/summon.mjs, mais pour un autre niveau que celui de l'item).
 * @param {{_id: string, level?: {min?: number|null, max?: number|null}}[]} profiles
 * @param {number} level
 */
export function profilesAtLevel(profiles, level) {
  return (profiles ?? []).filter(p => {
    const min = p?.level?.min ?? null;
    const max = p?.level?.max ?? null;
    return ((min === null) || (level >= min)) && ((max === null) || (level <= max));
  });
}

/** §385 : les nombres proposés, de 1 à `max` (rien à choisir sous 2). */
export function countChoices(max) {
  const n = Math.floor(Number(max) || 0);
  return (n >= 2) ? Array.from({ length: n }, (_, i) => i + 1) : [];
}

/**
 * §386 (issue #38, demande de l'utilisateur) : l'identifiant d'une créature dans le compendium du Monster Manual 2024
 * (`dnd-monster-manual.actors`), d'après son nom anglais — « mm » + le nom en un mot, complété de zéros à 16 caractères
 * (« Ghoul » → `mmGhoul000000000`, « Ogre Zombie » → `mmOgreZombie0000`, « Ghast Gravecaller » → `mmGhastGravecall`).
 * @param {string} name
 * @returns {string|null}
 */
export function mmActorId(name) {
  const words = String(name ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if ( !words.length ) return null;
  const core = words.map(w => w[0].toUpperCase() + w.slice(1)).join("");
  return `mm${core}`.padEnd(16, "0").slice(0, 16);
}

/** §386 : l'id d'acteur d'un uuid du compendium des monstres du SRD 2014 de dnd5e (`dnd5e.monsters`), ou null. */
export function srdMonsterId(uuid) {
  const m = /^Compendium\.dnd5e\.monsters\.(?:Actor\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""));
  return m ? m[1] : null;
}

/**
 * §391 (issue #38, suite) : faut-il ouvrir la fenêtre du moteur pour choisir un profil d'**enchantement** (Arme élémentaire : l'élément ;
 * Arme magique, armes +1/+2/+3 : le bonus) ou de **transformation** (Métamorphose suprême) ? Comme `asksSummonForm` : seulement quand
 * la fenêtre de dnd5e est sautée (`configure` faux : barre ; relance « Lancer quand même »), plusieurs profils, ni déjà choisi, ni
 * confirmé d'office, ni un chemin du moteur qui choisit lui-même (`own` : Forme sauvage).
 */
export function asksProfile({ configure, profiles=0, chosen=false, confirmed=false, own=false }) {
  if ( (configure !== false) || chosen || confirmed || own ) return false;
  return profiles > 1;
}
