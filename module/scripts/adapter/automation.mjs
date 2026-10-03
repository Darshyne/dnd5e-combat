/**
 * La pastille d'automatisation et les signalements de la table (SPEC §9.2).
 *
 * La pastille lit ce que le moteur sait d'un item par les mêmes chemins que lui : `contentOf` (module < monde < flag),
 * les identifiants qu'il reconnaît en dur (Attaques multiples, Frappe à mains nues, Combat à deux armes, ses actions
 * de base), les variantes d'attaque lues dans le texte (§18.8). Le reste se classe d'après les activités de l'item
 * (core/automation.mjs).
 *
 * Les signalements vivent dans un réglage de monde, jamais sur l'item : le MJ coche en partie ce qui a posé problème,
 * et en fin de partie il en lit le bilan (et Claude aussi, par `api.reports`).
 */

import { MODULE_ID } from "../constants.mjs";
import { automationOf } from "../core/automation.mjs";
import { contentOf } from "./content.mjs";
import { variantPlanOf } from "./variants.mjs";
import { escapeCheckOf, restrainsWith } from "./escape.mjs";

export const REPORTS_SETTING = "itemReports";
const REPORTS_VERSION = 1;

/** Identifiants que le moteur traite en dur, hors du contenu déclaré. */
const KNOWN = new Set(["multiattack", "unarmed-strike", "two-weapon-fighting"]);

/** Types d'item du matériel : sans activité ni effet, ils n'ont rien à jouer (pas « manuel »). */
const GEAR = new Set(["equipment", "loot", "container", "consumable", "tool", "weapon"]);

/** Ce que le moteur fait de cet item. */
export function automationOfItem(item) {
  const { identifier, entry, layers } = contentOf(item);
  const rules = entry ? Object.keys(entry) : [];
  const own = item?.system?.identifier ?? "";
  if ( KNOWN.has(own) || own.startsWith(`${MODULE_ID}-`) ) rules.push(own);
  if ( (item?.actor?.type === "npc") && variantPlanOf(item) ) rules.push("variants");
  if ( restrainsWith(item) && escapeCheckOf(item) ) rules.push("escape");   // §16.54 : S'échapper par le test du texte
  const activities = Array.from(item?.system?.activities?.values?.() ?? []).map(a => ({
    type: a.type, roll: !!a.roll?.formula, effects: a.effects?.length ?? 0
  }));
  // La CA d'une armure ou d'un bouclier, dnd5e la calcule seul (CONFIG.DND5E.armorTypes : léger, moyen, lourd, bouclier).
  const armor = (item?.type === "equipment") && ((item.system.type?.value ?? "") in (CONFIG.DND5E?.armorTypes ?? {}));
  const passiveEffects = (item?.effects ?? []).filter(e => e.transfer && !e.disabled).length + (armor ? 1 : 0);
  const gear = GEAR.has(item?.type);
  return { ...automationOf({ rules, activities, passiveEffects, gear }), identifier, layers };
}

/** Les signalements du monde : `{ uuid de l'item: { actor, actorUuid, item, identifier, note, at } }`. */
export function reports() {
  const stored = game.settings.get(MODULE_ID, REPORTS_SETTING);
  if ( !stored || (stored.v !== REPORTS_VERSION) ) return {};
  return stored.entries ?? {};
}

export const reportOf = item => (item?.uuid ? reports()[item.uuid] ?? null : null);

/** Pose (ou remplace) le signalement d'un item. MJ uniquement (réglage de monde). */
export async function setReport(item, note="") {
  const entries = { ...reports() };
  entries[item.uuid] = { actor: item.actor?.name ?? "", actorUuid: item.actor?.uuid ?? null, item: item.name,
    identifier: contentOf(item).identifier, note: String(note ?? "").trim(), at: Date.now() };
  await game.settings.set(MODULE_ID, REPORTS_SETTING, { v: REPORTS_VERSION, entries });
  return entries[item.uuid];
}

/** Retire un signalement (par uuid d'item), ou tous avec `null`. */
export async function clearReport(uuid) {
  const entries = (uuid === null) ? {} : { ...reports() };
  if ( uuid !== null ) delete entries[uuid];
  await game.settings.set(MODULE_ID, REPORTS_SETTING, { v: REPORTS_VERSION, entries });
}
