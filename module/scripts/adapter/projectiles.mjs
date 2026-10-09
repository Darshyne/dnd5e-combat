/**
 * Projectiles (SPEC §16.27, clé `projectiles`) : combien un lancement en crée, d'après la formule du contenu évaluée sur les
 * données de l'activité mise à l'échelle (niveau de l'emplacement : `@item.level` ; niveau du personnage : `@details.level`),
 * et la question de répartition posée à l'auteur.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { rollerFor } from "./concentration.mjs";
import { combatWindowSeconds } from "./dialogs.mjs";

export const ALLOCATION_QUERY = `${MODULE_ID}.allocation`;
const ALLOCATION_TIMEOUT = 45000;

/** La règle de projectiles d'un item, ou null. */
export function projectilesOf(item) {
  return item ? (contentOf(item).entry?.projectiles ?? null) : null;
}

/** Une formule du contenu évaluée sur les données de l'activité mise à l'échelle ; `fallback` si elle échoue. */
export function evalRuleFormula(formula, activity, fallback=0) {
  try { return Math.floor(Roll.safeEval(Roll.replaceFormulaData(formula, activity?.getRollData?.() ?? {}, { missing: 0 }))); }
  catch { return fallback; }
}

/** La règle de rebond d'un item (Orbe chromatique), ou null. */
export function leapOf(item) {
  return item ? (contentOf(item).entry?.leap ?? null) : null;
}

/** Un double parmi les dés de la première part d'un message de dégâts (les d8 de l'orbe) ? */
export function rolledDouble(damageMessage) {
  const faces = (damageMessage?.rolls?.[0]?.dice?.[0]?.results ?? []).filter(r => r.active !== false).map(r => r.result);
  return new Set(faces).size < faces.length;
}

/**
 * Le nombre de projectiles de ce lancement (au moins 1). `level` : le niveau d'emplacement choisi, quand l'activité n'est pas
 * encore mise à l'échelle (visée multiple, avant le lancement) ; sinon celui de l'item.
 */
export function projectileCount(activity, { level=null }={}) {
  const rule = projectilesOf(activity?.item);
  if ( !rule ) return 1;
  try {
    const data = activity.getRollData?.() ?? {};
    if ( level !== null ) data.item = { ...(data.item ?? {}), level };
    const formula = Roll.replaceFormulaData(rule.count, data, { missing: 0 });
    return Math.max(1, Math.floor(Roll.safeEval(formula)));
  } catch { return 1; }
}

/**
 * Le nombre de créatures qu'une activité vise (§16.33 : Bénédiction « 2 + @item.level », Prière de guérison « 5 », Immobilisation
 * de personne « @item.level - 1 »), au niveau d'emplacement `level` s'il est donné. dnd5e évalue la formule à la
 * préparation, au niveau de base de l'item (data/shared/target-field.mjs:131-136) : pour un sort surclassé, on relit la formule
 * d'origine (celle de l'activité si elle remplace la cible de l'item, sinon celle de l'item). Au moins 1.
 */
export function targetCount(activity, { level=null }={}) {
  const prepared = Number(activity?.target?.affects?.count) || 1;
  const formula = activity?.target?.override ? activity?._source?.target?.affects?.count
    : activity?.item?._source?.system?.target?.affects?.count;
  if ( (level === null) || !formula || !/@/.test(String(formula)) ) return Math.max(1, prepared);
  try {
    const data = activity.getRollData?.() ?? {};
    data.item = { ...(data.item ?? {}), level };
    return Math.max(1, Math.floor(Roll.safeEval(Roll.replaceFormulaData(String(formula), data, { missing: 0 }))));
  } catch { return Math.max(1, prepared); }
}

/**
 * Côté de l'auteur : une fenêtre, un champ par cible, la somme à atteindre. Sans réponse dans le délai (le double du délai des
 * fenêtres de combat : il y a des nombres à saisir) : un chacun, le reste au premier (le cœur remet d'aplomb).
 * @param {{item: string, count: number, targets: Array<{token: string, name: string}>}} payload
 * @returns {Promise<{counts: Object<string, number>}|null>}
 */
export async function handleAllocationQuery({ item, count, targets }) {
  const rows = targets.map((t, i) => `<div class="form-group"><label>${foundry.utils.escapeHTML(t.name)}</label>
    <input type="number" name="t${i}" min="0" max="${count}" step="1" value="${i === 0 ? count - targets.length + 1 : 1}"></div>`).join("");
  let timer = null;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("DND5ECOMBAT.Repartition.Titre", { item }) },
    content: `<p>${game.i18n.format("DND5ECOMBAT.Repartition.Texte", { count })}</p>${rows}`,
    rejectClose: false,
    buttons: [{ action: "ok", label: game.i18n.localize("DND5ECOMBAT.Repartition.Valider"), default: true,
      callback: (event, button) => Object.fromEntries(targets.map((t, i) => [t.token, Number(button.form.elements[`t${i}`]?.value) || 0])) }],
    render: (event, dialog) => { timer ??= setTimeout(() => dialog.close(), combatWindowSeconds() * 2000); },
    close: () => { clearTimeout(timer); return null; }
  });
  clearTimeout(timer);
  return (result && typeof result === "object") ? { counts: result } : null;
}

/** Sur le MJ actif : demande à l'auteur (son joueur, sinon le MJ lui-même). Ne lève jamais. */
export async function askAllocation(actor, payload) {
  const userId = rollerFor(actor);
  try {
    if ( userId ) return await game.users.get(userId).query(ALLOCATION_QUERY, payload, { timeout: ALLOCATION_TIMEOUT });
    return await handleAllocationQuery(payload);
  } catch(err) {
    console.warn(`${MODULE_ID} | projectile distribution for ${actor?.name}: no answer`, err);
    return null;
  }
}
