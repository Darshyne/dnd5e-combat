/**
 * §162 : un mur posé par points (Mur de feu, Mur de force en panneaux, Barrière de lames…). Le joueur désigne deux points ou plus ; le
 * mur suit la ligne brisée, au plus sa longueur totale. Chaque segment devient une forme « line » de la région (origine, angle,
 * longueur, épaisseur — comme une ligne visée, adapter/self-area.mjs), et le moteur pose, le long de chacun, les murs du cœur que le sort
 * demande (`walls` du contenu). Géométrie pure, en pixels ; aucune dépendance à Foundry.
 */

/** Longueur d'une ligne brisée. */
export function polylineLength(points) {
  let total = 0;
  for ( let i = 1; i < points.length; i++ ) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

/**
 * La ligne brisée ramenée à `max` de long : les points au-delà sont retirés, le dernier segment raccourci. Les points confondus sont
 * écartés.
 * @param {Array<{x: number, y: number}>} points
 * @param {number} max   Longueur maximale (Infinity : sans limite).
 * @returns {Array<{x: number, y: number}>}
 */
export function clampPolyline(points, max=Infinity) {
  const out = [];
  let left = max;
  for ( const p of points ) {
    if ( !out.length ) { out.push({ x: p.x, y: p.y }); continue; }
    const a = out.at(-1);
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if ( d < 1e-6 ) continue;
    if ( d <= left + 1e-6 ) { out.push({ x: p.x, y: p.y }); left -= d; continue; }
    if ( left > 1e-6 ) out.push({ x: a.x + ((p.x - a.x) * left) / d, y: a.y + ((p.y - a.y) * left) / d });
    break;
  }
  return out;
}

/**
 * Les formes « line » d'une ligne brisée : une par segment, de l'épaisseur donnée.
 * @param {Array<{x: number, y: number}>} points
 * @param {number} width   Épaisseur, en pixels.
 * @returns {Array<{type: "line", x: number, y: number, rotation: number, length: number, width: number}>}
 */
export function wallLineShapes(points, width) {
  const shapes = [];
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if ( length < 1e-6 ) continue;
    shapes.push({ type: "line", x: a.x, y: a.y, rotation: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, length, width });
  }
  return shapes;
}

/** L'axe d'une forme « line » : ses deux extrémités, arrondies au pixel (les murs du cœur ont des coordonnées entières). */
export function lineAxis({ x, y, rotation, length }) {
  const r = (rotation * Math.PI) / 180;
  return [Math.round(x), Math.round(y), Math.round(x + (Math.cos(r) * length)), Math.round(y + (Math.sin(r) * length))];
}

/** Les arêtes d'un polygone fermé (`[x0, y0, x1, y1, …]`), en segments `[x1, y1, x2, y2]` arrondis. */
export function polygonEdges(flat) {
  const n = Math.floor(flat.length / 2);
  const edges = [];
  for ( let i = 0; i < n; i++ ) {
    const j = (i + 1) % n;
    const edge = [flat[2 * i], flat[(2 * i) + 1], flat[2 * j], flat[(2 * j) + 1]].map(Math.round);
    if ( (edge[0] !== edge[2]) || (edge[1] !== edge[3]) ) edges.push(edge);
  }
  return edges;
}

/* -------------------------------------------- */
/*  Mur à face brûlante (§169)                  */
/* -------------------------------------------- */

/**
 * §169 : chaque point aligné sur le précédent, sur l'axe où il s'en écarte le plus — un mur sans diagonale, le long des lignes de la
 * grille (une diagonale coupait des cases en biais : quelques-unes seulement étaient « dedans »).
 * @param {Array<{x: number, y: number}>} points
 * @returns {Array<{x: number, y: number}>}
 */
export function orthogonalize(points) {
  const out = [];
  for ( const p of points ) {
    const a = out.at(-1);
    if ( !a ) out.push({ x: p.x, y: p.y });
    else out.push(Math.abs(p.x - a.x) >= Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y });
  }
  return out;
}

/**
 * Le côté d'un segment où se trouve un point : +1 à gauche du sens de tracé (à l'écran, l'axe y vers le bas : la normale
 * `(dy, -dx)`), -1 à droite, 0 sur sa droite.
 */
export function sideOfSegment([x1, y1, x2, y2], { x, y }) {
  const d = ((y2 - y1) * (x - x1)) - ((x2 - x1) * (y - y1));
  return Math.abs(d) < 1e-9 ? 0 : Math.sign(d);
}

/** Distance d'un point à un segment. */
function distanceToSegment([x1, y1, x2, y2], { x, y }) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = (dx * dx) + (dy * dy);
  const t = len2 ? Math.max(0, Math.min(1, (((x - x1) * dx) + ((y - y1) * dy)) / len2)) : 0;
  return Math.hypot(x - (x1 + (t * dx)), y - (y1 + (t * dy)));
}

/**
 * La géométrie d'un mur à face brûlante, tirée des formes de sa région : des segments (formes « line »), ou un anneau — la forme « ring »
 * du cœur V14 (gabarit « ring » de dnd5e, ou l'anneau fin que devient le disque d'un gabarit « cylinder »), ou ce disque lui-même (un
 * cercle, ou une ellipse ronde posée par coordonnées).
 * @param {object[]} shapes   Les formes de la région (données).
 * @returns {{lines: number[][]}|{ring: {x: number, y: number, radius: number}}|null}
 */
export function wallGeometry(shapes, axisOf=lineAxis) {
  const list = shapes ?? [];
  const lines = list.filter(s => s.type === "line");
  if ( lines.length ) return { lines: lines.map(s => axisOf(s)) };
  const ring = list.find(s => (s.type === "ring") && Number.isFinite(s.radius));
  // Le milieu de la bande : de `radius - innerWidth` à `radius + outerWidth`.
  if ( ring ) return { ring: { x: ring.x, y: ring.y, radius: ring.radius + (((ring.outerWidth ?? 0) - (ring.innerWidth ?? 0)) / 2) } };
  const disc = list.map(s => ((s.type === "ellipse") && (s.radiusX === s.radiusY)) ? { ...s, type: "circle", radius: s.radiusX } : s)
    .find(s => (s.type === "circle") && Number.isFinite(s.radius) && !s.hole);
  return disc ? { ring: { x: disc.x, y: disc.y, radius: disc.radius } } : null;
}

/**
 * Le côté brûlant par défaut : celui où le lanceur n'est pas — pour une ligne, l'autre côté du segment le plus proche de lui ; pour
 * un anneau, l'extérieur s'il est dedans, l'intérieur sinon. +1 : à gauche du tracé, ou l'intérieur de l'anneau ; -1 : l'inverse.
 */
export function defaultSide(geometry, caster) {
  if ( !geometry || !caster ) return 1;
  if ( geometry.ring ) return Math.hypot(caster.x - geometry.ring.x, caster.y - geometry.ring.y) < geometry.ring.radius ? -1 : 1;
  const nearest = geometry.lines.reduce((best, l) => (distanceToSegment(l, caster) < distanceToSegment(best, caster) ? l : best));
  return -(sideOfSegment(nearest, caster) || -1);
}

/**
 * Les formes de la face brûlante : `depth` pixels le long de chaque segment, du côté choisi (un polygone par segment) ; pour un
 * anneau, le disque intérieur (+1) ou la couronne de `depth` autour (-1, forme « ring »).
 * @param {{lines: number[][]}|{ring: object}} geometry
 * @param {1|-1} side
 * @param {number} depth
 */
export function sideShapes(geometry, side, depth) {
  if ( geometry?.ring ) {
    const { x, y, radius } = geometry.ring;
    return side > 0 ? [{ type: "circle", x, y, radius }] : [{ type: "ring", x, y, radius, innerWidth: 0, outerWidth: depth }];
  }
  const lines = geometry?.lines ?? [];
  const normal = ([x1, y1, x2, y2]) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    return { x: (side * (y2 - y1) * depth) / len, y: (side * -(x2 - x1) * depth) / len };
  };
  const shapes = lines.map(l => {
    const [x1, y1, x2, y2] = l;
    const n = normal(l);
    return { type: "polygon", points: [x1, y1, x2, y2, x2 + n.x, y2 + n.y, x1 + n.x, y1 + n.y].map(v => Math.round(v)) };
  });
  // Aux coins du tracé, le carré qui relie les deux bandes (au coin extérieur il manquait ; à l'intérieur, il tombe dans les bandes).
  for ( let i = 1; i < lines.length; i++ ) {
    const [, , px, py] = lines[i - 1];
    const [qx, qy] = lines[i];
    if ( Math.hypot(px - qx, py - qy) > 1 ) continue;
    const a = normal(lines[i - 1]), b = normal(lines[i]);
    shapes.push({ type: "polygon", points: [px, py, px + a.x, py + a.y, px + a.x + b.x, py + a.y + b.y, px + b.x, py + b.y].map(v => Math.round(v)) });
  }
  return shapes;
}

/** L'anneau fin d'un mur circulaire : la forme « ring » du cœur, d'épaisseur `width`, centrée sur le rayon. */
export function ringShapes({ x, y, radius }, width) {
  const half = Math.max(1, width / 2);
  return [{ type: "ring", x, y, radius, innerWidth: Math.min(half, radius), outerWidth: half }];
}

/** Les deux segments se coupent-ils franchement (pas en bout, pas alignés) ? */
function segmentsCross([ax, ay, bx, by], [cx, cy, dx, dy]) {
  const o = (px, py, qx, qy, rx, ry) => Math.sign(((qx - px) * (ry - py)) - ((qy - py) * (rx - px)));
  return (o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0) && (o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0);
}

/**
 * Un trajet (centres successifs) traverse-t-il le mur ? Une ligne : un pas qui coupe un segment ; un anneau : un pas qui passe d'un
 * côté du cercle à l'autre.
 * @param {{lines: number[][]}|{ring: object}} geometry
 * @param {Array<{x: number, y: number}>} path
 */
export function crossesWall(geometry, path) {
  for ( let i = 1; i < (path?.length ?? 0); i++ ) {
    const a = path[i - 1], b = path[i];
    if ( geometry?.ring ) {
      const { x, y, radius } = geometry.ring;
      const da = Math.hypot(a.x - x, a.y - y) - radius, db = Math.hypot(b.x - x, b.y - y) - radius;
      if ( da * db < 0 ) return true;
    }
    else if ( (geometry?.lines ?? []).some(l => segmentsCross([a.x, a.y, b.x, b.y], l)) ) return true;
  }
  return false;
}

/**
 * L'espace d'une créature (rectangle en pixels) touche-t-il le mur ? Un segment : il longe ou traverse le rectangle sur une longueur
 * (un coin seul ne compte pas) ; un anneau : le cercle passe dans le rectangle. C'est « dans la zone » à l'apparition du mur, des deux
 * côtés : sur la grille, un mur d'1 ft posé entre les cases ne couvre aucune case.
 * @param {{lines: number[][]}|{ring: object}} geometry
 * @param {{x: number, y: number, width: number, height: number}} rect
 */
export function touchesWall(geometry, { x, y, width, height }) {
  const eps = 1e-6;
  if ( geometry?.ring ) {
    const { x: cx, y: cy, radius } = geometry.ring;
    const near = Math.hypot(Math.max(x - cx, 0, cx - (x + width)), Math.max(y - cy, 0, cy - (y + height)));
    const far = Math.max(...[[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([px, py]) => Math.hypot(px - cx, py - cy)));
    return (near < radius) && (far > radius);
  }
  return (geometry?.lines ?? []).some(([x1, y1, x2, y2]) => {
    // Liang–Barsky : la part du segment dans le rectangle fermé.
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    for ( const [p, q] of [[-dx, x1 - x], [dx, (x + width) - x1], [-dy, y1 - y], [dy, (y + height) - y1]] ) {
      if ( Math.abs(p) < eps ) { if ( q < -eps ) return false; continue; }
      const r = q / p;
      if ( p < 0 ) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      if ( t0 > t1 ) return false;
    }
    return (t1 - t0) * Math.hypot(dx, dy) > 0.5;
  });
}

/** Les arêtes d'un cercle approché par `n` côtés (les murs du cœur d'un mur en anneau). */
export function circleEdges({ x, y, radius }, n=24) {
  const pts = Array.from({ length: n }, (_, i) => [x + (radius * Math.cos((2 * Math.PI * i) / n)), y + (radius * Math.sin((2 * Math.PI * i) / n))]);
  return pts.map((p, i) => [...p, ...pts[(i + 1) % n]].map(Math.round));
}

/**
 * §170 : où poser les lumières d'un mur — un point tous les `step` pixels le long de chaque segment (bouts compris), ou du cercle,
 * décalé de `offset` de chaque côté : le mur arrête la lumière, une source posée sur sa ligne n'éclairerait ni l'un ni l'autre côté.
 * @param {{lines: number[][]}|{ring: {x: number, y: number, radius: number}}} geometry
 * @returns {Array<{x: number, y: number}>}
 */
export function wallLightPoints(geometry, step, offset) {
  const out = [];
  if ( geometry?.ring ) {
    const { x, y, radius } = geometry.ring;
    const n = Math.max(6, Math.ceil((2 * Math.PI * radius) / step));
    for ( let i = 0; i < n; i++ ) {
      const a = (2 * Math.PI * i) / n;
      for ( const r of [radius - offset, radius + offset] ) out.push({ x: Math.round(x + (r * Math.cos(a))), y: Math.round(y + (r * Math.sin(a))) });
    }
    return out;
  }
  for ( const [x1, y1, x2, y2] of geometry?.lines ?? [] ) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if ( len < 1e-6 ) continue;
    const n = Math.max(1, Math.round(len / step));
    const nx = ((y2 - y1) / len) * offset, ny = (-(x2 - x1) / len) * offset;
    for ( let i = 0; i <= n; i++ ) {
      const px = x1 + (((x2 - x1) * i) / n), py = y1 + (((y2 - y1) * i) / n);
      for ( const s of [1, -1] ) out.push({ x: Math.round(px + (s * nx)), y: Math.round(py + (s * ny)) });
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Mur épais posé sur les cases (§172)         */
/* -------------------------------------------- */

/**
 * §172 : un mur d'une case d'épaisseur (Mur d'épines, Barrière de lames) se pose sur une rangée de cases — les points au centre des
 * cases, sans diagonale ; chaque segment est prolongé d'une demi-case à ses deux bouts, pour couvrir la première et la dernière case
 * en entier (aux coins, deux segments se recouvrent). La ligne de centres est d'abord bornée à `length - 2 × half` : le mur, bouts
 * compris, garde la longueur du sort.
 * @param {Array<{x: number, y: number}>} points   Centres de case.
 * @param {number} length   Longueur du sort, en pixels.
 * @param {number} width    Épaisseur, en pixels.
 * @param {number} half     Une demi-case, en pixels.
 */
export function cellWallShapes(points, length, width, half) {
  const line = clampPolyline(orthogonalize(points), Number.isFinite(length) ? Math.max(0, length - (2 * half)) : Infinity);
  if ( line.length === 1 ) return [{ type: "line", x: line[0].x - half, y: line[0].y, rotation: 0, length: 2 * half, width }];
  return wallLineShapes(line, width).map(s => {
    const r = (s.rotation * Math.PI) / 180;
    return { ...s, x: s.x - (Math.cos(r) * half), y: s.y - (Math.sin(r) * half), length: s.length + (2 * half) };
  });
}

/** L'anneau d'un mur épais tiré du disque de son gabarit : une bande de `width` à l'intérieur du cercle (son diamètre est celui du sort). */
export function innerRingShapes({ x, y, radius }, width) {
  return [{ type: "ring", x, y, radius, innerWidth: Math.min(width, radius), outerWidth: 0 }];
}

/**
 * §173 : la zone à `distance` d'un mur fin, des deux côtés (Mur prismatique : l'aveuglement à 6 m) — un rectangle autour de chaque
 * segment, prolongé de `distance` à ses bouts ; pour un anneau, une bande de `distance` de part et d'autre du cercle.
 */
export function auraShapes(geometry, distance) {
  if ( geometry?.ring ) {
    const { x, y, radius } = geometry.ring;
    return [{ type: "ring", x, y, radius, innerWidth: Math.min(distance, radius), outerWidth: distance }];
  }
  return (geometry?.lines ?? []).map(([x1, y1, x2, y2]) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = ((x2 - x1) / len) * distance, uy = ((y2 - y1) / len) * distance;
    const nx = -uy, ny = ux;
    const a = { x: x1 - ux, y: y1 - uy }, b = { x: x2 + ux, y: y2 + uy };
    return { type: "polygon", points: [a.x + nx, a.y + ny, b.x + nx, b.y + ny, b.x - nx, b.y - ny, a.x - nx, a.y - ny].map(v => Math.round(v)) };
  });
}
