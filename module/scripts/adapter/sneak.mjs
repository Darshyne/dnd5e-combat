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
import { speakerTokenOf } from "./turn.mjs";

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
  const source = speakerTokenOf(attackMessage);
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

/* -------------------------------------------- */
/*  §223 : automatique ou au choix              */
/* -------------------------------------------- */

/** Réglage de monde : l'Attaque sournoise se met d'elle-même au premier coup éligible du tour (« auto ») ou l'auteur choisit (« ask »). */
export const SNEAK_MODE_SETTING = "sneakAttackMode";
export const SNEAK_MODES = Object.freeze(["auto", "ask"]);

/** Le mode du monde (« auto » si le réglage n'est pas lisible). */
export function sneakMode() {
  try {
    const mode = game.settings.get(MODULE_ID, SNEAK_MODE_SETTING);
    return SNEAK_MODES.includes(mode) ? mode : "auto";
  } catch { return "auto"; }
}

/** La clé qui arme l'Attaque sournoise pour le prochain coup éligible : le tour en cours, ou « free » hors combat. */
const armKey = () => currentTurnKey() ?? "free";

/** L'auteur a-t-il réservé son Attaque sournoise (l'activité de l'item, en mode « ask ») pour le prochain coup éligible de ce tour ? */
export function sneakArmed(actor) {
  return actor?.getFlag(MODULE_ID, "sneakArmed") === armKey();
}

/** Réserve (ou libère) l'Attaque sournoise pour le prochain coup éligible de ce tour. */
export async function armSneak(actor, armed=true) {
  if ( !actor?.isOwner ) return;
  if ( armed ) await actor.setFlag(MODULE_ID, "sneakArmed", armKey());
  else if ( actor.getFlag(MODULE_ID, "sneakArmed") !== undefined ) await actor.unsetFlag(MODULE_ID, "sneakArmed");
}

/**
 * §223 : sur le client de l'auteur, avant ses dégâts, une seule fenêtre pour ce qui se décide « au toucher » :
 *  - l'Attaque sournoise elle-même, en mode « ask » (case cochée d'avance), sauf si l'auteur l'a réservée par l'activité de l'item ;
 *  - les Frappes rusées qu'il peut payer (elles retirent des dés à l'Attaque sournoise ; sans elle, ignorées) ;
 *  - les dégâts bonus au choix (`ask` : Frappe effroyable), décochés d'avance.
 * Sans réponse dans le délai : ce que la fenêtre propose par défaut (l'Attaque sournoise, rien d'autre). Sans rien à demander, pas de
 * fenêtre.
 * @param {Actor} actor
 * @param {TokenDocument} target
 * @param {{dice: {number: number, faces: number}, issue: string|null}|null} sneak   sneakAttackFor (null : pas d'Attaque sournoise).
 * @param {Array<{key: string, name: string, formula: string, damageType: string|null, left: number}>} bonuses   optionalBonusesFor.
 * @returns {Promise<{sneak: boolean|null, strikes: string[], bonuses: string[]}>}  `sneak` : null sans Attaque sournoise possible.
 */
export async function askHitOptions(actor, target, sneak, bonuses=[]) {
  const eligible = !!sneak && !sneak.issue;
  const ask = eligible && (sneakMode() === "ask") && !sneakArmed(actor);
  const options = eligible ? affordableStrikes(strikeOptionsOf(actor, target), sneak.dice.number) : [];
  const fallback = { sneak: eligible ? true : null, strikes: [], bonuses: [] };
  if ( !ask && !options.length && !bonuses.length ) return fallback;
  const t = (key, data={}) => game.i18n.format(`DND5ECOMBAT.Sournoise.${key}`, data);
  // Une ligne par case : la case, le libellé, puis les dés à droite (sans `.form-group`, qui empilait le libellé mot à mot).
  const box = (name, label, hint, checked=false) => `<label class="das-hit-option"><input type="checkbox" name="${name}"${checked ? " checked" : ""}>
    <span class="das-hit-option__label">${label}</span>${hint ? `<span class="das-hit-option__hint">${hint}</span>` : ""}</label>`;
  const list = rows => `<div class="das-hit-options">${rows.join("")}</div>`;
  const parts = [];
  if ( ask ) parts.push(list([box("sneak", t("Utiliser", { name: target.name }), `+${sneak.dice.number}d${sneak.dice.faces}`, true)]));
  if ( options.length ) {
    const max = strikeMaxOf(actor);
    parts.push(`<p>${ask ? t("QuestionFrappes", { max }) : t("Question", { n: sneak.dice.number, faces: sneak.dice.faces, name: target.name, max })}</p>`,
      list(options.map(o => box(o.key, o.label, `−${o.cost}d${sneak.dice.faces}`))));
  }
  if ( bonuses.length ) {
    const type = d => (d ? game.i18n.localize(CONFIG.DND5E.damageTypes[d]?.label ?? d) : "");
    parts.push(`<p>${t("QuestionBonus", { name: target.name })}</p>`, list(bonuses.map(b => box(`bonus-${b.key}`, b.name,
      [`+${b.formula} ${type(b.damageType)}`.trim(), Number.isFinite(b.left) ? t("Restantes", { n: b.left }) : ""].filter(Boolean).join(", ")))));
  }
  const checked = (dialog, button, name) => !!(dialog.element ?? button.form)?.querySelector(`input[name="${name}"]`)?.checked;
  const picked = await timedWait({
    window: { title: t(options.length && !ask && !bonuses.length ? "Titre" : "TitreCoup", { name: actor.name }) },
    position: { width: 400 },
    content: parts.join(""),
    buttons: [
      { action: "strike", label: t("Frapper"), icon: "fa-solid fa-bolt", default: true,
        callback: (event, button, dialog) => {
          const sneakOn = eligible && (!ask || checked(dialog, button, "sneak"));
          return {
            sneak: eligible ? sneakOn : null,
            strikes: sneakOn ? options.filter(o => checked(dialog, button, o.key)).map(o => o.key) : [],
            bonuses: bonuses.filter(b => checked(dialog, button, `bonus-${b.key}`)).map(b => b.key)
          };
        } },
      // « Rien » : ni Frappe ni dégâts au choix ; l'Attaque sournoise reste si elle est automatique, et se garde si on la demandait.
      { action: "none", label: t((ask || bonuses.length) ? "Rien" : "Aucune"), callback: () => ({ sneak: eligible ? !ask : null, strikes: [], bonuses: [] }) }
    ]
  }, { fallback });
  return (picked && (typeof picked === "object")) ? picked : fallback;
}
