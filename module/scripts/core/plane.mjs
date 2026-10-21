/**
 * §225 : le plan Éthéré, version simple — le statut `ethereal` de dnd5e tient lieu de plan, sur la même carte. Une créature dans
 * l'Éthéré limitrophe « ne peut affecter et être affectée que par ce qui est aussi sur le plan Éthéré » (Forme éthérée, Clignotement,
 * PHB 2024) : ni cible, ni attaque, ni attaque d'opportunité, ni réaction, ni zone, ni aura d'un plan à l'autre, et l'on ne se bloque
 * pas les cases. Lot 2 : la perception d'un plan à l'autre (`perceivesAcross`). Lot 3 : les murs se traversent, sauf ceux qui arrêtent
 * le voyage éthéré (`crossesEtherealWall`), le vertical coûte double (`etherealStepCost`). Le retour (lot 4) viendra ensuite.
 *
 * Pur : aucune dépendance à Foundry.
 */

export const ETHEREAL = "ethereal";

/** Le plan d'une créature d'après ses statuts : « ethereal » ou « material ». Sans statuts (un point, un objet), le plan matériel. */
export function planeOf(statuses) {
  return statuses?.has?.(ETHEREAL) ? ETHEREAL : "material";
}

/** Deux créatures (leurs statuts) sur le même plan ? Ce qui n'a pas de statuts (null) est sur le plan matériel. */
export function samePlane(statusesA, statusesB) {
  return planeOf(statusesA) === planeOf(statusesB);
}

/**
 * §225, lot 2 : une créature peut-elle en percevoir une autre d'un plan à l'autre ? Même plan : oui (le reste du test décide).
 *  - depuis le matériel vers l'Éthéré : seulement à portée d'une vue de l'Éthéré (`etherealSight` : Détection de l'invisibilité,
 *    Troisième œil — illimitée —, Vision éthérée 60 ft, Vision suprême à sa portée ; null : aucune) ;
 *  - depuis l'Éthéré vers le matériel : « vous percevez le plan que vous avez quitté … rien au-delà de 60 ft » (`limit`) ;
 *  - `visibleAcross` : la cible se voit d'un plan à l'autre (le fantôme du MM, « visible sur le plan matériel … et inversement »).
 * Distances dans la même unité.
 */
export function perceivesAcross({ observerPlane, targetPlane, distance, etherealSight=null, limit=Infinity, visibleAcross=false }) {
  if ( observerPlane === targetPlane ) return true;
  if ( visibleAcross ) return true;
  if ( targetPlane === ETHEREAL ) return (etherealSight !== null) && (distance <= etherealSight + 1e-6);
  return distance <= limit + 1e-6;
}

/** Les segments [a, b] et [c, d] se coupent-ils (extrémités comprises) ? Points `{ x, y }`. */
function segmentsCross(a, b, c, d) {
  const orient = (p, q, r) => Math.sign(((q.x - p.x) * (r.y - p.y)) - ((q.y - p.y) * (r.x - p.x)));
  const onSegment = (p, q, r) => (Math.min(p.x, q.x) <= r.x + 1e-9) && (r.x <= Math.max(p.x, q.x) + 1e-9)
    && (Math.min(p.y, q.y) <= r.y + 1e-9) && (r.y <= Math.max(p.y, q.y) + 1e-9);
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if ( (o1 !== o2) && (o3 !== o4) ) return true;
  return ((o1 === 0) && onSegment(a, b, c)) || ((o2 === 0) && onSegment(a, b, d))
    || ((o3 === 0) && onSegment(c, d, a)) || ((o4 === 0) && onSegment(c, d, b));
}

/**
 * §225, lot 3 : un pas dans l'Éthéré, de `from` à `to`, franchit-il l'un de ces murs (ceux qui arrêtent le voyage éthéré : Mur de force,
 * Cage de force) ? `walls` : segments `[x0, y0, x1, y1]`. Tous les autres murs se traversent.
 */
export function crossesEtherealWall(from, to, walls) {
  return walls.some(([x0, y0, x1, y1]) => segmentsCross(from, to, { x: x0, y: y0 }, { x: x1, y: y1 }));
}

/** §225, lot 3 : « monter ou descendre coûte un pied de plus par pied » (Forme éthérée) — le coût d'un pas, sa part verticale doublée. */
export function etherealStepCost(cost, verticalDistance) {
  return cost + Math.abs(verticalDistance);
}
