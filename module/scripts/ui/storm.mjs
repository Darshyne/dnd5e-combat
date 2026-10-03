/**
 * §70 : la question d'Appel de la foudre à l'incantation — « dehors, par temps d'orage ? » (l'orage en cours passe sous votre
 * contrôle, dégâts +1d10). Rend true, false, ou null si la fenêtre est fermée (rien n'est lancé).
 */

import { loc } from "../runtime/shared.mjs";

export async function askStorm(activity, bonus) {
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: "fa-solid fa-cloud-bolt" },
    content: `<p>${loc("Orage.Question")}</p><p class="hint">${loc("Orage.Aide", { bonus })}</p>`,
    buttons: [
      { action: "no", label: loc("Orage.Non"), icon: "fa-solid fa-cloud", default: true, callback: () => "no" },
      { action: "yes", label: loc("Orage.Oui", { bonus }), icon: "fa-solid fa-cloud-bolt", callback: () => "yes" }
    ],
    rejectClose: false
  }).catch(() => null);
  return (answer === "yes") ? true : (answer === "no") ? false : null;
}
