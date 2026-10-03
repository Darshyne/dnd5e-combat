/**
 * Auras passives : ce qu'un item déclare (content/auras.mjs, surcouche du monde ou flag
 * `flags["dnd5e-combat"].aura` de l'item), et les copies d'effet posées sur ceux qui se
 * tiennent dans l'aura.
 *
 * Vérifié dans dnd5e 6.0.3 (packs/_source/classes24/paladin/class-features/aura-of-protection.yml) :
 * l'Aura de protection officielle porte un effet « Protected » transféré au paladin seul
 * (`system.bonuses.abilities.save` = `@abilities.cha.mod`), et une activité utilitaire dont le
 * gabarit donne le rayon (`@scale.paladin.aura`) et le camp visé (`ally`). Le moteur réutilise ces
 * données : il copie cet effet sur les alliés à portée. Le bonus est FIGÉ à la valeur du porteur
 * au moment de la copie — laissé en formule, `@abilities.cha.mod` lirait le Charisme de l'allié.
 */

import { MODULE_ID } from "../constants.mjs";
import { AURA_AFFECTS } from "../core/content.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** Un effet de cet item (pas une copie d'aura) sur l'acteur. `concentration` : la concentration du sort compte. */
function ownEffectsFrom(actor, item, { concentration=true }={}) {
  return (actor?.effects ?? []).filter(e => !e.disabled && !e.getFlag(MODULE_ID, "aura")
    && (concentration || !e.statuses?.has("concentrating")) && (originItemOf(e)?.uuid === item.uuid));
}

/**
 * §16.47 : cette créature porte-t-elle déjà l'effet d'origine du sort (cible du lancement) ? Une aura `whileActive` ne lui
 * en pose pas une copie de plus (les deux s'additionneraient).
 */
export function carriesOriginal(actor, aura) {
  return !!aura.whileActive && (ownEffectsFrom(actor, aura.item, { concentration: false }).length > 0);
}

/** La part d'aura que la surcouche du monde déclare pour cet item (elle prime sur le contenu livré). */
function worldAura(item) {
  return game.modules.get(MODULE_ID).api?.content?.world?.()[contentOf(item).identifier]?.aura ?? {};
}

/** Rayon et camp lus sur l'activité à gabarit de l'item, quand il en a une. */
function fromActivity(item) {
  for ( const activity of item.system.activities ?? [] ) {
    const template = activity.target?.template;
    if ( !template?.type ) continue;
    const size = Number(template.size);
    return {
      radius: Number.isFinite(size) && (size > 0) ? size : null,
      units: template.units ?? "ft",
      // « creature » (le Monster Manual, pour « de son choix ») ne dit pas le camp : le contenu décide.
      affects: AURA_AFFECTS.includes(activity.target?.affects?.type) ? activity.target.affects.type : null
    };
  }
  return {};
}

/** Les auras portées par un acteur. */
export function aurasOf(actor) {
  const auras = [];
  for ( const item of actor?.items ?? [] ) {
    // Couches combinées (adapter/content.mjs) : contenu du module, surcouche du monde, flag de l'item.
    const declared = contentOf(item).entry?.aura;
    if ( !declared ) continue;
    // §16.47 : une aura de sort n'existe que tant que le lanceur en porte un effet (concentration comprise).
    if ( declared.whileActive && !ownEffectsFrom(actor, item).length ) continue;
    const known = { ...declared };
    const merged = { includeSelf: false, affects: "ally", units: "ft", ...known };
    // Ordre de confiance : ce que le monde ou l'item disent explicitement, puis le gabarit de
    // l'activité, puis l'échelle de classe, puis la valeur par défaut du contenu livré.
    const fromItem = fromActivity(item);
    const flagged = { ...(contentOf(item).layers.world ? worldAura(item) : {}), ...(item.getFlag(MODULE_ID, "aura") ?? {}) };
    if ( !("radius" in flagged) ) {
      const scaled = known.radiusFormula ? Number(dnd5e.utils.simplifyBonus(known.radiusFormula, actor.getRollData())) : NaN;
      if ( Number.isFinite(fromItem.radius) ) Object.assign(merged, { radius: fromItem.radius, units: fromItem.units });
      else if ( Number.isFinite(scaled) && (scaled > 0) ) merged.radius = scaled;
    }
    if ( !("affects" in flagged) && fromItem.affects ) merged.affects = fromItem.affects;
    // §18.12 : des changements déclarés remplacent l'effet de l'item (absent, vide ou faux dans le Monster Manual).
    const effect = merged.changes ? null
      : ((merged.effect ? item.effects.get(merged.effect) : null) ?? item.effects.find(e => e.transfer) ?? item.effects.contents[0]);
    if ( (!effect && !merged.changes) || !Number.isFinite(merged.radius) ) {
      console.warn(`${MODULE_ID} | aura « ${item.name} » de ${actor.name} ignorée : ${(effect || merged.changes) ? "rayon inconnu" : "aucun effet à copier"}`);
      continue;
    }
    auras.push({ item, effect, key: item.system.identifier ?? item.id, ...merged });
  }
  return auras;
}

const changesOf = data => data.system?.changes ?? data.changes ?? [];

/** Les changements d'un effet, avec leurs valeurs figées pour le porteur de l'aura. */
function frozenChanges(effectData, sourceActor) {
  const rollData = sourceActor.getRollData();
  return changesOf(effectData).map(change => {
    const text = String(change.value ?? "");
    if ( !text.includes("@") ) return change;
    return { ...change, value: String(dnd5e.utils.simplifyBonus(text, rollData)) };
  });
}

/**
 * Les données de l'effet à copier : celui de l'item, ou (§18.12) un effet au nom de l'item fait des changements déclarés,
 * sans état — l'Aura de bravoure du Monster Manual porte Charmé et Effrayé en plus de l'immunité à ces états.
 */
function baseEffectData(aura) {
  if ( !aura.changes ) return aura.effect.toObject();
  const base = aura.effect?.toObject() ?? { name: aura.item.name, img: aura.item.img };
  return { ...base, statuses: [], system: { ...(base.system ?? {}), changes: foundry.utils.deepClone(aura.changes) }, changes: undefined };
}

/** Force d'une aura : la somme de ses valeurs numériques une fois figées (départage deux auras de même nom). */
export function auraValue(aura, sourceActor) {
  return frozenChanges(baseEffectData(aura), sourceActor)
    .reduce((sum, c) => sum + (Number.isFinite(Number(c.value)) ? Number(c.value) : 0), 0);
}

/** Les copies d'aura présentes sur un acteur. */
export function auraCopiesOn(token) {
  const copies = [];
  for ( const effect of token.actor?.effects ?? [] ) {
    const flag = effect.getFlag(MODULE_ID, "aura");
    if ( !flag ) continue;
    copies.push({
      id: effect.id, target: token.uuid, key: flag.key, source: flag.source, value: flag.value,
      iconShown: effect.showIcon === CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS
    });
  }
  return copies;
}

/** Données de la copie d'effet à poser (ou à mettre à jour) sur une cible. */
function copyData(aura, sourceToken, value) {
  const data = baseEffectData(aura);
  delete data._id;
  if ( data.changes === undefined ) delete data.changes;
  const changes = frozenChanges(data, sourceToken.actor);
  if ( data.system?.changes ) data.system.changes = changes;
  else data.changes = changes;
  return foundry.utils.mergeObject(data, {
    name: `${aura.item.name} (${sourceToken.name})`,
    img: aura.item.img,
    transfer: false,
    disabled: false,
    // Un effet sans durée est « passif » : par défaut le cœur n'affiche son icône sur le token que
    // s'il est temporaire (CONST.ACTIVE_EFFECT_SHOW_ICON.CONDITIONAL). Une aura doit se voir.
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    origin: aura.item.uuid,
    flags: { [MODULE_ID]: { aura: { key: aura.key, source: sourceToken.uuid, value } } }
  });
}

export async function createAuraCopy(targetToken, aura, sourceToken, value) {
  await targetToken.actor.createEmbeddedDocuments("ActiveEffect", [copyData(aura, sourceToken, value)]);
}

export async function updateAuraCopy(targetToken, effectId, aura, sourceToken, value) {
  await targetToken.actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: effectId, ...copyData(aura, sourceToken, value) }]);
}

/** Remet l'icône sur une copie posée avant que le moteur ne l'affiche. */
export async function showAuraIcon(targetToken, effectId) {
  await targetToken.actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: effectId, showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS }]);
}

export async function removeAuraCopy(targetToken, effectId) {
  if ( targetToken.actor?.effects.has(effectId) ) await targetToken.actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
}
