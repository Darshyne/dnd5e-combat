/**
 * §182 : les cônes de vision hors combat. Une créature du MJ, hors d'un combat commencé, ne voit que dans un cône centré sur
 * sa rotation (convention du cœur : 0 = vers le bas, sens horaire) ; l'angle dépend de son type de créature (réglable), d'un
 * flag du token, ou du `sight.angle` du token s'il est plus étroit. La vision aveugle, la perception des vibrations et la vision
 * véritable perçoivent à 360° dans leur portée. En combat : 360°, comme les règles 2024.
 * Fonctions pures.
 */

/** Angles par défaut : la plupart des créatures voient devant elles ; les vases et les plantes, sans yeux, partout. */
export const DEFAULT_CONE_ANGLES = Object.freeze({ default: 120, beast: 150, ooze: 360, plant: 360 });

/** Le texte du réglage par défaut (`120; beast 150; ooze 360; plant 360`). */
export function formatConeAngles(table=DEFAULT_CONE_ANGLES) {
  const { default: base, ...types } = table;
  return [String(base ?? 120), ...Object.entries(types).map(([k, v]) => `${k} ${v}`)].join("; ");
}

const clampAngle = v => Math.min(360, Math.max(1, Math.round(v)));

/**
 * Lire le réglage : un nombre seul = l'angle par défaut ; `type nombre` = l'angle d'un type (ou sous-type, ou identifiant).
 * Ce qui ne se lit pas est ignoré.
 * @param {string} text
 * @returns {Object<string, number>}
 */
export function parseConeAngles(text) {
  const out = { default: DEFAULT_CONE_ANGLES.default };
  for ( const part of String(text ?? "").split(/[;\n]+/) ) {
    const bits = part.trim().split(/[\s:=]+/).filter(Boolean);
    if ( bits.length === 1 && Number.isFinite(Number(bits[0])) ) out.default = clampAngle(Number(bits[0]));
    else if ( (bits.length === 2) && Number.isFinite(Number(bits[1])) ) out[bits[0].toLowerCase()] = clampAngle(Number(bits[1]));
  }
  return out;
}

/** L'angle d'une créature : identifiant > sous-type > type > défaut. */
export function coneAngleFor(table, { type, subtype, identifier }={}) {
  const low = v => (typeof v === "string" ? v.trim().toLowerCase() : "");
  if ( identifier && (low(identifier) in table) ) return table[low(identifier)];
  for ( const s of low(subtype).split(/[,;/]+/).map(x => x.trim()).filter(Boolean) ) if ( s in table ) return table[s];
  if ( type && (low(type) in table) ) return table[low(type)];
  return table.default ?? DEFAULT_CONE_ANGLES.default;
}

/** Le cap d'un vecteur dans la convention du cœur (0 = vers le bas, 90 = vers la gauche, sens horaire), en degrés [0, 360). */
export function bearingOf(dx, dy) {
  const deg = Math.atan2(-dx, dy) * 180 / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** L'écart signé entre deux caps, dans (-180, 180]. */
export function angleBetween(a, b) {
  let d = ((b - a) % 360 + 360) % 360;
  if ( d > 180 ) d -= 360;
  return d;
}

/**
 * Un des points est-il dans le cône ? Un point confondu avec l'œil compte comme dedans.
 * @param {{x: number, y: number}} eye
 * @param {number} rotation  degrés, convention du cœur
 * @param {number} angle     ouverture totale, degrés ; ≥ 360 : partout
 * @param {Array<{x: number, y: number}>} points
 */
export function inCone(eye, rotation, angle, points) {
  if ( !(angle < 360) ) return true;
  const half = angle / 2;
  return points.some(p => {
    const dx = p.x - eye.x, dy = p.y - eye.y;
    if ( Math.hypot(dx, dy) < 1e-6 ) return true;
    return Math.abs(angleBetween(rotation ?? 0, bearingOf(dx, dy))) <= half + 1e-6;
  });
}
