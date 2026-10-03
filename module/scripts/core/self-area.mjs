/**
 * Une zone « sur soi » se pose d'office sur le lanceur (SPEC §47). dnd5e 6 demande de placer toute zone d'une activité dont
 * `target.prompt` est vrai — même une émanation de portée « personnelle », où il faut cliquer son propre token (Lames
 * tourbillonnantes, Esprits gardiens, Présence terrifiante, Préservation de la vie…). Il n'y a rien à choisir : la
 * zone part du lanceur. Ici, la décision, sans Foundry.
 *
 * Les cônes, lignes et cubes de portée personnelle se visent autour du lanceur (§59, `aimedAreaShape`). Restent à placer
 * à la main : cylindres et murs (un endroit à choisir — Mur de feu), plusieurs zones à la fois, et toute zone d'une autre
 * portée.
 */

/** Types de zone dnd5e (`CONFIG.DND5E.areaTargetTypes`) centrés sur le lanceur quand la portée est « personnelle ». */
const SELF_TYPES = Object.freeze({ radius: "emanation", sphere: "circle", circle: "circle" });

/**
 * @param {object} query
 * @param {string} [query.rangeUnits]  `activity.range.units`.
 * @param {string} [query.type]        `activity.target.template.type` (radius, sphere, cone…).
 * @param {number|string} [query.count] `activity.target.template.count` (vide : une zone).
 * @param {number} [query.size]        Taille de la zone (rayon), unité de l'activité.
 * @returns {"emanation"|"circle"|null}  La forme de région à poser sur le lanceur, ou null : pose de dnd5e.
 */
export function selfAreaShape({ rangeUnits, type, count, size }={}) {
  if ( rangeUnits !== "self" ) return null;
  const shape = SELF_TYPES[type] ?? null;
  if ( !shape ) return null;
  if ( (Number(count) || 1) !== 1 ) return null;
  if ( !(Number(size) > 0) ) return null;
  return shape;
}

/* -------------------------------------------- */
/*  Cônes et lignes partant du lanceur (§59)    */
/* -------------------------------------------- */

/** Types de zone dnd5e qui partent du lanceur dans une direction à choisir (souffles, Mains brûlantes, Éclair, Vague tonnante). */
const AIMED_TYPES = Object.freeze({ cone: "cone", line: "line", cube: "cube" });

/**
 * Un cône ou une ligne de portée « personnelle » se vise autour du lanceur (SPEC §59) : son sommet reste collé à lui, la
 * souris ne choisit que la direction. Mêmes conditions que la zone sur soi : une seule zone, de taille connue.
 * @param {object} query  Comme `selfAreaShape`.
 * @returns {"cone"|"line"|"cube"|null}  La forme à viser, ou null : pose de dnd5e.
 */
export function aimedAreaShape({ rangeUnits, type, count, size }={}) {
  if ( rangeUnits !== "self" ) return null;
  const shape = AIMED_TYPES[type] ?? null;
  if ( !shape ) return null;
  if ( (Number(count) || 1) !== 1 ) return null;
  if ( !(Number(size) > 0) ) return null;
  return shape;
}

/**
 * Le sommet et la direction d'une zone visée depuis le lanceur. La zone pivote autour du **centre** du lanceur, vers le
 * point visé ; son sommet est posé sur le **bord** de son espace dans cette direction — pas au centre, sans quoi la zone
 * commencerait sous lui (sa propre case en ferait partie). Bord d'un rectangle (token carré), ou d'une ellipse (token
 * elliptique des grilles hexagonales).
 * @param {{x: number, y: number, width: number, height: number}} body  Espace du lanceur, en pixels (coin haut-gauche).
 * @param {{x: number, y: number}} point     Point visé (la souris), en pixels.
 * @param {object} [options]
 * @param {boolean} [options.ellipse=false]  Espace elliptique.
 * @param {{x: number, y: number}|null} [options.fallback=null]  Direction si le point est au centre (dernière visée).
 * @returns {{x: number, y: number, rotation: number}}  Sommet (pixels) et direction en degrés, 0 = vers la droite, sens
 *   horaire (y vers le bas), dans [0, 360).
 */
export function aimFrom(body, point, { ellipse=false, fallback=null }={}) {
  const cx = body.x + (body.width / 2);
  const cy = body.y + (body.height / 2);
  let dx = point.x - cx;
  let dy = point.y - cy;
  if ( (Math.hypot(dx, dy) < 1e-6) ) ({ x: dx, y: dy } = fallback ?? { x: 1, y: 0 });
  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const a = body.width / 2;
  const b = body.height / 2;
  let t;
  if ( ellipse ) t = 1 / Math.sqrt(((cos / a) ** 2) + ((sin / b) ** 2));
  else t = Math.min(Math.abs(cos) > 1e-9 ? a / Math.abs(cos) : Infinity, Math.abs(sin) > 1e-9 ? b / Math.abs(sin) : Infinity);
  const rotation = (((angle * 180) / Math.PI) + 360) % 360;
  return { x: cx + (t * cos), y: cy + (t * sin), rotation };
}

/**
 * Un cube de portée personnelle (Vague tonnante : « un cube de 4,50 m qui part de vous ») : son point d'origine est sur une
 * face du cube, au bord du lanceur. Le cube est donc **accolé** à l'espace du lanceur, du côté de la souris (l'axe dominant
 * choisit le côté), et glisse le long de ce côté pour suivre la souris, jusqu'aux positions en coin où il ne le touche plus que
 * par un sommet — jamais par-dessus le lanceur. Aligné sur la grille, sans rotation ; calé par pas de `step` pixels (une case)
 * à partir du coin du lanceur.
 * @param {{x: number, y: number, width: number, height: number}} body  Espace du lanceur, en pixels (coin haut-gauche).
 * @param {{x: number, y: number}} point  Point visé (la souris), en pixels.
 * @param {number} side                   Côté du cube, en pixels.
 * @param {object} [options]
 * @param {number} [options.step=0]       Pas de la grille (0 : sans grille, position libre).
 * @param {{x: number, y: number}|null} [options.fallback=null]  Direction si le point est au centre.
 * @returns {{x: number, y: number}}  Coin haut-gauche du cube.
 */
export function cubeBeside(body, point, side, { step=0, fallback=null }={}) {
  const cx = body.x + (body.width / 2);
  const cy = body.y + (body.height / 2);
  let dx = point.x - cx;
  let dy = point.y - cy;
  if ( (Math.hypot(dx, dy) < 1e-6) ) ({ x: dx, y: dy } = fallback ?? { x: 1, y: 0 });
  const slide = (want, start, length) => {
    let v = Math.min(Math.max(want, start - side), start + length);
    if ( step > 0 ) v = Math.min(Math.max(start + (Math.round((v - start) / step) * step), start - side), start + length);
    return v;
  };
  // À égalité (diagonale parfaite), le côté horizontal : le cube touche alors le lanceur par le coin.
  if ( Math.abs(dx) >= Math.abs(dy) ) {
    return { x: dx >= 0 ? body.x + body.width : body.x - side, y: slide(point.y - (side / 2), body.y, body.height) };
  }
  return { x: slide(point.x - (side / 2), body.x, body.width), y: dy >= 0 ? body.y + body.height : body.y - side };
}
