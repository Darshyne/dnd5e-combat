/**
 * §210 : coups non létaux et surprise (lot 2 du relevé `prive/RELEVE_REGLES.md`).
 *  - Assommer : l'interrupteur « coups non létaux » (adapter/knockout.mjs) est lu à l'application des dégâts (adapter/death.mjs) ; ici, le
 *    réveil — la créature assommée qui regagne des PV n'est plus Inconsciente (elle reste À terre, comme le veut la règle) —, et les
 *    premiers soins : une créature au contact, test de Sagesse (Médecine) DD 10 sur le client de celui qui soigne, puis le réveil par le
 *    propriétaire ou le MJ actif.
 *  - Surprise : l'état « Surpris » de dnd5e donne déjà le Désavantage à l'initiative (config.mjs `conditionEffects.initiativeDisadvantage`) ;
 *    le moteur le retire une fois l'initiative de la créature lancée (il ne vaut que pour ce jet), et, avec le réglage `surpriseFromStealth`
 *    (actif par défaut), une créature qui ne perçoit pas un ennemi caché de la scène (Furtivité du moteur, `hiddenFrom`) lance son
 *    initiative avec le Désavantage — « un embusqué caché qui commence le combat surprend qui ne se doute de rien ».
 */
import { MODULE_ID } from "../constants.mjs";
import { KNOCKED_OUT_FLAG, FIRST_AID_DC, isKnockedOut } from "../adapter/knockout.mjs";
import { hiddenFrom } from "../adapter/stealth.mjs";
import { route } from "./router.mjs";
import { log, loc, locEsc, notice, say, viaOwnerOrGM, rolledAndShown } from "./shared.mjs";

export const SURPRISE_SETTING = "surpriseFromStealth";
export const WAKE_QUERY = `${MODULE_ID}.wake`;

/* -------------------------------------------- */
/*  Assommer                                    */
/* -------------------------------------------- */

/** Réveille une créature assommée : plus Inconsciente, drapeau retiré. Rend false si elle ne l'était pas. Propriétaire ou MJ. */
async function wake(actor, { reason="hp", by="" }={}) {
  if ( !isKnockedOut(actor) ) return false;
  await actor.unsetFlag(MODULE_ID, KNOCKED_OUT_FLAG);
  if ( actor.statuses.has("unconscious") ) await actor.toggleStatusEffect("unconscious", { active: false });
  await say({ actor }, locEsc(reason === "aid" ? "Assomme.SoinsReveil" : "Assomme.Reveil", { name: actor.name, by }));
  log(`${actor.name}: no longer knocked out (${reason})`);
  return true;
}

/** MJ actif (ou propriétaire) : réveiller la créature visée par des premiers soins réussis. La règle est relue ici. */
async function handleWake({ target, by="" }) {
  const token = await fromUuid(target ?? "");
  return token?.actor ? wake(token.actor, { reason: "aid", by }) : false;
}

/** MJ actif : PV regagnés → réveillée ; tombée à 0 malgré tout (nouveaux dégâts) → plus « assommée », les règles ordinaires reprennent. */
function onActorUpdate(actor, changes) {
  if ( !isKnockedOut(actor) ) return;
  const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
  if ( !Number.isFinite(hp) ) return;
  if ( hp <= 0 ) return actor.unsetFlag(MODULE_ID, KNOCKED_OUT_FLAG);
  if ( hp > 1 ) return wake(actor, { reason: "hp" });
}

/** Les premiers soins à une créature assommée au contact : test de Médecine DD 10 sur ce client, puis le réveil. */
export async function firstAid(token, target) {
  const actor = token?.actor;
  if ( !actor || !isKnockedOut(target?.actor) ) return false;
  // §252 : le verdict attend la fin des dés 3D, puis se voit et s'entend chez tous.
  const rolls = await rolledAndShown(() => actor.rollSkill({ skill: "med", ability: "wis", target: FIRST_AID_DC }, { configure: true }));
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return false;
  if ( total < FIRST_AID_DC ) {
    notice(target, { key: "Assomme.SoinsRates" }, "refused", { all: true, action: "firstAid", outcome: "failure" });
    return false;
  }
  notice(target, { key: "Retour.Action.SoinsReussis" }, "gain", { all: true, action: "firstAid", outcome: "success" });
  return viaOwnerOrGM(!!target.actor.isOwner, WAKE_QUERY, handleWake, { target: target.uuid, by: actor.name }, { fallback: false });
}

/* -------------------------------------------- */
/*  Surprise                                    */
/* -------------------------------------------- */

const surpriseFromStealth = () => {
  try { return game.settings.get(MODULE_ID, SURPRISE_SETTING) !== false; } catch { return true; }
};

/** Un ennemi caché de la scène que ce token ne perçoit pas ? (le premier, ou null) */
function hiddenEnemyOf(token) {
  for ( const other of token?.parent?.tokens ?? [] ) if ( (other !== token) && hiddenFrom(token, other) ) return other;
  return null;
}

/**
 * `dnd5e.preConfigureInitiative` (sur le client qui lance) : surpris par un ennemi caché → Désavantage. Le token est celui de la scène du
 * combat en cours, sinon de la scène affichée.
 */
function onConfigureInitiative(actor, rollConfig) {
  if ( !surpriseFromStealth() || !rollConfig?.options ) return;
  const scene = game.combat?.scene ?? canvas?.scene;
  const token = actor?.getActiveTokens?.(false, true)?.find(t => t.parent === scene) ?? null;
  const hidden = token ? hiddenEnemyOf(token) : null;
  if ( !hidden ) return;
  rollConfig.options.disadvantage = true;
  rollConfig.options.flavor = `${rollConfig.options.flavor ?? ""} (${loc("Surprise.Raison")})`.trim();
  log(`${actor.name}: surprised (${hidden.name} is hidden from them), initiative with Disadvantage`);
}

/** MJ actif : l'initiative d'une créature Surprise est lancée — l'état a servi, il est retiré. */
function onCombatantUpdate(combatant, changes) {
  if ( !("initiative" in changes) || (changes.initiative === null) ) return;
  const actor = combatant.actor;
  if ( !actor?.statuses?.has("surprised") ) return;
  return actor.toggleStatusEffect("surprised", { active: false }).then(() => log(`${actor.name}: Surprised removed after rolling initiative`));
}

export function registerKnockout() {
  game.settings.register(MODULE_ID, SURPRISE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SURPRISE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SURPRISE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  CONFIG.queries[WAKE_QUERY] = handleWake;
  route("updateActor", onActorUpdate, { executor: true, label: "knocked out: not woken up" });
  route("dnd5e.preConfigureInitiative", onConfigureInitiative, { label: "surprise: initiative Disadvantage" });
  route("updateCombatant", onCombatantUpdate, { executor: true, label: "surprise: Surprised not removed" });
}
