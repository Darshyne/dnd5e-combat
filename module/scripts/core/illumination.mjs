/**
 * Niveau de lumière (SPEC §16.48) : vive, faible ou ténèbres, en un point, puis tel qu'un observateur le perçoit selon ses sens.
 * Règles 2024 (glossaire du PHB) : la Lumière faible rend une zone « légèrement obscurcie » — Désavantage aux tests de Sagesse
 * (Perception) pour y voir quelque chose ; les Ténèbres la rendent « fortement obscurcie » — état Aveuglé pour qui essaie d'y
 * voir. Ici : le calcul, sans Foundry ; adapter/illumination.mjs lit les sources du canevas.
 *
 * Arbitrage des sources, comme le cœur V14 : une lumière perd contre une source de ténèbres de priorité supérieure OU ÉGALE qui
 * couvre le point (client/canvas/sources/point-light-source.mjs:32 et :85, « light loses to darkness at the same priority ») ;
 * la lumière globale a la priorité -Infinity (sources/global-light-source.mjs:22), toute source de ténèbres l'éteint donc.
 */

export const LIGHT = Object.freeze({ DARK: 0, DIM: 1, BRIGHT: 2 });

/** Noms des niveaux, pour les messages et les tests. */
export const LIGHT_NAMES = Object.freeze(["dark", "dim", "bright"]);

/**
 * Le niveau de lumière en un point.
 * @param {object} input
 * @param {number|null} [input.global]   Niveau donné par la lumière globale (déjà testée : active, obscurité dans sa plage), ou null.
 * @param {Array<{priority: number, bright: boolean}>} [input.lights]  Les lumières qui couvrent le point ; `bright` : dans leur
 *                                                                     rayon de lumière vive.
 * @param {Array<{priority: number}>} [input.darkness]                 Les sources de ténèbres qui couvrent le point.
 * @returns {{level: number, darkened: boolean}}  `darkened` : le point est dans une source de ténèbres qui y éteint au moins
 *                                                une lumière — ténèbres magiques, que la vision dans le noir ne perce pas.
 */
export function lightLevel({ global=null, lights=[], darkness=[] }={}) {
  const strongest = darkness.reduce((max, d) => Math.max(max, d.priority ?? 0), -Infinity);
  const survives = priority => (darkness.length === 0) || (priority > strongest);
  let level = LIGHT.DARK;
  let darkened = darkness.length > 0;
  if ( Number.isFinite(global) && survives(-Infinity) ) level = Math.max(level, global);
  for ( const light of lights ) {
    if ( !survives(light.priority ?? 0) ) continue;
    level = Math.max(level, light.bright ? LIGHT.BRIGHT : LIGHT.DIM);
  }
  // Une lumière magique plus forte que les ténèbres rétablit l'éclairage : le point n'est plus dans des ténèbres qui comptent.
  if ( level > LIGHT.DARK ) darkened = false;
  return { level, darkened };
}

/**
 * Le niveau de lumière tel que l'observateur le perçoit en ce point.
 * - Vision dans le noir (à portée) : « voir dans la Lumière faible comme en Lumière vive, et dans les Ténèbres comme en Lumière
 *   faible » ; pas à travers des ténèbres magiques (Ténèbres : « la vision dans le noir ne permet pas d'y voir »).
 * - Vision du diable (à portée) : « vous voyez normalement dans la Lumière faible et les Ténèbres, magiques ou non » → vive.
 * - Vision véritable (à portée) : « vous voyez dans les Ténèbres normales et magiques » → vive ; son texte ne dit rien de la
 *   Lumière faible, qui reste faible.
 * @param {{level: number, darkened?: boolean}} light   Résultat de `lightLevel`.
 * @param {{darkvision?: boolean, truesight?: boolean, devilsSight?: boolean}} senses  Chaque sens : le point est-il à portée ?
 * @returns {number}
 */
export function perceivedLight({ level, darkened=false }, { darkvision=false, truesight=false, devilsSight=false }={}) {
  if ( level === LIGHT.DARK ) {
    if ( truesight || devilsSight ) return LIGHT.BRIGHT;
    if ( darkvision && !darkened ) return LIGHT.DIM;
    return LIGHT.DARK;
  }
  if ( (level === LIGHT.DIM) && (darkvision || devilsSight) ) return LIGHT.BRIGHT;
  return level;
}

/**
 * Ce que ce niveau perçu impose à qui essaie de voir en ce point.
 * @param {number} perceived
 * @returns {{obscured: "none"|"light"|"heavy", perceptionDisadvantage: boolean, blinded: boolean}}
 */
export function obscurement(perceived) {
  if ( perceived === LIGHT.BRIGHT ) return { obscured: "none", perceptionDisadvantage: false, blinded: false };
  if ( perceived === LIGHT.DIM ) return { obscured: "light", perceptionDisadvantage: true, blinded: false };
  return { obscured: "heavy", perceptionDisadvantage: false, blinded: true };
}

/**
 * L'indicateur de lumière d'un token (SPEC §16.50) : la lumière là où il se tient, telle que les AUTRES la voient sans sens
 * particulier — c'est elle qui dit s'il est visible ou peut se cacher —, et ce que lui-même y perçoit.
 * @param {{level: number, darkened?: boolean}} light   Résultat de `lightLevel` à sa position.
 * @param {number} own                                   Le niveau qu'il perçoit lui-même à sa position (`perceivedLight`).
 * @returns {{key: "bright"|"dim"|"dark"|"magical", own: "bright"|"dim"|"dark"|null}}  `own` : null s'il perçoit le niveau réel.
 */
export function lightIndicator({ level, darkened=false }, own) {
  const key = (level === LIGHT.DARK) ? (darkened ? "magical" : "dark") : LIGHT_NAMES[level];
  return { key, own: (Number.isFinite(own) && (own !== level)) ? LIGHT_NAMES[own] : null };
}

/**
 * Le niveau que donne la lumière globale en un point (SPEC §16.52). Comme le cœur : active, et obscurité au point dans sa plage
 * `darkness` (`testInsideLight`, groups/effects.mjs:331-337), vive si `bright` (groups/environment.mjs:320-331). En plus :
 * **crépuscule** — une lumière globale vive compte comme faible dès que l'obscurité atteint `twilight` (réglage du monde ;
 * 1 = jamais). Les règles donnent l'aube et le crépuscule en Lumière faible ; Foundry n'a qu'un niveau par lumière globale, et
 * un module d'heure (Simple Timekeeping) ne fait varier que l'obscurité.
 * @param {{active: boolean, bright: number, darkness?: {min?: number, max?: number}}} global
 * @param {number} darkness   Obscurité au point (0–1).
 * @param {number} [twilight=1]
 * @returns {number|null}  `LIGHT.BRIGHT`, `LIGHT.DIM`, ou null (la lumière globale n'éclaire pas ce point).
 */
export function globalLightLevel({ active, bright, darkness: range = {} }, darkness, twilight = 1) {
  const { min = 0, max = 1 } = range;
  if ( !active || !(darkness >= min) || !(darkness <= max) ) return null;
  if ( !(bright > 0) ) return LIGHT.DIM;
  return (darkness >= twilight) ? LIGHT.DIM : LIGHT.BRIGHT;
}
