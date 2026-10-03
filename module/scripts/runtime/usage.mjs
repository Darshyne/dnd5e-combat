/**
 * §68 : l'utilisation sans fenêtre (réglage de monde « autoUsage », activé par défaut). La fenêtre d'utilisation de dnd5e
 * (applications/activity/activity-usage-dialog.mjs) ne sert qu'à décocher ce que dnd5e a déjà prévu (activity/mixin.mjs:445-510,
 * `_prepareUsageConfig`) : consommer (action, ressources, emplacement), commencer la concentration (et finir la précédente si la
 * limite est atteinte), poser la zone. Sans elle, les trois s'appliquent tels quels (`dialogConfig.configure = false`).
 *
 *  - Emplacement de sort : celui que dnd5e propose s'il en reste, sinon le plus bas disponible au moins du niveau du sort
 *    (core/usage.mjs), et le niveau de lancement suit (`scaling`). Lancer à un niveau supérieur se choisit ailleurs (tiroir de
 *    la barre de darsh-dnd-ui, qui passe l'emplacement).
 *  - Plus de ressources (aucun emplacement, utilisations de l'activité ou de l'item épuisées) : le MJ voit la fenêtre (il tranche :
 *    lancer sans consommer…) ; un joueur non — dnd5e refuse l'utilisation avec son propre avertissement.
 *  - Un vrai choix reste à la fenêtre : profil d'invocation, de transformation ou d'enchantement quand il y en a plusieurs,
 *    commande de bastion.
 */

import { MODULE_ID } from "../constants.mjs";
import { pickSpellSlot } from "../core/usage.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const AUTO_USAGE_SETTING = "autoUsage";

/** Un choix que seule la fenêtre de dnd5e propose. */
function needsChoice(activity) {
  if ( activity.type === "order" ) return true;
  if ( ["summon", "transform", "enchant"].includes(activity.type) ) {
    const profiles = (activity.type === "enchant") ? activity.availableEnchantments : activity.availableProfiles;
    return (profiles?.length ?? 0) > 1;
  }
  return false;
}

/** Une utilisation (de l'activité ou d'un item) que la consommation demande et qui manque. */
function lacksUses(activity, usageConfig) {
  const indexes = usageConfig.consume?.resources;
  if ( !Array.isArray(indexes) ) return false;
  const targets = Array.from(activity.consumption?.targets ?? []);
  return indexes.some(i => {
    const target = targets[i];
    const cost = Number(target?.value);
    if ( !(cost > 0) ) return false;   // une formule ou un coût nul : dnd5e jugera
    if ( target.type === "activityUses" ) {
      const owner = target.target ? activity.item.system.activities?.get(target.target) : activity;
      return !!owner?.uses?.max && ((Number(owner.uses.value) || 0) < cost);
    }
    if ( target.type === "itemUses" ) {
      const item = target.target ? activity.actor?.items.get(target.target) : activity.item;
      return !!item?.system.uses?.max && ((Number(item.system.uses.value) || 0) < cost);
    }
    return false;
  });
}

function onPreUse(activity, usageConfig, dialogConfig) {
  if ( !dialogConfig?.configure || !game.settings.get(MODULE_ID, AUTO_USAGE_SETTING) ) return;
  if ( !activity?.item || needsChoice(activity) ) return;
  let lacking = false;
  const slots = activity.actor?.system.spells;
  const proposed = usageConfig.spell?.slot;
  if ( activity.requiresSpellSlot && usageConfig.consume?.spellSlot && proposed && slots ) {
    const level = Number(activity.item.system.level) || 0;
    const slot = pickSpellSlot(slots, proposed, level);
    if ( !slot ) lacking = true;
    else if ( slot !== proposed ) {
      usageConfig.spell.slot = slot;
      if ( usageConfig.scaling !== false ) usageConfig.scaling = Math.max(0, (Number(slots[slot]?.level) || level) - level);
      log(`${activity.item.name} : plus d'emplacement ${proposed}, lancé avec ${slot}`);
    }
  }
  if ( !lacking ) lacking = lacksUses(activity, usageConfig);
  // Plus de ressources : la fenêtre pour le MJ seulement.
  if ( lacking && game.user.isGM ) return;
  dialogConfig.configure = false;
}

export function registerUsage() {
  game.settings.register(MODULE_ID, AUTO_USAGE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${AUTO_USAGE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AUTO_USAGE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  route("dnd5e.preUseActivity", onPreUse, { label: "utilisation sans fenêtre" });
}
