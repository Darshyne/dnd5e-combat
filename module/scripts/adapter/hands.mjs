/**
 * §409 (issue #44, lot 2) : ce que la créature tient en main pour incanter, et le refus « pas de main libre » d'un sort à composante
 * somatique (règle pure : core/hands.mjs).
 *
 * En main : ce qui est **équipé** (darsh-dnd-ui équipe le jeu d'armes en main) — armes (hors armes naturelles et mains nues), boucliers,
 * sources de lumière allumées, focaliseurs tenus. Un focaliseur est une arme à la propriété « Focaliseur » (`foc`, dnd5e config.mjs :
 * le Bâton) ou un objet reconnu par dnd5e comme focaliseur (`CONFIG.DND5E.focusTypes`, par l'id de son document de compendium : cristal,
 * orbe, baguette, branche de gui…). L'amulette et l'emblème se portent : ils ne prennent pas de main.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { carriedLightOf, carriedLightEffect } from "./carried-lights.mjs";
import { pendingMetamagic } from "./metamagic.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { somaticBlocked, handsCheckedFor } from "../core/hands.mjs";

/** Réglage de monde : à qui s'applique le contrôle des mains — "pc" (défaut), "all", "off". */
export const SOMATIC_HANDS_SETTING = "somaticHands";

/** Les focaliseurs portés, pas tenus (symbole sacré en amulette ou en emblème). */
const WORN_FOCUS = new Set(["amulet", "emblem"]);

/** Ids de document des focaliseurs tenus que dnd5e connaît (`CONFIG.DND5E.focusTypes.<type>.itemIds`). */
function heldFocusIds() {
  const ids = new Set();
  for ( const type of Object.values(CONFIG.DND5E?.focusTypes ?? {}) ) {
    for ( const [key, uuid] of Object.entries(type.itemIds ?? {}) ) {
      if ( !WORN_FOCUS.has(key) ) ids.add(String(uuid).split(".").pop());
    }
  }
  return ids;
}

/** L'id du document de compendium d'où vient l'item (« phbafcCrystal000 »), ou null. */
function sourceId(item) {
  const source = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? null;
  return source ? String(source).split(".").pop() : null;
}

/**
 * Ce que l'acteur tient en main, pour incanter (core/hands.mjs `Held`).
 * @param {Actor5e} actor
 */
export function castingHands(actor) {
  const foci = heldFocusIds();
  const held = [];
  for ( const item of actor?.items ?? [] ) {
    if ( !item.system?.equipped ) continue;
    if ( item.type === "weapon" ) {
      if ( (item.system.type?.value === "natural") || (identifierOf(item).id === "unarmed-strike") ) continue;
      const props = item.system.properties;
      held.push({ name: item.name, hands: props?.has?.("two") ? 2 : 1, twoHanded: !!props?.has?.("two"), focus: !!props?.has?.("foc"), armament: true });
    }
    else if ( (item.type === "equipment") && (item.system.type?.value === "shield") ) held.push({ name: item.name, hands: 1, armament: true });
    else if ( carriedLightOf(item) && carriedLightEffect(item) ) held.push({ name: item.name, hands: 1 });
    else if ( foci.has(sourceId(item)) ) held.push({ name: item.name, hands: 1, focus: true });
  }
  return held;
}

function settingOf() {
  try { return game.settings.get(MODULE_ID, SOMATIC_HANDS_SETTING) ?? "pc"; } catch { return "pc"; }
}

/**
 * Le refus « pas de main libre » de cette utilisation, ou null. Lancer un sort par un objet qui en dispense : la copie « cast » de dnd5e
 * ne garde que les composantes restantes (`spell.properties`, dnd5e.mjs:21874, :22118) — elle n'a plus `somatic`.
 * @param {Activity} activity
 * @returns {{items: string[]}|null}
 */
export function somaticBlockOf(activity) {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !actor || !isSpellCast(item) ) return null;
  if ( !handsCheckedFor(settingOf(), actor.type === "character") ) return null;
  const props = item.system?.properties;
  return somaticBlocked({
    spell: true,
    somatic: !!props?.has?.("somatic"),
    material: !!props?.has?.("material"),
    held: castingHands(actor),
    freeSomatic: (actor.items ?? []).some(i => contentOf(i).entry?.freeSomatic === true),
    // Sort subtil : « sans composante verbale, somatique ni matérielle » (Métamagie, retenue sur l'ensorceleur jusqu'au sort suivant).
    waived: (item.type === "spell") && pendingMetamagic(actor).includes("subtle")
  });
}

export function registerSomaticHandsSetting() {
  game.settings.register(MODULE_ID, SOMATIC_HANDS_SETTING, { scope: "world", config: true, type: String, default: "pc",
    choices: { pc: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Pj`, all: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Tous`,
      off: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Non` },
    name: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SOMATIC_HANDS_SETTING}.Aide` });
}
