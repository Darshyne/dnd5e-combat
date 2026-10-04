/**
 * Riposte (SPEC §16.9, brique B9) : une créature touchée par une attaque en inflige des dégâts à l'attaquant — Bouclier
 * de feu, Armure d'Agathys, Forme corrosive. Lu et joué dans Foundry ; la règle (quand) est une déclaration du registre
 * (moment `isHit`, étape `damage` avec `to: "source"`), jugée AVANT l'application des dégâts de l'attaque (« tant que
 * vous avez ces PV temporaires » se juge au moment du coup), jouée APRÈS.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - une activité de dégâts donne sa configuration de jet, mise à l'échelle par `item.scaledClone(scaling)` comme le fait
 *    le message d'utilisation (documents/chat-message.mjs, `getAssociatedItem`), par `getDamageConfig()`
 *    (data/activity/base-activity.mjs) : `rolls[] = { parts, data, options }` ;
 *  - un effet appliqué par le plateau garde le niveau de lancement : `flags.dnd5e.scaling` (effect-application.mjs,
 *    `_prepareEffectData`) — la trace du moteur (adapter/traces.mjs) l'écrit de même ;
 *  - `DamageRoll.toMessage(rolls, messageData)` (dice/basic-roll.mjs) : une carte de jet sans activité associée, que le
 *    moteur ne prend pas pour les dégâts d'une résolution (adapter/messages.mjs, `readDamageMessage`).
 */

import { MODULE_ID } from "../constants.mjs";
import { select, stepsOf } from "../core/triggers.mjs";
import { declarationsOf, declarationsOfEffects, factsFor } from "./triggers.mjs";
import { applyDamageToToken } from "./messages.mjs";
import { describeTarget } from "./areas.mjs";

/**
 * §86 : riposte par une sauvegarde (étape `save`, `to: "source"`) — l'attaquant fait la sauvegarde d'une activité de l'item
 * (Aura sacrée : Constitution, Aveuglé sur un échec). Même forme que `pulseAgainst` (adapter/areas.mjs) : un message d'utilisation
 * neuf de l'activité (au niveau de lancement de l'effet porté), l'attaquant pour seule cible, marqué `areaTick` — rien n'est
 * dépensé, la résolution de sauvegarde habituelle s'applique (DD du lanceur, effets sur un échec). MJ actif uniquement.
 * @returns {Promise<ChatMessage|null>}
 */
export async function saveRetaliation({ declaration, step }, { bearerToken, attackerToken }) {
  if ( !attackerToken?.actor ) return null;
  const item = fromUuidSync(declaration.item ?? "", { strict: false });
  const effect = declaration.effect ? fromUuidSync(declaration.effect, { strict: false }) : null;
  const scaling = effect?.getFlag?.("dnd5e", "scaling") ?? 0;
  const scaled = (scaling && item?.scaledClone) ? item.scaledClone(scaling) : item;
  const activity = scaled?.system?.activities?.get(step.activity);
  if ( !activity ) return null;
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor ?? undefined }),
    flavor: game.i18n.format("DND5ECOMBAT.RiposteSauvegarde", { item: declaration.name ?? item.name, attacker: attackerToken.name, bearer: bearerToken?.name ?? "" }),
    system: { ...card, targets: [describeTarget(attackerToken)] },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: { event: "retaliation", source: bearerToken?.uuid ?? null, token: attackerToken.uuid } } }
  });
}

/**
 * Les ripostes que déclenche une attaque qui touche, jugées avant ses dégâts.
 * @param {object} context
 * @param {TokenDocument} context.bearerToken    La créature touchée.
 * @param {TokenDocument} context.attackerToken  L'attaquant.
 * @param {Activity} context.activity            L'activité d'attaque.
 * @param {string|null} context.attackMode       Mode d'attaque du jet (« thrown » : pas au corps à corps).
 * @returns {Array<{declaration: object, step: object}>}
 */
export function retaliationsFor({ bearerToken, attackerToken, activity, attackMode=null }) {
  const bearer = bearerToken?.actor;
  const attacker = attackerToken?.actor;
  if ( !bearer || !attacker || (bearer === attacker) ) return [];
  const declarations = [...declarationsOf(bearer), ...declarationsOfEffects(bearer)];
  const facts = factsFor({ source: attacker, target: bearer, activity, sourceToken: attackerToken, targetToken: bearerToken, attackMode });
  return select(declarations, "isHit", facts).flatMap(d => [...stepsOf(d, "damage"), ...stepsOf(d, "save")]
    .filter(s => s.to === "source").map(step => ({ declaration: d, step })));
}

/** Les jets de dégâts d'une riposte : l'activité de dégâts de l'item (au niveau de lancement), ou la formule déclarée. */
async function rollsFor({ declaration, step }, bearer) {
  const item = fromUuidSync(declaration.item ?? "", { strict: false });
  const effect = declaration.effect ? fromUuidSync(declaration.effect, { strict: false }) : null;
  if ( step.activity ) {
    const scaling = effect?.getFlag?.("dnd5e", "scaling") ?? 0;
    const scaled = (scaling && item?.scaledClone) ? item.scaledClone(scaling) : item;
    const activity = scaled?.system?.activities?.get(step.activity);
    if ( !activity?.getDamageConfig ) return [];
    const config = activity.getDamageConfig({});
    return (config.rolls ?? []).filter(r => r.parts?.length)
      .map(r => new CONFIG.Dice.DamageRoll(r.parts.join(" + "), r.data ?? activity.getRollData(), r.options ?? {}));
  }
  const data = item?.getRollData?.() ?? bearer.getRollData();
  return [new CONFIG.Dice.DamageRoll(step.formula, data, { type: step.damageType, types: [step.damageType], properties: ["mgc"] })];
}

/**
 * Joue une riposte : jet de dégâts (carte visible de tous, au nom de la créature touchée), puis dégâts appliqués à
 * l'attaquant par la méthode du système (résistances et immunités comprises). MJ actif uniquement.
 * @returns {Promise<object|null>}  Entrée de journal (PV avant / après) pour l'annulation, ou null.
 */
export async function retaliate(retaliation, { bearerToken, attackerToken }) {
  const bearer = bearerToken?.actor;
  const attacker = attackerToken?.actor;
  if ( !bearer || !attacker ) return null;
  const rolls = await rollsFor(retaliation, bearer);
  if ( !rolls.length ) return null;
  for ( const roll of rolls ) await roll.evaluate();
  const { declaration } = retaliation;
  const message = await CONFIG.Dice.DamageRoll.toMessage(rolls, {
    speaker: ChatMessage.implementation.getSpeaker({ actor: bearer, token: bearerToken }),
    flavor: game.i18n.format("DND5ECOMBAT.Riposte", { item: declaration.name, attacker: attackerToken.name }),
    flags: { [MODULE_ID]: { retaliation: { item: declaration.identifier, bearer: bearerToken.uuid, attacker: attackerToken.uuid } } }
  });
  const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
    properties: new Set(roll.options.properties ?? []),
    type: roll.options.type ?? retaliation.step.damageType,
    value: Math.max(0, roll.total)
  }));
  const entry = await applyDamageToToken(attackerToken.uuid, damages, message);
  return entry ? { ...entry, name: declaration.name } : null;
}

/**
 * Dégâts lancés par le moteur et appliqués à une créature (SPEC §19) : les dégâts d'issue d'une résolution (moments hit,
 * failedSave : « Une cible subit 5 (2d4) dégâts nécrotiques supplémentaires si elle échoue ») et ceux du porteur d'un effet à
 * son tour (Flèche acide de Melf). Même chemin qu'une riposte : carte de jet visible de tous, puis `applyDamageToToken`
 * (résistances et immunités comprises). `step` : `{ formula, damageType }` ou `{ activity }` (activité de dégâts de
 * `item`, au niveau `scaling`). `multiplier` : 0,5 pour une sauvegarde réussie. MJ actif uniquement.
 * @returns {Promise<object|null>}  Entrée de journal (PV avant / après), ou null.
 */
export async function inflict({ step, item=null, scaling=0, speaker, targetUuid, flavor, flags={}, multiplier=1, properties=["mgc"] }) {
  if ( !(multiplier > 0) ) return null;
  let rolls;
  if ( step.activity ) {
    const scaled = (scaling && item?.scaledClone) ? item.scaledClone(scaling) : item;
    const activity = scaled?.system?.activities?.get(step.activity);
    if ( !activity?.getDamageConfig ) return null;
    const config = activity.getDamageConfig({});
    rolls = (config.rolls ?? []).filter(r => r.parts?.length)
      .map(r => new CONFIG.Dice.DamageRoll(r.parts.join(" + "), r.data ?? activity.getRollData(), r.options ?? {}));
  }
  else {
    const data = item?.getRollData?.() ?? {};
    // `properties` : magiques par défaut (sorts, capacités) ; §21 : Écorchure garde celles de l'arme (une arme ordinaire ne l'est pas).
    rolls = [new CONFIG.Dice.DamageRoll(step.formula, data, { type: step.damageType, types: [step.damageType], properties })];
  }
  if ( !rolls.length ) return null;
  for ( const roll of rolls ) await roll.evaluate();
  const message = await CONFIG.Dice.DamageRoll.toMessage(rolls, { speaker, flavor, flags: { [MODULE_ID]: flags } });
  const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
    properties: new Set(roll.options.properties ?? []),
    type: roll.options.type ?? step.damageType,
    value: Math.max(0, roll.total)
  }));
  return applyDamageToToken(targetUuid, damages, message, { multiplier });
}
