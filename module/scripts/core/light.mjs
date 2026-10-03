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
