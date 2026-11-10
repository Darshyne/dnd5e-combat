/**
 * §68 : l'utilisation sans fenêtre — quel emplacement de sort prendre quand celui que dnd5e propose est vide.
 * Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * L'emplacement à dépenser : celui que dnd5e propose s'il en reste, sinon le plus bas qui en a encore, d'un niveau au moins égal
 * à celui du sort (emplacements de pacte compris, à leur niveau ; à niveau égal, l'emplacement ordinaire d'abord). null : plus aucun.
 * @param {Record<string, {value: number, level: number}>} slots  Les emplacements de l'acteur (`system.spells`, clés `spell1`… `pact`).
 * @param {string} proposed  La clé proposée par dnd5e (`usageConfig.spell.slot`).
 * @param {number} spellLevel  Le niveau du sort.
 * @returns {string|null}
 */
export function pickSpellSlot(slots, proposed, spellLevel) {
  const has = key => (Number(slots?.[key]?.value) || 0) > 0;
  // §384 : l'emplacement proposé doit aussi être assez haut (un emplacement de pacte de niveau 3 ne lance pas un sort de niveau 6 —
  // dnd5e le « lancerait » au niveau 3). Un emplacement sans niveau connu est pris tel quel.
  const highEnough = key => !Number(slots?.[key]?.level) || (Number(slots[key].level) >= spellLevel);
  if ( has(proposed) && highEnough(proposed) ) return proposed;
  const candidates = Object.entries(slots ?? {})
    .filter(([key, slot]) => /^(spell\d+|pact)$/.test(key) && has(key) && ((Number(slot.level) || 0) >= spellLevel))
    .sort(([ka, a], [kb, b]) => ((Number(a.level) || 0) - (Number(b.level) || 0)) || (Number(ka === "pact") - Number(kb === "pact")));
  return candidates[0]?.[0] ?? null;
}

/**
 * §384 (issue #38, suite) : l'emplacement d'un sort que le MJ lance sans emplacement (« Lancer quand même », §77). dnd5e fixe le niveau
 * de lancement d'après l'emplacement proposé (`_prepareUsageScaling`, documents/activity/mixin.mjs : `scaling` = niveau de l'emplacement
 * − niveau du sort) — un Occultiste qui n'a que des emplacements de pacte de niveau 3 « lançait » Création de morts-vivants (niveau 6)
 * au niveau 3 : 3 − 3 = 0 goule, « There must be at least one Token to be placed » ; Convocation de céleste au niveau 3, esprit faux.
 * Rend l'emplacement à mettre : celui proposé s'il est au moins du niveau du sort, sinon celui du niveau du sort (`spell<n>`, qui
 * existe toujours dans `system.spells`, même à 0). Null pour un tour de magie ou sans emplacement proposé.
 * @param {Record<string, {level: number}>} slots
 * @param {string|null} proposed
 * @param {number} spellLevel
 * @returns {string|null}
 */
export function forcedSpellSlot(slots, proposed, spellLevel) {
  if ( !(spellLevel > 0) || !proposed ) return null;
  const level = Number(slots?.[proposed]?.level) || 0;
  return (level >= spellLevel) ? proposed : `spell${spellLevel}`;
}

/**
 * §77 : les consommations d'une activité qui dépensent ses PROPRES utilisations (`activityUses` sans cible) alors qu'elle n'en a pas,
 * quand l'item, lui, en porte (Monster Manual 2024 : « Nuage fétide (1/jour) » du Dretch — la charge est sur l'item) : à lire comme
 * les utilisations de l'item. Les index de ces consommations.
 * @param {Array<{type: string, target?: string}>} targets  Les consommations de l'activité.
 * @param {boolean} activityHasUses  L'activité a-t-elle un maximum d'utilisations ?
 * @param {boolean} itemHasUses  L'item a-t-il un maximum d'utilisations ?
 * @returns {number[]}
 */
export function misplacedSelfUses(targets, activityHasUses, itemHasUses) {
  if ( activityHasUses || !itemHasUses ) return [];
  return (targets ?? []).flatMap((t, i) => ((t?.type === "activityUses") && !t.target) ? [i] : []);
}

/**
 * §106 : le sort peut-il se lancer plus haut que son niveau — reste-t-il un emplacement (pacte compris) d'un niveau supérieur ?
 * C'est alors un vrai choix, que l'utilisation sans fenêtre laisse à celle de dnd5e.
 * @param {Record<string, {value: number, level: number}>} slots  Les emplacements de l'acteur (`system.spells`).
 * @param {number} spellLevel  Le niveau du sort.
 * @returns {boolean}
 */
export function canCastHigher(slots, spellLevel) {
  return Object.entries(slots ?? {}).some(([key, slot]) => /^(spell\d+|pact)$/.test(key)
    && ((Number(slot?.value) || 0) > 0) && ((Number(slot?.level) || 0) > spellLevel));
}

/**
 * §404 : l'activité au niveau auquel le sort a été lancé. dnd5e note la montée d'emplacement sur le message d'utilisation
 * (`system.scaling`, documents/activity/mixin.mjs : `data.system.scaling`) et la rejoue avant chaque bouton de la carte en clonant
 * l'item (`Activity#onChatAction` : `flags.dnd5e.scaling`), ou par `Item5e#scaledClone` (`ChatMessage5e#getAssociatedActivity({ scaled })`).
 * Une activité relue par son uuid est celle de la fiche, au niveau de base : ses dés « Using a Higher-Level Spell Slot » manquent.
 * Rend la copie mise à l'échelle (même id d'activité), ou l'activité telle quelle sans montée ou sans `scaledClone`.
 * @param {object|null} activity  Une activité (`item.scaledClone(n).system.activities.get(id)`).
 * @param {number|string|null} scaling  La montée d'emplacement (niveau de lancement − niveau du sort).
 * @returns {object|null}
 */
export function atCastLevel(activity, scaling) {
  const increase = Math.max(0, Math.trunc(Number(scaling) || 0));
  if ( !activity || !increase || (typeof activity.item?.scaledClone !== "function") ) return activity;
  return activity.item.scaledClone(increase)?.system?.activities?.get?.(activity.id) ?? activity;
}

/**
 * §405 : le niveau d'une activité d'un sort qui ne dépense pas d'emplacement — l'attaque de la Lame de feu (seule « Evoke Blade » en
 * dépense un), les dégâts en action Bonus du Trait ensorcelé. dnd5e note le niveau de lancement sur l'effet de concentration
 * (`beginConcentrating(activity, { "flags.dnd5e.scaling": … })`, documents/activity/mixin.mjs), mais une utilisation suivante le
 * recalcule d'après l'emplacement proposé, celui du niveau du sort (`_prepareUsageConfig` puis `_prepareUsageScaling`) : la montée
 * retombe à 0. Rend `{ scaling, slot }` à mettre dans la configuration d'utilisation, ou null (sort de niveau 0, activité qui dépense
 * un emplacement, montée déjà fixée par l'appelant, pas de concentration montée).
 * @param {{spellLevel: number, consumesSlot: boolean, scaling?: number|boolean, concentrationScaling?: number}} data
 * @returns {{scaling: number, slot: string}|null}
 */
export function followUpScaling({ spellLevel, consumesSlot, scaling, concentrationScaling }) {
  const level = Math.trunc(Number(spellLevel) || 0);
  const increase = Math.trunc(Number(concentrationScaling) || 0);
  if ( (level <= 0) || consumesSlot || (Number(scaling) > 0) || (increase <= 0) ) return null;
  return { scaling: increase, slot: `spell${level + increase}` };
}
