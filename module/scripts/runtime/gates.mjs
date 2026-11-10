/**
 * Portes (SPEC §16, B5 bis) : une utilisation est SUSPENDUE avant d'avoir lieu, quelqu'un répond, puis elle
 * reprend ou tombe. Même mécanique que la légalité (runtime/turn.mjs) : `dnd5e.preUseActivity` est synchrone,
 * on annule, on attend, on relance la même utilisation marquée `gated`. Sur le client de celui qui agit.
 *
 *  - `isAttacked` (Sanctuaire) : la cible porte un effet dont l'item déclare `{ type: "ward" }` — l'attaquant
 *    doit réussir la sauvegarde de l'activité sœur (Sagesse, DD du lanceur) ou perd son attaque / son sort
 *    nuisible. Il choisit une autre cible ou renonce : l'utilisation est annulée, il recommence s'il veut.
 *  - `castsSpell` (Contresort) : chaque créature hostile, à portée de sa réaction et qui voit le lanceur, est
 *    consultée (fenêtre de réaction, adapter/reactions.mjs) ; sa réaction vise le lanceur et suit son cours
 *    (sauvegarde de Constitution résolue par le moteur) ; ratée, le sort se dissipe — rien n'est lancé, rien
 *    n'est dépensé (règle 2024 : l'emplacement n'est pas perdu, l'action l'est — non comptée ici, limite).
 *    §66 : une réaction qui déclare `counter` (contresort à la manière de 2014) ne demande pas de sauvegarde : le sort, au niveau
 *    où il va être lancé, échoue d'office jusqu'au niveau du contresort, sinon sur un test de celui qui contre (DD 10 + niveau),
 *    fait chez lui (adapter/reactions.mjs) ; la porte lit sa réponse.
 *  - §283 : `spellFailure` (Lenteur) — avant même le Contresort, un sort lancé par le porteur d'un effet qui le gêne (composante
 *    somatique) échoue sur un d100 ≤ la chance : rien n'est lancé ni dépensé, comme un sort contré (même limite : l'action n'est pas
 *    comptée). Le jet est montré dans le chat, attendu (Dice So Nice), l'échec vu et entendu de toute la table.
 */

import { MODULE_ID } from "../constants.mjs";
import { stepsOf } from "../core/triggers.mjs";
import { rangeIssue } from "../core/range.mjs";
import { usageTokenOf as usageToken, distanceBetween, rangeOf, currentTurnKey } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { reactionOptions, askReaction, setReactionSpellGate } from "../adapter/reactions.mjs";
import { spellCommandOf } from "../adapter/pilot.mjs";
import { matching } from "./triggers.mjs";
import { attackReactors, askAttackReactions, rememberAttackMods } from "./reactions.mjs";
import { keepPendingAttack } from "./actions.mjs";
import { seersOf, foretellFor } from "../adapter/portent.mjs";
import { route } from "./router.mjs";
import { log, loc, say, locEsc, notice, waitForDice } from "./shared.mjs";
import { isSpellCast, scrollReadingFor, scrollActivityOf } from "../adapter/scrolls.mjs";
import { castLevelFor } from "../adapter/counter.mjs";
import { absorbPlan } from "../core/counter.mjs";
import { wasteUse } from "./turn.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { settledResolution } from "../adapter/messages.mjs";
import { identifierOf, contentOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { failureFor, spellFailed } from "../core/spell-failure.mjs";
import { attractorOf } from "../core/defenses.mjs";
import { rangedDefensesOf } from "../adapter/defenses.mjs";
import { isRangedWeaponAttack } from "../adapter/cover.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";


/** Une carte de chat qui dit ce que la porte a décidé (lue par les scénarios : flag `gate`) ; `details` : lignes de plus. */
function tell(actor, key, data, gate, details=[]) {
  return say({ actor }, [locEsc(key, data), ...details], { gate });
}

/** Un sort qui « nuit » : attaque, ou activité qui inflige des dégâts. */
const isHarmful = activity => (activity.type === "attack") || ((activity.damage?.parts?.length ?? 0) > 0);

/* -------------------------------------------- */
/*  Sanctuaire : sauvegarde de l'attaquant       */
/* -------------------------------------------- */

/** Les protections (`ward`) que les cibles désignées opposent à cette utilisation. */
function wardsAgainst(activity, origin, targets) {
  if ( !isHarmful(activity) ) return [];
  const out = [];
  for ( const token of targets ) {
    const target = token.actor;
    if ( !target ) continue;
    for ( const d of matching("isAttacked", { actor: target, target, source: origin.actor, activity, sourceToken: origin, targetToken: token }) ) {
      for ( const step of stepsOf(d, "ward") ) out.push({ declaration: d, step, token });
    }
  }
  return out;
}

/** L'attaquant fait la sauvegarde de chaque protection ; false dès qu'il en rate une. */
async function passWards(activity, origin, wards) {
  for ( const { declaration, step, token } of wards ) {
    // §298 (repasse C3) : Sanctuaire — « la créature doit choisir une nouvelle cible ou perdre l'attaque ou le sort ». Ratée contre cette
    // cible, une nouvelle tentative contre elle dans le même tour est perdue d'office (l'action avec), sans nouvelle sauvegarde. En combat
    // seulement : hors combat, il n'y a pas de tour qui remette la marque à zéro.
    const mark = game.combat?.started ? `${token.uuid}|${currentTurnKey()}` : null;
    if ( mark && (origin.actor.getFlag(MODULE_ID, "wardFailed") === mark) ) {
      await tell(origin.actor, "PorteAttaquePerdue", { name: origin.name, target: token.name, item: declaration.name },
        { kind: "ward", item: declaration.identifier, attacker: origin.uuid, target: token.uuid, passed: false, again: true });
      await wasteUse(activity);
      return false;
    }
    const item = await fromUuid(declaration.item ?? "");
    const save = (step.activity ? item?.system.activities?.get(step.activity) : null)
      ?? item?.system.activities?.find(a => a.type === "save") ?? null;
    const ability = save?.save?.ability?.first?.() ?? Array.from(save?.save?.ability ?? [])[0];
    const dc = save?.save?.dc?.value;
    if ( !save || !ability || !Number.isFinite(dc) ) { log(`${declaration.name}: ward without a readable saving throw, ignored`); continue; }
    const rolls = await origin.actor.rollSavingThrow({ ability, target: dc }, { configure: false });
    const total = rolls?.[0]?.total ?? null;
    const success = (total !== null) && (total >= dc);
    log(`${declaration.name}: ${origin.name} attacks ${token.name}, ${ability} saving throw ${total} vs DC ${dc}: ${success ? "succeeded" : "failed"}`);
    if ( !success ) {
      if ( mark ) await origin.actor.setFlag(MODULE_ID, "wardFailed", mark);
      await tell(origin.actor, "PorteAttaquePerdue", { name: origin.name, target: token.name, item: declaration.name },
        { kind: "ward", item: declaration.identifier, attacker: origin.uuid, target: token.uuid, total, dc, passed: false });
      return false;
    }
    await tell(origin.actor, "PorteAttaqueTenue", { name: origin.name, target: token.name, item: declaration.name },
      { kind: "ward", item: declaration.identifier, attacker: origin.uuid, target: token.uuid, total, dc, passed: true });
  }
  return true;
}

/* -------------------------------------------- */
/*  Contresort : fenêtre de réaction des hostiles */
/* -------------------------------------------- */

/**
 * §157 : les créatures visées par une utilisation sans jet d'attaque, hostiles à l'utilisateur, qui ont une réaction `isTargeted`
 * pour elle (Bouclier contre Projectile magique), avec leurs options.
 */
function targetedCandidates(activity, origin, targets, { isSpell=false, castLevel=0 }={}) {
  const out = [];
  for ( const token of targets ) {
    if ( !token.actor || !areEnemies(token, origin) ) continue;
    if ( token.actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) continue;
    const actor = token.actor;
    const options = reactionOptions(actor, "isTargeted",
      matching("isTargeted", { actor, target: actor, source: origin.actor, activity, sourceToken: origin, targetToken: token }))
      .flatMap(o => o.cancel ? absorbOption(o, activity, targets, { isSpell, castLevel }) : (activity.type === "attack") ? [] : [o]);
    if ( options.length ) out.push({ token, actor, options });
  }
  return out;
}

/**
 * §344 : une réaction qui annule le sort (Sceptre d'absorption, Bâton du thaumaturge) — seulement contre un sort de niveau 1 ou plus qui
 * ne vise que le porteur, sans zone ; son activité est jouée au niveau du sort (le Sceptre dépense autant de niveaux, le Bâton gagne
 * autant de charges).
 */
function absorbOption(option, activity, targets, { isSpell, castLevel }) {
  if ( !isSpell ) return [];
  const reaction = fromUuidSync(option.activity ?? "", { strict: false });
  // « Tant que vous tenez » : le Bâton est une arme, que la garde « porté » (adapter/triggers.mjs) laisse passer — tenu et harmonisé.
  const item = reaction?.item;
  if ( !item || (item.system?.equipped === false) || ((item.system?.attunement === "required") && (item.system?.attuned !== true)) ) return [];
  const use = reaction?.consumption?.targets?.find(t => t.type === "itemUses");
  const costs = Number(use?.value) > 0;
  const plan = absorbPlan({ castLevel, targets: targets.length, area: !!activity.target?.template?.type, costs,
    usesLeft: reaction?.item?.system?.uses?.value ?? null });
  return plan ? [{ ...option, usage: { ...(option.usage ?? {}), scaling: plan.scaling } }] : [];
}

/**
 * §157 : chaque créature visée réagit, l'une après l'autre ; la réaction est résolue avant l'utilisation (son effet compte déjà).
 * §344 : false si une réaction a annulé le sort (absorbé).
 */
async function passTargeted(activity, origin, candidates, { auto }) {
  for ( const { token, actor, options } of candidates ) {
    log(`${origin.name} uses ${activity.item.name} on ${token.name}: ${token.name} can react (${options.map(o => o.name).join(", ")})`);
    const answer = await askReaction(actor, {
      actor: actor.uuid, options, target: origin.uuid, auto,
      prompt: { key: "ReactionCible", data: { caster: origin.name, spell: activity.item.name } }
    });
    if ( answer?.message ) await settledResolution(answer.message);
    if ( answer?.cancel ) {
      log(`${token.name} absorbs ${origin.name}'s ${activity.item.name} (${answer.name}): the spell is canceled`);
      notice(token, { key: "Retour.SortAbsorbe", data: { spell: activity.item.name, item: answer.name ?? "" } }, "refused",
        { all: true, action: "spellAbsorbed", outcome: "failure" });
      return false;
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  §283 : échec d'un sort (Lenteur)             */
/* -------------------------------------------- */

/** La règle d'échec que les effets du lanceur opposent à ce sort, ou null. */
function failureAgainst(activity, actor) {
  const rules = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    const rule = item ? contentOf(item).entry?.spellFailure : null;
    if ( rule ) rules.push({ ...rule, name: item.name });
  }
  return rules.length ? failureFor(rules, activity.item.system?.properties) : null;
}

/** Le d100 de l'échec, montré et attendu ; true si le sort passe. */
async function passFailure(activity, origin, rule) {
  const roll = await new Roll("1d100").evaluate();
  const message = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ token: origin }),
    flavor: loc("PorteEchecJet", { item: rule.name, chance: rule.chance, spell: activity.item.name })
  });
  await waitForDice(message);
  const failed = spellFailed(rule.chance, roll.total);
  log(`${origin.name} casts ${activity.item.name} under ${rule.name}: d100 ${roll.total} vs ${rule.chance}% -> ${failed ? "the spell fails" : "the spell goes through"}`);
  await tell(origin.actor, failed ? "PorteSortRate" : "PorteSortPasse", { name: origin.name, spell: activity.item.name, item: rule.name, roll: roll.total, chance: rule.chance },
    { kind: "spellFailure", spell: identifierOf(activity.item).id, caster: origin.uuid, roll: roll.total, chance: rule.chance, failed });
  if ( failed ) notice(origin, { key: "Retour.SortRate", data: { spell: activity.item.name } }, "refused", { all: true, action: "spellFails", outcome: "failure" });
  return !failed;
}

/** Qui peut réagir au lancement de ce sort, avec quoi. */
function counterCandidates(activity, origin) {
  const out = [];
  const factors = readUnitFactors();
  for ( const token of origin.parent?.tokens ?? [] ) {
    if ( (token === origin) || !token.actor || token.hidden || !areEnemies(token, origin) ) continue;
    if ( token.actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) continue;
    const actor = token.actor;
    const options = reactionOptions(actor, "castsSpell",
      matching("castsSpell", { actor, target: actor, source: origin.actor, activity, sourceToken: origin, targetToken: token }));
    // À portée de SA réaction (60 ft pour Contresort), mesurée en 3D.
    const inRange = options.filter(o => {
      const reaction = fromUuidSync(o.activity, { strict: false });
      return !reaction || (rangeIssue(distanceBetween(token, origin), rangeOf(reaction), factors) === null);
    });
    if ( inRange.length ) out.push({ token, actor, options: inRange });
  }
  return out;
}

/**
 * Les candidats sont consultés l'un après l'autre ; true si le sort passe, false s'il est dissipé. `castLevel` : le niveau
 * auquel le sort va être lancé (§66, contresort à la manière de 2014).
 */
async function passCounters(activity, origin, candidates, { auto, castLevel }) {
  for ( const { token, actor, options } of candidates ) {
    log(`${origin.name} casts ${activity.item.name}: ${token.name} can react (${options.map(o => o.name).join(", ")})`);
    const answer = await askReaction(actor, {
      actor: actor.uuid, options, target: origin.uuid, auto, castLevel,
      prompt: { key: "ReactionSort", data: { caster: origin.name, spell: activity.item.name } }
    });
    if ( !answer?.message ) continue;
    // §66 : contresort à la manière de 2014 — pas de sauvegarde à attendre, celui qui contre a tranché chez lui.
    if ( answer.counter ) {
      const c = answer.counter;
      const failed = c.dissipated === true;
      log(`${token.name} reacts (${answer.name}): ${activity.item.name} at level ${c.castLevel}, countered at level ${c.level} — `
        + `${c.auto ? "no roll" : `check ${c.total ?? "?"} vs DC ${c.dc}`} -> ${failed ? "spell countered" : "the spell goes through"}`);
      const details = [c.auto
        ? loc("PorteContreAuto", { spell: activity.item.name, castLevel: c.castLevel, item: answer.name, level: c.level })
        : loc("PorteContreTest", { reactor: token.name, total: c.total ?? "—", dc: c.dc, spell: activity.item.name, castLevel: c.castLevel })];
      await tell(origin.actor, failed ? "PorteSortDissipe" : "PorteSortTenu", { name: origin.name, spell: activity.item.name, reactor: token.name, item: answer.name },
        { kind: "counterspell", spell: identifierOf(activity.item).id, caster: origin.uuid, reactor: token.uuid, message: answer.message, dissipated: failed,
          counter: { castLevel: c.castLevel, level: c.level, auto: c.auto, dc: c.dc, total: c.total ?? null } }, details);
      if ( failed ) return false;
      continue;
    }
    const resolution = await settledResolution(answer.message);
    const target = resolution?.targets.find(t => t.token === origin.uuid) ?? resolution?.targets[0] ?? null;
    const failed = target?.save?.success === false;
    log(`${token.name} reacts (${answer.name}): saving throw ${target?.save?.total ?? "?"} -> ${failed ? "spell countered" : "the spell goes through"}`);
    await tell(origin.actor, failed ? "PorteSortDissipe" : "PorteSortTenu", { name: origin.name, spell: activity.item.name, reactor: token.name, item: answer.name },
      { kind: "counterspell", spell: identifierOf(activity.item).id, caster: origin.uuid, reactor: token.uuid, message: answer.message, dissipated: failed });
    if ( failed ) return false;
  }
  return true;
}

/* -------------------------------------------- */

/* -------------------------------------------- */
/*  O8g (§350) : lire un parchemin de sort       */
/* -------------------------------------------- */

/**
 * Un parchemin d'un niveau que le lecteur ne peut pas encore lancer : le test (DD 10 + niveau) de sa caractéristique d'incantation, ou
 * d'Intelligence (Arcanes) par Utilisation d'objets magiques ; raté, le sort disparaît du parchemin — l'action est perdue, le
 * parchemin aussi. Rend vrai si le sort part.
 */
async function passScrollCheck(activity, origin, reading) {
  const actor = origin.actor;
  const rolls = reading.skill
    ? await actor.rollSkill({ skill: reading.skill, ability: reading.ability, target: reading.dc }, { configure: false })
    : await actor.rollAbilityCheck({ ability: reading.ability, target: reading.dc }, { configure: false });
  const total = rolls?.[0]?.total ?? null;
  // Le verdict attend l'animation de Dice So Nice (règle DAS) : le message du test est le dernier de ce lecteur portant ce total.
  const card = (total === null) ? null : game.messages.contents.findLast(m => (m.speaker?.actor === actor.id) && (m.rolls?.[0]?.total === total));
  if ( card ) await waitForDice(card);
  const ok = (total !== null) && (total >= reading.dc);
  log(`${origin.name} reads ${scrollActivityOf(activity)?.item?.name ?? activity.item.name} (level ${reading.level}): check ${total ?? "—"} vs DC ${reading.dc} -> ${ok ? "the spell goes through" : "the spell vanishes from the scroll"}`);
  if ( ok ) return true;
  const item = scrollActivityOf(activity)?.item ?? activity.item;
  notice(origin, { key: "Retour.ParcheminPerdu", data: { item: item.name } }, "refused", { all: true, action: "scrollLost", outcome: "failure" });
  await wasteUse(activity);
  const quantity = Number(item.system?.quantity) || 1;
  if ( quantity > 1 ) await item.update({ "system.quantity": quantity - 1 });
  else await item.delete();
  return false;
}

/* -------------------------------------------- */
/*  O8d (§347) : Bouclier d'attraction          */
/* -------------------------------------------- */

/**
 * « Quand une attaque avec une arme à distance vise une créature à 3 m ou moins de vous, la malédiction fait de vous la cible » : pour
 * chaque cible, le porteur le plus proche (vivant, ni l'attaquant ni déjà visé) prend sa place. Rend les remplacements { from, to }.
 */
function attractions(activity, origin, targets, attackMode) {
  if ( !isRangedWeaponAttack(activity, attackMode) || !targets.length ) return [];
  const factors = readUnitFactors();
  const bearers = (origin.parent?.tokens ?? []).filter(t => t.actor && !t.hidden && !isObjectToken(t) && (t !== origin)
    && ((t.actor.system.attributes?.hp?.value ?? 0) > 0) && rangedDefensesOf(t.actor).some(r => r.attract));
  const out = [];
  for ( const target of targets ) {
    const taken = new Set([...targets.map(t => t.id), ...out.map(o => o.to)]);
    const id = attractorOf(bearers.filter(b => !taken.has(b.id)).map(b => {
      const distance = distanceBetween(b, target);
      const max = Math.max(...rangedDefensesOf(b.actor).map(r => Number(r.attract) || 0));
      return { id: b.id, distance: distance.value, within: rangeIssue(distance, { value: max, units: "ft" }, factors) === null };
    }));
    if ( id ) out.push({ from: target.id, to: id });
  }
  return out;
}

/** Remplace des cibles de l'utilisateur (Token#setTarget, comme la porte) ; rend la nouvelle liste d'ids. */
function swapTargets(ids, swaps) {
  const next = ids.map(id => swaps.find(s => s.from === id)?.to ?? id).filter((id, i, all) => all.indexOf(id) === i);
  next.forEach((id, i) => canvas.tokens.get(id)?.setTarget(true, { releaseOthers: i === 0 }));
  return next;
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  if ( usageConfig[MODULE_ID]?.gated || !activity?.item || !canvas?.ready ) return true;
  const origin = usageToken(activity);
  if ( !origin?.actor ) return true;
  // O8g (§350) : un parchemin hors de la liste de sorts du lecteur est inintelligible ; trop haut pour lui, un test d'abord.
  const reading = scrollReadingFor(activity, origin.actor);
  if ( reading?.access === "refused" ) {
    log(`${origin.name}: ${scrollActivityOf(activity)?.item?.name ?? activity.item.name} is unintelligible (${reading.identifier} is not on their spell lists)`);
    notice(origin, { key: "Retour.ParcheminIllisible", data: { item: scrollActivityOf(activity)?.item?.name ?? activity.item.name } }, "refused");
    return false;
  }
  const scrollCheck = (reading?.access === "check") ? reading : null;
  let targets = Array.from(game.user.targets).map(t => t.document).filter(t => t !== origin);
  // O8d (§347) : le porteur du Bouclier d'attraction devient la cible, avant toute autre fenêtre.
  const attracted = (activity.type === "attack") ? attractions(activity, origin, targets, usageConfig[MODULE_ID]?.attackMode ?? null) : [];
  if ( attracted.length ) {
    swapTargets(Array.from(game.user.targets).map(t => t.id), attracted);
    for ( const { from, to } of attracted ) {
      const bearer = origin.parent.tokens.get(to);
      log(`${origin.name}'s ${activity.item.name}: the Shield of Missile Attraction pulls the attack from ${origin.parent.tokens.get(from)?.name} to ${bearer?.name}`);
      if ( bearer ) notice(bearer, { key: "Retour.CibleAttiree", data: { item: activity.item.name } }, "refused", { all: true, action: "attackAttracted" });
    }
    targets = Array.from(game.user.targets).map(t => t.document).filter(t => t !== origin);
  }
  const wards = wardsAgainst(activity, origin, targets);
  // Un sort lancé en réaction (Contresort lui-même, Bouclier) ne passe pas par cette porte : §403, sa propre porte avant qu'il parte
  // (`passReactionSpell`, appelée par la fenêtre de réaction), qui permet le contre-Contresort.
  // Commander les objets d'un sort déjà lancé (« Move Lights », §16.17) n'est pas lancer un sort : rien à contrer.
  // §119 : un projectile enchaîné (Projectile magique, Rayon ardent) ou un rebond (Orbe chromatique) n'est pas un nouveau sort :
  // le Contresort se joue au lancement, une fois (il se proposait de nouveau à chaque projectile enchaîné).
  const ours = usageConfig[MODULE_ID] ?? {};
  const isSpell = isSpellCast(activity.item) && (activity.activation?.type !== "reaction") && !spellCommandOf(activity)
    && !ours.projectileOf && !ours.leap;
  const auto = usageConfig[MODULE_ID]?.autoReact ?? false;
  // §32 : Sort subtil — « sans composante verbale, somatique ni matérielle » : personne ne voit le sort se lancer, pas de Contresort.
  const subtle = (usageConfig[MODULE_ID]?.metamagic ?? []).includes("subtle");
  if ( isSpell && subtle ) log(`${origin.name} casts ${activity.item.name} with Subtle Spell: no Counterspell possible`);
  let candidates = (isSpell && !subtle) ? counterCandidates(activity, origin) : [];
  const failure = isSpell ? failureAgainst(activity, origin.actor) : null;
  // `autoReact: "none"` (scénarios) : personne ne réagit — et l'utilisation n'est pas suspendue du tout, sinon
  // l'appelant (connecteur) perd la main avant la relance (zone jamais posée, message jamais suivi).
  if ( (auto === "none") && candidates.length ) {
    log(`${origin.name} casts ${activity.item.name}: ${candidates.map(c => c.token.name).join(", ")} — reaction declined automatically (scenario)`);
    candidates = [];
  }
  // §34 : la fenêtre de réaction avant le jet d'attaque (Esquive des ombres, Éclat protecteur). Pas pour une attaque lancée en
  // réaction (attaque d'opportunité : `flags.reaction` de sa carte) — la suspendre casserait la fenêtre qui l'a lancée.
  const preAttack = (activity.type === "attack") && (activity.activation?.type !== "reaction") && (auto !== "none") && !messageConfig?.data?.flags?.[MODULE_ID]?.reaction;
  const reactors = preAttack ? attackReactors(activity, origin, targets) : [];
  // §36 : Présage — un devin qui voit l'attaquant (ou l'attaquant lui-même) peut remplacer le d20 du jet ; « avant le jet ». Seulement
  // quand les cibles sont désignées : le mode visée relance l'utilisation, la question serait posée deux fois.
  const seers = (preAttack && targets.length) ? seersOf(origin) : [];
  // §157 : une utilisation sans jet d'attaque qui vise des créatures (un projectile de Projectile magique) — leur fenêtre `isTargeted`.
  // §344 : aussi un sort à jet d'attaque, pour les seules réactions qui l'annulent (Sceptre d'absorption).
  const targeted = (((activity.type !== "attack") || isSpell) && (auto !== "none") && targets.length)
    ? targetedCandidates(activity, origin, targets, { isSpell, castLevel: isSpell ? castLevelFor(activity, usageConfig) : 0 }) : [];
  if ( !scrollCheck && !failure && !wards.length && !candidates.length && !reactors.length && !seers.length && !targeted.length ) return true;

  // Les cibles du lanceur, à remettre avant la relance : une réaction jouée sur ce même client (le MJ qui contrôle
  // les deux) les a remplacées par les siennes (vu le 2026-09-24 : le Rayon relancé sans cible, ou sur le lanceur).
  const chosen = Array.from(game.user.targets).map(t => t.id);
  (async () => {
    if ( scrollCheck && !(await passScrollCheck(activity, origin, scrollCheck)) ) return;
    // §298 : le sort raté (Lenteur) ou contré ne part pas, mais son action est perdue.
    if ( failure && !(await passFailure(activity, origin, failure)) ) return wasteUse(activity);
    if ( wards.length && !(await passWards(activity, origin, wards)) ) return;
    if ( candidates.length && !(await passCounters(activity, origin, candidates, { auto, castLevel: castLevelFor(activity, usageConfig) })) ) return wasteUse(activity);
    // §344 : le sort absorbé se dissipe ; les ressources engagées sont perdues.
    if ( targeted.length && !(await passTargeted(activity, origin, targeted, { auto })) ) return wasteUse(activity);
    let mods = reactors.length ? await askAttackReactions(activity, origin, reactors, { auto }) : null;
    const foretold = seers.length ? await foretellFor(origin, { kind: "attack", item: activity.item.name, auto }) : null;
    if ( foretold ) {
      mods = { disadvantage: false, penalty: 0, bonus: 0, names: [], ...(mods ?? {}), foretold: foretold.value };
      log(`${foretold.seer}: Portent, the d20 of ${origin.name}'s attack will be ${foretold.value}`);
    }
    if ( preAttack ) rememberAttackMods(activity.uuid, mods);
    // O8d (§347) : un réacteur devenu la cible (Bouclier antiprojectiles) remplace la cible d'origine.
    if ( mods?.intercepts?.length ) {
      chosen.splice(0, chosen.length, ...swapTargets(chosen, mods.intercepts));
      for ( const { to } of mods.intercepts ) {
        const catcher = origin.parent.tokens.get(to);
        if ( catcher ) notice(catcher, { key: "Retour.CibleInterceptee", data: { item: activity.item.name } }, "gain", { all: true, action: "attackIntercepted" });
      }
    }
    const now = Array.from(game.user.targets).map(t => t.id);
    if ( chosen.length && ((now.length !== chosen.length) || now.some(id => !chosen.includes(id))) ) {
      // Token#setTarget, comme la réaction elle-même (adapter/reactions.mjs) : le cœur V14 n'a plus User#updateTokenTargets.
      chosen.forEach((id, i) => canvas.tokens.get(id)?.setTarget(true, { releaseOthers: i === 0 }));
    }
    // Une attaque demandée sans dialogue (clic rapide, connecteur) enchaîne son jet sans dialogue non plus :
    // dnd5e relance `rollAttack` avec le sien (attack.mjs, _triggerSubsequentActions), turn.mjs lit l'intention.
    if ( activity.type === "attack" ) {
      keepPendingAttack(activity, {
        mode: usageConfig[MODULE_ID]?.attackMode ?? null,
        fast: dialogConfig?.configure === false,
        confirmed: usageConfig[MODULE_ID]?.confirmed === true   // la portée acceptée à l'utilisation vaut pour le jet
      });
    }
    // `subsequentActions: false` est le réglage d'un appelant qui comptait enchaîner lui-même le jet (connecteur,
    // use-activity) : l'annulation lui a retiré la main, la relance laisse dnd5e enchaîner (sans dialogue, ci-dessus).
    const { subsequentActions, ...rest } = usageConfig;
    await activity.use({ ...rest, [MODULE_ID]: { ...(usageConfig[MODULE_ID] ?? {}), confirmed: true, gated: true } }, dialogConfig, messageConfig);
  })().catch(err => console.error(`${MODULE_ID} | gate interrupted`, err));
  return false;
}

/**
 * §403 : contre-Contresort — « un sort lancé en réaction peut être contré ». Le sort de réaction d'un acteur (Contresort, Bouclier) est
 * soumis aux mêmes Contresorts que les autres, avant de partir ; contré, sa Réaction est perdue (`wasteUse`) et il ne part pas. Le lanceur
 * d'origine, qui a déjà lancé ce tour, n'a en général qu'une Réaction : la chaîne s'arrête d'elle-même.
 */
async function passReactionSpell(activity, actor) {
  const origin = usageToken(activity) ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !origin?.parent || !canvas?.ready ) return true;
  const candidates = counterCandidates(activity, origin);
  if ( !candidates.length ) return true;
  const passed = await passCounters(activity, origin, candidates, { auto: false, castLevel: Number(activity.item.system?.level) || 0 });
  if ( !passed ) await wasteUse(activity);
  return passed;
}

export function registerGates() {
  setReactionSpellGate(passReactionSpell);
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "gates: Sanctuary, Counterspell, pre-attack reactions, Portent" });
}
