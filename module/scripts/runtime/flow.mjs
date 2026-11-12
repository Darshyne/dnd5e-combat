/**
 * §418 : les réglages du cadre « Déroulement » qui n'ont pas d'autre maison (le refus : runtime/forced.mjs, §417). Déclarés à tous les
 * niveaux d'automatisation : la fenêtre de réglages les montre toujours, et ce qui les lit (adapter/reactions.mjs) ne tourne qu'à partir
 * du niveau qui juge la règle.
 */
import { MODULE_ID } from "../constants.mjs";
import { REACTION_MODES, DAMAGE_MODES, damageSteps } from "../core/flow.mjs";

/** Réglage de monde « Réactions » : demander à chacun, aux joueurs seulement, ou jamais. Lu par `askReaction` (adapter/reactions.mjs). */
export const REACTION_SETTING = "reactionPrompts";

/** §419 : réglage de monde « Dégâts » — lancés d'office ou au clic de l'auteur, appliqués d'office ou validés par le MJ. */
export const DAMAGE_SETTING = "damageFlow";

/** §419 : ce que le réglage « Dégâts » demande (core/flow.mjs, `damageSteps`). */
export function damageFlow() {
  let mode = "level";
  try { mode = game.settings.get(MODULE_ID, DAMAGE_SETTING); } catch { /* réglage pas encore déclaré */ }
  return damageSteps(mode);
}

export function registerFlow() {
  game.settings.register(MODULE_ID, DAMAGE_SETTING, { scope: "world", config: true, type: String, default: "level",
    name: `DND5ECOMBAT.Reglage.${DAMAGE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${DAMAGE_SETTING}.Aide`,
    choices: Object.fromEntries(DAMAGE_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${DAMAGE_SETTING}.${m}`])) });
  game.settings.register(MODULE_ID, REACTION_SETTING, { scope: "world", config: true, type: String, default: "level",
    name: `DND5ECOMBAT.Reglage.${REACTION_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${REACTION_SETTING}.Aide`,
    choices: Object.fromEntries(REACTION_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${REACTION_SETTING}.${m}`])) });
}
