/**
 * §16.41 : choisir l'arme à enchanter parmi celles de la créature visée (Arme élémentaire) — un portrait par arme, celles que
 * l'enchantement refuse (déjà magique…) grisées avec leur motif. L'interface demande ; runtime/enchant.mjs lance.
 */

import { enchantableWeapons } from "../adapter/enchant.mjs";
import { loc } from "../runtime/shared.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Rend l'uuid de l'arme choisie, ou null. */
export async function askEnchantWeapon(activity, actor) {
  const weapons = enchantableWeapons(activity, actor);
  const cards = weapons.map(w => `
    <div class="dnd5e-combat-form${w.refusal ? " refused" : ""}" data-uuid="${esc(w.uuid)}" title="${esc(w.refusal ?? w.name)}">
      <img src="${esc(w.img)}" alt=""><span class="name">${esc(w.name)}</span>
    </div>`).join("");
  let picked = null;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: `${activity.item.name} — ${actor?.name ?? ""}`, icon: "fa-solid fa-khanda" },
    position: { width: 480 },
    content: weapons.length ? `<div class="dnd5e-combat-forms">${cards}</div>` : `<p>${esc(loc("Enchant.Aucune", { name: actor?.name ?? "" }))}</p>`,
    buttons: [{ action: "pick", label: loc("Enchant.Choisir"), icon: "fa-solid fa-khanda", default: true, callback: () => ({ pick: picked }) }],
    render: (event, dialog) => {
      dialog.element.querySelectorAll(".dnd5e-combat-form:not(.refused)").forEach(card => card.addEventListener("click", () => {
        picked = card.dataset.uuid;
        dialog.element.querySelector('button[data-action="pick"]')?.click();
      }));
    },
    rejectClose: false
  }).catch(() => null);
  return ((answer && (typeof answer === "object")) ? answer.pick : null) ?? null;
}
