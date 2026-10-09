/**
 * §36 : Présage du Devin (core/portent.mjs) côté Foundry — les jets notés sur le devin, qui peut s'en servir, et la question.
 *
 * Vérifié :
 *  - `dnd5e.restCompleted(actor, result, config)`, `config.type` = "long" pour un Repos long (documents/actor/actor.mjs:2299, 2421).
 *  - Le d20 d'un jet se borne par `options.minimum` / `options.maximum` du premier jet de la configuration : D20Roll les applique au
 *    dé (dice/d20-roll.mjs:259-266, `applyRange` de d20-die.mjs:104-112) et les fusionne avec ceux du système (`mergeOptions`,
 *    d20-roll.mjs:297-303) ; « 1d20min7max7 » vaut 7, même avec l'Avantage ; un 20 noté est un critique (d20-die.mjs:33-37, le total
 *    du dé après bornes).
 *
 * Les jets vivent sur l'acteur du devin : `flags["dnd5e-combat"].portent` = { rolls, turn }. Qui les écrit : celui qui répond à la
 * question (le joueur du devin, ou le MJ), propriétaire de l'acteur.
 */

import { MODULE_ID } from "../constants.mjs";
import { readPortent, canForetell, portentChoices, spendPortent } from "../core/portent.mjs";
import { contentOf } from "./content.mjs";
import { timedWait } from "./dialogs.mjs";
import { rollerFor } from "./concentration.mjs";
import { canSee } from "./vision.mjs";
import { currentTurnKey } from "./turn.mjs";
import { isObjectToken } from "./bodies.mjs";

export const PORTENT_QUERY = `${MODULE_ID}.portent`;
/** §38.4 : réglage de monde « Présage du Devin » — le moteur le propose-t-il ? (actif par défaut) */
export const PORTENT_SETTING = "portent";
const portentOffered = () => { try { return game.settings.get(MODULE_ID, PORTENT_SETTING) !== false; } catch { return true; } };
const PORTENT_TIMEOUT = 20000;   // au-delà du délai de la fenêtre (adapter/dialogs.mjs)

/** Combien de d20 le devin note à chaque Repos long (0 : pas de Présage). Présage supérieur l'emporte sur Présage. */
export function portentDice(actor) {
  let dice = 0;
  for ( const item of actor?.items ?? [] ) dice = Math.max(dice, contentOf(item).entry?.portent?.dice ?? 0);
  return dice;
}

/** Les jets notés du devin, tels qu'il les a. */
export const portentOf = actor => readPortent(actor?.getFlag(MODULE_ID, "portent"));

/** Repos long : les jets restants s'effacent, de nouveaux d20 sont lancés et notés — la carte n'est vue que du devin et du MJ. */
export async function rollPortent(actor) {
  const dice = portentDice(actor);
  if ( !dice ) return null;
  const roll = await new Roll(`${dice}d20`).evaluate();
  const rolls = roll.dice[0].results.map(r => r.result);
  await actor.setFlag(MODULE_ID, "portent", { rolls, turn: null });
  const data = await roll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.format("DND5ECOMBAT.Presage.Notes", { rolls: rolls.join(", ") }),
    flags: { [MODULE_ID]: { portent: { rolled: rolls } } }
  }, { create: false });
  data.whisper = game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);
  data.blind = false;
  await ChatMessage.implementation.create(data);
  return rolls;
}

/** Le jet noté sert : retiré, le tour retenu, et la carte le dit. Rend false s'il n'était plus noté. Propriétaire de l'acteur. */
async function useForetold(actor, value, { subject, kind }) {
  const spent = spendPortent(actor.getFlag(MODULE_ID, "portent"), value, currentTurnKey());
  if ( !spent ) return false;
  await actor.setFlag(MODULE_ID, "portent", spent);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${game.i18n.format("DND5ECOMBAT.Presage.Utilise", { name: actor.name, subject, value })}</p>`,
    flags: { [MODULE_ID]: { portent: { used: value, subject, kind, left: spent.rolls } } }
  });
  return true;
}

/**
 * Les devins qui peuvent remplacer le Test d20 de cette créature : sur sa scène, vivants et conscients, avec des jets notés et pas
 * déjà servis ce tour-ci, et qui la voient (la créature elle-même compte : « effectué par vous »). Neutralisé, il le peut : le Présage
 * n'est pas une réaction. `skip` : ids de tokens à ne pas consulter (ceux qui viennent de décliner).
 * @param {TokenDocument} subject
 * @returns {Array<{token: TokenDocument, choices: number[]}>}
 */
export function seersOf(subject, { skip=null }={}) {
  if ( !subject?.parent || !portentOffered() ) return [];
  const turnKey = currentTurnKey();
  const out = [];
  for ( const token of subject.parent.tokens ) {
    const actor = token.actor;
    // Le flag d'abord : sans jet noté, rien à lire de plus (appelé à chaque attaque et chaque sauvegarde).
    const state = actor?.getFlag(MODULE_ID, "portent");
    if ( !state?.rolls?.length || !canForetell(state, turnKey) || skip?.has(token.id) ) continue;
    if ( token.hidden || isObjectToken(token) || !portentDice(actor) ) continue;
    if ( ((actor.system.attributes?.hp?.value ?? 1) <= 0) || ["dead", "unconscious"].some(s => actor.statuses?.has(s)) ) continue;
    if ( (token !== subject) && ((canSee(token, subject) ?? true) === false) ) continue;
    out.push({ token, choices: portentChoices(state) });
  }
  return out;
}

/**
 * Côté du devin (son joueur, ou le MJ) : une fenêtre, un bouton par jet noté, et « ne pas s'en servir » — la réponse par défaut, un
 * jet ne se dépense jamais sans accord. Le jet choisi est dépensé ici (propriétaire de l'acteur), et la carte le dit.
 * @param {{actor: string, subject: string, kind: "attack"|"save", item: string}} payload
 * @returns {Promise<{value: number}|null>}
 */
export async function handlePortentQuery({ actor: actorUuid, subject, kind, item }) {
  const actor = await fromUuid(actorUuid);
  if ( !actor ) return null;
  const choices = portentChoices(actor.getFlag(MODULE_ID, "portent"));
  if ( !choices.length ) return null;
  const buttons = choices.map((n, i) => ({ action: `v${n}`, label: game.i18n.format("DND5ECOMBAT.Presage.Remplacer", { value: n }),
    icon: "fa-solid fa-eye", default: i === 0 }));
  buttons.push({ action: "none", label: game.i18n.localize("DND5ECOMBAT.Presage.Non") });
  const picked = await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.Presage.Titre", { name: actor.name }) },
    content: `<p>${game.i18n.format(`DND5ECOMBAT.Presage.${kind === "save" ? "Sauvegarde" : "Attaque"}`, { subject, item })}</p>`,
    buttons
  }, { fallback: "none" });
  const value = Number(String(picked ?? "").replace(/^v/, ""));
  if ( !String(picked ?? "").startsWith("v") || !choices.includes(value) ) return null;
  return (await useForetold(actor, value, { subject, kind })) ? { value } : null;
}

/**
 * Demande au devin s'il remplace ce jet : son joueur connecté, sinon le MJ actif (depuis n'importe quel client : l'attaquant peut être
 * un joueur). Ne lève jamais : pas de réponse = pas de Présage.
 * @returns {Promise<number|null>}  La valeur notée qui remplace le d20.
 */
export async function askPortent(actor, payload) {
  const userId = rollerFor(actor) ?? game.users.activeGM?.id ?? null;
  try {
    const answer = (!userId || (userId === game.user.id)) ? await handlePortentQuery(payload)
      : await game.users.get(userId).query(PORTENT_QUERY, payload, { timeout: PORTENT_TIMEOUT });
    return Number.isInteger(answer?.value) ? answer.value : null;
  } catch(err) {
    console.warn(`${MODULE_ID} | Portent for ${actor.name}: no answer`, err);
    return null;
  }
}

/**
 * Consulte les devins l'un après l'autre pour le Test d20 de `subject` ; le premier qui accepte l'emporte (une seule valeur remplace
 * le d20). `auto` (scénarios) : "none" = personne ; "first" = le premier devin, sa plus haute valeur pour un allié du sujet (ou le
 * sujet), sa plus basse sinon — sans fenêtre.
 * `declined` (facultatif) : reçoit les ids des devins qui ont décliné, pour ne pas leur reposer la question aux autres cibles de la même
 * sauvegarde (adapter/saves.mjs).
 * @returns {Promise<{value: number, seer: string}|null>}
 */
export async function foretellFor(subject, { kind, item, auto=null, declined=null }) {
  if ( auto === "none" ) return null;
  for ( const { token, choices } of seersOf(subject, { skip: declined }) ) {
    let value = null;
    if ( auto === "first" ) {
      const friendly = (token === subject) || (token.disposition === subject.disposition);
      const wanted = friendly ? choices[0] : choices.at(-1);
      // Écrit ici : ce client doit posséder le devin (les scénarios tournent chez le MJ) ; sinon, pas de Présage plutôt qu'une porte
      // interrompue.
      try { value = (await useForetold(token.actor, wanted, { subject: subject.name, kind })) ? wanted : null; }
      catch(err) { console.warn(`${MODULE_ID} | Portent for ${token.name}: not written`, err); }
    }
    else value = await askPortent(token.actor, { actor: token.actor.uuid, subject: subject.name, kind, item });
    if ( value !== null ) return { value, seer: token.name };
    declined?.add(token.id);
  }
  return null;
}
