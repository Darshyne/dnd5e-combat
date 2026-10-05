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

const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Inspiration.${key}`, data ?? {});

/** L'inspiration que porte l'acteur : l'effet et la formule du dé ; null s'il n'en a pas. */
export function inspirationOf(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( !item || (identifierOf(item).id !== "bardic-inspiration") ) continue;
    let formula = "1d6";
    try {
      const die = Roll.replaceFormulaData("@scale.bard.inspiration", item.actor?.getRollData?.() ?? {}, { missing: "" }).trim();
      if ( /^\d*d\d+$/.test(die) ) formula = die.startsWith("d") ? `1${die}` : die;
    } catch { /* le d6 */ }
    return { effect, formula, bard: item.actor?.name ?? "" };
  }
  return null;
}

/**
 * La question (joueur de la créature, sinon MJ), puis le dé : rend le résultat à ajouter, ou 0 (refusé, pas d'inspiration).
 * @param {Actor} actor
 * @param {{what: string, total: number, needed: number}} context  Le jet raté : « attaque » ou « sauvegarde », son total, le seuil.
 */
export async function offerInspiration(actor, { what, total, needed }) {
  const inspiration = inspirationOf(actor);
  if ( !inspiration ) return 0;
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: t("Nom"),
    prompt: t("Question", { what, total, needed, formula: inspiration.formula }),
    // « Non » d'abord : sans réponse dans le délai, askChoice retient la première option — l'inspiration n'est pas dépensée sans accord
    // (choix de l'utilisateur le 2026-09-29, comme la Chance du ténébreux).
    options: [{ id: "no", label: t("Non") }, { id: "yes", label: t("Oui", { formula: inspiration.formula }) }]
  });
  if ( answer?.id !== "yes" ) return 0;
  const roll = await new Roll(inspiration.formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: t("Carte", { name: actor.name, bard: inspiration.bard }) });
  await inspiration.effect.delete().catch(err => console.warn(`${MODULE_ID} | inspiration non retirée`, err));
  return roll.total;
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
 * @param {{kind: "save"|"check"|"attack"|"initiative", what: string, total: number, needed?: number, skill?: string}} context
 */
export async function offerRollBonus(actor, { kind, what, total, needed=null, skill=null }) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.rollBonus;
    if ( !rule || !(rule.on ?? []).includes(kind) ) continue;
    if ( (kind === "check") && rule.skills && !rule.skills.includes(skill) ) continue;
    const activity = item.system.activities?.get(rule.activity);
    const formula = activity?.roll?.formula;
    const left = usesLeftFor(activity);
    if ( !activity || !formula || !(left > 0) ) continue;
    const shown = Number.isFinite(left) ? left : "∞";
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name,
      prompt: (needed === null) ? game.i18n.format("DND5ECOMBAT.BonusJet.QuestionTest", { what, total, formula, item: item.name, left: shown })
        : game.i18n.format("DND5ECOMBAT.BonusJet.Question", { what, total, needed, formula, item: item.name, left: shown }),
      // « Garder le jet » d'abord : sans réponse dans le délai, askChoice retient la première option — une utilisation ne part pas sans accord.
      options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.BonusJet.Non") }, { id: "yes", label: game.i18n.format("DND5ECOMBAT.BonusJet.Oui", { formula }) }]
    });
    if ( answer?.id !== "yes" ) continue;
    const used = await activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }, { create: false }).catch(() => null);
    if ( !used ) return 0;
    const roll = await new Roll(formula, activity.getRollData?.() ?? actor.getRollData()).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flavor: game.i18n.format("DND5ECOMBAT.BonusJet.CarteTotal", { item: item.name, name: actor.name, what, total, sum: total + roll.total }),
      flags: { [MODULE_ID]: { rollBonus: { item: identifierOf(item).id, kind, added: roll.total } } } });
    return roll.total;
  }
  return 0;
}
