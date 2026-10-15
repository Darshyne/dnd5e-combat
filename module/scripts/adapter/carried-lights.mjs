/**
 * Les sources de lumière portées (SPEC §52, §121) : torches, bougies, lampes et lanternes — allumer, éteindre, durée et
 * combustible, mains libres, source consumée. Extrait d'adapter/lights.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { tokenLightChanges, burnSeconds, lightPlan, burnoutPlan, handsOf } from "../core/light.mjs";
import { toGridUnits } from "./lights.mjs";

/* -------------------------------------------- */
/*  Sources de lumière portées (§52, §121)      */
/* -------------------------------------------- */

const CARRIED_FLAG = "carriedLightOf";
/** §121 : sur l'item, le temps qui restait (secondes) quand on l'a éteinte ; absent : neuve (torche) ou remplie (lampe). */
const BURN_FLAG = "burnLeft";

/** La lumière d'une source portée (lampe, lanterne, torche, bougie), ou null. */
export const carriedLightOf = item => contentOf(item).entry?.carriedLight ?? null;

/** L'effet qui fait briller le porteur de cette source, ou null (éteinte). */
export const carriedLightEffect = item => (item?.actor?.effects ?? []).find(e => e.getFlag(MODULE_ID, CARRIED_FLAG) === item.uuid) ?? null;

/** Les sources de lumière que porte un acteur. */
export const carriedLightsOf = actor => (actor?.items ?? []).filter(i => carriedLightOf(i));

/** Est-ce l'effet d'une source portée ? Rend l'uuid de la source, ou null. */
export const carriedSourceOf = effect => effect?.getFlag?.(MODULE_ID, CARRIED_FLAG) ?? null;

/** Le temps qu'il reste à l'effet allumé (secondes), d'après la durée que le cœur V14 tient à jour ; null sans durée. */
export function remainingOf(effect) {
  const d = effect?.duration;
  if ( !d || !Number.isFinite(d.value) ) return null;
  if ( Number.isFinite(d.secondsRemaining) ) return Math.max(0, d.secondsRemaining);
  const start = effect.start?.time ?? effect._source?.start?.time;
  return Number.isFinite(start) ? Math.max(0, start + d.value - game.time.worldTime) : d.value;
}

/** Le temps qu'il reste à une source : allumée, celui de son effet ; éteinte, celui noté sur l'item ; neuve, une unité entière. */
export function burnLeftOf(item) {
  const rule = carriedLightOf(item);
  const full = burnSeconds(rule?.burn);
  if ( full === null ) return null;
  const lit = carriedLightEffect(item);
  if ( lit ) return remainingOf(lit);
  const stored = item.getFlag(MODULE_ID, BURN_FLAG);
  return Number.isFinite(stored) ? stored : full;
}

/** §121 : sur la source, « c'est l'allumage qui l'a équipée » — l'éteindre la range alors. */
const EQUIPPED_FLAG = "equippedToLight";

/**
 * §121 : ce que la créature tient en main, d'après ce qui est équipé (le HUD de darsh-dnd-ui équipe le jeu d'armes en main) :
 * armes (deux mains pour la propriété « two » de dnd5e, config.mjs:2015), boucliers (`system.type.value` « shield »), sources
 * de lumière allumées. Les armes naturelles et les mains nues ne prennent pas de main. `except` : la source qu'on veut allumer.
 * @returns {Array<{name: string, hands: number}>}
 */
export function heldItems(actor, except=null) {
  const held = [];
  for ( const item of actor?.items ?? [] ) {
    if ( (item === except) || !item.system?.equipped ) continue;
    if ( item.type === "weapon" ) {
      if ( (item.system.type?.value === "natural") || (identifierOf(item).id === "unarmed-strike") ) continue;
      held.push({ name: item.name, hands: item.system.properties?.has?.("two") ? 2 : 1 });
    }
    else if ( (item.type === "equipment") && (item.system.type?.value === "shield") ) held.push({ name: item.name, hands: 1 });
    else if ( carriedLightOf(item) && carriedLightEffect(item) ) held.push({ name: item.name, hands: 1 });
  }
  return held;
}

/** Le combustible que porte l'acteur (une flasque d'Huile, par son identifiant), ou null. */
export function fuelOf(actor, identifier) {
  return (actor?.items ?? []).find(i => (identifierOf(i).id === identifier) && ((i.system.quantity ?? 1) > 0)) ?? null;
}

/** Une unité de moins : la quantité baisse, l'item part à la dernière. Rend true s'il a été retiré. */
async function spendOne(item) {
  const quantity = Number(item.system.quantity ?? 1);
  if ( quantity > 1 ) { await item.update({ "system.quantity": quantity - 1 }); return false; }
  await item.delete();
  return true;
}

/** L'état d'une source pour l'interface : allumée ou non, temps restant, combustible. */
export function carriedLightState(item) {
  const rule = carriedLightOf(item);
  if ( !rule ) return null;
  const fuel = rule.fuel ? fuelOf(item.actor, rule.fuel) : null;
  return { uuid: item.uuid, name: item.name, img: item.img, lit: !!carriedLightEffect(item), left: burnLeftOf(item),
    full: burnSeconds(rule.burn), fuel: rule.fuel ? { identifier: rule.fuel, name: fuel?.name ?? null, quantity: Number(fuel?.system.quantity ?? 0) } : null };
}

/**
 * Allume (`on: true`) ou éteint la source, sur le client du porteur. Allumer pose un effet au nom et à l'image de l'item, qui porte
 * ses changements `token.light.*` (rayons convertis dans l'unité de la scène) et, §121, la durée qui lui reste : le cœur V14 le
 * marque expiré quand le temps du monde l'atteint (runtime/lights.mjs le consume alors). Une lampe vide prend d'abord une flasque
 * d'huile au porteur. Éteindre note sur l'item le temps restant, que le rallumage reprend.
 * @returns {Promise<{changed: boolean, lit?: boolean, left?: number|null, refilled?: string|null, reason?: string}>}
 */
export async function setCarriedLight(item, on) {
  const rule = carriedLightOf(item);
  const actor = item?.actor;
  if ( !rule || !actor ) return { changed: false, reason: "notLight" };
  const lit = carriedLightEffect(item);
  if ( !on ) {
    if ( !lit ) return { changed: false, reason: "alreadyOut" };
    const left = remainingOf(lit);
    if ( Number.isFinite(left) ) await item.setFlag(MODULE_ID, BURN_FLAG, left);
    await lit.delete({ [MODULE_ID]: { putOut: true } });
    await stowIfLit(item);
    return { changed: true, lit: false, left };
  }
  if ( lit ) return { changed: false, reason: "alreadyLit" };
  // §121 : une source allumée se tient en main — il en faut une de libre, sauf si elle est déjà équipée (torche d'un jeu d'armes).
  const wasEquipped = !!item.system.equipped;
  if ( !wasEquipped ) {
    const held = heldItems(actor, item);
    if ( handsOf(held).free < 1 ) return { changed: false, reason: "noHand", held: held.map(h => h.name) };
  }
  const full = burnSeconds(rule.burn);
  const fuel = rule.fuel ? fuelOf(actor, rule.fuel) : null;
  const plan = lightPlan({ stored: item.getFlag(MODULE_ID, BURN_FLAG), full, fuel: !!rule.fuel, hasFuel: !!fuel });
  if ( !plan.ok ) return { changed: false, reason: plan.reason, fuel: rule.fuel };
  let refilled = null;
  if ( plan.refill ) { refilled = fuel.name; await spendOne(fuel); }
  const grid = canvas?.scene?.grid ?? game.scenes.active?.grid;
  const radius = v => (grid ? toGridUnits(v, rule.units, grid) : v);
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: item.name, img: item.img, origin: item.uuid, type: "base",
    ...(Number.isFinite(plan.left) ? { duration: { value: plan.left, units: "seconds" } } : {}),
    system: { changes: tokenLightChanges({ bright: radius(rule.bright), dim: radius(rule.dim), angle: rule.angle ?? null,
      animation: rule.animation ?? null }) },
    flags: { [MODULE_ID]: { [CARRIED_FLAG]: item.uuid } }
  }]);
  if ( item.getFlag(MODULE_ID, BURN_FLAG) !== undefined ) await item.unsetFlag(MODULE_ID, BURN_FLAG);
  if ( !wasEquipped ) await item.update({ "system.equipped": true, [`flags.${MODULE_ID}.${EQUIPPED_FLAG}`]: true });
  return { changed: true, lit: true, left: plan.left, refilled, equipped: !wasEquipped };
}

/** §121 : éteinte, la source que l'allumage avait équipée retourne dans le sac (la main est libre). */
async function stowIfLit(item) {
  if ( !item?.getFlag?.(MODULE_ID, EQUIPPED_FLAG) ) return;
  await item.update({ "system.equipped": false });
  await item.unsetFlag(MODULE_ID, EQUIPPED_FLAG);
}

/**
 * §121 : la source s'est consumée (son effet est arrivé au bout). MJ actif. L'effet part ; une torche ou une bougie perd l'unité
 * brûlée (la suivante sera neuve), une lampe reste vide. Rend ce qui s'est passé, ou null.
 * @returns {Promise<{item: string, consumed: boolean, gone: boolean, empty: boolean}|null>}
 */
export async function burnOut(effect) {
  const uuid = carriedSourceOf(effect);
  if ( !uuid ) return null;
  const item = fromUuidSync(uuid, { strict: false });
  // Déjà retiré entre-temps (le moteur retire les effets expirés, runtime/durations) : rien à supprimer.
  if ( effect.parent?.effects?.has(effect.id) ) await effect.delete({ [MODULE_ID]: { putOut: true } }).catch(() => null);
  const rule = carriedLightOf(item);
  if ( !item || !rule ) return null;
  const plan = burnoutPlan({ fuel: !!rule.fuel });
  const name = item.name;
  if ( !plan.consume ) { await item.setFlag(MODULE_ID, BURN_FLAG, 0); await stowIfLit(item); return { item: name, consumed: false, gone: false, empty: true }; }
  const gone = await spendOne(item);
  if ( !gone ) await stowIfLit(item);
  if ( !gone && (item.getFlag(MODULE_ID, BURN_FLAG) !== undefined) ) await item.unsetFlag(MODULE_ID, BURN_FLAG);
  return { item: name, consumed: true, gone, empty: false };
}

/** §121 : l'effet a été retiré à la main (fiche, HUD) avant la fin : le temps restant se note sur la source. MJ actif. */
export async function rememberBurn(effect) {
  const item = fromUuidSync(carriedSourceOf(effect) ?? "", { strict: false });
  const left = remainingOf(effect);
  if ( !item || !Number.isFinite(left) ) return null;
  await item.setFlag(MODULE_ID, BURN_FLAG, left);
  await stowIfLit(item);
  return left;
}

/** Une source qui quitte la fiche (lâchée, lancée, donnée, détruite) s'éteint : ses effets lumineux sont retirés. */
export async function dropCarriedLight(item) {
  const actor = item?.parent;
  if ( actor?.documentName !== "Actor" ) return 0;
  const ids = actor.effects.filter(e => e.getFlag(MODULE_ID, CARRIED_FLAG) === item.uuid).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { [MODULE_ID]: { putOut: true } });
  return ids.length;
}
