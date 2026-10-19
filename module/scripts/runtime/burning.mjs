/**
 * §212 : En feu (danger « Burning », règles 2024) et propagation des flammes.
 *  - Une créature en feu (l'état `burning` de dnd5e, ou un effet que son item déclare tel : adapter/burning.mjs) subit 1d4 dégâts de
 *    feu au début de chacun de ses tours (MJ actif, en combat). Par une action, elle éteint les flammes en se jetant À terre et en se
 *    roulant au sol (entrée « Éteindre les flammes » du menu de son propre token). Le feu arrosé, l'immersion, l'étouffement : au MJ
 *    (décocher l'état dans le HUD).
 *  - Propagation, selon les règles : une créature en feu qui entre dans une zone inflammable pas encore en feu (Huile, Toile), ou qui
 *    s'y trouve quand elle prend feu, l'embrase (runtime/flammable.mjs). Ses brûlures sont des dégâts de feu : dans une telle zone,
 *    elles l'embrasent aussi (§188 a).
 *  - Propagation maison (réglage de monde `fireSpread`, désactivé par défaut, à la Baldur's Gate 3) : une créature brûlée par une zone
 *    en feu prend feu à son tour, sauf immunité au feu.
 */

import { MODULE_ID } from "../constants.mjs";
import { BURNING, BURN_DAMAGE, burningEffectsOf, isBurning, isBurningEffect, fireImmune } from "../adapter/burning.mjs";
import { isInside } from "../adapter/areas.mjs";
import { setStatus } from "../adapter/conditions.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { unlitZones, igniteViaGM } from "./flammable.mjs";
import { payAction } from "./action-end.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { levelAtLeast } from "./levels.mjs";
import { log, loc, notice, say, waitForDice } from "./shared.mjs";

export const FIRE_SPREAD_SETTING = "fireSpread";

const spreads = () => {
  try { return game.settings.get(MODULE_ID, FIRE_SPREAD_SETTING) === true; } catch { return false; }
};

/* -------------------------------------------- */
/*  Brûler                                      */
/* -------------------------------------------- */

/** MJ actif, au début du tour d'un combattant en feu : 1d4 de feu, lancé dans le chat, appliqué (résistances de dnd5e). */
function onTurnStart(combat, prior, now) {
  const actor = combat.combatants.get(now?.combatantId)?.actor;
  if ( !actor || !isBurning(actor) ) return;
  enqueue(`burning:${actor.uuid}`, async () => {
    if ( !isBurning(actor) || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
    const token = tokenOf(actor);
    const roll = await new Roll(BURN_DAMAGE.formula).evaluate();
    const message = await roll.toMessage({
      speaker: ChatMessage.implementation.getSpeaker({ actor, token }),
      flavor: loc("EnFeu.Brule", { name: token?.name ?? actor.name, amount: roll.total })
    });
    await waitForDice(message);
    await actor.applyDamage([{ value: roll.total, type: BURN_DAMAGE.type }]);
    log(`${actor.name}: burning, ${roll.total} fire at the start of their turn`);
  }).catch(err => console.error(`${MODULE_ID} | burning`, err));
}

/** Éteindre ses flammes : une action (en combat), les effets « En feu » retirés, À terre. Sur le client du propriétaire. */
export async function extinguish(token) {
  const actor = token?.actor;
  if ( !actor || !isBurning(actor) ) return false;
  if ( !(await payAction(token)) ) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", burningEffectsOf(actor).map(e => e.id));
  await setStatus(actor, "prone", true);
  notice(token, loc("EnFeu.Eteint"), "ended");
  await say({ actor, token }, loc("EnFeu.EteintCarte", { name: token.name }));
  log(`${token.name}: rolls on the ground, the flames are out (Prone)`);
  return true;
}

/** L'entrée du menu de son propre token. */
export function burningEntries(token) {
  if ( !token?.isOwner || !isBurning(token.actor) || !levelAtLeast("assisted") ) return [];
  return [{ icon: "fa-solid fa-fire-extinguisher", label: loc("EnFeu.Eteindre"), run: () => extinguish(token) }];
}

/* -------------------------------------------- */
/*  Propagation                                 */
/* -------------------------------------------- */

/** Les zones inflammables pas encore en feu où se tient ce token en feu s'embrasent. */
async function igniteAround(token, cause) {
  if ( !token?.parent || !isBurning(token.actor) || !levelAtLeast("full") ) return;
  for ( const zone of unlitZones(token.parent) ) if ( isInside(token, zone) ) await igniteViaGM(zone, cause);
}

/** MJ actif : un token en feu a bougé — il embrase la zone inflammable où il arrive. */
function onTokenMoved(token, changes) {
  if ( !("x" in changes) && !("y" in changes) && !("elevation" in changes) ) return;
  if ( !isBurning(token.actor) ) return;
  igniteAround(token, `${token.name} is on fire`).catch(err => console.error(`${MODULE_ID} | burning: spread`, err));
}

/** MJ actif : une créature prend feu — la zone inflammable où elle se tient s'embrase. */
function onEffectCreated(effect) {
  if ( !isBurningEffect(effect) || (effect.parent?.documentName !== "Actor") ) return;
  for ( const token of effect.parent.getActiveTokens?.(false, true) ?? [] ) {
    igniteAround(token, `${token.name} catches fire`).catch(err => console.error(`${MODULE_ID} | burning: spread`, err));
  }
}

/**
 * Propagation maison (`fireSpread`) : une créature brûlée par une zone en feu prend feu à son tour (runtime/flammable.mjs, `burnTick`,
 * après les dégâts). MJ actif.
 */
export async function catchFireFromZone(token, zoneName) {
  const actor = token?.actor;
  if ( !spreads() || !actor || isObjectToken(token) || isBurning(actor) || fireImmune(actor) ) return false;
  if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) return false;
  await setStatus(actor, BURNING, true);
  notice(token, loc("EnFeu.PrendFeu"), "gain");
  log(`${token.name}: catches fire from ${zoneName} (house rule: fire spread)`);
  return true;
}

export function registerBurning() {
  game.settings.register(MODULE_ID, FIRE_SPREAD_SETTING, {
    name: `DND5ECOMBAT.Reglage.${FIRE_SPREAD_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${FIRE_SPREAD_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false
  });
  route("combatTurnChange", onTurnStart, { executor: true, label: "burning: start-of-turn fire damage not dealt" });
  route("updateToken", onTokenMoved, { executor: true, label: "burning: flammable zone not ignited by a burning creature" });
  route("createActiveEffect", onEffectCreated, { executor: true, label: "burning: flammable zone not ignited on catching fire" });
}
