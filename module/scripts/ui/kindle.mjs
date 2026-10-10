/**
 * §52 : la boîte à amadou (`kindles`) — « l'utiliser pour allumer une Bougie, une Lampe, une Lanterne ou une Torche […] prend une
 * action Bonus ». Après l'utilisation, la source à allumer (ou à éteindre) : d'office s'il n'y en a qu'une, sinon au choix.
 * L'interface demande ; runtime/lights.mjs allume.
 *
 * §121 : le menu du clic droit d'une source dans l'inventaire de dnd5e (`dnd5e.getItemContextOptions`,
 * applications/components/inventory.mjs:636) — « Allumer » / « Éteindre », avec le temps restant. La Torche du Manuel des joueurs
 * n'a qu'une activité d'attaque : c'est par là (ou la boîte à amadou, ou le HUD) qu'on l'allume. Sans coût d'action.
 */

import { contentOf } from "../adapter/content.mjs";
import { carriedLightsOf, carriedLightEffect, carriedLightOf, burnLeftOf } from "../adapter/lights.mjs";
import { toggleCarriedLight, burnLabel } from "../runtime/lights.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "../runtime/router.mjs";
import { log, loc, notice } from "../runtime/shared.mjs";

async function onPostUse(activity) {
  const actor = activity?.actor;
  if ( !contentOf(activity?.item).entry?.kindles || !actor?.isOwner ) return;
  const sources = carriedLightsOf(actor);
  const token = tokenOf(actor);
  if ( !sources.length ) return notice(token, loc("Amadou.Rien"));
  const label = item => loc(carriedLightEffect(item) ? "Amadou.Eteindre" : "Amadou.Allumer", { item: item.name });
  let chosen = sources[0];
  if ( sources.length > 1 ) {
    const id = await foundry.applications.api.DialogV2.wait({
      window: { title: activity.item.name, icon: "fa-solid fa-fire" },
      content: `<p>${loc("Amadou.Choisir")}</p>`,
      buttons: sources.map((item, i) => ({ action: item.id, label: label(item), default: i === 0 })),
      rejectClose: false
    }).catch(() => null);
    chosen = sources.find(i => i.id === id) ?? null;
  }
  if ( !chosen ) return;
  const result = await toggleCarriedLight(chosen);
  if ( result.changed ) log(`${actor.name}: ${chosen.name} ${result.lit ? "lit" : "put out"} (${activity.item.name})`);
}

/** §121 : « Allumer » / « Éteindre » dans le menu d'une source portée de l'inventaire. */
function onItemContext(item, options) {
  if ( !carriedLightOf(item) || !item.actor?.isOwner || !Array.isArray(options) ) return;
  const lit = !!carriedLightEffect(item);
  const left = burnLabel(burnLeftOf(item));
  options.push({
    label: loc(lit ? "Lumiere.MenuEteindre" : "Lumiere.MenuAllumer", { left }),
    icon: lit ? "fa-solid fa-fire-flame-simple" : "fa-solid fa-fire",
    group: "action",
    onClick: () => toggleCarriedLight(item)
  });
}

export function registerKindleUi() {
  route("dnd5e.postUseActivity", onPostUse, { label: "tinderbox: nothing lit" });
  route("dnd5e.getItemContextOptions", onItemContext, { label: "light source: no menu entry" });
}
