/**
 * Objets pilotés (SPEC §16.15, B19), lus et écrits dans Foundry : Arme spirituelle, Sphère de feu, Main de Bigby.
 *
 * Vérifié dans dnd5e 6.0.3 et le PHB 2.2.0 :
 *  - le sort a une activité « summon » ; l'acteur invoqué porte `flags.dnd5e.summon.origin` = uuid de l'item du lanceur
 *    (documents/activity/summon.mjs:145, 261) ; c'est le joueur qui l'importe et pose le token : il en est propriétaire ;
 *  - ses activités de commande ont l'activation « bonus » (« Move and Attack » de l'Arme spirituelle : attaque de sort au
 *    corps à corps à 5 ft, bonus d'attaque recopié du lanceur par `match.attacks`, summon.mjs:408 ; dégâts
 *    `(@flags.dnd5e.summon.level - 1)d8 + @flags.dnd5e.summon.mod`) ;
 *  - l'Arme spirituelle n'a aucune vitesse et une disposition « secrète » (-2) : la distance d'une commande vient du
 *    contenu, l'hostilité se juge d'après le lanceur.
 *
 * L'état de la commande du tour vit sur le combattant du LANCEUR (`flags["dnd5e-combat"].commands.<id du token>`),
 * écrit par le MJ actif ; un état d'un autre tour ne compte pas (core/pilot.mjs, `currentCommand`).
 */

import { MODULE_ID } from "../constants.mjs";
import { planCommand, currentCommand, canTranspose } from "../core/pilot.mjs";
import { convertLength } from "../core/units.mjs";
import { summonItemOf } from "./summons.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { combatantFor, isOwnTurn } from "./turn.mjs";

/**
 * L'objet piloté que ce token représente, ou null.
 * @param {TokenDocument} tokenDoc
 * @returns {{token: TokenDocument, item: Item, summoner: Actor, rule: object, endsSpell: boolean}|null}
 */
export function pilotOf(tokenDoc) {
  if ( !tokenDoc?.actor ) return null;
  const item = summonItemOf(tokenDoc);
  const summon = item ? contentOf(item).entry?.summon : null;
  if ( !summon?.pilot || !item.actor ) return null;
  return { token: tokenDoc, item, summoner: item.actor, rule: summon.pilot, summon, endsSpell: summon.endsSpell === true };
}

/** L'objet piloté d'un acteur invoqué (son token sur la scène), ou null. */
export function pilotOfActor(actor) {
  if ( !actor?.getFlag?.("dnd5e", "summon.origin") ) return null;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  return token ? pilotOf(token) : null;
}

/** Le combattant du lanceur (celui qui paie les commandes), ou null hors combat. */
export function summonerCombatant(pilot) {
  return pilot ? combatantFor(pilot.summoner) : null;
}

/** Le token (TokenDocument) du lanceur sur la scène de l'objet, ou null. */
export function summonerToken(pilot) {
  const tokens = pilot?.summoner?.getActiveTokens?.(false, true) ?? [];
  return tokens.find(t => t.parent === pilot.token.parent) ?? tokens[0] ?? null;
}

/** Clé du tour en cours d'un combat. */
export function turnKey(combat) {
  return combat ? `${combat.id}.${combat.round}.${combat.turn}` : "";
}

/**
 * Sous quelle clé la commande est tenue : le token, ou pour une commande partagée (`shared`, Lumières dansantes) le sort —
 * l'effet de concentration qui tient les objets, à défaut l'item. Une clé sans point : c'est un chemin de flag.
 */
export function commandKey(pilot) {
  if ( !pilot.rule.shared ) return pilot.token.id;
  const effect = pilot.token.getFlag(MODULE_ID, "summonedBy")?.split(".").at(-1);
  return effect ? `fx${effect}` : `it${pilot.item.id}`;
}

/** Les objets du même sort sur la scène de celui-ci (lui compris). */
export function groupTokens(pilot) {
  const origin = pilot.item.uuid;
  return pilot.token.parent.tokens.filter(t => t.actor?.getFlag("dnd5e", "summon.origin") === origin);
}

/** L'état de la commande de cet objet, tel qu'écrit (peut dater d'un autre tour). */
export function readCommand(combatant, pilot) {
  return combatant?.getFlag(MODULE_ID, `commands.${commandKey(pilot)}`) ?? null;
}

export async function writeCommand(combatant, pilot, state) {
  await combatant.setFlag(MODULE_ID, `commands.${commandKey(pilot)}`, state);
}

/**
 * Ce que coûterait ce geste maintenant, et l'état qui en résulterait.
 * @param {object} pilot
 * @param {"move"|"use"} gesture
 * @returns {{combatant: Combatant|null, ownTurn: boolean, pay: string|null, next: object|null}}
 */
export function commandPlan(pilot, gesture) {
  const combatant = summonerCombatant(pilot);
  if ( !combatant ) return { combatant: null, ownTurn: true, pay: null, next: null };
  const key = turnKey(combatant.combat);
  const { pay, next } = planCommand(readCommand(combatant, pilot), gesture, pilot.rule.cost, key);
  // `free` (Invocation d'animaux : « quand vous vous déplacez à votre tour, vous pouvez aussi déplacer la meute ») : rien à payer.
  return { combatant, ownTurn: isOwnTurn(combatant), pay: (pay === "free") ? null : pay, next };
}

/** Distance d'une commande, dans l'unité de la grille. */
export function commandDistance(pilot, factors) {
  const units = pilot.token.parent?.grid.units ?? pilot.rule.units;
  try { return convertLength(pilot.rule.distance, pilot.rule.units, units, factors); }
  catch { return pilot.rule.distance; }
}

/**
 * Les activités qu'une commande fait jouer à l'objet : celles de ses items dont l'activation est celle d'une commande
 * (l'action Bonus), qui visent autre chose que l'objet lui-même.
 * @returns {Activity[]}
 */
export function commandActivities(pilot, { self=false }={}) {
  const out = [];
  for ( const item of pilot.token.actor?.items ?? [] ) {
    for ( const activity of item.system.activities ?? [] ) {
      if ( activity.activation?.type !== pilot.rule.cost ) continue;
      if ( !["attack", "save", "damage", "heal", "utility"].includes(activity.type) ) continue;
      if ( (activity.range?.units === "self") !== self ) continue;
      // Un utilitaire qui vise ailleurs (« Move » de l'Œil magique) n'est pas une action contre une créature : le
      // déplacement de l'objet se fait au clic.
      if ( !self && (activity.type === "utility") ) continue;
      out.push(activity);
    }
  }
  return out;
}

/** Libellé d'une commande : l'item, et l'activité s'il en a plusieurs (« Grasping Hand (Crush) »). */
export function commandLabel(activity) {
  const item = activity.item;
  return ((item.system.activities?.size ?? 0) > 1) && activity.name ? `${item.name} (${activity.name})` : item.name;
}

/** Ce que l'objet fait autour de lui (`summon.pulse`) : la règle et l'activité de son item, ou null. */
export function pulseOf(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  const rule = item ? contentOf(item).entry?.summon?.pulse : null;
  if ( !rule ) return null;
  const own = tokenDoc.actor?.items.find(i => i.system.identifier === rule.item);
  const activity = own?.system.activities?.find(a => ["save", "attack", "damage"].includes(a.type)) ?? null;
  return activity ? { rule, activity } : null;
}

/** L'objet n'occupe-t-il pas son espace (Main de Bigby) ? */
export function isIntangible(tokenDoc) {
  return pilotOf(tokenDoc)?.rule.occupies === false;
}

/**
 * L'activité du SORT qui commande ses objets (« Move Lights » de Lumières dansantes : utilitaire à l'action Bonus) : son
 * utilisation ouvre la commande du tour au lieu d'être une dépense à part. Rend le pilote d'un des objets sur la scène
 * du lanceur, ou null.
 */
export function spellCommandOf(activity) {
  const item = activity?.item;
  const summon = item ? contentOf(item).entry?.summon : null;
  if ( !summon?.pilot || (activity.type !== "utility") || (activity.activation?.type !== summon.pilot.cost) ) return null;
  for ( const scene of game.scenes ) {
    const token = scene.tokens.find(t => t.actor?.getFlag("dnd5e", "summon.origin") === item.uuid);
    if ( token ) return pilotOf(token);
  }
  return null;
}

/** Les tokens des invocations de cet acteur dont la règle dit `key` (`castFrom`, `endsIfIncapacitated`…), toutes scènes. */
export function summonsOfWith(actor, key) {
  const out = [];
  if ( !actor ) return out;
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      const origin = token.actor?.getFlag("dnd5e", "summon.origin");
      if ( !origin ) continue;
      const item = fromUuidSync(origin, { strict: false });
      if ( (item?.actor !== actor) || !contentOf(item).entry?.summon?.[key] ) continue;
      out.push(token);
    }
  }
  return out;
}

/** Le combattant d'un objet piloté joue-t-il ? Non : il agit pendant le tour de son lanceur. */
export function isPilotedCombatant(combatant) {
  return !!combatant?.token && !!pilotOf(combatant.token);
}

/**
 * §38.2 : Troc du filou — depuis l'illusion ou depuis son lanceur, la paire qui peut échanger sa place maintenant : le lanceur porte un
 * item `transpose` qui vise l'item de l'invocation (identifiant), et la règle du tour le permet (core/pilot.mjs, `canTranspose`).
 * `createdTurn` / `transposedTurn` : drapeaux de l'illusion (tour de sa création, tour du dernier échange). null sinon.
 * @param {TokenDocument} token  L'illusion, ou le lanceur.
 * @returns {{caster: TokenDocument, illusion: TokenDocument, pilot: object, turnKey: string|null}|null}
 */
export function transposeOf(token) {
  if ( !token?.actor || !token.parent ) return null;
  const own = pilotOf(token);
  const pairs = own ? [own] : token.parent.tokens.map(t => pilotOf(t)).filter(p => p && (p.summoner === token.actor));
  for ( const pilot of pairs ) {
    const casterItem = (pilot.summoner?.items ?? []).find(i => contentOf(i).entry?.transpose?.summon === identifierOf(pilot.item).id);
    if ( !casterItem ) continue;
    const caster = own ? summonerToken(pilot) : token;
    if ( !caster || (caster.parent !== pilot.token.parent) ) continue;
    const combatant = summonerCombatant(pilot);
    const combat = combatant?.combat ?? null;
    const key = combat?.started ? turnKey(combat) : null;
    const allowed = canTranspose({
      inCombat: !!combat?.started, ownTurn: !!combatant && isOwnTurn(combatant), turnKey: key,
      command: combatant ? currentCommand(readCommand(combatant, pilot), key) : null,
      createdTurn: pilot.token.getFlag(MODULE_ID, "createdTurn") ?? null,
      usedTurn: pilot.token.getFlag(MODULE_ID, "transposedTurn") ?? null
    });
    if ( allowed ) return { caster, illusion: pilot.token, pilot, turnKey: key };
  }
  return null;
}