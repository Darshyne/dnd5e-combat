/**
 * §16.45 : la fenêtre du Pacte de la lame — une arme de l'inventaire ou « Invoquer une arme… » (compendium de dnd5e, corps à
 * corps courante ou de guerre). Le type de dégâts se choisit à chaque attaque (§16.45). L'interface demande ;
 * runtime/enchant.mjs (`pactWith`) lance.
 */

import { ownPactWeapons, pickConjuredWeapon } from "../adapter/enchant.mjs";
import { loc, esc } from "../runtime/shared.mjs";
import { weaponCard, pickCard } from "./cards.mjs";

const CONJURE = "conjure";

/** Rend `{ itemUuid | conjureUuid }`, ou null si l'on renonce. */
export async function askPact(activity) {
  const weapons = ownPactWeapons(activity);
  const cards = [...weapons.map(weaponCard), `
    <div class="dnd5e-combat-form" data-uuid="${CONJURE}" title="${esc(loc("Pacte.Invoquer"))}">
      <i class="fa-solid fa-wand-sparkles" style="font-size: 48px; margin: 12px 0;"></i><span class="name">${esc(loc("Pacte.Invoquer"))}</span>
    </div>`].join("");
  const content = `<p class="hint">${esc(loc("Pacte.TypeAChaqueAttaque"))}</p><div class="dnd5e-combat-forms">${cards}</div>`;
  const pick = await pickCard({ title: activity.item.name, icon: "fa-solid fa-khanda", width: 520, content,
    label: loc("Pacte.Lier"), buttonIcon: "fa-solid fa-link" });
  if ( !pick ) return null;
  if ( pick !== CONJURE ) return { itemUuid: pick };
  const conjureUuid = await pickConjuredWeapon().catch(() => null);
  return conjureUuid ? { conjureUuid } : null;
}
