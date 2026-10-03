/**
 * Mode de déplacement et élévation (SPEC §17.4, demande de l'utilisateur du 2026-09-26). Noyau pur.
 *
 * Un mode dit où se trouve le corps par rapport au sol sous lui :
 *  - marcher, ramper : au sol, toujours ;
 *  - voler : au moins à 5 ft au-dessus du sol ;
 *  - fouir : au moins à 5 ft sous le sol.
 * Les autres modes (escalade, nage, saut, téléportation, chute) laissent l'élévation telle quelle.
 *
 * Le « sol » est calculé par l'adaptateur (surface qui arrête le déplacement sous le token, sinon base du niveau).
 */

/** Où un mode place le corps : `ground`, `air`, `under`, ou null (libre). */
const PLACEMENT = { walk: "ground", crawl: "ground", fly: "air", burrow: "under" };

export const placementOf = action => PLACEMENT[action] ?? null;

/** La vitesse de la fiche qu'un mode demande (null : aucune). */
const SPEED = { fly: "fly", burrow: "burrow" };

export const speedFor = action => SPEED[action] ?? null;

/**
 * Pourquoi ce mode est refusé à une créature, ou null. Voler ou fouir demande la vitesse correspondante.
 * @param {string} action
 * @param {Record<string, number>} speeds  Vitesses préparées de la fiche.
 * @returns {"noSpeed"|null}
 */
export function modeRefusal(action, speeds) {
  const speed = speedFor(action);
  if ( !speed ) return null;
  return (Number(speeds?.[speed]) > 0) ? null : "noSpeed";
}

/**
 * L'élévation cohérente avec un mode, au plus près de l'élévation voulue.
 * @param {string} action
 * @param {number} elevation   Élévation voulue.
 * @param {number} ground      Élévation du sol à cet endroit.
 * @param {number} clearance   Écart minimal au sol en vol ou en fouissement (5 ft, dans l'unité de la scène).
 * @param {number} [ceiling]   Élévation la plus haute où poser les pieds en vol : sous le plafond, tête comprise. Un
 *                             plafond plus bas que  ne l'emporte pas (on vole quand même à 5 ft).
 */
export function coherentElevation(action, elevation, ground, clearance, ceiling=Infinity) {
  switch ( placementOf(action) ) {
    case "ground": return ground;
    case "air": return Math.min(Math.max(elevation, ground + clearance), Math.max(ceiling, ground + clearance));
    case "under": return Math.min(elevation, ground - clearance);
    default: return elevation;
  }
}

/**
 * Le mouvement vertical qu'impose un changement de mode, ou null s'il n'y en a pas : décoller, atterrir, s'enfouir,
 * remonter. `action` est le mode dans lequel ce mouvement se fait (on descend en volant, on remonte en fouissant).
 * Un changement vers un mode au sol depuis un mode libre (escalade, saut…) ne déplace rien : si le corps est en l'air,
 * c'est une chute, que dnd5e gère (état « En chute »).
 * @param {string} from        Mode actuel.
 * @param {string} to          Mode demandé.
 * @param {number} elevation   Élévation actuelle.
 * @param {number} ground
 * @param {number} clearance
 * @param {number} [ceiling]
 * @returns {{elevation: number, action: string}|null}
 */
export function modeShift(from, to, elevation, ground, clearance, ceiling=Infinity) {
  const target = coherentElevation(to, elevation, ground, clearance, ceiling);
  if ( Math.abs(target - elevation) < 1e-6 ) return null;
  if ( placementOf(to) !== "ground" ) return { elevation: target, action: to };
  if ( ["air", "under"].includes(placementOf(from)) ) return { elevation: target, action: from };
  return null;
}

/**
 * Aligne un chemin sur le sol selon le mode de chaque pas.
 *  - Au sol, le corps suit le sol : une marche de `step` (5 ft) au plus, en montant comme en descendant. Plus haut, il
 *    faut grimper (`tooHigh`, chemin refusé) ; plus bas, c'est une chute : le chemin s'arrête au bord, sur le vide,
 *    et dnd5e met la créature « En chute » (`falls`). `lenient` (le MJ) : le sol est suivi quoi qu'il arrive.
 *  - En vol, jamais sous `sol + clearance` ni au-dessus de `ceiling` ; en fouissement, jamais au-dessus de `sol − clearance`.
 *  - Les autres modes ne sont pas touchés.
 * @param {{elevation: number}} origin                               Point de départ (élévation actuelle).
 * @param {{elevation: number, action: string, ground: number, ceiling?: number}[]} waypoints
 * @param {{clearance: number, step: number, lenient?: boolean}} options
 * @returns {{elevations: number[], kept: number, issue: "tooHigh"|"falls"|null, changed: boolean}}
 *   `elevations` : une par point gardé ; `kept` : nombre de points gardés.
 */
export function alignPath(origin, waypoints, { clearance, step, lenient=false }) {
  const elevations = [];
  let previous = origin.elevation;
  let changed = false;
  for ( const w of waypoints ) {
    let elevation = coherentElevation(w.action, w.elevation, w.ground, clearance, w.ceiling ?? Infinity);
    if ( !lenient && (placementOf(w.action) === "ground") ) {
      const rise = elevation - previous;
      if ( rise > step + 1e-6 ) return { elevations, kept: elevations.length, issue: "tooHigh", changed: true };
      if ( -rise > step + 1e-6 ) {
        // Le pas au-dessus du vide : on y va, à l'élévation d'où l'on vient, et l'on s'arrête là.
        elevations.push(previous);
        return { elevations, kept: elevations.length, issue: "falls", changed: true };
      }
    }
    if ( Math.abs(elevation - w.elevation) > 1e-6 ) changed = true;
    elevations.push(elevation);
    previous = elevation;
  }
  return { elevations, kept: elevations.length, issue: null, changed };
}

/**
 * Un pas de l'A*, d'une case à une voisine, est-il possible au sol ? La même marche de `step` au plus : l'A* ne fait ni
 * grimper ni sauter dans le vide.
 */
export const groundStepAllowed = (fromGround, toGround, step) => Math.abs(toGround - fromGround) <= step + 1e-6;
