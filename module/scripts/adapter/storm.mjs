/**
 * §70 : l'orage d'Appel de la foudre (clé de contenu `storm`).
 *
 * Le sort pose d'abord le NUAGE — la zone de l'item (cylindre de 18 m de rayon) que dnd5e fait poser à l'incantation : il
 * reste, rattaché à la concentration, sans rien résoudre lui-même, habillé en orage (pluie et éclairs de FXMaster s'il est
 * actif, sinon une zone sombre ; la région elle-même n'est plus montrée). Puis l'ÉCLAIR : un cercle de 1,50 m (`bolt`)
 * visé sous le nuage, posé comme une zone de l'activité — c'est lui que la résolution lit (sauvegarde, dégâts), puis
 * retire. Chaque relance du sort (action Magie, sans emplacement, §16.21 `recast`) ne vise qu'un nouvel éclair sous le même
 * nuage. « Dehors, par temps d'orage » (+1d10) se demande à l'incantation et se note sur le nuage.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors } from "./units.mjs";
import { shapeCenter } from "../core/area.mjs";

/** La règle d'orage d'un item (`{ bonus }`), ou null. */
export const stormOf = item => (item ? contentOf(item).entry?.storm ?? null : null);

/** Une région posée par un item à orage : le nuage, ou un éclair (`flags["dnd5e-combat"].bolt`). */
export const isBoltRegion = region => !!region?.getFlag?.(MODULE_ID, "bolt");

/** Le nuage d'un item sur la scène affichée (la région de son activité qui n'est pas un éclair), ou null. */
export function cloudOf(item, scene=canvas?.scene) {
  if ( !item || !scene ) return null;
  return scene.regions.find(r => (r.getFlag("dnd5e", "item") === item.uuid) && !isBoltRegion(r) && r.getFlag(MODULE_ID, "cloud")) ?? null;
}

/** Le centre et le rayon (pixels) du nuage. */
export function cloudCircle(cloud) {
  const shape = cloud?.shapes?.[0]?.toObject?.() ?? cloud?._source?.shapes?.[0];
  const center = shapeCenter(shape);
  if ( !center ) return null;
  const radius = Number(shape.radius ?? shape.radiusX ?? (shape.width ? shape.width / 2 : 0));
  return { center, radius };
}

/** Le rayon de l'éclair, en pixels de la scène (règle `bolt` : 5 ft), plus une demi-case comme à la pose calée sur la grille. */
export function boltRadiusPx(item, scene) {
  const rule = contentOf(item).entry?.bolt ?? { radius: 5, units: "ft" };
  let radius = rule.radius;
  try { radius = convertLength(radius, rule.units, scene.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  return ((radius / scene.grid.distance) * scene.grid.size) + (scene.grid.size / 2);
}

/** FXMaster actif : la pluie (particules) et les éclairs (filtre), dans la région seulement. */
function fxBehaviors(name) {
  if ( !game.modules.get("fxmaster")?.active ) return [];
  const rain = { density: 0.6, speed: 0.35, scale: 0.6, direction: 285, lifetime: 0.3, alpha: 0.9, splash: true, topDown: false,
    belowTokens: false, belowTiles: false, belowForeground: false, tint: { apply: false, value: "#FFFFFF" } };
  // Des nuages clairs et légers (trop sombres teintés en gris, vu par l'utilisateur le 2026-10-04).
  const clouds = { density: 0.12, speed: 0.2, scale: 0.6, direction: 270, lifetime: 0.4, alpha: 0.35,
    belowTokens: false, belowTiles: false, belowForeground: false, tint: { apply: false, value: "#FFFFFF" } };
  const lightning = { frequency: 2500, spark_duration: 300, brightness: 1.4, belowTokens: false, belowTiles: false, belowForeground: false,
    color: { apply: false, value: "#ffffff" } };
  const flat = (prefix, options) => Object.fromEntries([[`${prefix}_enabled`, true],
    ...Object.entries(options).filter(([, v]) => (typeof v !== "object")).map(([k, v]) => [`${prefix}_${k}`, v])]);
  return [
    { type: "fxmaster.particleEffectsRegion", name: game.i18n.format("DND5ECOMBAT.Orage.ZonePluie", { name }), system: { ...flat("rain", rain), ...flat("clouds", clouds) },
      flags: { fxmaster: { particleEffects: { rain: { options: rain }, clouds: { options: clouds } } } } },
    { type: "fxmaster.filterEffectsRegion", name: game.i18n.format("DND5ECOMBAT.Orage.ZoneEclairs", { name }), system: flat("lightning", lightning),
      flags: { fxmaster: { filters: { lightning: { type: "lightning", options: lightning } } } } }
  ];
}

/**
 * Habille le nuage tout juste posé : marqué (`cloud`, et `stormy` — l'orage était déjà là), porte l'orage de FXMaster, et la
 * région elle-même n'est montrée à personne (`LAYER` : seulement sur le calque des régions, pour la retrouver) — reposé APRÈS
 * l'ajout des comportements, l'essai du 2026-10-04 l'ayant relue « MJ » (`GAMEMASTER`) ; sans FXMaster, une zone sombre visible
 * de tous. Par celui qui l'a posé (propriétaire).
 */
export async function dressCloud(cloud, { stormy=false }={}) {
  const item = fromUuidSync(cloud.getFlag("dnd5e", "item") ?? "", { strict: false });
  const fx = fxBehaviors(item?.name ?? cloud.name);
  await cloud.update({
    [`flags.${MODULE_ID}.cloud`]: true,
    [`flags.${MODULE_ID}.stormy`]: !!stormy,
    restriction: { enabled: false },
    ...(fx.length
      ? { visibility: CONST.REGION_VISIBILITY.LAYER }
      : { visibility: CONST.REGION_VISIBILITY.ALWAYS, color: "#1d2230", highlightMode: "coverage" })
  });
  if ( fx.length ) {
    await cloud.createEmbeddedDocuments("RegionBehavior", fx);
    if ( cloud.visibility !== CONST.REGION_VISIBILITY.LAYER ) await cloud.update({ visibility: CONST.REGION_VISIBILITY.LAYER });
  }
  return { fx: fx.length > 0 };
}

/**
 * Pose l'éclair au point visé (centre, pixels) : un cercle de l'activité, sous le nuage, de la hauteur du sol du lanceur à
 * celle du nuage — la résolution le lit comme toute zone posée (runtime/engine.mjs, `onRegionCreated`) puis le retire.
 */
export async function placeBolt(activity, cloud, center) {
  const scene = cloud.parent;
  const origin = fromUuidSync(cloud.getFlag("dnd5e", "origin") ?? "", { strict: false });
  const ground = Number(origin?._source?.elevation ?? cloud.elevation?.bottom ?? 0) || 0;
  const top = Number.isFinite(cloud.elevation?.top) ? cloud.elevation.top : ground + 100;
  const data = {
    name: game.i18n.format("DND5ECOMBAT.Orage.ZoneEclair", { name: activity.item.name, user: game.user.name }),
    color: "#e8f4ff",
    shapes: [{ type: "circle", x: center.x, y: center.y, radius: boltRadiusPx(activity.item, scene) }],
    ...(cloud.levels?.size ? { levels: [...cloud.levels] } : {}),
    elevation: { bottom: ground, top: Math.max(top, ground + 1) },
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: "coverage",
    flags: {
      dnd5e: { ...(cloud.flags?.dnd5e ?? {}), activity: activity.uuid, item: activity.item.uuid },
      [MODULE_ID]: { bolt: true }
    }
  };
  if ( Hooks.call("dnd5e.createMeasuredTemplate", activity, [data]) === false ) return null;
  const created = await scene.createEmbeddedDocuments("Region", [data]);
  Hooks.callAll("dnd5e.postCreateMeasuredTemplate", activity, created);
  return created[0] ?? null;
}
