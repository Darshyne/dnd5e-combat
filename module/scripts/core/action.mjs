/**
 * La machine d'action (SPEC §13, S2) : UNE résolution par action, quelle que soit l'activité.
 *
 *     advance(résolution, évènement) → { résolution, commandes }
 *
 * La résolution est une donnée sérialisable, portée par un seul message (le « porteur » : le
 * message d'utilisation, ou le message d'attaque quand le jet a été lancé hors carte). Le cœur
 * ne fait rien lui-même : il rend des COMMANDES que le runtime exécute (demander une réaction,
 * faire lancer des sauvegardes, appliquer), et reçoit en retour des ÉVÈNEMENTS. L'état est écrit
 * avant toute attente : un F5 du MJ pendant une fenêtre de réaction ne perd plus l'action.
 *
 * Le PLAN dit ce que l'activité demande ; une étape absente est sautée :
 *   attack   un jet d'attaque décide qui est touché
 *   damage   "author" : l'auteur lance les dégâts au signal (step = awaitingRolls)
 *            "system" : dnd5e les lance tout seul à l'utilisation (activités damage et heal)
 *   save     { ability, dc, onSave, activity, chained } — `chained` : sauvegarde imposée par une
 *            attaque qui touche ; elle ne réduit pas les dégâts de l'attaque
 *   effects  [{ id, activity, when: "always" | "failedSave" | "saved", margin? }] — `saved` : seulement sur une sauvegarde
 *            réussie (contenu `savedEffects` : Rayon affaiblissant) ; `margin: { min?, max? }` : seulement si la cible a raté
 *            de `min` ou plus (et de `max` au plus) — « si elle rate le jet de 5 ou plus » (§19.6, contenu `failMargins`)
 *   choice   { prompt, options: [{ id, label }] } — effets EXCLUSIFS : parmi `options` (des ids
 *            d'`effects`), l'auteur en choisit un avant l'application (Maléfice) ; les autres
 *            effets du plan ne sont pas concernés
 *   darts    nombre de projectiles qui touchent d'office, à répartir entre les cibles (Projectile magique, §16.27) :
 *            une cible touchée par N projectiles subit N fois les dégâts du jet ; seule, elle les prend tous ;
 *            plusieurs : l'auteur répartit (étape « allocate »)
 *   steps    [{ when: "always" | "failedSave", if?, type, … }] — étapes d'issue déclarées par le
 *            contenu (core/content.mjs : `move`, `status`, `damage`), exécutées à l'application sur chaque
 *            cible atteinte ; une étape `damage` à `onSave` reçoit `saved` (la cible a-t-elle réussi ?) pour sa part —
 *            cible atteinte, comme les effets ; `if` (en JSON : un flag éclaterait ses clés à points) est
 *            jugé par l'adaptateur au moment d'appliquer
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

import { resolveAttack } from "./attack.mjs";

/** Version du schéma écrit dans les flags. Une résolution d'une autre version est ignorée. */
export const RESOLUTION_VERSION = 2;

export const STEPS = Object.freeze({
  AWAITING_ATTACK: "awaitingAttack",
  AWAITING_REACTION: "awaitingReaction",
  AWAITING_ROLLS: "awaitingRolls",
  DONE: "done",
  MISSED: "missed",
  UNDONE: "undone"
});

/** Part des dégâts subie sur une sauvegarde réussie, selon `damage.onSave` de l'activité. */
const ON_SAVE_MULTIPLIER = Object.freeze({ half: 0.5, none: 0, full: 1 });

const same = resolution => ({ resolution, commands: [] });

/* -------------------------------------------- */
/*  Lecture                                     */
/* -------------------------------------------- */

/** Une résolution de ce schéma, ou null. */
export function current(resolution) {
  return resolution?.v === RESOLUTION_VERSION ? resolution : null;
}

/** Ceux que l'action atteint : les cibles touchées s'il y a un jet d'attaque, toutes sinon — hors celles qu'elle ne peut pas affecter. */
export function affectedTargets(resolution) {
  const reachable = resolution.targets.filter(t => !t.unaffected);
  // §28 : Sort mineur appuyé — une cible manquée par le tour de magie subit quand même la moitié des dégâts.
  return resolution.plan.attack ? reachable.filter(t => (t.hit === true) || (resolution.plan.potent && (t.hit === false))) : reachable;
}

/** Les cibles atteintes dont on attend encore la sauvegarde. */
export function pendingSaves(resolution) {
  if ( !resolution.plan.save ) return [];
  return affectedTargets(resolution).filter(t => t.save === null);
}

/** L'auteur de l'action doit-il lancer ses dégâts maintenant ? (lu sur son client, au signal du flag) */
export function wantsDamageRoll(resolution) {
  return (resolution.step === STEPS.AWAITING_ROLLS) && (resolution.plan.damage === "author") && !resolution.damageRoll;
}

/** Un coup critique à reporter sur le jet de dégâts. */
export function isCriticalHit(resolution) {
  return resolution.targets.some(t => t.hit && t.critical);
}

/** L'auteur doit-il encore répartir ses projectiles (Projectile magique, plusieurs cibles) ? */
export function pendingAllocation(resolution) {
  return (resolution.plan.darts > 0) && !resolution.allocated && (resolution.step === STEPS.AWAITING_ROLLS)
    && (affectedTargets(resolution).length > 1);
}

/**
 * Une répartition valable : `count` projectiles, un entier positif par cible, la somme exacte ; sinon, au mieux : un chacun
 * dans l'ordre, le reste au premier.
 */
export function allocateDarts(count, tokens, wanted={}) {
  const counts = Object.fromEntries(tokens.map(t => [t, Math.max(0, Math.floor(Number(wanted[t]) || 0))]));
  if ( Object.values(counts).reduce((a, b) => a + b, 0) === count ) return counts;
  const out = Object.fromEntries(tokens.map(t => [t, 0]));
  tokens.forEach((t, i) => { if ( i < count ) out[t] = 1; });
  if ( tokens.length ) out[tokens[0]] += Math.max(0, count - tokens.length);
  return out;
}

/** L'auteur doit-il encore choisir l'effet à appliquer ? */
export function pendingChoice(resolution) {
  return !!resolution.plan.choice && (resolution.choice === null) && (resolution.step === STEPS.AWAITING_ROLLS)
    && (affectedTargets(resolution).length > 0);   // une attaque qui rate tout le monde n'a rien à appliquer
}

function readyToApply(resolution) {
  return (resolution.step === STEPS.AWAITING_ROLLS) && !resolution.applying
    && !pendingSaves(resolution).length
    && !pendingChoice(resolution)
    && !pendingAllocation(resolution)
    && (!resolution.plan.damage || !!resolution.damageRoll);
}

/** Un effet ou une étape d'issue passe-t-il pour cette cible ? « saved » : seulement sur une réussite. */
/** Esquive totale (§20) : une sauvegarde de Dextérité seule (pas au choix), non enchaînée à une attaque, pour la moitié des dégâts. */
const evasionApplies = plan => !!plan.damage && !!plan.save && !plan.save.chained && (plan.save.ability === "dex")
  && ((plan.save.abilities ?? ["dex"]).every(a => a === "dex")) && ((plan.save.onSave ?? "half") === "half");

const passes = (when, saved) => (when === "always") || ((when === "saved") ? saved : !saved);

/** De combien la cible a raté la sauvegarde (DD − total), ou null si elle l'a réussie ou n'en a pas fait. */
function failMargin(target, plan) {
  if ( !target.save || (target.save.success === true) ) return null;
  if ( target.save.auto ) return Infinity;   // échec d'office (Paralysé face à la Dextérité) : raté « de tout »
  if ( !Number.isFinite(plan.save?.dc) || !Number.isFinite(target.save.total) ) return null;
  return plan.save.dc - target.save.total;
}

/** L'écart demandé (`margin`) est-il tenu ? Sans écart demandé, oui. */
const withinMargin = (margin, failed) => !margin || ((failed !== null) && (failed >= (margin.min ?? 0)) && (failed <= (margin.max ?? Infinity)));

/**
 * Ce que chaque cible atteinte doit recevoir.
 * @returns {Array<{token: string, actor: string, multiplier: number, effects: Array<{id: string, activity: string, if?: string}>,
 *   steps: object[]}>}
 */
export function applicationPlan(resolution) {
  const { plan } = resolution;
  const exclusive = new Set((plan.choice?.options ?? []).map(o => o.id));   // parmi eux, seul l'effet choisi passe
  return affectedTargets(resolution).map(t => {
    const saved = t.save?.success === true;
    const failed = failMargin(t, plan);
    let multiplier = plan.damage ? 1 : 0;
    if ( plan.damage && plan.save && !plan.save.chained && saved ) multiplier = ON_SAVE_MULTIPLIER[plan.save.onSave] ?? 0.5;
    // §28 : Sort mineur appuyé — ratée ou sauvegardée, la cible d'un tour de magie subit la moitié des dégâts, « mais aucun effet
    // supplémentaire ». Façonneur de sorts : la créature épargnée réussit d'office et ne subit rien.
    const missed = plan.attack && (t.hit === false);
    const spared = (missed || (plan.save && saved)) && plan.potent;
    if ( plan.damage && spared ) multiplier = 0.5;
    if ( t.sculpted ) multiplier = 0;
    // §20 : Esquive totale — une sauvegarde de Dextérité « pour ne subir que la moitié des dégâts » : rien sur une réussite, la
    // moitié sur un échec.
    if ( t.evasion && evasionApplies(plan) ) multiplier = saved ? 0 : 0.5;
    if ( t.halved ) multiplier *= 0.5;   // Esquive instinctive (§16.11) : la moitié des dégâts de l'attaque, arrondie par dnd5e
    multiplier *= (t.times ?? 1);         // Projectile magique (§16.27) : autant de fois les dégâts que de projectiles reçus
    return {
      token: t.token,
      actor: t.actor,
      multiplier,
      ...(t.reduced ? { reduction: t.reduced } : {}),
      effects: spared ? [] : plan.effects
        .filter(e => passes(e.when, saved) && withinMargin(e.margin, failed))
        .filter(e => !exclusive.has(e.id) || (e.id === resolution.choice))
        // Une condition sur la cible (M3 : porte de taille) voyage avec l'effet ; l'application la juge.
        .map(({ id, activity, if: condition }) => (condition ? { id, activity, if: condition } : { id, activity })),
      steps: spared ? [] : (plan.steps ?? []).filter(s => passes(s.when, saved) && withinMargin(s.margin, failed)).map(({ when, ...step }) => (("onSave" in step) ? { ...step, saved } : step))
    };
  });
}

/* -------------------------------------------- */
/*  Ouverture                                   */
/* -------------------------------------------- */

/**
 * @typedef {object} TargetInput
 * @property {string} token
 * @property {string} actor
 * @property {string} name
 * @property {number|null} [ac]          CA ; null = abri total.
 * @property {boolean} [defenceless]     Paralysée ou inconsciente à 5 ft : un coup qui touche est critique.
 * @property {boolean} [canReact]        A une réaction à proposer si elle est touchée.
 * @property {number} [duplicates]       Répliques qui peuvent prendre le coup à sa place (Image miroir, §16.25) ; 0 si
 *                                       l'attaquant n'y est pas sensible (Aveuglé, vision aveugle, vision véritable).
 * @property {string|null} [autoFail]    État qui fait échouer d'office la sauvegarde du plan.
 * @property {{reason: "type"|"content"|"immune", detail?: string}|null} [unaffected]
 *           L'action ne peut pas l'affecter (§16.8 : type de créature, règle du contenu, immunité à tous ses effets) :
 *           elle reste dans la résolution pour qu'on le lise, mais ni sauvegarde, ni dégâts, ni effet.
 */

function blankTarget({ token, actor, name, ac=null, defenceless=false, canReact=false, autoFail=null, cover=null, unaffected=null, duplicates=0, times=1, evasion=false, sculpted=false }) {
  return { token, actor, name, ac, defenceless, canReact, autoFail, cover, unaffected, duplicates, times, evasion, sculpted, halved: false,
    hit: null, critical: false, reason: null, reaction: null, duplicate: null, save: null, damage: null, effects: [] };
}

/**
 * Ouvre la résolution d'une action.
 * @param {object} data
 * @param {string} data.id
 * @param {string} data.carrier           Id du message qui porte la résolution.
 * @param {string|null} data.origin       Id du message d'utilisation, s'il existe.
 * @param {string} data.activity          UUID de l'activité.
 * @param {string|null} data.source       UUID de l'acteur qui agit.
 * @param {object} data.plan              Voir l'en-tête.
 * @param {TargetInput[]} data.targets
 * @param {object} [data.attack]          Jet d'attaque déjà lancé (porteur = message d'attaque) :
 *                                        `{ roll, messageId, targets }`, comme l'évènement `attackRolled`.
 * @param {string|null} [data.choice]     Effet exclusif déjà choisi par l'auteur (entrée « Lutte » du menu,
 *                                        §15.2) : la question ne sera pas posée. Ignoré s'il n'est pas une option.
 */
export function open({ id, carrier, origin=null, activity, source=null, plan, targets, attack=null, choice=null, allocation=null }) {
  const resolution = {
    v: RESOLUTION_VERSION, id, kind: "action", carrier, origin, activity, source,
    plan: { attack: false, damage: null, save: null, heal: false, choice: null, darts: 0, ...plan, effects: plan.effects ?? [], steps: plan.steps ?? [] },
    step: STEPS.AWAITING_ATTACK,
    attack: null,
    damageRoll: null,
    choice: (choice && plan.choice?.options?.some(o => o.id === choice)) ? choice : null,
    applying: false,
    targets: targets.map(blankTarget),
    allocated: false,
    pending: [],
    log: []
  };
  // Répartition déjà faite (visée multiple, §16.27) : portée telle quelle, remise d'aplomb si besoin.
  if ( (resolution.plan.darts > 0) && allocation ) {
    const fixed = allocateDarts(resolution.plan.darts, resolution.targets.map(t => t.token), allocation);
    resolution.targets = resolution.targets.map(t => ({ ...t, times: fixed[t.token] ?? 0 }));
    resolution.allocated = true;
  }
  // Une seule cible : elle reçoit tous les projectiles, sans question.
  else if ( (resolution.plan.darts > 0) && (resolution.targets.length === 1) ) {
    resolution.targets = [{ ...resolution.targets[0], times: resolution.plan.darts }];
    resolution.allocated = true;
  }
  if ( !resolution.plan.attack ) return afterVerdict(resolution);
  return attack ? judge(resolution, attack) : same(resolution);
}

/* -------------------------------------------- */
/*  Transitions                                 */
/* -------------------------------------------- */

/** Le jet d'attaque est connu : verdict par cible, puis fenêtre de réaction pour ceux qui en ont une. */
function judge(resolution, { roll, messageId, targets }) {
  // Les cibles d'une attaque sont celles désignées au moment du jet, pas à l'utilisation.
  const judged = resolveAttack(roll, targets.map(blankTarget)).map(t => {
    const auto = t.hit && !t.critical && t.defenceless;
    return auto ? { ...t, critical: true, reason: "autoCritical" } : t;
  });
  const pending = judged.filter(t => t.hit && t.canReact).map(t => ({ kind: "reaction", window: "isHit", token: t.token }));
  const next = { ...resolution, attack: { roll, messageId }, targets: judged, pending };
  if ( !pending.length ) return afterReactions(next);
  return {
    resolution: { ...next, step: STEPS.AWAITING_REACTION },
    commands: [{ type: "askReactions", window: "isHit", tokens: pending.map(p => p.token) }]
  };
}

/**
 * Une cible consultée a répondu : rejugée contre sa nouvelle CA si elle a réagi. `halve` : sa réaction divise les dégâts
 * de l'attaque par deux (Esquive instinctive, §16.11) — elle reste touchée.
 */
function reactionResolved(resolution, { token, used=null, ac, halve=false, uncrit=false, duplicates=null, reduce=0, miss=false }) {
  if ( resolution.step !== STEPS.AWAITING_REACTION ) return same(resolution);
  if ( !resolution.pending.some(p => (p.kind === "reaction") && (p.token === token)) ) return same(resolution);
  const targets = resolution.targets.map(t => {
    if ( (t.token !== token) || !used ) return t;
    // §28 : Calque illusoire — l'attaque est changée en échec, sans autre jet.
    const [judged] = miss ? [{ ...t, hit: false, critical: false, reason: "reaction" }] : resolveAttack(resolution.attack.roll, [{ ...t, ac }]);
    // Le critique d'office (Paralysée à 5 ft) survit au rejugement, comme au premier verdict (judge).
    const again = (judged.hit && !judged.critical && t.defenceless) ? { ...judged, critical: true, reason: "autoCritical" } : judged;
    // §19 : une réaction peut faire naître des répliques pour ce coup (Ombres spectrales) — leur nombre est relu après elle.
    const count = Number.isInteger(duplicates) ? { duplicates } : {};
    // §19.9 : un Coup critique perd ses effets de critique (Sentinelle au seuil de la mort).
    const plain = (uncrit && again.critical) ? { critical: false, uncritted: true } : {};
    // §24 : Parade — un montant retiré aux dégâts de l'attaque.
    const reduced = ((reduce > 0) && (again.hit === true)) ? { reduced: reduce } : {};
    return { ...again, ...count, ...plain, ...reduced, reaction: used, halved: !!halve && again.hit === true };
  });
  const next = { ...resolution, targets, pending: resolution.pending.filter(p => (p.kind !== "reaction") || (p.token !== token)) };
  return next.pending.length ? same(next) : afterReactions(next);
}

/** Répliques (Image miroir, §16.25) : un d6 par réplique restante ; un 3 ou plus, et c'est une réplique qui est touchée. */
export function duplicateTakesHit(dice) {
  return dice.some(d => d >= 3);
}

/**
 * Les réactions sont tranchées (Bouclier d'abord : un coup qu'il fait rater n'atteint pas les répliques). Une cible encore
 * touchée qui a des répliques les fait jouer — le runtime lance les dés et détruit la réplique touchée.
 */
function afterReactions(resolution) {
  const waiting = resolution.targets.filter(t => (t.hit === true) && (t.duplicates > 0) && (t.duplicate === null) && !t.unaffected);
  if ( !waiting.length ) return afterVerdict(resolution);
  return {
    resolution: { ...resolution, step: STEPS.AWAITING_REACTION, pending: waiting.map(t => ({ kind: "duplicates", token: t.token })) },
    commands: [{ type: "rollDuplicates", tokens: waiting.map(t => t.token) }]
  };
}

/** Les dés des répliques d'une cible sont lancés : un coup détourné devient un raté, sans dégâts ni effet. */
function duplicatesRolled(resolution, { token, dice=[], messageId=null }) {
  if ( resolution.step !== STEPS.AWAITING_REACTION ) return same(resolution);
  if ( !resolution.pending.some(p => (p.kind === "duplicates") && (p.token === token)) ) return same(resolution);
  const taken = duplicateTakesHit(dice);
  const targets = resolution.targets.map(t => (t.token !== token) ? t : {
    ...t, duplicate: { dice, taken, messageId },
    ...(taken ? { hit: false, critical: false, halved: false, reason: "duplicate" } : {})
  });
  const next = { ...resolution, targets, pending: resolution.pending.filter(p => (p.kind !== "duplicates") || (p.token !== token)) };
  return next.pending.length ? same(next) : afterVerdict(next);
}

/** Le verdict est rendu (ou il n'y avait pas de jet d'attaque) : sauvegardes, dégâts, application. */
function afterVerdict(resolution) {
  const commands = [];
  if ( resolution.plan.attack ) commands.push({ type: "echo", on: "attack" });
  if ( !affectedTargets(resolution).length ) {
    return { resolution: { ...resolution, step: resolution.plan.attack ? STEPS.MISSED : STEPS.DONE }, commands };
  }
  // Échecs d'office (paralysé, étourdi… sur Force ou Dextérité) : consignés d'emblée, aucun jet demandé.
  let next = { ...resolution, step: STEPS.AWAITING_ROLLS };
  if ( next.plan.save ) {
    const affected = new Set(affectedTargets(next).map(t => t.token));
    // §28 (avant les échecs d'office) : Façonneur de sorts — les créatures épargnées « réussissent automatiquement leur jet de sauvegarde ».
    next = { ...next, targets: next.targets.map(t => (affected.has(t.token) && t.sculpted && (t.save === null))
      ? { ...t, save: { total: null, success: true, messageId: null, auto: "sculpted" } } : t) };
    next = { ...next, targets: next.targets.map(t => (affected.has(t.token) && t.autoFail && (t.save === null))
      ? { ...t, save: { total: null, success: false, messageId: null, auto: t.autoFail } } : t) };
    const waiting = pendingSaves(next);
    if ( waiting.length ) commands.push({ type: "requestSaves", targets: waiting.map(({ token, actor, name }) => ({ token, actor, name })) });
  }
  // Projectiles à répartir (Projectile magique) : la question est posée à l'auteur, comme un choix d'effet.
  if ( pendingAllocation(next) ) {
    next = { ...next, pending: [...next.pending, { kind: "allocate" }] };
    commands.push({ type: "askAllocation", count: next.plan.darts, targets: affectedTargets(next).map(({ token, name }) => ({ token, name })) });
  }
  // Effets exclusifs : la question est posée à l'auteur, l'état « en attente » est écrit avant (repris après un F5).
  if ( pendingChoice(next) ) {
    next = { ...next, pending: [...next.pending, { kind: "choice" }] };
    commands.push({ type: "askChoice", prompt: next.plan.choice.prompt ?? null, options: next.plan.choice.options });
  }
  return settle(next, commands);
}

/** L'auteur a réparti ses projectiles : la répartition est remise d'aplomb (somme exacte), puis portée par chaque cible. */
function allocated(resolution, { counts={} }) {
  if ( !pendingAllocation(resolution) ) return same(resolution);
  const tokens = affectedTargets(resolution).map(t => t.token);
  const fixed = allocateDarts(resolution.plan.darts, tokens, counts);
  const targets = resolution.targets.map(t => (t.token in fixed) ? { ...t, times: fixed[t.token] } : t);
  return settle({ ...resolution, targets, allocated: true, pending: resolution.pending.filter(p => p.kind !== "allocate") });
}

/** L'auteur a choisi l'effet : un id hors des options, ou une réponse qu'on n'attend pas, ne change rien. */
function choiceMade(resolution, { id }) {
  if ( !pendingChoice(resolution) ) return same(resolution);
  if ( !resolution.plan.choice.options.some(o => o.id === id) ) return same(resolution);
  return settle({ ...resolution, choice: id, pending: resolution.pending.filter(p => p.kind !== "choice") });
}

/** Tout est-il réuni ? Alors on applique — une seule fois. */
function settle(resolution, commands=[]) {
  if ( !readyToApply(resolution) ) return { resolution, commands };
  return {
    resolution: { ...resolution, applying: true },
    commands: [...commands, { type: "apply", entries: applicationPlan(resolution) }]
  };
}

/** Le premier jet fait foi : un second jet du même acteur est ignoré, au MJ d'annuler et de corriger. */
function saveRolled(resolution, { actor, total, messageId, resisted=false }) {
  if ( (resolution.step !== STEPS.AWAITING_ROLLS) || !resolution.plan.save ) return same(resolution);
  const waiting = pendingSaves(resolution).find(t => t.actor === actor);
  if ( !waiting ) return same(resolution);
  // §18.9 : une Résistance légendaire change l'échec en réussite (le total reste celui du jet).
  const save = { total, success: resisted || (total >= resolution.plan.save.dc), messageId, ...(resisted ? { resisted: true } : {}) };
  return settle({ ...resolution, targets: resolution.targets.map(t => t === waiting ? { ...t, save } : t) });
}

function damageRolled(resolution, { messageId, damages }) {
  if ( (resolution.step !== STEPS.AWAITING_ROLLS) || !resolution.plan.damage || resolution.damageRoll ) return same(resolution);
  return settle({ ...resolution, damageRoll: { messageId, damages } });
}

/**
 * Ce qui a été appliqué. `before` / `after` : PV lus par l'adaptateur (null si aucun dégât) ;
 * `effects` : UUID des effets créés. C'est ce journal qui permet l'annulation.
 * `extra` : dégâts subis hors des cibles, du fait de l'action (riposte, §16.9 : l'attaquant touche une créature sous
 * Bouclier de feu) — `{ token, actor, before, after, name }`, journalisés pour être annulés avec elle.
 */
function applied(resolution, { entries, extra=[] }) {
  if ( !resolution.applying || (resolution.step !== STEPS.AWAITING_ROLLS) ) return same(resolution);
  const byToken = new Map(entries.map(e => [e.token, e]));
  const log = [...resolution.log];
  const targets = resolution.targets.map(t => {
    const entry = byToken.get(t.token);
    if ( !entry ) return t;
    let damage = null;
    if ( entry.before && entry.after ) {
      damage = { applied: (entry.before.value + entry.before.temp) - (entry.after.value + entry.after.temp) };
      log.push({ at: "applyDamage", token: t.token, actor: entry.actor, before: entry.before, after: entry.after });
    }
    for ( const effect of entry.effects ?? [] ) log.push({ at: "applyEffect", token: t.token, actor: entry.actor, effect });
    return { ...t, damage, effects: entry.effects ?? [] };
  });
  for ( const e of extra ) {
    if ( e.before && e.after ) log.push({ at: "applyDamage", token: e.token, actor: e.actor, before: e.before, after: e.after, kind: "retaliation", name: e.name ?? null });
  }
  const commands = [];
  if ( resolution.damageRoll ) commands.push({ type: "echo", on: "damage" });
  const hurt = targets.filter(t => t.damage?.applied > 0).map(t => t.token);
  if ( hurt.length ) commands.push({ type: "window", window: "isDamaged", tokens: hurt });
  commands.push({ type: "cleanup" });
  return { resolution: { ...resolution, step: STEPS.DONE, applying: false, targets, log }, commands };
}

/**
 * Ce qu'il faut défaire pour annuler, du plus récent au plus ancien.
 * @returns {{hp: Array<{actor: string, restore: object}>, effects: string[]}}
 */
export function undoPlan(resolution) {
  const log = [...resolution.log].reverse();
  return {
    hp: log.filter(l => l.at === "applyDamage").map(l => ({ actor: l.actor, restore: l.before })),
    effects: log.filter(l => l.at === "applyEffect").map(l => l.effect)
  };
}

function undone(resolution) {
  if ( resolution.step !== STEPS.DONE ) return same(resolution);
  const commands = resolution.damageRoll ? [{ type: "echo", on: "damage" }] : [];
  return { resolution: { ...resolution, step: STEPS.UNDONE }, commands };
}

const TRANSITIONS = Object.freeze({
  attackRolled: (resolution, event) => (resolution.step === STEPS.AWAITING_ATTACK) ? judge(resolution, event) : same(resolution),
  reactionResolved, duplicatesRolled, saveRolled, damageRolled, choiceMade, allocated, applied, undone
});

/**
 * @param {object} resolution
 * @param {{type: string}} event
 * @returns {{resolution: object, commands: object[]}}  `resolution` est le MÊME objet si l'évènement ne change rien.
 */
export function advance(resolution, event) {
  const transition = TRANSITIONS[event.type];
  return transition ? transition(resolution, event) : same(resolution);
}
