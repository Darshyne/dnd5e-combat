/**
 * Escalade (SPEC §192, lot 1 : les murs ; lot 2 : les plafonds). Noyau pur.
 *
 * Règles 2024 (Manuel des joueurs, glossaire « Climbing », « Climb Speed ») : grimper ne demande aucun jet — chaque pied coûte un
 * pied de plus sans vitesse d'escalade (le coût est celui de dnd5e, action `climb`), rien de plus avec. Le DD 15 Force
 * (Athlétisme) n'existe que « au choix du MJ » : c'est le réglage de monde « maison » (`climbRules`), qui le demande à chaque tour
 * (toutes les 10 s hors combat) et fait tomber sur un échec. Une créature À terre, Neutralisée, Agrippée ou à Vitesse 0 ne tient
 * pas au mur : elle tombe (dnd5e ne réévalue la chute qu'après un déplacement, le moteur la déclenche).
 */

/** DD du test de Force (Athlétisme) pour tenir à un mur (réglage « maison »). */
export const CLIMB_DC = 15;
/** DD du test pour gagner ou tenir un plafond sans la capacité (réglage « maison », §192.2 : la proposition). */
export const CEILING_DC = 20;
/** Hors combat, l'équivalent d'un tour : 10 s (comme la nouvelle tentative de Se cacher, §183). */
export const CLIMB_CHECK_SECONDS = 10;
/** Sans plafond ni budget (hors combat), on ne monte pas plus haut d'un coup. */
export const MAX_CLIMB_CELLS = 20;

/**
 * Un segment (une arête de mur) touche-t-il un rectangle (l'emprise d'un token), à `tolerance` près ? Le rectangle est élargi de la
 * tolérance, puis on cherche une intersection avec le segment : une extrémité dedans, ou le segment qui le traverse (Liang–Barsky).
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {number} [tolerance]
 */
export function segmentTouchesRect(a, b, rect, tolerance=0) {
  const x0 = rect.x - tolerance, y0 = rect.y - tolerance;
  const x1 = rect.x + rect.width + tolerance, y1 = rect.y + rect.height + tolerance;
  const inside = p => (p.x >= x0) && (p.x <= x1) && (p.y >= y0) && (p.y <= y1);
  if ( inside(a) || inside(b) ) return true;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for ( const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] ) {
    if ( p === 0 ) { if ( q < 0 ) return false; continue; }
    const r = q / p;
    if ( p < 0 ) { if ( r > t1 ) return false; if ( r > t0 ) t0 = r; }
    else { if ( r < t0 ) return false; if ( r < t1 ) t1 = r; }
  }
  return t0 <= t1;
}

/**
 * Le mur est-il de ceux qu'on grimpe ? Pas une porte ouverte, pas un mur sans restriction de déplacement, pas un mur posé par
 * un sort (`spell` : son identifiant, ou null) sauf le Mur de pierre.
 * @param {{move: boolean, openDoor: boolean, spell?: string|null}} wall
 */
export function isClimbableWall({ move, openDoor, spell=null }) {
  if ( !move || openDoor ) return false;
  return !spell || (spell === "wall-of-stone");
}

/**
 * La vitesse qui borne le tour en escalade : l'escalade si la fiche en a une, sinon la marche (le ×2 est dans le coût de dnd5e).
 * @param {Record<string, number>} speeds  Vitesses préparées.
 * @returns {{speed: number, native: boolean}}  `native` : une vraie vitesse d'escalade.
 */
export function climbSpeed(speeds) {
  const climb = Number(speeds?.climb) || 0;
  if ( climb > 0 ) return { speed: climb, native: true };
  return { speed: Number(speeds?.walk) || 0, native: false };
}

/** Ce que coûte un pied d'escalade, en multiple : 2 sans vitesse d'escalade, 1 avec (dnd5e, `walkFallback`). */
export const climbMultiplier = speeds => (climbSpeed(speeds).native ? 1 : 2);

/**
 * Pourquoi un grimpeur ne tient plus au mur, ou null : À terre, Neutralisé, Agrippé, ou plus de vitesse (Entravé, Paralysé…).
 * @param {{prone?: boolean, incapacitated?: boolean, grappled?: boolean, speed?: number}} state
 * @returns {"prone"|"incapacitated"|"grappled"|"noSpeed"|null}
 */
export function climbFallReason({ prone=false, incapacitated=false, grappled=false, speed=0 }={}) {
  if ( prone ) return "prone";
  if ( incapacitated ) return "incapacitated";
  if ( grappled ) return "grappled";
  if ( !(speed > 0) ) return "noSpeed";
  return null;
}

/**
 * Combien de cases on peut monter d'un coup : ce que le déplacement restant paie (une case coûte `gridDistance × multiplier`), sous
 * le plafond (`ceilingCells` : cases libres au-dessus, Infinity sans plafond), jamais plus de `MAX_CLIMB_CELLS`.
 * @param {{remaining: number, gridDistance: number, multiplier: number, ceilingCells?: number}} p
 */
export function climbableCells({ remaining, gridDistance, multiplier, ceilingCells=Infinity }) {
  const affordable = Number.isFinite(remaining) ? Math.floor((remaining / (gridDistance * multiplier)) + 1e-6) : MAX_CLIMB_CELLS;
  const room = Number.isFinite(ceilingCells) ? Math.max(0, Math.floor(ceilingCells + 1e-6)) : MAX_CLIMB_CELLS;
  return Math.max(0, Math.min(affordable, room, MAX_CLIMB_CELLS));
}

/** Le test du mode « maison » est-il dû : jamais fait, ou fait il y a plus de `intervalMs` ? */
export const climbCheckDue = (lastAt, now, intervalMs) => !Number.isFinite(lastAt) || ((now - lastAt) >= intervalMs);

/* -------------------------------------------- */
/*  Plafonds (lot 2)                            */
/* -------------------------------------------- */

/**
 * Les identifiants dnd5e qui donnent la marche au plafond (§192.3) : le sort Pattes d'araignée (et le trait de monstre du même
 * identifiant), les Pantoufles d'araignée et la Cape d'arachnide du Guide du maître. Un voisin déclare les siens par le contenu
 * (`climbsCeilings: true`, `api.content.register`).
 */
export const CEILING_IDENTIFIERS = Object.freeze(["spider-climb", "slippers-of-spider-climbing", "cloak-of-arachnida"]);

/** Un item (son identifiant, son entrée de contenu) donne-t-il la marche au plafond ? */
export const grantsCeiling = (identifier, entry=null) => CEILING_IDENTIFIERS.includes(identifier) || (entry?.climbsCeilings === true);

/**
 * L'élévation des pieds d'une créature accrochée à un plafond : le plafond moins sa hauteur (`depth` en cases). null sans plafond.
 * @param {number} ceiling        Élévation du plafond (Infinity : aucun).
 * @param {number} depth          Hauteur de la créature, en cases.
 * @param {number} gridDistance
 */
export function ceilingPerch(ceiling, depth, gridDistance) {
  if ( !Number.isFinite(ceiling) ) return null;
  return ceiling - (depth * gridDistance);
}

/** La créature est-elle accrochée à ce plafond (sa tête contre lui) ? */
export function hangsFrom(elevation, depth, gridDistance, ceiling) {
  const perch = ceilingPerch(ceiling, depth, gridDistance);
  return (perch !== null) && (Math.abs(elevation - perch) < 1e-6);
}

/**
 * Le miroir vertical d'un token au plafond (§192.4 point 8) : l'échelle verticale inversée, l'échelle d'origine gardée pour la
 * rendre en quittant le plafond — un token déjà en miroir repasse à l'endroit, ce qui est bien « la tête en bas » pour lui.
 */
export const flippedScale = scaleY => -(Number(scaleY) || 1);
