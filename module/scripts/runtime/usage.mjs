/**
 * §68 : l'utilisation sans fenêtre (réglage de monde « autoUsage », activé par défaut). La fenêtre d'utilisation de dnd5e
 * (applications/activity/activity-usage-dialog.mjs) ne sert qu'à décocher ce que dnd5e a déjà prévu (activity/mixin.mjs:445-510,
 * `_prepareUsageConfig`) : consommer (action, ressources, emplacement), commencer la concentration (et finir la précédente si la
 * limite est atteinte), poser la zone. Sans elle, les trois s'appliquent tels quels (`dialogConfig.configure = false`).
 *
 *  - Emplacement de sort : celui que dnd5e propose s'il en reste, sinon le plus bas disponible au moins du niveau du sort
 *    (core/usage.mjs), et le niveau de lancement suit (`scaling`).
 *  - §106 : un sort qui peut se lancer plus haut (il reste un emplacement d'un niveau supérieur) garde la fenêtre de dnd5e, où se
 *    choisit le niveau — depuis la fiche notamment. Qui a déjà choisi l'emplacement la saute lui-même (`configure: false` : tiroir
 *    de la barre de darsh-dnd-ui), comme les utilisations du moteur.
 *  - Plus de ressources (aucun emplacement, utilisations de l'activité ou de l'item épuisées) : §77, le MJ peut toujours lancer — une
 *    fenêtre d'avertissement le laisse lancer sans rien consommer, ou renoncer (que la fenêtre de dnd5e soit passée ou non) ; un
 *    joueur non — dnd5e refuse l'utilisation avec son propre avertissement.
 *  - §77 : une activité qui dépense ses propres utilisations sans en avoir, quand l'item en porte (donnée du Monster Manual 2024,
 *    Nuage fétide du Dretch), dépense celles de l'item (corrigé sur la copie de l'item que dnd5e utilise, pas sur la fiche).
 *  - Un vrai choix reste à la fenêtre : profil d'invocation, de transformation ou d'enchantement quand il y en a plusieurs,
 *    commande de bastion.
 */

import { MODULE_ID } from "../constants.mjs";
import { pickSpellSlot, misplacedSelfUses, canCastHigher } from "../core/usage.mjs";
import { contentOf } from "../adapter/content.mjs";
import { movableZoneOf } from "./zones.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

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

/**
 * §77 : les utilisations propres d'une activité qui n'en a pas, portées par l'item : réécrites en utilisations de l'item sur la COPIE
 * de l'item que dnd5e utilise (`Activity#use` clone l'item ; `updateSource` survit à la mise à l'échelle). Rend l'activité à jour.
 */
function repairSelfUses(activity) {
  const targets = Array.from(activity.consumption?.targets ?? []);
  const wrong = misplacedSelfUses(targets, !!activity.uses?.max, !!activity.item.system.uses?.max);
  if ( !wrong.length ) return activity;
  const source = activity.toObject().consumption.targets.map((t, i) => (wrong.includes(i) ? { ...t, type: "itemUses" } : t));
  // Comme dnd5e pour la mise à l'échelle (activity/mixin.mjs:541-544) : la copie se prépare avec sa fiche, puis ses attributs finaux.
  const item = activity.item;
  if ( item.actor ) item.actor._embeddedPreparation = true;
  item.updateSource({ [`system.activities.${activity.id}.consumption.targets`]: source });
  if ( item.actor ) delete item.actor._embeddedPreparation;
  item.prepareFinalAttributes?.();
  log(`${activity.item.name}: the activity's uses are the item's (${activity.item.system.uses.value}/${activity.item.system.uses.max})`);
  return activity.item.system.activities.get(activity.id) ?? activity;
}

/** §77 : plus de ressources — le MJ choisit de lancer quand même (rien n'est consommé) ou non ; relance l'utilisation d'origine. */
async function askForced(activity, usageConfig, messageConfig) {
  const name = activity.item.name;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("SansCharge.Titre") },
    content: `<p>${loc("SansCharge.Texte", { name })}</p>`,
    yes: { label: loc("SansCharge.Lancer"), icon: "fa-solid fa-wand-sparkles" },
    no: { label: loc("SansCharge.Renoncer") },
    rejectClose: false
  }).catch(() => false);
  if ( !ok ) return log(`${name}: no charges left, the GM gives up`);
  const original = activity.actor?.items.get(activity.item.id)?.system.activities.get(activity.id);
  if ( !original ) return;
  log(`${name}: no charges left, cast anyway by the GM (nothing consumed)`);
  await original.use({ ...usageConfig, [MODULE_ID]: { ...(usageConfig[MODULE_ID] ?? {}), forced: true } }, { configure: false }, messageConfig);
}

function onPreUse(activity, usageConfig, dialogConfig, messageConfig) {
  if ( !activity?.item ) return;
  // §111 : une zone déplaçable déjà posée — l'utilisation la déplace (ui/pointer.mjs, §16.14), rien n'est lancé : ni emplacement
  // à choisir ou à corriger, ni « plus de charge » chez le MJ. Un appelant qui confirme d'office lance vraiment (même règle).
  if ( !usageConfig[MODULE_ID]?.confirmed && movableZoneOf(activity) ) return;
  activity = repairSelfUses(activity);
  // §77 : relancée par le MJ sans charge — rien n'est consommé, pas de fenêtre.
  if ( usageConfig[MODULE_ID]?.forced ) {
    usageConfig.consume = { ...(usageConfig.consume ?? {}), resources: false, spellSlot: false };
    dialogConfig.configure = false;
    return;
  }
  let auto = !!dialogConfig?.configure && game.settings.get(MODULE_ID, AUTO_USAGE_SETTING) && !needsChoice(activity);
  let lacking = false;
  const slots = activity.actor?.system.spells;
  const proposed = usageConfig.spell?.slot;
  if ( activity.requiresSpellSlot && usageConfig.consume?.spellSlot && proposed && slots ) {
    const level = Number(activity.item.system.level) || 0;
    const slot = pickSpellSlot(slots, proposed, level);
    if ( !slot ) lacking = true;
    else if ( auto && (slot !== proposed) ) {
      usageConfig.spell.slot = slot;
      if ( usageConfig.scaling !== false ) usageConfig.scaling = Math.max(0, (Number(slots[slot]?.level) || level) - level);
      log(`${activity.item.name}: no ${proposed} slot left, cast with ${slot}`);
    }
  }
  // §106 : le niveau est un vrai choix — la fenêtre de dnd5e reste (avec l'emplacement corrigé ci-dessus, s'il l'a été).
  if ( auto && !lacking && activity.requiresSpellSlot && usageConfig.consume?.spellSlot && (usageConfig.scaling !== false)
    && canCastHigher(slots, Number(activity.item.system.level) || 0) ) auto = false;
  if ( !lacking ) lacking = lacksUses(activity, usageConfig);
  // §77 : plus de ressources — le MJ peut toujours lancer, après avertissement ; un joueur, dnd5e le refuse.
  if ( lacking && game.user.isGM ) {
    askForced(activity, usageConfig, messageConfig);
    return false;
  }
  if ( auto ) dialogConfig.configure = false;
  // §109 : un sort qui invoque toujours, dont la case « placer » part décochée (`summon.prompt: false`) — cochée ici, comme on
  // l'aurait fait dans la fenêtre ; `create.summons` est déjà préparé à ce hook (documents/activity/summon.mjs:65-70).
  if ( (activity.type === "summon") && (usageConfig.create?.summons === false || !usageConfig.create?.summons)
    && contentOf(activity.item).entry?.placesSummons && activity.canSummon && canvas.scene && activity.availableProfiles?.length ) {
    usageConfig.create = { ...(usageConfig.create ?? {}), summons: true };
  }
}

export function registerUsage() {
  game.settings.register(MODULE_ID, AUTO_USAGE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${AUTO_USAGE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AUTO_USAGE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "use without dialog" });
}
