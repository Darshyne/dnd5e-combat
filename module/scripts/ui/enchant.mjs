/**
 * §16.41 : choisir l'arme à enchanter parmi celles de la créature visée (Arme élémentaire) — un portrait par arme, celles que
 * l'enchantement refuse (déjà magique…) grisées avec leur motif. L'interface demande ; runtime/enchant.mjs lance.
 */

import { enchantableWeapons } from "../adapter/enchant.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { weaponCard, pickCard } from "./cards.mjs";

/** Rend l'uuid de l'arme choisie, ou null. */
export async function askEnchantWeapon(activity, actor) {
  const weapons = enchantableWeapons(activity, actor);
  const cards = weapons.map(weaponCard).join("");
  return pickCard({ title: `${activity.item.name} — ${actor?.name ?? ""}`, icon: "fa-solid fa-khanda", width: 480,
    content: weapons.length ? `<div class="dnd5e-combat-forms">${cards}</div>` : `<p>${esc(loc("Enchant.Aucune", { name: actor?.name ?? "" }))}</p>`,
    label: loc("Enchant.Choisir") });
}
