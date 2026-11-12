/**
 * §418 : les réglages du cadre « Déroulement » qui n'ont pas d'autre maison (le refus : runtime/forced.mjs, §417). Déclarés à tous les
 * niveaux d'automatisation : la fenêtre de réglages les montre toujours, et ce qui les lit (adapter/reactions.mjs) ne tourne qu'à partir
 * du niveau qui juge la règle.
 */
import { MODULE_ID } from "../constants.mjs";
import { REACTION_MODES } from "../core/flow.mjs";

/** Réglage de monde « Réactions » : demander à chacun, aux joueurs seulement, ou jamais. Lu par `askReaction` (adapter/reactions.mjs). */
export const REACTION_SETTING = "reactionPrompts";

export function registerFlow() {
  game.settings.register(MODULE_ID, REACTION_SETTING, { scope: "world", config: true, type: String, default: "level",
    name: `DND5ECOMBAT.Reglage.${REACTION_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${REACTION_SETTING}.Aide`,
    choices: Object.fromEntries(REACTION_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${REACTION_SETTING}.${m}`])) });
}
