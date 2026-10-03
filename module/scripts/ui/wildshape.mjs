/**
 * §16.39 : la fenêtre des formes connues d'un druide — un portrait par forme, les formes que l'activité ne permet pas (FP,
 * vol) grisées avec leur motif ; « × » oublie une forme ; « Ajouter une forme… » ouvre le navigateur de compendium de dnd5e,
 * filtré comme le profil de l'activité (`TransformActivity#queryActor`). L'interface demande ; runtime/wildshape.mjs lance.
 */

import { knownForms, setKnownForms, formInfo, formRefusedBy } from "../adapter/wildshape.mjs";
import { loc } from "../runtime/shared.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const crText = cr => (cr === 0.125) ? "1/8" : (cr === 0.25) ? "1/4" : (cr === 0.5) ? "1/2" : String(cr ?? "?");

function cardsHtml(activity, infos) {
  return infos.map(({ info, refusal }) => `
    <div class="dnd5e-combat-form${refusal ? " refused" : ""}" data-uuid="${esc(info.uuid)}" title="${esc(refusal ? loc(`Forme.Refus.${refusal}`) : info.name)}">
      <img src="${esc(info.img)}" alt="">
      <span class="name">${esc(info.name)}</span>
      <span class="cr">FP ${esc(crText(info.cr))}</span>
      <a class="forget" data-forget="${esc(info.uuid)}" title="${esc(loc("Forme.Oublier"))}"><i class="fa-solid fa-xmark"></i></a>
    </div>`).join("");
}

/**
 * Demande une forme. Rend l'uuid choisi, ou null si l'on renonce.
 * @param {Activity} activity  Forme sauvage ou Formes du cercle.
 */
export async function askWildForm(activity) {
  for ( ;; ) {
    const { forms, max } = knownForms(activity.actor);
    const infos = (await Promise.all(forms.map(formInfo))).filter(Boolean)
      .map(info => ({ info, refusal: formRefusedBy(activity, info) }));
    const content = `<p class="hint">${esc(loc("Forme.Connues", { n: infos.length, max }))}</p>
      <div class="dnd5e-combat-forms">${infos.length ? cardsHtml(activity, infos) : `<p>${esc(loc("Forme.Aucune"))}</p>`}</div>
      <input type="hidden" name="choice" value="">`;
    let picked = null;
    let forget = null;
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: activity.item.name, icon: "fa-solid fa-paw" },
      position: { width: 520 },
      content,
      buttons: [
        { action: "add", label: loc("Forme.Ajouter"), icon: "fa-solid fa-plus", disabled: infos.length >= max },
        { action: "pick", label: loc("Forme.Prendre"), icon: "fa-solid fa-paw", default: true, callback: () => ({ pick: picked }) }
      ],
      render: (event, dialog) => {
        const root = dialog.element;
        root.querySelectorAll(".dnd5e-combat-form:not(.refused)").forEach(card => card.addEventListener("click", ev => {
          if ( ev.target.closest(".forget") ) return;
          picked = card.dataset.uuid;
          root.querySelector('button[data-action="pick"]')?.click();
        }));
        root.querySelectorAll(".forget").forEach(a => a.addEventListener("click", ev => {
          ev.stopPropagation();
          forget = a.dataset.forget;
          dialog.close();
        }));
      },
      rejectClose: false
    }).catch(() => null);
    if ( forget ) {
      await setKnownForms(activity.actor, forms.filter(f => f !== forget));
      continue;
    }
    if ( answer === "add" ) {
      const profile = activity.availableProfiles?.[0] ?? activity.profiles?.[0];
      const uuid = profile ? await activity.queryActor(profile).catch(() => null) : null;
      if ( uuid && !forms.includes(uuid) ) await setKnownForms(activity.actor, [...forms, uuid]);
      continue;
    }
    return ((answer && (typeof answer === "object")) ? answer.pick : null) ?? null;
  }
}
