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
import { EMANATIONS, REGENERATIONS, FORTITUDES, NO_OPPORTUNITY, DRAINS, SWALLOWS } from "./emanations.mjs";
import { CHOICES } from "./choices.mjs";
import { TARGETS, EFFECT_EXPIRIES, USAGE_LIMITS, ENCHANT_TARGETS, PACTS } from "./targets.mjs";
import { TRACES, TRACE_RULES } from "./traces.mjs";
import { TELEPORTS } from "./teleports.mjs";
import { ABSORBS } from "./absorbs.mjs";
import { SUMMONS } from "./summons.mjs";
import { MOVABLES } from "./movables.mjs";
import { LIGHTS, REVEALS_INVISIBLE } from "./lights.mjs";
import { TETHERS } from "./tethers.mjs";
import { DAMAGE_SHIELDS, HIT_DICE_HEALS } from "./defenses.mjs";
import { BREAKS_ON, NO_REACTIONS, CURES, FIGHTING_ADVANTAGE, SAVED_EFFECTS, SIZE_CHANGES, ORDER_LISTS } from "./spells.mjs";
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
import { SORCERER } from "./sorcerer.mjs";
import { BARD } from "./bard.mjs";
import { SPELL_RULES } from "./spell-rules.mjs";
import { GEAR } from "./gear.mjs";
import { mergeEntries } from "../core/content.mjs";
import { BURSTS, RECASTS, TURN_STARTS, BOLTS, OBSCURES, HEAL_MAX, DUPLICATES, SAVE_ADVANTAGES, ON_FELL, BONUS_ATTACKS, REACTIVE_SPELLS, PROJECTILES, LEAPS } from "./bursts.mjs";

function build() {
  const table = {};
  for ( const [id, triggers] of Object.entries(TRIGGERS) ) (table[id] ??= {}).triggers = triggers;
  for ( const [id, aura] of Object.entries(AURAS) ) (table[id] ??= {}).aura = aura;
  for ( const [id, emanation] of Object.entries(EMANATIONS) ) (table[id] ??= {}).emanation = emanation;
  for ( const id of REGENERATIONS ) (table[id] ??= {}).regeneration = true;
  for ( const id of FORTITUDES ) (table[id] ??= {}).fortitude = true;
  for ( const [id, kind] of Object.entries(NO_OPPORTUNITY) ) (table[id] ??= {}).noOpportunity = kind;
  for ( const id of DRAINS ) (table[id] ??= {}).drain = true;
  for ( const id of SWALLOWS ) (table[id] ??= {}).swallow = true;
  for ( const [id, choice] of Object.entries(CHOICES) ) (table[id] ??= {}).choice = choice;
  for ( const [id, targets] of Object.entries(TARGETS) ) (table[id] ??= {}).targets = targets;
  for ( const [id, rest] of Object.entries(EFFECT_EXPIRIES) ) (table[id] ??= {}).effectsExpire = rest;
  for ( const [id, limits] of Object.entries(USAGE_LIMITS) ) (table[id] ??= {}).usageLimits = limits;
  for ( const [id, kind] of Object.entries(ENCHANT_TARGETS) ) (table[id] ??= {}).enchantTarget = kind;
  for ( const [id, pact] of Object.entries(PACTS) ) (table[id] ??= {}).pact = pact;
  for ( const id of TRACES ) (table[id] ??= {}).trace = true;
  for ( const [id, rule] of Object.entries(TRACE_RULES) ) (table[id] ??= {}).trace = rule;
  for ( const [id, teleport] of Object.entries(TELEPORTS) ) (table[id] ??= {}).teleport = teleport;
  for ( const [id, absorb] of Object.entries(ABSORBS) ) (table[id] ??= {}).absorb = absorb;
  for ( const [id, summon] of Object.entries(SUMMONS) ) (table[id] ??= {}).summon = summon;
  for ( const [id, movable] of Object.entries(MOVABLES) ) (table[id] ??= {}).movable = movable;
  for ( const [id, burst] of Object.entries(BURSTS) ) (table[id] ??= {}).burst = burst;
  for ( const id of RECASTS ) (table[id] ??= {}).recast = true;
  for ( const [id, bolt] of Object.entries(BOLTS) ) (table[id] ??= {}).bolt = bolt;
  for ( const id of OBSCURES ) (table[id] ??= {}).obscures = true;
  for ( const [id, light] of Object.entries(LIGHTS) ) (table[id] ??= {}).light = light;
  for ( const id of REVEALS_INVISIBLE ) (table[id] ??= {}).revealsInvisible = true;
  for ( const id of HEAL_MAX ) (table[id] ??= {}).healMax = true;
  for ( const id of DUPLICATES ) (table[id] ??= {}).duplicates = true;
  for ( const [id, statuses] of Object.entries(SAVE_ADVANTAGES) ) (table[id] ??= {}).saveAdvantage = statuses;
  for ( const [id, rule] of Object.entries(ON_FELL) ) (table[id] ??= {}).onFell = rule;
  for ( const id of REACTIVE_SPELLS ) (table[id] ??= {}).reactiveSpell = true;
  for ( const [id, rule] of Object.entries(PROJECTILES) ) (table[id] ??= {}).projectiles = rule;
  for ( const [id, rule] of Object.entries(LEAPS) ) (table[id] ??= {}).leap = rule;
  for ( const [id, rule] of Object.entries(BONUS_ATTACKS) ) {
    const entry = (table[id] ??= {});
    entry.bonusAttack = rule;
  }
  for ( const [id, start] of Object.entries(TURN_STARTS) ) (table[id] ??= {}).atTurnStart = start;
  for ( const [id, rules] of Object.entries(TETHERS) ) Object.assign((table[id] ??= {}), rules);
  for ( const [id, rule] of Object.entries(DAMAGE_SHIELDS) ) (table[id] ??= {}).damageShield = rule;
  for ( const [id, rule] of Object.entries(HIT_DICE_HEALS) ) (table[id] ??= {}).hitDiceHeal = rule;
  for ( const [id, moments] of Object.entries(BREAKS_ON) ) (table[id] ??= {}).breaksOn = moments;
  for ( const id of NO_REACTIONS ) (table[id] ??= {}).noReactions = true;
  for ( const [id, statuses] of Object.entries(CURES) ) (table[id] ??= {}).cures = statuses;
  for ( const id of FIGHTING_ADVANTAGE ) (table[id] ??= {}).advantageIfFighting = true;
  for ( const [id, effects] of Object.entries(SAVED_EFFECTS) ) (table[id] ??= {}).savedEffects = effects;
  for ( const [id, rule] of Object.entries(SIZE_CHANGES) ) (table[id] ??= {}).resize = rule;
  for ( const [id, list] of Object.entries(ORDER_LISTS) ) (table[id] ??= {}).orders = list;
  // Options de joueur de Ravenloft (§19.9) : une entrée complète par identifiant, fusionnée par-dessus.
  for ( const [id, entry] of Object.entries(RAVENLOFT) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  // Classes du Manuel des joueurs (§20) : même principe, par-dessus les tables par brique.
  for ( const [id, entry] of Object.entries(ROGUE) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(FIGHTER) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(BARBARIAN) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(CANTRIPS) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(MONK) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(PALADIN) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(RANGER) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(CLERIC) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(WIZARD) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(WARLOCK) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(DRUID) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(SPECIES) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(SORCERER) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  for ( const [id, entry] of Object.entries(BARD) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  // Sorts à règles multiples (§37) : même principe.
  for ( const [id, entry] of Object.entries(SPELL_RULES) ) table[id] = mergeEntries([table[id] ?? null, entry]);
  // Objets du Manuel des joueurs (§49) : même principe.
  for ( const [id, entry] of Object.entries(GEAR) ) table[id] = mergeEntries([table[id] ?? null, entry]);
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
