/**
 * M8 (SPEC §18.16) : le maximum de PV baisse du montant des dégâts subis (Absorption de vie…), ou d'une formule sur une
 * sauvegarde ratée (Drain d'énergie) ; le vampire regagne ce qu'il draine ; réduit à 0, le maximum tue (règles 2024).
 * §105 : le drain est un EFFET sur la cible (adapter/drain.mjs) ; une valeur de caractéristique se draine aussi au toucher
 * (Caresse dévitalisante de l'Ombre : Force −1d4, mort à 0) ; au format 2014 (« must succeed on … or its Hit Point maximum is
 * reduced… »), la part égale aux dégâts ne se draine que sur la sauvegarde ratée que le toucher impose — tranchée APRÈS
 * l'application des dégâts de l'attaque (vu en jeu le 2026-10-07) : la part se garde au calcul, et se draine à la résolution.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { drainedAmount } from "../core/drain.mjs";
import { setDeathStatus } from "../adapter/death.mjs";
import { drainOf, damageSourceItem, damageSourceMessage, applyDrainEffect } from "../adapter/drain.mjs";
import { route } from "./router.mjs";
import { loc, log } from "./shared.mjs";

/** Le libellé de l'effet, total compris. */
function effectName(item, kind) {
  if ( kind === "hp" ) return total => loc("Drain.EffetPV", { item: item.name, n: total });
  const ability = CONFIG.DND5E.abilities[kind]?.label ?? kind;
  return total => loc("Drain.EffetCarac", { item: item.name, ability, n: total });
}

/**
 * Format 2014 : la part drainée en attente de la sauvegarde, par message d'utilisation et acteur ciblé. Sur le client qui
 * applique les dégâts (le MJ actif, pour une action du moteur), lue par la résolution sur le même client.
 */
const pending = new Map();
const pendingKey = (messageId, actorUuid) => `${messageId}|${actorUuid}`;

/** Sur le client qui applique les dégâts : la part drainée, gardée pour après l'écriture des PV. */
function onCalculateDamage(actor, damages, options) {
  const item = damageSourceItem(options);
  const rule = drainOf(item);
  if ( !rule?.equal ) return;
  const n = drainedAmount(damages, rule.type, damages.amount);
  if ( rule.onFailedSave ) {
    const message = damageSourceMessage(options);
    if ( message?.id ) pending.set(pendingKey(message.id, actor.uuid), n);
    return;
  }
  if ( n > 0 ) (options[MODULE_ID] ??= {}).drain = { n, item: item.uuid, source: item.actor?.uuid ?? null, regains: rule.regains };
}

async function drain(actor, kind, n, { item, source=null, regains=false }) {
  const left = await applyDrainEffect(actor, { kind, n, item, name: effectName(item, kind) });
  log(`${actor.name}: ${item.name} — ${kind === "hp" ? "Hit Point maximum" : kind} -${n} (${left})`);
  if ( left <= 0 ) {
    await setDeathStatus(actor, "dead");
    log(`${actor.name}: ${kind === "hp" ? "Hit Point maximum" : kind} at 0 → Dead`);
  }
  if ( !regains || !source ) return;
  const drinker = fromUuidSync(source, { strict: false });
  if ( !drinker?.isOwner ) return;
  await drinker.applyDamage([{ value: n, type: "healing" }]);
  log(`${drinker.name}: ${item.name} — regains ${n} HP`);
}

async function onApplyDamage(actor, amount, options) {
  const d = options?.[MODULE_ID]?.drain;
  if ( !d || !actor.isOwner ) return;
  const item = fromUuidSync(d.item, { strict: false });
  if ( item ) await drain(actor, "hp", d.n, { ...d, item });
}

/**
 * À la résolution tranchée, MJ actif : la part égale aux dégâts d'une fiche au format 2014, sur la sauvegarde ratée (à défaut
 * de la part gardée au calcul, les PV perdus) ; le Drain d'énergie (« Failure: The target's Hit Point maximum decreases by 14 (4d6) »)
 * sur une sauvegarde ratée ; le drain d'une caractéristique sur une attaque qui touche (ou une sauvegarde ratée, pour une
 * activité sans attaque).
 */
async function onResolution(resolution) {
  if ( resolution.step !== STEPS.DONE ) return;
  const item = fromUuidSync(resolution.activity ?? "", { strict: false })?.item ?? null;
  const rule = drainOf(item);
  const later = rule?.equal && rule.onFailedSave;
  if ( !rule?.fixed && !rule?.ability && !later ) return;
  const speaker = ChatMessage.implementation.getSpeaker({ actor: item.actor });
  for ( const t of resolution.targets ) {
    if ( t.unaffected ) continue;
    const actor = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !actor ) continue;
    if ( later ) {
      const key = pendingKey(resolution.origin, actor.uuid);
      const n = pending.get(key) ?? t.damage?.applied ?? 0;
      pending.delete(key);
      if ( (t.save?.success === false) && (n > 0) ) await drain(actor, "hp", n, { item, source: item.actor?.uuid ?? null, regains: rule.regains });
    }
    if ( rule.fixed && (t.save?.success === false) ) {
      const roll = await new Roll(rule.fixed).evaluate();
      await roll.toMessage({ speaker, flavor: `${item.name} — ${actor.name}` });
      await drain(actor, "hp", roll.total, { item });
    }
    const struck = resolution.plan?.attack ? (t.hit === true) : (t.save?.success === false);
    if ( rule.ability && struck ) {
      const roll = await new Roll(rule.ability.formula).evaluate();
      await roll.toMessage({ speaker, flavor: `${item.name} — ${actor.name}` });
      await drain(actor, rule.ability.key, roll.total, { item });
    }
  }
}

export function registerDrain() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "drain: drained portion not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "drain: Hit Point maximum not reduced" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "drain on save or on hit: effect not applied" });
}
