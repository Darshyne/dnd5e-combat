/**
 * §37.2 : Dissipation de la magie. Au message d'utilisation d'un sort dont le contenu déclare `dispel` (MJ actif) : pour chaque cible
 * du message, les sorts en cours (adapter/dispel.mjs) cessent d'office jusqu'au niveau 3 ou à celui de l'emplacement, les autres sur
 * un test de la caractéristique d'incantation du lanceur contre DD 10 + niveau (core/dispel.mjs, lancé par le moteur). Une carte dit
 * ce qui a cessé et ce qui a résisté (flag `dispel`, lu par les scénarios).
 * §403 : « une créature, un objet ou un effet magique à portée » — sans créature désignée, le lanceur choisit une zone de sort à portée
 * (Toile, Rayon de lune, Ténèbres… ; adapter/dispel.mjs, `spellZonesNear`), qui cesse comme un sort sur une créature : sa concentration
 * retirée, sinon la zone. Les objets (enchantement d'une arme) : au MJ.
 */

import { MODULE_ID } from "../constants.mjs";
import { dispelPlan } from "../core/dispel.mjs";
import { spellsOn, endSpell, castingAbilityOf, castingCheck, spellZonesNear } from "../adapter/dispel.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { speakerTokenOf } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { identifierOf } from "../adapter/content.mjs";

async function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
  const item = message.getAssociatedItem?.();
  if ( contentOf(item).entry?.dispel !== true ) return;
  const caster = message.getAssociatedActor?.() ?? item.actor;
  const slot = Number(message.system?.level) || Number(item.system?.level) || 3;
  const targets = message.system?.targets ?? [];
  if ( !targets.length ) return dispelZone(message, item, caster, slot);
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
        // §306 (repasse C11) : Briseur de sorts (Abjurateur 10) — « vous ajoutez votre bonus de maîtrise au test » de Dissipation de la magie.
        const breaker = (identifierOf(item).id === "dispel-magic") && caster.items.some(i => identifierOf(i).id === "spell-breaker");
        total = await castingCheck(caster, castingAbilityOf(item, caster), step.dc, { bonus: breaker ? (Number(caster.system.attributes?.prof) || 0) : 0 });
        if ( breaker ) log(`${caster.name}: Spell Breaker, proficiency bonus added to the check (${total})`);
        ends = (total !== null) && (total >= step.dc);
      }
      if ( ends ) { await endSpell(spell); ended.push({ name: spell.name, level: spell.level, total }); }
      else resisted.push({ name: spell.name, level: spell.level, total, dc: step.dc });
      log(`${item.name} on ${actor.name}: ${spell.name} (level ${spell.level}) ${ends ? "ends" : "resists"}${step.auto ? "" : ` — check ${total} vs DC ${step.dc}`}`);
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

/** §403 : sans créature désignée, une zone de sort à portée, au choix du lanceur (aucune : rien). */
async function dispelZone(message, item, caster, slot) {
  const casterToken = speakerTokenOf(message) ?? caster?.getActiveTokens?.(false, true)?.[0] ?? null;
  const range = item.system?.range ?? {};
  const reach = Number.isFinite(Number(range.value)) && casterToken
    ? lengthIn(Number(range.value), range.units || "ft", casterToken.parent.grid.units) : 0;
  const zones = casterToken ? spellZonesNear(casterToken, reach, { except: item }) : [];
  if ( !zones.length ) { log(`${item.name}: no target designated and no spell area in range, nothing to dispel`); return; }
  const answer = await askChoice(caster, { actor: caster.uuid, item: item.name, prompt: loc("Dissipation.Zone"),
    options: [{ id: "none", label: loc("Dissipation.AucuneZone") }, ...zones.map(z => ({ id: z.key, label: loc("Dissipation.ZoneNom", { spell: z.name, level: z.level, caster: z.caster }) }))] });
  const zone = zones.find(z => z.key === answer?.id);
  if ( !zone ) { log(`${item.name}: no area chosen`); return; }
  const [step] = dispelPlan([zone], slot);
  let ends = step.auto;
  let total = null;
  if ( !ends ) {
    total = await castingCheck(caster, castingAbilityOf(item, caster), step.dc);
    ends = (total !== null) && (total >= step.dc);
  }
  if ( ends ) await endSpell(zone);
  log(`${item.name} on the area ${zone.name} (level ${zone.level}): ${ends ? "ends" : "resists"}${step.auto ? "" : ` — check ${total} vs DC ${step.dc}`}`);
  const line = ends ? loc("Dissipation.Cesse", { spell: zone.name, level: zone.level })
    : loc("Dissipation.Resiste", { spell: zone.name, level: zone.level, total: total ?? "—", dc: step.dc });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: caster }),
    content: `<p><strong>${loc("Dissipation.TitreZone", { item: item.name, spell: zone.name })}</strong></p><p>${line}</p>`,
    flags: { [MODULE_ID]: { dispel: { zone: zone.key, slot, ended: ends ? [{ name: zone.name, level: zone.level, total }] : [],
      resisted: ends ? [] : [{ name: zone.name, level: zone.level, total, dc: step.dc }] } } }
  });
}

export function registerDispel() {
  route("createChatMessage", onUsage, { executor: true, label: "Dispel Magic: nothing dispelled" });
}
