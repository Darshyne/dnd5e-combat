/**
 * O9h (§363) : une barrière qui tombe quand son porteur va au contact (`barrier.endsOnContact` — Parchemin de protection : « si vous
 * vous déplacez de telle sorte qu'une créature du type choisi se retrouve dans la zone, l'effet prend fin »). MJ actif, après chaque
 * déplacement d'un token : ses émanations qui contiennent maintenant une créature qu'elles arrêtent tombent (les effets de l'objet sur
 * lui). Le reste de la barrière (entrer, affecter l'intérieur) : adapter/barriers.mjs.
 */

import { breachedBarriers } from "../adapter/barriers.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

async function onMoved(token, changes) {
  if ( !token?.actor || !(("x" in changes) || ("y" in changes) || ("elevation" in changes)) ) return;
  for ( const zone of breachedBarriers(token) ) {
    const ids = token.actor.effects.filter(e => originItemOf(e)?.uuid === zone.item.uuid).map(e => e.id);
    if ( !ids.length ) continue;
    await token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`${zone.item.name}: ${token.name} moved up to a creature it wards off, the emanation ends`);
    notice(token, loc("Protection.Fin", { item: zone.item.name }), "refused", { all: true });
  }
}

export function registerProtection() {
  route("updateToken", (token, changes) => enqueue(`protection:${token.uuid}`, () => onMoved(token, changes)),
    { executor: true, label: "protection emanation: not ended on contact" });
}
