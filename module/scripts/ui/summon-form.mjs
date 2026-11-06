/**
 * §383 (issue #38) : la fenêtre « Choisir la forme » d'une invocation lancée sans la fenêtre de dnd5e (barre d'actions, manette).
 * Une carte par forme (image et nom de la créature, nom du profil quand il en a un — Vengeur / Défenseur), plus la taille ou le
 * type de créature quand l'activité en propose plusieurs. Un clic sur une carte invoque cette forme (s'il n'y a rien d'autre à
 * choisir) ; « Invoquer » prend la carte cochée. Elle s'ouvre sur l'écran de celui qui lance (le joueur chez lui, le MJ chez lui),
 * avec le sablier « en attente » au-dessus du lanceur pour la table (§381). L'interface demande ; runtime/summon-handover.mjs lance.
 */

import { loc, esc } from "../runtime/shared.mjs";
import { summonChoicesOf } from "../adapter/summons.mjs";
import { whileAwaiting } from "../adapter/awaiting.mjs";

/** Le libellé de dnd5e pour un profil (nom, sinon « FP x ou moins », sinon le nom de la créature ; « 2 × » devant un nombre). */
function profileLabel(activity, profile, rollData) {
  const dialog = globalThis.dnd5e?.applications?.activity?.SummonUsageDialog;
  try {
    if ( dialog?.prototype?.getProfileLabel ) return dialog.prototype.getProfileLabel.call({ activity }, profile, rollData);
  } catch(err) { /* repli ci-dessous */ }
  return profile.name || fromUuidSync(profile.uuid, { strict: false })?.name || "—";
}

/** Une forme : son id, son libellé, l'image et le nom de la créature (index du compendium, traduit par Babele s'il l'est). */
function formOf(activity, profile, rollData) {
  const actor = profile.uuid ? fromUuidSync(profile.uuid, { strict: false }) : null;
  const label = profileLabel(activity, profile, rollData);
  const creature = actor?.name ?? null;
  return { id: profile._id, label, creature: (creature && !label.includes(creature)) ? creature : null,
    img: actor?.img || activity.item?.img || "icons/svg/mystery-man.svg" };
}

function cardsHtml(forms, picked) {
  return forms.map(f => `
    <label class="dnd5e-combat-form${f.id === picked ? " picked" : ""}" data-profile="${esc(f.id)}" title="${esc(f.creature ?? f.label)}">
      <input type="radio" name="profile" value="${esc(f.id)}"${f.id === picked ? " checked" : ""} hidden>
      <img src="${esc(f.img)}" alt="">
      <span class="name">${esc(f.label)}</span>
      ${f.creature ? `<span class="cr">${esc(f.creature)}</span>` : ""}
    </label>`).join("");
}

function selectHtml(name, label, values, labels, current) {
  const options = values.map(v => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(labels[v]?.label ?? labels[v] ?? v)}</option>`).join("");
  return `<div class="form-group"><label>${esc(label)}</label><div class="form-fields"><select name="${name}">${options}</select></div></div>`;
}

/**
 * Demande la forme. Rend `{ profile, creatureSize?, creatureType? }`, ou null si l'on renonce (fenêtre fermée : rien n'est lancé).
 * @param {Activity} activity  L'activité « summon » (copie mise à l'échelle comprise : les profils disponibles suivent le niveau).
 * @param {object} [current]   Ce que dnd5e a préparé (`usageConfig.summons`), coché d'avance.
 */
export async function askSummonForm(activity, current={}) {
  const choices = summonChoicesOf(activity);
  const rollData = activity.getRollData?.() ?? {};
  const forms = (activity.availableProfiles ?? []).map(p => formOf(activity, p, rollData));
  if ( !forms.length ) return null;
  const picked = forms.some(f => f.id === current.profile) ? current.profile : forms[0].id;
  const sizes = Array.from(activity.creatureSizes ?? []);
  const types = Array.from(activity.creatureTypes ?? []);
  const extra = [
    choices.size ? selectHtml("creatureSize", loc("Invocation.Taille"), sizes, CONFIG.DND5E.actorSizes, current.creatureSize ?? sizes[0]) : "",
    choices.type ? selectHtml("creatureType", loc("Invocation.Type"), types, CONFIG.DND5E.creatureTypes, current.creatureType ?? types[0]) : ""
  ].join("");
  const quick = !choices.size && !choices.type;
  const content = `<p class="hint">${esc(loc(quick ? "Invocation.ChoisirClic" : "Invocation.Choisir"))}</p>
    <div class="dnd5e-combat-forms">${cardsHtml(forms, picked)}</div>${extra}`;
  const read = form => {
    const data = new foundry.applications.ux.FormDataExtended(form).object;
    return { profile: data.profile || picked, ...(choices.size ? { creatureSize: data.creatureSize } : {}),
      ...(choices.type ? { creatureType: data.creatureType } : {}) };
  };
  const ask = () => foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: "fa-solid fa-spaghetti-monster-flying" },
    classes: ["dnd5e-combat-summon-form"],
    position: { width: Math.min(140 * Math.max(forms.length, 2) + 60, 640) },
    content,
    buttons: [{ action: "summon", label: loc("Invocation.Invoquer"), icon: "fa-solid fa-spaghetti-monster-flying", default: true,
      callback: (event, button) => read(button.form) }],
    render: (event, dialog) => {
      const root = dialog.element;
      root.querySelectorAll(".dnd5e-combat-form").forEach(card => card.addEventListener("click", () => {
        root.querySelectorAll(".dnd5e-combat-form").forEach(c => c.classList.toggle("picked", c === card));
        const radio = card.querySelector("input[type=radio]");
        if ( radio ) radio.checked = true;
        if ( quick ) root.querySelector('button[data-action="summon"]')?.click();
      }));
    },
    rejectClose: false
  }).catch(() => null);
  const answer = await whileAwaiting(activity.actor ?? null, "choice", ask);
  return (answer && (typeof answer === "object")) ? answer : null;
}
