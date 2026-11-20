/**
 * Incantation puissante des Frappes bénies améliorées (clé `cantripVitality`) : à la fin de la résolution d'un sort mineur de clerc
 * qui a infligé des dégâts, le lanceur choisit qui reçoit les points de vie temporaires — lui, ou une créature de son camp à
 * portée ; « personne » d'abord. MJ actif (la route de résolution), la question va au joueur du lanceur. Une fois par résolution.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { vitalityApplies, vitalityRecipients, vitalityGain } from "../core/vitality.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { factsFor } from "../adapter/facts.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { log, tokenOfActor } from "./shared.mjs";

const seen = new Set();

export async function onVitalityResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || seen.has(resolution.id) ) return;
  const from = fromUuidSync(resolution.source ?? "", { strict: false });
  const source = (from?.documentName === "Actor") ? from : (from?.actor ?? null);
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const item = source?.items?.find(i => contentOf(i).entry?.cantripVitality);
  if ( !item || !activity ) return;
  const rule = contentOf(item).entry.cantripVitality;
  const damaged = (resolution.targets ?? []).filter(t => Number(t.damage?.applied) > 0).length;
  const cantripOfClass = factsFor({ self: source, activity })["activity.cantripOf"]?.(rule.class) === true;
  if ( !vitalityApplies(rule, { cantripOfClass, damaged, features: source.items.map(i => identifierOf(i).id) }) ) return;
  seen.add(resolution.id);
  const self = tokenOfActor(source);
  const scene = self?.parent;
  if ( !self || !scene ) return;
  const range = lengthIn(rule.range.value, rule.range.units, scene.grid.units, readUnitFactors());
  const tokens = scene.tokens.filter(t => t.actor && !t.hidden && ((t.actor.system?.attributes?.hp?.value ?? 0) > 0))
    .map(t => ({ id: t.id, name: t.name, self: t.id === self.id, ally: !areEnemies(self, t),
      distance: (t.id === self.id) ? 0 : distanceBetween(self, t) }));
  const recipients = vitalityRecipients(tokens, range);
  let amount = 0;
  try { amount = Number(Roll.safeEval(Roll.replaceFormulaData(rule.tempHp, source.getRollData()))) || 0; }
  catch { /* formule illisible : rien à donner */ }
  if ( !recipients.length || !(amount > 0) ) return;
  const answer = await askChoice(source, { actor: source.uuid, item: item.name,
    prompt: game.i18n.format("DND5ECOMBAT.Vitalite.Question", { item: item.name, spell: activity.item.name, n: amount }),
    // « Personne » d'abord : sans réponse dans le délai, askChoice retient la première option.
    options: [{ id: "none", label: game.i18n.localize("DND5ECOMBAT.Vitalite.Personne") },
      ...recipients.map(t => ({ id: t.id, label: t.self ? game.i18n.localize("DND5ECOMBAT.Vitalite.Soi") : t.name }))] });
  const chosen = scene.tokens.get(answer?.id ?? "");
  if ( !chosen?.actor ) return;
  const gain = vitalityGain(amount, chosen.actor.system?.attributes?.hp?.temp);
  if ( gain ) await chosen.actor.update({ "system.attributes.hp.temp": gain });
  await ChatMessage.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: source }),
    content: `<p>${foundry.utils.escapeHTML(game.i18n.format("DND5ECOMBAT.Vitalite.Carte",
      { item: item.name, name: chosen.name, n: amount }))}</p>`,
    flags: { [MODULE_ID]: { cantripVitality: { item: identifierOf(item).id, to: chosen.uuid, amount, gained: gain } } } });
  log(`${item.name}: ${chosen.name} gains ${amount} Temporary Hit Points (${source.name}, ${activity.item.name})`);
}
