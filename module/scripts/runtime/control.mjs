/**
 * §285 : sorts de contrôle (lot 3 des chantiers du 2026-10-30). MJ actif.
 *  - Panique (`panic`) — Terreur : « lâche ce qu'elle tient » sur l'échec (résolution close) ; Terreur et Mauvais œil (Paniqué) : à
 *    chacun de ses tours, la créature prend l'action Foncer et s'éloigne du lanceur par l'A* du moteur (attaques d'opportunité, murs).
 *    Mauvais œil : l'effet cesse si elle finit ce déplacement à `endsAt` du lanceur sans le voir. Le « chemin le plus sûr » reste au MJ.
 *  - Confusion (`confusion`) : 1d10 montré au début de son tour (core/control.mjs) — errance, rien, coup au hasard à son allonge
 *    (annoncé : le jet d'attaque reste au joueur ou au MJ), ou libre. Ni action Bonus (`noBonus`) ni Réaction (`noReactions`).
 *  - Couronne du dément (`forcedAttack`, `upkeep`) : au début du tour de la créature Charmée, le rappel « attaque au corps à corps une
 *    créature que le lanceur choisit, avant de se déplacer » ; à la fin de chaque tour suivant du lanceur, le sort prend fin s'il ne
 *    l'a pas entretenu (action Magie : entrée « Maintenir » du menu de son token, `maintain`).
 * Retour visuel et sonore vu de tous (`notice`, `all`), carte dans le chat.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { confusionBehavior, wanderCells } from "../core/control.mjs";
import { dash as dashBudget } from "../core/turn.mjs";
import { isWithinRange } from "../core/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, comesFromItemEffect } from "../adapter/facts.mjs";
import { dropHeld } from "../adapter/orders.mjs";
import { combatantFor, readBudget, writeBudget, currentTurnKey, turnKeyAt, distanceBetween, speedOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { seesBetween } from "../adapter/vision.mjs";
import { cellOf, footprintOf, sizeOf } from "../adapter/movement.mjs";
import { footprintDistance } from "../core/orders.mjs";
import { fleeFrom, approach } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, locEsc, notice, say, sleep, waitForDice } from "./shared.mjs";

const handled = new Set();
const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];

/** Les effets actifs de l'acteur dont l'item d'origine déclare `key` (et, si la règle nomme un effet, celui-là) : `{ effect, item, rule }`. */
function ruled(actor, key, effectOf=rule => rule?.effect ?? null) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    // L'effet de concentration du lanceur vient du même item : il ne porte pas la règle de la cible (comme adapter/triggers.mjs).
    if ( effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration") ) continue;
    const item = originItemOf(effect);
    const rule = item ? contentOf(item).entry?.[key] : null;
    if ( !rule ) continue;
    const id = effectOf(rule);
    if ( id && !comesFromItemEffect(effect, id) ) continue;
    out.push({ effect, item, rule });
  }
  return out;
}

/** Le token du lanceur d'un item sur la scène de `token`, ou null. */
function casterToken(item, token) {
  const actor = item?.actor;
  if ( !actor || (actor === token.actor) ) return null;
  return actor.getActiveTokens?.(false, true)?.find(t => t.parent === token.parent) ?? null;
}

const canAct = actor => ((actor?.system?.attributes?.hp?.value ?? 0) > 0) && !INCAPACITATING.some(s => actor.statuses?.has(s));

/* -------------------------------------------- */
/*  Terreur : lâcher sur l'échec                */
/* -------------------------------------------- */

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || handled.has(resolution.origin) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const item = activity?.item;
  if ( !item || (contentOf(item).entry?.panic?.drop !== true) ) return;
  handled.add(resolution.origin);
  for ( const t of (resolution.targets ?? []).filter(x => x.save && !x.save.success) ) {
    const token = await fromUuid(t.token);
    if ( !token?.actor ) continue;
    const dropped = await dropHeld(token);
    const lines = [locEsc("Controle.Lache", { name: token.name, item: item.name })];
    if ( dropped.items.length ) lines.push(locEsc(dropped.pile ? "Ordre.LacheTas" : "Ordre.LacheInventaire", { items: dropped.items.join(", ") }));
    if ( dropped.kept?.length ) lines.push(locEsc("Ordre.LacheGarde", { items: dropped.kept.join(", ") }));
    if ( !dropped.items.length && !dropped.kept?.length ) lines.push(locEsc("Ordre.RienEnMain", { name: token.name }));
    log(`${item.name}: ${token.name} drops what it holds (${dropped.items.join(", ") || "nothing"})`);
    await say({ token }, lines, { control: { kind: "drop", item: item.name, token: token.uuid, items: dropped.items } });
  }
}

/* -------------------------------------------- */
/*  Début du tour du porteur                    */
/* -------------------------------------------- */

/** Panique : Foncer, puis s'éloigner du lanceur ; Mauvais œil : fin à `endsAt` hors de vue. */
async function panic(combatant, token, { effect, item, rule }) {
  const caster = casterToken(item, token);
  if ( !caster || !canAct(token.actor) ) return;
  const budget = readBudget(combatant);
  const dashed = dashBudget(budget);
  if ( dashed !== budget ) await writeBudget(combatant, dashed);
  const fled = await fleeFrom(token, caster);
  const lines = [locEsc("Controle.Fuit", { name: token.name, caster: caster.name, item: item.name })];
  if ( !fled.moved ) lines.push(locEsc("Controle.FuitBloque", { name: token.name }));
  log(`${item.name}: ${token.name} dashes away from ${caster.name} (${fled.from} → ${fled.to} squares${fled.reason ? `, ${fled.reason}` : ""})`);
  notice(token, { key: "Controle.Panique" }, "refused", { all: true, action: "control", outcome: "failure" });
  let ended = false;
  if ( rule.endsAt ) {
    const far = isWithinRange(distanceBetween(token, caster), { value: rule.endsAt.distance, units: rule.endsAt.units }, readUnitFactors()) === false;
    if ( far && (seesBetween(token.actor, caster.actor) === false) ) {
      await effect.delete();
      ended = true;
      lines.push(locEsc("Controle.PaniqueFin", { name: token.name, item: item.name }));
      log(`${item.name}: ${token.name} is far enough and cannot see ${caster.name} — the effect ends`);
    }
  }
  await say({ token }, lines, { control: { kind: "panic", item: item.name, token: token.uuid, from: fled.from, to: fled.to, ended } });
}

/** Confusion : le d10, puis ce qu'il impose. */
async function confused(combatant, token, { item }) {
  if ( !canAct(token.actor) ) return;
  const roll = await new Roll("1d10").evaluate();
  const message = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token }), flavor: loc("Controle.ConfusionJet", { name: token.name, item: item.name }) });
  await waitForDice(message);
  const behavior = confusionBehavior(roll.total);
  const lines = [locEsc(`Controle.Confusion.${behavior.kind}`, { name: token.name })];
  let budget = { ...readBudget(combatant), bonus: 0 };
  let target = null;
  if ( behavior.kind === "wander" ) {
    const d8 = await new Roll("1d8").evaluate();
    const shown = await d8.toMessage({ speaker: ChatMessage.getSpeaker({ token }), flavor: loc("Controle.ConfusionDirection", { name: token.name }) });
    await waitForDice(shown);
    const speed = speedOf(token.actor, readUnitFactors(), token._source?.movementAction ?? null)?.speed ?? 0;
    const cells = Math.floor(speed / (token.parent.grid.distance || 5));
    const grid = token.parent.grid;
    const { sceneX, sceneY, sceneWidth, sceneHeight } = token.parent.dimensions;
    const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
    const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
    const goal = wanderCells(cellOf(token), d8.total, cells, sizeOf(token), { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j });
    await writeBudget(combatant, { ...budget, action: 0 });
    for ( const cell of goal ) {
      const r = await approach(token, { cells: [cell] });
      if ( r.arrived || (r.reason === "stopped") ) break;
    }
    budget = { ...readBudget(combatant), action: 0, bonus: 0, stopped: true };
  }
  else if ( behavior.kind === "idle" ) budget = { ...budget, action: 0, stopped: true };
  else if ( behavior.kind === "lash" ) {
    const near = token.parent.tokens.filter(t => (t !== token) && t.actor && !t.hidden && ((t.actor.system?.attributes?.hp?.value ?? 0) > 0)
      && (footprintDistance(footprintOf(token), footprintOf(t)) === 0));
    target = near.length ? near[Math.floor(Math.random() * near.length)] : null;
    budget = target ? { ...budget, stopped: true } : { ...budget, action: 0, stopped: true };
    lines.push(target ? locEsc("Controle.Confusion.lashTarget", { name: token.name, target: target.name }) : locEsc("Controle.Confusion.lashNone", { name: token.name }));
  }
  await writeBudget(combatant, budget);
  log(`${item.name}: ${token.name} rolls ${roll.total} — ${behavior.kind}${target ? ` (${target.name})` : ""}`);
  notice(token, { key: `Controle.Confusion.${behavior.kind}Court` }, "refused", { all: true, action: "control", outcome: behavior.kind === "free" ? "success" : "failure" });
  await say({ token }, lines, { control: { kind: "confusion", item: item.name, token: token.uuid, roll: roll.total, behavior: behavior.kind, target: target?.uuid ?? null } });
}

/** Couronne du dément : le rappel de l'attaque imposée. */
async function forcedAttack(token, { item }) {
  if ( !canAct(token.actor) ) return;
  const caster = item.actor;
  notice(token, { key: "Controle.Couronne" }, "refused", { all: true, action: "control", outcome: "failure" });
  await say({ token }, [locEsc("Controle.CouronneRappel", { name: token.name, caster: caster?.name ?? "", item: item.name })],
    { control: { kind: "forcedAttack", item: item.name, token: token.uuid } });
}

async function onTurnStart(combatant) {
  const token = combatant?.token;
  const actor = token?.actor;
  if ( !actor ) return;
  const panics = ruled(actor, "panic");
  const confusions = ruled(actor, "confusion", rule => (typeof rule === "string") ? rule : null);
  const crowns = ruled(actor, "forcedAttack", rule => (typeof rule === "string") ? rule : null);
  if ( !panics.length && !confusions.length && !crowns.length ) return;
  // La remise à neuf du budget (runtime/turn.mjs) part au même changement de tour : on la laisse arriver (comme Injonction).
  await sleep(600);
  if ( panics.length ) await panic(combatant, token, panics[0]);
  else if ( confusions.length ) await confused(combatant, token, confusions[0]);
  if ( crowns.length ) await forcedAttack(token, crowns[0]);
}

/* -------------------------------------------- */
/*  Entretien par l'action Magie (Couronne)     */
/* -------------------------------------------- */

/** Les sorts du lanceur à entretenir : ses effets de concentration dont l'item déclare `upkeep`. */
export function upkeepsOf(actor) {
  return Array.from(actor?.effects ?? []).filter(e => !e.disabled && (e.statuses?.has?.("concentrating") || (e.getFlag?.("dnd5e", "type") === "concentration")))
    .map(effect => ({ effect, item: originItemOf(effect) })).filter(({ item }) => item && (contentOf(item).entry?.upkeep === true));
}

/** Entretenir peut-il se faire maintenant (en combat, à son tour, pas déjà fait ce tour) ? */
export function canMaintain(token, effect) {
  const combatant = combatantFor(token?.actor);
  const key = currentTurnKey();
  if ( !combatant || !key || (game.combat?.combatant?.id !== combatant.id) ) return false;
  // `since` : noté à la fin du tour du lancement (onTurnEnd) — pendant ce tour-là, rien à entretenir.
  const flag = effect.getFlag(MODULE_ID, "upkeep") ?? {};
  return !!flag.since && (flag.since !== key) && (flag.done !== key);
}

/** L'action Magie qui entretient le sort : l'action du tour, notée sur l'effet de concentration. Sur le client de celui qui agit. */
export async function maintain(token, effect, item) {
  const combatant = combatantFor(token.actor);
  if ( !combatant ) return false;
  const budget = readBudget(combatant);
  if ( !(budget.action >= 1) ) { notice(token, loc("Controle.EntretienSansAction", { item: item.name })); return false; }
  await writeBudget(combatant, { ...budget, action: budget.action - 1 });
  await effect.setFlag(MODULE_ID, "upkeep", { ...(effect.getFlag(MODULE_ID, "upkeep") ?? {}), done: currentTurnKey() });
  notice(token, { key: "Controle.Entretenu", data: { item: item.name } }, "gain", { all: true, action: "upkeep", outcome: "success" });
  await say({ token }, [locEsc("Controle.EntretienFait", { name: token.name, item: item.name })], { control: { kind: "upkeep", item: item.name, token: token.uuid } });
  log(`${item.name}: ${token.name} maintains the spell (Magic action)`);
  return true;
}

/** Fin du tour du lanceur : le tour du lancement est noté ; ensuite, sans entretien ce tour-là, la concentration tombe. */
async function onTurnEnd(combatant, priorKey) {
  const token = combatant?.token;
  const actor = token?.actor;
  if ( !actor || !priorKey ) return;
  for ( const { effect, item } of upkeepsOf(actor) ) {
    const flag = effect.getFlag(MODULE_ID, "upkeep") ?? {};
    if ( !flag.since ) { await effect.setFlag(MODULE_ID, "upkeep", { since: priorKey }); continue; }
    if ( (flag.since === priorKey) || (flag.done === priorKey) ) continue;
    log(`${item.name}: ${actor.name} did not maintain the spell — it ends`);
    await actor.endConcentration(item);
    notice(token, { key: "Controle.NonEntretenu", data: { item: item.name } }, "refused", { all: true, action: "upkeep", outcome: "failure" });
    await say({ token }, [locEsc("Controle.EntretienManque", { name: token.name, item: item.name })], { control: { kind: "upkeepLost", item: item.name, token: token.uuid } });
  }
}

export function registerControl() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`control:${resolution?.origin}`, () => onResolution(resolution)),
    { executor: true, label: "control spells: dropped items not handled" });
  route("combatTurnChange", (combat, prior, current) => {
    const ended = combat.combatants.get(prior?.combatantId);
    if ( ended?.token ) enqueue(`upkeep:${ended.token.uuid}`, () => onTurnEnd(ended, turnKeyAt(combat, prior)));
    const started = combat.combatants.get(current?.combatantId);
    if ( started?.token ) return enqueue(`control:${started.token.uuid}`, () => onTurnStart(started));
  }, { executor: true, label: "control spells: turn behaviour not played" });
}
