/**
 * §225 : le plan Éthéré, version simple — le statut `ethereal` de dnd5e tient lieu de plan, sur la même carte. Une créature dans
 * l'Éthéré limitrophe « ne peut affecter et être affectée que par ce qui est aussi sur le plan Éthéré » (Forme éthérée, Clignotement,
 * PHB 2024) : ni cible, ni attaque, ni attaque d'opportunité, ni réaction, ni zone, ni aura d'un plan à l'autre, et l'on ne se bloque
 * pas les cases. Lot 2 : la perception d'un plan à l'autre (`perceivesAcross`). Les murs traversés (lot 3) et le retour (lot 4)
 * viendront ensuite.
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
