import { MODULE_ID } from "../constants.mjs";
import { checkUse, spendUse, refundUse, basicAction, BASIC_ACTION_FLAGS, effectiveCost, addDash } from "../core/turn.mjs";
import { rangeIssue, tooClose } from "../core/range.mjs";
import { throwableAttackMode, versatileGrip } from "../core/attack.mjs";
import {
  combatantFor, isOwnTurn, readBudget, writeBudget, requestFor, attacksPerAction, rangeOf, reachOf, canBeThrown,
  distanceBetween, usageTokenOf as usageToken, currentTurnKey, freshBudgetFor, movementOf } from "../adapter/turn.mjs";
import { usageLimitProblems, markUsedThisTurn, applyLowestSlot } from "../adapter/limits.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { promptWait } from "../adapter/dialogs.mjs";
import { basicActionOf, basicActionOfActivity, basicChoiceOf } from "../adapter/basics.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { isRaging } from "../adapter/rage.mjs";
import { enemiesSeeing } from "../adapter/hide.mjs";
import { verbalBlockOf, charmersOf, hostileToCharmer, sightRequired } from "../adapter/conditions.mjs";
import { untrainedArmor } from "../adapter/armor-training.mjs";
import { reactionsBlocked, actionOrBonusOnly } from "../adapter/reactions.mjs";
import { conditionUseIssues } from "../core/conditions.mjs";
import { canSee } from "../adapter/vision.mjs";
import { hiddenDcOf } from "../adapter/search.mjs";
import { locationUnknown } from "../core/hearing.mjs";
import { wrongTypeFor, typesLabel } from "../adapter/eligibility.mjs";
import { pilotOfActor, summonerCombatant, commandPlan, spellCommandOf, summonsOfWith } from "../adapter/pilot.mjs";
import { freesMovement } from "../adapter/opportunity.mjs";
import { takePendingAttack } from "./actions.mjs";
import { pilotUsage, refundCommand, spellCommandUsage } from "./pilot.mjs";
import { route } from "./router.mjs";
import { log, loc, sleep, viaActiveGM } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { forcedReasons as passedReasons, mergeIssues } from "../core/forced.mjs";
import { somaticBlockOf, registerSomaticHandsSetting } from "../adapter/hands.mjs";
import { missingResources } from "../adapter/resources.mjs";
import { reportForced, overriddenFlag, refusal } from "./forced.mjs";
import { withAntimagicLifted } from "./antimagic.mjs";

/** §417 : les raisons passées outre — aucune quand le réglage « Action impossible » coupe le contrôle (ni alerte, ni carte marquée). */
const forcedReasons = choice => (refusal().report ? passedReasons(choice) : []);
import { antimagicAround, barrierBetween } from "../adapter/barriers.mjs";
import { magicalUse } from "../adapter/antimagic.mjs";
import { rangedBanAround, formLockAround } from "../adapter/areas.mjs";
import { isRangedWeaponAttack } from "../adapter/cover.mjs";
import { selfTeleportOf, tooBrightFor } from "./teleport.mjs";
import { windowDisengaged } from "./reactions.mjs";
import { samePlane } from "../adapter/plane.mjs";
import { chainOf, chainLimit, chainOutliers } from "../adapter/chain.mjs";

/* -------------------------------------------- */
/*  Légalité, sur le client de celui qui agit   */
/* -------------------------------------------- */

/** Les cibles désignées qui ne sont pas à portée normale, pour un mode d'attaque donné s'il est connu. */
export function rangeProblems(activity, attackMode=null) {
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
  const rank = issue => ({ longRange: 1, outOfRange: 2, tooClose: 3 })[issue] ?? 0;
  // O8h (§351) : une portée minimale (armes de siège) — trop près est aussi bloquant.
  const min = contentOf(activity.item).entry?.minRange ?? null;
  const issueFrom = (o, target) => {
    const measured = distanceBetween(o, target);
    return (min && tooClose(measured, min, factors)) ? "tooClose" : (rangeIssue(measured, range, factors) ?? null);
  };
  for ( const target of game.user.targets ) {
    if ( target.document === origin ) continue;
    ids.push(target.id);
    const issue = from.map(o => issueFrom(o, target.document))
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
/** Note la portée signalée ; les signalements de plus d'une minute, qui ne servent plus, sont oubliés au passage. */
function acknowledge(key) {
  const now = Date.now();
  for ( const [k, at] of acknowledgedRanges ) if ( (now - at) >= ACK_LIFETIME ) acknowledgedRanges.delete(k);
  acknowledgedRanges.set(key, now);
}

/**
 * §416 : les soucis de portée passés outre à l'utilisation, par activité et par cibles, sans le mode d'attaque (inconnu à ce moment :
 * dnd5e le pose au jet). Le jet d'attaque qui suit ne repose pas la question pour les mêmes cibles et le même souci ; un souci
 * nouveau (une autre cible, « trop près » au lieu de « hors de portée ») la repose.
 */
const forcedRanges = new Map();
const withoutMode = key => { const [uuid, , ids] = key.split("|"); return `${uuid}|${ids ?? ""}`; };
const blockingSignature = problems => problems.filter(r => ["outOfRange", "tooClose"].includes(r.issue)).map(r => `${r.name}:${r.issue}`).sort().join(",");
function rememberForced(key, blocking) {
  const now = Date.now();
  for ( const [k, v] of forcedRanges ) if ( (now - v.at) >= ACK_LIFETIME ) forcedRanges.delete(k);
  if ( key ) forcedRanges.set(withoutMode(key), { at: now, signature: blockingSignature(blocking) });
}
function sameAsForced(key, problems) {
  const known = key ? forcedRanges.get(withoutMode(key)) : null;
  if ( !known || ((Date.now() - known.at) >= ACK_LIFETIME) ) return false;
  const signature = blockingSignature(problems);
  return !!signature && (signature === known.signature);
}

/** Sépare les soucis de portée en bloquants (hors de portée) et simples rappels (portée longue). */
function assessRange(activity, attackMode=null) {
  const { key, problems } = rangeProblems(activity, attackMode);
  if ( acknowledged(key) ) return { key, blocking: [] };
  // §416 : la même portée, déjà passée outre à l'utilisation — le mode d'attaque, connu seulement au jet, change la clé, pas le souci.
  if ( attackMode && sameAsForced(key, problems) ) return { key, blocking: [], forced: problems.filter(r => ["outOfRange", "tooClose"].includes(r.issue)) };
  for ( const r of problems.filter(r => r.issue === "longRange") ) ui.notifications.info(loc("PorteeLongue", { name: r.name }));
  const blocking = problems.filter(r => ["outOfRange", "tooClose"].includes(r.issue));
  if ( problems.length && !blocking.length ) acknowledge(key);   // rappel donné une fois
  return { key, blocking };
}

const LEGALITY_CLASS = "dnd5e-combat-legality";

/** La fenêtre de légalité. §381 : `actor` — la table voit qu'on attend sa décision (sablier au-dessus de son token). */
function confirmDialog(title, lines, buttons, actor=null) {
  // §417 : le réglage « Action impossible ». Simple avertissement ou aucun contrôle : l'action part par son bouton par défaut, sans
  // fenêtre. Refus strict : un joueur lit les raisons et ne peut que renoncer ; le MJ garde la fenêtre entière.
  const outcome = refusal();
  if ( !outcome.window ) {
    if ( outcome.warn ) {
      const text = document.createElement("div");
      text.innerHTML = lines.join(" · ");
      ui.notifications.warn(`${title} : ${text.textContent}`);
    }
    const go = buttons.find(b => b.default && (b.action !== "cancel")) ?? buttons.find(b => b.action !== "cancel");
    return Promise.resolve(go?.action ?? "go");
  }
  if ( outcome.proceed === false ) {
    lines = [...lines, `<em>${loc("Refus.Strict")}</em>`];
    buttons = [{ action: "cancel", label: loc("Renoncer"), default: true }];
  }
  // §422 : à son tour — elle passe après la question ouverte sur ce poste au lieu de s'empiler dessus, sans retenir les suivantes ;
  // et suivie (adapter/dialogs.mjs, `promptWait`) : chez un MJ, sa ligne de la File porte ses boutons.
  return promptWait({ window: { title }, classes: [LEGALITY_CLASS], content: `<ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>`, buttons },
    { awaiting: actor ? { actor, kind: "choice" } : null, aside: true });
}

/**
 * Mode souple (§6) pour un geste qui n'est pas une utilisation (déplacer une zone, §16.14) : « faire quand même » ? §408 : forcé, le MJ et
 * la table sont prévenus (`forced` : `{ actor, item, token }` de qui agit).
 */
export async function askAnyway(title, lines, forced={}) {
  const choice = await confirmDialog(title, lines, [
    { action: "go", label: loc("UtiliserQuandMeme"), default: true },
    { action: "cancel", label: loc("Renoncer") }
  ], forced.actor ?? null);
  if ( choice !== "go" ) return false;
  reportForced({ ...forced, reasons: forcedReasons({ lines, action: choice }) }).catch(err => console.error(`${MODULE_ID} | forced: alert`, err));
  return true;
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
export function useIssues(activity, { cost: forcedCost=null, attackMode=null, recast=false, usageConfig=null }={}) {
  // §16.15 : un objet piloté agit au tour de son lanceur, avec son budget ; la commande ouverte ce tour couvre le geste.
  const pilot = pilotOfActor(activity.actor);
  const combatant = pilot ? summonerCombatant(pilot) : combatantFor(activity.actor);
  const budget = combatant ? readBudget(combatant) : null;
  const own = combatant ? isOwnTurn(combatant) : true;
  let request = requestFor(activity, forcedCost, { attackMode });
  if ( pilot ) request = { ...request, cost: commandPlan(pilot, "use").pay, weaponAttack: false, usesSpellSlot: false, offhand: false };
  // §16.21 : relance sans emplacement ; §164 : au coût de la règle (Vif carquois : une action Bonus).
  const recastCost = contentOf(activity.item).entry?.recastCost ?? null;
  if ( recast ) request = { ...request, usesSpellSlot: false, ...(recastCost ? { cost: recastCost } : {}) };
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
  // §409 : un sort lancé (pas une zone déplacée, ni la commande d'un sort déjà lancé) ou une activité longue — même sans coût d'action.
  const casting = !recast && !ordered && isSpellCast(activity.item);
  const longActivation = ["minute", "hour", "day"].includes(activity.activation?.type);
  const incapacitated = pilot ? [] : conditionUseIssues({ statuses: Array.from(activity.actor?.statuses ?? []), cost,
    noReactions: reactionsBlocked(activity.actor), actionOrBonus: !!budget && actionOrBonusOnly(activity.actor), budget,
    castsSpell: casting, longActivation });
  // §410 (issue #44, lot 3) : ce qui manque — emplacement, utilisations, quantité, préparation (forcer = ne pas le dépenser).
  const missing = (pilot || ordered) ? missingResources(null) : missingResources(activity, usageConfig, { recast });
  // Ce que runtime/usage.mjs a trouvé en manque (§77 : l'emplacement corrigé, les utilisations relues sur la copie réparée de l'item).
  const lacking = usageConfig?.[MODULE_ID]?.lacking ?? null;
  if ( lacking && !missing.keys.some(k => ["noSlot", "noUses", "noQuantity"].includes(k)) ) missing.keys.unshift(lacking);
  // §409 (issue #44) : composante somatique sans main libre.
  const handsFull = (casting && !pilot) ? somaticBlockOf(activity) : null;
  // §22 : « en Rage, vous ne pouvez pas lancer de sorts ».
  const raging = isSpellCast(activity.item) && isRaging(activity.actor);   // §48 : lire un parchemin aussi
  // §163, §436 : Champ antimagie — aucun sort ne s'y lance ; §436 : ni activité d'objet magique (hors attaque d'arme : dnd5e retire déjà
  // son bonus). Le statut `antimagic` de dnd5e 6.1 d'abord, le globe du §163 sinon.
  // Déjà forcé avant `use` (runtime/antimagic.mjs, `useDespiteAntimagic`) : pas de seconde fenêtre.
  const antimagicArea = (!pilot && magicalUse(activity) && !usageConfig?.[MODULE_ID]?.antimagicForced) ? antimagicAround(usageToken(activity)) : null;
  const antimagic = (antimagicArea && (antimagicArea.status || isSpellCast(activity.item))) ? antimagicArea : null;
  // §269 : Forme gazeuse — « la cible ne peut ni attaquer ni lancer de sorts » (l'action qui y met fin reste permise).
  const shapeless = ((activity.type === "attack") || isSpellCast(activity.item))
    ? (activity.actor?.effects ?? []).map(e => (!e.disabled && !e.isSuppressed) ? originItemOf(e) : null)
      .find(item => item && (item !== activity.item) && (contentOf(item).entry?.noAttacksOrSpells === true)) ?? null
    : null;
  // §284 : Aliénation — « ne peut pas lancer de sorts ni prendre l'action Magie » (sorts, parchemins, objets magiques).
  const magicUse = isSpellCast(activity.item) || (activity.item?.system?.properties?.has?.("mgc") && (activity.activation?.type === "action"));
  const befuddled = magicUse
    ? (activity.actor?.effects ?? []).map(e => (!e.disabled && !e.isSuppressed) ? originItemOf(e) : null)
      .find(item => item && (item !== activity.item) && (contentOf(item).entry?.noSpells === true)) ?? null
    : null;
  // C12-c : une invocation qui n'agit pas librement — le familier n'attaque pas (§107 ne retirait que l'attaque de base) ; le Compagnon
  // primitif ne prend que l'action Esquiver, sauf si son maître le commande (action Bonus « Command ») à ce round.
  const summonRule = summonRuleOf(activity.actor);
  const familiarAttack = !!summonRule?.familiar && (activity.type === "attack");
  const uncommanded = !!summonRule?.commanded && !!combatant && (activity.activation?.type === "action")
    && (basicActionOfActivity(activity) !== "dodge") && (activity.actor.getFlag(MODULE_ID, "commanded") !== (game.combat?.round ?? null));
  // C12-b : « vous ne pouvez pas entrer en Rage si vous portez une armure lourde » (la fin à l'enfilage : runtime/endings.mjs).
  const heavyRage = !!contentOf(activity.item).entry?.rage
    && (activity.actor?.items ?? []).some(i => (i.type === "equipment") && i.system?.equipped && (i.system?.type?.value === "heavy"));
  // §214 : armure portée sans formation — pas de sorts.
  const unarmored = isSpellCast(activity.item) ? untrainedArmor(activity.actor) : null;
  // §367 : Tempête de vengeance — pas d'attaque à distance avec une arme depuis la zone ; Marche dans l'ombre — pas depuis un lieu éclairé.
  const storm = (!pilot && isRangedWeaponAttack(activity, attackMode)) ? rangedBanAround(usageToken(activity)) : null;
  // §403 : Rayon de lune — pas d'autre forme dans la lumière (une activité « transform » de dnd5e : Forme sauvage, Métamorphose sur soi).
  const formLocked = ((activity.type === "transform") && usageToken(activity)) ? formLockAround(usageToken(activity)) : null;
  const bright = (!pilot && usageToken(activity) && selfTeleportOf(activity)) ? (tooBrightFor(activity, usageToken(activity)) === "from") : false;
  const budgetLines = issues.map(i => loc(`Souci.${i}`));
  const lines = [
    ...budgetLines,
    ...(storm ? [loc("Souci.noRangedWeapons", { item: storm.name })] : []),
    ...(formLocked ? [loc("Souci.formLocked", { item: formLocked.name })] : []),
    ...(bright ? [loc("Souci.tooBright", { item: activity.item.name })] : []),
    ...(outOfAmmunition(activity, attackMode) ? [loc("Souci.noAmmunition", { item: activity.item.name })] : []),
    ...(silenced ? [loc("Souci.silenced")] : []),
    ...(handsFull ? [loc("Souci.noFreeHand", { items: handsFull.items.join(", ") })] : []),
    ...missing.keys.map(k => loc(`Souci.${k}`, { item: activity.item.name })),
    ...(raging ? [loc("Souci.rage")] : []),
    ...(heavyRage ? [loc("Souci.rageHeavyArmor")] : []),
    ...(familiarAttack ? [loc("Souci.familiarAttack")] : []),
    ...(uncommanded ? [loc("Souci.notCommanded")] : []),
    ...(shapeless ? [loc("Souci.noAttacksOrSpells", { item: shapeless.name })] : []),
    ...(befuddled ? [loc("Souci.noSpells", { item: befuddled.name })] : []),
    ...(unarmored ? [loc("Souci.untrainedArmor", { item: unarmored.name })] : []),
    ...(antimagic ? [loc(isSpellCast(activity.item) ? "Souci.antimagic" : "Souci.antimagicItem",
      { item: antimagic.name, use: activity.item.name })] : []),
    ...limits.issues.map(i => loc(`Souci.${i}`, { item: limits.item ?? "" })),
    ...incapacitated.map(i => loc(`Souci.${i}`))
  ];
  return { combatant, budget, own, request, cost, lines, budgetLines, missing };
}

/**
 * §142 : une arme à munitions d'un personnage sans munition restante — dnd5e liste ses munitions (`ammunitionOptions`,
 * data/item/weapon.mjs : consommables « ammo » du bon sous-type, désactivés à 0) mais tire quand même sans elles. Pas pour un PNJ : un
 * arc de bestiaire n'a souvent aucune flèche sur la fiche. Une attaque au corps à corps (arme improvisée) n'en a pas besoin.
 */
function outOfAmmunition(activity, attackMode) {
  const item = activity?.item;
  if ( (activity?.type !== "attack") || (item?.type !== "weapon") || (activity.actor?.type !== "character") ) return false;
  if ( !item.system.properties?.has?.("amm") ) return false;
  if ( attackMode && !attackMode.startsWith("ranged") ) return false;
  return !(item.system.ammunitionOptions ?? []).some(o => !o.disabled);
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
  // §90 : Frappe commandée — l'attaque d'arme (ou à mains nues) ordonnée ce tour se paie par la Réaction, hors de l'action Attaquer.
  const strike = (activity?.type === "attack") && ["weapon", "unarmed"].includes(activity.attack?.type?.classification);
  if ( strike && budget.commanded && (budget.commanded.turn === currentTurnKey()) ) return { ...request, cost: "reaction", weaponAttack: false, commanded: true };
  // §27 : Prêtre de guerre — l'attaque ouverte vaut aussi pour une arme.
  const weapon = (activity?.type === "attack") && (activity.item?.type === "weapon");
  if ( ((budget.flurry ?? 0) > 0) && (isUnarmedStrike(activity) || (budget.flurryAny && weapon)) ) return { ...request, cost: "free", flurry: true };
  if ( !isUnarmedStrike(activity) ) return request;
  const martial = activity.actor?.items.some(i => contentOf(i).entry?.martialArts === true);
  const actionLeft = (budget.action >= 1) || (budget.attacks.used < budget.attacks.granted);
  if ( martial && (request.cost === "action") && !actionLeft && (budget.bonus >= 1) ) return { ...request, cost: "bonus", weaponAttack: false };
  return request;
}

/* -------------------------------------------- */
/*  K5 (§326) : actions légendaires              */
/* -------------------------------------------- */

const isLegendary = activity => activity?.activation?.type === "legendary";

/**
 * Les soucis d'une action légendaire (règle 2024 : « immédiatement après le tour d'une autre créature », pas pendant le sien, une à la
 * fois, tant qu'il en reste) : à son propre tour, sans action légendaire restante, ou déjà une pendant ce tour-ci.
 */
export function legendaryIssues(activity, combatant, own) {
  if ( !isLegendary(activity) || !combatant || (activity.actor?.type !== "npc") ) return [];
  const legact = activity.actor.system?.resources?.legact;
  if ( !legact?.max ) return [];
  const cost = Number(activity.activation?.value) || 1;
  const name = activity.actor.name;
  const out = [];
  if ( own ) out.push(loc("Souci.legendaryOwnTurn", { name }));
  if ( (legact.value ?? 0) < cost ) out.push(loc("Souci.legendarySpent", { name, left: legact.value ?? 0 }));
  if ( activity.actor.getFlag(MODULE_ID, "legendaryTurn") === currentTurnKey() ) out.push(loc("Souci.legendaryOnce", { name }));
  // K12 (§333) : « can't take this action again until the start of its next turn ».
  if ( activity.actor.getFlag(MODULE_ID, `legendaryLocked.${activity.item.id}`) ) out.push(loc("Souci.legendaryAgain", { name, item: activity.item.name }));
  return out;
}

/** L'attaque qu'une action légendaire vient d'annoncer (« makes one Tail attack ») : ouverte pour ce tour-ci, tant qu'il en reste. */
function legendaryWindowOpen(actor) {
  const w = actor?.getFlag?.(MODULE_ID, "legendaryWindow");
  return !!w && (w.turn === currentTurnKey()) && (w.left > 0);
}

/** K12 (§333) : une action légendaire qui ne revient qu'au début du prochain tour de la créature. */
const LEGENDARY_AGAIN = /can['’]t (?:take|use) (?:this|that) (?:legendary )?(?:action|ability)? ?again until the start of (?:its|their|his|her) next turn/i;

const COUNT_WORDS = { one: 1, an: 1, a: 1, two: 2, three: 3 };

/**
 * Après une action légendaire (MJ) : le coût est dépensé (`resources.legact.spent`, que dnd5e remet à zéro à la fin du tour de la
 * créature — data/actor/npc.mjs, `recoverCombatUses`) sauf si la donnée le dépense déjà ; le tour est noté ; et l'attaque que le texte
 * annonce (« makes one Tail attack », « makes two Claw attacks ») est ouverte : elle passera sans souci « pas son tour », gratuite.
 */
async function onLegendaryUsed(activity) {
  if ( !isLegendary(activity) || (activity.actor?.type !== "npc") || !game.combat?.started ) return;
  const actor = activity.actor;
  const legact = actor.system?.resources?.legact;
  if ( !legact?.max ) return;
  const cost = Number(activity.activation?.value) || 1;
  const consumes = (activity.consumption?.targets ?? []).some(t => String(t.target ?? "").includes("legact"));
  const text = String(activity.item?.flags?.babele?.originalPayload?.description ?? activity.item?.system?.description?.value ?? "")
    .replace(/<[^>]+>/g, " ").replace(/\[\[[^\]]*\]\]/g, "…");
  const m = text.match(/\bmakes? (one|an?|two|three|\d) [^.]*?\battacks?\b/i);
  const left = m ? (COUNT_WORDS[m[1].toLowerCase()] ?? (Number(m[1]) || 1)) : 0;
  const turn = currentTurnKey();
  const update = { [`flags.${MODULE_ID}.legendaryTurn`]: turn, [`flags.${MODULE_ID}.legendaryWindow`]: { turn, left } };
  if ( LEGENDARY_AGAIN.test(text) ) update[`flags.${MODULE_ID}.legendaryLocked.${activity.item.id}`] = true;
  if ( !consumes ) update["system.resources.legact.spent"] = Math.min(legact.max, (Number(legact.spent) || 0) + cost);
  await actor.update(update);
  log(`${actor.name}: legendary action ${activity.item.name} (${cost}), ${Math.max(0, (legact.value ?? 0) - (consumes ? 0 : cost))} left${left ? `, ${left} attack(s) to follow` : ""}`);
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
  // §410 : plus d'emplacement pour une règle `lowestSlot` — plus de refus sec : la fenêtre de légalité le dit (`missingResources`, cible
  // « spellSlots »), le joueur peut forcer sans le dépenser.
  applyLowestSlot(activity, usageConfig, dialogConfig);
  // §65 : une action de base au choix (Échappée agile : Se désengager OU Se cacher) — demandée avant tout, puis l'utilisation repart.
  const choices = basicChoiceOf(activity);
  if ( choices && !choices.includes(usageConfig[MODULE_ID]?.basicChoice) ) {
    foundry.applications.api.DialogV2.wait({
      window: { title: activity.item.name },
      content: `<p>${loc("ActionAuChoix")}</p>`,
      buttons: choices.map((kind, i) => ({ action: kind, label: loc(`Action.${kind}.Nom`), default: i === 0 })),
      rejectClose: false
    }).then(kind => {
      if ( !choices.includes(kind) ) return;
      activity.use({ ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), basicChoice: kind } }, dialogConfig, messageConfig);
    });
    return false;
  }
  for ( const key of ["choice", "attackMode", "saveChoice", "legendary", "autoReact", "recast", "cost", "damageType", "order", "cleave", "metamagic", "basicChoice", "ammunition", "overridden"] ) {
    const value = usageConfig[MODULE_ID]?.[key];
    if ( value && messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.${key}`, value);
  }
  // K5 (§326) : l'attaque qu'une action légendaire vient d'annoncer — hors de son tour, sans souci ni Réaction, gratuite.
  if ( !isLegendary(activity) && legendaryWindowOpen(activity.actor) ) {
    const w = activity.actor.getFlag(MODULE_ID, "legendaryWindow");
    activity.actor.setFlag(MODULE_ID, "legendaryWindow", { ...w, left: w.left - 1 });
    if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.cost`, "free");
    log(`${activity.actor.name}: ${activity.item.name} as part of a legendary action`);
    return true;
  }
  if ( usageConfig[MODULE_ID]?.confirmed ) return true;
  // Une activité lancée sans cible est déjà passée en mode visée avant d'arriver ici (ui/pointer.mjs, inscrit avant).
  // Mode d'attaque déjà choisi par le clic (« main secondaire » du menu : `engage`), sinon inconnu jusqu'au jet.
  // Un coût imposé par l'intention (§16.26 : Taille, une attaque d'arme pour l'action Bonus), sinon celui de l'activation.
  const use = useIssues(activity, { cost: usageConfig[MODULE_ID]?.cost ?? null,
    attackMode: usageConfig[MODULE_ID]?.attackMode ?? null, recast: !!usageConfig[MODULE_ID]?.recast, usageConfig });
  const { combatant, budget, own, request } = use;
  const legend = legendaryIssues(activity, combatant, own);
  const range = assessRange(activity);
  // Furtivité : il faut être hors du champ de vision de tout ennemi (règle 2024, adapter/hide.mjs).
  const seenBy = (basicActionOfActivity(activity, usageConfig[MODULE_ID]?.basicChoice) === "hide") ? (enemiesSeeing(usageToken(activity)) ?? []) : [];
  // §16.8 : « choisissez un Humanoïde » — les cibles désignées d'un autre type ne seront pas affectées.
  const origin = usageToken(activity);
  const wrongType = Array.from(game.user.targets).filter(t => (t.document !== origin) && t.actor)
    .map(t => ({ name: t.name, types: wrongTypeFor(activity, t.actor) })).filter(t => t.types);
  // §17.3 : Charmé (pas contre qui nous a charmé) ; « une créature que vous pouvez voir ».
  const aimed = Array.from(game.user.targets).filter(t => (t.document !== origin) && t.actor);
  const charmers = hostileToCharmer(activity) ? charmersOf(activity.actor) : new Set();
  const charmed = aimed.filter(t => charmers.has(t.actor.uuid));
  const offPlane = origin ? aimed.filter(t => !samePlane(origin, t.document)) : [];   // §225 : pas d'un plan à l'autre
  const unseen = (origin && sightRequired(activity)) ? aimed.filter(t => canSee(origin, t.document) === false) : [];
  // §62 : une créature cachée, ni vue ni perçue autrement, n'a pas de position connue — pas de cible (une zone, si).
  // §163 : Coquille antivie — pas de coup au corps à corps à travers la barrière.
  const fenced = origin ? aimed.map(t => ({ name: t.name, zone: barrierBetween(origin, t.document, activity) })).filter(t => t.zone) : [];
  // §367 : Tempête de vengeance — ni vers une cible dans la zone (depuis la zone : `useIssues`).
  const stormed = isRangedWeaponAttack(activity, usageConfig[MODULE_ID]?.attackMode ?? null)
    ? aimed.map(t => ({ name: t.name, item: rangedBanAround(t.document) })).filter(t => t.item) : [];
  // §286 : Chaîne d'éclairs — les cibles secondaires à 9 m de la première.
  const chained = chainOutliers(activity, aimed.map(t => t.document));
  const lost = (origin && !activity.target?.template?.type) ? aimed.filter(t => !unseen.includes(t)
    && locationUnknown({ hidden: hiddenDcOf(t.actor) !== null, sees: canSee(origin, t.document) })) : [];
  // §411 : ce que le clic a déjà relevé et que la légalité ne voit pas (contact, ligne de vue, approche impossible, type de cible,
  // lien, Enchaînement, rebond) — `issues` : des raisons traduites ; `issuesCoverRange` : elles disent déjà la portée.
  const extra = (usageConfig[MODULE_ID]?.issues ?? []).filter(l => typeof l === "string" && l);
  if ( extra.length && usageConfig[MODULE_ID]?.issuesCoverRange ) range.blocking = [];
  if ( !extra.length && !use.lines.length && !legend.length && !range.blocking.length && !seenBy.length && !wrongType.length && !charmed.length && !unseen.length && !lost.length && !fenced.length && !stormed.length && !offPlane.length && !chained.length ) return true;

  const lines = mergeIssues(
    extra,
    ...use.lines,
    ...legend,
    ...range.blocking.map(r => loc((r.issue === "tooClose") ? "Souci.tooClose" : "Souci.outOfRange", { name: r.name })),
    ...(seenBy.length ? [loc("Souci.hideSeen", { names: seenBy.map(t => t.name).join(", ") })] : []),
    ...wrongType.map(t => loc("Souci.wrongType", { name: t.name, types: typesLabel(t.types), item: activity.item.name })),
    ...charmed.map(t => loc("Souci.charmed", { name: t.name })),
    ...offPlane.map(t => loc("Souci.otherPlane", { name: t.name })),
    ...unseen.map(t => loc("Souci.notSeen", { name: t.name })),
    ...lost.map(t => loc("Souci.hiddenTarget", { name: t.name })),
    ...fenced.map(t => loc("Souci.barrier", { name: t.name, item: t.zone.item.name })),
    ...stormed.map(t => loc("Souci.noRangedWeaponsAt", { name: t.name, item: t.item.name })),
    ...chained.map(t => loc("Souci.chainTooFar", { name: t.name, first: aimed[0].name, distance: chainLimit(chainOf(activity.item), aimed[0].document),
      units: aimed[0].document.parent.grid.units }))
  );
  // Une action tentée hors de son tour est souvent une réaction (attaque d'opportunité).
  const asReaction = !!combatant && !own && (request.cost === "action") && (budget.reaction > 0);
  const buttons = [{ action: "go", label: loc("UtiliserQuandMeme"), default: !asReaction }];
  if ( asReaction ) buttons.unshift({ action: "reaction", label: loc("UtiliserMaReaction"), default: true });
  buttons.push({ action: "cancel", label: loc("Renoncer") });

  confirmDialog(`${activity.item.name} — ${combatant?.name ?? activity.actor?.name ?? ""}`, lines, buttons, activity.actor ?? null).then(choice => {
    if ( (choice !== "go") && (choice !== "reaction") ) return;
    acknowledge(range.key);
    if ( range.blocking.length ) rememberForced(range.key, range.blocking);   // §416 : le jet d'attaque ne redemande pas
    // §408 : ce qui est passé outre — le MJ et la table prévenus, la carte marquée (« Utiliser ma Réaction » règle le budget).
    const reasons = forcedReasons({ lines, budgetLines: use.budgetLines, action: choice });
    if ( reasons.length ) reportForced({ actor: activity.actor, item: activity.item, reasons, targets: aimed.map(t => t.name), token: origin })
      .catch(err => console.error(`${MODULE_ID} | forced: alert`, err));
    // Les options du moteur déjà posées (choix de la lumière, cibles désignées…) repartent avec la confirmation.
    const config = { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), confirmed: true,
      // §436 : une raison déjà passée outre avant `use` (antimagie, runtime/antimagic.mjs) reste sur la carte.
      ...(reasons.length ? { overridden: overriddenFlag([...(usageConfig?.[MODULE_ID]?.overridden ?? []), ...reasons]) } : {}) } };
    const message = foundry.utils.mergeObject(messageConfig ?? {}, choice === "reaction"
      ? { data: { flags: { [MODULE_ID]: { cost: "reaction" } } } } : {}, { inplace: false });
    // §410 : ce qui manque n'est pas dépensé — la relance « forcée » du §77 (runtime/usage.mjs : rien n'est consommé, le sort à son niveau).
    // Sans la fenêtre de dnd5e, comme l'ancienne relance du §77 : la forme d'une invocation, le profil d'un enchantement se choisissent
    // dans celles du moteur (ui/pointer.mjs, `forced`).
    const forcedUse = use.missing.keys.some(k => ["noSlot", "noUses", "noQuantity"].includes(k));
    if ( forcedUse ) config[MODULE_ID].forced = true;
    const relaunch = () => activity.use(config, forcedUse ? { ...(dialogConfig ?? {}), configure: false } : dialogConfig, message);
    // §436 : déjà forcé dans un champ antimagie — la relance lève encore le champ, sinon dnd5e la refuse sans carte.
    if ( usageConfig?.[MODULE_ID]?.antimagicForced ) withAntimagicLifted(activity.actor, activity.item, relaunch)
      .catch(err => console.error(`${MODULE_ID} | antimagic: relaunch`, err));
    else relaunch();
  });
  return false;
}

/** §149 : l'autre main est-elle prise — un bouclier, ou une autre arme tenue (pas une arme naturelle ni la frappe à mains nues) ? */
function otherHandBusy(item) {
  return Array.from(item?.actor?.items ?? []).some(i => (i !== item) && i.system?.equipped && (
    ((i.type === "equipment") && (i.system.type?.value === "shield"))
    || ((i.type === "weapon") && (i.system.type?.value !== "natural") && (identifierOf(i).id !== "unarmed-strike"))));
}

/** §149 : arme Polyvalente — à deux mains quand l'autre main est libre (core/attack.mjs, `versatileGrip`). */
function gripVersatile(config, activity, { explicit }) {
  const item = activity?.item;
  if ( (item?.type !== "weapon") || !item.system.properties?.has?.("ver") ) return;
  const versatile = item._source?.system?.damage?.versatile;
  const twoHandedDamage = !(versatile?.custom?.enabled && !versatile.custom.formula?.trim());   // §151
  const mode = versatileGrip({ mode: config.attackMode ?? null, modes: (item.system.attackModes ?? []).map(m => m.value),
    explicit, otherHandBusy: otherHandBusy(item), twoHandedDamage,
    prefersOneHand: Array.from(item.actor?.items ?? []).some(i => identifierOf(i).id === "dueling") });   // §295 : style Duel
  if ( !mode ) return;
  config.attackMode = mode;
  if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = mode;
}

/**
 * Avant le dialogue du jet d'attaque : une arme de mêlée qui se lance, contre des cibles toutes
 * hors d'allonge, est présélectionnée en mode « lancer ». Le joueur garde la main dans le dialogue.
 */
function onPreRollAttack(config, dialog, message) {
  const activity = config.subject;
  // §150 : le mode porté par la carte d'utilisation (`flags["dnd5e-combat"].attackMode`, posé à l'utilisation depuis la configuration :
  // la main secondaire de la Barre) — le jet que dnd5e enchaîne lui-même (activity/attack.mjs, `_triggerSubsequentActions` :
  // `system.origin`) ne passe pas par `engage`, qui seul retenait le mode d'un clic.
  const usageId = message?.data?.system?.origin ?? null;
  const carried = usageId ? game.messages.get(usageId)?.getFlag(MODULE_ID, "attackMode") : null;
  // Attaque engagée à la souris : le mode (« lancer ») est déjà choisi, et le jet part sans dialogue.
  const pending = activity?.uuid ? takePendingAttack(activity) : null;
  if ( !pending?.mode && carried && activity?.item?.system.attackModes?.some(m => m.value === carried) ) {
    config.attackMode = carried;
    if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = carried;
    if ( pending?.fast && dialog ) dialog.configure = false;
    if ( pending?.confirmed ) config[MODULE_ID] = { ...(config[MODULE_ID] ?? {}), confirmed: true };
    return true;
  }
  if ( pending ) {
    if ( pending.fast && dialog ) dialog.configure = false;
    if ( pending.confirmed ) config[MODULE_ID] = { ...(config[MODULE_ID] ?? {}), confirmed: true };   // portée déjà acceptée
    if ( pending.mode && activity.item?.system.attackModes?.some(m => m.value === pending.mode) ) {
      config.attackMode = pending.mode;
      if ( config.rolls?.[0]?.options ) config.rolls[0].options.attackMode = pending.mode;
      return true;
    }
  }
  // §149 : un mode « choisi » — demandé, ni repris de la mémoire de dnd5e, ni celui par défaut.
  const byDefaultMode = activity?.item?.system.attackModes?.[0]?.value ?? null;
  const rememberedMode = activity?.item?.getFlag?.("dnd5e", `last.${activity.id}.attackMode`) ?? null;
  const explicit = !!config[MODULE_ID]?.modeChosen
    || (!!config.attackMode && (config.attackMode !== byDefaultMode) && (config.attackMode !== rememberedMode));
  // Seule la relance après la fenêtre de portée a déjà choisi son mode (`modeChosen`) ; une attaque simplement confirmée
  // (connecteur, visée) garde la présélection — sans elle, une javeline lancée partait en mêlée, sans `system.mode` sur le
  // message ni javeline dépensée (vu le 2026-09-28, style Armes de jet).
  if ( config[MODULE_ID]?.modeChosen || !activity?.item || !canBeThrown(activity) ) {
    gripVersatile(config, activity, { explicit });
    return true;
  }
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
  gripVersatile(config, activity, { explicit });
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
  // §416 : portée déjà passée outre à l'utilisation — pas de seconde fenêtre ni de seconde alerte, la carte d'attaque reste marquée.
  if ( range.forced?.length && messageConfig ) {
    const forcedLines = range.forced.map(r => loc((r.issue === "tooClose") ? "Souci.tooClose" : "Souci.outOfRange", { name: r.name }));
    foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.overridden`, overriddenFlag(forcedReasons({ lines: forcedLines, action: "go" })));
  }
  if ( !range.blocking.length ) return true;

  const beyondReach = canBeThrown(activity) && !options.attackMode?.startsWith("thrown");
  const lines = range.blocking.map(r => loc((r.issue === "tooClose") ? "Souci.tooClose" : (beyondReach ? "Souci.outOfReach" : "Souci.outOfRange"), { name: r.name }));
  const buttons = [{ action: "go", label: loc("AttaquerQuandMeme"), default: true }, { action: "cancel", label: loc("Renoncer") }];
  confirmDialog(`${activity.item.name} — ${activity.actor?.name ?? ""}`, lines, buttons, activity.actor ?? null).then(choice => {
    if ( choice !== "go" ) return;
    acknowledge(range.key);
    // §408 : la portée passée outre au jet — le MJ et la table prévenus, la carte d'attaque marquée.
    const reasons = forcedReasons({ lines, action: choice });
    reportForced({ actor: activity.actor, item: activity.item, reasons, targets: range.blocking.map(r => r.name), token: usageToken(activity) })
      .catch(err => console.error(`${MODULE_ID} | forced: alert`, err));
    // On repart d'une configuration neuve, avec les choix déjà faits dans le dialogue.
    const { ability, ammunition, attackMode, mastery, advantageMode } = options;
    activity.rollAttack({
      event: config.event, ability, ammunition, attackMode, mastery,
      advantage: advantageMode === 1, disadvantage: advantageMode === -1,
      [MODULE_ID]: { confirmed: true, modeChosen: true, ammoChosen: true }
    }, { configure: false },
    { data: { system: { origin: foundry.utils.getProperty(messageConfig ?? {}, "data.system.origin") },
      flags: { [MODULE_ID]: { overridden: overriddenFlag(reasons) } } } });
  });
  return false;
}

/* -------------------------------------------- */
/*  Dépense et remise à zéro, par le MJ actif   */
/* -------------------------------------------- */

const WASTE_QUERY = `${MODULE_ID}.wasteUse`;

/**
 * §298 (repasse C3) : une utilisation qui ne part pas mais dont l'action est perdue — un sort contré (Contresort 2024 : « l'action,
 * l'action Bonus ou la Réaction utilisée pour le lancer est perdue ; l'emplacement n'est pas dépensé »), un sort raté sous Lenteur.
 * Le coût de l'activité est débité au budget de son lanceur (sans emplacement, sans « un sort à emplacement par tour »). MJ actif.
 */
async function handleWasteUse({ activity: uuid }) {
  const activity = await fromUuid(uuid ?? "");
  const combatant = combatantFor(activity?.actor);
  if ( !activity || !combatant || !game.combat?.started ) return false;
  const before = readBudget(combatant);
  const request = { ...requestFor(activity), usesSpellSlot: false };
  if ( !request.cost || (request.cost === "free") ) return false;
  const after = spendUse(before, request, { isOwnTurn: isOwnTurn(combatant), attacksPerAction: attacksPerAction(combatant.actor), turnKey: currentTurnKey() });
  await writeBudget(combatant, after);
  log(`${combatant.name}: ${activity.item?.name ?? activity.name} wasted — ${request.cost} spent`);
  return true;
}

/** §298 : l'action d'une utilisation qui n'a pas eu lieu est perdue (Contresort, échec sous Lenteur). */
export function wasteUse(activity) {
  return viaActiveGM(WASTE_QUERY, handleWasteUse, { activity: activity.uuid }, { fallback: false });
}

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
  // §65 : une action au choix ne vaut que celle choisie à l'utilisation (notée sur la carte).
  const declared = basicChoiceOf(activity) ? basicActionOfActivity(activity, message.getFlag(MODULE_ID, "basicChoice"))
    : (contentOf(activity.item).entry?.basicActions?.[activity.id] ?? null);
  const request = kind ? null : monkRequest(activity, requestFor(activity, message.getFlag(MODULE_ID, "cost") ?? null,
    { attackMode: message.getFlag(MODULE_ID, "attackMode") ?? null }), before);
  // §24 : une frappe du Déluge de coups — gratuite, décomptée, et notée sur la carte (Technique de la main ouverte).
  if ( request?.flurry ) {
    const left = Math.max(0, (before.flurry ?? 0) - 1);
    await writeBudget(combatant, { ...before, flurry: left, flurryAny: left ? !!before.flurryAny : false });
    await message.setFlag(MODULE_ID, "flurry", true);
    log(`${combatant.name}: Flurry of Blows strike (${Math.max(0, (before.flurry ?? 0) - 1)} left)`);
    return;
  }
  // §21 : Fougue — « une action supplémentaire » ; l'activité (« spéciale ») ne coûte rien.
  if ( contentOf(activity.item).entry?.grantsAction === true ) {
    await writeBudget(combatant, { ...before, action: (before.action ?? 0) + 1 });
    log(`${combatant.name}: one more action (${activity.item.name})`);
    return;
  }
  if ( request && (!request.cost || (request.cost === "free")) ) {   // §16.27 : un projectile enchaîné ne coûte rien
    // K5 (§334) : une action légendaire (hors budget) qui « se déplace sans provoquer d'attaque d'opportunité » libère quand même le
    // trajet (Corne chargeante de la Licorne, Charge du Loup-garou).
    if ( !before.disengaged && freesMovement(activity.item) ) await writeBudget(combatant, { ...before, disengaged: true });
    return;
  }
  if ( request && message.getFlag(MODULE_ID, "recast") ) {
    request.usesSpellSlot = false;
    const recastCost = contentOf(activity.item).entry?.recastCost;
    if ( recastCost ) request.cost = recastCost;   // §164
  }
  let after = kind ? basicAction(before, kind)
    : spendUse(before, request, { isOwnTurn: isOwnTurn(combatant), attacksPerAction: attacksPerAction(combatant.actor), turnKey: currentTurnKey() });
  for ( const k of [declared].flat() ) if ( k && BASIC_ACTION_FLAGS[k] ) after = (k === "dash") ? addDash(after) : { ...after, [BASIC_ACTION_FLAGS[k]]: true };
  if ( request?.commanded ) after = { ...after, commanded: null };   // §90 : l'ordre est servi
  // §211 : l'action préparée est libérée — le plan est servi avec la Réaction (écrit ici, d'une seule écriture, pour ne pas croiser).
  if ( message.getFlag(MODULE_ID, "readiedRelease") ) after = { ...after, readied: false };
  // §24 : Déluge de coups — les frappes à mains nues qu'il ouvre.
  const flurry = contentOf(activity.item).entry?.flurry;
  if ( flurry && [flurry.activity].flat().includes(activity.id) ) {
    // §295 : Credo accru (Moine 10) — « trois frappes à mains nues au lieu de deux » : le plus grand `flurryStrikes` des items du porteur.
    const strikes = Math.max(flurry.strikes, ...Array.from(combatant.actor?.items ?? []).map(i => contentOf(i).entry?.flurryStrikes ?? 0));
    after = { ...after, flurry: strikes, flurryAny: flurry.weapons === true };
  }
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
    log(`${combatant.name}: +${movement.speed / 2} ${movement.units} of movement${disengage ? " without provoking Opportunity Attacks" : ""} (${activity.item.name})`);
  }
  // §18.15 : « se déplace … sans provoquer d'attaque d'opportunité » — le reste du tour, comme après Se désengager.
  if ( !after.disengaged && freesMovement(activity.item) ) after = { ...after, disengaged: true };
  await writeBudget(combatant, after);
  // §133 : l'action Se désengager prise (pas celle qu'une aptitude donne en marchant) — Sentinelle peut réagir.
  if ( ((kind === "disengage") || [declared].flat().includes("disengage")) && combatant.token ) windowDisengaged(combatant.token);
  // Consigné sur la carte : une annulation avant tout jet (runtime/cancel.mjs) rend exactement cette dépense.
  await message.setFlag(MODULE_ID, "spent", { combatant: combatant.id, before, after, offhand: !!request?.offhand });
  log(`${combatant.name}: ${kind ?? (request.offhand ? "off hand" : request.cost)} (${activity.item.name})`);
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
    await sleep(100);
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
  log(`${combatant.name}: off hand chosen at the roll, spending corrected (${activity.item.name})`);
}

/** Carte supprimée par une annulation avant tout jet : la dépense qu'elle avait faite est rendue. */
async function onUsageCancelled(message) {
  if ( !message.getFlag(MODULE_ID, "cancelled") ) return;
  const spent = message.getFlag(MODULE_ID, "spent");
  const combatant = spent ? game.combat?.combatants.get(spent.combatant) : null;
  if ( !combatant ) return;
  await writeBudget(combatant, refundUse(readBudget(combatant), spent.before, spent.after));
  if ( spent.command ) await refundCommand(combatant, spent.command);
  log(`${combatant.name}: spending refunded (action cancelled before any roll)`);
}

async function resetBudget(combatant) {
  if ( combatant ) await writeBudget(combatant, freshBudgetFor(combatant));
  // K12 (§333) : les actions légendaires verrouillées reviennent au début de son tour.
  if ( combatant?.actor?.getFlag(MODULE_ID, "legendaryLocked") ) await combatant.actor.unsetFlag(MODULE_ID, "legendaryLocked").catch(() => {});
}

/* -------------------------------------------- */

/** C12-c : la règle `summon` de l'item qui a invoqué cet acteur, ou null. */
function summonRuleOf(actor) {
  const origin = actor?.getFlag?.("dnd5e", "summon.origin");
  const item = origin ? fromUuidSync(origin, { strict: false }) : null;
  return item ? (contentOf(item).entry?.summon ?? null) : null;
}

/**
 * C12-c : l'ordre donné à une invocation (`summon.commanded.activity` : « Command » du Compagnon primitif) — ses invocations de cet item
 * sont commandées pour ce round (`flags.dnd5e-combat.commanded`). Sur le client de l'auteur, qui possède la bête.
 */
async function markCommanded(activity) {
  const item = activity?.item;
  const rule = item ? contentOf(item).entry?.summon?.commanded : null;
  if ( !rule || (rule.activity !== activity.id) ) return;
  const round = game.combat?.round ?? null;
  // Par l'id de l'item d'origine : un lanceur non lié (token) a un acteur synthétique, l'origine de l'invocation peut nommer l'acteur du monde.
  for ( const token of canvas?.scene?.tokens ?? [] ) {
    const origin = token.actor?.getFlag("dnd5e", "summon.origin") ?? "";
    if ( !origin.endsWith(`Item.${item.id}`) ) continue;
    if ( token.actor?.isOwner ) await token.actor.setFlag(MODULE_ID, "commanded", round);
    log(`${item.name}: ${token.name} is commanded this round`);
  }
}

export function registerTurn() {
  registerSomaticHandsSetting();   // §409 : le contrôle de main libre (composante somatique)
  route("dnd5e.postUseActivity", activity => markCommanded(activity), { label: "summon command not recorded" });
  CONFIG.queries[WASTE_QUERY] = handleWasteUse;
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "use legality" });
  route("dnd5e.postUseActivity", activity => markUsedThisTurn(activity), { label: "\"once per turn\" limit not recorded" });
  route("dnd5e.postUseActivity", activity => onLegendaryUsed(activity), { label: "legendary action not spent" });
  route("dnd5e.preRollAttackV2", onPreRollAttack, { cancellable: true, label: "attack mode preselected" });
  route("dnd5e.postAttackRollConfiguration", onPostAttackRollConfiguration, { cancellable: true, label: "attack roll range" });

  route("createChatMessage", message => (message.type === "usage") ? onUsageMessage(message)
    : (message.type === "attack") ? onAttackMessage(message) : null,
    { executor: true, label: "budget: spending not recorded" });

  route("deleteChatMessage", message => (message.type === "usage") ? onUsageCancelled(message) : null,
    { executor: true, label: "budget: spending refunded on cancel" });

  // La réaction et le reste se récupèrent au début du tour du combattant.
  route("combatTurnChange", (combat, prior, current) => resetBudget(combat.combatants.get(current.combatantId)),
    { executor: true, label: "budget: turn reset" });
  route("combatStart", combat => Promise.all(combat.combatants.map(resetBudget)),
    { executor: true, label: "budget: combat reset" });
}
