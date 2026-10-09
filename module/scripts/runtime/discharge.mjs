/**
 * §19.9 : Chemin vers la tombe (Domaine de la Tombe, contenu `discharge`). Quand le clerc ou un allié qu'il voit touche le
 * maudit, le clerc peut, sans action, lever la malédiction : l'attaque inflige alors en plus son niveau de clerc en dégâts,
 * nécrotiques ou radiants à son choix.
 *
 * Sur le MJ actif, au hook de sortie du moteur `dnd5e-combat.resolution`, une fois l'attaque tranchée et ses dégâts appliqués :
 * pour chaque cible touchée qui porte l'effet déclaré, le lanceur de l'effet est consulté (`askChoice` : le joueur, sinon le
 * MJ ; sans réponse, la malédiction reste). S'il accepte, l'effet cesse et la cible subit les dégâts, lancés par le moteur au
 * nom du lanceur (résistances comprises) — une part à part plutôt qu'ajoutée au jet de l'attaque : un nombre fixe, que le
 * critique ne double pas. Limite : une attaque résolue hors du moteur n'est pas vue.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { areHostile } from "../core/reaction.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, tokenOf } from "../adapter/facts.mjs";
import { canSee } from "../adapter/vision.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { comesFromItemEffect } from "../adapter/triggers.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

const seen = new Set();

/** Les effets `discharge` que porte une créature : l'effet, l'item d'où il vient et sa règle. */
function chargesOn(actor) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    const rule = item ? contentOf(item).entry?.discharge : null;
    if ( rule && item.actor && comesFromItemEffect(effect, rule.effect) ) out.push({ effect, item, rule });
  }
  return out;
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const hits = (resolution.targets ?? []).filter(t => t.hit === true);
  if ( !hits.length ) return;
  seen.add(resolution.id);
  const attacker = fromUuidSync(resolution.source ?? "", { strict: false });
  const attackerToken = tokenOf(attacker);
  for ( const t of hits ) {
    const victimToken = fromUuidSync(t.token, { strict: false });
    const victim = victimToken?.actor;
    if ( !victim || ((victim.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    for ( const { effect, item, rule } of chargesOn(victim) ) {
      const caster = item.actor;
      const casterToken = tokenOf(caster);
      if ( (caster.system.attributes?.hp?.value ?? 0) <= 0 ) continue;
      // « vous ou un allié que vous voyez » : l'attaquant est le lanceur, ou n'est pas son ennemi et il le voit.
      if ( attacker?.uuid !== caster.uuid ) {
        if ( !attackerToken || !casterToken || areHostile(casterToken.disposition, attackerToken.disposition) ) continue;
        if ( rule.sees && (canSee(casterToken, attackerToken) === false) ) continue;
      }
      const amount = Roll.replaceFormulaData(rule.formula, item.getRollData());
      const labels = rule.damageTypes.map(type => ({ id: type, label: loc("Malediction.Type", { n: amount, type: game.i18n.localize(CONFIG.DND5E.damageTypes[type]?.label ?? type) }) }));
      const answer = await askChoice(caster, {
        actor: caster.uuid,
        item: item.name,
        prompt: loc("Malediction.Question", { attacker: attacker?.name ?? "", name: victim.name }),
        options: [{ id: "keep", label: loc("Malediction.Garder") }, ...labels]
      });
      if ( !rule.damageTypes.includes(answer?.id) ) { log(`${item.name}: ${caster.name} keeps the curse on ${victim.name}`); continue; }
      if ( !(await fromUuid(effect.uuid)) ) continue;   // tombée entre-temps
      await effect.delete();
      const logged = await inflict({
        step: { formula: rule.formula, damageType: answer.id }, item, targetUuid: t.token,
        speaker: ChatMessage.implementation.getSpeaker({ actor: caster, token: casterToken ?? undefined }),
        flavor: loc("Malediction.Carte", { item: item.name, name: victim.name }),
        flags: { discharge: { item: item.uuid, target: t.token, resolution: resolution.id, type: answer.id } }
      });
      if ( victimToken ) notice(victimToken, loc("Malediction.Retour", { item: item.name }), "ended");
      log(`${item.name}: ${caster.name} ends the curse — ${victim.name} takes ${amount} ${answer.id}${logged ? ` (HP ${logged.before?.value} → ${logged.after?.value})` : ""}`);
    }
  }
}

export function registerDischarge() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`discharge:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "curse: early end not offered" });
}
