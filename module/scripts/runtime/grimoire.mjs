/**
 * §139 : le grimoire du Magicien — rituels et Restauration magique.
 *  - Rituel (`dnd5e.preUseActivity`, sur le client de celui qui lance) : hors combat, un sort qui a l'étiquette Rituel se lance sans
 *    emplacement (`consume.spellSlot: false`, documents/activity/mixin.mjs) quand il ne peut se lancer qu'en rituel (non préparé avec
 *    Savoir rituel, ou plus d'emplacement) ; préparé avec un emplacement, le joueur choisit — l'utilisation est suspendue puis relancée
 *    avec sa réponse, comme les portes (runtime/gates.mjs).
 *  - Restauration magique (`dnd5e.restCompleted`, sur le client qui a lancé le Repos court) : le joueur désigne les emplacements à
 *    récupérer, niveau par niveau, dans la limite de la règle ; une utilisation de l'item est dépensée.
 */

import { MODULE_ID } from "../constants.mjs";
import { recoveryBudget, recoverableLevels } from "../core/grimoire.mjs";
import { ritualModeOf, slotRecoveryOf } from "../adapter/grimoire.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

const tokenOfActor = actor => actor?.getActiveTokens?.(false, true)?.[0] ?? null;

/** En rituel : sans emplacement, au niveau du sort, sans fenêtre de niveau. */
function asRitual(activity, usageConfig, dialogConfig) {
  usageConfig.consume = { ...((usageConfig.consume && (typeof usageConfig.consume === "object")) ? usageConfig.consume : {}), spellSlot: false };
  usageConfig.scaling = 0;
  usageConfig[MODULE_ID] = { ...(usageConfig[MODULE_ID] ?? {}), ritual: "ritual" };
  if ( dialogConfig ) dialogConfig.configure = false;
  notice(tokenOfActor(activity.actor), loc("Rituel.Lance", { item: activity.item.name }), "gain");
  log(`${activity.actor.name}: ${activity.item.name} cast as a Ritual (no spell slot, +10 minutes)`);
}

function onPreUse(activity, usageConfig, dialogConfig, messageConfig) {
  const ours = usageConfig?.[MODULE_ID] ?? {};
  if ( ours.ritual === "slot" ) return true;
  const mode = (ours.ritual === "ritual") ? "ritual" : ritualModeOf(activity);
  if ( mode === "none" ) return true;
  if ( mode === "ritual" ) {
    asRitual(activity, usageConfig, dialogConfig);
    return true;
  }
  // Préparé, un emplacement reste : rituel ou emplacement, au joueur ; fermée sans choisir, rien n'est lancé.
  (async () => {
    const answer = await askChoice(activity.actor, {
      actor: activity.actor.uuid, item: activity.item.name, untimed: true,
      prompt: loc("Rituel.Question", { item: activity.item.name }),
      options: [{ id: "ritual", label: loc("Rituel.EnRituel") }, { id: "slot", label: loc("Rituel.AvecEmplacement") }]
    });
    if ( !answer ) return;
    const { subsequentActions, ...rest } = usageConfig;
    await activity.use({ ...rest, [MODULE_ID]: { ...ours, ritual: answer.id } }, dialogConfig, messageConfig);
  })().catch(err => console.error(`${MODULE_ID} | ritual choice`, err));
  return false;
}

async function onRestCompleted(actor, result, config) {
  if ( (config?.type !== "short") || !actor?.isOwner ) return;
  const recovery = slotRecoveryOf(actor);
  if ( !recovery ) return;
  const { item, rule, classLevel } = recovery;
  const slots = foundry.utils.deepClone(recovery.slots);
  let budget = recoveryBudget(classLevel);
  const taken = [];
  for ( ;; ) {
    const levels = recoverableLevels(slots, budget, rule.maxLevel ?? 5);
    if ( !levels.length ) break;
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name, untimed: true,
      prompt: loc("Restauration.Question", { item: item.name, left: budget }),
      options: [...levels.map(level => ({ id: String(level), label: loc("Restauration.Niveau", { level }) })),
        { id: "done", label: loc(taken.length ? "Restauration.Fini" : "Restauration.Aucun") }]
    });
    const level = Number(answer?.id);
    if ( !level ) break;
    slots[level].value += 1;
    budget -= level;
    taken.push(level);
  }
  if ( !taken.length ) return;
  const updates = Object.fromEntries([...new Set(taken)].map(level => [`system.spells.spell${level}.value`, slots[level].value]));
  await actor.update(updates);
  if ( item.system.uses?.max > 0 ) await item.update({ "system.uses.spent": (Number(item.system.uses.spent) || 0) + 1 });
  const text = loc("Restauration.Faite", { item: item.name, levels: taken.sort((a, b) => a - b).join(", ") });
  notice(tokenOfActor(actor), text, "gain");
  log(`${actor.name}: ${item.name}, spell slots recovered (levels ${taken.join(", ")})`);
}

export function registerGrimoire() {
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "Ritual: cast without a spell slot" });
  // Sur le client qui a lancé le repos (documents/actor/actor.mjs) : propriétaire de l'acteur ; la question va à son joueur.
  route("dnd5e.restCompleted", onRestCompleted, { label: "Arcane Recovery not offered" });
}
