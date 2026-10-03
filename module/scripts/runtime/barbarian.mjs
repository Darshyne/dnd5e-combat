/**
 * Le Barbare (SPEC §22) : ce que dnd5e ne tient pas de la Rage, et la Témérité.
 *
 *  - Rage entretenue (MJ actif) : prendre la Rage, attaquer un ennemi, imposer une sauvegarde à un ennemi marquent le tour
 *    (`rageKept`) ; à la fin de son tour, une Rage ni entretenue ni nourrie d'une action Bonus prend fin (sauf Rage persistante).
 *    Elle prend fin aussi quand le barbare devient Neutralisé (Inconscient seulement avec Rage persistante). Prendre la Rage met
 *    fin à la concentration ; en Rage, un sort est un souci de légalité (runtime/turn.mjs).
 *  - Rage implacable (MJ actif) : à 0 PV en Rage, la sauvegarde de Constitution de l'item, lancée par le moteur ; réussie, les PV
 *    deviennent le double du niveau de Barbare (une utilisation dépensée : le DD monte de 5) ; ratée, la Rage cesse et il tombe.
 *  - Témérité (client de l'auteur) : à la première attaque de Force de son tour, la question ; l'utilisation est suspendue puis
 *    relancée avec la réponse (`usageConfig["dnd5e-combat"].reckless`, qu'une intention peut aussi donner d'avance). Oui : une
 *    marque « Témérité » (adapter/mastery.mjs) jusqu'au début de son prochain tour.
 */

import { MODULE_ID } from "../constants.mjs";
import { areHostile } from "../core/reaction.mjs";
import { isRaging, barbarianRule, statusEndsRage, endRage, keepRage, rageKeptOn, relentlessAtZero, recklessChoice } from "../adapter/rage.mjs";
import { markData, marksOn } from "../adapter/mastery.mjs";
import { combatantFor, isOwnTurn, readBudget, currentTurnKey, usageTokenOf } from "../adapter/turn.mjs";
import { ensureDowned } from "../adapter/death.mjs";
import { contentOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

/** Le token qui parle dans un message, ou null. */
function speakerToken(message) {
  const { scene, token } = message?.speaker ?? {};
  return game.scenes.get(scene)?.tokens.get(token) ?? null;
}

/** Une des cibles du message est-elle hostile à ce token ? */
function hostileTarget(message, token) {
  return (message.system?.targets ?? []).some(t => {
    const target = fromUuidSync(t.token ?? "", { strict: false });
    return target && areHostile(token.disposition, target.disposition);
  });
}

async function stopRage(actor, why) {
  if ( !(await endRage(actor)) ) return;
  const token = tokenOf(actor);
  if ( token ) notice(token, loc("Rage.Retour"), "ended");
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${loc("Rage.Fin", { name: actor.name, why: loc(`Rage.Pourquoi.${why}`) })}</p>`,
    flags: { [MODULE_ID]: { rageEnded: { actor: actor.uuid, why } } }
  });
  log(`${actor.name} : fin de la Rage (${why})`);
}

/* -------------------------------------------- */
/*  Rage entretenue                             */
/* -------------------------------------------- */

async function onMessage(message) {
  const token = speakerToken(message);
  const actor = token?.actor ?? message.getAssociatedActor?.();
  if ( !actor ) return;
  if ( message.type === "usage" ) {
    const activity = message.getAssociatedActivity?.();
    // Prendre la Rage : « vous ne pouvez pas maintenir de concentration ».
    if ( activity?.item && contentOf(activity.item).entry?.rage ) {
      await keepRage(actor);
      if ( actor.concentration?.effects?.size ) await actor.endConcentration();
      return;
    }
    // « Imposer un jet de sauvegarde à un ennemi ».
    if ( isRaging(actor) && token && (activity?.type === "save") && hostileTarget(message, token) ) await keepRage(actor);
    return;
  }
  // « Faire un jet d'attaque contre un ennemi ».
  if ( (message.type === "attack") && token && isRaging(actor) && hostileTarget(message, token) ) await keepRage(actor);
}

function onTurnEnd(combat, prior) {
  const combatant = combat.combatants.get(prior?.combatantId);
  const actor = combatant?.actor;
  if ( !actor || !isRaging(actor) || barbarianRule(actor, "persistentRage") ) return;
  const priorKey = `${combat.id}.${prior.round}.${prior.turn}`;
  // « Prendre une action Bonus pour entretenir la Rage » : l'action Bonus dépensée à ce tour.
  const bonusSpent = (readBudget(combatant)?.bonus ?? 1) < 1;
  if ( (rageKeptOn(actor) === priorKey) || bonusSpent ) return;
  return enqueue(`rage:${actor.uuid}`, () => stopRage(actor, "entretien"));
}

function onEffectCreated(effect) {
  const actor = effect.parent;
  if ( (actor?.documentName !== "Actor") || !effect.statuses?.size || !isRaging(actor) ) return;
  if ( !statusEndsRage(actor, effect.statuses) ) return;
  // À 0 PV avec Rage implacable, la sauvegarde décide avant (l'Inconscient que dnd5e pose tombera si elle réussit).
  if ( ((actor.system.attributes?.hp?.value ?? 1) <= 0) && relentlessAtZero(actor) ) return;
  return enqueue(`rage:${actor.uuid}`, () => stopRage(actor, "etat"));
}

/* -------------------------------------------- */
/*  Rage implacable                             */
/* -------------------------------------------- */

function onZero(actor) {
  if ( !actor || !relentlessAtZero(actor) ) return;
  return enqueue(`rage:${actor.uuid}`, async () => {
    await new Promise(resolve => setTimeout(resolve, 400));   // dnd5e pose son état à 0 PV sur le client qui a écrit les PV
    const found = relentlessAtZero(actor);
    if ( !found || ((actor.system.attributes?.hp?.value ?? 1) > 0) ) return;
    const dc = found.activity.save?.dc?.value ?? 10;
    const rolls = await actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false },
      { data: { flavor: loc("Rage.ImplacableCarte", { name: actor.name, dc }), flags: { [MODULE_ID]: { relentless: { actor: actor.uuid, dc } } } } });
    const total = rolls?.[0]?.total;
    if ( Number.isFinite(total) && (total >= dc) ) {
      const hp = 2 * (actor.classes?.barbarian?.system?.levels ?? 1);
      const uses = found.item.system.uses ?? {};
      await found.item.update({ "system.uses.spent": (Number(uses.spent) || 0) + 1 });
      await actor.update({ "system.attributes.hp.value": hp });   // PV > 0 : Inconscient, échecs et Stabilisé retirés (runtime/death.mjs)
      const token = tokenOf(actor);
      if ( token ) notice(token, loc("Rage.Implacable", { name: actor.name, hp }), "gain");
      log(`Rage implacable : ${actor.name} réussit (${total} contre DD ${dc}) et reste debout à ${hp} PV`);
      return;
    }
    log(`Rage implacable : ${actor.name} rate (${total} contre DD ${dc})`);
    await stopRage(actor, "etat");
    await ensureDowned(actor);
  });
}

/* -------------------------------------------- */
/*  Témérité                                    */
/* -------------------------------------------- */

/** Pose la marque de Témérité sur l'attaquant (son client, qui possède l'acteur). */
async function beReckless(actor, token) {
  if ( !token || marksOn(actor, "reckless").length ) return;
  const found = barbarianRule(actor, "reckless");
  await actor.createEmbeddedDocuments("ActiveEffect", [markData("reckless", { source: token, target: token, weapon: found?.item ?? null, turnKey: currentTurnKey() })]);
  notice(token, loc("Botte.Retour.reckless"), "gain");
  log(`${actor.name} : Témérité jusqu'au début de son prochain tour`);
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  const actor = activity?.actor;
  if ( !actor || (activity.type !== "attack") || (activity.ability !== "str") || !barbarianRule(actor, "reckless") ) return true;
  const combatant = combatantFor(actor);
  if ( !combatant || !isOwnTurn(combatant) ) return true;
  const token = usageTokenOf(activity);
  const decided = usageConfig?.[MODULE_ID]?.reckless;
  const record = reckless => actor.setFlag(MODULE_ID, "recklessTurn", { key: currentTurnKey(), reckless })
    .then(() => (reckless ? beReckless(actor, token) : null));
  if ( typeof decided === "boolean" ) {
    if ( recklessChoice(actor) === null ) record(decided).catch(err => console.error(`${MODULE_ID} | Témérité`, err));
    return true;
  }
  if ( recklessChoice(actor) !== null ) return true;   // déjà décidé à ce tour
  // Les cibles de l'utilisation suspendue repartent avec la relance (un appelant peut les avoir relâchées entre-temps).
  const targets = Array.from(game.user.targets);
  timedWait({
    window: { title: loc("Rage.Temerite.Titre", { name: actor.name }) },
    content: `<p>${loc("Rage.Temerite.Question")}</p>`,
    buttons: [
      { action: "yes", label: loc("Rage.Temerite.Oui"), icon: "fa-solid fa-fire", default: true },
      { action: "no", label: loc("Rage.Temerite.Non") }
    ]
  }, { fallback: "no" }).then(async choice => {
    const reckless = choice === "yes";
    await record(reckless);
    if ( !game.user.targets.size ) for ( const t of targets ) t.setTarget(true, { releaseOthers: false });
    const config = { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), reckless } };
    activity.use(config, dialogConfig, messageConfig);
  }).catch(err => console.error(`${MODULE_ID} | Témérité`, err));
  return false;
}

export function registerBarbarian() {
  route("createChatMessage", message => (["usage", "attack"].includes(message.type) ? onMessage(message) : null),
    { executor: true, label: "Rage : entretien non noté" });
  route("combatTurnChange", onTurnEnd, { executor: true, label: "Rage : fin non jugée" });
  route("createActiveEffect", onEffectCreated, { executor: true, label: "Rage : fin sur état non jugée" });
  route("updateActor", (actor, changed) => {
    if ( foundry.utils.getProperty(changed, "system.attributes.hp.value") === 0 ) return onZero(actor);
  }, { executor: true, label: "Rage implacable non jouée" });
  route("updateToken", (token, changed) => {
    if ( foundry.utils.getProperty(changed, "delta.system.attributes.hp.value") === 0 ) return onZero(token.actor);
  }, { executor: true, label: "Rage implacable non jouée (token non lié)" });
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "Témérité : question" });
}
