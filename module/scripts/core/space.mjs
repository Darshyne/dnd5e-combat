/**
 * L'espace en trois dimensions (SPEC §14.2, P2) : hauteur d'une créature, tranche d'élévation
 * qu'elle occupe, écart vertical entre deux tranches, tranche d'élévation d'une zone d'effet
 * d'après sa forme, point d'origine d'une zone. Fonctions pures, aucune dépendance à Foundry.
 *
 * Unités : les élévations et les tailles de zone sont dans l'unité de la grille (celle des
 * élévations de token), la profondeur d'un token en cases (`depth` du cœur V14, un token va de
 * `elevation` à `elevation + depth × distance d'une case`, client/documents/token.mjs:3251).
 */

/**
 * Hauteur d'une créature en cases. dnd5e 6 la renseigne d'après la taille quand la synchronisation
 * des tokens est active (`tokenSizeSync`, documents/actor/actor.mjs:428 : largeur, hauteur ET profondeur
 * = taille) ; sans elle, ou pour un token importé d'une version antérieure, `depth` reste à 1, sa
 * valeur par défaut : on tient alors une créature pour aussi haute que large — un Grand occupe un cube
 * de 10 ft. Une profondeur réglée sur le token (≠ 1, à la main ou par dnd5e) l'emporte.
 * @param {{width?: number, height?: number, depth?: number}} size
 * @returns {number}
 */
export function depthOf({ width=1, height=1, depth=1 }={}) {
  if ( depth !== 1 ) return depth;
  return Math.max(1, width, height);
}

/**
 * Tranche verticale occupée : des pieds à la tête.
 * @param {{elevation?: number, depth?: number}} position  `depth` en cases (voir `depthOf`).
 * @param {number} gridDistance  Distance d'une case, unité de la grille.
 * @returns {{bottom: number, top: number}}
 */
export function verticalExtent({ elevation=0, depth=1 }={}, gridDistance) {
  return { bottom: elevation, top: elevation + (depth * gridDistance) };
}

/** Écart vertical entre deux tranches : 0 quand elles se chevauchent. */
export function verticalGap(a, b) {
  return Math.max(0, b.bottom - a.top, a.bottom - b.top);
}

/**
 * Tranche d'élévation d'une zone d'effet, d'après la forme déclarée par dnd5e
 * (`CONFIG.DND5E.areaTargetTypes`) et l'élévation d'origine (celle du lanceur, faute de visée
 * verticale dans l'interface — dnd5e ne pose la zone qu'à plat, template-placement.mjs:138).
 *
 *  - sphère (et cercle) : centrée sur l'élévation d'origine, rayon en haut comme en bas ;
 *  - émanation (`radius`) : autour du corps du lanceur, des pieds moins le rayon à la tête plus le rayon ;
 *  - cube (et carré) : posé sur l'élévation d'origine, aussi haut que large ;
 *  - cylindre : posé, de la hauteur déclarée (à défaut, aussi haut que son diamètre) ;
 *  - cône : à plat, mais un cône s'élargit — on lui donne la moitié de sa longueur en haut et en bas.
 *    Trop large près de l'origine, juste au bout : on préfère inclure de trop (le MJ annule)
 *    qu'oublier une créature en vol au bout du cône ;
 *  - ligne : à plat, de l'épaisseur du lanceur ou de sa largeur, la plus grande des deux ;
 *  - mur : posé, de sa hauteur (à défaut, de sa largeur) ; anneau : posé, de sa hauteur (à défaut, comme une sphère).
 *
 * @param {{type: string, size?: number, width?: number, height?: number}} area  Unité de la grille.
 * @param {{elevation?: number, depth?: number}} origin  Position du lanceur (`depth` en cases).
 * @param {number} gridDistance
 * @returns {{bottom: number, top: number}|null}  null : forme inconnue ou sans taille, on ne touche à rien.
 */
export function regionElevationFor({ type, size, width, height }, { elevation=0, depth=1 }={}, gridDistance) {
  const has = v => Number.isFinite(v) && (v > 0);
  const e = elevation;
  const body = depth * gridDistance;
  switch ( type ) {
    case "sphere":
    case "circle":
      return has(size) ? { bottom: e - size, top: e + size } : null;
    case "radius":
      return has(size) ? { bottom: e - size, top: e + body + size } : null;
    case "cube":
    case "square":
      return has(size) ? { bottom: e, top: e + size } : null;
    case "cylinder":
      return has(size) ? { bottom: e, top: e + (has(height) ? height : 2 * size) } : null;
    case "cone":
      return has(size) ? { bottom: e - (size / 2), top: e + (size / 2) } : null;
    case "line":
      return has(size) ? { bottom: e, top: e + Math.max(has(width) ? width : 0, body) } : null;
    case "wall":
      return has(size) ? { bottom: e, top: e + (has(height) ? height : (has(width) ? width : body)) } : null;
    case "ring":
      if ( !has(size) ) return null;
      return has(height) ? { bottom: e, top: e + height } : { bottom: e - size, top: e + size };
    default:
      return null;
  }
}

/**
 * Point d'origine d'une zone, en pixels, d'après sa première forme (formes de région du cœur V14,
 * common/data/data.mjs) : centre d'un cercle ou d'une ellipse, origine d'un cône, d'une ligne ou
 * d'un anneau, centre d'un rectangle (son origine décalée par son ancre), origine ou centre de
 * masse d'un polygone. Pour une émanation, une forme de token ou une forme inconnue, `fallback`
 * (le centre du token d'origine, que l'adaptateur connaît).
 * @param {object[]} shapes
 * @param {{x: number, y: number}|null} fallback
 * @returns {{x: number, y: number}|null}
 */
export function originPointOfShapes(shapes, fallback=null) {
  const shape = shapes?.[0];
  if ( !shape ) return fallback;
  switch ( shape.type ) {
    case "circle":
    case "ellipse":
    case "cone":
    case "line":
    case "ring":
      return { x: shape.x, y: shape.y };
    case "rectangle":
      return { x: shape.x + ((0.5 - (shape.anchorX ?? 0)) * shape.width), y: shape.y + ((0.5 - (shape.anchorY ?? 0)) * shape.height) };
    case "polygon": {
      if ( shape.origin && Number.isFinite(shape.origin.x) ) return { x: shape.origin.x, y: shape.origin.y };
      const points = shape.points ?? [];
      const n = points.length / 2;
      if ( !n ) return fallback;
      let x = 0, y = 0;
      for ( let i = 0; i < points.length; i += 2 ) { x += points[i]; y += points[i + 1]; }
      return { x: x / n, y: y / n };
    }
    default:
      return fallback;
  }
}

/* -------------------------------------------- */
/*  Une vraie sphère                            */
/* -------------------------------------------- */

/**
 * Distance d'un point à une boîte alignée sur les axes (0 si le point est dedans). Mêmes unités
 * partout : l'appelant convertit les élévations dans l'unité des x, y.
 * @param {{x: number, y: number, z: number}} point
 * @param {{x0: number, x1: number, y0: number, y1: number, z0: number, z1: number}} box
 */
export function pointBoxDistance(point, box) {
  const dx = Math.max(box.x0 - point.x, 0, point.x - box.x1);
  const dy = Math.max(box.y0 - point.y, 0, point.y - box.y1);
  const dz = Math.max(box.z0 - point.z, 0, point.z - box.z1);
  return Math.hypot(dx, dy, dz);
}

/**
 * Une créature (sa boîte) est-elle dans une sphère ? La tranche d'élévation d'une région fait d'une
 * sphère un cylindre : dans les coins du cylindre, hors de la sphère, une créature est épargnée (P2).
 * @param {{x: number, y: number, z: number, radius: number}} sphere
 * @param {object} box  Voir `pointBoxDistance`.
 */
export function withinSphere(sphere, box) {
  return pointBoxDistance(sphere, box) <= sphere.radius + 1e-6;
}
