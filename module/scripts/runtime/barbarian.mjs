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
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { tokenOf, originItemOf } from "../adapter/facts.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { timedWait } from "../adapter/dialogs.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice, sleep, say, locEsc } from "./shared.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { spendItemUses } from "../adapter/uses.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { STEPS } from "../core/action.mjs";

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
  if ( token ) notice(token, loc("Rage.Retour"), "effectOff");
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
    return askBrutal(activity, token, decided, usageConfig, dialogConfig, messageConfig);
  }
  if ( recklessChoice(actor) !== null ) return askBrutal(activity, token, recklessChoice(actor), usageConfig, dialogConfig, messageConfig);   // déjà décidé à ce tour
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

/* -------------------------------------------- */
/*  Coup brutal (C12-e)                          */
/* -------------------------------------------- */

/**
 * Coup brutal (Barbare 9) : « si vous utilisez Témérité, vous pouvez renoncer à tout Avantage sur un jet d'attaque fondé sur la Force de votre
 * choix, à votre tour ; s'il touche, la cible subit 1d10 dégâts supplémentaires du type de l'arme, et vous causez un effet de Coup brutal ».
 * Une fois par tour. Coup brutal amélioré (13) ajoute deux effets ; (17) : 2d10 (l'échelle de la sous-classe), deux effets différents.
 * Les options, leur poussée ou leur effet : le contenu (`brutalStrike`), réuni sur tous les items de l'acteur.
 * Le choix pose une marque sur le barbare, liée à l'activité : l'Avantage est abandonné au jet (runtime/conditions.mjs), les dégâts
 * ajoutés par sa déclaration (content/barbarian.mjs), les effets posés à la résolution par le MJ actif, puis la marque tombe.
 */
function brutalRules(actor) {
  const options = new Map();
  let count = 0;
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.brutalStrike;
    if ( !rule ) continue;
    for ( const [name, option] of Object.entries(rule.options ?? {}) ) options.set(name, { item, ...option });
    count = Math.max(count, rule.count ?? 1);
  }
  return options.size ? { options, count } : null;
}

/** §433 : l'item et l'effet d'une option — le premier des identifiants donnés qu'un item de Coup brutal de l'acteur porte. */
function brutalEffectOf(actor, option) {
  const items = [option.item, ...Array.from(actor?.items ?? []).filter(i => (i !== option.item) && contentOf(i).entry?.brutalStrike)];
  for ( const effect of [option.effect].flat() ) {
    const item = items.find(i => i?.effects?.has?.(effect));
    if ( item ) return { item, effect };
  }
  return null;
}

/** Les choix offerts : une option, ou deux différentes (Coup brutal amélioré, niveau 17). */
function brutalChoices(names, count) {
  if ( count < 2 ) return names.map(n => [n]);
  const out = [];
  for ( let i = 0; i < names.length; i++ ) for ( let j = i + 1; j < names.length; j++ ) out.push([names[i], names[j]]);
  return out;
}

const brutalLabel = names => names.map(n => loc(`CoupBrutal.Option.${n}`)).join(" + ");

async function markBrutal(actor, activity, options) {
  const item = actor.items.find(i => contentOf(i).entry?.brutalStrike && (identifierOf(i).id === "brutal-strike")) ?? actor.items.find(i => contentOf(i).entry?.brutalStrike);
  const created = actor.createEmbeddedDocuments("ActiveEffect", [{ name: loc("CoupBrutal.Marque", { options: brutalLabel(options) }), img: item.img, origin: item.uuid,
    transfer: false, disabled: false, changes: [], flags: { [MODULE_ID]: { brutalStrike: { activity: activity.uuid, options } } } }]);
  await actor.setFlag(MODULE_ID, "brutalTurn", currentTurnKey());
  await created;
  log(`${actor.name}: Brutal Strike (${options.join(", ")}) — no Advantage on this attack`);
}

function askBrutal(activity, token, reckless, usageConfig, dialogConfig, messageConfig) {
  const actor = activity.actor;
  if ( !reckless ) return true;
  const rules = brutalRules(actor);
  if ( !rules ) return true;
  const decided = usageConfig?.[MODULE_ID]?.brutal;
  // Décidé d'avance par une intention (`brutal: ["forceful"]`) : la marque part avant le message d'utilisation (le serveur traite les
  // demandes dans l'ordre), donc avant le jet d'attaque.
  if ( Array.isArray(decided) ) {
    if ( decided.length && (actor.getFlag(MODULE_ID, "brutalTurn") !== currentTurnKey()) ) markBrutal(actor, activity, decided).catch(err => console.error(`${MODULE_ID} | Brutal Strike`, err));
    return true;
  }
  if ( (decided === false) || (decided === "marked") ) return true;   // « marked » : la marque est posée (relance après la question)
  if ( actor.getFlag(MODULE_ID, "brutalTurn") === currentTurnKey() ) return true;   // une fois par tour
  const choices = brutalChoices([...rules.options.keys()], rules.count);
  const targets = Array.from(game.user.targets);
  timedWait({
    window: { title: loc("CoupBrutal.Titre", { name: actor.name }) },
    content: `<p>${loc("CoupBrutal.Question")}</p>`,
    buttons: [
      ...choices.map((names, i) => ({ action: `b${i}`, label: brutalLabel(names) })),
      { action: "no", label: loc("CoupBrutal.Non"), default: true }
    ]
  }, { fallback: "no" }).then(async choice => {
    const picked = (choice && (choice !== "no")) ? (choices[Number(choice.slice(1))] ?? []) : [];
    if ( picked.length ) await markBrutal(actor, activity, picked);
    if ( !game.user.targets.size ) for ( const t of targets ) t.setTarget(true, { releaseOthers: false });
    const config = { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), reckless, brutal: picked.length ? "marked" : false } };
    activity.use(config, dialogConfig, messageConfig);
  }).catch(err => console.error(`${MODULE_ID} | Brutal Strike`, err));
  return false;
}

/** MJ actif : l'attaque marquée est résolue — sur un coup, les effets choisis ; puis la marque tombe. */
async function onBrutalResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack ) return;
  const from = fromUuidSync(resolution.source ?? "", { strict: false });
  const actor = (from?.documentName === "Actor") ? from : (from?.actor ?? null);
  const marker = actor?.effects?.find(e => e.getFlag(MODULE_ID, "brutalStrike")?.activity === resolution.activity);
  if ( !marker ) return;
  const { options } = marker.getFlag(MODULE_ID, "brutalStrike");
  const rules = brutalRules(actor);
  const source = tokenOf(actor);
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit ) continue;
    const target = fromUuidSync(t.token, { strict: false });
    if ( !target?.actor ) continue;
    for ( const name of options ) {
      const option = rules?.options.get(name);
      if ( !option ) continue;
      if ( option.push && source ) {
        const { cells } = await pushAway(source, target, option.push, readUnitFactors());
        log(`Brutal Strike, ${name}: ${target.name} pushed ${cells} square(s)`);
      }
      if ( option.effect ) {
        // §433 : l'effet de l'option est sur l'item qui la déclare (Coup brutal amélioré) ou, dans le SRD de dnd5e 6.1, sur Coup brutal.
        const from = brutalEffectOf(actor, option);
        const placed = from ? await placeItemEffect(from.item, from.effect, target.actor) : null;
        log(placed ? `Brutal Strike, ${name}: effect placed on ${target.name}` : `Brutal Strike, ${name}: no effect of this option on ${actor.name}'s items`);
      }
      notice(target, loc(`CoupBrutal.Option.${name}`), "loss");
    }
  }
  await marker.delete();
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
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`brutal:${resolution?.id}`, () => onBrutalResolution(resolution)), { executor: true, label: "Brutal Strike: effects not applied" });
}
