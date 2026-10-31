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
import { isRaging, barbarianRule, statusEndsRage, endRage, keepRage, rageKeptOn, relentlessAtZero, recklessChoice } from "../adapter/rage.mjs";
import { markData, marksOn } from "../adapter/mastery.mjs";
import { combatantFor, isOwnTurn, readBudget, currentTurnKey, usageTokenOf, speakerTokenOf, turnKeyAt } from "../adapter/turn.mjs";
import { ensureDowned, AFTER_ZERO_HP_MS } from "../adapter/death.mjs";
import { contentOf } from "../adapter/content.mjs";
import { tokenOf, originItemOf } from "../adapter/facts.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice, sleep, say, locEsc } from "./shared.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { spendItemUses } from "../adapter/uses.mjs";

/** Une des cibles du message est-elle hostile à ce token ? */
function hostileTarget(message, token) {
  return (message.system?.targets ?? []).some(t => {
    const target = fromUuidSync(t.token ?? "", { strict: false });
    return target && areEnemies(token, target);
  });
}

async function stopRage(actor, why) {
  if ( !(await endRage(actor)) ) return;
  const token = tokenOf(actor);
  if ( token ) notice(token, loc("Rage.Retour"), "ended");
  await say({ actor }, locEsc("Rage.Fin", { name: actor.name, why: loc(`Rage.Pourquoi.${why}`) }), { rageEnded: { actor: actor.uuid, why } });
  log(`${actor.name}: Rage ends (${why})`);
}

/* -------------------------------------------- */
/*  Rage entretenue                             */
/* -------------------------------------------- */

async function onMessage(message) {
  const token = speakerTokenOf(message);
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
  const priorKey = turnKeyAt(combat, prior);
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
    await sleep(AFTER_ZERO_HP_MS);
    const found = relentlessAtZero(actor);
    if ( !found || ((actor.system.attributes?.hp?.value ?? 1) > 0) ) return;
    const dc = found.activity.save?.dc?.value ?? 10;
    const rolls = await actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false },
      { data: { flavor: loc("Rage.ImplacableCarte", { name: actor.name, dc }), flags: { [MODULE_ID]: { relentless: { actor: actor.uuid, dc } } } } });
    const total = rolls?.[0]?.total;
    if ( Number.isFinite(total) && (total >= dc) ) {
      const hp = 2 * (actor.classes?.barbarian?.system?.levels ?? 1);
      await spendItemUses(found.item);
      await actor.update({ "system.attributes.hp.value": hp });   // PV > 0 : Inconscient, échecs et Stabilisé retirés (runtime/death.mjs)
      const token = tokenOf(actor);
      if ( token ) notice(token, loc("Rage.Implacable", { name: actor.name, hp }), "gain");
      log(`Relentless Rage: ${actor.name} succeeds (${total} vs DC ${dc}) and stays up at ${hp} HP`);
      return;
    }
    log(`Relentless Rage: ${actor.name} fails (${total} vs DC ${dc})`);
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
  log(`${actor.name}: Reckless Attack until the start of their next turn`);
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
    if ( recklessChoice(actor) === null ) record(decided).catch(err => console.error(`${MODULE_ID} | Reckless Attack`, err));
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
  }).catch(err => console.error(`${MODULE_ID} | Reckless Attack`, err));
  return false;
}

/**
 * §299 (repasse C4) : les aptitudes tenues par la Rage (`duringRage`). Le MJ actif rapproche, à chaque changement d'effet de l'acteur,
 * ce qu'elles portent de l'état de Rage :
 *  - `enable` : effets transférés de l'item, actifs pendant la Rage seulement (Rage aveugle : immunité à Charmé et Effrayé) ;
 *  - `post` : effets de l'item posés sur le barbare pendant la Rage, retirés à sa fin (Savoir primal) ;
 *  - `copiesEnd` : les copies que les activités de l'item ont posées sur lui tombent avec la Rage (Rage du prédateur : l'Ours, le Loup) ;
 *  - `disable` : effets transférés que la donnée laisse actifs à tort (Rage de l'Ours, toujours active hors Rage) ;
 *  - `cures` : à l'entrée en Rage, ces états cessent (Rage aveugle) ;
 *  - `onStart` : l'activité de l'item jouée à l'entrée en Rage (Vitalité de l'Arbre : PV temporaires).
 */
const DURING_RAGE_FLAG = "duringRage";

async function syncDuringRage(actor) {
  if ( (actor?.documentName !== "Actor") || !game.users.activeGM?.isSelf ) return;
  const raging = isRaging(actor);
  const was = !!actor.getFlag(MODULE_ID, DURING_RAGE_FLAG);
  // Plus aucune aptitude tenue par la Rage (retirée pendant une Rage) : la marque d'entrée ne doit pas survivre, sinon la prochaine entrée
  // en Rage ne serait pas vue comme telle.
  if ( !actor.items.some(i => contentOf(i).entry?.duringRage) ) {
    if ( was ) await actor.unsetFlag(MODULE_ID, DURING_RAGE_FLAG);
    return;
  }
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.duringRage;
    if ( !rule ) continue;
    const toggles = [...(rule.enable ?? []).map(id => [id, !raging]), ...(rule.disable ?? []).map(id => [id, true])]
      .map(([id, disabled]) => ({ effect: item.effects.get(id), disabled }))
      // L'état de la donnée (`_source`) : dnd5e 6.0.6 prépare un effet porté par une activité comme actif (voir adapter/rage.mjs).
      .filter(t => t.effect && (t.effect._source.disabled !== t.disabled));
    if ( toggles.length ) await item.updateEmbeddedDocuments("ActiveEffect", toggles.map(t => ({ _id: t.effect.id, disabled: t.disabled })));
    for ( const id of rule.post ?? [] ) {
      const source = item.effects.get(id);
      const copies = actor.effects.filter(e => source && ((e._stats?.duplicateSource === source.uuid) || (e._stats?.compendiumSource === source.uuid)));
      if ( raging && !copies.length && source ) await placeItemEffect(item, id, actor);
      if ( !raging && copies.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id));
    }
    if ( !raging && rule.copiesEnd ) {
      const copies = actor.effects.filter(e => !e.transfer && (originItemOf(e) === item)).map(e => e.id);
      if ( copies.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", copies);
    }
    if ( raging && !was ) {
      for ( const status of rule.cures ?? [] ) if ( actor.statuses?.has(status) ) await actor.toggleStatusEffect(status, { active: false });
      const start = rule.onStart ? item.system.activities?.get(rule.onStart) : null;
      if ( start ) await start.use({ [MODULE_ID]: { confirmed: true, cost: "free" } }, { configure: false }).catch(err => console.error(`${MODULE_ID} | ${item.name}`, err));
    }
    if ( toggles.length || (raging !== was) ) log(`${actor.name}: ${item.name} ${raging ? "with" : "without"} Rage`);
  }
  if ( raging !== was ) await actor.setFlag(MODULE_ID, DURING_RAGE_FLAG, raging);
}

const laterDuringRage = actor => (actor?.documentName === "Actor")
  && (actor.items.some(i => contentOf(i).entry?.duringRage) || actor.getFlag(MODULE_ID, DURING_RAGE_FLAG))
  ? enqueue(`duringRage:${actor.uuid}`, () => syncDuringRage(actor)) : null;

export function registerBarbarian() {
  // Un item retiré ou ajouté (une aptitude tenue par la Rage) : la même mise en accord.
  for ( const hook of ["createItem", "deleteItem"] ) route(hook, item => laterDuringRage(item.parent), { executor: true, label: "features held by Rage not synced" });
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => laterDuringRage((effect.parent?.documentName === "Item") ? effect.parent.parent : effect.parent),
      { executor: true, label: "features held by Rage not synced" });
  }
  route("createChatMessage", message => (["usage", "attack"].includes(message.type) ? onMessage(message) : null),
    { executor: true, label: "Rage: upkeep not recorded" });
  route("combatTurnChange", onTurnEnd, { executor: true, label: "Rage: end not evaluated" });
  route("createActiveEffect", onEffectCreated, { executor: true, label: "Rage: end on condition not evaluated" });
  route("updateActor", (actor, changed) => {
    if ( foundry.utils.getProperty(changed, "system.attributes.hp.value") === 0 ) return onZero(actor);
  }, { executor: true, label: "Relentless Rage not played" });
  route("updateToken", (token, changed) => {
    if ( foundry.utils.getProperty(changed, "delta.system.attributes.hp.value") === 0 ) return onZero(token.actor);
  }, { executor: true, label: "Relentless Rage not played (unlinked token)" });
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "Reckless Attack: prompt" });
}
