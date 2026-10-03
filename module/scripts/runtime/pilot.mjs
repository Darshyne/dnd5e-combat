/**
 * Objets pilotés (SPEC §16.15, B19) : Arme spirituelle, Sphère de feu, Main de Bigby. Le lanceur les commande pendant
 * SON tour ; une commande coûte son action Bonus et ouvre un déplacement borné plus une utilisation.
 *
 *  - tour sauté : l'objet se range au combat juste après son lanceur (§16.13), mais le cœur passe son tour
 *    (`combatTurn` / `combatRound`, avant l'écriture du combat, sur le client qui avance) ; filet sur le MJ actif ;
 *  - commande offerte au lancement (`onCast`), à la création du token ;
 *  - un déplacement de l'objet ouvre (et paie) la commande du tour, sur le MJ actif (`moveToken`) — le plafond et le
 *    tour sont tenus avant, sur le client de celui qui bouge (runtime/actions.mjs) ;
 *  - son utilisation se paie avec le budget du lanceur (runtime/turn.mjs, `pilotUsage`) ;
 *  - l'objet retiré (`endsSpell`) met fin à la concentration du sort.
 * Les écritures d'un même objet passent l'une après l'autre : un déplacement en plusieurs segments suivi d'une attaque
 * ne paie qu'une commande.
 */

import { MODULE_ID } from "../constants.mjs";
import { spendUse } from "../core/turn.mjs";
import { castCommand, nextPlayableTurn } from "../core/pilot.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { readBudget, writeBudget, isOwnTurn, distanceBetween, positionOf } from "../adapter/turn.mjs";
import { areHostile } from "../core/reaction.mjs";
import {
  pilotOf, commandPlan, summonerCombatant, writeCommand, readCommand, turnKey, isPilotedCombatant, pulseOf, commandKey,
  summonerToken, summonsOfWith
} from "../adapter/pilot.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { pulseAgainst } from "../adapter/areas.mjs";
import { convertLength } from "../core/units.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";

/** Une écriture à la fois par objet. */
const queues = new Map();
export function serialized(tokenId, fn) {
  const run = (queues.get(tokenId) ?? Promise.resolve()).then(fn, fn);
  queues.set(tokenId, run.catch(() => {}));
  return run;
}

/**
 * Paie le geste s'il ouvre une commande, et écrit l'état de la commande. Rend ce qu'il faut pour une annulation :
 * le budget d'avant et d'après, l'état de commande d'avant.
 */
async function charge(pilot, gesture) {
  const plan = commandPlan(pilot, gesture);
  const combatant = plan.combatant;
  if ( !combatant || !plan.next ) return null;
  const commandBefore = readCommand(combatant, pilot);
  const before = readBudget(combatant);
  let after = before;
  if ( plan.pay ) {
    after = spendUse(before, { cost: plan.pay, weaponAttack: false, usesSpellSlot: false }, { isOwnTurn: plan.ownTurn, attacksPerAction: 1 });
    await writeBudget(combatant, after);
    log(`${combatant.name} : ${plan.pay} (commande de ${pilot.token.name})`);
  }
  await writeCommand(combatant, pilot, plan.next);
  return { combatant: combatant.id, before, after, command: { token: commandKey(pilot), before: commandBefore } };
}

/** L'utilisation d'une activité de l'objet (carte d'utilisation), sur le MJ actif : payée au budget du lanceur. */
export function pilotUsage(message, pilot) {
  return serialized(commandKey(pilot), async () => {
    const spent = await charge(pilot, "use");
    if ( spent ) await message.setFlag(MODULE_ID, "spent", spent);
  });
}

/** « Move Lights » utilisée (carte d'utilisation), sur le MJ actif : ouvre la commande de déplacement du tour. */
export function spellCommandUsage(message, pilot) {
  return serialized(commandKey(pilot), async () => {
    const spent = await charge(pilot, "move");
    if ( spent ) await message.setFlag(MODULE_ID, "spent", spent);
  });
}

/** Annulation avant tout jet : l'état de commande d'avant revient (le budget, lui, est rendu par runtime/turn.mjs). */
export async function refundCommand(combatant, command) {
  if ( !combatant || !command?.token ) return;
  await combatant.setFlag(MODULE_ID, `commands.${command.token}`, command.before ?? { turn: "", paid: false, move: false, used: 0 });
}

/** L'objet piloté peut-il être renvoyé par ce client : il met fin au sort, et la concentration est à soi. */
export function canDismiss(tokenDoc) {
  const pilot = pilotOf(tokenDoc);
  if ( !pilot ) return false;
  // Sans concentration (Duplicité : le lanceur la congédie quand il veut, sans action) : le propriétaire du lanceur.
  if ( !tokenDoc.getFlag(MODULE_ID, "summonedBy") ) return pilot.summoner.isOwner;
  if ( !tokenDoc.getFlag(MODULE_ID, "endsSpell") ) return false;
  const effect = fromUuidSync(tokenDoc.getFlag(MODULE_ID, "summonedBy"), { strict: false });
  return !!effect?.isOwner;
}

export const DISMISS_QUERY = `${MODULE_ID}.dismissSummon`;

/** Côté MJ actif : retirer l'objet d'un lanceur que le demandeur possède. */
async function handleDismiss({ token: tokenUuid }, { user }={}) {
  const token = await fromUuid(tokenUuid);
  const pilot = token ? pilotOf(token) : null;
  if ( !pilot || (user && !pilot.summoner.testUserPermission(user, "OWNER")) ) return false;
  log(`${token.name} congédié`);
  await token.delete();
  return true;
}

/** Une commande qui ne vise que l'objet (Main interposée) : son utilisation, comme un clic sur la fiche. */
export async function useCommand(tokenDoc, activity, event=null) {
  tokenDoc.object?.control({ releaseOthers: true });
  return activity.use({ ...(event ? { event } : {}) });
}

/**
 * Renvoyer l'objet (§16.15) : c'est mettre fin au sort. La concentration supprimée retire elle-même ses objets (MJ actif,
 * runtime/concentration.mjs) — un joueur peut supprimer l'effet de son personnage, pas un token.
 */
export async function dismissPilot(tokenDoc) {
  if ( !tokenDoc.getFlag(MODULE_ID, "summonedBy") ) {
    // Pas de concentration à rompre : le token lui-même part, par le MJ actif (un joueur ne supprime pas de token).
    if ( !canDismiss(tokenDoc) ) return false;
    const gm = game.users.activeGM;
    if ( !gm ) return false;
    if ( gm.isSelf ) return handleDismiss({ token: tokenDoc.uuid });
    return gm.query(DISMISS_QUERY, { token: tokenDoc.uuid }, { timeout: 10000 }).catch(() => false);
  }
  const effect = fromUuidSync(tokenDoc.getFlag(MODULE_ID, "summonedBy") ?? "", { strict: false });
  if ( !effect?.isOwner ) return false;
  log(`${tokenDoc.name} renvoyé : fin de ${effect.name}`);
  await effect.delete();
  return true;
}

/* -------------------------------------------- */

/** Le lanceur s'éloigne : ses objets `leash` restés hors de la portée du sort disparaissent. */
async function leashAround(casterToken) {
  const actor = casterToken.actor;
  if ( !actor ) return;
  for ( const token of casterToken.parent.tokens ) {
    const origin = token.actor?.getFlag("dnd5e", "summon.origin");
    if ( !origin?.startsWith(actor.uuid) ) continue;
    const pilot = pilotOf(token);
    if ( !pilot?.rule.leash || (pilot.summoner !== actor) || !beyondSpellRange(pilot) ) continue;
    log(`${token.name} : hors de portée de ${pilot.item.name} (le lanceur s'éloigne), disparaît`);
    ui.notifications.info(loc("Pilote.HorsPortee", { name: token.name, item: pilot.item.name }));
    await token.delete();
  }
}

/** Un déplacement de l'objet pendant le tour de son lanceur ouvre la commande du tour (MJ actif). */
function onMoveToken(tokenDoc, movement) {
  const pilot = pilotOf(tokenDoc);
  if ( !pilot ) return leashAround(tokenDoc);
  const moved = movement.passed?.waypoints ?? [];
  if ( !moved.length || moved.every(w => CONFIG.Token.movement.actions[w.action]?.teleport) ) return;
  // « Une lumière disparaît si elle sort de la portée du sort » (`leash`, Lumières dansantes), quel que soit le tour.
  if ( pilot.rule.leash && beyondSpellRange(pilot) ) {
    log(`${tokenDoc.name} : hors de portée de ${pilot.item.name}, disparaît`);
    ui.notifications.info(loc("Pilote.HorsPortee", { name: tokenDoc.name, item: pilot.item.name }));
    return tokenDoc.delete();
  }
  const combatant = summonerCombatant(pilot);
  if ( !combatant || !isOwnTurn(combatant) ) return;   // replacé par le MJ hors du tour : rien à payer
  return serialized(commandKey(pilot), () => charge(pilot, "move"));
}

/** L'objet est-il au-delà de la portée du sort, mesurée depuis son lanceur ? */
function beyondSpellRange(pilot) {
  const caster = summonerToken(pilot);
  const range = pilot.item.system.range ?? {};
  if ( !caster || (caster.parent !== pilot.token.parent) || !Number.isFinite(Number(range.value)) ) return false;
  let limit = Number(range.value);
  try { limit = convertLength(limit, range.units, pilot.token.parent.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  return distanceBetween(caster, pilot.token).value > limit + 1e-6;
}

/** À la création de l'objet, pendant le tour du lanceur : la commande offerte par le lancement (`onCast`). */
async function onCreateToken(tokenDoc) {
  const pilot = pilotOf(tokenDoc);
  if ( !pilot ) return;
  // Un objet piloté n'est pas un allié (Tactique de meute, adapter/facts.mjs) ; l'illusion de la Duplicité a les traits
  // du lanceur (un double visuel de celui-ci, `mimic`).
  const update = { [`flags.${MODULE_ID}.object`]: true };
  const look = pilot.summon.mimic ? summonerToken(pilot) : null;
  if ( look?.texture?.src ) Object.assign(update, { "texture.src": look.texture.src, "ring.enabled": look.ring?.enabled ?? false,
    "ring.subject.texture": look.ring?.subject?.texture ?? null });
  const combatant = summonerCombatant(pilot);
  const ownTurn = !!combatant && isOwnTurn(combatant);
  // §38.2 : le tour de la création (Troc du filou : l'action Bonus qui crée l'illusion compte aussi).
  if ( ownTurn ) update[`flags.${MODULE_ID}.createdTurn`] = turnKey(combatant.combat);
  await tokenDoc.update(update);
  if ( !ownTurn ) return;
  const state = castCommand(pilot.rule.onCast, turnKey(combatant.combat));
  if ( !state ) return;
  await serialized(commandKey(pilot), () => writeCommand(combatant, pilot, state));
  log(`${tokenDoc.name} : commande offerte au lancement (${pilot.rule.onCast})`);
}

/**
 * L'objet retiré de la scène (supprimé à la main, détruit) : si le sort le déclare (`endsSpell`), sa concentration prend
 * fin — sauf s'il en reste un autre du même sort. La concentration qui tombe retire elle-même ses objets
 * (runtime/concentration.mjs) : l'effet est alors déjà parti, rien à faire ici.
 */
async function onDeleteToken(tokenDoc) {
  const effectUuid = tokenDoc.getFlag(MODULE_ID, "summonedBy");
  if ( !effectUuid || !tokenDoc.getFlag(MODULE_ID, "endsSpell") ) return;
  for ( const combat of game.combats ) {
    const gone = combat.combatants.filter(c => (c.tokenId === tokenDoc.id) && (c.sceneId === tokenDoc.parent?.id)).map(c => c.id);
    if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
  }
  const others = game.scenes.some(s => s.tokens.some(t => (t.id !== tokenDoc.id) && (t.getFlag(MODULE_ID, "summonedBy") === effectUuid)));
  if ( others ) return;
  const effect = fromUuidSync(effectUuid, { strict: false });
  if ( !effect ) return;
  log(`${tokenDoc.name} retiré : fin de la concentration (${effect.name})`);
  ui.notifications.info(loc("Pilote.FinDuSort", { name: tokenDoc.name, item: effect.name }));
  await effect.delete();
}

/**
 * Fin du tour d'une créature (§16.15, `summon.pulse`) : chaque objet qui agit autour de lui (Sphère de feu) la soumet à
 * son activité si elle est à `radius` ou moins — « toute créature qui termine son tour à 1,50 m de la sphère ». Le
 * lanceur compris ; pas l'objet lui-même. MJ actif.
 */
async function pulseAtTurnEnd(combat, prior) {
  const ended = combat.combatants.get(prior?.combatantId)?.token;
  if ( !ended?.actor || isPilotedCombatant(combat.combatants.get(prior.combatantId)) ) return;
  const key = `${combat.id}.${prior.round}.${prior.turn}`;   // la fin d'un tour appartient au tour qui s'achève
  for ( const source of ended.parent.tokens ) {
    const pulse = pulseOf(source);
    if ( !pulse || !(pulse.rule.on ?? ["turnEnd"]).includes("turnEnd") ) continue;
    if ( pulseReaches(source, pulse, ended) ) await pulseOnce(source, pulse, ended, "turnEnd", key);
  }
}

/** Ce que l'objet frappe : pas lui-même, pas un mort, pas un objet piloté ; `affects: "enemy"` : les ennemis du lanceur. */
function pulseCanHit(source, pulse, token) {
  if ( (token === source) || !token.actor || token.hidden || isObjectToken(token) ) return false;
  if ( token.actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) return false;
  if ( pulse.rule.affects !== "enemy" ) return true;
  const pilot = pilotOf(source);
  const caster = pilot ? summonerToken(pilot) : null;
  return areHostile(caster?.disposition ?? source.disposition, token.disposition);
}

/** La créature est-elle à portée de l'objet — à une position donnée de l'un ou de l'autre ? */
function pulseReaches(source, pulse, token, { posSource, posToken }={}) {
  if ( !pulseCanHit(source, pulse, token) || (source.parent !== token.parent) ) return false;
  let radius = pulse.rule.radius;
  try { radius = convertLength(radius, pulse.rule.units, token.parent.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  return distanceBetween(source, token, { posA: posSource, posB: posToken }).value <= radius + 1e-6;
}

const pulseTurnKey = () => game.combat?.started ? `${game.combat.id}.${game.combat.round}.${game.combat.turn}` : "hors-combat";

/** « Une créature ne fait cette sauvegarde qu'une fois par tour » : mémoire sur le token de l'objet. MJ actif. */
function pulseOnce(source, pulse, token, moment, turn=pulseTurnKey()) {
  return serialized(`pulse:${source.id}`, async () => {
    const memory = source.getFlag(MODULE_ID, "pulse");
    const hit = (memory?.turn === turn) ? memory.hit : [];
    if ( hit.includes(token.id) ) return;
    await source.setFlag(MODULE_ID, "pulse", { turn, hit: [...hit, token.id] });
    log(`${source.name} : ${token.name} (${moment}, ${pulse.activity.item.name})`);
    await pulseAgainst(pulse.activity, source, token, moment);
  });
}

/**
 * Déplacements (MJ actif) : l'objet arrive à portée de créatures (`moves`), ou une créature arrive à portée d'un objet
 * (`enter`) — Invocation d'animaux : « chaque fois que la meute se déplace à 3 m d'une créature, et chaque fois qu'une
 * créature entre dans un espace à 3 m de la meute ».
 */
async function pulseOnMove(tokenDoc, movement) {
  const from = movement.origin ? positionOf(movement.origin) : null;
  if ( !from ) return;
  const own = pulseOf(tokenDoc);
  if ( own && (own.rule.on ?? []).includes("moves") ) {
    for ( const other of tokenDoc.parent.tokens ) {
      if ( pulseReaches(tokenDoc, own, other) && !pulseReaches(tokenDoc, own, other, { posSource: from }) ) await pulseOnce(tokenDoc, own, other, "moves");
    }
  }
  for ( const source of tokenDoc.parent.tokens ) {
    if ( source === tokenDoc ) continue;
    const pulse = pulseOf(source);
    if ( !pulse || !(pulse.rule.on ?? []).includes("enter") ) continue;
    if ( pulseReaches(source, pulse, tokenDoc) && !pulseReaches(source, pulse, tokenDoc, { posToken: from }) ) await pulseOnce(source, pulse, tokenDoc, "enter");
  }
}

/** L'objet tombé à 0 PV (`endsAtZero`, Main de Bigby : « si elle tombe à 0 point de vie, le sort prend fin »). MJ actif. */
async function onUpdateActor(actor, changes) {
  if ( foundry.utils.getProperty(changes, "system.attributes.hp.value") === undefined ) return;
  if ( (actor.system.attributes?.hp?.value ?? 1) > 0 ) return;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token?.getFlag(MODULE_ID, "endsAtZero") ) return;
  const effect = fromUuidSync(token.getFlag(MODULE_ID, "summonedBy") ?? "", { strict: false });
  if ( !effect ) return;
  log(`${token.name} à 0 PV : fin de ${effect.name}`);
  await effect.delete();
}

/** Le lanceur Neutralisé : ses invocations `endsIfIncapacitated` cessent (Duplicité). MJ actif. */
async function onIncapacitated(actor) {
  if ( !actor || !INCAPACITATING.some(s => actor.statuses?.has(s)) ) return;
  for ( const token of summonsOfWith(actor, "endsIfIncapacitated") ) {
    log(`${token.name} : ${actor.name} est Neutralisé, l'invocation cesse`);
    await token.delete();
  }
}

/* ---- tour sauté ---- */

const skipsOf = combat => combat.turns.map(isPilotedCombatant);

/**
 * `combatTurn` / `combatRound` (client/documents/combat.mjs:285-294, 234-237, 313) : appelés avec les données de
 * l'écriture avant qu'elle parte, sur le client qui avance le combat. Le tour visé, s'il est celui d'un objet piloté,
 * passe au suivant (ou au précédent en reculant). Au bord du round, on laisse faire : le filet du MJ actif avance.
 */
function onCombatAdvance(combat, updateData, updateOptions) {
  if ( !Number.isInteger(updateData?.turn) ) return;
  const skip = skipsOf(combat);
  if ( !skip[updateData.turn] || skip.every(Boolean) ) return;
  const turn = nextPlayableTurn(skip, updateData.turn, (updateOptions?.direction ?? 1) < 0 ? -1 : 1);
  if ( (turn >= 0) && (turn < skip.length) ) updateData.turn = turn;
}

/** Filet (MJ actif) : le tour d'un objet piloté a quand même commencé (clic dans le suivi, bord du round). */
async function onTurnChange(combat, prior, current) {
  const combatant = combat.combatants.get(current?.combatantId);
  if ( !isPilotedCombatant(combatant) || skipsOf(combat).every(Boolean) ) return;
  const back = (current.round < prior?.round) || ((current.round === prior?.round) && (current.turn < prior?.turn));
  log(`${combatant.name} : objet piloté, son tour est passé`);
  if ( back ) await combat.previousTurn();
  else await combat.nextTurn();
}

export function registerPilot() {
  route("combatTurn", onCombatAdvance, { label: "objet piloté : tour sauté" });
  route("combatRound", onCombatAdvance, { label: "objet piloté : tour sauté (round)" });
  route("combatStart", (combat, updateData) => onCombatAdvance(combat, updateData, { direction: 1 }), { label: "objet piloté : tour sauté (début)" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "objet piloté : tour non sauté" });
  route("combatTurnChange", pulseAtTurnEnd, { executor: true, label: "objet invoqué : fin de tour à portée" });
  route("updateActor", onUpdateActor, { executor: true, label: "objet piloté : fin du sort à 0 PV" });
  route("createToken", onCreateToken, { executor: true, label: "objet piloté : commande de lancement" });
  route("moveToken", onMoveToken, { executor: true, label: "objet piloté : commande non payée" });
  route("moveToken", pulseOnMove, { executor: true, label: "objet invoqué : arrivée à portée" });
  route("deleteToken", onDeleteToken, { executor: true, label: "objet piloté : sort non terminé" });
  route("createActiveEffect", effect => onIncapacitated(effect.parent), { executor: true, label: "invocation : fin sur Neutralisé" });
  route("updateActiveEffect", effect => onIncapacitated(effect.parent), { executor: true, label: "invocation : fin sur Neutralisé" });
  CONFIG.queries[DISMISS_QUERY] = handleDismiss;
}
