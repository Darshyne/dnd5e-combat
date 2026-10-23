/**
 * Le contenu livré avec le module, en une table par identifiant dnd5e (core/content.mjs pour le
 * schéma, SPEC §13.4 pour la surcouche). Mettre à jour ce dossier met à jour tous les acteurs
 * du monde, PJ et PNJ, sans rien écrire sur leurs fiches.
 *
 * Un autre module peut ajouter sa propre table (créatures d'une campagne, options d'un supplément) : `registerTable(source,
 * table)`, appelée par l'API publique `api.content.register` ou le hook `dnd5e-combat.registerContent` (runtime/content.mjs).
 * Chaque table enregistrée est fusionnée par-dessus le contenu livré, entrée par entrée (`mergeEntries`), dans l'ordre des
 * enregistrements. `SHIPPED` reste le contenu livré seul ; `CONTENT` est le contenu en vigueur, que tout le moteur lit.
 */

import { TRIGGERS } from "./triggers.mjs";
import { AURAS } from "./auras.mjs";
import { EMANATIONS, REGENERATIONS, FORTITUDES, MONSTER_BASIC_ACTIONS, NO_OPPORTUNITY, DRAINS, SWALLOWS, SPACE_SHARERS } from "./emanations.mjs";
import { CHOICES } from "./choices.mjs";
import { TARGETS, EFFECT_EXPIRIES, USAGE_LIMITS, ENCHANT_TARGETS, PACTS } from "./targets.mjs";
import { TRACES, TRACE_RULES } from "./traces.mjs";
import { TELEPORTS } from "./teleports.mjs";
import { ABSORBS } from "./absorbs.mjs";
import { SUMMONS, PLACES_SUMMONS } from "./summons.mjs";
import { MOVABLES } from "./movables.mjs";
import { LIGHTS, REVEALS_INVISIBLE } from "./lights.mjs";
import { TETHERS } from "./tethers.mjs";
import { DAMAGE_SHIELDS, HIT_DICE_HEALS } from "./defenses.mjs";
import { BREAKS_ON, NO_REACTIONS, ACTION_OR_BONUS, CURES, FIGHTING_ADVANTAGE, SAVED_EFFECTS, SIZE_CHANGES, ORDER_LISTS, FLEE_ON_FAILED_SAVE } from "./spells.mjs";
import { RAVENLOFT } from "./ravenloft.mjs";
import { ROGUE } from "./rogue.mjs";
import { FIGHTER } from "./fighter.mjs";
import { BARBARIAN } from "./barbarian.mjs";
import { CANTRIPS } from "./cantrips.mjs";
import { MONK } from "./monk.mjs";
import { PALADIN } from "./paladin.mjs";
import { RANGER } from "./ranger.mjs";
import { CLERIC } from "./cleric.mjs";
import { WIZARD } from "./wizard.mjs";
import { WARLOCK } from "./warlock.mjs";
import { DRUID } from "./druid.mjs";
import { SPECIES } from "./species.mjs";
import { FEATS } from "./feats.mjs";
import { SORCERER } from "./sorcerer.mjs";
import { BARD } from "./bard.mjs";
import { SPELL_RULES } from "./spell-rules.mjs";
import { GEAR } from "./gear.mjs";
import { mergeEntries } from "../core/content.mjs";
import { BURSTS, RECASTS, TURN_STARTS, BOLTS, OBSCURES, HEAL_MAX, DUPLICATES, SAVE_ADVANTAGES, ON_FELL, BONUS_ATTACKS, REACTIVE_SPELLS, PROJECTILES, LEAPS } from "./bursts.mjs";

/**
 * Les tables « par brique » : une table (`identifiant → valeur`, ou une liste d'identifiants : la valeur `true`) et la clé d'entrée
 * qu'elle remplit, dans l'ordre où elles s'écrivent. Clé `null` : la valeur est un morceau d'entrée, recopié tel quel (liens).
 */
export const BRICKS = Object.freeze([
  [TRIGGERS, "triggers"], [AURAS, "aura"], [EMANATIONS, "emanation"], [REGENERATIONS, "regeneration"],
  [FORTITUDES, "fortitude"], [MONSTER_BASIC_ACTIONS, "basicActions"], [NO_OPPORTUNITY, "noOpportunity"], [DRAINS, "drain"],
  [SWALLOWS, "swallow"], [SPACE_SHARERS, "sharesSpace"], [PLACES_SUMMONS, "placesSummons"], [CHOICES, "choice"],
  [TARGETS, "targets"], [EFFECT_EXPIRIES, "effectsExpire"], [USAGE_LIMITS, "usageLimits"],
  [ENCHANT_TARGETS, "enchantTarget"], [PACTS, "pact"], [TRACES, "trace"], [TRACE_RULES, "trace"], [TELEPORTS, "teleport"],
  [ABSORBS, "absorb"], [SUMMONS, "summon"], [MOVABLES, "movable"], [BURSTS, "burst"], [RECASTS, "recast"], [BOLTS, "bolt"],
  [OBSCURES, "obscures"], [LIGHTS, "light"], [REVEALS_INVISIBLE, "revealsInvisible"], [HEAL_MAX, "healMax"],
  [DUPLICATES, "duplicates"], [SAVE_ADVANTAGES, "saveAdvantage"], [ON_FELL, "onFell"], [REACTIVE_SPELLS, "reactiveSpell"],
  [PROJECTILES, "projectiles"], [LEAPS, "leap"], [BONUS_ATTACKS, "bonusAttack"], [TURN_STARTS, "atTurnStart"],
  [TETHERS, null], [DAMAGE_SHIELDS, "damageShield"], [HIT_DICE_HEALS, "hitDiceHeal"], [BREAKS_ON, "breaksOn"],
  [NO_REACTIONS, "noReactions"], [ACTION_OR_BONUS, "actionOrBonus"], [CURES, "cures"],
  [FIGHTING_ADVANTAGE, "advantageIfFighting"], [SAVED_EFFECTS, "savedEffects"], [SIZE_CHANGES, "resize"],
  [ORDER_LISTS, "orders"]
].map(Object.freeze));

/**
 * Les tables d'entrées complètes, fusionnées par-dessus les briques dans cet ordre (`mergeEntries`) : la fuite par la Réaction
 * (§147), les options de Ravenloft (§19.9), les classes et espèces du Manuel des joueurs (§20), les dons (§129), les sorts à
 * règles multiples (§37), les objets (§49).
 */
export const ENTRY_TABLES = Object.freeze([
  FLEE_ON_FAILED_SAVE, RAVENLOFT, ROGUE, FIGHTER, BARBARIAN, CANTRIPS, MONK, PALADIN, RANGER, CLERIC, WIZARD, WARLOCK,
  DRUID, SPECIES, FEATS, SORCERER, BARD, SPELL_RULES, GEAR
]);

/**
 * Relevé des trous (2026-10-22) : les sorts que le SRD 2024 de dnd5e renomme (sans le nom du mage) gardent l'id de document et les ids
 * d'activité et d'effet du Manuel des joueurs (vérifié dans `packs/spells24`), mais pas son identifiant. Sans le Manuel premium, ces
 * sorts n'avaient aucune règle. Identifiant du SRD → identifiant du Manuel ; une entrée propre au SRD, s'il y en a une, l'emporte.
 * (La Main de Bigby, `arcane-hand`, a la sienne : content/summons.mjs.)
 */
export const SRD_ALIASES = Object.freeze({
  "black-tentacles": "evards-black-tentacles", "acid-arrow": "melfs-acid-arrow", "resilient-sphere": "otilukes-resilient-sphere",
  "arcane-sword": "mordenkainens-sword", "faithful-hound": "mordenkainens-faithful-hound",
  "magnificent-mansion": "mordenkainens-magnificent-mansion"
});

function build() {
  const table = {};
  for ( const [source, key] of BRICKS ) {
    if ( Array.isArray(source) ) { for ( const id of source ) (table[id] ??= {})[key] = true; }
    else for ( const [id, value] of Object.entries(source) ) {
      if ( key ) (table[id] ??= {})[key] = value;
      else Object.assign((table[id] ??= {}), value);
    }
  }
  for ( const source of ENTRY_TABLES ) {
    for ( const [id, entry] of Object.entries(source) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  }
  for ( const [srd, phb] of Object.entries(SRD_ALIASES) ) if ( table[phb] && !table[srd] ) table[srd] = table[phb];
  return Object.freeze(table);
}

/** Le contenu livré avec le moteur, seul. */
export const SHIPPED = build();

/** Le contenu en vigueur : le contenu livré, plus les tables enregistrées. Même objet pour toute la session (lu par référence). */
export const CONTENT = { ...SHIPPED };

/** Les tables enregistrées par d'autres modules : `source` (id du module) → table `{ identifiant: entrée }`, dans l'ordre. */
const REGISTERED = new Map();

/** Recompose `CONTENT` sur place : le contenu livré, puis chaque table enregistrée fusionnée par-dessus. */
function rebuild() {
  for ( const id of Object.keys(CONTENT) ) delete CONTENT[id];
  Object.assign(CONTENT, SHIPPED);
  for ( const table of REGISTERED.values() ) {
    for ( const [id, entry] of Object.entries(table) ) CONTENT[id] = mergeEntries([CONTENT[id] ?? null, entry]);
  }
}

/**
 * Enregistre (ou remplace) la table d'un module. Ne valide rien : runtime/content.mjs ne passe ici que des entrées valides.
 * @param {string} source  L'id du module qui l'apporte.
 * @param {Record<string, object>} table  `{ identifiant dnd5e: entrée }`.
 * @returns {string[]}  Les identifiants enregistrés.
 */
export function registerTable(source, table) {
  REGISTERED.set(source, Object.freeze({ ...table }));
  rebuild();
  return Object.keys(table);
}

/** Retire la table d'un module. @returns {boolean} Si elle était enregistrée. */
export function unregisterTable(source) {
  const had = REGISTERED.delete(source);
  if ( had ) rebuild();
  return had;
}

/** Ce qui est enregistré : `{ source: [identifiants] }`. */
export function registeredTables() {
  return Object.fromEntries(Array.from(REGISTERED, ([source, table]) => [source, Object.keys(table)]));
}
