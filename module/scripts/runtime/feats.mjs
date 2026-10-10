/**
 * §129 : dons d'origine du Manuel des joueurs, au jet de dégâts (sur le client de l'auteur, `dnd5e.preRollDamageV2`).
 *
 *  - Sauvagerie martiale (`savageAttacker`) : une fois par tour, au jet de dégâts d'une arme (pas une attaque à mains nues), ses dés
 *    sont lancés deux fois et le meilleur gardé (core/feats.mjs, `twiceKeepHighest`). Le choix « l'un ou l'autre » est toujours le
 *    meilleur : pas de question. Hors combat, chaque coup.
 *  - Guérisseur (`healingRerolls`) : aux dés de soins d'un sort, un 1 relancé une fois (`rerollOnesOnce`). Les Soins de combat du don
 *    portent déjà la relance dans leurs données.
 * Ailleurs : Bagarreur de tavernes (faveur `hitRider`, adapter/smite.mjs), Chanceux (`rollBonus.luck`, adapter/inspiration.mjs ; sa
 * fenêtre avant une attaque, content/feats.mjs), Vigilant (`initiativeSwap`, runtime/roll-bonus.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { twiceKeepHighest, rerollOnesOnce, oneMoreKeepBest } from "../core/feats.mjs";
import { STEPS } from "../core/action.mjs";
import { attackDamageTypes } from "../adapter/smite.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { victimsOf } from "../adapter/grapple.mjs";
import { enqueue } from "./queue.mjs";
import { contentOf } from "../adapter/content.mjs";
import { combatantFor } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

const hasRule = (actor, key) => Array.from(actor?.items ?? []).some(i => contentOf(i).entry?.[key] === true);

/** Le tour de combat où se bat l'acteur (« combat.round.tour »), ou null hors combat. */
function turnOf(actor) {
  const combat = combatantFor(actor)?.parent ?? null;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const actor = activity?.actor;
  if ( !actor || !config.rolls?.length ) return true;
  // Guérisseur : les dés de soins d'un sort.
  if ( (activity.type === "heal") && (activity.item?.type === "spell") && hasRule(actor, "healingRerolls") ) {
    for ( const roll of config.rolls ) roll.parts = (roll.parts ?? []).map(rerollOnesOnce);
    log(`Healer: 1s rerolled once on ${activity.item.name}'s healing dice`);
  }
  // Sauvagerie martiale : la part de l'arme d'un coup d'arme, une fois par tour.
  const weapon = (activity.type === "attack") && (activity.item?.type === "weapon") && (activity.attack?.type?.classification !== "unarmed");
  if ( weapon && hasRule(actor, "savageAttacker") ) {
    const turn = turnOf(actor);
    if ( turn && (actor.getFlag(MODULE_ID, "savageAttacker") === turn) ) return true;
    const base = config.rolls.find(r => r.base) ?? config.rolls[0];
    base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? twiceKeepHighest(p) : p));
    foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.savageAttacker`, true);
    if ( turn ) actor.setFlag(MODULE_ID, "savageAttacker", turn).catch(() => null);
    log(`Savage Attacker: ${base.parts[0]}`);
  }
  // §132 : Perforeur — une attaque qui inflige des dégâts perforants.
  if ( (activity.type === "attack") && attackDamageTypes(activity).includes("piercing") && hasRule(actor, "piercer") ) {
    for ( const roll of config.rolls ) {
      roll.options ??= {};
      roll.options.critical = { ...(roll.options.critical ?? {}), bonusDice: (Number(roll.options.critical?.bonusDice) || 0) + 1 };
    }
    const turn = turnOf(actor);
    if ( !turn || (actor.getFlag(MODULE_ID, "piercer") !== turn) ) {
      const base = config.rolls.find(r => r.base) ?? config.rolls[0];
      const before = base.parts?.[0];
      base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? oneMoreKeepBest(p) : p));
      if ( (base.parts[0] !== before) && turn ) actor.setFlag(MODULE_ID, "piercer", turn).catch(() => null);
      log(`Piercer: ${base.parts[0]} (one more die on a critical hit)`);
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  §132 : marques de coup critique              */
/* -------------------------------------------- */

const seen = new Set();

/** Après une attaque tranchée (MJ actif) : chaque cible touchée d'un coup critique du bon type reçoit la marque des dons de l'auteur. */
async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  seen.add(resolution.id);
  // `resolution.source` : l'uuid de l'ACTEUR auteur (runtime/felled.mjs le compare à `token.actor.uuid`).
  const from = fromUuidSync(resolution.source ?? "", { strict: false });
  const source = (from?.documentName === "Actor") ? from : (from?.actor ?? null);
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  if ( !source || !activity ) return;
  const rules = source.items.map(i => ({ item: i, rule: contentOf(i).entry?.critMark })).filter(r => r.rule);
  if ( !rules.length ) return;
  const types = attackDamageTypes(activity);
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit || !t.critical ) continue;
    const target = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !target || ((target.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    for ( const { item, rule } of rules ) {
      if ( !types.includes(rule.damageType) ) continue;
      const name = loc(`CoupCritique.${rule.side}`, { item: item.name });
      await target.createEmbeddedDocuments("ActiveEffect", [{ name, img: item.img, origin: item.uuid, transfer: false, disabled: false,
        changes: [], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
        flags: { [MODULE_ID]: { critMark: { side: rule.side, source: source.uuid, item: item.uuid } } } }]);
      log(`${item.name}: critical hit, "${name}" placed on ${target.name}`);
    }
  }
}

/** Retire les marques qu'un auteur a posées (au début de son tour, à la fin du combat). */
async function dropMarks(sourceUuid) {
  for ( const token of canvas?.scene?.tokens ?? [] ) {
    const actor = token.actor;
    const ids = (actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "critMark")?.source === sourceUuid).map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

/** §132 : Combat à mains nues — « au début de chacun de vos tours, 1d4 dégâts contondants à une créature que vous agrippez ». */
async function grappleDamage(actor, token) {
  const item = actor.items.find(i => contentOf(i).entry?.grappleDamage);
  if ( !item || !token ) return;
  const rule = contentOf(item).entry.grappleDamage;
  for ( const victim of victimsOf(token) ) {
    const logged = await inflict({ step: { formula: rule.formula, damageType: rule.damageType }, item, targetUuid: victim.uuid, properties: [],
      speaker: ChatMessage.implementation.getSpeaker({ token }), flavor: loc("CoupCritique.Empoignade", { item: item.name, name: victim.name }),
      flags: { grappleDamage: { item: item.uuid, target: victim.uuid } } });
    log(`${item.name}: ${victim.name} takes ${rule.formula} ${rule.damageType}${logged ? ` (HP ${logged.before?.value} -> ${logged.after?.value})` : ""}`);
  }
}

function onTurnChange(combat, prior, current) {
  const combatant = combat.combatants.get(current?.combatantId);
  const actor = combatant?.actor;
  if ( !actor ) return;
  return enqueue(`feats-turn:${actor.uuid}`, async () => {
    await dropMarks(actor.uuid);
    if ( (actor.system.attributes?.hp?.value ?? 0) > 0 ) await grappleDamage(actor, combatant.token);
  });
}

export function registerFeats() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "origin feats (damage)" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`critMark:${resolution?.id}`, () => onResolution(resolution)), { executor: true, label: "critical mark not placed" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "feat turn start" });
  route("deleteCombat", combat => Promise.all(combat.combatants.map(c => (c.actor ? dropMarks(c.actor.uuid) : null))), { executor: true, label: "critical marks not removed" });
}
