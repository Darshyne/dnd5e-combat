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
import { tokenOf } from "../adapter/vision.mjs";
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
  const token = tokenOf(actor);
  for ( const e of broken ) {
    log(`${actor.name} : ${e.name} cesse (${moments.join(", ")})`);
    if ( token ) notice(token, loc("Retour.FinEffet", { item: e.name }), "ended");
  }
}

export function registerBreaks() {
  route("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    breakEffects(subject?.actor, breakMoments({ attack: true, damage: false, spell: false })).catch(err => console.error(`${MODULE_ID} | fin d'effet`, err));
  }, { label: "effet qui cesse au jet d'attaque non retiré" });
  route("dnd5e.rollSavingThrow", (rolls, { subject }={}) => {
    breakEffects(subject, ["save"], null, { before: Date.now() }).catch(err => console.error(`${MODULE_ID} | fin d'effet`, err));
  }, { label: "effet qui cesse à la sauvegarde non retiré" });
  route("dnd5e.postUseActivity", activity => {
    if ( !activity?.actor || (activity.type === "attack") ) return;
    const moments = breakMoments({ attack: false, damage: (activity.damage?.parts?.length ?? 0) > 0, spell: isSpellCast(activity.item) });
    breakEffects(activity.actor, moments, activity.item).catch(err => console.error(`${MODULE_ID} | fin d'effet`, err));
  }, { label: "effet qui cesse au sort ou aux dégâts non retiré" });
}
