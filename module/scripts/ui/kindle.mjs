/**
 * §52 : la boîte à amadou (`kindles`) — « l'utiliser pour allumer une Bougie, une Lampe, une Lanterne ou une Torche […] prend une
 * action Bonus ». Après l'utilisation, la source à allumer (ou à éteindre) : d'office s'il n'y en a qu'une, sinon au choix.
 * L'interface demande ; adapter/lights.mjs allume.
 */

import { contentOf } from "../adapter/content.mjs";
import { carriedLightsOf, carriedLightEffect, setCarriedLight } from "../adapter/lights.mjs";
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
  const on = !carriedLightEffect(chosen);
  if ( await setCarriedLight(chosen, on) ) log(`${actor.name} : ${chosen.name} ${on ? "allumé(e)" : "éteint(e)"} (${activity.item.name})`);
}

export function registerKindleUi() {
  route("dnd5e.postUseActivity", onPostUse, { label: "boîte à amadou : rien allumé" });
}
