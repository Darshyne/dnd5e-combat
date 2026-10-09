/**
 * Inspiration bardique (SPEC §33) : « une fois dans l'heure, quand la créature rate un Test d20, elle peut lancer le dé d'Inspiration
 * bardique et en ajouter le résultat, ce qui peut changer l'échec en réussite ». La créature inspirée porte l'effet « Inspiré » de
 * l'item du barde (origine : l'item `bardic-inspiration`) ; le dé est l'échelle du barde (`@scale.bard.inspiration`, d6 → d12).
 *
 * Le moteur le propose aux jets qu'il lit : un jet d'attaque qui rate une cible, une sauvegarde ratée — au joueur de la créature
 * (sinon au MJ), avant que le verdict ne parte au cœur (runtime/engine.mjs). Le dé est lancé en clair, l'effet retiré.
 */

import { MODULE_ID } from "../constants.mjs";
import { originItemOf } from "./facts.mjs";
import { identifierOf, contentOf } from "./content.mjs";
import { askChoice } from "./choices.mjs";
import { combatantFor, readBudget, writeBudget } from "./turn.mjs";

const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Inspiration.${key}`, data ?? {});

/** Le dé d'Inspiration d'un barde (`@scale.bard.inspiration`, d6 → d12), « 1d6 » à défaut. */
export function inspirationDieOf(bard) {
  try {
    const die = Roll.replaceFormulaData("@scale.bard.inspiration", bard?.getRollData?.() ?? {}, { missing: "" }).trim();
    if ( /^\d*d\d+$/.test(die) ) return die.startsWith("d") ? `1${die}` : die;
  } catch { /* le d6 */ }
  return "1d6";
}

/** L'inspiration que porte l'acteur : l'effet et la formule du dé ; null s'il n'en a pas. */
export function inspirationOf(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( !item || (identifierOf(item).id !== "bardic-inspiration") ) continue;
    return { effect, formula: inspirationDieOf(item.actor), bard: item.actor?.name ?? "" };
  }
  return null;
}

/**
 * §113 : ce qu'un barde peut donner — l'item Inspiration bardique, l'activité qui pose l'effet « Inspiré » et son dé, s'il lui reste
 * une utilisation ; null sinon.
 */
export function inspirationSourceOf(bard) {
  const item = bard?.items?.find(i => identifierOf(i).id === "bardic-inspiration");
  const activities = Array.from(item?.system?.activities ?? []);
  const activity = activities.find(a => a.effects?.length) ?? activities[0];
  if ( !activity || !(usesLeftFor(activity) > 0) ) return null;
  return { item, activity, formula: inspirationDieOf(bard) };
}

/**
 * La question (joueur de la créature, sinon MJ), puis le dé : rend le résultat à ajouter, ou 0 (refusé, pas d'inspiration).
 * @param {Actor} actor
 * @param {{what: string, total: number, needed: number|null}} context  Le jet raté : « attaque » ou « sauvegarde », son total, le
 *   seuil ; `needed` null pour un test libre (§113), dont le moteur ne connaît pas le DD.
 */
export async function offerInspiration(actor, { what, total, needed }) {
  const inspiration = inspirationOf(actor);
  if ( !inspiration ) return 0;
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: t("Nom"),
    prompt: (needed === null) ? t("QuestionTest", { what, total, formula: inspiration.formula })
      : t("Question", { what, total, needed, formula: inspiration.formula }),
    // « Non » d'abord : sans réponse dans le délai, askChoice retient la première option — l'inspiration n'est pas dépensée sans accord
    // (choix de l'utilisateur le 2026-09-29, comme la Chance du ténébreux).
    options: [{ id: "no", label: t("Non") }, { id: "yes", label: t("Oui", { formula: inspiration.formula }) }]
  });
  if ( answer?.id !== "yes" ) return 0;
  const roll = await new Roll(inspiration.formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: t("Carte", { name: actor.name, bard: inspiration.bard }) });
  await inspiration.effect.delete().catch(err => console.warn(`${MODULE_ID} | inspiration not removed`, err));
  return roll.total;
}

/**
 * §94 : la formule du jet de l'activité, lue avant qu'elle ne paie — « @consumed.hd » (Symbiose : « dépensez un dé de vie, lancez-le »)
 * devient le dé que la consommation va dépenser (le plus grand ou le plus petit restant). null si rien à lancer.
 */
function rollFormulaOf(activity) {
  let formula = activity?.roll?.formula;
  if ( !formula ) return null;
  if ( formula.includes("@consumed.hd") ) {
    const hd = activity.actor?.system?.attributes?.hd;
    const which = activity.consumption?.targets?.find(t => t.type === "hitDice")?.target;
    const die = (which === "smallest") ? hd?.smallestAvailable : hd?.largestAvailable;
    if ( !die || (die === "d0") ) return null;
    formula = formula.replaceAll("@consumed.hd", `1${die}`);
  }
  return formula;
}

/**
 * Ce qui reste pour payer l'activité : le plus petit nombre d'utilisations restantes parmi celles qu'elle consomme — de son item, ou
 * d'un autre (§90 : les manœuvres paient sur la Supériorité martiale ; dnd5e a déjà ramené la cible à l'id de l'item de l'acteur,
 * `_remapConsumptionTarget`). Infinity si rien de compté.
 */
export function usesLeftFor(activity) {
  let left = Infinity;
  const count = item => (item && Number(item.system.uses?.max)) ? Math.max(0, Number(item.system.uses.value) || 0) : Infinity;
  for ( const t of activity?.consumption?.targets ?? [] ) {
    // §94 : les utilisations de l'activité elle-même (Se ressaisir : une fois par repos long), les dés de vie (Symbiose).
    if ( t.type === "activityUses" ) { if ( Number(activity.uses?.max) ) left = Math.min(left, Math.max(0, Number(activity.uses.value) || 0)); continue; }
    if ( t.type === "hitDice" ) { left = Math.min(left, Math.max(0, Number(activity.actor?.system?.attributes?.hd?.value) || 0)); continue; }
    if ( t.type !== "itemUses" ) continue;
    left = Math.min(left, count(t.target ? activity.actor?.items.get(t.target) : activity.item));
  }
  if ( left === Infinity ) left = count(activity?.item);
  return left;
}

/**
 * §38 : un dé que la créature ajoute à SON propre jet, après l'avoir vu (clé de contenu `rollBonus: { activity, on, skills }` — Chance du
 * ténébreux : « ajoutez 1d10 à votre test de caractéristique ou jet de sauvegarde ; après avoir vu le jet, avant ses effets ; une fois
 * par jet » ; §90 : Attaque précise, Embuscade, Autorité naturelle, Évaluation tactique). Proposé s'il reste de quoi payer ; oui :
 * l'activité est utilisée par dnd5e (ses consommations dépensées), son jet (`roll.formula`) lancé en clair et rendu. Rend le résultat à
 * ajouter, ou 0. `needed` absent (un test sans DD connu) : la question ne donne que le total.
 * @param {Actor} actor
 * @param {{kind: "save"|"check"|"attack"|"initiative", what: string, total: number, needed?: number, skill?: string,
 *   statuses?: string[]}} context  `statuses` : les états que la sauvegarde évite ou fait finir (Survivant).
 */
export async function offerRollBonus(actor, { kind, what, total, needed=null, skill=null, statuses=[] }) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.rollBonus;
    if ( !rule || !(rule.on ?? []).includes(kind) ) continue;
    if ( (kind === "check") && rule.skills && !rule.skills.includes(skill) ) continue;
    if ( rule.statuses && !rule.statuses.some(s => statuses.includes(s)) ) continue;
    const activity = item.system.activities?.get(rule.activity);
    const formula = rollFormulaOf(activity);
    const left = usesLeftFor(activity);
    if ( !activity || !formula || !(left > 0) ) continue;
    // §94 : une activité de Réaction (Symbiose, Se ressaisir) n'est proposée que si la Réaction est libre ; elle est dépensée.
    const reaction = activity.activation?.type === "reaction";
    const combatant = reaction ? combatantFor(actor) : null;
    if ( combatant && !((readBudget(combatant).reaction ?? 1) >= 1) ) continue;
    const shown = Number.isFinite(left) ? left : "∞";
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name,
      prompt: (needed === null) ? game.i18n.format("DND5ECOMBAT.BonusJet.QuestionTest", { what, total, formula, item: item.name, left: shown })
        : game.i18n.format("DND5ECOMBAT.BonusJet.Question", { what, total, needed, formula, item: item.name, left: shown }),
      // « Garder le jet » d'abord : sans réponse dans le délai, askChoice retient la première option — une utilisation ne part pas sans accord.
      options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.BonusJet.Non") }, { id: "yes", label: game.i18n.format("DND5ECOMBAT.BonusJet.Oui", { formula }) }]
    });
    if ( answer?.id !== "yes" ) continue;
    // Des utilisations d'activité sans maximum dans la donnée (Se ressaisir : « une fois par repos long », non chiffré) : dnd5e refuserait
    // l'utilisation faute de quoi payer — rien à décompter, elle se fait sans consommer.
    const untracked = (activity.consumption?.targets ?? []).some(t => t.type === "activityUses") && !Number(activity.uses?.max);
    const used = await activity.use({ [MODULE_ID]: { confirmed: true }, ...(untracked ? { consume: false } : {}) }, { configure: false }, { create: false }).catch(() => null);
    if ( !used ) return 0;
    if ( combatant ) { const budget = readBudget(combatant); await writeBudget(combatant, { ...budget, reaction: Math.max(0, (budget.reaction ?? 1) - 1) }); }
    const roll = await new Roll(formula, activity.getRollData?.() ?? actor.getRollData()).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flavor: game.i18n.format("DND5ECOMBAT.BonusJet.CarteTotal", { item: item.name, name: actor.name, what, total, sum: total + roll.total }),
      flags: { [MODULE_ID]: { rollBonus: { item: identifierOf(item).id, kind, added: roll.total } } } });
    return roll.total;
  }
  return 0;
}
