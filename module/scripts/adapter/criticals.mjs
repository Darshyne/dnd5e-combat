/**
 * §207 : deux options de coup critique, toutes deux désactivées par défaut (issue GitHub #5) — des règles maison, pas celles de 2024.
 *  - `critMargin` : un coup qui dépasse la CA de la cible d'au moins cet écart est critique (0 : non ; « CA + 10 »). Jugé dans le
 *    verdict (core/action.mjs, `beatsAcBy`) ; l'écart est lu au jet d'attaque (runtime/engine-messages.mjs).
 *  - `criticalMode` : sur un coup critique, « standard » (les dés doublés de dnd5e, comme sans l'option), « choice » (l'attaquant
 *    choisit, sur son écran, entre le critique standard et la table) ou « table » (toujours la table). La table (`criticalTable` :
 *    uuid ou nom d'une table du monde) est tirée dans le chat, et les dégâts sont alors ceux d'un coup normal ; le MJ applique ce
 *    qu'elle dit. `criticalNpc` : l'option vaut aussi pour les PNJ (sinon, leurs critiques restent standard).
 * Le hook `dnd5e-combat.criticalHit` (`Hooks.callAll`, avant la question) reçoit `{ actor, activity, target, mode }` : un module
 * voisin peut changer `mode` (« standard », « table », ou « plain » : dégâts normaux, l'effet du critique étant à sa charge).
 */
import { MODULE_ID } from "../constants.mjs";
import { timedWait } from "./dialogs.mjs";

export const CRIT_MARGIN_SETTING = "critMargin";
export const CRITICAL_MODE_SETTING = "criticalMode";
export const CRITICAL_TABLE_SETTING = "criticalTable";
export const CRITICAL_NPC_SETTING = "criticalNpc";
export const CRITICAL_MODES = Object.freeze(["standard", "choice", "table"]);
export const CRITICAL_TABLE_QUERY = `${MODULE_ID}.criticalTable`;

const read = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch { return fallback; }
};
const t = (key, data) => (data ? game.i18n.format(`DND5ECOMBAT.CritOption.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.CritOption.${key}`));

/** L'écart du réglage `critMargin` (0 : désactivé). */
export function critMargin() {
  const n = Number(read(CRIT_MARGIN_SETTING, 0));
  return (Number.isFinite(n) && (n > 0)) ? Math.floor(n) : 0;
}

/** La table de critiques du réglage : par uuid, sinon par nom parmi les tables du monde. null si aucune. */
export async function criticalTable() {
  const ref = String(read(CRITICAL_TABLE_SETTING, "") ?? "").trim();
  if ( !ref ) return null;
  const byUuid = ref.includes(".") ? await fromUuid(ref).catch(() => null) : null;
  const table = byUuid ?? game.tables.getName(ref) ?? null;
  return (table?.documentName === "RollTable") ? table : null;
}

/**
 * Le traitement d'un coup critique, sur le client de l'attaquant, avant le jet de dégâts : « standard » (dés doublés), « table »
 * (table tirée, dégâts normaux) ou « plain » (dégâts normaux, un voisin s'en charge). Sans critique : « standard ».
 * @param {Activity} activity
 * @param {TokenDocument|null} target
 * @returns {Promise<"standard"|"table"|"plain">}
 */
export async function criticalChoice(activity, target) {
  const actor = activity?.actor ?? null;
  let mode = read(CRITICAL_MODE_SETTING, "standard");
  if ( !CRITICAL_MODES.includes(mode) ) mode = "standard";
  if ( (actor?.type !== "character") && !read(CRITICAL_NPC_SETTING, false) ) mode = "standard";
  const decision = { actor, activity, target, mode };
  Hooks.callAll(`${MODULE_ID}.criticalHit`, decision);
  mode = decision.mode;
  if ( mode === "plain" ) return "plain";
  if ( (mode === "table") || (mode === "choice") ) {
    if ( !(await criticalTable()) ) {
      if ( game.user.isGM ) ui.notifications.warn(t("SansTable"));
      return "standard";
    }
  }
  if ( mode === "choice" ) {
    const picked = await timedWait({
      window: { title: t("Titre", { name: actor?.name ?? "" }) },
      content: `<p>${t("Question", { name: target?.name ?? "" })}</p>`,
      buttons: [
        { action: "standard", label: t("Standard"), icon: "fa-solid fa-dice", default: true },
        { action: "table", label: t("Table"), icon: "fa-solid fa-table-list" }
      ]
    }, { fallback: "standard" });
    return (picked === "table") ? "table" : "standard";
  }
  return (mode === "table") ? "table" : "standard";
}

/**
 * Tire la table de critiques. Une table de compendium se tire ici ; une table du monde par un MJ (le MJ actif sinon) : sans remise,
 * le cœur marque le résultat tiré (`RollTable#draw`, documents/roll-table.mjs:109), ce qu'un joueur ne peut pas écrire.
 * Rend le texte du résultat, ou null.
 */
export async function drawCriticalTable({ speaker=null }={}) {
  const table = await criticalTable();
  if ( !table ) return null;
  if ( table.pack || game.user.isGM ) return drawHere(table, speaker);
  const gm = game.users.activeGM;
  if ( !gm ) return null;
  return gm.query(CRITICAL_TABLE_QUERY, { speaker }, { timeout: 15000 }).catch(() => null);
}

/** Le tirage, dans le chat, au nom de l'attaquant. */
export async function drawHere(table=null, speaker=null) {
  table ??= await criticalTable();
  if ( !table ) return null;
  const draw = await table.draw({ displayChat: false });
  const results = draw?.results ?? [];
  if ( draw?.roll ) {
    await table.toMessage(results, { roll: draw.roll, messageData: { speaker: speaker ?? ChatMessage.implementation.getSpeaker(),
      flavor: t("Tirage", { table: table.name }), flags: { [MODULE_ID]: { criticalTable: true } } } });
  }
  return results.map(r => r.name || r.description || r.text || "").filter(Boolean).join(" ; ") || null;
}
