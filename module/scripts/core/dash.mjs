/**
 * Ruée en ligne droite (SPEC §57, clé `lineDash` de core/content.mjs) : la créature va de sa case à la case choisie en ligne
 * droite, et ce qui se trouve près des espaces qu'elle traverse subit l'activité (par exemple : toute
 * créature à 1,50 m au plus d'une case de son trajet). Ici, les cases traversées, sans Foundry.
 */

/**
 * Les positions (coin haut-gauche, en cases) d'une emprise qui glisse en ligne droite de `from` à `to`, départ et arrivée
 * compris, sans doublon : l'échantillon se prend tous les quarts de case, et chaque position est la case la plus proche.
 * @param {{i: number, j: number}} from
 * @param {{i: number, j: number}} to
 * @returns {{i: number, j: number}[]}
 */
export function straightCells(from, to) {
  const di = to.i - from.i;
  const dj = to.j - from.j;
  const n = Math.max(1, 4 * Math.max(Math.abs(di), Math.abs(dj)));
  const out = [];
  const seen = new Set();
  for ( let k = 0; k <= n; k++ ) {
    // Arrondi symétrique (une demi-case s'éloigne de zéro dans les deux sens) : le tracé ne dépend pas de la direction.
    const cell = { i: from.i + nearest((di * k) / n), j: from.j + nearest((dj * k) / n) };
    const key = `${cell.i},${cell.j}`;
    if ( seen.has(key) ) continue;
    seen.add(key);
    out.push(cell);
  }
  return out;
}

const nearest = x => ((x < 0) ? -Math.round(-x) : Math.round(x)) + 0;
