/**
 * Déplacement : ce qu'il reste à parcourir, jusqu'où un chemin est payable, où se placer pour
 * atteindre une cible, quelle attaque est « l'attaque de base ». Noyau pur, en cases.
 */

/** Déplacement encore disponible ce tour, jamais négatif. */
/**
 * Déplacement dépensé ce tour : la somme des coûts, hors téléportation et déplacement forcé (SPEC §16.10 : Pas brumeux,
 * une poussée ne consomment pas le déplacement de la créature). `teleport` : l'action du segment est de celles que le
 * cœur marque `teleport` (`blink`, `displace`).
 * @param {Array<{cost: number, teleport?: boolean}>} waypoints  L'historique de déplacement du tour.
 * @returns {{spent: number, excluded: number}}  `excluded` : ce que l'historique du cœur compte en plus.
 */
export function spentMovement(waypoints) {
  let spent = 0;
  let excluded = 0;
  for ( const w of waypoints ?? [] ) {
    if ( !Number.isFinite(w.cost) ) continue;
    if ( w.teleport ) excluded += w.cost;
    else spent += w.cost;
  }
  return { spent, excluded };
}

export function remainingMovement(allowance, spent) {
  return Math.max(0, allowance - spent);
}

/**
 * Nombre de pas d'un chemin que l'on peut payer.
 * @param {number[]} stepCosts  Coût de chaque pas, dans l'unité du budget.
 * @param {number} remaining    Déplacement restant, même unité.
 */
export function affordableSteps(stepCosts, remaining) {
  let spent = 0;
  let n = 0;
  for ( const cost of stepCosts ) {
    if ( spent + cost > remaining + 1e-6 ) break;
    spent += cost;
    n++;
  }
  return n;
}

/**
 * Écart en cases entre deux emprises rectangulaires (coin haut-gauche `i`,`j`, taille `w`×`h`) :
 * 0 si elles se chevauchent, 1 si elles se touchent, etc. À huit voisins, comme les distances de D&D.
 */
export function footprintGap(a, b) {
  const gap = (a0, aLen, b0, bLen) => Math.max(0, b0 - (a0 + aLen - 1), a0 - (b0 + bLen - 1));
  const di = gap(a.i, a.h, b.i, b.h);
  const dj = gap(a.j, a.w, b.j, b.w);
  const overlap = (di === 0) && (dj === 0);
  return overlap ? 0 : Math.max(di, dj, 1);
}

/**
 * Test d'arrivée et estimation pour approcher une cible à `reachCells` cases ou moins, sans la chevaucher.
 * @param {{i,j,w,h}} target  Emprise de la cible.
 * @param {{w,h}} mover       Taille de celui qui s'approche.
 */
export function approach(target, mover, reachCells) {
  const gapAt = cell => footprintGap({ i: cell.i, j: cell.j, w: mover.w, h: mover.h }, target);
  return {
    isGoal: cell => { const g = gapAt(cell); return (g >= 1) && (g <= reachCells); },
    heuristic: cell => Math.max(0, gapAt(cell) - reachCells)
  };
}

/**
 * L'attaque de base parmi des candidates : la mêlée d'abord (c'est elle qu'on porte en cliquant
 * sur un ennemi, quitte à s'approcher), sinon l'attaque à distance. À rang égal, l'arme équipée
 * avant l'attaque naturelle, puis l'ordre de la fiche.
 * @param {{id:string, melee:boolean, equipped:boolean, sort:number}[]} candidates
 */
export function chooseBasicAttack(candidates) {
  const rank = c => (c.melee ? 0 : 2) + (c.equipped ? 0 : 1);
  return candidates.slice().sort((a, b) => (rank(a) - rank(b)) || ((a.sort ?? 0) - (b.sort ?? 0)))[0] ?? null;
}

/**
 * Direction d'une poussée (Bousculade, SPEC §15.2) : de la source vers la cible, arrondie à l'une des
 * huit directions de la grille. `i` est la ligne (vers le bas), `j` la colonne (vers la droite).
 * Source et cible confondues : aucune direction.
 * @param {{x: number, y: number}} from  Centre de la source.
 * @param {{x: number, y: number}} to    Centre de la cible.
 * @returns {{di: -1|0|1, dj: -1|0|1}|null}
 */
export function pushDirection(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if ( (Math.abs(dx) < 1e-9) && (Math.abs(dy) < 1e-9) ) return null;
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const angle = octant * (Math.PI / 4);
  return { di: Math.round(Math.sin(angle)) || 0, dj: Math.round(Math.cos(angle)) || 0 };
}

/**
 * Coût du déplacement d'un agrippeur qui tire ou porte sa victime (règle 2024, glossaire « Agrippé » :
 * « ses coûts de déplacement sont doublés, sauf si vous êtes de taille TP ou que votre catégorie est
 * inférieure d'au moins deux crans à la sienne »). Tailles en rangs numériques (TP 0, P 1, M 2, G 3, TG 4, Gig 5).
 * @param {number} grapplerSize
 * @param {number[]} victimSizes  Les victimes traînées (vide : pas de surcoût).
 * @returns {1|2}
 */
export function dragMultiplier(grapplerSize, victimSizes) {
  const heavy = victimSizes.some(v => (v > 0) && (v > grapplerSize - 2));
  return heavy ? 2 : 1;
}

/**
 * Plafond de coût du tour d'un agrippeur qui traîne sa victime : ce qui lui reste à parcourir compte
 * double. `cap` et `spent` sont historique compris, dans l'unité de la grille.
 */
export function dragAllowance(cap, spent, multiplier) {
  if ( !Number.isFinite(cap) || (multiplier <= 1) ) return cap;
  return spent + (Math.max(0, cap - spent) / multiplier);
}

/**
 * §18.27 : la rotation (degrés, sens horaire, comme `TokenDocument#rotation`) qui tourne un token vers un déplacement de
 * (dx, dy) — y vers le bas. Rotation 0 = face au sud : la convention du cœur (un cône de vision de rotation 0 regarde vers
 * le bas), et celle des tokens vus de dessus. null si le déplacement est nul.
 */
export function facingRotation(dx, dy) {
  if ( !dx && !dy ) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;   // 0 = est, 90 = sud
  return Math.round(((angle - 90) % 360 + 360) % 360);
}
