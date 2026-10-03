/**
 * Changer de taille (SPEC §16.58) : à la création d'un effet sur un acteur, le changement de taille que son item déclare
 * (adapter/size.mjs) est ajouté à ses changements — sur le client qui crée l'effet, avant l'écriture (pas d'écriture de plus).
 */

import { sizeChangeFor } from "../adapter/size.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

function onPreCreate(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const change = sizeChangeFor(effect, actor);
  if ( !change ) return;
  effect.updateSource({ "system.changes": [...(effect._source.system?.changes ?? []), change] });
  log(`${actor.name} : ${effect.name}, taille ${actor.system.traits.size} → ${change.value}`);
}

export function registerSize() {
  route("preCreateActiveEffect", onPreCreate, { label: "taille : changement non ajouté" });
}
