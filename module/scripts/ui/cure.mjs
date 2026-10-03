/**
 * §16.47 : Restauration partielle (`cures`) — après l'utilisation, l'état à faire cesser sur la cible : d'office s'il n'y
 * en a qu'un, sinon au choix. L'interface demande ; runtime/cure.mjs retire.
 */

import { curable } from "../core/conditions.mjs";
import { contentOf } from "../adapter/content.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { cureStatus } from "../runtime/cure.mjs";
import { route } from "../runtime/router.mjs";
import { loc, notice } from "../runtime/shared.mjs";

async function onPostUse(activity) {
  const cures = contentOf(activity?.item).entry?.cures;
  if ( !cures?.length || !activity.actor?.isOwner ) return;
  const target = Array.from(game.user.targets)[0]?.document ?? usageTokenOf(activity);
  if ( !target?.actor ) return;
  const present = curable(Array.from(target.actor.statuses ?? []), cures);
  const label = s => game.i18n.localize(CONFIG.DND5E.conditionTypes[s]?.name ?? s);
  if ( !present.length ) return notice(target, loc("Guerison.Aucun", { name: target.name }));
  let status = present[0];
  if ( present.length > 1 ) {
    status = await foundry.applications.api.DialogV2.wait({
      window: { title: activity.item.name, icon: "fa-solid fa-hand-holding-medical" },
      content: `<p>${loc("Guerison.Choisir", { name: target.name })}</p>`,
      buttons: present.map((s, i) => ({ action: s, label: label(s), default: i === 0 })),
      rejectClose: false
    }).catch(() => null);
  }
  if ( status ) await cureStatus(target, status);
}

export function registerCureUi() {
  route("dnd5e.postUseActivity", onPostUse, { label: "restauration : état non retiré" });
}
