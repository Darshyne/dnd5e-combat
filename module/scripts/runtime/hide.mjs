/**
 * Furtivité (Hide, SPEC §15.2, §185), sur le client de celui qui se cache. Un seul état « caché » (décision de l'utilisateur,
 * 2026-10-14 : l'action et le mode furtif ne font plus qu'un) — l'effet de Furtivité, invisible pour les ennemis seuls (adapter/stealth.mjs) :
 *  - règles `2024` : test de Discrétion DD 15 ; réussi, l'effet porte le total (le DD pour vous localiser) ; raté, hors combat, on ne
 *    peut retenter qu'après 10 s (contre le spam ; en combat, l'Action est le coût) ;
 *  - règles `bg3` : pas de jet ; l'effet porte la Discrétion passive (pour Chercher) ; chaque ennemi doit ensuite repérer la créature
 *    (runtime/stealth.mjs).
 * Dans les deux : il faut être hors du champ de vision de tout ennemi (cônes compris hors combat ; la légalité le vérifie pour l'item,
 * `hideToken` pour le raccourci) ; la Furtivité cesse après un jet d'attaque, ou un sort à composante verbale.
 * Être localisé ou faire du bruit reste au MJ : il retire l'effet (ou Perception passive, Chercher, détection BG3).
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionOfActivity } from "../adapter/basics.mjs";
import { hiddenEffectsOf, hiddenEffectData, enemiesSeeing } from "../adapter/hide.mjs";
import { stealthRules } from "../adapter/stealth.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";

/** DD du test de Discrétion (règle 2024). */
const HIDE_DC = 15;
/** Hors combat, après un échec (règles 2024) : attendre avant de retenter. */
const RETRY_MS = 10000;

const fighting = doc => !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.tokenId === doc?.id));
const tokensOf = actor => actor?.getActiveTokens?.(false, true) ?? [];

/** Effacer qui avait repéré ces tokens (règles BG3). */
async function forgetSpotters(actor) {
  for ( const t of tokensOf(actor) ) if ( t.isOwner && t.getFlag(MODULE_ID, "stealth") ) await t.unsetFlag(MODULE_ID, "stealth");
}

export async function endHiding(actor, why) {
  const effects = hiddenEffectsOf(actor);
  if ( !effects.length || !actor.isOwner ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
  await forgetSpotters(actor);
  log(`hide: ${actor.name} is no longer hidden (${why})`);
  ui.notifications.info(loc("Furtivite.Fin", { name: actor.name }));
  Hooks.callAll(`${MODULE_ID}.sneak`, tokensOf(actor)[0] ?? null, false);
}

/**
 * Se cacher, selon les règles du monde (l'action est déjà payée, ou hors combat). Rend `{ hidden, total?, reason? }`.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 */
export async function attemptHide(actor, token=null) {
  const rules = stealthRules();
  const t = token ?? tokensOf(actor)[0] ?? null;
  if ( (rules === "2024") && t && !fighting(t) ) {
    const retry = Number(t.getFlag(MODULE_ID, "hideRetryAt")) || 0;
    if ( Date.now() < retry ) {
      ui.notifications.info(loc("Furtivite.Attendre", { name: actor.name, s: Math.ceil((retry - Date.now()) / 1000) }));
      return { hidden: false, reason: "cooldown" };
    }
  }
  let dc;
  if ( rules === "bg3" ) dc = Number(actor.system?.skills?.ste?.passive) || (10 + (Number(actor.system?.skills?.ste?.total) || 0));
  else {
    const rolls = await actor.rollSkill({ skill: "ste", target: HIDE_DC }, { configure: false });
    const total = rolls?.[0]?.total;
    if ( !Number.isFinite(total) ) return { hidden: false, reason: "noRoll" };
    if ( total < HIDE_DC ) {
      log(`hide: ${actor.name} fails (${total} vs DC ${HIDE_DC})`);
      if ( t?.isOwner && !fighting(t) ) await t.setFlag(MODULE_ID, "hideRetryAt", Date.now() + RETRY_MS);
      ui.notifications.info(loc("Furtivite.Rate", { name: actor.name, total }));
      return { hidden: false, total, reason: "failed" };
    }
    dc = total;
  }
  await actor.deleteEmbeddedDocuments("ActiveEffect", hiddenEffectsOf(actor).map(e => e.id));
  await forgetSpotters(actor);
  await actor.createEmbeddedDocuments("ActiveEffect", [hiddenEffectData(dc, loc("Furtivite.Effet", { dc }))]);
  log(`hide: ${actor.name} is hidden (${rules}, DC ${dc} to find them)`);
  ui.notifications.info(loc(rules === "bg3" ? "Furtivite.ReussieBG3" : "Furtivite.Reussie", { name: actor.name, total: dc }));
  Hooks.callAll(`${MODULE_ID}.sneak`, t, true);
  return { hidden: true, total: dc };
}

/**
 * Le raccourci et le bouton (§183) : caché → ne plus l'être ; sinon se cacher. Hors combat, sans coût, s'il n'est vu d'aucun ennemi.
 * En combat, l'action Furtivité se prend par son item (légalité et budget) : rend `reason: "inCombat"`.
 */
export async function toggleHidden(token) {
  const doc = token?.document ?? token;
  const actor = doc?.actor;
  if ( !actor || !doc.isOwner ) return { hidden: false, reason: "notOwner" };
  if ( hiddenEffectsOf(actor).length ) { await endHiding(actor, "by hand"); return { hidden: false }; }
  if ( fighting(doc) ) return { hidden: false, reason: "inCombat" };
  const seen = enemiesSeeing(doc) ?? [];
  if ( seen.length ) {
    ui.notifications.info(loc("Furtivite.Vu", { name: actor.name, by: seen.map(s => s.name).join(", ") }));
    return { hidden: false, reason: "seen" };
  }
  return attemptHide(actor, doc);
}

async function onPostUse(activity, usageConfig) {
  const actor = activity.actor;
  if ( !actor ) return;
  // L'item Furtivité, ou une activité qui prend l'action Se cacher (Ruse du Roublard, par une action Bonus : §20).
  if ( basicActionOfActivity(activity, usageConfig?.[MODULE_ID]?.basicChoice) === "hide" ) return attemptHide(actor);
  // Un sort à composante verbale trahit la cachette.
  if ( isSpellCast(activity.item) && activity.item.system.properties?.has("vocal") ) await endHiding(actor, "spell with a Verbal component");
}

export function registerHide() {
  route("dnd5e.postUseActivity", (activity, usageConfig) => { onPostUse(activity, usageConfig).catch(err => console.error(`${MODULE_ID} | hide`, err)); },
    { label: "hide" });
  // « Vous cessez d'être caché aussitôt après… un jet d'attaque » : après le jet, qui a profité de l'invisibilité.
  route("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    const actor = subject?.actor;
    if ( actor ) endHiding(actor, "attack roll").catch(err => console.error(`${MODULE_ID} | hide`, err));
  }, { label: "hide: ends on attack roll" });
}
