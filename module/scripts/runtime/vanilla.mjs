/**
 * §395 : « Lancer sans DAS » — une utilisation passe par dnd5e seul, et tout ce qui en découle jusqu'à sa fin (décision de
 * l'utilisateur, 2026-11-07 : zone qui dure, concentration, effets, cartes, jets). MJ et joueurs, par le menu du clic droit d'un objet
 * de la fiche (ui/item-menu.mjs) ou d'une case de la barre d'une interface voisine (`api.vanilla.use`).
 *
 * Le routeur saute toutes les inscriptions non `always` d'un hook dont les arguments viennent d'une telle action
 * (adapter/vanilla-state.mjs, `concernsVanilla`). Ce fichier pose le marqueur là où dnd5e ne garde pas de lien vers la carte :
 *  - la configuration d'utilisation porte `{ "dnd5e-combat": { vanilla: true } }` (posée par `useWithoutDas`) ; au
 *    `dnd5e.preUseActivity`, la carte d'utilisation reçoit le drapeau (`messageConfig.data.flags`) et l'activité est notée sur ce client ;
 *  - l'effet de concentration (`dnd5e.preBeginConcentrating`, actor.mjs:1104 : les données de l'effet), la zone posée
 *    (`preCreateRegion` / `preCreateMeasuredTemplate` : `flags.dnd5e.activity`, `origin`, `item`) et la créature invoquée
 *    (`dnd5e.preSummonToken`, summon.mjs:178 : les données du token) reçoivent le drapeau tant que l'activité est notée.
 * Ces inscriptions sont `always` (elles marquent même quand la suite du hook se tait) et `marks` (les suivantes relisent l'état).
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { markPending, clearPending, isPending, isVanilla } from "../adapter/vanilla-state.mjs";

const FLAG = `flags.${MODULE_ID}.vanilla`;

/**
 * Utilise un objet ou une activité par dnd5e seul (§395). Un objet à plusieurs activités ouvre le choix de dnd5e.
 * @param {Item|object} subject  Item5e ou activité.
 * @param {object} [options]
 * @param {Event} [options.event]  L'évènement d'origine (Alt / Ctrl lus par dnd5e : avantage / désavantage).
 */
export async function useWithoutDas(subject, { event=null }={}) {
  if ( !subject?.use ) return null;
  log(`${subject.name ?? subject.item?.name}: used without DAS (dnd5e alone)`);
  return subject.use({ event, [MODULE_ID]: { vanilla: true } }, {}, { data: { flags: { [MODULE_ID]: { vanilla: true } } } });
}

function onPreUse(activity, usageConfig, _dialogConfig, messageConfig) {
  const uuids = [activity?.uuid, activity?.item?.uuid];
  if ( !usageConfig?.[MODULE_ID]?.vanilla ) { clearPending(uuids); return; }
  markPending(uuids);
  if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.${FLAG}`, true);
}

function onPreConcentrate(_actor, _item, effectData, activity) {
  if ( effectData && isPending(activity?.uuid) ) foundry.utils.setProperty(effectData, FLAG, true);
}

/** Une zone ou un gabarit créés par ce client pour une activité lancée sans DAS. */
function onPreCreatePlaced(doc, _data, _options, userId) {
  if ( userId !== game.user.id ) return;
  const f = doc.flags?.dnd5e ?? {};
  if ( [f.activity, f.origin, f.item].some(u => isPending(u)) ) doc.updateSource({ [FLAG]: true });
}

function onPreSummonToken(activity, _profile, tokenData) {
  if ( tokenData && isPending(activity?.uuid) ) foundry.utils.setProperty(tokenData, FLAG, true);
}

export const vanillaApi = Object.freeze({ use: useWithoutDas, is: isVanilla });

export function registerVanilla() {
  const opts = label => ({ always: true, marks: true, label: `without DAS: ${label}` });
  route("dnd5e.preUseActivity", onPreUse, opts("usage not marked"));
  route("dnd5e.preBeginConcentrating", onPreConcentrate, opts("concentration not marked"));
  route("preCreateRegion", onPreCreatePlaced, opts("region not marked"));
  route("preCreateMeasuredTemplate", onPreCreatePlaced, opts("template not marked"));
  route("dnd5e.preSummonToken", onPreSummonToken, opts("summon not marked"));
}
