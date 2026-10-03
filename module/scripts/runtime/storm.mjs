/**
 * §70 : l'orage d'Appel de la foudre — les intentions (adapter/storm.mjs fait les écritures, ui/pointer.mjs la visée).
 *
 *  - `dressStorm` : le nuage que dnd5e vient de poser est habillé en orage, « déjà là » noté (+1d10) ;
 *  - `strike` : l'éclair est posé au point visé, ramené sous le nuage ;
 *  - `dnd5e.preRollDamageV2` : les dégâts d'un éclair tiré d'un orage déjà là reçoivent le dé en plus (`storm.bonus`).
 * La visée en cours (`boltAim`) est notée ici pour que les fonctions de test (runtime/testing.mjs) puissent jouer le clic.
 */

import { MODULE_ID } from "../constants.mjs";
import { stormOf, cloudOf, cloudCircle, dressCloud, placeBolt, isBoltRegion } from "../adapter/storm.mjs";
import { clampToCircle } from "../core/storm.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

let aiming = null;

/** La visée d'un éclair en cours sur ce client (`{ activity, cloud }`), ou null. */
export const boltAim = () => aiming;
export function setBoltAim(value) { aiming = value; }

/** Le nuage que la dernière incantation vient de poser (la région de l'item, ni éclair ni déjà habillée), ou null. */
export function freshCloudOf(item, scene=canvas?.scene) {
  const regions = scene?.regions.filter(r => (r.getFlag("dnd5e", "item") === item.uuid) && !isBoltRegion(r) && !r.getFlag(MODULE_ID, "cloud")) ?? [];
  return regions.at(-1) ?? null;
}

/** L'incantation, une fois la question de l'orage répondue (ui/pointer.mjs) : la même utilisation, la réponse notée. */
export function castStorm(activity, [usageConfig, dialogConfig, messageConfig], stormy) {
  return activity.use({ ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), stormy: !!stormy } }, dialogConfig, messageConfig);
}

/** Habille le nuage tout juste posé. */
export async function dressStorm(activity, cloud, { stormy=false }={}) {
  const { fx } = await dressCloud(cloud, { stormy });
  log(`${activity.item.name} : orage posé (${fx ? "FXMaster : pluie et éclairs" : "zone sombre"})${stormy ? ", orage déjà là : +" + (stormOf(activity.item)?.bonus ?? "") : ""}`);
}

/** L'éclair au point visé (pixels), ramené sous le nuage. */
export async function strike(activity, cloud, point) {
  const circle = cloudCircle(cloud);
  const at = circle ? clampToCircle(point, circle.center, circle.radius) : point;
  const region = await placeBolt(activity, cloud, at);
  if ( region ) log(`${activity.item.name} : éclair en (${Math.round(at.x)}, ${Math.round(at.y)})`);
  return region;
}

/** Les dégâts d'un éclair, quand l'orage était déjà là : le dé en plus. */
function onPreRollDamage(config) {
  const item = config?.subject?.item;
  const rule = stormOf(item);
  if ( !rule?.bonus || !cloudOf(item)?.getFlag(MODULE_ID, "stormy") ) return true;
  const roll = config.rolls?.[0];
  if ( !roll ) return true;
  roll.parts = [...(roll.parts ?? []), rule.bonus];
  log(`${item.name} : orage déjà là, +${rule.bonus}`);
  return true;
}

/**
 * La région du nuage reste invisible (`LAYER`) : à l'essai du 2026-10-04, une mise à jour venue d'ailleurs la repassait « MJ »
 * après l'habillage (source non trouvée). Toute mise à jour de sa visibilité est ramenée là, sur le client qui la fait.
 */
function onPreUpdateRegion(region, changes) {
  const cloud = region.getFlag(MODULE_ID, "cloud") || foundry.utils.getProperty(changes, `flags.${MODULE_ID}.cloud`);
  if ( !cloud || !("visibility" in changes) || (changes.visibility === CONST.REGION_VISIBILITY.LAYER) ) return;
  changes.visibility = CONST.REGION_VISIBILITY.LAYER;
  log(`orage : visibilité du nuage gardée invisible`);
}

export function registerStorm() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "orage : dé en plus non ajouté" });
  route("preUpdateRegion", onPreUpdateRegion, { label: "orage : nuage rendu visible" });
}
