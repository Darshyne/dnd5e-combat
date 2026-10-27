/**
 * §250 : évènements dans l'initiative — une entrée temporaire du combat qui n'est pas une créature (un piège, une action d'antre, la fin
 * d'un sort, des renforts) : un combattant sans token ni acteur, à l'initiative fixe, marqué `flags.dnd5e-combat.event`. Le moteur ne le
 * prend jamais pour une créature (aucune règle ne lit son acteur : il n'en a pas). Quand vient son tour, le MJ actif émet
 * `dnd5e-combat.eventTurn` (`{ combat, combatant, key, data }`) : c'est le voisin qui l'a posé qui agit, puis passe le tour. Il sort du
 * combat seul après son dernier round (`rounds`), à la fin de son tour.
 *
 * API publique (`api.combat`) : `addEvent({ combat, name, img, initiative, rounds, key, data, hidden })` → le combattant ;
 * `removeEvent(keyOrCombatant, combat)` ; `events(combat)` ; `isEvent(combatant)`. MJ seulement pour écrire.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { eventRounds, eventEnded } from "../core/combat-events.mjs";

export const EVENT_TURN_HOOK = `${MODULE_ID}.eventTurn`;

/** Un évènement du combat (pas une créature) ? */
export const isEvent = combatant => !!combatant?.getFlag?.(MODULE_ID, "event");

/** Les évènements d'un combat. */
export const events = (combat=game.combat) => (combat?.combatants ?? []).filter(isEvent);

/**
 * Ajouter un évènement au combat. `rounds` : combien de rounds il joue à partir du round courant (1 par défaut : ce round seulement ;
 * null : jusqu'à ce qu'on le retire). Un évènement de même `key` déjà là est remplacé.
 * @returns {Promise<Combatant|null>}
 */
export async function addEvent({ combat=game.combat, name, img=null, initiative=20, rounds=1, key=null, data={}, hidden=false }={}) {
  if ( !game.user.isGM || !combat ) return null;
  if ( key ) await removeEvent(key, combat);
  const { from, until } = eventRounds(combat.round, rounds);
  const [created] = await combat.createEmbeddedDocuments("Combatant", [{
    name: name || game.i18n.localize("DND5ECOMBAT.Evenement.Nom"),
    img: img || "icons/svg/clockwork.svg",
    initiative: Number.isFinite(Number(initiative)) ? Number(initiative) : 20,
    hidden: hidden === true,
    flags: { [MODULE_ID]: { event: { key, from, until, data } } }
  }]);
  log(`initiative event "${created?.name}" added (initiative ${created?.initiative}, rounds ${from}–${until ?? "∞"})`);
  return created ?? null;
}

/** Retirer un évènement (par sa clé ou le combattant). */
export async function removeEvent(target, combat=game.combat) {
  if ( !game.user.isGM || !combat ) return 0;
  const ids = events(combat).filter(c => (c === target) || (c.id === target) || (c.getFlag(MODULE_ID, "event")?.key === target)).map(c => c.id);
  if ( ids.length ) await combat.deleteEmbeddedDocuments("Combatant", ids);
  return ids.length;
}

/** Chez le MJ actif, à chaque changement de tour : l'évènement dont c'est le tour est annoncé ; celui qui vient de finir son dernier round sort. */
async function onTurnChange(combat, prior, current) {
  const previous = combat.combatants.get(prior?.combatantId);
  if ( isEvent(previous) && eventEnded(previous.getFlag(MODULE_ID, "event"), prior?.round) ) {
    await removeEvent(previous, combat);
  }
  // Un round sauté (le MJ avance de deux rounds) : ce qui a fini depuis longtemps sort aussi.
  const stale = events(combat).filter(c => (c !== combat.combatant) && eventEnded(c.getFlag(MODULE_ID, "event"), (combat.round ?? 1) - 1));
  for ( const c of stale ) await removeEvent(c, combat);
  announce(combat);
}

/** Au début du combat : le premier tour est peut-être celui d'un évènement. */
function onCombatStart(combat) {
  announce(combat);
}

const announced = new Set();

function announce(combat) {
  const combatant = combat?.combatant;
  if ( !isEvent(combatant) ) return;
  const key = `${combat.id}:${combat.round}:${combat.turn}:${combatant.id}`;
  if ( announced.has(key) ) return;
  announced.add(key);
  const event = combatant.getFlag(MODULE_ID, "event");
  if ( Number.isFinite(event?.from) && ((combat.round ?? 1) < event.from) ) return;
  log(`initiative event "${combatant.name}": its turn (round ${combat.round})`);
  Hooks.callAll(EVENT_TURN_HOOK, { combat, combatant, key: event?.key ?? null, data: event?.data ?? {} });
}

export const combatApi = Object.freeze({ addEvent, removeEvent, events, isEvent });

export function registerCombatEvents() {
  route("combatTurnChange", onTurnChange, { executor: true, label: "initiative event not announced" });
  route("combatStart", onCombatStart, { executor: true, label: "initiative event not announced" });
  route("deleteCombat", combat => { for ( const k of [...announced] ) if ( k.startsWith(`${combat.id}:`) ) announced.delete(k); });
}
