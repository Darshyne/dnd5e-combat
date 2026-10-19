/**
 * Escalade (SPEC §192, lot 1 : les murs ; lot 2 : les plafonds ; lot 3 : le contenu, §195). Noyau pur.
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

/**
 * Un item (son identifiant, son entrée de contenu) donne-t-il la marche au plafond ? Sur une surface glissante (`slippery`, §195), pas un
 * item qui ne tient pas sur une surface glissante (`notOnSlippery` : les Pantoufles d'araignée).
 */
export function grantsCeiling(identifier, entry=null, { slippery=false }={}) {
  if ( slippery && (entry?.notOnSlippery === true) ) return false;
  return CEILING_IDENTIFIERS.includes(identifier) || (entry?.climbsCeilings === true);
}

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

/* -------------------------------------------- */
/*  Contenu (lot 3)                             */
/* -------------------------------------------- */

/**
 * Les changements d'effet qu'une règle `grantsSpeeds` (§195 : Athlète, « une vitesse d'escalade égale à votre Vitesse ») donne au porteur :
 * `"walk"` vaut la Vitesse lue maintenant (`walk`), un nombre vaut lui-même ; même forme que les capacités de dnd5e qui donnent une
 * vitesse (`system.attributes.movement.<vitesse>`, `upgrade`). Une valeur nulle ne donne rien.
 * @param {Record<string, "walk"|number>} rule
 * @param {number} walk
 * @returns {Array<{key: string, type: string, value: string}>}
 */
export function grantedSpeedChanges(rule, walk) {
  const out = [];
  for ( const [type, value] of Object.entries(rule ?? {}) ) {
    const speed = (value === "walk") ? (Number(walk) || 0) : (Number(value) || 0);
    if ( speed > 0 ) out.push({ key: `system.attributes.movement.${type}`, type: "upgrade", value: String(speed) });
  }
  return out;
}

/** Les changements d'un effet sont-ils ceux voulus (mêmes clés, types, valeurs ; l'ordre ne compte pas) ? */
export function sameSpeedChanges(current, wanted) {
  const norm = list => (list ?? []).map(c => `${c.key}|${c.type}|${String(c.value)}`).sort().join(";");
  return norm(current) === norm(wanted);
}

/**
 * Mouvement acrobatique (§195, Moine 9) : « sans armure ni bouclier, […] des surfaces verticales pendant votre tour ». En combat, à son tour
 * seulement ; hors combat, toujours (il n'y a pas de tour — rien ne le fait tomber).
 * @param {{armor?: boolean, shield?: boolean, inCombat?: boolean, ownTurn?: boolean}} state
 */
export function acrobaticAllowed({ armor=false, shield=false, inCombat=false, ownTurn=false }={}) {
  if ( armor || shield ) return false;
  return !inCombat || ownTurn;
}

/**
 * Le moine qui finissait son tour en courant sur le mur tombe-t-il ? Oui s'il y est encore (en escalade, au-dessus du sol), pas s'il est
 * redescendu ni s'il a gagné le plafond (il n'y monte pas ainsi).
 * @param {{acrobatic?: boolean, climbing?: boolean, aboveGround?: boolean, onCeiling?: boolean}} state
 */
export const acrobaticFallDue = ({ acrobatic=false, climbing=false, aboveGround=false, onCeiling=false }={}) =>
  acrobatic && climbing && aboveGround && !onCeiling;

/**
 * §209 : se hisser sur un rebord (toit, chemin de ronde, étage) depuis le mur où l'on grimpe. Le sol de la case voisine doit être plus haut
 * que les pieds du grimpeur et pas plus haut que sa tête (il l'atteint des mains), et il faut assez de place au-dessus pour s'y tenir.
 * Rend la hauteur qui reste à monter, ou null si le rebord n'est pas à sa portée.
 * @param {{feet: number, height: number, ground: number, ceiling?: number}} data
 *   `height` : la hauteur du token ; `ground` : le sol de la case voisine ; `ceiling` : le plafond au-dessus d'elle (Infinity : aucun).
 * @returns {number|null}
 */
export function ledgeRise({ feet, height, ground, ceiling=Infinity }) {
  const eps = 1e-6;
  if ( !Number.isFinite(ground) || !(ground > feet + eps) || (ground > feet + height + eps) ) return null;
  if ( (ceiling - ground) < height - eps ) return null;
  return ground - feet;
}

/**
 * §209 : ce que coûte se hisser : la hauteur qui reste, au prix de l'escalade (`multiplier` : 2 sans vitesse d'escalade), plus la case où
 * l'on prend pied. Unités de la grille.
 */
export const ledgeCost = ({ rise, multiplier, gridDistance }) => (rise * multiplier) + gridDistance;

/* -------------------------------------------- */
/*  La jauge de la fenêtre d'escalade (§215)     */
/* -------------------------------------------- */

/**
 * Les dés de chute (dnd5e, rules/falling.mjs : 1d6 par tranche de 10 ft, 20d6 au plus) pour une hauteur au-dessus du sol, dans l'unité
 * de la grille (`step` : 10 en pieds, 3 en mètres).
 */
/** §215 : à l'aveugle hors combat, la montée d'un coup est bornée (on ne propose pas 100 ft dans le noir). */
export const HIDDEN_CLIMB_CELLS = 6;

export const fallDice = (height, step=10) => Math.max(0, Math.min(20, Math.floor((height + 1e-6) / step)));

/**
 * La jauge de la fenêtre « Grimper » / « Descendre » : le mur vu de profil, case par case.
 *  - Montée : les cases au-dessus des pieds du grimpeur ; on peut choisir celles que le déplacement du tour paie et, si le haut est
 *    vu (`seen`), que le plafond laisse (`ceilingFeet` : l'élévation la plus haute des pieds sous le plafond). Le haut (`top` : un rebord
 *    `{ kind: "ledge", at }` où poser les pieds, ou le plafond `{ kind: "ceiling", at }`) n'est rendu que s'il est vu — sinon rien ne le
 *    trahit, pas même le nombre de cases : on choisit d'après son seul déplacement, et la montée s'arrête au plafond.
 *  - Descente : les cases sous les pieds jusqu'au sol (`ground`).
 * @returns {{cells: Array<{n: number, at: number, choosable: boolean}>, choosable: number, top: object|null, hidden: boolean}}
 */
export function climbGauge({ feet, ground=0, gridDistance, height=gridDistance, remaining, multiplier, ceilingFeet=Infinity, top=null, seen=true, down=false, marks=[] }) {
  const affordable = climbableCells({ remaining, gridDistance, multiplier });
  if ( down ) {
    const depth = Math.max(0, Math.floor(((feet - ground) / gridDistance) + 1e-6));
    const choosable = Math.min(affordable, depth);
    const cells = Array.from({ length: depth }, (_, i) => ({ n: i + 1, at: feet - ((i + 1) * gridDistance), choosable: (i + 1) <= choosable }));
    return { cells, choosable, top: null, hidden: false, marks: [], topCells: 0 };
  }
  const real = climbableCells({ remaining, gridDistance, multiplier, ceilingCells: (ceilingFeet - feet) / gridDistance });
  // À l'aveugle et sans limite de déplacement (hors combat), pas plus de `HIDDEN_CLIMB_CELLS` cases d'un coup.
  const choosable = seen ? real : (Number.isFinite(remaining) ? affordable : Math.min(affordable, HIDDEN_CLIMB_CELLS));
  // Les cases montrées : celles qu'on peut choisir, jusqu'au haut s'il est vu — sous un rebord, la case d'où l'on s'y hisse (sa tête à
  // hauteur du rebord) ; sous un plafond, la case où la tête le touche (`ceilingFeet`).
  const below = top?.kind === "ledge" ? (top.at - height) : ceilingFeet;
  const toTop = (seen && top && Number.isFinite(below)) ? Math.max(0, Math.floor(((below - feet) / gridDistance) + 1e-6)) : 0;
  // §216 : la séparation du prochain niveau se voit même hors de portée (cases grisées jusqu'à elle) — sous un plafond vu, pas au-delà.
  // Seul un plafond vu arrête la jauge et les repères ; un rebord non (le mur peut continuer).
  const limit = (seen && ["ceiling", "wallEnd"].includes(top?.kind)) ? (top.at - feet) : Infinity;
  const ledge = seen && (top?.kind === "ledge");
  // Le prochain repère (au-delà du rebord quand il y en a un : celui du rebord se lit déjà).
  const nextMark = marks.find(m => (m.at > (ledge ? top.at + 1e-6 : feet)) && ((m.at - feet) <= limit + 1e-6));
  const toMark = nextMark ? Math.ceil(((nextMark.at - feet) / gridDistance) - 1e-6) : 0;
  // Sous un rebord vu, la jauge montre le rebord et un peu au-dessus (deux cases, ou jusqu'au prochain niveau), pas toute la hauteur
  // qu'on pourrait grimper : le champ « Cases » permet d'aller plus haut.
  const count = Math.min(MAX_CLIMB_CELLS, ledge ? Math.min(choosable, Math.max(toTop + 2, toMark)) : Math.max(choosable, toTop, toMark));
  const cells = Array.from({ length: count }, (_, i) => ({ n: i + 1, at: feet + ((i + 1) * gridDistance), choosable: (i + 1) <= choosable }));
  const shownTop = feet + (count * gridDistance) + height;
  return { cells, choosable, top: seen ? top : null, hidden: !seen, topCells: (seen && top) ? Math.min(choosable, toTop) : 0,
    marks: marks.filter(m => (m.at > feet) && (m.at <= shownTop + 1e-6) && (m.at <= limit + feet + 1e-6)) };
}
