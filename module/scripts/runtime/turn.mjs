import { MODULE_ID } from "../constants.mjs";
import { checkUse, spendUse, refundUse, basicAction, BASIC_ACTION_FLAGS, effectiveCost } from "../core/turn.mjs";
import { rangeIssue } from "../core/range.mjs";
import { throwableAttackMode } from "../core/attack.mjs";
import {
  combatantFor, isOwnTurn, readBudget, writeBudget, requestFor, attacksPerAction, rangeOf, reachOf, canBeThrown,
  distanceBetween, usageTokenOf as usageToken, currentTurnKey, freshBudgetFor, movementOf } from "../adapter/turn.mjs";
import { usageLimitProblems, markUsedThisTurn, applyLowestSlot } from "../adapter/limits.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { basicActionOf, basicActionOfActivity } from "../adapter/basics.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { isRaging } from "../adapter/rage.mjs";
import { enemiesSeeing } from "../adapter/hide.mjs";
import { verbalBlockOf, charmersOf, hostileToCharmer, sightRequired } from "../adapter/conditions.mjs";
import { reactionsBlocked } from "../adapter/reactions.mjs";
import { conditionUseIssues } from "../core/conditions.mjs";
import { canSee } from "../adapter/vision.mjs";
import { wrongTypeFor, typesLabel } from "../adapter/eligibility.mjs";
import { pilotOfActor, summonerCombatant, commandPlan, spellCommandOf, summonsOfWith } from "../adapter/pilot.mjs";
import { freesMovement } from "../adapter/opportunity.mjs";
import { takePendingAttack } from "./actions.mjs";
import { pilotUsage, refundCommand, spellCommandUsage } from "./pilot.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";

/* -------------------------------------------- */
/*  Légalité, sur le client de celui qui agit   */
/* -------------------------------------------- */

/** Les cibles désignées qui ne sont pas à portée normale, pour un mode d'attaque donné s'il est connu. */
function rangeProblems(activity, attackMode=null) {
  const origin = usageToken(activity);
  if ( !origin || !canvas.ready ) return { key: "", problems: [] };
  const factors = readUnitFactors();
  const range = rangeOf(activity, attackMode);
  const problems = [];
  const ids = [];
  // §16.18 : le clerc peut lancer ses sorts depuis la case de son illusion — la portée d'un sort se
  // mesure depuis le lanceur ou depuis l'une de ses invocations `castFrom`, la plus favorable.
  const from = [origin];
  if ( activity.item?.type === "spell" ) from.push(...summonsOfWith(activity.actor, "castFrom").filter(t => t.parent === origin.parent));
  const rank = issue => ({ longRange: 1, outOfRange: 2 })[issue] ?? 0;
  for ( const target of game.user.targets ) {
    if ( target.document === origin ) continue;
    ids.push(target.id);
    const issue = from.map(o => rangeIssue(distanceBetween(o, target.document), range, factors) ?? null)
      .reduce((best, i) => (rank(i) < rank(best) ? i : best));
    if ( issue ) problems.push({ issue, name: target.name });
  }
  return { key: `${activity.uuid}|${attackMode ?? ""}|${ids.sort().join(",")}`, problems };
}

/**
 * Portées déjà signalées, pour ne pas poser deux fois la même question : la portée est contrôlée
 * à l'utilisation ET au jet d'attaque, parce qu'on désigne souvent sa cible entre les deux.
 */
const acknowledgedRanges = new Map();
const ACK_LIFETIME = 60000;
const acknowledged = key => (Date.now() - (acknowledgedRanges.get(key) ?? 0)) < ACK_LIFETIME;
const acknowledge = key => acknowledgedRanges.set(key, Date.now());

/** Sépare les soucis de portée en bloquants (hors de portée) et simples rappels (portée longue). */
function assessRange(activity, attackMode=null) {
  const { key, problems } = rangeProblems(activity, attackMode);
  if ( acknowledged(key) ) return { key, blocking: [] };
  for ( const r of problems.filter(r => r.issue === "longRange") ) ui.notifications.info(loc("PorteeLongue", { name: r.name }));
  const blocking = problems.filter(r => r.issue === "outOfRange");
  if ( problems.length && !blocking.length ) acknowledge(key);   // rappel donné une fois
  return { key, blocking };
}

const LEGALITY_CLASS = "dnd5e-combat-legality";

function confirmDialog(title, lines, buttons) {
  return foundry.applications.api.DialogV2.wait({
    window: { title },
    classes: [LEGALITY_CLASS],
    content: `<ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>`,
    buttons,
    rejectClose: false
  });
}

/** Mode souple (§6) pour un geste qui n'est pas une utilisation (déplacer une zone, §16.14) : « faire quand même » ? */
export async function askAnyway(title, lines) {
  const choice = await confirmDialog(title, lines, [
    { action: "go", label: loc("UtiliserQuandMeme"), default: true },
    { action: "cancel", label: loc("Renoncer") }
  ]);
  return choice === "go";
}

/**
 * Clic droit (§15.1) : une utilisation suspendue par le contrôle de légalité est abandonnée, comme
 * « Renoncer » — le dialogue se ferme sans choix, `wait` rend null. true si un dialogue était ouvert.
 */
export async function closeLegalityDialogs() {
  const open = openLegalityDialogs();
  for ( const app of open ) await app.close();
  return open.length > 0;
}

/** Les dialogues de légalité ouverts. Synchrone : lu au clic. */
export function openLegalityDialogs() {
  return [...foundry.applications.instances.values()].filter(app => app.rendered && app.options?.classes?.includes(LEGALITY_CLASS));
}

/**
 * Ce qui cloche dans une utilisation, avant de savoir qui elle vise : budget et tour, emplacement déjà lancé ce tour,
 * Silence, limites d'usage (§16.40), états qui empêchent d'agir (§17.3). Ce qui dépend des cibles (portée, type, charme,
 * vision, Furtivité) se juge au clic, dans `onPreUseActivity`. `lines` : les raisons, traduites ; vide = rien ne cloche.
 * @param {Activity} activity
 * @param {{cost?: string|null, attackMode?: string|null, recast?: boolean}} [options]
 */
export function useIssues(activity, { cost: forcedCost=null, attackMode=null, recast=false }={}) {
  // §16.15 : un objet piloté agit au tour de son lanceur, avec son budget ; la commande ouverte ce tour couvre le geste.
  const pilot = pilotOfActor(activity.actor);
  const combatant = pilot ? summonerCombatant(pilot) : combatantFor(activity.actor);
  const budget = combatant ? readBudget(combatant) : null;
  const own = combatant ? isOwnTurn(combatant) : true;
  let request = requestFor(activity, forcedCost, { attackMode });
  if ( pilot ) request = { ...request, cost: commandPlan(pilot, "use").pay, weaponAttack: false, usesSpellSlot: false, offhand: false };
  if ( recast ) request = { ...request, usesSpellSlot: false };   // §16.21 : relance sans emplacement
  request = monkRequest(activity, request, budget);
  // « Move Lights » : la commande de déplacement portée par le sort — gratuite si elle est déjà ouverte ce tour.
  const ordered = pilot ? null : spellCommandOf(activity);
  if ( ordered ) request = { ...request, cost: commandPlan(ordered, "move").pay, usesSpellSlot: false };
  const issues = combatant ? checkUse(budget, request, { isOwnTurn: own, turnKey: currentTurnKey() }) : [];
  // Silence : un sort à composante verbale est impossible (adapter/conditions.mjs, SPEC §16.6).
  const silenced = verbalBlockOf(activity);
  // §16.40 : « une fois à chacun de vos tours », « seulement sans utilisation restante » (Regain sauvage).
  const limits = usageLimitProblems(activity, { inCombat: !!combatant, ownTurn: own });
  // §17.3 : Neutralisé (ni action, ni action Bonus, ni Réaction).
  const cost = (request.cost === "free") ? null : (budget ? effectiveCost(budget, request) : request.cost);
  const incapacitated = pilot ? [] : conditionUseIssues({ statuses: Array.from(activity.actor?.statuses ?? []), cost,
    noReactions: reactionsBlocked(activity.actor) });
  // §22 : « en Rage, vous ne pouvez pas lancer de sorts ».
  const raging = isSpellCast(activity.item) && isRaging(activity.actor);   // §48 : lire un parchemin aussi
  const lines = [
    ...issues.map(i => loc(`Souci.${i}`)),
    ...(silenced ? [loc("Souci.silenced")] : []),
    ...(raging ? [loc("Souci.rage")] : []),
    ...limits.issues.map(i => loc(`Souci.${i}`, { item: limits.item ?? "" })),
    ...incapacitated.map(i => loc(`Souci.${i}`))
  ];
  return { combatant, budget, own, request, cost, lines };
}

/** Une frappe à mains nues (l'item de l'Attaque à mains nues, ou une attaque classée « unarmed »). */
const isUnarmedStrike = activity => (activity?.type === "attack")
  && ((identifierOf(activity.item).id === "unarmed-strike") || (activity.attack?.type?.classification === "unarmed"));

/**
 * §24 : ce que le Moine change au coût d'une frappe à mains nues. Déluge de coups ouvert : gratuite (`flurry`). Arts martiaux :
 * payée de l'action Bonus quand l'action (et les attaques qu'elle couvre) est épuisée.
 */
export function monkRequest(activity, request, budget) {
  if ( !request || !budget ) return request;
  // §27 : Prêtre de guerre — l'attaque ouverte vaut aussi pour une arme.
  const weapon = (activity?.type === "attack") && (activity.item?.type === "weapon");
  if ( ((budget.flurry ?? 0) > 0) && (isUnarmedStrike(activity) || (budget.flurryAny && weapon)) ) return { ...request, cost: "free", flurry: true };
  if ( !isUnarmedStrike(activity) ) return request;
  const martial = activity.actor?.items.some(i => contentOf(i).entry?.martialArts === true);
  const actionLeft = (budget.action >= 1) || (budget.attacks.used < budget.attacks.granted);
  if ( martial && (request.cost === "action") && !actionLeft && (budget.bonus >= 1) ) return { ...request, cost: "bonus", weaponAttack: false };
  return request;
}

/**
 * Mode souple (SPEC §6) : un souci de budget, de tour ou de portée n'interdit rien. L'utilisation
 * est suspendue, le joueur lit ce qui cloche et décide. `preUseActivity` est synchrone : on
 * annule, on demande, puis on relance la même utilisation marquée comme confirmée.
 * Le budget et le tour n'existent qu'en combat ; la portée se contrôle toujours.
 */
function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  // Ce que l'intention a fixé d'avance (effet exclusif, mode d'attaque) va sur la carte, où le moteur le lit.
  // §16.40 : les options du contenu d'abord — coût de la règle (noté sur la carte juste après), emplacement le plus bas,
  // sans fenêtre ; aucun emplacement : rien n'est utilisé.
  if ( !applyLowestSlot(activity, usageConfig, dialogConfig) ) {
    ui.notifications.warn(loc("Souci.noSlot", { item: activity.item.name }));
    return false;
  }
  for ( const key of ["choice", "attackMode", "saveChoice", "legendary", "autoReact", "recast", "cost", "damageType", "order", "cleave", "metamagic"] ) {
    const value = usageConfig[MODULE_ID]?.[key];
    if ( value && messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.${key}`, value);
  }
  if ( usageConfig[MODULE_ID]?.confirmed ) return true;
  // Une activité lancée sans cible est déjà passée en mode visée avant d'arriver ici (ui/pointer.mjs, inscrit avant).
  // Mode d'attaque déjà choisi par le clic (« main secondaire » du menu : `engage`), sinon inconnu jusqu'au jet.
  // Un coût imposé par l'intention (§16.26 : Taille, une attaque d'arme pour l'action Bonus), sinon celui de l'activation.
  const use = useIssues(activity, { cost: usageConfig[MODULE_ID]?.cost ?? null,
    attackMode: usageConfig[MODULE_ID]?.attackMode ?? null, recast: !!usageConfig[MODULE_ID]?.recast });
  const { combatant, budget, own, request } = use;
  const range = assessRange(activity);
  // Furtivité : il faut être hors du champ de vision de tout ennemi (règle 2024, adapter/hide.mjs).
  const seenBy = (basicActionOfActivity(activity) === "hide") ? (enemiesSeeing(usageToken(activity)) ?? []) : [];
  // §16.8 : « choisissez un Humanoïde » — les cibles désignées d'un autre type ne seront pas affectées.
  const origin = usageToken(activity);
  const wrongType = Array.from(game.user.targets).filter(t => (t.document !== origin) && t.actor)
    .map(t => ({ name: t.name, types: wrongTypeFor(activity, t.actor) })).filter(t => t.types);
  // §17.3 : Charmé (pas contre qui nous a charmé) ; « une créature que vous pouvez voir ».
  const aimed = Array.from(game.user.targets).filter(t => (t.document !== origin) && t.actor);
  const charmers = hostileToCharmer(activity) ? charmersOf(activity.actor) : new Set();
  const charmed = aimed.filter(t => charmers.has(t.actor.uuid));
  const unseen = (origin && sightRequired(activity)) ? aimed.filter(t => canSee(origin, t.document) === false) : [];
  if ( !use.lines.length && !range.blocking.length && !seenBy.length && !wrongType.length && !charmed.length && !unseen.length ) return true;

  const lines = [
    ...use.lines,
    ...range.blocking.map(r => loc("Souci.outOfRange", { name: r.name })),
    ...(seenBy.length ? [loc("Souci.hideSeen", { names: seenBy.map(t => t.name).join(", ") })] : []),
    ...wrongType.map(t => loc("Souci.wrongType", { name: t.name, types: typesLabel(t.types), item: activity.item.name })),
    ...charmed.map(t => loc("Souci.charmed", { name: t.name })),
    ...unseen.map(t => loc("Souci.notSeen", { name: t.name }))
  ];
  // Une action tentée hors de son tour est souvent une réaction (attaque d'opportunité).
  const asReaction = !!combatant && !own && (request.cost === "action") && (budget.reaction > 0);
  const buttons = [{ action: "go", label: loc("UtiliserQuandMeme"), default: !asReaction }];
  if ( asReaction ) buttons.unshift({ action: "reaction", label: loc("UtiliserMaReaction"), default: true });
  buttons.push({ action: "cancel", label: loc("Renoncer") });

  confirmDialog(`${activity.item.name} — ${combatant?.name ?? activity.actor?.name ?? ""}`, lines, buttons).then(choice => {
    if ( (choice !== "go") && (choice !== "reaction") ) return;
    acknowledge(range.key);
    // Les options du moteur déjà posées (choix de la lumière, cibles désignées…) repartent avec la confirmation.
    const config = { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), confirmed: true } };
    const message = foundry.utils.mergeObject(messageConfig ?? {}, choice === "reaction"
      ? { data: { flags: { [MODULE_ID]: { cost: "reaction" } } } } : {}, { inplace: false });
    activity.use(config, dialogConfig, message);
  });
  return false;
}

/**
 * Avant le dialogue du jet d'attaque : une arme de mêlée qui se lance, contre des cibles toutes
 * hors d'allonge, est présélectionnée en mode « lancer ». Le joueur garde la main dans le dialogue.
 */
function onPreRollAttack(config, dialog) {
  const activity = config.subject;
  // Attaque engagée à la souris : le mode (« lancer ») est déjà choisi, et le jet part sans dialogue.
  const pending = activity?.uuid ? takePendingAttack(activity) : null;
  if ( pending ) {
    if ( pending.fast && dialog ) dialog.configure = false;
    if ( pending.confirmed ) config[MODULE_ID] = { ...(config[MODULE_ID] ?? {}), confirmed: true };   // portée déjà acceptée
    if ( pending.mode && activity.item?.system.attackModes?.some(m => m.value === pending.mode) ) {
      config.attackMode = pending.mode;
      if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = pending.mode;
      return true;
    }
  }
  // Seule la relance après la fenêtre de portée a déjà choisi son mode (`modeChosen`) ; une attaque simplement confirmée
  // (connecteur, visée) garde la présélection — sans elle, une javeline lancée partait en mêlée, sans `system.mode` sur le
  // message ni javeline dépensée (vu le 2026-09-28, style Armes de jet).
  if ( config[MODULE_ID]?.modeChosen || !activity?.item || !canBeThrown(activity) ) return true;
  // §39.2 : un autre mode que celui par défaut de dnd5e (le premier : activity/attack.mjs:111-113) demandé (main
  // secondaire, deux mains) est gardé — mais pas le dernier mode que dnd5e a simplement repris de sa mémoire
  // (activity/attack.mjs:95) : après un lancer, une attaque au contact repartait en « lancer ».
  const byDefault = activity.item.system.attackModes?.[0]?.value ?? null;
  const remembered = activity.item.getFlag("dnd5e", `last.${activity.id}.attackMode`) ?? null;
  const origin = usageToken(activity);
  const targets = Array.from(game.user.targets).filter(t => t.document !== origin);
  const canTest = !!origin && canvas.ready;
  const factors = canTest ? readUnitFactors() : null;
  const reach = canTest ? reachOf(activity) : null;
  const mode = throwableAttackMode({
    requested: config.attackMode ?? null, remembered, byDefault,
    hasTargets: canTest && (targets.length > 0),
    allBeyondReach: canTest && (targets.length > 0) && targets.every(t => rangeIssue(distanceBetween(origin, t.document), reach, factors)),
    canThrow: activity.item.system.attackModes?.some(m => m.value === "thrown") === true
  });
  if ( mode ) {
    config.attackMode = mode;
    if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = mode;
  }
  return true;
}

/**
 * Contrôle de portée du jet d'attaque, APRÈS son dialogue : c'est là que le mode d'attaque est
 * connu (mêlée ou lancer), et que les cibles sont celles du jet (activity/attack.mjs:84).
 */
function onPostAttackRollConfiguration(rolls, config, dialogConfig, messageConfig) {
  const activity = config.subject;
  if ( config[MODULE_ID]?.confirmed || !activity?.item ) return true;
  const options = rolls[0]?.options ?? {};
  const range = assessRange(activity, options.attackMode ?? null);
  if ( !range.blocking.length ) return true;

  const beyondReach = canBeThrown(activity) && !options.attackMode?.startsWith("thrown");
  const lines = range.blocking.map(r => loc(beyondReach ? "Souci.outOfReach" : "Souci.outOfRange", { name: r.name }));
  const buttons = [{ action: "go", label: loc("AttaquerQuandMeme"), default: true }, { action: "cancel", label: loc("Renoncer") }];
  confirmDialog(`${activity.item.name} — ${activity.actor?.name ?? ""}`, lines, buttons).then(choice => {
    if ( choice !== "go" ) return;
    acknowledge(range.key);
    // On repart d'une configuration neuve, avec les choix déjà faits dans le dialogue.
    const { ability, ammunition, attackMode, mastery, advantageMode } = options;
    activity.rollAttack({
      event: config.event, ability, ammunition, attackMode, mastery,
      advantage: advantageMode === 1, disadvantage: advantageMode === -1,
      [MODULE_ID]: { confirmed: true, modeChosen: true }
    }, { configure: false },
    { data: { system: { origin: foundry.utils.getProperty(messageConfig ?? {}, "data.system.origin") } } });
  });
  return false;
}

/* -------------------------------------------- */
/*  Dépense et remise à zéro, par le MJ actif   */
/* -------------------------------------------- */

async function onUsageMessage(message) {
  if ( message.getFlag(MODULE_ID, "areaTick") ) return;   // zone qui rejoue son activité : personne n'agit
  if ( message.getFlag(MODULE_ID, "resave") ) return;     // sauvegarde répétée (SPEC §16) : personne n'agit non plus
  const activity = message.getAssociatedActivity?.();
  // §16.15 : un objet piloté se paie au budget de son lanceur, par commande (runtime/pilot.mjs).
  const pilot = pilotOfActor(message.getAssociatedActor?.());
  if ( pilot ) return activity ? pilotUsage(message, pilot) : undefined;
  const ordered = spellCommandOf(activity);
  if ( ordered ) return spellCommandUsage(message, ordered);
  const combatant = combatantFor(message.getAssociatedActor?.());
  if ( !activity || !combatant ) return;
  const before = readBudget(combatant);
  // Action de base par son item (§15.2) : l'action est dépensée et l'état du tour posé (Pointe double le déplacement…).
  // Les autres (attaque à mains nues…) coûtent ce que dit leur activation, comme n'importe quel item.
  const basic = basicActionOf(activity.item);
  const kind = BASIC_ACTION_FLAGS[basic] ? basic : null;
  // §19.6 : une activité qui prend une action de base au coût de son activation (Pas rapide : Foncer par une action Bonus).
  const declared = contentOf(activity.item).entry?.basicActions?.[activity.id] ?? null;
  const request = kind ? null : monkRequest(activity, requestFor(activity, message.getFlag(MODULE_ID, "cost") ?? null,
    { attackMode: message.getFlag(MODULE_ID, "attackMode") ?? null }), before);
  // §24 : une frappe du Déluge de coups — gratuite, décomptée, et notée sur la carte (Technique de la main ouverte).
  if ( request?.flurry ) {
    const left = Math.max(0, (before.flurry ?? 0) - 1);
    await writeBudget(combatant, { ...before, flurry: left, flurryAny: left ? !!before.flurryAny : false });
    await message.setFlag(MODULE_ID, "flurry", true);
    log(`${combatant.name} : frappe du Déluge de coups (${Math.max(0, (before.flurry ?? 0) - 1)} restante(s))`);
    return;
  }
  // §21 : Fougue — « une action supplémentaire » ; l'activité (« spéciale ») ne coûte rien.
  if ( contentOf(activity.item).entry?.grantsAction === true ) {
    await writeBudget(combatant, { ...before, action: (before.action ?? 0) + 1 });
    log(`${combatant.name} : une action de plus (${activity.item.name})`);
    return;
  }
  if ( request && (!request.cost || (request.cost === "free")) ) return;   // §16.27 : un projectile enchaîné ne coûte rien
  if ( request && message.getFlag(MODULE_ID, "recast") ) request.usesSpellSlot = false;
  let after = kind ? basicAction(before, kind)
    : spendUse(before, request, { isOwnTurn: isOwnTurn(combatant), attacksPerAction: attacksPerAction(combatant.actor), turnKey: currentTurnKey() });
  for ( const k of [declared].flat() ) if ( k && BASIC_ACTION_FLAGS[k] ) after = { ...after, [BASIC_ACTION_FLAGS[k]]: true };
  // §24 : Déluge de coups — les frappes à mains nues qu'il ouvre.
  const flurry = contentOf(activity.item).entry?.flurry;
  if ( flurry && (flurry.activity === activity.id) ) after = { ...after, flurry: flurry.strikes, flurryAny: flurry.weapons === true };
  // §20 : « votre Vitesse est de 0 jusqu'à la fin du tour » (Visée stable) — plus un pas, le reste du budget intact.
  if ( contentOf(activity.item).entry?.holdsStill === true ) after = { ...after, stopped: true };
  // §21 : Décalage tactique — Second souffle par une action Bonus : la moitié de la Vitesse en plus, sans attaque d'opportunité.
  // §22 : Bond instinctif — entrer en Rage : la moitié de la Vitesse en plus (`disengage: false`).
  const used = identifierOf(activity.item).id;
  const shift = (request?.cost === "bonus") ? combatant.actor?.items.map(i => contentOf(i).entry?.movesAfter)
    .find(m => m && (((typeof m === "string") ? m : m.item) === used)) : null;
  const movement = shift ? movementOf(combatant, readUnitFactors()) : null;
  if ( movement ) {
    const disengage = (typeof shift === "string") || (shift.disengage !== false);
    after = { ...after, bonusMove: (Number(after.bonusMove) || 0) + (movement.speed / 2), ...(disengage ? { disengaged: true } : {}) };
    log(`${combatant.name} : +${movement.speed / 2} ${movement.units} de déplacement${disengage ? " sans attaque d'opportunité" : ""} (${activity.item.name})`);
  }
  // §18.15 : « se déplace … sans provoquer d'attaque d'opportunité » — le reste du tour, comme après Se désengager.
  if ( !after.disengaged && freesMovement(activity.item) ) after = { ...after, disengaged: true };
  await writeBudget(combatant, after);
  // Consigné sur la carte : une annulation avant tout jet (runtime/cancel.mjs) rend exactement cette dépense.
  await message.setFlag(MODULE_ID, "spent", { combatant: combatant.id, before, after, offhand: !!request?.offhand });
  log(`${combatant.name} : ${kind ?? (request.offhand ? "main secondaire" : request.cost)} (${activity.item.name})`);
}

/** Délai d'attente de la dépense consignée sur la carte d'utilisation, quand le jet la suit de près. */
const SPENT_WAIT_MS = 3000;

/**
 * Attaque de la main secondaire choisie dans le dialogue du jet (fiche, barre d'actions) : à l'utilisation,
 * le mode n'était pas connu et une action a été débitée. Au jet, on rend cette dépense et on débite
 * l'attaque de la main secondaire (action Bonus, ou Coup double).
 */
async function onAttackMessage(message) {
  const mode = message.system?.mode;
  if ( !mode?.endsWith?.("offhand") ) return;
  // `system.origin` est un ForeignDocumentField (data/chat-message/roll-message-data.mjs:38) : lu, c'est le
  // message lui-même ; son id est dans la source, comme le lit adapter/messages.mjs.
  const usage = game.messages.get(message._source.system?.origin);
  if ( !usage ) return;
  // Le jet suit souvent l'utilisation de près (clic-attaque rapide) : la dépense de la carte, écrite par ce
  // même MJ au \`createChatMessage\` de l'utilisation, peut ne pas être encore là. On l'attend un peu.
  let spent = usage.getFlag(MODULE_ID, "spent");
  for ( let waited = 0; !spent && (waited < SPENT_WAIT_MS); waited += 100 ) {
    await new Promise(resolve => setTimeout(resolve, 100));
    spent = usage.getFlag(MODULE_ID, "spent");
  }
  const combatant = spent ? game.combat?.combatants.get(spent.combatant) : null;
  if ( !combatant || spent.offhand ) return;
  const activity = usage.getAssociatedActivity?.();
  if ( !activity ) return;
  const request = requestFor(activity, null, { attackMode: mode });
  const before = refundUse(readBudget(combatant), spent.before, spent.after);
  const after = spendUse(before, request, { isOwnTurn: isOwnTurn(combatant), attacksPerAction: attacksPerAction(combatant.actor), turnKey: currentTurnKey() });
  await writeBudget(combatant, after);
  await usage.setFlag(MODULE_ID, "spent", { combatant: combatant.id, before, after, offhand: true });
  log(`${combatant.name} : main secondaire choisie au jet, dépense corrigée (${activity.item.name})`);
}

/** Carte supprimée par une annulation avant tout jet : la dépense qu'elle avait faite est rendue. */
async function onUsageCancelled(message) {
  if ( !message.getFlag(MODULE_ID, "cancelled") ) return;
  const spent = message.getFlag(MODULE_ID, "spent");
  const combatant = spent ? game.combat?.combatants.get(spent.combatant) : null;
  if ( !combatant ) return;
  await writeBudget(combatant, refundUse(readBudget(combatant), spent.before, spent.after));
  if ( spent.command ) await refundCommand(combatant, spent.command);
  log(`${combatant.name} : dépense rendue (action annulée avant tout jet)`);
}

async function resetBudget(combatant) {
  if ( combatant ) await writeBudget(combatant, freshBudgetFor(combatant));
}

/* -------------------------------------------- */

export function registerTurn() {
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "légalité de l'utilisation" });
  route("dnd5e.postUseActivity", activity => markUsedThisTurn(activity), { label: "limite « une fois par tour » non notée" });
  route("dnd5e.preRollAttackV2", onPreRollAttack, { cancellable: true, label: "mode d'attaque présélectionné" });
  route("dnd5e.postAttackRollConfiguration", onPostAttackRollConfiguration, { cancellable: true, label: "portée du jet d'attaque" });

  route("createChatMessage", message => (message.type === "usage") ? onUsageMessage(message)
    : (message.type === "attack") ? onAttackMessage(message) : null,
    { executor: true, label: "budget : dépense non consignée" });

  route("deleteChatMessage", message => (message.type === "usage") ? onUsageCancelled(message) : null,
    { executor: true, label: "budget : dépense rendue à l'annulation" });

  // La réaction et le reste se récupèrent au début du tour du combattant.
  route("combatTurnChange", (combat, prior, current) => resetBudget(combat.combatants.get(current.combatantId)),
    { executor: true, label: "budget : remise à neuf du tour" });
  route("combatStart", combat => Promise.all(combat.combatants.map(resetBudget)),
    { executor: true, label: "budget : remise à neuf du combat" });
}
