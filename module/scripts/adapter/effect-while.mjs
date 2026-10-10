/**
 * §130 : ce que l'effet d'un don doit savoir de son porteur (core/feats.mjs, `effectHolds`) — l'armure portée (dnd5e la calcule :
 * `system.attributes.ac.equippedArmor`), les armes maniées (équipées, hors armes naturelles et Attaque à mains nues), le combat,
 * les valeurs de caractéristique.
 */

import { combatantFor } from "./turn.mjs";
import { identifierOf } from "./content.mjs";
import { lightAt } from "./illumination.mjs";
import { LIGHT_NAMES } from "../core/illumination.mjs";

/** §135 : la lumière au centre du token du porteur (« dark », « dim », « bright »), ou null sans token ni canevas. */
function lightOfActor(actor) {
  const token = actor?.getActiveTokens?.(false, true)?.[0];
  if ( !token?.parent ) return null;
  const size = token.parent.grid?.size ?? 100;
  const level = lightAt({ x: token._source.x + ((token.width ?? 1) * size) / 2, y: token._source.y + ((token.height ?? 1) * size) / 2,
    elevation: token._source.elevation ?? 0 })?.level;
  return Number.isInteger(level) ? (LIGHT_NAMES[level] ?? null) : null;
}

const RANGED = ["simpleR", "martialR"];

/** @returns {{armor: string|null, weapons: Array<{melee: boolean, twoHanded: boolean}>, inCombat: boolean, abilities: Record<string, number>}} */
export function effectFacts(actor) {
  const armor = actor?.system?.attributes?.ac?.equippedArmor?.system?.type?.value ?? null;
  const weapons = (actor?.items ?? []).filter(i => (i.type === "weapon") && i.system.equipped && (i.system.type?.value !== "natural")
    && (identifierOf(i).id !== "unarmed-strike")).map(w => ({ melee: !RANGED.includes(w.system.type?.value), twoHanded: !!w.system.properties?.has?.("two") }));
  const abilities = Object.fromEntries(Object.entries(actor?.system?.abilities ?? {}).map(([k, v]) => [k, Number(v?.value) || 0]));
  return { armor, weapons, inCombat: !!combatantFor(actor)?.parent?.started, abilities, get light() { return lightOfActor(actor); } };
}
