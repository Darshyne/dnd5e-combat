/**
 * Enchanter l'arme d'une créature choisie, en marche (SPEC §16.41) : l'interface fait choisir le niveau et l'élément (fenêtre
 * de dnd5e), la créature (visée), puis l'arme (ui/enchant.mjs) ; l'utilisation repart avec l'arme notée, et le MJ actif applique
 * l'enchantement après elle (requête `dnd5e-combat.enchant`).
 */

import { MODULE_ID } from "../constants.mjs";
import { enchantTargetOf, applyEnchantmentTo, pactRuleOf, conjureWeapon } from "../adapter/enchant.mjs";
import { rewritePactChanges } from "../core/pact.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { tokenOnViewedScene } from "../adapter/vision.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, viaActiveGM } from "./shared.mjs";

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
  if ( effect ) log(`${item.parent?.name ?? "?"}: ${item.name} enchanted (${effect.name})`);
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
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Enchant.SansMJ"));
  const name = await viaActiveGM(ENCHANT_QUERY, handleEnchant, payload);
  const item = await fromUuid(itemUuid);
  const token = tokenOnViewedScene(item?.parent);
  if ( name && token ) notice(token, loc("Enchant.Applique", { item: item.name, effect: name }), "gain");
}

export function registerEnchant() {
  route("dnd5e.postUseActivity", onPostUse, { label: "enchantment: weapon not enchanted" });
  // §16.45 : l'enchantement du pacte, réécrit avant sa création (type de dégâts choisi, Charisme, nom).
  route("dnd5e.preApplyEnchantment", (item, data) => {
    const rewrite = pactRewrites.get(item.uuid);
    if ( !rewrite ) return;
    data.system.changes = rewritePactChanges(data.system.changes, rewrite);
    log(`${item.name}: pact weapon (${rewrite.chosen ?? "normal type"})`);
  }, { label: "pact weapon: enchantment not rewritten" });
  // O9h (§363) : un objet qui s'enchante lui-même avec l'un de ses propres profils (Parchemin de protection : le type de créature) — la
  // copie que dnd5e crée sur l'objet qui porte déjà le profil n'aboutit pas (vu en jeu : aucun effet créé, sans erreur). Le profil choisi
  // est activé à sa place, comme un enchantement posé (origine : l'activité) ; les autres profils de l'activité sont éteints.
  route("dnd5e.preApplyEnchantment", (item, data, { activity }={}) => {
    const profile = data?.flags?.dnd5e?.enchantmentProfile;
    if ( !activity || (activity.item !== item) || !profile || !item.effects?.has?.(profile) ) return;
    const profiles = new Set((activity.effects ?? []).map(p => p._id));
    const updates = item.effects.filter(e => profiles.has(e.id) && (e.id !== profile)).map(e => ({ _id: e.id, disabled: true }));
    updates.push({ _id: profile, disabled: false, origin: activity.uuid, "system.origin": data.system?.origin ?? {}, "flags.dnd5e": data.flags.dnd5e });
    // Les « riders » du profil (activité « Use » du parchemin, cachée tant qu'aucun enchantement ne la déclare) : copiés comme dnd5e le fait
    // à la pose d'un enchantement (data/active-effect/enchantment.mjs, `collectRiders`).
    item.updateEmbeddedDocuments("ActiveEffect", updates).then(async () => {
      // §433 : dnd5e 6.1 ne rend les riders que d'un enchantement APPLIQUÉ (`isApplied` : `transfer` vrai, enchantment.mjs:285), et un effet
      // cité par une activité de son item n'est jamais transféré (`isOnActivity`, active-effect-data-model.mjs:57) : le profil activé sur
      // place ne peut pas répondre. La question est posée à une copie en mémoire, sous un autre identifiant et marquée appliquée ; ce
      // qu'elle rend dépend d'elle (`dependentOn`) : l'identifiant du profil y est remis. Rien n'est écrit sur l'effet.
      const switched = item.effects.get(profile);
      const probeId = foundry.utils.randomID();
      const probe = switched?.clone({ _id: probeId, transfer: true }, { keepId: true });
      const asProfile = data => JSON.parse(JSON.stringify(data).replaceAll(probeId, profile));
      const riders = (await probe?.system?.collectRiders?.({ dnd5e: { enchantmentProfile: profile, activityId: activity.id } }) ?? [])
        .map(op => ({ ...op, ...(op.updates ? { updates: asProfile(op.updates) } : {}), ...(op.data ? { data: asProfile(op.data) } : {}) }));
      if ( riders.length ) await foundry.documents.modifyBatch(riders);
      // Le nom que le profil donne (« Scroll of Protection: Undead ») : dnd5e n'applique pas ses changements à un profil de l'objet.
      const named = (item.effects.get(profile)?.system?.changes ?? item.effects.get(profile)?.changes ?? []).find(c => c.key === "name")?.value;
      if ( named && (named !== item.name) ) await item.update({ name: named });
      log(`${item.name}: its own profile "${item.effects.get(profile)?.name}" switched on`);
    }).catch(err => console.error(`${MODULE_ID} | ${item.name}: profile not switched on`, err));
    return false;
  }, { cancellable: true, label: "self enchantment: profile not switched on" });
  CONFIG.queries[ENCHANT_QUERY] = handleEnchant;
}
