/**
 * §282 : l'Inspiration héroïque, ce qui touche dnd5e et le client — qui l'a (`system.attributes.inspiration`, personnages joueurs
 * seulement : « si vous (un personnage joueur) avez l'Inspiration héroïque »), ce que vaut un jet lu sur sa carte, et la question au
 * joueur, filtrée par SON réglage (`heroicInspiration`, client : à chaque jet / seulement sur un échec / jamais).
 *
 * La question part comme les autres choix du combat (adapter/choices.mjs) : au joueur connecté qui possède l'acteur, sinon au MJ. Elle a
 * sa propre requête parce que le filtre se lit chez celui qui répond : le réglage est celui de son client.
 */

import { MODULE_ID } from "../constants.mjs";
import { handleChoiceQuery } from "./choices.mjs";
import { rollerFor } from "./concentration.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { heroicWanted, HEROIC_MODES, liveDice } from "../core/heroic.mjs";
import { d20Keep } from "../core/d20.mjs";

export const HEROIC_QUERY = `${MODULE_ID}.heroic`;
export const HEROIC_SETTING = "heroicInspiration";

/** Délai d'attente de la réponse d'un joueur (au-delà de celui de sa fenêtre). */
const HEROIC_TIMEOUT = 25000;

/** Le réglage de ce client : « on », « failure » ou « off » (« on » s'il n'est pas lisible). */
export function heroicMode() {
  try {
    const mode = game.settings.get(MODULE_ID, HEROIC_SETTING);
    return HEROIC_MODES.includes(mode) ? mode : "on";
  }
  catch { return "on"; }
}

/** Le personnage joueur a-t-il l'Inspiration héroïque ? */
export function hasHeroic(actor) {
  return (actor?.type === "character") && !!actor.system?.attributes?.inspiration;
}

/**
 * Ce qu'un jet d20 dit de ses d20 : les valeurs lancées (pas celles qu'une relance de dnd5e a remplacées, Chanceux du Halfelin), le mode
 * (Avantage : « kh », Désavantage : « kl »), le total et les seuils de critique du dé. null sans d20.
 */
export function d20Facts(roll) {
  const die = roll?.dice?.find?.(d => d.faces === 20);
  if ( !die || !Number.isFinite(roll.total) ) return null;
  const values = die.results.filter(r => !r.rerolled).map(r => r.result);
  if ( !values.length ) return null;
  // §435 : dnd5e écrit `adv` / `dis` sur le d20, pas `kh` / `kl` — un Désavantage était lu comme un Avantage (le mauvais d20 gardé).
  const keep = d20Keep(die.modifiers, die.options?.advantageMode);
  const mode = (values.length < 2) ? null : (keep === "kl") ? "disadvantage" : "advantage";
  return { values, mode, total: roll.total,
    criticalSuccess: Number(die.options?.criticalSuccess) || 20, criticalFailure: Number(die.options?.criticalFailure) || 1 };
}

/**
 * Les dés d'un jet de dégâts ou de soin, un par résultat lancé : son jet, son terme, sa place, ses faces, sa valeur, son type, ses
 * modificateurs (Style Armes à deux mains : « min3 ») et ses propriétés (pour retrouver sa part dans l'agrégat du moteur).
 */
export function damageDice(rolls) {
  const dice = [];
  rolls.forEach((roll, r) => {
    // §435 : les dés du jet que l'Attaquant sauvage écarte (`{2d6,2d6}kh`) ne sont pas proposés — leur relance ne changerait rien.
    for ( const { term, result: res, index } of liveDice(roll.terms) ) {
      dice.push({ roll: r, result: index, faces: term.faces, value: res.result, type: roll.options?.type ?? null,
        properties: [...(roll.options?.properties ?? [])], modifiers: (term.modifiers ?? []).filter(m => /^(min|max)\d+$/.test(m)) });
    }
  });
  return dice;
}

/**
 * Chez celui qui répond : son réglage d'abord (`failed` : le jet est raté — true, false, ou null quand l'issue n'est pas connue),
 * puis la fenêtre, au premier plan. Rend `{ id }` (« skip » : le réglage n'en veut pas).
 */
export async function handleHeroicQuery(payload) {
  if ( !heroicWanted(heroicMode(), payload?.failed ?? null) ) return { id: "skip" };
  // Reconnaissable sans crier (retours de l'utilisateur, 2026-10-30) : étoile au titre, un filet doré, la règle en une ligne ; les dés à
  // relancer en grosses tuiles (runtime/heroic.mjs). Pas de son à l'ouverture : le retour sonore est celui de la relance.
  const heading = `<p class="dnd5e-combat-heroic-rule">${game.i18n.localize("DND5ECOMBAT.Heroique.Regle")}</p>`;
  return handleChoiceQuery({ ...payload, front: true, heading, icon: "fa-solid fa-star", classes: ["dnd5e-combat-heroic"] });
}

/**
 * Sur le client qui pose la question : au joueur qui possède l'acteur, sinon ici. Une fenêtre fermée sans choisir, un joueur qui ne
 * répond pas : le jet est gardé (l'Inspiration ne se dépense pas sans accord, et le MJ n'est pas consulté à sa place).
 */
export async function askHeroic(actor, payload) {
  const userId = rollerFor(actor);
  if ( !userId || (userId === game.user.id) ) return handleHeroicQuery(payload);
  try { return await queryPlayer(game.users.get(userId), HEROIC_QUERY, payload, { timeout: HEROIC_TIMEOUT, actor, label: waitLabel("Heroique") }); }
  catch(err) {
    console.warn(`${MODULE_ID} | Heroic Inspiration for ${actor.name}: no answer from the player`, err);
    return null;
  }
}

/** Dépense l'Inspiration (false si elle n'y est plus : dépensée ailleurs entre-temps). */
export async function spendHeroic(actor) {
  if ( !hasHeroic(actor) ) return false;
  await actor.update({ "system.attributes.inspiration": false });
  return true;
}
