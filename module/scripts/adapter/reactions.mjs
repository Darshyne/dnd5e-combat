/**
 * Réactions : qui peut réagir, comment le lui demander, et ce que son choix déclenche.
 *
 * Vérifié :
 *  - requêtes entre clients du cœur : `CONFIG.queries[nom] = (données, {timeout}) => résultat`,
 *    appelées par `user.query(nom, données, {timeout})` (client/config.mjs:2964, user.mjs:289).
 *    La réponse est le signal ; le délai n'est qu'un filet (SPEC §5.3).
 *  - ce qu'un item déclare (fenêtre, cible) vient du registre : content/triggers.mjs, ou
 *    `flags["dnd5e-combat"].triggers` sur l'item (adapter/triggers.mjs)
 *  - Bouclier officiel (packs/_source/spells24/1st-level/shield.yml) : identifiant `shield`,
 *    activité utilitaire, activation « réaction », cible « soi », effet CA +5 jusqu'au début du
 *    prochain tour du lanceur (`expiry: sourceStart`, natif en 6.0).
 *  - utiliser une activité d'attaque enchaîne son jet d'attaque (activity/attack.mjs:68-70).
 */

import { MODULE_ID } from "../constants.mjs";
import { reactionAvailable } from "../core/turn.mjs";
import { eligibleReactions } from "../core/reaction.mjs";
import { stepsOf } from "../core/triggers.mjs";
import { rollerFor } from "./concentration.mjs";
import { timedWait } from "./dialogs.mjs";
import { contentOf } from "./content.mjs";
import { markReactionAdvantage, markReactionDamage } from "./marks.mjs";
import { combatantFor, readBudget, currentTurnKey } from "./turn.mjs";
import { originItemOf } from "./facts.mjs";
import { resolveCounter } from "./counter.mjs";

export const REACTION_QUERY = `${MODULE_ID}.reaction`;

/** Délai de sécurité d'une demande de réaction. Le MJ n'attend jamais plus. */
const REACTION_TIMEOUT = 20000;   // au-delà du délai de la fenêtre (adapter/dialogs.mjs) : le joueur n'a plus la main

/** §16.47 : l'acteur porte-t-il un effet d'un sort qui interdit les Réactions (`noReactions` : Tentacules de Hadar) ? */
export function reactionsBlocked(actor) {
  return (actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed && (contentOf(originItemOf(e))?.entry?.noReactions === true));
}

/** §77 : l'acteur porte-t-il un effet qui ne laisse qu'une action OU une action Bonus par tour (`actionOrBonus` : Nuage fétide) ? */
export function actionOrBonusOnly(actor) {
  return (actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed && (contentOf(originItemOf(e))?.entry?.actionOrBonus === true));
}

/** §23 : le porteur d'un effet d'item `noOpportunityAttacks` (Poigne électrique) ne fait pas d'attaque d'opportunité. */
export function opportunityBlocked(actor) {
  return (actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed && (contentOf(originItemOf(e))?.entry?.noOpportunityAttacks === true));
}

/** Hors combat la réaction est toujours disponible ; en combat, c'est le budget qui le dit. */
export function reactionState(actor) {
  const combatant = combatantFor(actor);
  return {
    reactionAvailable: combatant ? reactionAvailable(readBudget(combatant), currentTurnKey()) : true,
    // « Ne peut pas réagir » : Neutralisé, mort, ou un effet qui l'interdit.
    incapacitated: actor.statuses?.has("incapacitated") || actor.statuses?.has("dead") || reactionsBlocked(actor) || false
  };
}

/**
 * Les réactions qu'un acteur peut proposer, parmi des déclarations déjà retenues pour la fenêtre
 * (runtime/triggers.mjs). Une option par étape `use` : l'activité de réaction de l'item, ou celle
 * que l'étape nomme ; `targetSource` = la réaction vise qui a provoqué la fenêtre.
 */
export function reactionOptions(actor, window, declarations) {
  return eligibleReactions(declarations, window, reactionState(actor)).flatMap(d => stepsOf(d, "use").map(step => ({
    activity: step.activity ? `${d.item}.Activity.${step.activity}` : d.activity,
    // §72 : une activité nommée de l'item (Bracelet de charme : un sort par activité) — le bouton porte son nom.
    name: activityLabel(d, step), img: d.img, targetSource: step.target === "source", targetSelf: step.target === "self",
    halve: stepsOf(d, "halve").length > 0,
    endCondition: stepsOf(d, "endCondition").length > 0,
    uncrit: stepsOf(d, "uncrit").length > 0,
    reduce: stepsOf(d, "reduce").length > 0,
    reduceBonus: stepsOf(d, "reduce")[0]?.bonus ?? null,
    miss: stepsOf(d, "miss").length > 0,
    penalty: stepsOf(d, "penalty")[0]?.formula ?? null,
    bonus: stepsOf(d, "bonus")[0]?.formula ?? null,
    disadvantage: stepsOf(d, "disadvantage").length > 0,
    absorb: stepsOf(d, "absorb").length > 0,
    interpose: stepsOf(d, "interpose").length > 0,
    consume: step.consume !== false,
    approach: step.approach === true,
    advantage: step.advantage === true,
    // §88 : l'attaque se fait avec une arme de corps à corps de l'acteur ; l'activité de l'item paie et donne le dé (Riposte).
    weapon: step.weapon === true
  })).filter(o => o.activity && affordable(o.activity) && (!o.weapon || meleeAttacksOf(actor).options.length)));
}

/**
 * §28 : une réaction qu'on ne peut pas payer n'est pas proposée (Bouclier sans emplacement, Calque illusoire déjà utilisé). Sort
 * lancé par un emplacement (`method` « spell » ou « pact ») : un emplacement libre de son niveau ou plus. Activité qui consomme
 * les utilisations de son propre item : il en reste une.
 * §66 : la copie d'un sort qu'une capacité lance (activité « cast », `flags.dnd5e.cachedFor` : Magie protectrice du Mage du Monster
 * Manual 2024, qui lance Contresort ou Bouclier) ne prend pas d'emplacement — dnd5e fait payer l'activité qui la lance
 * (activity/mixin.mjs:609, `spellSlot: false`) : ce sont SES utilisations qui comptent.
 */
function affordable(activityUuid) {
  const activity = fromUuidSync(activityUuid, { strict: false });
  const item = activity?.item;
  if ( !item ) return true;
  const linked = (item.type === "spell") ? (item.system.linkedActivity ?? null) : null;
  if ( linked ) return linkedAffordable(linked);
  const spells = item.actor?.system?.spells ?? {};
  const level = Number(item.system.level) || 0;
  if ( (item.type === "spell") && (level > 0) && ["spell", "pact", undefined, ""].includes(item.system.method) ) {
    const slot = Object.entries(spells).some(([key, v]) => {
      const lvl = (key === "pact") ? Number(v?.level) : Number(key.replace("spell", ""));
      return (lvl >= level) && ((Number(v?.value) || 0) > 0);
    });
    if ( !slot ) return false;
  }
  const ownUses = (activity.consumption?.targets ?? []).some(t => (t.type === "itemUses") && !t.target);
  if ( ownUses && Number(item.system.uses?.max) && !((Number(item.system.uses.value) || 0) > 0) ) return false;
  // §94 : les utilisations de l'activité elle-même (Cri surnaturel : bonus de maîtrise par repos long).
  const activityUses = (activity.consumption?.targets ?? []).some(t => t.type === "activityUses");
  if ( activityUses && Number(activity.uses?.max) && !((Number(activity.uses.value) || 0) > 0) ) return false;
  // §88 : les utilisations d'un AUTRE item (les manœuvres : Supériorité martiale ; dnd5e a déjà ramené la cible, uuid de compendium ou
  // identifiant, à l'id de l'item de l'acteur — data/activity/base-activity.mjs, `_remapConsumptionTarget`).
  for ( const t of activity.consumption?.targets ?? [] ) {
    if ( (t.type !== "itemUses") || !t.target ) continue;
    const other = item.actor?.items.get(t.target);
    if ( other && Number(other.system.uses?.max) && !((Number(other.system.uses.value) || 0) > 0) ) return false;
  }
  return true;
}

/** §66 : l'activité « cast » qui lance la copie d'un sort a-t-elle encore de quoi payer (utilisations de son item ou les siennes) ? */
function linkedAffordable(linked) {
  for ( const target of linked.consumption?.targets ?? [] ) {
    if ( target.type === "itemUses" ) {
      const source = (target.target ? linked.actor?.items.get(target.target) : null) ?? linked.item;
      if ( Number(source?.system.uses?.max) && !((Number(source.system.uses.value) || 0) > 0) ) return false;
    }
    if ( (target.type === "activityUses") && Number(linked.uses?.max) && !((Number(linked.uses.value) || 0) > 0) ) return false;
  }
  return true;
}

/** Les attaques de mêlée dont un acteur dispose pour une attaque d'opportunité, et sa meilleure allonge. */
export function meleeAttacksOf(actor) {
  const options = [];
  let reach = 0;
  let units = "ft";
  for ( const item of actor.items ) {
    // « Une attaque de corps à corps avec une arme ou une attaque à mains nues » (PHB 2024, Attaques d'opportunité) :
    // pour un personnage, ses seuls items d'arme équipés (l'Attaque à mains nues en est un) — ni sort (Crosse des druides,
    // Fouet épineux), ni capacité (Pacte de la lame), ni consommable (parchemin) ; pour un monstre, ses armes et ses
    // attaques naturelles (capacité à attaque d'arme : Griffes, Morsure).
    const weaponItem = item.type === "weapon";
    if ( actor.type === "character" ? (!weaponItem || !item.system.equipped) : !(weaponItem || (item.type === "feat")) ) continue;
    for ( const activity of item.system.activities ?? [] ) {
      if ( (activity.type !== "attack") || (activity.attack?.type?.value !== "melee") ) continue;
      if ( !["weapon", "unarmed"].includes(activity.attack?.type?.classification) ) continue;
      options.push({ activity: activity.uuid, name: item.name, img: item.img });
      const r = activity.range?.reach ?? item.system.range?.reach ?? 5;
      if ( r > reach ) { reach = r; units = activity.range?.units ?? item.system.range?.units ?? "ft"; }
    }
  }
  return { options, reach, units };
}

/**
 * §16.26 : Sort réactif (Mage de guerre) — les sorts qu'un acteur peut lancer à la place d'une attaque d'opportunité, s'il
 * porte un item `reactiveSpell` : une action d'incantation, une seule créature visée, sans zone, qui fait quelque chose à
 * la cible (attaque, sauvegarde, dégâts), à portée autre que personnelle ; préparé, ou toujours disponible (sort mineur, pacte, inné, à volonté).
 */
export function reactiveSpellsOf(actor) {
  if ( !actor?.items.some(i => contentOf(i).entry?.reactiveSpell === true) ) return [];
  const options = [];
  for ( const item of actor.items ) {
    if ( item.type !== "spell" ) continue;
    const level = item.system.level ?? 0;
    const ready = (level === 0) || item.system.prepared || ["pact", "innate", "atwill", "always"].includes(item.system.method);
    if ( !ready ) continue;
    // « Ne viser que cette créature » : pas un sort qui pose une zone ou invoque (même par une activité sœur), ni un sort
    // personnel (Crosse des druides, Lame de feu).
    // « Un temps d'incantation d'une action » : celui du sort (Flammes, Lame de feu se lancent en action Bonus, leur attaque
    // ne vient qu'après).
    if ( (item.system.activation?.type ?? "action") !== "action" ) continue;
    const activities = [...(item.system.activities ?? [])];
    if ( item.system.target?.template?.type || activities.some(x => x.target?.template?.type || (x.type === "summon")) ) continue;
    for ( const activity of activities ) {
      if ( !["attack", "save", "damage"].includes(activity.type) ) continue;
      if ( activity.range?.units === "self" ) continue;
      const count = Number(activity.target?.affects?.count || 1);
      if ( (count !== 1) || ["self", "space", "area"].includes(activity.target?.affects?.type) ) continue;
      options.push({ activity: activity.uuid, name: game.i18n.format("DND5ECOMBAT.SortReactif", { name: item.name }), img: item.img });
      break;   // une option par sort
    }
  }
  return options;
}

/**
 * Demande à celui qui contrôle l'acteur s'il réagit : son joueur s'il est connecté, sinon le MJ actif — depuis n'importe quel client :
 * les portes d'avant l'attaque et du Contresort tournent chez l'attaquant, et sans ce renvoi la fenêtre de réaction d'un PNJ s'ouvrait
 * chez le JOUEUR qui attaquait (corrigé le 2026-09-29, §38.6). Ne lève jamais : pas de réponse = pas de réaction.
 * @param {Actor} actor
 * @param {object} payload  { actor, prompt: {key, data}, options: [{activity, name, img}], target? }
 * @returns {Promise<{used: string, message: string|null}|null>}
 */
export async function askReaction(actor, payload) {
  const userId = rollerFor(actor) ?? game.users.activeGM?.id ?? null;
  try {
    if ( userId && (userId !== game.user.id) ) return await game.users.get(userId).query(REACTION_QUERY, payload, { timeout: REACTION_TIMEOUT });
    return await handleReactionQuery(payload);
  } catch(err) {
    console.warn(`${MODULE_ID} | réaction de ${actor.name} : pas de réponse`, err);
    return null;
  }
}

/**
 * Côté de celui qui réagit : la fenêtre de choix, puis l'utilisation de l'activité choisie. C'est
 * lui qui l'utilise : ses ressources, ses dés.
 */
/**
 * §67 : rejoindre la source avant la réaction (`use … approach`). Le chemin et la marche sont au runtime (runtime/actions.mjs,
 * `reactionApproach`), qui s'inscrit ici : l'adaptateur n'importe pas le runtime.
 */
/** Le nom du bouton d'une option : l'item, suivi du nom de l'activité visée quand elle en a un (« Bracelet de charme : Cécité/surdité »). */
function activityLabel(d, step) {
  if ( !step.activity ) return d.name;
  const activity = fromUuidSync(`${d.item}.Activity.${step.activity}`, { strict: false });
  // Le sort d'une activité « cast » : sa copie sur la fiche (traduite par Babele), sinon le compendium (son index peut être en anglais).
  const own = activity?.name || (activity?.type === "cast"
    ? (activity.cachedSpell?.name ?? fromUuidSync(activity.spell?.uuid ?? "", { strict: false })?.name) : null);
  return own ? `${d.name} : ${own}` : d.name;
}

let approachSource = null;

/** Les cibles d'un jet d'attaque, comme dnd5e les écrit (data/chat-message/fields/targets-field.mjs:32) ; null sans token. */
function targetDescriptors(tokenDoc) {
  const token = tokenDoc?.document ?? tokenDoc;
  const actor = token?.actor;
  if ( !actor ) return null;
  const ac = actor.statuses?.has("coverTotal") ? null : actor.system.attributes?.ac?.value;
  return [{ actor: actor.uuid, ac: ac ?? null, img: token.texture?.src, name: token.name, token: token.uuid }];
}
export function setReactionApproach(fn) { approachSource = fn; }

export async function handleReactionQuery({ actor: actorUuid, prompt, options, target, auto=false, castLevel=null }) {
  const actor = await fromUuid(actorUuid);
  const buttons = options.map((o, i) => ({ action: `use${i}`, label: o.name, icon: "fa-solid fa-bolt", default: i === 0 }));
  buttons.push({ action: "none", label: game.i18n.localize("DND5ECOMBAT.NePasReagir") });
  // Sans réponse dans le délai : pas de réaction (elle n'est pas dépensée sans consentement).
  // `auto` (outil de scénario, `usageConfig["dnd5e-combat"].autoReact`) : la première option, sans fenêtre.
  const choice = auto ? "use0" : await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.ReactionTitre", { name: actor?.name ?? "" }) },
    classes: ["dnd5e-combat-reaction"],
    position: { width: 520 },
    content: `<p>${game.i18n.format(`DND5ECOMBAT.${prompt.key}`, prompt.data)}</p>`,
    buttons
  }, { fallback: "none" });
  const option = options[Number(String(choice ?? "").replace("use", ""))];
  if ( !choice?.startsWith?.("use") || !option ) return null;

  // §72 : une réaction qui vise le réacteur lui-même ; sinon la source, si la fenêtre en a une.
  const selfToken = option.targetSelf ? (actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null) : null;
  if ( selfToken ) (selfToken.object ?? selfToken).setTarget?.(true, { releaseOthers: true });
  else if ( target ) {
    const token = (await fromUuid(target))?.object;
    token?.setTarget(true, { releaseOthers: true });
  }
  let activity = await fromUuid(option.activity);
  // §88 : Riposte — l'activité de l'item paie (ses consommations : un dé de supériorité) et donne le dé ; l'attaque est celle d'une arme
  // de corps à corps de l'acteur (la première équipée, `meleeAttacksOf`), contre la source, et le dé s'ajoute à ses dégâts si elle touche.
  if ( option.weapon && activity ) {
    const weapon = await fromUuid(meleeAttacksOf(actor).options[0]?.activity ?? "");
    if ( !weapon ) return null;
    await payWithoutUse(activity);
    const formula = riderFormula(activity);
    if ( formula ) markReactionDamage(weapon.uuid, formula, option.name);
    activity = weapon;
  }
  if ( option.approach && target && approachSource ) {
    await approachSource(actor, await fromUuid(target), activity).catch(err => console.error(`${MODULE_ID} | approche de la réaction`, err));
  }
  // §19.6 : « … contre cet ennemi, avec l'avantage » (Riposte) — marque lue au jet qui suit, sur ce client.
  if ( option.advantage ) markReactionAdvantage(option.activity, option.name);
  // Marquée confirmée (la question vient d'être posée) et payée par la réaction, quel que soit
  // son type d'activation : une attaque d'opportunité est une action d'arme utilisée en réaction.
  // §34 : une réaction ne pose pas de gabarit au milieu d'une fenêtre (Éclat protecteur : « une Émanation de 9 m pour repérer »,
  // `prompt: true`) — dnd5e attendrait le clic de pose (activity/mixin.mjs:451, 833) et la fenêtre resterait bloquée.
  // §38 : `consume: false` — la réaction ne consomme rien d'elle-même (Égide projetée : c'est la réserve qui paie les dégâts).
  // §67 bis : une attaque contre la source — dnd5e lance le jet d'attaque juste après l'utilisation (attack.mjs:68,
  // `_triggerSubsequentActions`) en lisant les cibles de l'utilisateur à cet instant (attack.mjs:84) ; la résolution de l'action
  // qui a ouvert la fenêtre peut les avoir relâchées entre-temps, et le jet partait sans cible (rien à résoudre). Le jet est donc
  // lancé ici, sa cible écrite dans le message.
  const aimed = (activity?.type === "attack") ? targetDescriptors(target ? await fromUuid(target) : null) : null;
  const results = await activity.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: false }, ...(option.consume === false ? { consume: false } : {}),
    ...(aimed ? { subsequentActions: false } : {}) }, { configure: false }, {
    data: { flags: { [MODULE_ID]: { cost: "reaction", reaction: true, ...(option.reduce ? { reduceOnly: true } : {}) } } }
  });
  if ( results && aimed ) activity.rollAttack({}, {}, { data: { system: { origin: results.message?.id, targets: aimed } } });
  // §24 : Parade — le jet de l'activité (un soin dans les données, que le moteur n'applique pas : `reduceOnly`) est le montant retiré
  // aux dégâts de l'attaque. dnd5e lance ce jet de lui-même à l'utilisation (heal.mjs:60) ; on l'attend un peu.
  let reduce = 0;
  if ( results && option.reduce ) {
    const usage = results.message?.id;
    for ( let waited = 0; usage && !reduce && (waited < 8000); waited += 200 ) {
      const roll = game.messages.contents.findLast(m => ["healing", "damage"].includes(m.type) && (m._source.system?.origin === usage));
      reduce = Math.max(0, (roll?.rolls ?? []).reduce((sum, r) => sum + (r.total ?? 0), 0));
      if ( !reduce ) await new Promise(resolve => setTimeout(resolve, 200));
    }
    // §31 : le bonus que la règle ajoute au jet des données (Endurance de la pierre : + Constitution).
    if ( reduce && option.reduceBonus ) {
      try { reduce += Number(Roll.safeEval(Roll.replaceFormulaData(option.reduceBonus, actor.getRollData()))) || 0; }
      catch { /* formule illisible : le jet seul */ }
    }
  }
  // §33 : Mots cinglants — le dé retiré au jet d'attaque (runtime/reactions.mjs l'ajoute à la CA pour rejuger) ; §36 : Présage cosmique,
  // Fortune — le dé ajouté au jet d'attaque de l'allié.
  const penalty = (results && option.penalty) ? await rollInClear(actor, option.penalty, "DND5ECOMBAT.Penalite", option.name) : 0;
  const bonus = (results && option.bonus) ? await rollInClear(actor, option.bonus, "DND5ECOMBAT.Bonus", option.name) : 0;
  // §66 : contresort à la manière de 2014 (`counter`) — c'est celui qui contre qui fait son test, ici, avec ses dés ; la porte
  // (runtime/gates.mjs) lit la réponse au lieu d'attendre une sauvegarde du lanceur.
  const counter = (results && (castLevel !== null)) ? await resolveCounter(actor, activity.item, castLevel) : null;
  return results ? { counter, reduce, penalty, bonus, disadvantage: option.disadvantage === true, used: option.activity, name: option.name, message: results.message?.id ?? null, halve: option.halve === true,
    uncrit: option.uncrit === true, miss: option.miss === true, absorb: option.absorb === true, interpose: option.interpose === true,
    endCondition: option.endCondition === true } : null;
}

/** §88 : dépense ce que l'activité consomme d'utilisations d'items (Riposte : un dé de supériorité), sans l'utiliser. */
export async function payWithoutUse(activity) {
  for ( const t of activity.consumption?.targets ?? [] ) {
    if ( t.type !== "itemUses" ) continue;
    const item = t.target ? activity.actor?.items.get(t.target) : activity.item;
    if ( !item?.system.uses?.max ) continue;
    const cost = Number(t.value) || 1;
    await item.update({ "system.uses.spent": (Number(item.system.uses.spent) || 0) + cost });
  }
}

/** §88 : la formule de la première part de dégâts de l'activité, lue avec les données de l'acteur (« @scale…die » → « 1d8 »). */
function riderFormula(activity) {
  const part = activity?.damage?.parts?.[0];
  if ( !part ) return null;
  const raw = part.custom?.enabled ? part.custom.formula : (part.number && part.denomination ? `${part.number}d${part.denomination}` : null);
  return raw ? Roll.replaceFormulaData(raw, activity.getRollData?.() ?? activity.actor?.getRollData() ?? {}) : null;
}

/** Un dé de réaction lancé en clair (sa carte dans le chat) ; son total, 0 si la formule est illisible. */
async function rollInClear(actor, formula, flavorKey, item) {
  try {
    const roll = await new Roll(formula, actor.getRollData()).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: game.i18n.format(flavorKey, { item }) });
    return roll.total;
  } catch(err) {
    console.warn(`${MODULE_ID} | ${item} : dé illisible`, err);
    return 0;
  }
}

/** CA actuelle d'un token, comme le système la décrit sur un message d'attaque (targets-field.mjs:38). */
export async function currentAc(tokenUuid) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return null;
  return actor.statuses.has("coverTotal") ? null : actor.system.attributes?.ac?.value ?? null;
}
