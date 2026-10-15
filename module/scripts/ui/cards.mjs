/**
 * Choisir d'un clic parmi des cartes (une arme, une forme) : la fenêtre se ferme sur la carte cliquée. Les cartes refusées
 * (`.refused`) restent visibles, grisées, avec leur motif en infobulle. Partagé par le Pacte de la lame (ui/pact.mjs) et le
 * choix de l'arme à enchanter (ui/enchant.mjs).
 */

import { esc } from "../runtime/shared.mjs";

/** La carte d'une arme : portrait et nom ; `refusal` la grise, avec son motif. */
export function weaponCard({ uuid, img, name, refusal=null }) {
  return `
    <div class="dnd5e-combat-form${refusal ? " refused" : ""}" data-uuid="${esc(uuid)}" title="${esc(refusal ?? name)}">
      <img src="${esc(img)}" alt=""><span class="name">${esc(name)}</span>
    </div>`;
}

/**
 * La fenêtre de choix : `content` (les cartes, dans `.dnd5e-combat-forms`), un bouton `label` / `buttonIcon` qui valide. Rend le
 * `data-uuid` de la carte cliquée, ou null (fenêtre fermée).
 */
export async function pickCard({ title, icon, width, content, label, buttonIcon=icon }) {
  let picked = null;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title, icon },
    position: { width },
    content,
    buttons: [{ action: "pick", label, icon: buttonIcon, default: true, callback: () => ({ pick: picked }) }],
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
