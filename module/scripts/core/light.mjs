/**
 * Lumière et ténèbres des sorts (SPEC §16.31, clé `light` de core/content.mjs). dnd5e 6 et le PHB 2.2.0 ne donnent aucune
 * source de lumière à ces sorts (Ténèbres et Lumière du jour : activité utilitaire à sphère ; Poussière d'étoile et Lueurs
 * féeriques : effet sans changement) ; le cœur V14 sait pourtant tout faire — lumière ambiante, source de ténèbres
 * (`config.negative`), et changements `token.light.*` portés par un effet actif (client/documents/actor.mjs:248).
 * Ici : les calculs, sans Foundry.
 *
 * Rayons dans la convention de Foundry : `bright` = rayon de la lumière vive, `dim` = rayon EXTÉRIEUR de la lumière
 * faible (Lumière du jour : vive sur 18 m et faible sur 18 m de plus → bright 60, dim 120).
 */

/** Les modes de `light.on`. */
export const LIGHT_ON = Object.freeze(["area", "effect", "summon"]);

/**
 * Les rayons de la source d'une zone : ceux de la règle, sinon (ténèbres) le rayon de la zone elle-même.
 * @param {{bright?: number, dim?: number, darkness?: boolean}} rule   Rayons déjà dans l'unité de la grille.
 * @param {number} areaRadius                                         Rayon de la zone, unité de la grille.
 * @returns {{bright: number, dim: number, negative: boolean}}
 */
export function areaLightRadii(rule, areaRadius) {
  if ( rule.darkness ) return { bright: areaRadius, dim: areaRadius, negative: true };
  const bright = rule.bright ?? 0;
  return { bright, dim: Math.max(rule.dim ?? bright, bright), negative: false };
}

/**
 * Les changements d'effet actif qui font briller le porteur (`token.light.*`, appliqués par le cœur V14). `upgrade` : une
 * lumière plus forte déjà portée (torche, autre sort) n'est pas diminuée.
 * @param {{bright?: number, dim?: number, color?: string|null, animation?: object|null}} light  Rayons, unité de la grille.
 */
export function tokenLightChanges({ bright=0, dim=0, color=null, animation=null, alpha=null, angle=null }) {
  const changes = [];
  const push = (key, value, type) => changes.push({ key: `token.light.${key}`, type, value: String(value), phase: "initial" });
  if ( bright > 0 ) push("bright", bright, "upgrade");
  push("dim", Math.max(dim, bright), "upgrade");
  if ( color ) push("color", color, "override");
  if ( Number.isFinite(alpha) ) push("alpha", alpha, "override");
  // §52 : un cône (lanterne sourde), orienté comme le token.
  if ( Number.isFinite(angle) && (angle > 0) && (angle < 360) ) push("angle", angle, "override");
  if ( animation?.type ) {
    push("animation.type", animation.type, "override");
    if ( Number.isFinite(animation.speed) ) push("animation.speed", animation.speed, "override");
    if ( Number.isFinite(animation.intensity) ) push("animation.intensity", animation.intensity, "override");
  }
  return changes;
}

/**
 * Les ténèbres que dissipe une lumière (Lumière du jour : « si une partie de la zone recouvre des Ténèbres créées par un sort
 * de niveau 3 ou inférieur, ce sort est dissipé »). Deux sphères se recouvrent quand leurs centres sont plus proches que la
 * somme des rayons.
 * @param {{x: number, y: number, radius: number}} light
 * @param {number} maxLevel
 * @param {Array<{id: string, x: number, y: number, radius: number, level: number|null}>} darkness
 * @returns {string[]}  Les ids dissipés.
 */
export function dispelledBy(light, maxLevel, darkness) {
  return darkness.filter(d => {
    if ( Number.isFinite(d.level) && (d.level > maxLevel) ) return false;
    return Math.hypot(d.x - light.x, d.y - light.y) < (d.radius + light.radius);
  }).map(d => d.id);
}

/**
 * Les sens qui percent une zone qui bloque la vue. Brume (`obscures`) : ceux qui ne voient pas. Ténèbres magiques : ceux-là,
 * plus la vision véritable (`seeAll` de dnd5e) — la vision dans le noir, elle, n'y voit rien (PHB 2024, Ténèbres).
 * La Vision du diable se juge à part (portée, adapter/vision.mjs).
 * @param {{fog: boolean, darkness: boolean}} blocked
 */
export function sensesThrough({ fog, darkness }) {
  if ( fog ) return ["blindsight", "feelTremor"];
  if ( darkness ) return ["blindsight", "feelTremor", "seeAll"];
  return null;
}

/** Portée de la Vision du diable (« dans un rayon de 36 m »), en pieds. */
export const DEVILS_SIGHT = Object.freeze({ identifier: "devils-sight", range: 120, units: "ft" });

/* -------------------------------------------- */
/*  Durée et combustible des sources portées    */
/* -------------------------------------------- */

const BURN_SECONDS = { second: 1, minute: 60, hour: 3600 };

/**
 * §121 : la durée d'une source portée (`carriedLight.burn`), en secondes : « une torche brûle 1 heure », « une flasque d'huile
 * brûle 6 heures dans une lampe ou une lanterne ». null : pas de durée.
 * @param {{value: number, units: "second"|"minute"|"hour"}|undefined} burn
 */
export function burnSeconds(burn) {
  const n = Number(burn?.value);
  return (Number.isFinite(n) && (n > 0) && BURN_SECONDS[burn.units]) ? n * BURN_SECONDS[burn.units] : null;
}

/**
 * §121 : ce que demande l'allumage. `stored` : le temps qui restait quand on l'a éteinte (indéfini : jamais allumée — une torche
 * neuve, une lampe remplie) ; `full` : une torche entière, une flasque entière ; `fuel` : la source brûle un combustible (lampe,
 * lanterne) ; `hasFuel` : le porteur en a une flasque.
 * @returns {{ok: true, left: number|null, refill: boolean}|{ok: false, reason: "noFuel"}}
 */
export function lightPlan({ stored, full, fuel=false, hasFuel=false }) {
  if ( !Number.isFinite(full) ) return { ok: true, left: null, refill: false };
  if ( (stored === undefined) || (stored === null) ) return { ok: true, left: full, refill: false };
  if ( stored > 0 ) return { ok: true, left: Math.min(stored, full), refill: false };
  if ( !fuel ) return { ok: true, left: full, refill: false };   // une torche consumée a laissé place à la suivante
  return hasFuel ? { ok: true, left: full, refill: true } : { ok: false, reason: "noFuel" };
}

/**
 * §121 : la source s'est consumée. Une torche, une bougie : l'unité brûlée disparaît (quantité − 1, l'item retiré à la dernière),
 * la suivante sera neuve ; une lampe, une lanterne : elle reste, vide (il faudra une flasque pour la rallumer).
 * @returns {{consume: boolean, stored: number|undefined}}
 */
export function burnoutPlan({ fuel=false }) {
  return fuel ? { consume: false, stored: 0 } : { consume: true, stored: undefined };
}

/** Le temps restant en heures et minutes (arrondi à la minute supérieure). */
export function burnParts(seconds) {
  const minutes = Math.max(0, Math.ceil((Number(seconds) || 0) / 60));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/**
 * §121 : les mains qu'occupe ce que la créature tient — une arme équipée (deux si elle est « à deux mains »), un bouclier, une
 * source de lumière allumée. Une créature a deux mains.
 * @param {Array<{name: string, hands: number}>} held
 * @returns {{used: number, free: number}}
 */
export function handsOf(held) {
  const used = held.reduce((n, h) => n + Math.max(0, Number(h.hands) || 0), 0);
  return { used, free: Math.max(0, 2 - used) };
}
