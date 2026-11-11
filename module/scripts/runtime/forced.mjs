/**
 * §408 (issue #44, lot 1) : une règle passée outre. Règle de l'utilisateur (2026-11-11) : tout refus du moteur ouvre une fenêtre qui dit
 * pourquoi, propose de faire quand même, et c'est **le joueur** qui décide ; s'il force, le MJ et la table sont **prévenus**, rien de plus
 * (aucun accord à demander).
 *  - le MJ : l'alerte §364 (carte chuchotée aux MJ + bandeau), texte `DND5ECOMBAT.Force.Alerte` — réglage de monde `forcedAlerts` ;
 *  - la table : un texte flottant « Forcé » au-dessus du token, vu et entendu de tous (`notice`, sorte `forced`) ;
 *  - la carte : le drapeau `flags.dnd5e-combat.overridden` (les raisons), posé par l'appelant sur la carte d'utilisation ou de jet et
 *    montré par ui/chat.mjs ;
 *  - hook public `dnd5e-combat.forced` `({ actor, item, reasons, targets, user })`, appelé avant tout : un voisin qui rend `false` prend
 *    l'avertissement à sa charge (ni alerte, ni texte flottant).
 * Appelé sur le client de celui qui force, au moment où il choisit.
 */

import { MODULE_ID } from "../constants.mjs";
import { alertGM, gmAlertsOn } from "./gm-alert.mjs";
import { log, loc, notice } from "./shared.mjs";

/**
 * §408 : sur le client de celui qui passe outre un refus du moteur, avant tout avertissement : `({ actor, item, reasons, targets, user })`.
 * Annulable : `false` et le moteur ne prévient personne (ni texte flottant, ni alerte au MJ).
 */
export const FORCED_HOOK = `${MODULE_ID}.forced`;
/** Réglage de monde : prévenir le MJ quand un joueur passe outre (la table voit toujours le texte flottant). */
export const FORCED_ALERTS_SETTING = "forcedAlerts";

function forcedAlertsOn() {
  try { return game.settings.get(MODULE_ID, FORCED_ALERTS_SETTING) !== false; } catch { return true; }
}

/** Le token qui agit pour cet acteur sur la scène affichée (celui de la carte si on l'a), ou null. */
function tokenOf(actor, token=null) {
  if ( token ) return token.document ?? token;
  return actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
}

/**
 * Prévient le MJ et la table qu'une règle a été passée outre.
 * @param {object} forced
 * @param {Actor5e|null} forced.actor         Qui agit.
 * @param {Item5e|string|null} [forced.item]  Ce qui est utilisé (ou son nom).
 * @param {string[]} forced.reasons            Les raisons de la fenêtre, déjà traduites.
 * @param {string[]} [forced.targets]          Les noms des cibles désignées.
 * @param {TokenDocument|Token|null} [forced.token]
 * @returns {Promise<boolean>}  vrai si l'avertissement est parti.
 */
export async function reportForced({ actor, item=null, reasons, targets=[], token=null }) {
  if ( !reasons?.length ) return false;
  const itemName = (typeof item === "string") ? item : (item?.name ?? "");
  if ( Hooks.call(FORCED_HOOK, { actor, item, reasons, targets, user: game.user }) === false ) return false;
  log(`rule overridden by ${game.user.name}: ${itemName || "?"} (${actor?.name ?? "?"}) — ${reasons.join(" | ")}`);
  const where = tokenOf(actor, token);
  if ( where ) notice(where, { key: "Retour.Force" }, "forced", { all: true, action: "overridden", outcome: "success" });
  if ( forcedAlertsOn() && gmAlertsOn() ) {
    // §412 : un geste sans objet (un déplacement, une escalade) — « … pour {actor} : {reasons} », sans « — » vide.
    const key = itemName ? (targets.length ? "Force.AlerteCibles" : "Force.Alerte") : "Force.AlerteSansObjet";
    const text = loc(key, {
      user: game.user.name, item: itemName, actor: actor?.name ?? "", targets: targets.join(", "), reasons: reasons.join(" · ") });
    await alertGM({ text, item: itemName || null, actor });
  }
  return true;
}

/** Les raisons à porter sur la carte (drapeau `overridden`) : une liste courte, telle quelle. */
export function overriddenFlag(reasons) {
  return (reasons ?? []).map(r => String(r)).slice(0, 12);
}

export function registerForced() {
  game.settings.register(MODULE_ID, FORCED_ALERTS_SETTING, { scope: "world", config: true, type: Boolean, default: true,
    name: `DND5ECOMBAT.Reglage.${FORCED_ALERTS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${FORCED_ALERTS_SETTING}.Aide` });
}
