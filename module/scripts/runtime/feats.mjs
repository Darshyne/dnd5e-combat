/**
 * §129 : dons d'origine du Manuel des joueurs, au jet de dégâts (sur le client de l'auteur, `dnd5e.preRollDamageV2`).
 *
 *  - Sauvagerie martiale (`savageAttacker`) : une fois par tour, au jet de dégâts d'une arme (pas une attaque à mains nues), ses dés
 *    sont lancés deux fois et le meilleur gardé (core/feats.mjs, `twiceKeepHighest`). Le choix « l'un ou l'autre » est toujours le
 *    meilleur : pas de question. Hors combat, chaque coup.
 *  - Guérisseur (`healingRerolls`) : aux dés de soins d'un sort, un 1 relancé une fois (`rerollOnesOnce`). Les Soins de combat du don
 *    portent déjà la relance dans leurs données.
 * Ailleurs : Bagarreur de tavernes (faveur `hitRider`, adapter/smite.mjs), Chanceux (`rollBonus.luck`, adapter/inspiration.mjs ; sa
 * fenêtre avant une attaque, content/feats.mjs), Vigilant (`initiativeSwap`, runtime/roll-bonus.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { twiceKeepHighest, rerollOnesOnce, oneMoreKeepBest } from "../core/feats.mjs";
import { STEPS } from "../core/action.mjs";
import { attackDamageTypes } from "../adapter/smite.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { victimsOf } from "../adapter/grapple.mjs";
import { enqueue } from "./queue.mjs";
import { contentOf } from "../adapter/content.mjs";
import { combatantFor, readBudget, writeBudget } from "../adapter/turn.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

const hasRule = (actor, key) => Array.from(actor?.items ?? []).some(i => contentOf(i).entry?.[key] === true);

/** Le tour de combat où se bat l'acteur (« combat.round.tour »), ou null hors combat. */
function turnOf(actor) {
  const combat = combatantFor(actor)?.parent ?? null;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const actor = activity?.actor;
  if ( !actor || !config.rolls?.length ) return true;
  // Guérisseur : les dés de soins d'un sort.
  if ( (activity.type === "heal") && (activity.item?.type === "spell") && hasRule(actor, "healingRerolls") ) {
    for ( const roll of config.rolls ) roll.parts = (roll.parts ?? []).map(rerollOnesOnce);
    log(`Healer: 1s rerolled once on ${activity.item.name}'s healing dice`);
  }
  // Sauvagerie martiale : la part de l'arme d'un coup d'arme, une fois par tour.
  const weapon = (activity.type === "attack") && (activity.item?.type === "weapon") && (activity.attack?.type?.classification !== "unarmed");
  if ( weapon && hasRule(actor, "savageAttacker") ) {
    const turn = turnOf(actor);
    if ( turn && (actor.getFlag(MODULE_ID, "savageAttacker") === turn) ) return true;
    const base = config.rolls.find(r => r.base) ?? config.rolls[0];
    base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? twiceKeepHighest(p) : p));
    foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.savageAttacker`, true);
    if ( turn ) actor.setFlag(MODULE_ID, "savageAttacker", turn).catch(() => null);
    log(`Savage Attacker: ${base.parts[0]}`);
  }
  // §134 : Expert élémentaire — « quand vous lancez les dégâts d'un sort de ce type, un 1 sur un dé compte comme un 2 ».
  if ( activity.item?.type === "spell" ) {
    const types = elementalTypes(actor);
    for ( const roll of types.length ? config.rolls : [] ) {
      const rt = [roll.options?.type, ...(roll.options?.types ?? [])].filter(Boolean);
      if ( !rt.some(t => types.includes(t)) ) continue;
      roll.parts = (roll.parts ?? []).map(p => String(p).replace(/(\d*d\d+)((?:[a-z]+\d*)*)/g, (term, dice, mods) => (/min/.test(mods) ? term : `${dice}min2${mods}`)));
      log(`Elemental Adept: ${roll.parts.join(" + ")}`);
    }
  }
  // §135 : Faveur d'attaque irrésistible, Frappe écrasante — « quand vous obtenez un 20 au d20 d'un jet d'attaque, des dégâts en plus
  // égaux à la valeur de la caractéristique augmentée par la faveur, du type de l'attaque ». Le moteur lit le critique (un seuil abaissé
  // compte aussi).
  const strike = (activity.type === "attack") ? ruleItem(actor, "overwhelmingStrike") : null;
  if ( strike && (config.isCritical || config.rolls.some(r => r.options?.isCritical)) ) {
    const ability = boostedAbility(strike);
    const score = ability ? Number(actor.system.abilities?.[ability]?.value) : 0;
    const base = config.rolls.find(r => r.base) ?? config.rolls[0];
    const type = base.options?.type ?? base.options?.types?.[0] ?? null;
    if ( score > 0 ) {
      config.rolls.push({ parts: [String(score)], options: { type, types: type ? [type] : [], properties: [] } });
      log(`${strike.name}: +${score} ${type ?? ""} (critical hit)`);
    }
  }
  // §132 : Perforeur — une attaque qui inflige des dégâts perforants.
  if ( (activity.type === "attack") && attackDamageTypes(activity).includes("piercing") && hasRule(actor, "piercer") ) {
    for ( const roll of config.rolls ) {
      roll.options ??= {};
      roll.options.critical = { ...(roll.options.critical ?? {}), bonusDice: (Number(roll.options.critical?.bonusDice) || 0) + 1 };
    }
    const turn = turnOf(actor);
    if ( !turn || (actor.getFlag(MODULE_ID, "piercer") !== turn) ) {
      const base = config.rolls.find(r => r.base) ?? config.rolls[0];
      const before = base.parts?.[0];
      base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? oneMoreKeepBest(p) : p));
      if ( (base.parts[0] !== before) && turn ) actor.setFlag(MODULE_ID, "piercer", turn).catch(() => null);
      log(`Piercer: ${base.parts[0]} (one more die on a critical hit)`);
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  §132 : marques de coup critique              */
/* -------------------------------------------- */

const seen = new Set();

/** Après une attaque tranchée (MJ actif) : chaque cible touchée d'un coup critique du bon type reçoit la marque des dons de l'auteur. */
async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  seen.add(resolution.id);
  // `resolution.source` : l'uuid de l'ACTEUR auteur (runtime/felled.mjs le compare à `token.actor.uuid`).
  const from = fromUuidSync(resolution.source ?? "", { strict: false });
  const source = (from?.documentName === "Actor") ? from : (from?.actor ?? null);
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  if ( !source || !activity ) return;
  await halt(resolution, source);   // §133
  const rules = source.items.map(i => ({ item: i, rule: contentOf(i).entry?.critMark })).filter(r => r.rule);
  if ( !rules.length ) return;
  const types = attackDamageTypes(activity);
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit || !t.critical ) continue;
    const target = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !target || ((target.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    for ( const { item, rule } of rules ) {
      if ( !types.includes(rule.damageType) ) continue;
      const name = loc(`CoupCritique.${rule.side}`, { item: item.name });
      await target.createEmbeddedDocuments("ActiveEffect", [{ name, img: item.img, origin: item.uuid, transfer: false, disabled: false,
        changes: [], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
        flags: { [MODULE_ID]: { critMark: { side: rule.side, source: source.uuid, item: item.uuid } } } }]);
      log(`${item.name}: critical hit, "${name}" placed on ${target.name}`);
    }
  }
}

/* -------------------------------------------- */
/*  §135 : faveurs épiques                         */
/* -------------------------------------------- */

const ruleItem = (actor, key) => Array.from(actor?.items ?? []).find(i => contentOf(i).entry?.[key] === true) ?? null;

/**
 * Faveur de prouesse martiale, Visée sans pareille — « quand vous ratez un jet d'attaque, vous pouvez toucher à la place ; vous ne
 * pouvez plus le faire avant le début de votre prochain tour ». Au joueur ; en combat, une fois jusqu'à son prochain tour (drapeau
 * retiré au début de son tour). true : l'attaque touche.
 */
export async function offerPeerlessAim(actor, { total, needed }) {
  const item = ruleItem(actor, "peerlessAim");
  if ( !item ) return false;
  const combat = combatantFor(actor)?.parent;
  if ( combat?.started && actor.getFlag(MODULE_ID, "peerlessAim") ) return false;
  const answer = await askChoice(actor, { actor: actor.uuid, item: item.name, prompt: loc("Prouesse.Question", { item: item.name, total, needed }),
    options: [{ id: "no", label: loc("BonusJet.Non") }, { id: "yes", label: loc("Prouesse.Oui") }] });
  if ( answer?.id !== "yes" ) return false;
  if ( combat?.started ) await actor.setFlag(MODULE_ID, "peerlessAim", true);
  await ChatMessage.create({ speaker: ChatMessage.implementation.getSpeaker({ actor }), content: `<p>${loc("Prouesse.Carte", { item: item.name, name: actor.name })}</p>` });
  log(`${item.name}: ${actor.name}'s missed attack hits instead`);
  return true;
}

/** Faveur de vigueur — le modificateur de Constitution en plus d'un soin, une fois par tour (en combat). 0 sinon. MJ actif. */
export async function fortifiedExtra(actor) {
  const item = ruleItem(actor, "fortifiedHealing");
  const con = Number(actor?.system?.abilities?.con?.mod) || 0;
  if ( !item || !(con > 0) ) return 0;
  const turn = turnOf(actor);
  if ( turn && (actor.getFlag(MODULE_ID, "fortifiedHealing") === turn) ) return 0;
  if ( turn ) await actor.setFlag(MODULE_ID, "fortifiedHealing", turn);
  log(`${item.name}: +${con} HP for ${actor.name}`);
  return con;
}

/** Faveur d'attaque irrésistible, Frappe écrasante : la caractéristique que la faveur a augmentée (son étape « Augmentation »). */
function boostedAbility(item) {
  for ( const adv of item.system.advancement ?? [] ) {
    const assigned = Object.entries(adv.value?.assignments ?? {}).find(([, n]) => n > 0);
    if ( (adv.type === "AbilityScoreImprovement") && assigned ) return assigned[0];
  }
  return null;
}

/**
 * Faveur du rappel des sorts, Incantation gratuite — « quand vous lancez un sort avec un emplacement de niveau 1 à 4, lancez 1d4 ; si
 * le résultat égale le niveau de l'emplacement, il n'est pas dépensé ». Sur le client du lanceur, après l'utilisation.
 */
async function spellRecall(activity, usageConfig) {
  const actor = activity?.actor;
  const item = ruleItem(actor, "spellRecall");
  const slot = usageConfig?.spell?.slot;
  if ( !item || !slot || !activity.requiresSpellSlot || !activity.consumption?.spellSlot ) return;
  const level = Number(actor.system.spells?.[slot]?.level) || Number(String(slot).replace("spell", "")) || 0;
  if ( !(level >= 1) || (level > 4) ) return;
  const roll = await new Roll("1d4").evaluate();
  const kept = roll.total === level;
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc(kept ? "RappelSorts.Garde" : "RappelSorts.Depense", { item: item.name, level }) });
  if ( kept ) await actor.update({ [`system.spells.${slot}.value`]: (Number(actor.system.spells[slot].value) || 0) + 1 });
  log(`${item.name}: 1d4 = ${roll.total} for a level ${level} slot — ${kept ? "slot kept" : "slot spent"}`);
}

/* -------------------------------------------- */
/*  §134 : résistances ignorées, Expert élémentaire */
/* -------------------------------------------- */

/** Les types que l'Expert élémentaire peut choisir. */
export const ELEMENTAL_TYPES = Object.freeze(["acid", "cold", "fire", "lightning", "thunder"]);

/** Les types choisis par les Experts élémentaires de l'acteur (le don se reprend, un type à chaque fois). */
function elementalTypes(actor) {
  return Array.from(actor?.items ?? []).filter(i => contentOf(i).entry?.elementalAdept === true)
    .map(i => i.getFlag(MODULE_ID, "elementalType")).filter(t => ELEMENTAL_TYPES.includes(t));
}

/**
 * À l'application des dégâts (MJ actif) : les types dont la résistance est ignorée pour cette activité — Empoisonneur (`ignoresResistance`,
 * « un jet de dégâts qui inflige des dégâts de poison ignore la résistance au poison »), Expert élémentaire (le type choisi, pour un sort).
 */
export function resistanceIgnoredBy(actor, activity) {
  if ( !actor ) return [];
  const out = new Set();
  for ( const i of actor.items ) for ( const t of contentOf(i).entry?.ignoresResistance?.types ?? [] ) out.add(t);
  if ( activity?.item?.type === "spell" ) for ( const t of elementalTypes(actor) ) out.add(t);
  return Array.from(out);
}

/**
 * Expert élémentaire : la question du type, au joueur (sinon au MJ), notée sur l'item. MJ actif, à l'arrivée du don et au chargement.
 * §137 : sans délai — un choix fait une fois ; fermée sans réponse, rien n'est noté et la question revient au prochain chargement
 * (d'ici là, le don ne s'applique à aucun type).
 */
async function askElementalType(item) {
  if ( !item?.actor || (contentOf(item).entry?.elementalAdept !== true) || ELEMENTAL_TYPES.includes(item.getFlag(MODULE_ID, "elementalType")) ) return;
  const taken = new Set(elementalTypes(item.actor));
  const options = ELEMENTAL_TYPES.filter(t => !taken.has(t)).map(t => ({ id: t, label: game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t) }));
  if ( !options.length ) return;
  const answer = await askChoice(item.actor, { actor: item.actor.uuid, item: item.name, prompt: loc("ExpertElementaire.Question", { item: item.name }), options, untimed: true });
  const type = answer?.id;
  if ( !ELEMENTAL_TYPES.includes(type) ) return;
  await item.setFlag(MODULE_ID, "elementalType", type);
  log(`${item.actor.name}: ${item.name}, damage type ${type}`);
}

/* -------------------------------------------- */
/*  §133 : réactions de don                       */
/* -------------------------------------------- */

const shieldOf = actor => (actor?.items ?? []).find(i => (i.type === "equipment") && (i.system.type?.value === "shield") && i.system.equipped) ?? null;

/**
 * Maître des boucliers, Interposer le bouclier — « soumis à un effet qui permet une sauvegarde de Dextérité pour ne subir que la moitié
 * des dégâts, vous pouvez prendre une Réaction pour n'en subir aucun si vous réussissez, en tenant un bouclier ». Proposé après la
 * réussite (MJ actif, au joueur de la créature) ; la Réaction est dépensée. true : aucun dégât.
 */
export async function offerInterpose(actor) {
  const item = (actor?.items ?? []).find(i => contentOf(i).entry?.interposeShield === true);
  if ( !item || !shieldOf(actor) ) return false;
  if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) return false;
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  if ( budget && !((budget.reaction ?? 1) >= 1) ) return false;
  const answer = await askChoice(actor, { actor: actor.uuid, item: item.name, prompt: loc("Interposer.Question", { item: item.name }),
    options: [{ id: "no", label: loc("Interposer.Non") }, { id: "yes", label: loc("Interposer.Oui") }] });
  if ( answer?.id !== "yes" ) return false;
  if ( budget ) await writeBudget(combatant, { ...budget, reaction: Math.max(0, (budget.reaction ?? 1) - 1) });
  log(`${actor.name}: ${item.name}, no damage on a successful Dexterity saving throw (Reaction)`);
  return true;
}

/** Tueur de mages, Briseur de concentration — l'auteur blesse une créature concentrée : son prochain jet de concentration a le Désavantage. */
export async function markConcentrationBreaker(source, target) {
  if ( !source || !target || (source === target) ) return;
  if ( !(source.items ?? []).some(i => contentOf(i).entry?.concentrationBreaker === true) ) return;
  if ( !(target.concentration?.effects?.size > 0) ) return;
  await target.setFlag(MODULE_ID, "concentrationBreaker", { source: source.name, at: Date.now() });
  log(`Mage Slayer: ${target.name}'s next Concentration saving throw has Disadvantage (${source.name})`);
}

/** Le jet de concentration, sur le client qui le lance : le Désavantage s'il y a une marque récente (moins d'une minute), qui tombe. */
function onPreRollConcentration(config) {
  const actor = config?.subject;
  const mark = actor?.getFlag?.(MODULE_ID, "concentrationBreaker");
  if ( !mark ) return true;
  if ( (Date.now() - (mark.at ?? 0)) <= 60000 ) {
    config.disadvantage = true;
    log(`Mage Slayer: Disadvantage on ${actor.name}'s Concentration saving throw (${mark.source})`);
  }
  if ( actor.isOwner ) actor.unsetFlag(MODULE_ID, "concentrationBreaker").catch(() => null);
  return true;
}

/** Sentinelle, Halte — « quand vous touchez une créature d'une attaque d'opportunité, sa Vitesse tombe à 0 pour le reste du tour ». */
async function halt(resolution, source) {
  const items = source.items.filter(i => contentOf(i).entry?.haltOnReaction);
  if ( !items.length ) return;
  const usage = game.messages.get(resolution.origin ?? "");
  if ( !usage?.getFlag(MODULE_ID, "reaction") ) return;
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit ) continue;
    const target = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !target || ((target.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    for ( const item of items ) {
      const effect = item.effects.get(contentOf(item).entry.haltOnReaction.effect);
      if ( !effect ) continue;
      const data = foundry.utils.mergeObject(effect.toObject(), { origin: item.uuid, transfer: false, disabled: false }, { inplace: false });
      delete data._id;
      await target.createEmbeddedDocuments("ActiveEffect", [data]);
      log(`${item.name}: ${target.name} hit by an opportunity attack, Speed 0 for the rest of the turn`);
    }
  }
}

/** Retire les marques qu'un auteur a posées (au début de son tour, à la fin du combat). */
async function dropMarks(sourceUuid) {
  for ( const token of canvas?.scene?.tokens ?? [] ) {
    const actor = token.actor;
    const ids = (actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "critMark")?.source === sourceUuid).map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

/** §132 : Combat à mains nues — « au début de chacun de vos tours, 1d4 dégâts contondants à une créature que vous agrippez ». */
async function grappleDamage(actor, token) {
  const item = actor.items.find(i => contentOf(i).entry?.grappleDamage);
  if ( !item || !token ) return;
  const rule = contentOf(item).entry.grappleDamage;
  for ( const victim of victimsOf(token) ) {
    const logged = await inflict({ step: { formula: rule.formula, damageType: rule.damageType }, item, targetUuid: victim.uuid, properties: [],
      speaker: ChatMessage.implementation.getSpeaker({ token }), flavor: loc("CoupCritique.Empoignade", { item: item.name, name: victim.name }),
      flags: { grappleDamage: { item: item.uuid, target: victim.uuid } } });
    log(`${item.name}: ${victim.name} takes ${rule.formula} ${rule.damageType}${logged ? ` (HP ${logged.before?.value} -> ${logged.after?.value})` : ""}`);
  }
}

function onTurnChange(combat, prior, current) {
  const combatant = combat.combatants.get(current?.combatantId);
  const actor = combatant?.actor;
  if ( !actor ) return;
  return enqueue(`feats-turn:${actor.uuid}`, async () => {
    await dropMarks(actor.uuid);
    if ( actor.getFlag(MODULE_ID, "peerlessAim") ) await actor.unsetFlag(MODULE_ID, "peerlessAim");   // §135 : Visée sans pareille
    if ( (actor.system.attributes?.hp?.value ?? 0) > 0 ) await grappleDamage(actor, combatant.token);
  });
}

export function registerFeats() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "origin feats (damage)" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`critMark:${resolution?.id}`, () => onResolution(resolution)), { executor: true, label: "critical mark not placed" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "feat turn start" });
  route("dnd5e.preRollConcentrationV2", onPreRollConcentration, { cancellable: true, label: "Mage Slayer: concentration" });
  route("dnd5e.postUseActivity", (activity, usageConfig) => (activity?.actor?.isOwner ? spellRecall(activity, usageConfig) : null), { label: "Boon of Spell Recall" });
  // §134 : Expert élémentaire — le type, demandé à l'arrivée du don, et au chargement pour un don déjà là.
  route("createItem", item => (item.parent?.documentName === "Actor" ? enqueue(`elemental:${item.uuid}`, () => askElementalType(item)) : null),
    { executor: true, label: "Elemental Adept: type not asked" });
  route("ready", () => { for ( const actor of game.actors ) for ( const item of actor.items ) enqueue(`elemental:${item.uuid}`, () => askElementalType(item)); },
    { executor: true, label: "Elemental Adept: type not asked" });
  route("deleteCombat", combat => Promise.all(combat.combatants.map(c => (c.actor ? dropMarks(c.actor.uuid) : null))), { executor: true, label: "critical marks not removed" });
}
