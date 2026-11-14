/**
 * §403 : Liberté de mouvement — « la Vitesse de la cible ne peut pas être réduite par la magie ». Les changements d'un effet qui
 * réduiraient une Vitesse : ajout négatif, multiplication par moins de 1, valeur imposée (« override », « downgrade » : Danse
 * irrésistible, Lenteur…) sur `system.attributes.movement.*`. Pur.
 */

// §438 : dnd5e 6.1 (Manuel des joueurs 3.0.0) ajoute `movement.multiplier` (Lenteur : ×0,5) et `movement.bonus`, et le type « subtract ».
const MOVEMENT = /^system\.attributes\.movement\.(walk|fly|swim|climb|burrow|speed|all|bonus|multiplier)$/;

/** Ce changement réduit-il une Vitesse ? */
export function reducesSpeed(change) {
  if ( !MOVEMENT.test(change?.key ?? "") ) return false;
  const value = Number(change.value);
  switch ( change.type ?? change.mode ) {
    case "add": case 2: return Number.isFinite(value) && (value < 0);
    case "subtract": return Number.isFinite(value) && (value > 0);
    case "multiply": case 1: return Number.isFinite(value) && (value < 1);
    case "override": case 5: case "downgrade": case 3: return true;
    default: return false;
  }
}

/** Les changements sans ceux qui réduisent une Vitesse. */
export function withoutSpeedReductions(changes) {
  return (changes ?? []).filter(c => !reducesSpeed(c));
}
