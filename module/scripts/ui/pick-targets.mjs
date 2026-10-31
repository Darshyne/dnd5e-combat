/**
 * §293 : la liste « créatures de votre choix dans un rayon de 9 m » (Renvoi des morts-vivants), sur le client de qui l'utilise — les
 * créatures qu'il voit à portée, ses ennemis cochés d'avance ; et, s'il a Calcination des morts-vivants, une case pour l'utiliser à la
 * place. Rend `{ tokens, upgrade }`, ou null (fenêtre fermée, ou rien de coché).
 */

import { pickCandidates, upgradeOf } from "../adapter/pick-targets.mjs";
import { loc } from "../runtime/shared.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

export async function askPickTargets(activity) {
  const { creatures, radius, units } = pickCandidates(activity, { seen: t => t.object?.visible !== false });
  const upgrade = upgradeOf(activity);
  const rows = creatures.map(({ token, distance, enemy }, i) => `
    <label class="dnd5e-combat-pick-row">
      <input type="checkbox" name="pick" value="${i}" ${enemy ? "checked" : ""}>
      <img src="${esc(token.texture?.src)}" alt="">
      <span class="name">${esc(token.name)}</span>
      <span class="distance">${esc(`${Math.round(distance * 10) / 10} ${units}`)}</span>
    </label>`).join("");
  const extra = upgrade ? `
    <label class="dnd5e-combat-pick-upgrade">
      <input type="checkbox" name="upgrade" checked>
      <span>${esc(loc("Choisir.Ajouter", { item: upgrade.item.name }))}</span>
    </label>` : "";
  const content = `<p class="hint">${esc(loc("Choisir.Aide", { radius: Math.round(radius * 10) / 10, units }))}</p>
    <div class="dnd5e-combat-pick-list">${rows || `<p>${esc(loc("Choisir.Personne"))}</p>`}</div>${extra}`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: activity.item?.name ?? activity.name, icon: "fa-solid fa-sun" },
    classes: ["dnd5e-combat-pick"],
    position: { width: 380 },
    content,
    buttons: [
      { action: "ok", label: loc("Choisir.Valider"), icon: "fa-solid fa-check", default: true,
        callback: (event, button) => {
          const form = button.form;
          const picked = Array.from(form.querySelectorAll('input[name="pick"]:checked')).map(i => creatures[Number(i.value)]?.token).filter(Boolean);
          return { tokens: picked, upgrade: form.querySelector('input[name="upgrade"]')?.checked ? upgrade : null };
        } },
      { action: "cancel", label: loc("Choisir.Annuler"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false
  }).catch(() => null);
  if ( !answer ) return null;
  if ( !answer.tokens.length ) {
    ui.notifications.info(loc("Choisir.Aucune"));
    return null;
  }
  return answer;
}
