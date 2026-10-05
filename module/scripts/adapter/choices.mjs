/**
 * La question « quel effet ? » posée à l'auteur d'une action aux effets exclusifs (SPEC §7, étape
 * `choice` ; Maléfice). Même circuit que les réactions (adapter/reactions.mjs) : la requête
 * `user.query` du cœur de Foundry va au joueur connecté qui possède l'acteur, à défaut le MJ actif
 * répond lui-même. Une réponse est REQUISE : sans réponse du joueur, le MJ est consulté à son tour.
 */

import { MODULE_ID } from "../constants.mjs";
import { timedWait } from "./dialogs.mjs";
import { rollerFor } from "./concentration.mjs";

export const CHOICE_QUERY = `${MODULE_ID}.choice`;

/** Délai laissé au joueur ; au-delà, le MJ choisit. */
const CHOICE_TIMEOUT = 20000;   // au-delà du délai de la fenêtre (adapter/dialogs.mjs)

/**
 * Côté de celui qui choisit : une fenêtre, un bouton par option.
 * @param {{actor: string, item: string, prompt: string|null, options: Array<{id: string, label: string}>}} payload
 * @returns {Promise<{id: string}|null>}  null si la fenêtre est fermée sans choisir.
 */
export async function handleChoiceQuery({ actor: actorUuid, item, prompt, options }) {
  const actor = await fromUuid(actorUuid);
  const buttons = options.map((o, i) => ({ action: `pick${i}`, label: o.label, icon: "fa-solid fa-hand-pointer", default: i === 0 }));
  // Sans réponse dans le délai : la première option.
  const picked = await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.ChoixTitre", { item, name: actor?.name ?? "" }) },
    content: `<p>${prompt ?? game.i18n.localize("DND5ECOMBAT.ChoixEffet")}</p>`,
    buttons
  }, { fallback: "pick0" });
  const option = options[Number(String(picked ?? "").replace("pick", ""))];
  return picked?.startsWith?.("pick") && option ? { id: option.id } : null;
}

/**
 * Sur le MJ actif : demande à l'auteur, puis au MJ si l'auteur ne répond pas. Sur le client de l'auteur lui-même (§90 : un test
 * qu'il vient de lancer), la question est posée ici.
 * @param {Actor} actor
 * @param {object} payload  Voir handleChoiceQuery.
 * @returns {Promise<{id: string}|null>}
 */
export async function askChoice(actor, payload) {
  const userId = rollerFor(actor);
  let answer = null;
  if ( userId === game.user.id ) return handleChoiceQuery(payload);
  if ( userId ) {
    try { answer = await game.users.get(userId).query(CHOICE_QUERY, payload, { timeout: CHOICE_TIMEOUT }); }
    catch(err) { console.warn(`${MODULE_ID} | choix de ${actor.name} : pas de réponse du joueur`, err); }
  }
  return answer ?? handleChoiceQuery(payload);
}
