/**
 * Le registre de déclencheurs en marche : publier un moment, retrouver ce qui s'y accroche, et
 * exécuter ici les étapes que personne d'autre n'exécute (dégâts bonus). Les réactions
 * (runtime/reactions.mjs) et les zones (runtime/areas.mjs) consultent le même registre.
 */

import { MODULE_ID } from "../constants.mjs";
import { select, stepsOf, BEARER_MOMENTS } from "../core/triggers.mjs";
import { declarationsOf, declarationsOfEffects, factsFor, tokenOf, consumedMarks } from "../adapter/triggers.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { resaveAgainst } from "../adapter/areas.mjs";
import { seesBetween } from "../adapter/vision.mjs";
import { tallySettled } from "../core/tally.mjs";
import { leaveTrace } from "../adapter/traces.mjs";
import { damageSharedElsewhere } from "../adapter/interop.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

/**
 * L'activité de sauvegarde à rejouer : celle d'où vient l'effet, ou, pour un effet posé par une attaque dont la sauvegarde est
 * enchaînée (sauvegarde sœur, onHit.save, §19.6), la sauvegarde de son item.
 */
export function saveActivityOf(activity) {
  if ( !activity || (activity.type === "save") ) return activity;
  return activity.item?.system?.activities?.find?.(a => a.type === "save") ?? activity;
}

/** Fait connaître un moment aux consommateurs passifs (SPEC §5.6). */
export function announce(moment, context) {
  Hooks.callAll(`${MODULE_ID}.${moment}`, context);
}

/**
 * Les déclarations de `context.actor` qui s'accrochent à ce moment, sans rien publier : celles de ses
 * items, et, aux moments « du porteur » (son tour, être attaqué), celles que portent les effets posés sur lui
 * (`via: "effect"`).
 */
export function matching(moment, context) {
  if ( !context.actor ) return [];
  const declarations = BEARER_MOMENTS.includes(moment)
    ? [...declarationsOf(context.actor), ...declarationsOfEffects(context.actor)]
    : declarationsOf(context.actor);
  return select(declarations, moment, factsFor(context));
}

/** Publie le moment, et rend ce qui s'y accroche. */
export function fire(moment, context) {
  announce(moment, context);
  return matching(moment, context);
}

/* -------------------------------------------- */
/*  Dégâts bonus (preDamageRoll)                */
/* -------------------------------------------- */

const partKey = s => `${s.name}|${s.formula}|${s.damageType}`;

/**
 * Sur le client de l'auteur, avant le dialogue du jet de dégâts : les déclarations de ses items
 * qui s'accrochent à `preDamageRoll` ajoutent leur part au jet (Maléfice). Un jet vaut pour toutes
 * ses cibles : une part n'est ajoutée que si chaque cible la justifie ; sinon on le dit.
 */
function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const source = activity?.actor;
  if ( !activity || !source || !canvas?.ready || !config.rolls ) return true;
  const origin = usageTokenOf(activity);
  const targets = Array.from(game.user.targets).map(t => t.document).filter(t => (t !== origin) && t.actor);
  if ( !targets.length ) return true;

  // `damageType: "weapon"` : le type de l'arme (première part de dégâts de l'activité, sinon de l'item).
  const weaponType = activity.damage?.parts?.[0]?.types?.first?.() ?? Array.from(activity.damage?.parts?.[0]?.types ?? [])[0]
    ?? Array.from(activity.item?.system?.damage?.base?.types ?? [])[0] ?? null;
  const typeOf = s => (s.damageType === "weapon") ? weaponType : s.damageType;
  const perTarget = targets.map(target => fire("preDamageRoll", { actor: source, source, target: target.actor, activity, sourceToken: origin, targetToken: target })
    .flatMap(d => stepsOf(d, "damage").filter(s => typeOf(s)).map(s => ({ name: d.name, formula: s.formula, damageType: typeOf(s),
      once: (d.oncePerTurn === true) ? (d.identifier ?? d.name) : null }))));
  const candidates = new Map(perTarget.flat().map(s => [partKey(s), s]));
  if ( !candidates.size ) return true;
  // §19.9 : « une fois par tour » (Attraction de la mort) — n'importe quel tour, en combat ; marqué sur l'acteur de l'auteur.
  const turn = game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : null;
  const spent = s => !!s.once && !!turn && (source.getFlag(MODULE_ID, `oncePerTurn.${s.once}`) === turn);
  const agreed = Array.from(candidates.values()).filter(s => !spent(s) && perTarget.every(list => list.some(o => partKey(o) === partKey(s))));
  for ( const s of agreed ) {
    if ( s.once && turn ) source.setFlag(MODULE_ID, `oncePerTurn.${s.once}`, turn).catch(err => console.warn(`${MODULE_ID} | ${s.name} : tour non marqué`, err));
  }
  for ( const s of Array.from(candidates.values()).filter(spent) ) log(`dégâts bonus : ${s.name} déjà utilisé ce tour`);
  const dropped = Array.from(candidates.values()).filter(s => !agreed.includes(s) && !spent(s));
  if ( dropped.length ) ui.notifications.warn(loc("DegatsBonusDivergents", { names: dropped.map(s => s.name).join(", ") }));

  const data = activity.getRollData();
  for ( const s of agreed ) {
    // Même forme qu'une part du système (data/activity/base-activity.mjs:933-939) ; le critique
    // s'applique à toutes les parts du jet, dés bonus compris (règle 2024).
    config.rolls.push({ data, parts: [s.formula], options: { type: s.damageType, types: [s.damageType], properties: [] } });
    log(`dégâts bonus : ${s.name} +${s.formula} ${s.damageType}`);
  }
  if ( agreed.length ) foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.bonuses`, agreed);
  return true;
}

/* -------------------------------------------- */
/*  Tour de la créature (startOfTurn, endOfTurn)  */
/* -------------------------------------------- */

/**
 * Le tour d'une créature commence ou finit, où qu'elle soit : les déclarations portées par ses effets
 * (Immobilisation de personne : « réitère le JS à la fin de chacun de ses tours ») rejouent la sauvegarde
 * de l'activité d'origine (adapter/areas.mjs, resaveAgainst). §19 : elles lui infligent aussi des dégâts
 * (`damage`, `to: "bearer"` : Flèche acide de Melf, Infliger des cauchemars), puis l'effet peut tomber (`remove`).
 * MJ actif uniquement ; une file par créature.
 */
function turnMoment(moment, combatant, turnKey=null) {
  const token = combatant?.token;
  const actor = token?.actor;
  if ( !actor ) return;
  return enqueue(`turn:${token.uuid}`, async () => {
    for ( const d of fire(moment, { actor, target: actor, source: null, targetToken: token }) ) {
      // §42.2 : « à la fin de son PROCHAIN tour » — un effet que le moteur fait tomber lui-même (`remove`) et qui a été posé
      // pendant ce tour-ci attend le suivant (`placedOn`, noté à la pose : runtime/cantrips.mjs).
      if ( turnKey && stepsOf(d, "remove").length && ((await fromUuid(d.effect ?? ""))?.getFlag?.(MODULE_ID, "placedOn") === turnKey) ) continue;
      // Sauvegarde répétée et dégâts du porteur ensemble : les dégâts ne valent que si la sauvegarde est ratée (Épine de
      // Par exemple : une sauvegarde à chaque début de tour, 1d6 dégâts si elle échoue ; §19.6) — ils
      // voyagent avec la carte de sauvegarde, que la résolution applique (runtime/engine.mjs, `resave.onFail`).
      const bearerDamage = stepsOf(d, "damage").filter(s => s.to === "bearer");
      const resaves = stepsOf(d, "resave");
      for ( const step of resaves ) {
        const effect = await fromUuid(d.effect ?? "");
        const activity = saveActivityOf(await fromUuid(d.activity ?? ""));
        if ( !effect || (activity?.type !== "save") ) { log(`${d.name} : sauvegarde répétée impossible (effet ou activité de sauvegarde introuvable)`); continue; }
        // §43.1 : le seuil d'échecs du compteur est atteint — plus de sauvegarde.
        if ( step.tally && tallySettled(effect.getFlag(MODULE_ID, "tally")) ) continue;
        // §42.2 : Terreur — la sauvegarde n'est rejouée que si la créature finit son tour sans voir le lanceur.
        if ( step.unlessSeesOrigin && (seesBetween(actor, activity.item?.actor ?? null) !== false) ) {
          log(`${d.name} : ${token.name} voit encore le lanceur, pas de sauvegarde (${moment})`);
          continue;
        }
        log(`${d.name} : ${token.name} rejoue la sauvegarde (${moment})`);
        const onFail = bearerDamage.length
          ? { item: d.item, identifier: d.identifier, name: d.name, scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0,
            steps: bearerDamage.map(({ formula, damageType, activity: id }) => ({ formula, damageType, activity: id })) }
          : null;
        // §37 : `keep` (réussie, l'effet reste) et `onFail: "dodge"` (ratée, l'action Esquiver) — Malédiction, « Cursed Actions ».
        await resaveAgainst(effect, activity, token, moment, { onFail, keep: step.keep === true, dodge: step.onFail === "dodge", tally: step.tally ?? null });
      }
      if ( resaves.length && bearerDamage.length ) continue;
      for ( const step of bearerDamage ) {
        const effect = await fromUuid(d.effect ?? "");
        if ( !effect ) continue;
        const item = await fromUuid(d.item ?? "");
        await inflict({
          step, item, scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0, targetUuid: token.uuid,
          speaker: ChatMessage.implementation.getSpeaker({ token }),
          flavor: loc("DegatsPorteur", { item: d.name, name: token.name }),
          flags: { bearerDamage: { item: d.identifier, effect: d.effect, moment } }
        });
        log(`${d.name} : ${token.name} subit ses dégâts (${moment})`);
      }
      if ( stepsOf(d, "remove").length ) {
        const effect = await fromUuid(d.effect ?? "");
        if ( effect ) { await effect.delete(); log(`${d.name} : l'effet cesse sur ${token.name} (${moment})`); }
      }
    }
  });
}

function onTurnChange(combat, prior, current) {
  turnMoment("endOfTurn", combat.combatants.get(prior?.combatantId), prior ? `${combat.id}.${prior.round}.${prior.turn}` : null);
  turnMoment("startOfTurn", combat.combatants.get(current?.combatantId));
}

/* -------------------------------------------- */
/*  Marques consommées au jet d'attaque (B10)   */
/* -------------------------------------------- */

/**
 * Un jet d'attaque vient d'être lancé (message `attack`, touché ou raté) : les marques qu'il concerne tombent — Rayon
 * traçant (« la prochaine attaque contre elle »), Moquerie cruelle (« sa prochaine attaque »). Elles ont donné leur
 * avantage ou leur désavantage au jet (B6, adapter/triggers.mjs, `declaredAttackModifiers`). MJ actif uniquement.
 * L'attaque qui POSE la marque (Rayon traçant) la pose après son propre jet : elle ne la consomme pas.
 */
async function onAttackRolled(message) {
  const { scene, token } = message.speaker ?? {};
  const sourceToken = (scene && token) ? game.scenes.get(scene)?.tokens.get(token) ?? null : null;
  if ( !sourceToken ) return;
  const activity = message.getAssociatedActivity?.() ?? null;
  const removed = new Set();
  for ( const t of message.system?.targets ?? [] ) {
    const targetToken = fromUuidSync(t.token, { strict: false });
    for ( const mark of consumedMarks(sourceToken, targetToken, activity) ) {
      if ( removed.has(mark.effect) ) continue;
      removed.add(mark.effect);
      const effect = await fromUuid(mark.effect);
      if ( !effect ) continue;
      await effect.delete();
      log(`${mark.name} : marque de ${mark.bearer} consommée par l'attaque de ${sourceToken.name}`);
    }
  }
}

/* -------------------------------------------- */
/*  Dégâts subis par le porteur d'un effet (isDamaged)  */
/* -------------------------------------------- */

/**
 * La créature vient de perdre des PV ou des PV temporaires, d'où que viennent les dégâts (résolution du
 * moteur, plateau du système, barre du token) : `dnd5e.damageActor`, émis sur tous les clients par
 * `onUpdateHP` (data/actor/templates/attributes.mjs) quand le total PV + PV temporaires baisse. Les effets
 * qu'elle porte réagissent (`via: "effect"`) : B8 `remove` — l'effet cesse (Sommeil, Motif hypnotique) ;
 * B4 `resave` — elle rejoue la sauvegarde (Domination, Fou rire). MJ actif uniquement.
 * Limite : à 0 PV sans PV temporaires, les PV ne baissent plus et le hook ne vient pas.
 */
function onDamaged(actor, changes) {
  if ( !(changes?.total < 0) || !actor ) return;
  const token = tokenOf(actor);
  const tokenDocument = token?.document ?? token ?? null;
  const declarations = matching("isDamaged", { actor, target: actor, source: null, targetToken: tokenDocument })
    .filter(d => (d.via === "effect") && d.effect);
  if ( !declarations.length ) return;
  return enqueue(`damaged:${actor.uuid}`, async () => {
    for ( const d of declarations ) {
      const effect = await fromUuid(d.effect);
      if ( !effect ) continue;   // déjà tombé (deux déclarations du même item, ou retiré entre-temps)
      if ( stepsOf(d, "remove").length ) {
        await effect.delete();
        log(`${d.name} : cesse sur ${actor.name}, qui vient de subir des dégâts`);
        await ChatMessage.implementation.create({
          speaker: ChatMessage.implementation.getSpeaker({ actor }),
          content: `<p>${loc("FinSurDegats", { name: actor.name, item: d.name })}</p>`,
          flags: { [MODULE_ID]: { ended: { effect: d.effect, item: d.identifier, actor: actor.uuid, moment: "isDamaged" } } }
        });
        continue;
      }
      // Lien protecteur (§16.11) : le lanceur de l'effet subit le même montant (ou la formule déclarée).
      for ( const step of stepsOf(d, "damage").filter(s => s.to === "origin") ) {
        const owner = damageSharedElsewhere(effect);
        if ( owner ) { log(`${d.name} : partage des dégâts déjà fait par ${owner}, le moteur s'efface`); continue; }
        const origin = await fromUuid(d.source ?? "");
        if ( !origin || (origin === actor) || !((origin.system?.attributes?.hp?.value ?? 0) > 0) ) continue;
        const amount = step.formula ? (await new Roll(step.formula).evaluate()).total : -changes.total;
        if ( !(amount > 0) ) continue;
        await origin.applyDamage(step.formula ? [{ value: amount, type: step.damageType }] : amount);
        log(`${d.name} : ${origin.name} subit ${amount} dégâts avec ${actor.name}`);
        await ChatMessage.implementation.create({
          speaker: ChatMessage.implementation.getSpeaker({ actor: origin }),
          content: `<p>${loc("PartageDegats", { name: origin.name, item: d.name, n: amount, bearer: actor.name })}</p>`,
          flags: { [MODULE_ID]: { shared: { item: d.identifier, from: actor.uuid, to: origin.uuid, amount } } }
        });
      }
      if ( !stepsOf(d, "resave").length ) continue;
      const activity = saveActivityOf(await fromUuid(d.activity ?? ""));
      if ( (activity?.type !== "save") || !tokenDocument ) { log(`${d.name} : sauvegarde sur dégâts impossible (activité de sauvegarde ou token introuvable)`); continue; }
      log(`${d.name} : ${actor.name} rejoue la sauvegarde (dégâts subis)`);
      await resaveAgainst(effect, activity, tokenDocument, "isDamaged");
    }
  });
}

export function registerTriggers() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "dégâts bonus des déclencheurs" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "tour de la créature : déclencheurs interrompus" });
  route("dnd5e.damageActor", onDamaged, { executor: true, label: "dégâts subis : effets du porteur non traités" });
  // Trace d'une utilisation (§16.9, contenu `trace: true`) : pas pour un rejeu de zone ni une sauvegarde répétée.
  // Marques consommées (§16.12, B10) : au message du jet d'attaque.
  route("createChatMessage", async message => {
    if ( message.type === "attack" ) return onAttackRolled(message);
    if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
    const effect = await leaveTrace(message);
    if ( effect ) log(`${effect.name} : trace posée sur ${effect.parent?.name}`);
  }, { executor: true, label: "trace ou marque non traitée" });
}
