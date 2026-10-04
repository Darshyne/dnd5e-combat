/**
 * Attaque sournoise et Frappes rusées (SPEC §20) lues dans dnd5e 6.0 : quel item donne l'Attaque sournoise, combien de dés,
 * si ce jet d'attaque y a droit, et quelles Frappes rusées l'auteur peut payer. Les règles sont dans core/sneak.mjs.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - le mode d'avantage retenu d'un jet d'attaque est dans `roll.options.advantageMode` (dice/d20-roll.mjs, `hasAdvantage`) ;
 *  - un jet de dégâts lancé depuis une attaque porte `system.origin` = le message d'utilisation, comme le jet d'attaque
 *    (activity/attack.mjs:303-311) : on retrouve ainsi l'attaque dont il suit ;
 *  - l'Attaque sournoise du Manuel des joueurs lance `@scale.rogue.sneak-attack` (sa première part de dégâts), une valeur
 *    d'échelle de dés que `Roll.replaceFormulaData` écrit « 3d6 ».
 */

import { MODULE_ID } from "../constants.mjs";
import { sneakAttackIssue, parseDice, sneakDiceAtLevel, affordableStrikes } from "../core/sneak.mjs";
import { SIZES } from "../core/content.mjs";
import { turnKeyOf } from "../core/area.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { factsFor } from "./facts.mjs";
import { timedWait } from "./dialogs.mjs";

/** Types d'armes à distance de dnd5e (`CONFIG.DND5E.weaponTypes`) : une arme de corps à corps lancée n'en est pas une. */
const RANGED_WEAPON_TYPES = Object.freeze(["simpleR", "martialR"]);

/** Le tour de combat en cours, combat compris (deux combats ont chacun leur round 1, tour 0), ou null hors combat. */
const currentTurnKey = () => (game.combat?.started ? `${game.combat.id}:${turnKeyOf(game.combat.round, game.combat.turn)}` : null);

/** L'item qui donne l'Attaque sournoise à cet acteur, ou null. */
export function sneakItemOf(actor) {
  return Array.from(actor?.items ?? []).find(i => !!contentOf(i).entry?.sneakAttack) ?? null;
}

/** Les dés d'Attaque sournoise de l'item : sa première part de dégâts, sinon ceux d'un roublard de ce niveau. */
export function sneakDiceOf(item) {
  // §72 : les dés que le contenu fixe (PNJ : « 17 (5d6) »).
  const fixed = contentOf(item).entry?.sneakAttack?.dice;
  if ( fixed ) return parseDice(fixed);
  const activity = Array.from(item?.system?.activities ?? []).find(a => a.damage?.parts?.length);
  const part = activity?.damage.parts[0];
  const formula = part?.custom?.enabled ? part.custom.formula
    : ((part?.number && part?.denomination) ? `${part.number}d${part.denomination}` : null);
  if ( formula ) {
    try {
      const dice = parseDice(Roll.replaceFormulaData(formula, item.getRollData(), { missing: "0" }));
      if ( dice?.number > 0 ) return dice;
    } catch { /* formule illisible : le niveau */ }
  }
  return sneakDiceAtLevel(item?.actor?.classes?.rogue?.system?.levels ?? 0);
}

/** L'Attaque sournoise a-t-elle déjà servi à ce tour de combat ? Hors combat, jamais. */
export function sneakSpent(actor) {
  const key = currentTurnKey();
  return !!key && (actor?.getFlag(MODULE_ID, "sneakAttack") === key);
}

/** Marque l'Attaque sournoise comme utilisée à ce tour (sur le client de l'auteur, qui possède l'acteur). */
export async function markSneakSpent(actor) {
  const key = currentTurnKey();
  if ( key && actor?.isOwner ) await actor.setFlag(MODULE_ID, "sneakAttack", key);
}

/** Le dernier jet d'attaque de cette activité rattaché à ce message d'utilisation, ou null. */
export function attackMessageFor(originId, activity) {
  if ( !originId ) return null;
  return game.messages.contents.findLast(m => (m.type === "attack") && (m._source.system?.origin === originId)
    && (!activity || (m.system?.activity?.uuid === activity.uuid) || (fromUuidSync(m.system?.activity?.uuid ?? "", { strict: false })?.item === activity.item))) ?? null;
}

/**
 * L'Attaque sournoise de ce jet de dégâts : l'item, ses dés, la cible et, si elle ne s'applique pas, pourquoi.
 * null si l'auteur n'a pas l'Attaque sournoise ou si le jet ne suit pas une attaque sur une seule cible.
 * @param {Activity} activity           L'attaque (pas sa variante de dégâts).
 * @param {ChatMessage} attackMessage   Son jet d'attaque.
 * @returns {{item: Item5e, dice: {number: number, faces: number}, issue: string|null, source: TokenDocument,
 *   target: TokenDocument}|null}
 */
export function sneakAttackFor(activity, attackMessage) {
  const actor = activity?.actor;
  const item = sneakItemOf(actor);
  if ( !item || !attackMessage ) return null;
  const targets = attackMessage.system?.targets ?? [];
  if ( targets.length !== 1 ) return null;   // « une créature que vous touchez »
  const target = fromUuidSync(targets[0].token ?? "", { strict: false });
  const { scene, token } = attackMessage.speaker ?? {};
  const source = game.scenes.get(scene)?.tokens.get(token) ?? null;
  if ( !target?.actor || !source ) return null;
  const weapon = activity.item;
  const dice = sneakDiceOf(item);
  if ( !dice ) return null;
  const properties = weapon?.system?.properties;
  const facts = factsFor({ source: actor, target: target.actor, activity, sourceToken: source, targetToken: target });
  const rule = contentOf(item).entry?.sneakAttack;
  const issue = sneakAttackIssue({
    weapon: (activity.type === "attack") && (weapon?.type === "weapon"),
    finesse: properties?.has?.("fin") === true,
    rangedWeapon: RANGED_WEAPON_TYPES.includes(weapon?.system?.type?.value),
    advantageMode: attackMessage.rolls?.[0]?.options?.advantageMode ?? 0,
    allyNear: facts["source.allyNearTarget"]({ distance: 5, units: "ft" }),
    spent: sneakSpent(actor),
    anyWeapon: rule?.anyWeapon === true,
    freeTarget: (rule?.alwaysVs ?? []).includes(facts["target.creatureType"])
  });
  return { item, dice, issue, source, target };
}

/** Les parts de plus de l'Attaque sournoise (Assassinat au premier round) : `{ name, formula }`. */
export function sneakBonusesOf(actor) {
  const firstRound = !!game.combat?.started && (game.combat.round === 1);
  return Array.from(actor?.items ?? []).flatMap(i => {
    const b = contentOf(i).entry?.sneakBonus;
    return (b && (!b.firstRound || firstRound)) ? [{ name: i.name, formula: b.formula, data: i.getRollData() }] : [];
  });
}

/** L'acteur a-t-il un item de cet identifiant (la trousse d'empoisonneur : `poisoners-kit`) ? */
function owns(actor, requires) {
  return Array.from(actor?.items ?? []).some(i => (identifierOf(i).id === requires) || (i.system?.identifier === requires));
}

/** Rang de taille de dnd5e. */
const sizeRank = size => SIZES.indexOf(size);

/**
 * Les Frappes rusées que l'auteur connaît, avec ce qui les rend possibles contre cette cible.
 * @returns {Array<{key: string, cost: number, available: boolean, item: Item5e, activity: Activity|null, withdraw: boolean,
 *   label: string}>}
 */
export function strikeOptionsOf(actor, target) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    for ( const [key, rule] of Object.entries(contentOf(item).entry?.cunningStrikes ?? {}) ) {
      if ( out.some(o => o.key === key) ) continue;
      const activity = rule.activity ? item.system.activities?.get(rule.activity) ?? null : null;
      if ( rule.activity && !activity ) continue;
      const size = target?.actor?.system?.traits?.size;
      const available = (!rule.requires || owns(actor, rule.requires))
        && (!rule.sizeAtMost || !size || (sizeRank(size) <= sizeRank(rule.sizeAtMost)));
      out.push({ key, cost: rule.cost, available, item, activity, withdraw: rule.withdraw === true,
        label: game.i18n.localize(`DND5ECOMBAT.Sournoise.Frappe.${key}`) });
    }
  }
  return out;
}

/** Combien de Frappes rusées par Attaque sournoise (Frappe rusée améliorée : 2). */
export function strikeMaxOf(actor) {
  return Math.max(1, ...Array.from(actor?.items ?? []).map(i => Number(contentOf(i).entry?.cunningStrikeMax) || 1));
}

/**
 * Sur le client de l'auteur, avant ses dégâts : quelles Frappes rusées ? Une case par effet qu'il peut payer ; sans réponse dans
 * le délai, aucune (tous les dés). Rend les clés cochées, dans l'ordre de la liste.
 * @param {Actor} actor
 * @param {TokenDocument} target
 * @param {{number: number, faces: number}} dice
 * @returns {Promise<string[]>}
 */
export async function askStrikes(actor, target, dice) {
  const options = affordableStrikes(strikeOptionsOf(actor, target), dice.number);
  if ( !options.length ) return [];
  const max = strikeMaxOf(actor);
  const t = (key, data={}) => game.i18n.format(`DND5ECOMBAT.Sournoise.${key}`, data);
  const rows = options.map(o => `<label class="checkbox"><input type="checkbox" name="${o.key}"> ${o.label}
    <span class="hint">(−${o.cost}d${dice.faces})</span></label>`).join("");
  const picked = await timedWait({
    window: { title: t("Titre", { name: actor.name }) },
    content: `<p>${t("Question", { n: dice.number, faces: dice.faces, name: target.name, max })}</p><div class="form-group stacked">${rows}</div>`,
    buttons: [
      { action: "strike", label: t("Frapper"), icon: "fa-solid fa-bolt", default: true,
        callback: (event, button, dialog) => options.filter(o => (dialog.element ?? button.form)?.querySelector(`input[name="${o.key}"]`)?.checked).map(o => o.key) },
      { action: "none", label: t("Aucune"), callback: () => [] }
    ]
  }, { fallback: [] });
  return Array.isArray(picked) ? picked : [];
}
