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
 */

import { MODULE_ID } from "../constants.mjs";
import { current, STEPS } from "../core/action.mjs";
import { stepsOf } from "../core/triggers.mjs";
import { areHostile } from "../core/reaction.mjs";
import { rangeIssue } from "../core/range.mjs";
import { usageTokenOf as usageToken, distanceBetween, rangeOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { reactionOptions, askReaction } from "../adapter/reactions.mjs";
import { spellCommandOf } from "../adapter/pilot.mjs";
import { matching } from "./triggers.mjs";
import { attackReactors, askAttackReactions, rememberAttackMods } from "./reactions.mjs";
import { keepPendingAttack } from "./actions.mjs";
import { seersOf, foretellFor } from "../adapter/portent.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { castLevelFor } from "../adapter/counter.mjs";

const TERMINAL = new Set([STEPS.DONE, STEPS.MISSED, STEPS.UNDONE]);
const RESOLUTION_WAIT_MS = 60000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Attend qu'une résolution soit tranchée, depuis n'importe quel client (on lit le flag). null au-delà du délai. */
async function settled(messageId) {
  for ( const until = Date.now() + RESOLUTION_WAIT_MS; Date.now() < until; ) {
    const resolution = current(game.messages.get(messageId)?.getFlag(MODULE_ID, "resolution"));
    if ( resolution && TERMINAL.has(resolution.step) ) return resolution;
    await sleep(400);
  }
  return null;
}

/** Une carte de chat qui dit ce que la porte a décidé (lue par les scénarios : flag `gate`) ; `details` : lignes de plus. */
function tell(actor, key, data, gate, details=[]) {
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: [loc(key, data), ...details].map(line => `<p>${line}</p>`).join(""),
    flags: { [MODULE_ID]: { gate } }
  });
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

/** Qui peut réagir au lancement de ce sort, avec quoi. */
function counterCandidates(activity, origin) {
  const out = [];
  const factors = readUnitFactors();
  for ( const token of origin.parent?.tokens ?? [] ) {
    if ( (token === origin) || !token.actor || token.hidden || !areHostile(token.disposition, origin.disposition) ) continue;
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
        { kind: "counterspell", spell: activity.item.system?.identifier ?? null, caster: origin.uuid, reactor: token.uuid, message: answer.message, dissipated: failed,
          counter: { castLevel: c.castLevel, level: c.level, auto: c.auto, dc: c.dc, total: c.total ?? null } }, details);
      if ( failed ) return false;
      continue;
    }
    const resolution = await settled(answer.message);
    const target = resolution?.targets.find(t => t.token === origin.uuid) ?? resolution?.targets[0] ?? null;
    const failed = target?.save?.success === false;
    log(`${token.name} reacts (${answer.name}): saving throw ${target?.save?.total ?? "?"} -> ${failed ? "spell countered" : "the spell goes through"}`);
    await tell(origin.actor, failed ? "PorteSortDissipe" : "PorteSortTenu", { name: origin.name, spell: activity.item.name, reactor: token.name, item: answer.name },
      { kind: "counterspell", spell: activity.item.system?.identifier ?? null, caster: origin.uuid, reactor: token.uuid, message: answer.message, dissipated: failed });
    if ( failed ) return false;
  }
  return true;
}

/* -------------------------------------------- */

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  if ( usageConfig[MODULE_ID]?.gated || !activity?.item || !canvas?.ready ) return true;
  const origin = usageToken(activity);
  if ( !origin?.actor ) return true;
  const targets = Array.from(game.user.targets).map(t => t.document).filter(t => t !== origin);
  const wards = wardsAgainst(activity, origin, targets);
  // Un sort lancé en réaction (Contresort lui-même, Bouclier) n'ouvre pas de fenêtre : pas de contre-contre (limite assumée).
  // Commander les objets d'un sort déjà lancé (« Move Lights », §16.17) n'est pas lancer un sort : rien à contrer.
  const isSpell = isSpellCast(activity.item) && (activity.activation?.type !== "reaction") && !spellCommandOf(activity);
  const auto = usageConfig[MODULE_ID]?.autoReact ?? false;
  // §32 : Sort subtil — « sans composante verbale, somatique ni matérielle » : personne ne voit le sort se lancer, pas de Contresort.
  const subtle = (usageConfig[MODULE_ID]?.metamagic ?? []).includes("subtle");
  if ( isSpell && subtle ) log(`${origin.name} casts ${activity.item.name} with Subtle Spell: no Counterspell possible`);
  let candidates = (isSpell && !subtle) ? counterCandidates(activity, origin) : [];
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
  if ( !wards.length && !candidates.length && !reactors.length && !seers.length ) return true;

  // Les cibles du lanceur, à remettre avant la relance : une réaction jouée sur ce même client (le MJ qui contrôle
  // les deux) les a remplacées par les siennes (vu le 2026-09-24 : le Rayon relancé sans cible, ou sur le lanceur).
  const chosen = Array.from(game.user.targets).map(t => t.id);
  (async () => {
    if ( wards.length && !(await passWards(activity, origin, wards)) ) return;
    if ( candidates.length && !(await passCounters(activity, origin, candidates, { auto, castLevel: castLevelFor(activity, usageConfig) })) ) return;
    let mods = reactors.length ? await askAttackReactions(activity, origin, reactors, { auto }) : null;
    const foretold = seers.length ? await foretellFor(origin, { kind: "attack", item: activity.item.name, auto }) : null;
    if ( foretold ) {
      mods = { disadvantage: false, penalty: 0, bonus: 0, names: [], ...(mods ?? {}), foretold: foretold.value };
      log(`${foretold.seer}: Portent, the d20 of ${origin.name}'s attack will be ${foretold.value}`);
    }
    if ( preAttack ) rememberAttackMods(activity.uuid, mods);
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

export function registerGates() {
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "gates: Sanctuary, Counterspell, pre-attack reactions, Portent" });
}
