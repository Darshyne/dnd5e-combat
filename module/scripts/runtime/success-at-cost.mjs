/**
 * Issue GitHub #32 : « Succès à un prix », aide optionnelle du Guide du maître 2024 (chapitre 2) — réglage de monde, éteint par défaut.
 *
 * Quand un test d20 rate de 1 ou 2, le moteur le signale au MJ seul, sans fenêtre : une pastille au-dessus du token (ui/success-at-cost.mjs)
 * et une entrée du menu contextuel. Le MJ décide d'offrir la réussite et décrit le prix avec ses mots ; le joueur accepte ou refuse.
 *
 * Deux circuits, selon ce qui dépend du résultat :
 *  - **le moteur applique le résultat** (attaque résolue, sauvegarde demandée par une résolution) : une pause courte AVANT le verdict
 *    (`successAtCostHold`, 5 s ; 0 = pas de pause). Sans geste du MJ, l'échec reste. Accepté : l'attaque touche (jamais d'un critique) ou
 *    la sauvegarde réussit, et la résolution reprend — dégâts et effets appliqués une seule fois, puisque rien ne l'a encore été ;
 *  - **rien n'est appliqué** (ligne d'un jet demandé par le MJ, §242 ; jet d'une carte de demande de dnd5e portant un DD) : un bouton du MJ sur la carte, sans
 *    pause ni limite. Accepté : le jet est marqué réussi (`flags.dnd5e-combat.atCost`), la carte et le verdict du groupe le comptent.
 *
 * Après les autres aides (Inspiration héroïque, Inspiration bardique, dés d'aptitude, Visée sans pareille) : seulement sur ce qui reste raté.
 * Un 1 naturel en attaque n'est jamais proposé. Retour à toute la table quand le joueur accepte : carte, texte flottant, éclat, son.
 * Hook public `dnd5e-combat.successAtCost` `({ actor, kind, accepted, cost, by })` après chaque réponse.
 */

import { MODULE_ID } from "../constants.mjs";
import { atCostMarginFor, cleanCost, holdSeconds, nearMiss, AT_COST_HOLD, AT_COST_MARGIN } from "../core/success-at-cost.mjs";
import { AT_COST_QUERY, askCost, askPlayerAtCost, handleAtCostQuery } from "../adapter/success-at-cost.mjs";
import { route } from "./router.mjs";
import { esc, isExecutor, loc, locEsc, log, notice, say, tokenOfActor, viaActiveGM } from "./shared.mjs";

export const AT_COST_SETTING = "successAtCost";
export const AT_COST_HOLD_SETTING = "successAtCostHold";
export const AT_COST_NPC_SETTING = "successAtCostNpc";
/** Public : après chaque réponse. */
export const AT_COST_HOOK = `${MODULE_ID}.successAtCost`;
/** Pour l'interface du MJ : une occasion ouverte, prise, ou close (`closed`). */
export const AT_COST_CANDIDATE_HOOK = `${MODULE_ID}.successAtCostCandidate`;
const AT_COST_MARK_QUERY = `${MODULE_ID}.successAtCostMark`;

const read = (key, fallback) => { try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch { return fallback; } };

export const atCostEnabled = () => read(AT_COST_SETTING, false) === true;

/** L'écart de l'aide pour un jet de cette créature (0 : rien à proposer). */
export function atCostMarginOf(actor) {
  if ( !actor || ["group", "vehicle"].includes(actor.type) ) return 0;
  return atCostMarginFor({ enabled: atCostEnabled(), npc: read(AT_COST_NPC_SETTING, false) === true, isCharacter: actor.type === "character" });
}

/* -------------------------------------------- */
/*  Les occasions en attente (MJ actif)          */
/* -------------------------------------------- */

/** Les occasions ouvertes sur ce client, par id. */
const candidates = new Map();

const publicOf = c => ({ id: c.id, token: c.token, actor: c.actor, name: c.name, what: c.what, total: c.total, needed: c.needed, by: c.by,
  kind: c.kind, deadline: c.deadline, seconds: c.seconds, claimed: c.claimed });

/** Les occasions ouvertes (interface, menu, scénarios). */
export function atCostCandidates() {
  return [...candidates.values()].map(publicOf);
}

/** L'occasion ouverte sur ce token, ou null. */
export function atCostCandidateOn(tokenUuid) {
  return atCostCandidates().find(c => c.token === tokenUuid) ?? null;
}

function close(id, answer) {
  const c = candidates.get(id);
  if ( !c ) return;
  candidates.delete(id);
  clearTimeout(c.timer);
  Hooks.callAll(AT_COST_CANDIDATE_HOOK, { ...publicOf(c), closed: true });
  c.resolve(answer);
}

/**
 * Le moteur a un jet raté de peu, dont il va appliquer le résultat : la pause, pendant laquelle le MJ peut offrir le succès à un prix.
 * MJ actif. Rend `{ accepted, cost }` (accepté : la réussite), ou null (aide éteinte, pas de pause, le MJ n'a rien fait, échec laissé).
 * @param {{actor: Actor, token?: TokenDocument|null, what: string, total: number, needed: number, kind: "attack"|"save"}} data
 */
export async function holdForAtCost({ actor, token=null, what, total, needed, kind }) {
  if ( !isExecutor() || !actor ) return null;
  const by = nearMiss(total, needed, atCostMarginOf(actor));
  if ( !by ) return null;
  const seconds = holdSeconds(read(AT_COST_HOLD_SETTING, AT_COST_HOLD.byDefault));
  if ( !seconds ) return null;
  const tokenDoc = token ?? tokenOfActor(actor)?.document ?? tokenOfActor(actor) ?? null;
  const { promise, resolve } = Promise.withResolvers();
  const c = { id: foundry.utils.randomID(), token: tokenDoc?.uuid ?? null, actor: actor.uuid, name: actor.name, what, total, needed, by, kind,
    seconds, deadline: Date.now() + (seconds * 1000), claimed: false, resolve, timer: null };
  candidates.set(c.id, c);
  c.timer = setTimeout(() => { if ( !c.claimed ) close(c.id, null); }, seconds * 1000);
  log(`success at a cost: ${actor.name}, ${what} ${total} vs ${needed} (missed by ${by}) — ${seconds} s for the GM`);
  Hooks.callAll(AT_COST_CANDIDATE_HOOK, publicOf(c));
  const answer = await promise;
  if ( !answer && !c.claimed ) log(`success at a cost: not offered, ${actor.name}'s failure stands`);
  return answer?.accepted ? answer : null;
}

/** Le MJ laisse passer l'occasion (pastille fermée) : l'échec reste, tout de suite. */
export function dismissAtCost(id) {
  const c = candidates.get(id);
  if ( c && !c.claimed ) close(id, null);
}

/**
 * Le MJ prend l'occasion : la pause s'arrête, sa fenêtre décrit le prix (sauf `cost` donné : macro, scénario), puis la question au
 * joueur. Rend true si le joueur a accepté.
 * @param {string} id
 * @param {{cost?: string}} [options]
 */
export async function offerAtCost(id, { cost }={}) {
  const c = candidates.get(id);
  if ( !c || c.claimed ) return false;
  c.claimed = true;
  clearTimeout(c.timer);
  Hooks.callAll(AT_COST_CANDIDATE_HOOK, publicOf(c));
  try {
    const answer = await proposeTo(await fromUuid(c.actor), { what: c.what, kind: c.kind, cost, total: c.total, needed: c.needed, by: c.by });
    close(id, answer);
    return !!answer?.accepted;
  } catch(err) {
    console.error(`${MODULE_ID} | success at a cost`, err);
    close(id, null);
    return false;
  }
}

/**
 * La fenêtre du MJ (si `cost` n'est pas donné), la question au joueur, le retour à la table. Rend `{ accepted, cost, by }`, ou null si le
 * MJ a laissé l'échec.
 */
async function proposeTo(actor, { what, kind, cost, total, needed, by }) {
  if ( !actor ) return null;
  let text = cost;
  if ( text === undefined ) {
    const asked = await askCost({ name: actor.name, what, total, needed, by });
    if ( !asked ) { log(`success at a cost: the GM keeps ${actor.name}'s failure`); return null; }
    text = asked.cost;
  }
  const price = cleanCost(text);
  const { accepted, by: decidedBy } = await askPlayerAtCost(actor, { name: actor.name, what, cost: price });
  log(`success at a cost: ${actor.name} ${accepted ? "accepts" : "declines"}${price ? ` — "${price}"` : ""}`);
  await tellTable(actor, { what, cost: price, accepted });
  Hooks.callAll(AT_COST_HOOK, { actor, kind, accepted, cost: price, by: decidedBy });
  return { accepted, cost: price, by: decidedBy };
}

/** Accepté : carte publique, texte flottant, éclat et son chez tous. Refusé : un texte flottant discret. */
async function tellTable(actor, { what, cost, accepted }) {
  const token = tokenOfActor(actor);
  if ( accepted ) {
    await say({ actor }, [`<i class="fa-solid fa-scale-balanced"></i> ${locEsc("APrix.Carte", { name: actor.name, what })}`,
      ...(cost ? [`<em>${locEsc("APrix.CartePrix", { cost })}</em>`] : [])], { atCostCard: { cost } });
    if ( token ) notice(token, { key: "APrix.Avis" }, "atCost", { all: true, action: "atCost", outcome: "success" });
  }
  else if ( token ) notice(token, { key: "APrix.AvisRefus" }, "ended", { all: true, action: "atCost", outcome: "failure" });
}

/* -------------------------------------------- */
/*  Sur une carte : jets dont rien ne dépend      */
/* -------------------------------------------- */

/** Le DD et le total d'un jet natif de dnd5e qui peut devenir une réussite à un prix ; null sinon. */
export function nativeCandidate(message) {
  if ( !message || ["attack", "damage", "healing", "usage", "request"].includes(message.type) ) return null;
  if ( message.getFlag(MODULE_ID, "groupRollResult") || message.getFlag(MODULE_ID, "atCost") ) return null;
  // Un jet que le moteur a lui-même lancé ou exploité (saut, escalade, serrure, opposition…) porte ses drapeaux : son issue est déjà
  // appliquée, la changer après coup ne la déferait pas.
  if ( Object.keys(message.flags?.[MODULE_ID] ?? {}).length ) return null;
  // Et seulement le jet d'une carte de demande de dnd5e (`flags.dnd5e.requestResult`, data/chat-message/request-message-data.mjs:127,
  // documents/actor/actor.mjs:2480) : les tests que le moteur lance lui-même avec un DD (escalade, Se cacher, réception d'un saut…)
  // n'en portent pas, et leur issue est déjà appliquée.
  if ( !message.getFlag("dnd5e", "requestResult") ) return null;
  if ( ["death", "concentration"].includes(message.system?.type) ) return null;
  const roll = message.rolls?.[0];
  if ( !(roll instanceof CONFIG.Dice.D20Roll) || !Number.isNumeric(roll.options?.target) ) return null;
  // Une sauvegarde qu'une résolution du moteur attend : elle a sa pause, pas de bouton (rien n'est défait après coup).
  if ( message.getFlag(MODULE_ID, "inResolution") ) return null;
  const actor = message.getAssociatedActor?.() ?? null;
  const by = nearMiss(roll.total, Number(roll.options.target), atCostMarginOf(actor));
  return by ? { actor, total: roll.total, needed: Number(roll.options.target), by } : null;
}

/** La ligne d'un jet demandé par le MJ (§242) qui peut devenir une réussite à un prix ; null sinon. */
export function rowCandidate(entry, request) {
  if ( !entry || (entry.status !== "rolled") || entry.atCost || !entry.message ) return null;
  const by = nearMiss(entry.total, request?.dc ?? null, atCostMarginOf(entry.actor));
  return by ? { actor: entry.actor, total: entry.total, needed: request.dc, by, message: entry.message } : null;
}

/**
 * Le MJ offre le succès à un prix sur un jet déjà posé (bouton de la carte). Accepté : le jet est marqué par le MJ actif.
 * @param {string} messageId  Le message du jet.
 * @param {{what: string, cost?: string}} options
 */
export async function offerOnMessage(messageId, { what, cost }={}) {
  if ( !game.user.isGM ) return false;
  const message = game.messages.get(messageId);
  const roll = message?.rolls?.[0];
  const actor = message?.getAssociatedActor?.() ?? null;
  if ( !message || !roll || !actor || message.getFlag(MODULE_ID, "atCost") ) return false;
  const needed = Number(roll.options?.target ?? message.getFlag(MODULE_ID, "atCostDc"));
  const answer = await proposeTo(actor, { what, kind: "check", cost, total: roll.total, needed, by: needed - roll.total });
  if ( !answer?.accepted ) return false;
  await viaActiveGM(AT_COST_MARK_QUERY, markMessage, { message: messageId, cost: answer.cost }, { label: "success at a cost: roll not marked" });
  return true;
}

/** MJ actif : le jet est marqué réussi à un prix (une seule fois). */
async function markMessage({ message: id, cost=null }) {
  const message = game.messages.get(id);
  if ( !message || message.getFlag(MODULE_ID, "atCost") ) return false;
  await message.setFlag(MODULE_ID, "atCost", { cost: cost ?? null });
  return true;
}

/** Une ligne de jet demandé (§242) : le DD vient de la demande (le jet n'a pas de cible quand le DD est caché). */
export async function offerOnRow(cardId, row, { cost }={}) {
  const card = game.messages.get(cardId);
  const result = game.messages.get(row?.message ?? "");
  if ( !game.user.isGM || !card || !result ) return false;
  // Le DD vient de la demande, pas du jet (il n'y est pas quand il est caché) : le jet n'est pas réécrit.
  const actor = result.getAssociatedActor?.() ?? row.actor ?? null;
  if ( !actor || result.getFlag(MODULE_ID, "atCost") ) return false;
  const answer = await proposeTo(actor, { what: row.what, kind: "check", cost, total: row.total, needed: row.needed, by: row.needed - row.total });
  if ( !answer?.accepted ) return false;
  await viaActiveGM(AT_COST_MARK_QUERY, markMessage, { message: result.id, cost: answer.cost }, { label: "success at a cost: roll not marked" });
  return true;
}

/** Le texte de l'état « à un prix » sous un jet (carte), déjà échappé. */
export function atCostLabel(flag) {
  return flag?.cost ? locEsc("APrix.MarqueAvecPrix", { cost: flag.cost }) : esc(loc("APrix.Marque"));
}

export const atCostApi = Object.freeze({
  enabled: atCostEnabled,
  candidates: atCostCandidates,
  offer: offerAtCost,
  dismiss: dismissAtCost,
  offerOnMessage,
  offerOnRow,
  margin: AT_COST_MARGIN
});

export function registerSuccessAtCost() {
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  world(AT_COST_SETTING, { type: Boolean, default: false });
  world(AT_COST_HOLD_SETTING, { type: Number, default: AT_COST_HOLD.byDefault, range: { min: AT_COST_HOLD.min, max: AT_COST_HOLD.max, step: 1 } });
  world(AT_COST_NPC_SETTING, { type: Boolean, default: false });
  CONFIG.queries[AT_COST_QUERY] = handleAtCostQuery;   // chez le joueur qui répond
  CONFIG.queries[AT_COST_MARK_QUERY] = markMessage;
  // Une scène qui change : les occasions ouvertes se ferment (l'échec reste).
  route("canvasTearDown", () => { for ( const id of [...candidates.keys()] ) dismissAtCost(id); }, { label: "success at a cost: not cleared" });
}
