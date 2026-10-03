/**
 * §16.45 : la fenêtre du Pacte de la lame — une arme de l'inventaire ou « Invoquer une arme… » (compendium de dnd5e, corps à
 * corps courante ou de guerre). Le type de dégâts se choisit à chaque attaque (§16.45). L'interface demande ;
 * runtime/enchant.mjs (`pactWith`) lance.
 */

import { ownPactWeapons, pickConjuredWeapon } from "../adapter/enchant.mjs";
import { loc } from "../runtime/shared.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const CONJURE = "conjure";

/** Rend `{ itemUuid | conjureUuid }`, ou null si l'on renonce. */
export async function askPact(activity) {
  const weapons = ownPactWeapons(activity);
  const cards = [...weapons.map(w => `
    <div class="dnd5e-combat-form${w.refusal ? " refused" : ""}" data-uuid="${esc(w.uuid)}" title="${esc(w.refusal ?? w.name)}">
      <img src="${esc(w.img)}" alt=""><span class="name">${esc(w.name)}</span>
    </div>`), `
    <div class="dnd5e-combat-form" data-uuid="${CONJURE}" title="${esc(loc("Pacte.Invoquer"))}">
      <i class="fa-solid fa-wand-sparkles" style="font-size: 48px; margin: 12px 0;"></i><span class="name">${esc(loc("Pacte.Invoquer"))}</span>
    </div>`].join("");
  const content = `<p class="hint">${esc(loc("Pacte.TypeAChaqueAttaque"))}</p><div class="dnd5e-combat-forms">${cards}</div>`;
  let picked = null;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: "fa-solid fa-khanda" },
    position: { width: 520 },
    content,
    buttons: [{ action: "pick", label: loc("Pacte.Lier"), icon: "fa-solid fa-link", default: true,
      callback: () => ({ pick: picked }) }],
    render: (event, dialog) => {
      dialog.element.querySelectorAll(".dnd5e-combat-form:not(.refused)").forEach(card => card.addEventListener("click", () => {
        picked = card.dataset.uuid;
        dialog.element.querySelector('button[data-action="pick"]')?.click();
      }));
    },
    rejectClose: false
  }).catch(() => null);
  if ( !answer?.pick ) return null;
  if ( answer.pick !== CONJURE ) return { itemUuid: answer.pick };
  const conjureUuid = await pickConjuredWeapon().catch(() => null);
  return conjureUuid ? { conjureUuid } : null;
}
