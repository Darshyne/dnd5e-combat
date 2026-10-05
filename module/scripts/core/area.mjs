/**
 * Qui est affecté par une zone d'effet. dnd5e 6.0 pose la zone mais ne désigne aucune cible :
 * c'est au moteur de dire qui, parmi les tokens qu'elle recouvre, doit faire sa sauvegarde.
 * Fonctions pures, aucune dépendance à Foundry (SPEC §5.1).
 */

/**
 * @typedef {object} AreaCandidate
 * @property {string} token        UUID du token.
 * @property {string} actor        UUID de son acteur.
 * @property {string} name
 * @property {number} disposition  -1 hostile, 0 neutre, 1 amical (valeurs de Foundry), -2 secret.
 * @property {boolean} [defeated]  Créature hors de combat (morte), qu'une zone n'a plus à résoudre.
 * @property {boolean|null} [inVolume]  Pour une sphère : la créature est-elle dans la sphère et pas seulement dans
 *   le cylindre de la région (P2) ? false l'exclut ; null ou absent ne l'exclut pas.
 * @property {boolean|null} [lineOfEffect]  La zone l'atteint-elle (aucun plancher, aucun plafond entre son origine et
 *   la créature — P2, §14.2) ? false l'exclut ; null ou absent (impossible à dire) ne l'exclut pas.
 */

/**
 * @param {AreaCandidate[]} candidates       Tokens recouverts par la zone.
 * @param {object} options
 * @param {string|null} options.origin       UUID du token à l'origine de la zone.
 * @param {number|null} options.originDisposition
 * @param {boolean} options.excludeOrigin    Zone partant du lanceur (portée « soi ») : il n'en fait pas partie.
 * @param {string} [options.affects]         `target.affects.type` de l'activité : "ally", "enemy", ou tout autre = tout le monde.
 * @returns {AreaCandidate[]}
 */
export function selectAreaTargets(candidates, { origin, originDisposition, excludeOrigin, affects }) {
  return candidates.filter(c => {
    if ( c.defeated || (c.lineOfEffect === false) || (c.inVolume === false) ) return false;
    if ( c.token === origin ) return !excludeOrigin && (affects !== "enemy");
    if ( (affects !== "ally") && (affects !== "enemy") ) return true;
    // Sans camp connu pour le lanceur, on ne devine pas : tout le monde est affecté, le MJ annulera au besoin.
    if ( (originDisposition === null) || (originDisposition === undefined) ) return true;
    const sameSide = c.disposition === originDisposition;
    return affects === "ally" ? sameSide : !sameSide;
  });
}

/* -------------------------------------------- */
/*  Zones qui durent                            */
/* -------------------------------------------- */

/**
 * Une zone qui dure rejoue son activité (sauvegarde, dégâts, effets) contre une créature à
 * certains moments, et au plus une fois par tour de jeu (règles 2024 : « une créature ne fait
 * cette sauvegarde qu'une fois par tour »).
 *
 * Moments connus :
 *  - "enter"      la créature entre dans la zone, ou la zone vient sur elle
 *  - "turnStart"  elle commence son tour dans la zone
 *  - "turnEnd"    elle y termine son tour
 *  - "moves"      elle s'y déplace : à chaque déplacement, sans limite par tour, et autant de fois que de cases
 *                 parcourues dans la zone (Croissance d'épines : « 2d4 par tranche de 1,50 m ») ; une zone qui
 *                 n'agit qu'ainsi n'agit pas à sa pose
 *
 * @typedef {object} AreaState
 * @property {string[]} on        Moments où la zone agit.
 * @property {string} turnKey     Tour de jeu auquel `hit` se rapporte.
 * @property {string[]} hit       Tokens déjà touchés pendant ce tour de jeu.
 */

/** Identifie un tour de jeu : tout change quand le tour passe. Hors combat, une seule clé. */
export function turnKeyOf(round, turn) {
  return (round === null) || (round === undefined) ? "hors-combat" : `${round}-${turn}`;
}

/**
 * La zone peut-elle être déplacée maintenant (§16.14) ? Rayon de lune : « lors de vos tours suivants » — pas au tour même
 * où elle a été posée. Hors combat, toujours.
 * @param {AreaState} area
 * @param {string} turnKey  Le tour en cours (`turnKeyOf`).
 */
export function canMoveArea(area, turnKey) {
  if ( !area ) return false;
  if ( (turnKey === "hors-combat") || (area.turnKey === "hors-combat") ) return true;
  return area.turnKey !== turnKey;
}

/**
 * Les formes d'une région, translatées de (dx, dy) : cercles, ellipses, rectangles par leur `x, y`, polygones par leurs
 * `points` (x0, y0, x1, y1…). Les autres champs (rayon, élévation, trous) ne bougent pas.
 * @param {object[]} shapes
 * @returns {object[]}
 */
export function translateShapes(shapes, dx, dy) {
  return (shapes ?? []).map(shape => {
    const out = { ...shape };
    if ( Number.isFinite(out.x) ) out.x += dx;
    if ( Number.isFinite(out.y) ) out.y += dy;
    if ( Array.isArray(out.points) ) out.points = out.points.map((v, i) => v + ((i % 2) ? dy : dx));
    return out;
  });
}

/** Le centre d'une forme (celui dont on mesure le déplacement), ou null. */
export function shapeCenter(shape) {
  if ( !shape ) return null;
  if ( Array.isArray(shape.points) && shape.points.length >= 2 ) {
    const xs = shape.points.filter((_, i) => !(i % 2));
    const ys = shape.points.filter((_, i) => i % 2);
    return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
  }
  if ( (shape.type === "rectangle") && Number.isFinite(shape.width) ) return { x: shape.x + (shape.width / 2), y: shape.y + (shape.height / 2) };
  return Number.isFinite(shape.x) ? { x: shape.x, y: shape.y } : null;
}

/** État de départ d'une zone : ceux qu'elle a touchés à la pose l'ont été pour ce tour. */
export function openArea(on, turnKey, hit=[]) {
  return { on: [...on], turnKey, hit: [...hit] };
}

/**
 * La zone doit-elle agir sur ce token maintenant ?
 * @param {AreaState} area
 * @param {{event: string, token: string, turnKey: string}} context
 */
export function shouldTrigger(area, { event, token, turnKey }) {
  if ( !area.on.includes(event) ) return false;
  if ( event === "moves" ) return true;   // chaque déplacement compte, sans limite par tour
  return (area.turnKey !== turnKey) || !area.hit.includes(token);
}

/**
 * §80 : l'activité sœur que la zone rejoue à ce moment — la sienne propre quand la zone en joue plusieurs (`activities`, Faim de
 * Hadar : froid au début du tour, acide à la fin), sinon la seule (`activity`), sinon null (l'activité qui a posé la zone).
 * @param {AreaState & {activity?: string|null, activities?: Record<string, string>}} area
 * @param {string} event
 */
export function siblingFor(area, event) {
  return area?.activities?.[event] ?? area?.activity ?? null;
}

/**
 * §80 : sous quelle clé noter « déjà touché ce tour » : la créature, et l'activité quand la zone en joue une par moment — le froid
 * du début du tour n'empêche pas l'acide de la fin. Une zone à une seule activité garde « une fois par tour » (Rayon de lune).
 * @param {AreaState & {activities?: Record<string, string>}} area
 * @param {string} event
 * @param {string} token  UUID du token.
 */
export function hitKey(area, event, token) {
  const own = area?.activities?.[event];
  return own ? `${token}#${own}` : token;
}

/**
 * §80 : les activités sœurs d'une zone, par moment, à partir de ses déclarations `replay` ; seulement quand elles diffèrent d'un
 * moment à l'autre (sinon `activity` suffit et rien ne change pour Rayon de lune, Cordon de flèches, Nuage puant).
 * @param {Array<{on: string[], activity: string|null}>} replays  Pour chaque déclaration : ses moments, l'activité rejouée.
 * @returns {Record<string, string>|null}
 */
export function siblingsByMoment(replays) {
  const by = {};
  for ( const { on, activity } of replays ?? [] ) if ( activity ) for ( const m of on ) by[m] = activity;
  return (new Set(Object.values(by)).size > 1) ? by : null;
}

/**
 * §91 : l'entrée d'un `casterPulse` qui vaut pour le rejeu numéro `n` (1 = le premier tour après la pose), ou null.
 * @param {{by: {from: number, to?: number}[]}} rule
 * @param {number} n
 */
export function pulseFor(rule, n) {
  return (rule?.by ?? []).find(b => (n >= b.from) && (n <= (b.to ?? b.from))) ?? null;
}

/**
 * §91 : les cibles d'un rejeu plafonné (`max`) — les ennemis du lanceur d'abord, puis les autres, dans l'ordre donné.
 * @param {{disposition: number}[]} tokens
 * @param {number|null} casterDisposition
 * @param {number} [max]
 */
export function pulseTargets(tokens, casterDisposition, max) {
  const hostile = t => (casterDisposition !== null) && (casterDisposition !== undefined) && (t.disposition !== casterDisposition);
  const ordered = [...tokens.filter(hostile), ...tokens.filter(t => !hostile(t))];
  return max ? ordered.slice(0, max) : ordered;
}

/** Note qu'un token vient d'être touché. Changer de tour de jeu efface la mémoire du précédent. */
export function markHit(area, { token, turnKey }) {
  const hit = area.turnKey === turnKey ? area.hit : [];
  return { ...area, turnKey, hit: hit.includes(token) ? hit : [...hit, token] };
}

/**
 * Cases parcourues DANS la zone (moment `moves`) : chaque pas dont l'arrivée est dans la zone — y entrer compte, en
 * sortir non.
 * @param {boolean[]} insideAtSteps  Pour chaque case d'arrivée du trajet, dans l'ordre (départ exclu).
 */
export function stepsInside(insideAtSteps) {
  return (insideAtSteps ?? []).filter(Boolean).length;
}

/** La zone agit-elle à sa pose ? Non si elle n'agit qu'au déplacement (`moves`). */
export function actsOnPose(on) {
  return !on || on.some(m => m !== "moves");
}

/**
 * Un déplacement fait-il entrer dans la zone ? On regarde chaque point de passage, pas seulement
 * l'arrivée : traverser la zone compte.
 * @param {boolean} insideAtOrigin
 * @param {boolean[]} insideAtWaypoints  Dans l'ordre du trajet, arrivée comprise.
 */
export function entersArea(insideAtOrigin, insideAtWaypoints) {
  return !insideAtOrigin && insideAtWaypoints.some(Boolean);
}

/**
 * §16.37 : l'heure du monde (secondes) où finit une zone qui dure sans concentration (Lumière du jour : 1 heure), ou null si
 * sa durée ne se compte pas (instantanée, permanente, spéciale, inconnue).
 * @param {number} now                         Heure du monde, en secondes.
 * @param {{value: number|string, units: string}} duration  Durée de l'activité (dnd5e : `value`, `units`).
 * @param {Record<string, number>} minutesPer  Minutes par unité (CONFIG.DND5E.timeUnits.<unité>.conversion).
 */
export function expiryTime(now, { value, units }={}, minutesPer={}) {
  const n = Number(value);
  const perUnit = minutesPer[units];
  if ( !Number.isFinite(now) || !Number.isFinite(n) || (n <= 0) || !Number.isFinite(perUnit) || (perUnit <= 0) ) return null;
  return now + Math.round(n * perUnit * 60);
}
