/**
 * Liens en marche (SPEC §16.43, Trait ensorcelé) : noter la créature liée à l'attaque, rompre le lien — et le sort — quand elle
 * sort de portée ou passe derrière un abri total, l'oublier quand la concentration tombe. Sur le MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { tetherOfActivity, recordTether, clearTether, tetherItems, tetherBroken } from "../adapter/tether.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

async function onUsage(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  const link = tetherOfActivity(activity);
  if ( link?.role !== "attack" ) return;
  const target = message.system?.targets?.[0]?.token ?? null;
  if ( !target ) return;
  await recordTether(activity.item, target);
  log(`${activity.item.name} : ${activity.actor.name} lié à ${message.system.targets[0].name ?? "?"}`);
}

/** Un token a bougé : les liens qui le concernent sont-ils rompus ? */
async function onMove(tokenDoc) {
  // Les lanceurs possibles : les acteurs du monde (PJ liés) et ceux des tokens non liés de la scène.
  const actors = new Set([...game.actors, ...(tokenDoc.parent?.tokens ?? []).filter(t => !t.actorLink && t.actor).map(t => t.actor)]);
  for ( const actor of actors ) {
    for ( const item of tetherItems(actor) ) {
      const why = tetherBroken(item);
      if ( !why ) continue;
      log(`${item.name} : lien rompu (${why === "range" ? "hors de portée" : "abri total"}), le sort prend fin`);
      await clearTether(item);
      const concentration = concentrationOn(item);
      if ( concentration ) await concentration.delete();
    }
  }
}

export function registerTether() {
  route("createChatMessage", onUsage, { executor: true, label: "lien : non noté" });
  route("moveToken", onMove, { executor: true, label: "lien : rupture non jugée" });
  // Fin du sort (concentration supprimée, quelle qu'en soit la cause) : le lien s'oublie.
  route("deleteActiveEffect", async effect => {
    const actor = effect.parent;
    if ( (actor?.documentName !== "Actor") || !effect.statuses?.has?.("concentrating") ) return;
    for ( const item of tetherItems(actor) ) if ( !concentrationOn(item) ) await clearTether(item);
  }, { executor: true, label: "lien : non oublié" });
}
