/**
 * §48 : un parchemin de sort se joue comme le sort qu'il contient — lancer le sort, sans emplacement (core/scrolls.mjs).
 *
 * Ce qui compte comme « lancer un sort » (isSpellCast) : Contresort, rupture de l'invisibilité et de la discrétion, rage,
 * composante verbale, Sort mineur appuyé, Façonneur de sorts, Retour à la vie, Dissipation et avantage aux sauvegardes donnés
 * par ses effets, et le contenu déclaré du sort (identifierOf, adapter/content.mjs). Ce qui ne compte pas, parce qu'un
 * parchemin ne dépense pas d'emplacement et n'est pas « un sort de votre classe » : la limite d'un sort à emplacement par tour,
 * Disciple de la Vie, les réserves rechargées par un emplacement, le surclassement, la Métamagie, `classSpell`, `cantripOf`.
 *
 * L'index des sorts (noms français et anglais, identifiants) se bâtit au `ready`, sur les index des compendiums d'items
 * (`getIndex` avec `system.identifier`, `system.level`, `system.school`) et les sorts du monde.
 */

import { MODULE_ID } from "../constants.mjs";
import { scrollCandidates, scrollSpell, slug, scrollAccess, highestSlotLevel } from "../core/scrolls.mjs";
import { identifierOf } from "./content.mjs";
import { potionOfCast } from "./potions.mjs";

/** slug (identifiant, nom affiché, nom anglais) → { identifier, level, school }. */
const known = new Map();

function remember(identifier, names, level, school) {
  if ( !identifier ) return;
  const entry = { identifier, level: Number.isFinite(Number(level)) ? Number(level) : null, school: school ?? null };
  for ( const key of [identifier, ...names.map(slug)] ) if ( key && !known.has(key) ) known.set(key, entry);
}

/** Bâtit l'index des sorts. À appeler au `ready` (les compendiums sont là, Babele a traduit leurs index). */
export async function buildSpellIndex() {
  known.clear();
  for ( const item of game.items ?? [] ) {
    if ( item.type === "spell" ) remember(item.system.identifier, [item.name, item.flags?.babele?.originalName ?? ""], item.system.level, item.system.school);
  }
  for ( const pack of game.packs ?? [] ) {
    if ( pack.documentName !== "Item" ) continue;
    let index;
    try { index = await pack.getIndex({ fields: ["system.identifier", "system.level", "system.school", "flags.babele.originalName"] }); }
    catch { continue; }
    for ( const e of index ) {
      if ( e.type !== "spell" ) continue;
      remember(e.system?.identifier || slug(e.flags?.babele?.originalName ?? e.name), [e.name, e.flags?.babele?.originalName ?? ""],
        e.system?.level, e.system?.school);
    }
  }
  return known.size;
}

/** Est-ce un parchemin de sort ? */
export const isScroll = item => (item?.type === "consumable") && (item.system?.type?.value === "scroll");

/**
 * Le sort d'un parchemin `{ identifier, level, school }`, ou null (pas un parchemin, ou sort introuvable).
 *
 * Un parchemin fait depuis un compendium (`createScrollFromCompendiumSpell`, documents/item.mjs) ne recopie pas le sort : il
 * porte une activité « cast » vers lui, comme une baguette ; l'utiliser lance le vrai sort (un item de sort en cache), que le
 * moteur voit comme tel. Ce parchemin-là n'est donc PAS un sort lui-même — sinon le moteur verrait deux lancements (deux
 * fenêtres de Contresort). Seuls les parchemins à activités recopiées (`createScrollFromSpell` d'un sort du monde, imports,
 * anciens) sont reconnus ici.
 */
export function scrollSpellOf(item) {
  if ( !isScroll(item) ) return null;
  if ( (item.system?.activities ?? []).some?.(a => a.type === "cast") ) return null;
  const flags = item.flags ?? {};
  const originalNames = [flags.babele?.originalName, flags.ddbimporter?.originalName].filter(Boolean);
  return scrollSpell({
    stamped: flags[MODULE_ID]?.scroll ?? null,
    candidates: scrollCandidates({ name: item.name, originalNames }),
    known,
    level: Number(flags.dnd5e?.spellLevel?.value ?? NaN)
  });
}

/**
 * Utiliser cet item, est-ce lancer un sort ? Un sort, ou un parchemin dont on connaît le sort — pas le sort qu'une potion
 * fait lancer (§53 : boire n'est pas lancer un sort).
 */
export const isSpellCast = item => ((item?.type === "spell") && !potionOfCast(item)) || !!scrollSpellOf(item);

/** Le niveau du sort lancé (sort ou parchemin), 0 sinon. */
export function spellLevelOf(item) {
  if ( item?.type === "spell" ) return Number(item.system.level) || 0;
  return scrollSpellOf(item)?.level ?? 0;
}

/** L'école du sort lancé (sort ou parchemin), ou null. */
export function spellSchoolOf(item) {
  if ( item?.type === "spell" ) return item.system.school ?? null;
  return scrollSpellOf(item)?.school ?? null;
}

/**
 * `dnd5e.createScrollFromSpell` (documents/item.mjs, après la composition des données) : le moteur note sur le parchemin le
 * sort qu'il contient, que dnd5e ne garde pas.
 */
export function stampScroll(spell, scrollData) {
  if ( (spell?.type !== "spell") || !scrollData ) return;
  const identifier = spell.system?.identifier;
  if ( !identifier ) return;
  scrollData.flags ??= {};
  scrollData.flags[MODULE_ID] = { ...(scrollData.flags[MODULE_ID] ?? {}), scroll: {
    identifier, level: Number(scrollData.flags.dnd5e?.spellLevel?.value ?? spell.system.level) || 0, school: spell.system.school ?? null
  } };
}

/**
 * O8g (§350) : l'activité du parchemin derrière une utilisation — celle du parchemin lui-même, ou, pour le sort en cache qu'une
 * activité « cast » lance (`flags.dnd5e.cachedFor`, documents/activity/cast.mjs : `use` passe au sort), l'activité « cast » de son
 * parchemin. Null sinon.
 */
export function scrollActivityOf(activity) {
  if ( isScroll(activity?.item) ) return activity;
  // `cachedFor` est un uuid relatif à l'acteur : dnd5e le résout par `linkedActivity` (data/item/spell.mjs).
  const cast = activity?.item?.flags?.dnd5e?.cachedFor ? (activity.item.system?.linkedActivity ?? null) : null;
  return ((cast?.type === "cast") && isScroll(cast.item)) ? cast : null;
}

/**
 * O8g (§350) : le sort que lit cette activité d'un parchemin `{ identifier, level }`, ou null — un parchemin à activité « cast » (fait
 * depuis un compendium : l'activité vise le vrai sort) comme un parchemin à activités recopiées (`scrollSpellOf`).
 */
export function scrollReadOf(activity) {
  const item = activity?.item;
  if ( !isScroll(item) ) return null;
  if ( activity.type !== "cast" ) return scrollSpellOf(item);
  const spell = fromUuidSync(activity.spell?.uuid ?? "", { strict: false });
  const flags = item.flags ?? {};
  const byName = scrollSpell({ stamped: flags[MODULE_ID]?.scroll ?? null, known, level: Number(flags.dnd5e?.spellLevel?.value ?? NaN),
    candidates: scrollCandidates({ name: item.name, originalNames: [flags.babele?.originalName].filter(Boolean) }) });
  const identifier = spell?.system?.identifier || byName?.identifier || null;
  const level = Number(activity.spell?.level ?? spell?.system?.level ?? byName?.level);
  return identifier ? { identifier, level: Number.isFinite(level) ? level : 0 } : null;
}

/**
 * O8g (§350) : ce qu'un personnage peut faire de ce parchemin (`scrollAccess`) — la liste de sorts de ses classes et sous-classes
 * (registre de dnd5e `dnd5e.registry.spellLists`), Utilisation d'objets magiques, son plus haut emplacement ; la caractéristique du
 * test : celle de la classe dont la liste porte le sort, sinon l'Intelligence (Arcanes). Null : pas un parchemin, pas un personnage,
 * ou registre pas prêt (rien n'est imposé).
 */
export function scrollReadingFor(activity, actor) {
  activity = scrollActivityOf(activity);
  const read = scrollReadOf(activity);
  const registry = globalThis.dnd5e?.registry?.spellLists;
  if ( !read || (actor?.type !== "character") || !registry?.ready ) return null;
  const owners = [...Object.entries(actor.classes ?? {}).map(([id, cls]) => ({ cls, list: registry.forType("class", id) })),
    ...Object.entries(actor.subclasses ?? {}).map(([id, sub]) => ({ cls: sub.class ?? null, list: registry.forType("subclass", id) }))];
  const owner = owners.find(o => o.list?.identifiers?.has?.(read.identifier)) ?? null;
  const anyScroll = Array.from(actor.items ?? []).some(i => identifierOf(i).id === "use-magic-device");
  const access = scrollAccess({ level: read.level, onList: !!owner, anyScroll, maxLevel: highestSlotLevel(actor.system?.spells) });
  const ability = (access.via === "class")
    ? (owner?.cls?.system?.spellcasting?.ability || actor.system?.attributes?.spellcasting || "int") : "int";
  return { ...read, ...access, ability, skill: (access.via === "device") ? "arc" : null };
}
