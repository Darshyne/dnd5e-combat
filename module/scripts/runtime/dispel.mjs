/**
 * §37.2 : Dissipation de la magie. Au message d'utilisation d'un sort dont le contenu déclare `dispel` (MJ actif) : pour chaque cible
 * du message, les sorts en cours (adapter/dispel.mjs) cessent d'office jusqu'au niveau 3 ou à celui de l'emplacement, les autres sur
 * un test de la caractéristique d'incantation du lanceur contre DD 10 + niveau (core/dispel.mjs, lancé par le moteur). Une carte dit
 * ce qui a cessé et ce qui a résisté (flag `dispel`, lu par les scénarios). Une zone magique (Rayon de lune…) n'est pas visée.
 */

import { MODULE_ID } from "../constants.mjs";
import { dispelPlan } from "../core/dispel.mjs";
import { spellsOn, endSpell, castingAbilityOf, castingCheck } from "../adapter/dispel.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

async function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
  const item = message.getAssociatedItem?.();
  if ( contentOf(item).entry?.dispel !== true ) return;
  const caster = message.getAssociatedActor?.() ?? item.actor;
  const slot = Number(message.system?.level) || Number(item.system?.level) || 3;
  const targets = message.system?.targets ?? [];
  if ( !targets.length ) { log(`${item.name} : aucune cible désignée, rien à dissiper`); return; }
  for ( const t of targets ) {
    const token = await fromUuid(t.token ?? "");
    const actor = token?.actor ?? (await fromUuid(t.actor ?? ""));
    if ( !actor ) continue;
    const spells = spellsOn(actor, { except: item });
    const byKey = new Map(spells.map(s => [s.key, s]));
    const ended = [];
    const resisted = [];
    for ( const step of dispelPlan(spells, slot) ) {
      const spell = byKey.get(step.key);
      let ends = step.auto;
      let total = null;
      if ( !ends ) {
        total = await castingCheck(caster, castingAbilityOf(item, caster), step.dc);
        ends = (total !== null) && (total >= step.dc);
      }
      if ( ends ) { await endSpell(spell); ended.push({ name: spell.name, level: spell.level, total }); }
      else resisted.push({ name: spell.name, level: spell.level, total, dc: step.dc });
      log(`${item.name} sur ${actor.name} : ${spell.name} (niveau ${spell.level}) ${ends ? "cesse" : "résiste"}${step.auto ? "" : ` — test ${total} contre DD ${step.dc}`}`);
    }
    const lines = [
      ...ended.map(s => loc("Dissipation.Cesse", { spell: s.name, level: s.level })),
      ...resisted.map(s => loc("Dissipation.Resiste", { spell: s.name, level: s.level, total: s.total ?? "—", dc: s.dc }))
    ];
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: caster }),
      content: `<p><strong>${loc("Dissipation.Titre", { item: item.name, name: actor.name })}</strong></p>`
        + (lines.length ? lines.map(l => `<p>${l}</p>`).join("") : `<p>${loc("Dissipation.Rien")}</p>`),
      flags: { [MODULE_ID]: { dispel: { target: t.token ?? actor.uuid, slot, ended, resisted } } }
    });
  }
}

export function registerDispel() {
  route("createChatMessage", onUsage, { executor: true, label: "Dissipation de la magie : rien dissipé" });
}
