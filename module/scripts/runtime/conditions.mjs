import { MODULE_ID } from "../constants.mjs";
import { attackModifiers, combineTargets } from "../core/conditions.mjs";
import { attackContext, registerTurnStatuses, setStatus, TURN_STATUSES, frightenedSourceSeen } from "../adapter/conditions.mjs";
import { tokenOf } from "../adapter/vision.mjs";
import { declaredAttackBonuses } from "../adapter/triggers.mjs";
import { readBudget, usageTokenOf as usageToken } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { route } from "./router.mjs";
import { takeAttackMods } from "./reactions.mjs";
import { foretoldRange } from "../core/portent.mjs";
import { log } from "./shared.mjs";

/**
 * Avant le dialogue du jet d'attaque, sur le client de l'attaquant : les états des deux créatures
 * et la situation (portée longue, tir au corps à corps) posent l'avantage ou le désavantage par
 * défaut. Le joueur voit ce choix dans le dialogue et peut le changer ; les raisons partent avec
 * le message pour être affichées sous le jet.
 */
function onPreRollAttack(config, dialogConfig, messageConfig) {
  const activity = config.subject;
  const roll = config.rolls?.[0];
  if ( !activity?.item || !roll || !canvas.ready ) return true;
  const origin = usageToken(activity);
  const targets = Array.from(game.user.targets).map(t => t.document).filter(t => t !== origin);
  if ( !origin || !targets.length ) return true;

  const factors = readUnitFactors();
  const attackMode = config.attackMode ?? roll.options?.attackMode ?? null;
  const contexts = targets.map(t => attackContext(origin, t, activity, attackMode, factors));
  for ( const [i, c] of contexts.entries() ) {
    if ( c.vision ) log(`vision : ${origin.name} ${c.vision.attackerSees ? "voit" : "ne voit pas"} ${targets[i].name}, qui ${c.vision.targetSees ? "le voit" : "ne le voit pas"}`);
  }
  const perTarget = contexts.map(attackModifiers);
  // §34 : ce que les réactions d'avant le jet ont décidé (Esquive des ombres, Éclat protecteur : Désavantage ; dé retiré).
  const reacted = takeAttackMods(activity.uuid);
  if ( reacted?.disadvantage ) for ( const p of perTarget ) p.disadvantage = [...p.disadvantage, { who: "reaction", key: reacted.names.join(", ") }];
  if ( reacted?.penalty ) {
    roll.parts ??= [];
    roll.parts.push(`-${reacted.penalty}`);
    log(`attaque : -${reacted.penalty} (${reacted.names.join(", ")})`);
  }
  // §36 : Présage — le d20 vaut le jet noté (bornes du dé : core/portent.mjs, adapter/portent.mjs).
  if ( Number.isInteger(reacted?.foretold) ) {
    roll.options ??= {};
    Object.assign(roll.options, foretoldRange(reacted.foretold));
    log(`attaque : Présage, d20 = ${reacted.foretold}`);
    foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.foretold`, reacted.foretold);
  }
  // §36 : dé ajouté par un allié (Présage cosmique, Fortune).
  if ( reacted?.bonus ) {
    roll.parts ??= [];
    roll.parts.push(`${reacted.bonus}`);
    log(`attaque : +${reacted.bonus} (${reacted.names.join(", ")})`);
  }
  const { mode, agreed } = combineTargets(perTarget);
  const reasons = {
    agreed,
    advantage: agreed ? perTarget[0].advantage : [],
    disadvantage: agreed ? perTarget[0].disadvantage : []
  };
  if ( !agreed ) ui.notifications.warn("DND5ECOMBAT.CiblesDivergentes", { localize: true });
  else if ( reasons.advantage.length || reasons.disadvantage.length ) {
    roll.options ??= {};
    // On ajoute nos sources à celles du système ; il les combine lui-même (les deux = jet normal).
    if ( reasons.advantage.length ) roll.options.advantage = true;
    if ( reasons.disadvantage.length ) roll.options.disadvantage = true;
    log(`attaque : ${mode === 1 ? "avantage" : mode === -1 ? "désavantage" : "avantage et désavantage s'annulent"}`,
      [...reasons.advantage, ...reasons.disadvantage].map(r => `${r.who}.${r.key}`).join(", "));
  }
  if ( !agreed || reasons.advantage.length || reasons.disadvantage.length ) {
    foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.modifiers`, reasons);
  }
  // §16.46 : ce que les déclarations ajoutent au jet (Voile défensif : « -1d4 »), pour la première cible.
  const bonuses = declaredAttackBonuses(origin, targets[0], activity);
  if ( bonuses.length ) {
    roll.parts ??= [];
    for ( const b of bonuses ) roll.parts.push(b.formula);
    log(`attaque : ${bonuses.map(b => `${b.formula} (${b.name})`).join(", ")}`);
    foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.bonuses`, bonuses);
  }
  return true;
}

/**
 * §17.3 : Effrayé (2024) — désavantage aux tests de caractéristique (compétences, outils, initiative : le crochet
 * `abilityCheck` de dnd5e, documents/actor/actor.mjs:1403 et :1913) tant que la source de la peur est en vue.
 * dnd5e ne le fait pas (`CONFIG.DND5E.conditionEffects` : rien pour `frightened`). Source inconnue : l'état s'applique.
 */
function onPreRollAbilityCheck(config) {
  const actor = config.subject;
  const roll = config.rolls?.[0];
  if ( !actor?.statuses?.has("frightened") || !roll ) return true;
  if ( frightenedSourceSeen(tokenOf(actor)) === false ) return true;
  roll.options ??= {};
  roll.options.disadvantage = true;
  log(`${actor.name} : Effrayé → désavantage au test de caractéristique`);
  return true;
}

/* -------------------------------------------- */
/*  États de tour visibles sur le token         */
/* -------------------------------------------- */

/** Ce que le budget d'un combattant doit montrer sur son token. `dodging` est l'état natif du système. */
function wantedStatuses(budget) {
  return {
    [TURN_STATUSES.reactionUsed.id]: !!budget && (budget.reaction < 1),
    [TURN_STATUSES.dashing.id]: !!budget?.dashed,
    [TURN_STATUSES.disengaged.id]: !!budget?.disengaged,
    [TURN_STATUSES.readied.id]: !!budget?.readied,
    dodging: !!budget?.dodging
  };
}

async function syncTurnStatuses(combatant, budget) {
  for ( const [id, active] of Object.entries(wantedStatuses(budget)) ) await setStatus(combatant.actor, id, active);
}

/* -------------------------------------------- */

export function registerConditions() {
  registerTurnStatuses();
  route("dnd5e.preRollAttackV2", onPreRollAttack, { cancellable: true, label: "avantage et désavantage des états" });
  route("dnd5e.preRollAbilityCheckV2", onPreRollAbilityCheck, { label: "Effrayé : désavantage aux tests" });

  const statuses = { executor: true, label: "états de tour non synchronisés" };
  route("updateCombatant", (combatant, changes) => {
    if ( !changes.flags?.[MODULE_ID] ) return;
    return syncTurnStatuses(combatant, combatant.combat?.started ? readBudget(combatant) : null);
  }, statuses);
  // Fin du combat, ou combattant retiré : plus rien à montrer.
  route("deleteCombat", combat => Promise.all(combat.combatants.map(c => syncTurnStatuses(c, null))), statuses);
  route("deleteCombatant", combatant => syncTurnStatuses(combatant, null), statuses);
}

