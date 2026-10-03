/**
 * Recherche de chemin sur grille carrée (A*, huit voisins). Noyau pur : le monde est décrit par
 * des fonctions fournies par l'appelant (murs, cases occupées, coût du terrain).
 *
 * Le cœur de Foundry V14 n'a pas de pathfinder : `Token#findMovementPath` rend la ligne droite,
 * arrêtée au premier mur (client/canvas/placeables/token.mjs:3397). C'est un point d'extension.
 */

// P2 : une case porte son niveau (`level`, facultatif) — deux cases de mêmes i, j à des niveaux différents sont deux nœuds.
const key = c => `${c.i},${c.j},${c.level ?? ""}`;

const NEIGHBOURS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1]
];

/** Distance de Tchebychev entre deux cases : le nombre de pas à huit voisins. */
export function cellDistance(a, b) {
  return Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j));
}

/** Tas binaire minimal, sur la priorité `f`. */
class Heap {
  #items = [];
  get size() { return this.#items.length; }
  push(item) {
    const a = this.#items;
    a.push(item);
    let n = a.length - 1;
    while ( n > 0 ) {
      const p = (n - 1) >> 1;
      if ( a[p].f <= a[n].f ) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop() {
    const a = this.#items;
    const top = a[0];
    const last = a.pop();
    if ( a.length ) {
      a[0] = last;
      let n = 0;
      for ( ;; ) {
        const l = (2 * n) + 1;
        const r = l + 1;
        let m = n;
        if ( (l < a.length) && (a[l].f < a[m].f) ) m = l;
        if ( (r < a.length) && (a[r].f < a[m].f) ) m = r;
        if ( m === n ) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top;
  }
}

/**
 * @param {object} query
 * @param {{i:number,j:number}} query.start
 * @param {{i:number,j:number}[]} [query.goals]     Cases d'arrivée acceptables. Ou bien :
 * @param {(cell) => boolean} [query.isGoal]        Test d'arrivée (zone d'approche d'une cible), avec
 * @param {(cell) => number} [query.heuristic]      son estimation du nombre de pas restants, jamais surévaluée.
 * @param {(from, to) => boolean} query.canStep     Peut-on passer de `from` à sa voisine `to` ? (murs, ennemis)
 * @param {(cell) => boolean} [query.canEnd]        Peut-on s'arrêter sur cette case ? (un allié se traverse, on ne s'y arrête pas)
 * @param {(from, to) => number} [query.stepCost]   Coût d'un pas, 1 par défaut (2 en terrain difficile).
 * @param {(cell) => {cell: object, cost: number}[]} [query.transitions]  Voisins hors grille d'une case (P2) :
 *   la même case sur un autre niveau par un escalier, au coût de la hauteur franchie. Une case garde le
 *   `level` de celle d'où l'on vient ; seule une transition en change.
 * @param {number} [query.maxNodes]                 Garde-fou : nombre de cases explorées.
 * @returns {{path: {i:number,j:number}[], cost: number}|null}  Le chemin, départ compris, ou null.
 */
export function findPath({ start, goals, isGoal, heuristic, canStep, canEnd=() => true, stepCost=() => 1, transitions=null, maxNodes=6000 }) {
  let arrived = isGoal ? (c => isGoal(c) && canEnd(c)) : null;
  let h = heuristic ?? (() => 0);
  if ( !arrived ) {
    const targets = (goals ?? []).filter(canEnd);
    if ( !targets.length ) return null;
    const goalKeys = new Set(targets.map(key));
    arrived = c => goalKeys.has(key(c));
    h = c => {
      let best = Infinity;
      for ( const g of targets ) best = Math.min(best, cellDistance(c, g));
      return best;
    };
  }
  if ( arrived(start) ) return { path: [{ ...start }], cost: 0 };

  const open = new Heap();
  const best = new Map([[key(start), 0]]);
  const parent = new Map();
  open.push({ cell: start, g: 0, f: h(start) });
  let explored = 0;

  while ( open.size ) {
    const { cell, g } = open.pop();
    const k = key(cell);
    if ( g > (best.get(k) ?? Infinity) ) continue;   // entrée périmée
    if ( arrived(cell) ) {
      const path = [cell];
      for ( let p = parent.get(k); p; p = parent.get(key(p)) ) path.unshift(p);
      return { path, cost: Math.round(g) };
    }
    if ( ++explored > maxNodes ) return null;
    const relax = (next, ng) => {
      const nk = key(next);
      if ( ng >= (best.get(nk) ?? Infinity) ) return;
      best.set(nk, ng);
      parent.set(nk, cell);
      open.push({ cell: next, g: ng, f: ng + h(next) });
    };
    for ( const [di, dj] of NEIGHBOURS ) {
      const next = { i: cell.i + di, j: cell.j + dj };
      if ( cell.level !== undefined ) next.level = cell.level;
      if ( !canStep(cell, next) ) continue;
      // Une diagonale coûte un soupçon de plus : à coût égal on préfère le chemin le plus droit.
      relax(next, g + stepCost(cell, next) + ((di && dj) ? 0.001 : 0));
    }
    // P2 : un escalier, une échelle — la même case sur un autre niveau.
    if ( transitions ) for ( const { cell: next, cost } of transitions(cell) ) relax(next, g + cost);
  }
  return null;
}

/** Retire les cases intermédiaires alignées : il ne reste que le départ, les virages et l'arrivée. */
export function corners(path) {
  if ( path.length <= 2 ) return path.slice();
  const out = [path[0]];
  for ( let n = 1; n < path.length - 1; n++ ) {
    const a = path[n - 1], b = path[n], c = path[n + 1];
    if ( ((b.i - a.i) !== (c.i - b.i)) || ((b.j - a.j) !== (c.j - b.j)) ) out.push(b);
  }
  out.push(path.at(-1));
  return out;
}
