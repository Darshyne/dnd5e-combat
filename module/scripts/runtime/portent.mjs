/**
 * §36 : Présage du Devin. Les jets notés sont lancés au Repos long ; la question « remplacer ce d20 ? » est posée par la porte des
 * attaques (runtime/gates.mjs) et par la demande de sauvegardes (adapter/saves.mjs) ; le jet borné par runtime/conditions.mjs et
 * adapter/saves.mjs. Ici : le Repos long, et la requête à laquelle répond le client du devin.
 */

import { PORTENT_QUERY, PORTENT_SETTING, handlePortentQuery, portentDice, rollPortent } from "../adapter/portent.mjs";
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/**
 * `dnd5e.restCompleted` ne se déclenche que sur le client qui a lancé le repos (documents/actor/actor.mjs:2421) : pas d'`executor`,
 * c'est ce client-là, propriétaire de l'acteur, qui lance et note les d20.
 */
async function onRestCompleted(actor, result, config) {
  if ( (config?.type !== "long") || !actor?.isOwner || !portentDice(actor) ) return;
  const rolls = await rollPortent(actor);
  if ( rolls ) log(`${actor.name} : Présage, jets notés ${rolls.join(", ")}`);
}

export function registerPortent() {
  // §38.4 : désactivé, le moteur ne propose plus le Présage (ni question, ni attaque suspendue) ; les d20 restent lancés et notés au
  // Repos long, pour le jouer à la main.
  game.settings.register(MODULE_ID, PORTENT_SETTING, {
    name: "DND5ECOMBAT.Reglage.portent.Nom",
    hint: "DND5ECOMBAT.Reglage.portent.Aide",
    scope: "world", config: true, type: Boolean, default: true
  });
  // Sur tous les clients : c'est celui du devin (son joueur, ou le MJ) qui répond.
  CONFIG.queries[PORTENT_QUERY] = handlePortentQuery;
  route("dnd5e.restCompleted", onRestCompleted, { label: "Présage non lancé au Repos long" });
}
