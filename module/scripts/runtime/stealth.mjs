/**
 * §183 : le mode furtif d'un PJ (étape 6c de l'IA des PNJ). Hors combat, un joueur passe son personnage en mode furtif (raccourci,
 * bouton d'un voisin) ; l'interface lui montre alors les cônes de vision (§182) des créatures qu'il voit. L'état est un flag du token
 * (`flags.dnd5e-combat.sneaking`), écrit par son propriétaire ; il tombe quand le token entre dans un combat commencé.
 * Les règles de détection (Furtivité 2024 / BG3) viendront à l'étape 6d : ici, rien ne change aux jets.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** Le token est-il en mode furtif ? */
export function isSneaking(token) {
  const doc = token?.document ?? token;
  return doc?.getFlag?.(MODULE_ID, "sneaking") === true;
}

/** Figure-t-il dans un combat commencé ? */
const fighting = doc => !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.tokenId === doc.id));

/**
 * Passer en mode furtif ou en sortir (`on` absent : basculer). Refusé en combat, et pour qui ne possède pas le token.
 * @returns {Promise<{sneaking: boolean, reason?: string}>}
 */
export async function setSneaking(token, on=undefined) {
  const doc = token?.document ?? token;
  if ( !doc?.isOwner ) return { sneaking: isSneaking(doc), reason: "notOwner" };
  const wanted = (on === undefined) ? !isSneaking(doc) : !!on;
  if ( wanted && fighting(doc) ) return { sneaking: false, reason: "inCombat" };
  if ( wanted === isSneaking(doc) ) return { sneaking: wanted };
  if ( wanted ) await doc.setFlag(MODULE_ID, "sneaking", true);
  else await doc.unsetFlag(MODULE_ID, "sneaking");
  Hooks.callAll(`${MODULE_ID}.sneak`, doc, wanted);
  return { sneaking: wanted };
}

/** Un combat commence, ou accueille un token : il sort du mode furtif (MJ actif). */
async function leaveOnCombat(combat) {
  if ( !combat?.started ) return;
  for ( const c of combat.combatants ) {
    const doc = c.token;
    if ( doc && isSneaking(doc) ) {
      await doc.unsetFlag(MODULE_ID, "sneaking");
      Hooks.callAll(`${MODULE_ID}.sneak`, doc, false);
      log(`sneak: ${doc.name} leaves sneak mode (combat)`);
    }
  }
}

export const stealthApi = Object.freeze({ is: isSneaking, set: setSneaking, toggle: token => setSneaking(token) });

export function registerStealthMode() {
  const label = { executor: true, label: "sneak: not left on combat" };
  route("combatStart", combat => leaveOnCombat(combat), label);
  route("createCombatant", combatant => leaveOnCombat(combatant.parent), label);
}
