/**
 * §16.47 : effets qui cessent quand leur porteur agit (`breaksOn` : Invisibilité, PHB 2024 — « le sort prend fin
 * aussitôt après que la cible a effectué un jet d'attaque, infligé des dégâts ou lancé un sort »). Sur le client de
 * l'auteur, qui possède ses effets :
 *  - jet d'attaque : après le jet (`dnd5e.rollAttackV2`), qui a profité de l'invisibilité ;
 *  - sort ou utilisation à dégâts qui n'est pas une attaque : après l'utilisation (`dnd5e.postUseActivity`). Les effets
 *    de l'item utilisé lui-même ne tombent pas (se lancer Invisibilité ne la rompt pas) ;
 *  - §23 : jet de sauvegarde (`save`) : après le jet (`dnd5e.rollSavingThrow`, actor.mjs:1657), qui a subi l'effet (Éclat mental :
 *    « soustrait 1d4 au prochain jet de sauvegarde »).
 */

import { MODULE_ID } from "../constants.mjs";
import { breakMoments } from "../core/conditions.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { tokenOnViewedScene } from "../adapter/vision.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";

async function breakEffects(actor, moments, exceptItem=null, { before=null }={}) {
  if ( !actor?.isOwner || !moments.length ) return;
  const broken = actor.effects.filter(e => {
    // Seulement les effets qui étaient là avant le geste : la sauvegarde qui POSE l'effet (Éclat mental) ne le consomme pas.
    if ( before && ((e._stats?.createdTime ?? 0) > before) ) return false;
    const item = originItemOf(e);
    if ( !item || (exceptItem && (item.uuid === exceptItem.uuid)) ) return false;
    const on = contentOf(item).entry?.breaksOn ?? [];
    return moments.some(m => on.includes(m));
  });
  if ( !broken.length ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", broken.map(e => e.id));
  const token = tokenOnViewedScene(actor);
  for ( const e of broken ) {
    log(`${actor.name}: ${e.name} ends (${moments.join(", ")})`);
    if ( token ) notice(token, loc("Retour.FinEffet", { item: e.name }), "ended");
  }
}

/**
 * §366 : `breaksOnOrigin` — sur le MJ actif, à chaque carte d'attaque, de dégâts (pas de soins) ou d'utilisation à sauvegarde : les
 * effets que l'auteur de la carte a posés (par un autre item) et dont l'item déclare ce moment tombent, sur toute créature de la scène.
 */
async function breakOnOrigin(message) {
  let moment = null;
  // dnd5e 6 : quand l'item de la carte n'existe plus, `getAssociatedItem` passe par `getOriginatingMessage()`, qui peut rendre
  // `system.origin` (des données, pas un message) — « Receiver must be an instance of class ChatMessage5e ». Lecture sans risque.
  const read = fn => { try { return fn() ?? null; } catch { return null; } };
  const activity = read(() => message.getAssociatedActivity?.());
  if ( message.type === "attack" ) moment = "attack";
  else if ( (message.type === "damage") && (activity?.type !== "heal") ) moment = "damage";
  else if ( (message.type === "usage") && (activity?.type === "save") ) moment = "forcesSave";
  if ( !moment ) return;
  const item = activity?.item ?? read(() => message.getAssociatedItem?.());
  const caster = read(() => message.getAssociatedActor?.()) ?? item?.actor ?? null;
  if ( !caster ) return;
  for ( const token of canvas.scene?.tokens ?? [] ) {
    const actor = token.actor;
    if ( !actor ) continue;
    const broken = actor.effects.filter(e => {
      const source = originItemOf(e);
      if ( !source || (source.actor?.uuid !== caster.uuid) || (item && (source.uuid === item.uuid)) ) return false;
      return (contentOf(source).entry?.breaksOnOrigin ?? []).includes(moment);
    });
    if ( !broken.length ) continue;
    await actor.deleteEmbeddedDocuments("ActiveEffect", broken.map(e => e.id));
    for ( const e of broken ) {
      log(`${actor.name}: ${e.name} ends (${caster.name}: ${moment})`);
      if ( token.object ) notice(token.object, loc("Retour.FinEffet", { item: e.name }), "ended");
    }
  }
}

export function registerBreaks() {
  route("createChatMessage", message => {
    breakOnOrigin(message).catch(err => console.error(`${MODULE_ID} | effect end`, err));
  }, { executor: true, label: "effect ending on the caster's action not removed" });
  route("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    breakEffects(subject?.actor, breakMoments({ attack: true, damage: false, spell: false })).catch(err => console.error(`${MODULE_ID} | effect end`, err));
  }, { label: "effect ending on attack roll not removed" });
  route("dnd5e.rollSavingThrow", (rolls, { subject }={}) => {
    breakEffects(subject, ["save"], null, { before: Date.now() }).catch(err => console.error(`${MODULE_ID} | effect end`, err));
  }, { label: "effect ending on saving throw not removed" });
  route("dnd5e.postUseActivity", activity => {
    if ( !activity?.actor || (activity.type === "attack") ) return;
    const moments = breakMoments({ attack: false, damage: (activity.damage?.parts?.length ?? 0) > 0, spell: isSpellCast(activity.item) });
    // §299 : « forcesSave » — l'utilisation impose un jet de sauvegarde (Voile psychique : « ou forcez une créature à faire un jet de
    // sauvegarde »).
    if ( activity.type === "save" ) moments.push("forcesSave");
    breakEffects(activity.actor, moments, activity.item).catch(err => console.error(`${MODULE_ID} | effect end`, err));
  }, { label: "effect ending on spell or damage not removed" });
}
