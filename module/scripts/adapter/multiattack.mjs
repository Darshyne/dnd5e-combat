/**
 * Attaques multiples d'un monstre vues depuis la fiche (SPEC §18.6, M1) : le plan se lit dans le texte ANGLAIS d'origine
 * de l'item, que Babele garde dans `flags.babele.originalPayload.description` quand il traduit (vu sur les fiches du
 * monde `ravenloft`, Babele 2.9.1, `script/actor/actor-translation.js:150-163`) ; sans Babele, la description elle-même.
 *
 * Les clés d'une utilisation (core/multiattack.mjs) :
 *  - l'item : `id:<id>`, `name:<nom anglais>` (`flags.babele.originalName`, sinon le nom) ;
 *  - l'activité : `activity:<id>` ;
 *  - un sort lancé par « Incantation » : dnd5e en crée une copie sur l'acteur, marquée `flags.dnd5e.cachedFor` =
 *    uuid relatif de l'activité d'incantation, et `_stats.compendiumSource` = le sort d'origine (activity/cast.mjs:118-145).
 *    On y lit l'item parent (`id:`), l'activité d'incantation (`activity:`) et le sort (`spell:`).
 */

import { parseMultiattack, expandPlan, multiattackStatus } from "../core/multiattack.mjs";

const englishName = item => String(item?.flags?.babele?.originalName ?? item?.name ?? "").toLowerCase();

/** Le parent d'une copie de sort : « .mmSpellcasting00.Activity.NdueMCpXRc7fLDFa ». */
function castOrigin(item) {
  const cached = item?.flags?.dnd5e?.cachedFor;
  const m = typeof cached === "string" ? cached.match(/([A-Za-z0-9]{16})\.Activity\.([A-Za-z0-9]{16})$/) : null;
  return m ? { item: m[1], activity: m[2] } : null;
}

/** Les clés d'une utilisation de cette activité. */
export function useKeysOf(activity) {
  const item = activity?.item;
  if ( !item ) return null;
  const keys = [`id:${item.id}`, `name:${englishName(item)}`, `activity:${activity.id}`];
  const origin = castOrigin(item);
  if ( origin ) keys.push(`id:${origin.item}`, `activity:${origin.activity}`);
  const source = item._stats?.compendiumSource;
  if ( (item.type === "spell") && source ) keys.push(`spell:${source}`);
  return [...new Set(keys)];
}

/**
 * Le catalogue de la fiche : les clés qui désignent un même item (id et nom), et chaque activité d'incantation avec
 * son sort. Le parent « Incantation » n'est PAS mêlé à ses sorts : « remplacer par un sort précis » n'admet pas les autres.
 */
function catalogOf(actor) {
  const catalog = [];
  for ( const item of actor.items ) {
    catalog.push([`id:${item.id}`, `name:${englishName(item)}`]);
    for ( const activity of item.system.activities?.values?.() ?? [] ) {
      if ( (activity.type === "cast") && activity.spell?.uuid ) catalog.push([`activity:${activity.id}`, `spell:${activity.spell.uuid}`]);
    }
  }
  return catalog;
}

/** Le texte anglais d'un item : celui d'avant Babele s'il y en a un. */
export function englishDescription(item) {
  return item?.flags?.babele?.originalPayload?.description ?? item?.system?.description?.value ?? "";
}

/**
 * Le plan d'Attaques multiples d'un PNJ, ou null (pas un PNJ, pas d'Attaques multiples, texte illisible).
 * @param {Actor5e} actor
 */
export function multiattackOf(actor) {
  if ( actor?.type !== "npc" ) return null;
  const item = actor.items.find(i => i.system.identifier === "multiattack");
  if ( !item ) return null;
  return expandPlan(parseMultiattack(englishDescription(item)), catalogOf(actor));
}

/**
 * §18.19 : ce qui reste des Attaques multiples ouvertes ce tour (`budget.multi`), item par item — uuids des items encore
 * jouables (`left`), de ceux du plan qui n'ont plus rien (`spent`), et les noms des premiers. null sans plan ouvert.
 * @param {Actor5e} actor
 * @param {{plan: object, used: string[][]}|null} multi
 */
export function multiattackLeft(actor, multi) {
  if ( !actor || !multi?.plan ) return null;
  const candidates = actor.items.map(item => ({
    id: item.uuid, name: item.name,
    uses: Array.from(item.system.activities?.values?.() ?? []).map(useKeysOf).filter(Boolean)
  })).filter(c => c.uses.length);
  const { left, spent } = multiattackStatus(multi.plan, multi.used ?? [], candidates);
  return { left: new Set(left), spent: new Set(spent), names: candidates.filter(c => left.includes(c.id)).map(c => c.name) };
}
