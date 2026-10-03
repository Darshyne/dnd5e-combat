/**
 * Une zone « sur soi » se pose d'office sur le lanceur (SPEC §47), sans fenêtre ni clic.
 *
 *  - `dnd5e.preUseActivity` : dnd5e prévoit la pose (`create.measuredTemplate`, documents/activity/mixin.mjs:451), et cette
 *    seule case suffit à ouvrir sa fenêtre d'utilisation (`_requiresConfigurationDialog`, mixin.mjs:688-694 : « Placer le
 *    gabarit »). On la décoche et on la masque (`display.create`, applications/activity/activity-usage-dialog.mjs:329) : la
 *    fenêtre ne s'ouvre plus que s'il y a autre chose à y choisir (emplacement, concentration…).
 *  - `dnd5e.postUseActivity` : l'utilisation faite, la région est créée par le moteur (adapter/self-area.mjs), là où dnd5e
 *    l'aurait posée dans `_finalizeUsage` (mixin.mjs:832) — après la carte, comme lui.
 *  - `dnd5e.preCreateMeasuredTemplate` (Hooks.call, canvas/template-placement.mjs:115) : le bouton « Placer la zone » de la
 *    carte passe encore par la pose interactive ; on la refuse et l'on crée la région nous-mêmes.
 * Ces hooks sont synchrones : la création part en arrière-plan — dnd5e ne lit rien de la zone après (`results.templates`), la
 * résolution suit `createRegion`.
 *
 * Sur le client de celui qui utilise l'activité, joueur compris.
 *
 * §59 : un cône ou une ligne de portée personnelle se vise autour du lanceur (la visée est dans ui/pointer.mjs, avant la
 * légalité) ; le clic relance l'utilisation par `castAimed`, la forme visée dans `usageConfig["dnd5e-combat"].aimed`, sans la
 * case « Placer le gabarit » ; la région est créée ici à `dnd5e.postUseActivity`, comme la zone sur soi.
 */

import { MODULE_ID } from "../constants.mjs";
import { selfAreaOf, placeSelfArea, aimedAreaOf, placeAimedArea } from "../adapter/self-area.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

function place(activity, area) {
  placeSelfArea(activity, area).then(created => {
    if ( created?.length ) log(`${activity.item?.name ?? activity.name} : zone posée sur ${area.token.name} (${area.shape})`);
  }, err => {
    console.error(`${MODULE_ID} | zone sur soi non posée`, err);
    ui.notifications.warn("DND5ECOMBAT.ZoneSurSoiNonPosee", { localize: true });
  });
}

function onPreUse(activity, usageConfig, dialogConfig) {
  if ( usageConfig?.create?.measuredTemplate !== true || !selfAreaOf(activity) ) return;
  usageConfig.create.measuredTemplate = false;
  (usageConfig[MODULE_ID] ??= {}).selfArea = true;
  if ( dialogConfig ) {
    dialogConfig.options ??= {};
    dialogConfig.options.display = foundry.utils.mergeObject(dialogConfig.options.display ?? {}, { create: false }, { inplace: false });
  }
}

/**
 * §59 : intention « lancer vers cette direction » — la forme visée (ui/pointer.mjs) ; l'utilisation repart sans la case
 * « Placer le gabarit » et sans fenêtre (le niveau a été choisi avant la visée), la zone est posée à `postUseActivity`.
 * @param {Activity} activity
 * @param {[object, object, object]} usage  Configurations d'utilisation, de dialogue et de message reçues.
 * @param {object} shapeData                La forme visée (`aimedShapeData`).
 * @returns {Promise<boolean>}  true si l'activité a été lancée.
 */
export async function castAimed(activity, [config, dialog, message]=[], shapeData) {
  const use = { ...(config ?? {}), create: { ...(config?.create ?? {}), measuredTemplate: false },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), aimed: shapeData } };
  return !!(await activity.use(use, { ...(dialog ?? {}), configure: false }, message));
}

/**
 * §59 : intention « poser la zone visée » sans relancer l'activité (bouton « Placer la zone » de la carte).
 * @param {Activity} activity
 * @param {object} shapeData
 */
export function placeAimed(activity, shapeData) {
  const area = aimedAreaOf(activity);
  if ( area ) placeAimedShape(activity, area, shapeData);
}

function placeAimedShape(activity, area, shapeData) {
  placeAimedArea(activity, area, shapeData).then(created => {
    if ( created?.length ) log(`${activity.item?.name ?? activity.name} : ${area.shape} visé depuis ${area.token.name} (${Math.round(shapeData.rotation)}°)`);
  }, err => {
    console.error(`${MODULE_ID} | zone visée non posée`, err);
    ui.notifications.warn("DND5ECOMBAT.ZoneSurSoiNonPosee", { localize: true });
  });
}

function onPostUse(activity, usageConfig, results) {
  const aimed = usageConfig?.[MODULE_ID]?.aimed;
  if ( aimed ) {
    const area = results ? aimedAreaOf(activity) : null;
    if ( area ) placeAimedShape(activity, area, aimed);
    return;
  }
  if ( !usageConfig?.[MODULE_ID]?.selfArea ) return;
  const area = selfAreaOf(activity);
  if ( area ) place(activity, area);
}

function onPreTemplate(activity) {
  const area = selfAreaOf(activity);
  if ( !area ) return;
  place(activity, area);
  return false;
}

export function registerSelfAreas() {
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "zone sur soi : sans case « Placer le gabarit »" });
  route("dnd5e.postUseActivity", onPostUse, { label: "zone sur soi : pose d'office" });
  route("dnd5e.preCreateMeasuredTemplate", onPreTemplate, { cancellable: true, label: "zone sur soi : pose d'office (carte)" });
}
