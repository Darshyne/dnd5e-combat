/**
 * Enchanter l'arme d'une créature choisie, en marche (SPEC §16.41) : l'interface fait choisir le niveau et l'élément (fenêtre
 * de dnd5e), la créature (visée), puis l'arme (ui/enchant.mjs) ; l'utilisation repart avec l'arme notée, et le MJ actif applique
 * l'enchantement après elle (requête `dnd5e-combat.enchant`).
 */

import { MODULE_ID } from "../constants.mjs";
import { enchantTargetOf, applyEnchantmentTo, pactRuleOf, conjureWeapon } from "../adapter/enchant.mjs";
import { rewritePactChanges } from "../core/pact.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { tokenOf } from "../adapter/vision.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

export const ENCHANT_QUERY = `${MODULE_ID}.enchant`;

/** §16.45 : la réécriture qui attend l'enchantement d'une arme (uuid → options), lue au `dnd5e.preApplyEnchantment`. */
const pactRewrites = new Map();

async function handleEnchant({ activity: activityUuid, item: itemUuid, profile, message: messageUuid, concentration: concUuid, pactDamage }, { user }={}) {
  const activity = await fromUuid(activityUuid);
  const item = await fromUuid(itemUuid);
  if ( !activity || !item || (user && !activity.actor?.testUserPermission(user, "OWNER")) ) return null;
  const message = messageUuid ? await fromUuid(messageUuid) : null;
  const concentration = concUuid ? await fromUuid(concUuid) : null;
  const pact = pactRuleOf(activity.item);
  if ( pact ) {
    // « Une seule arme de pacte » : le lien précédent tombe.
    for ( const old of Array.from(activity.appliedEnchantments ?? []) ) await old.delete();
    pactRewrites.set(item.uuid, { damageTypes: pact.damageTypes, chosen: pactDamage ?? null, ability: pact.ability ?? null,
      suffix: game.i18n.localize("DND5ECOMBAT.Pacte.Suffixe") });
  }
  let effect;
  try { effect = await applyEnchantmentTo(activity, item, { profile, message, concentration }); }
  finally { pactRewrites.delete(item.uuid); }
  if ( effect ) log(`${item.parent?.name ?? "?"} : ${item.name} enchantée (${effect.name})`);
  return effect ? effect.name : null;
}

/**
 * Intention « enchanter cette arme » (fenêtre des armes, ui/enchant.mjs) — l'utilisation suspendue repart avec l'arme notée ;
 * dnd5e fige les cibles de la carte à la première utilisation (activity/mixin.mjs:239-242) : on les laisse se relire.
 */
export function enchantWith(activity, [config, dialog, message], itemUuid, extra={}) {
  const messageConfig = foundry.utils.deepClone(message ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  return activity.use({ ...config, [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), enchantItem: itemUuid, ...extra } }, dialog, messageConfig);
}

/**
 * §16.45 : intention « lier cette arme » (fenêtre du pacte, ui/pact.mjs) — une arme de l'inventaire, ou une arme invoquée depuis
 * le compendium (créée dans l'inventaire) ; `damageType` : un des types du pacte, ou null (le type normal).
 */
export async function pactWith(activity, usage, { itemUuid=null, conjureUuid=null, damageType=null }) {
  let uuid = itemUuid;
  if ( conjureUuid ) uuid = (await conjureWeapon(activity, conjureUuid))?.uuid ?? null;
  if ( !uuid ) return null;
  const [config, dialog, message] = usage;
  return enchantWith(activity, [config, { ...(dialog ?? {}), configure: false }, message], uuid, { pactDamage: damageType });
}

async function onPostUse(activity, usageConfig, results) {
  const itemUuid = usageConfig?.[MODULE_ID]?.enchantItem;
  if ( !itemUuid || !enchantTargetOf(activity) ) return;
  const concentration = results?.effects?.find?.(e => e.statuses?.has?.("concentrating")) ?? concentrationOn(activity.item);
  const payload = { activity: activity.uuid, item: itemUuid, profile: usageConfig.enchantmentProfile,
    message: results?.message?.uuid ?? null, concentration: concentration?.uuid ?? null, pactDamage: usageConfig[MODULE_ID]?.pactDamage ?? null };
  const gm = game.users.activeGM;
  if ( !gm ) return ui.notifications.warn(loc("Enchant.SansMJ"));
  const name = gm.isSelf ? await handleEnchant(payload) : await gm.query(ENCHANT_QUERY, payload, { timeout: 10000 }).catch(() => null);
  const item = await fromUuid(itemUuid);
  const token = tokenOf(item?.parent);
  if ( name && token ) notice(token, loc("Enchant.Applique", { item: item.name, effect: name }), "gain");
}

export function registerEnchant() {
  route("dnd5e.postUseActivity", onPostUse, { label: "enchantement : arme non enchantée" });
  // §16.45 : l'enchantement du pacte, réécrit avant sa création (type de dégâts choisi, Charisme, nom).
  route("dnd5e.preApplyEnchantment", (item, data) => {
    const rewrite = pactRewrites.get(item.uuid);
    if ( !rewrite ) return;
    data.system.changes = rewritePactChanges(data.system.changes, rewrite);
    log(`${item.name} : arme de pacte (${rewrite.chosen ?? "type normal"})`);
  }, { label: "arme de pacte : enchantement non réécrit" });
  CONFIG.queries[ENCHANT_QUERY] = handleEnchant;
}
