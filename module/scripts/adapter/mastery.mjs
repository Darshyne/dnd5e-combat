/**
 * Bottes d'arme (SPEC §21) lues et écrites dans dnd5e 6.0 : la botte employée par une attaque, les marques que posent Sape, Coup
 * vexant et Ralentissement (des effets du moteur, `flags["dnd5e-combat"].mastery`), l'Avantage et le Désavantage qu'elles
 * donnent, et les créatures qu'Enchaînement peut atteindre. Les règles sont dans core/mastery.mjs.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - le message d'attaque porte la botte employée dans `system.mastery` (data/chat-message/attack-message-data.mjs:29), choisie
 *    parmi `masteryOptions` de l'arme — seulement si l'acteur maîtrise l'arme de base (data/item/weapon.mjs:331) ;
 *  - la caractéristique de l'attaque est `system.ability` du même message ;
 *  - la Vitesse se réduit par `system.attributes.movement.bonus`, ajouté à chaque vitesse non nulle (attributes.mjs:563-567).
 */

import { MODULE_ID } from "../constants.mjs";
import { areHostile } from "../core/reaction.mjs";
import { convertLength, isWithinRange } from "../core/units.mjs";
import { readUnitFactors } from "./units.mjs";
import { distanceBetween, reachOf, combatantFor, currentTurnKey } from "./turn.mjs";
import { isObjectToken } from "./bodies.mjs";
import { isDeadActor } from "./death.mjs";

const loc = (key, data) => game.i18n.format(`DND5ECOMBAT.Botte.${key}`, data ?? {});

/** La botte employée par ce jet d'attaque, ou null. */
export const masteryOf = attackMessage => attackMessage?.system?.mastery ?? null;

/** Le modificateur de la caractéristique employée pour ce jet d'attaque. */
export function attackModOf(attackMessage) {
  const actor = attackMessage?.getAssociatedActor?.();
  const ability = attackMessage?.system?.ability;
  return Number(actor?.system?.abilities?.[ability]?.mod) || 0;
}

/** Les marques de botte d'une sorte portées par un acteur. */
export function marksOn(actor, kind=null) {
  return Array.from(actor?.effects ?? []).filter(e => {
    const m = e.getFlag?.(MODULE_ID, "mastery");
    return m && (!kind || (m.kind === kind));
  });
}

const IMAGES = Object.freeze({ sap: "icons/svg/downgrade.svg", vex: "icons/svg/target.svg", slow: "icons/svg/net.svg", studied: "icons/svg/eye.svg",
  reckless: "icons/svg/sword.svg" });

/**
 * L'effet d'une marque. `bearer` : qui la porte (la cible pour Sape et Ralentissement, l'attaquant pour Ouverture).
 * @param {"sap"|"vex"|"slow"} kind
 * @param {{source: TokenDocument, target: TokenDocument, weapon: Item5e, turnKey: string|null}} context
 */
export function markData(kind, { source, target, weapon, turnKey }) {
  const changes = [];
  if ( kind === "slow" ) {
    // « Réduire sa Vitesse de 3 m » : 10 ft, dans l'unité de vitesse de la créature ralentie.
    const units = target.actor?.system?.attributes?.movement?.units ?? "ft";
    let value = 10;
    try { value = convertLength(10, "ft", units, readUnitFactors()); } catch { /* unité inconnue : pieds */ }
    changes.push({ key: "system.attributes.movement.bonus", value: String(-value), type: "add" });
  }
  return {
    name: loc(`Marque.${kind}`, { source: source.name, target: target.name, weapon: weapon?.name ?? "" }),
    img: IMAGES[kind],
    transfer: false, disabled: false,
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    origin: weapon?.uuid ?? null,
    // Hors combat, une marque ne vit qu'un round (au MJ de la retirer plus tôt) ; en combat, le moteur la retire à son heure.
    duration: { value: 12, units: "seconds" },
    system: { changes },
    flags: { [MODULE_ID]: { mastery: {
      kind, source: source.actor?.uuid ?? null, sourceToken: source.uuid, target: target.uuid,
      combatant: combatantFor(source.actor)?.id ?? null, placedOn: turnKey
    } } }
  };
}

/**
 * L'Avantage et le Désavantage que donnent les marques pour une attaque de `sourceToken` contre `targetToken` : Sape portée par
 * l'attaquant (Désavantage à son prochain jet), Ouverture portée par l'attaquant contre cette cible (Avantage).
 * @returns {{advantage: string[], disadvantage: string[], consumed: ActiveEffect[]}}
 */
export function markModifiers(sourceToken, targetToken, activity=null) {
  const out = { advantage: [], disadvantage: [], consumed: [] };
  const attacker = sourceToken?.actor;
  if ( !attacker ) return out;
  // §22 : Témérité — « l'Avantage aux jets d'attaque utilisant la Force », et « les jets d'attaque contre vous ont l'Avantage ».
  // Jusqu'au début de son prochain tour ; rien n'est consommé.
  if ( (activity?.ability === "str") ) for ( const effect of marksOn(attacker, "reckless") ) out.advantage.push(effect.name);
  for ( const effect of marksOn(targetToken?.actor, "reckless") ) out.advantage.push(effect.name);
  for ( const effect of marksOn(attacker, "sap") ) {
    out.disadvantage.push(effect.name);
    out.consumed.push(effect);
  }
  // Ouverture, et Attaques avisées du Guerrier (§21) : l'Avantage contre la créature marquée seulement.
  for ( const effect of [...marksOn(attacker, "vex"), ...marksOn(attacker, "studied")] ) {
    if ( effect.getFlag(MODULE_ID, "mastery").target !== targetToken?.uuid ) continue;
    out.advantage.push(effect.name);
    out.consumed.push(effect);
  }
  return out;
}

/**
 * Enchaînement : les créatures qu'une seconde attaque peut viser — hostiles à l'attaquant, autres que la première, à 1,50 m
 * d'elle et à l'allonge de l'arme, ni mortes ni cachées, pas des objets.
 * @param {TokenDocument} attacker
 * @param {TokenDocument} first
 * @param {Activity} activity
 */
export function cleaveCandidates(attacker, first, activity) {
  const factors = readUnitFactors();
  const r = reachOf(activity);
  const reach = { value: r.value ?? 5, units: r.units ?? "ft" };   // allonge non renseignée : 1,50 m
  const near = (a, b, range) => { try { return isWithinRange(distanceBetween(a, b), range, factors); } catch { return false; } };
  return first.parent.tokens.filter(t => (t !== first) && (t !== attacker) && t.actor && !t.hidden && !isObjectToken(t)
    && !isDeadActor(t.actor) && ((t.actor.system.attributes?.hp?.value ?? 1) > 0)
    && areHostile(attacker.disposition, t.disposition)
    && near(first, t, { value: 5, units: "ft" }) && near(attacker, t, reach));
}

/** Enchaînement déjà employé à ce tour de combat par cet acteur ? (« une fois par tour » ; hors combat, jamais.) */
export const cleaveSpent = actor => !!currentTurnKey() && (actor?.getFlag(MODULE_ID, "cleaveTurn") === currentTurnKey());
