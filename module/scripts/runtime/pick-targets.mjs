/**
 * §293 : lancer une activité « créatures de votre choix dans un rayon » (Renvoi des morts-vivants) sur les créatures cochées dans la liste
 * (ui/pick-targets.mjs) — ou, la case cochée, l'activité qui la remplace (Calcination des morts-vivants) sur les mêmes. Les cochées
 * deviennent les cibles de l'utilisateur ; la zone de l'activité n'est pas posée (`measuredTemplate: false`) et la résolution prend les
 * cibles du message (`givenTargets`, §104) au lieu d'attendre une zone.
 */

import { MODULE_ID } from "../constants.mjs";
import { log } from "./shared.mjs";
import { targetDescriptorsOf } from "../adapter/pick-targets.mjs";

/**
 * @param {Activity} activity                 L'activité utilisée.
 * @param {[object, object, object]} usage     Ses configurations d'utilisation, de dialogue et de message.
 * @param {object} choice
 * @param {TokenDocument[]} choice.tokens       Les créatures cochées.
 * @param {Activity|null} [choice.upgrade]      L'activité qui la remplace, si la case est cochée.
 * @returns {Promise<object|null>}  Les résultats de l'utilisation (dnd5e), ou null si elle n'est pas partie.
 */
export async function castOnPicked(activity, [config, dialog, message]=[], { tokens, upgrade=null }) {
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false, groupSelection: true });
  for ( const t of tokens ) t.object?.setTarget(true, { releaseOthers: false, groupSelection: true });
  const used = upgrade ?? activity;
  const use = { ...(config ?? {}), create: { ...(config?.create ?? {}), measuredTemplate: false },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), picked: true } };
  // Le message de l'utilisation suspendue porte des cibles vides (prises avant le choix) : celles cochées les remplacent.
  const msg = foundry.utils.mergeObject(message ?? {}, { data: { system: { targets: targetDescriptorsOf(tokens) },
    flags: { [MODULE_ID]: { givenTargets: true } } } }, { inplace: false });
  log(`${used.item?.name ?? used.name}: ${tokens.length} creature(s) chosen (${tokens.map(t => t.name).join(", ")})${upgrade ? ", in place of " + (activity.item?.name ?? activity.name) : ""}`);
  return (await used.use(use, dialog ?? {}, msg)) ?? null;
}
