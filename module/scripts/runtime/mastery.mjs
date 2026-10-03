/**
 * Bottes d'arme (SPEC §21). dnd5e 6 note la botte employée sur le message d'attaque ; le moteur en tire les conséquences.
 *
 *  - Sur le MJ actif, une fois l'attaque tranchée et ses dégâts appliqués (`dnd5e-combat.resolution`) : Écorchure (dégâts égaux
 *    au modificateur, sur un raté), Poussée (3 m, au choix de l'attaquant), Renversement (sauvegarde de Constitution, À terre sur
 *    un échec — lancée par le MJ), et les marques Sape, Ouverture, Ralentissement (effets du moteur, adapter/mastery.mjs).
 *  - Les marques donnent leur Avantage / Désavantage au jet (adapter/triggers.mjs, `declaredAttackModifiers`), tombent au jet
 *    qu'elles concernent (message d'attaque), ou à leur heure : Sape et Ralentissement au début du prochain tour de l'attaquant,
 *    Ouverture à la fin de son prochain tour.
 *  - Enchaînement : la visée de la seconde attaque s'ouvre chez l'auteur (ui/pointer.mjs, sans coût : `cost: "free"`, drapeau
 *    `cleave`) ; ses dégâts se lancent sans le modificateur positif ; une fois par tour de combat.
 *  - Coup double : budget du tour (core/turn.mjs).
 * Limite : l'annulation d'une attaque ne défait pas ce que la botte a fait.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { masteryEffect, grazeDamage, toppleDC, cleaveModifier, markExpires } from "../core/mastery.mjs";
import { masteryOf, attackModOf, marksOn, markData, markModifiers } from "../adapter/mastery.mjs";
import { currentTurnKey } from "../adapter/turn.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { conditionImmunitiesOf } from "../adapter/facts.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

/** La clé du tour de combat en cours (« combat.round.tour »), ou null hors combat. */
const turnKey = () => currentTurnKey();

/** Le token qui parle dans un message, ou null. */
function speakerToken(message) {
  const { scene, token } = message?.speaker ?? {};
  return game.scenes.get(scene)?.tokens.get(token) ?? null;
}

/** Propriétés physiques de l'arme que garde une part de dégâts (magique, argentée, adamantine). */
const physical = weapon => Array.from(weapon?.system?.properties ?? []).filter(p => CONFIG.DND5E.itemProperties[p]?.isPhysical);

/* -------------------------------------------- */
/*  Après l'attaque                             */
/* -------------------------------------------- */

const seen = new Set();

/** Une seule file pour tout ce qui pose ou retire une marque : deux retraits du même effet feraient une erreur du cœur. */
const MARKS = "mastery:marks";

async function mark(kind, source, target, weapon) {
  const onSource = ["vex", "studied"].includes(kind);
  const bearer = onSource ? source : target;
  // Ralentissement : « la réduction ne dépasse pas 3 m » — une seule marque ; Ouverture, Attaques avisées : une par cible.
  const old = marksOn(bearer.actor, kind).filter(e => !onSource || (e.getFlag(MODULE_ID, "mastery").target === target.uuid));
  // Une ancienne marque peut tomber en même temps (consommée par ce jet d'attaque : runtime ci-dessous) — on n'y tient pas.
  const ids = old.map(e => e.id).filter(id => bearer.actor.effects.has(id));
  if ( ids.length ) await bearer.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  await bearer.actor.createEmbeddedDocuments("ActiveEffect", [markData(kind, { source, target, weapon, turnKey: turnKey() })]);
  notice(bearer, loc(`Botte.Retour.${kind}`), onSource ? "gain" : "ended");
  log(`botte ${kind} : ${bearer.name} marqué (${weapon?.name})`);
}

async function graze(attackMessage, source, target, weapon) {
  const n = grazeDamage(attackModOf(attackMessage));
  if ( !n ) return log(`Écorchure : modificateur nul, rien contre ${target.name}`);
  const type = Array.from(weapon?.system?.damage?.base?.types ?? [])[0] ?? "bludgeoning";
  const logged = await inflict({
    step: { formula: String(n), damageType: type }, item: weapon, targetUuid: target.uuid, properties: physical(weapon),
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: loc("Botte.Carte.graze", { weapon: weapon?.name ?? "", name: target.name }),
    flags: { mastery: { kind: "graze", target: target.uuid, amount: n } }
  });
  log(`Écorchure : ${target.name} subit ${n} ${type}${logged ? ` (PV ${logged.before?.value} → ${logged.after?.value})` : ""}`);
}

async function push(source, target, weapon) {
  const answer = await askChoice(source.actor, {
    actor: source.actor.uuid, item: weapon?.name ?? "",
    prompt: loc("Botte.Poussee.Question", { name: target.name }),
    options: [{ id: "push", label: loc("Botte.Poussee.Oui") }, { id: "none", label: loc("Botte.Poussee.Non") }]
  });
  if ( answer?.id !== "push" ) return log(`Poussée : ${source.name} ne repousse pas ${target.name}`);
  const { cells, wanted } = await pushAway(source, target, { distance: 10, units: "ft" }, readUnitFactors());
  log(`Poussée : ${target.name} repoussé de ${cells} case(s) sur ${wanted}`);
}

async function topple(attackMessage, source, target, weapon) {
  const dc = toppleDC(attackModOf(attackMessage), source.actor?.system?.attributes?.prof);
  const rolls = await target.actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false },
    { data: { flavor: loc("Botte.Carte.topple", { weapon: weapon?.name ?? "", name: target.name, dc }),
      flags: { [MODULE_ID]: { mastery: { kind: "topple", target: target.uuid, dc } } } } });
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return;
  const saved = total >= dc;
  log(`Renversement : ${target.name} ${saved ? "réussit" : "rate"} sa sauvegarde de Constitution (${total} contre DD ${dc})`);
  if ( saved || target.actor.statuses.has("prone") || conditionImmunitiesOf(target.actor).includes("prone") ) return;
  await target.actor.toggleStatusEffect("prone", { active: true });
}

/** §21 : Attaques avisées — chaque créature ratée par ce jet est marquée : l'Avantage au prochain jet contre elle. */
async function studied(resolution, source, item) {
  if ( !source?.actor?.items.some(i => contentOf(i).entry?.studiedAttacks === true) ) return;
  for ( const t of resolution.targets ?? [] ) {
    if ( t.hit !== false ) continue;
    const target = fromUuidSync(t.token, { strict: false });
    if ( target?.actor ) await mark("studied", source, target, item);
  }
}

async function onResolution(resolution) {
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const attackMessage = game.messages.get(resolution.attack?.messageId ?? "");
  if ( !attackMessage ) return;
  seen.add(resolution.id);
  const source = speakerToken(attackMessage);
  const activity = fromUuidSync(resolution.activity, { strict: false });
  const weapon = activity?.item ?? null;
  if ( !source?.actor || !weapon ) return;
  await studied(resolution, source, weapon);
  const mastery = masteryOf(attackMessage);
  if ( !mastery ) return;
  const mode = attackMessage.rolls?.[0]?.options?.attackMode ?? attackMessage.system?.mode ?? "";
  const melee = (activity.attack?.type?.value === "melee") && !mode.includes("thrown") && (mode !== "ranged");
  for ( const t of resolution.targets ?? [] ) {
    if ( (t.hit !== true) && (t.hit !== false) ) continue;
    const target = fromUuidSync(t.token, { strict: false });
    if ( !target?.actor ) continue;
    const effect = masteryEffect(mastery, {
      hit: t.hit, damaged: (t.damage?.applied ?? 0) > 0, melee, size: target.actor.system.traits?.size ?? null,
      down: (target.actor.system.attributes?.hp?.value ?? 1) <= 0, cleaveSpent: true   // Enchaînement : chez l'auteur (ui/pointer.mjs)
    });
    if ( !effect ) continue;
    if ( effect === "graze" ) await graze(attackMessage, source, target, weapon);
    else if ( effect === "push" ) await push(source, target, weapon);
    else if ( effect === "topple" ) await topple(attackMessage, source, target, weapon);
    else await mark(effect, source, target, weapon);
  }
}

/* -------------------------------------------- */
/*  Les marques : consommées au jet, retirées à leur heure  */
/* -------------------------------------------- */

async function onAttackRolled(message) {
  const source = speakerToken(message);
  if ( !source?.actor ) return;
  const removed = new Set();
  for ( const t of message.system?.targets ?? [] ) {
    const target = fromUuidSync(t.token, { strict: false });
    for ( const effect of markModifiers(source, target).consumed ) {
      if ( removed.has(effect.uuid) ) continue;
      removed.add(effect.uuid);
      const actor = effect.parent;
      if ( !actor?.effects?.has(effect.id) ) continue;   // déjà retirée (reposée par la botte d'un coup précédent)
      await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
      log(`botte : « ${effect.name} » consommée par le jet de ${source.name}`);
    }
  }
}

/** Les acteurs de la scène du combat (tokens non liés compris), une fois chacun. */
function actorsOf(combat) {
  const scene = combat?.scene ?? canvas.scene;
  return [...new Set((scene?.tokens ?? []).map(t => t.actor).filter(Boolean))];
}

async function expire(combat, combatantId, moment, key) {
  if ( !combatantId ) return;
  for ( const actor of actorsOf(combat) ) {
    const gone = marksOn(actor).filter(e => {
      const m = e.getFlag(MODULE_ID, "mastery");
      return markExpires(m.kind, { moment, sourceTurn: m.combatant === combatantId, turnKey: key, placedOn: m.placedOn });
    });
    if ( !gone.length ) continue;
    const ids = gone.map(e => e.id).filter(id => actor.effects.has(id));
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`botte : ${gone.map(e => e.name).join(", ")} ${moment === "turnStart" ? "au début" : "à la fin"} du tour`);
  }
}

function onTurnChange(combat, prior, current) {
  // `prior` : le tour qui s'achève (sa clé : combat, round, tour d'alors) ; `current` : celui qui commence.
  const priorKey = prior ? `${combat.id}.${prior.round}.${prior.turn}` : null;
  return enqueue(MARKS, async () => {
    await expire(combat, prior?.combatantId, "turnEnd", priorKey);
    await expire(combat, current?.combatantId, "turnStart", null);
  });
}

/* -------------------------------------------- */
/*  Enchaînement                                */
/* -------------------------------------------- */

/** Sur le client de l'auteur : la seconde attaque d'Enchaînement se lance sans le modificateur de caractéristique positif. */
function onPreRollDamage(config, dialog, message) {
  const origin = foundry.utils.getProperty(message ?? {}, "data.system.origin");
  if ( !origin || !game.messages.get(origin)?.getFlag(MODULE_ID, "cleave") ) return true;
  for ( const roll of config.rolls ?? [] ) {
    if ( !roll.base || !roll.data || !((roll.data.mod ?? 0) > 0) ) continue;
    roll.data = { ...roll.data, mod: cleaveModifier(roll.data.mod) };
  }
  log("Enchaînement : dégâts sans le modificateur de caractéristique");
  return true;
}

/** La seconde attaque d'Enchaînement est faite : « une fois par tour ». */
async function onCleaveUsed(message) {
  const actor = message.getAssociatedActor?.();
  const key = turnKey();
  if ( actor && key ) await actor.setFlag(MODULE_ID, "cleaveTurn", key);
}

export function registerMastery() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(MARKS, () => onResolution(resolution)),
    { executor: true, label: "botte d'arme non jouée" });
  route("createChatMessage", message => {
    if ( message.type === "attack" ) return enqueue(MARKS, () => onAttackRolled(message));
    if ( (message.type === "usage") && message.getFlag(MODULE_ID, "cleave") ) return onCleaveUsed(message);
  }, { executor: true, label: "botte d'arme : marque non consommée" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "botte d'arme : marque non retirée" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "Enchaînement : modificateur" });
}
