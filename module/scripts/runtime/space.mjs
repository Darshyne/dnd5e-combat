/**
 * L'espace en trois dimensions en marche (SPEC §14.2, P2) : le réglage de monde « Élévation et
 * volumes », l'auto-contrôle de l'API du cœur à `ready`, et la tranche d'élévation donnée aux
 * zones de sort **à la pose**, dans les données de création que dnd5e soumet au hook
 * `dnd5e.createMeasuredTemplate` (canvas/template-placement.mjs:172) — sur le client qui pose le
 * gabarit, joueur compris : la région naît avec sa hauteur, personne n'a à la réécrire.
 *
 * Les distances en 3D (adapter/turn.mjs) ne dépendent d'aucun réglage : sans élévation, rien ne
 * change. Ce réglage tient la tranche des zones et la ligne d'effet à travers les surfaces.
 */

import { MODULE_ID } from "../constants.mjs";
import { checkSpaceApi, setSpaceAvailable, isSpaceAvailable, elevationSliceFor } from "../adapter/space.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const VOLUMES_SETTING = "volumes";

function refresh() {
  setSpaceAvailable(game.settings.get(MODULE_ID, VOLUMES_SETTING) && !checkSpaceApi().length);
}

/** dnd5e va créer les régions d'une activité : on leur donne leur tranche d'élévation. */
function onTemplateData(activity, regionData) {
  if ( !isSpaceAvailable() || !canvas?.scene ) return;
  const originToken = usageTokenOf(activity);
  for ( const data of regionData ) {
    if ( data.elevation && ((data.elevation.bottom ?? null) !== null || (data.elevation.top ?? null) !== null) ) continue;
    const slice = elevationSliceFor(activity, { scene: canvas.scene, originToken, dimensions: data.flags?.dnd5e?.dimensions ?? null });
    if ( !slice ) continue;
    data.elevation = slice;
    log(`area of ${activity.item?.name ?? activity.name}: elevation slice ${slice.bottom} -> ${slice.top} ${canvas.scene.grid.units}`);
  }
}

export function registerSpace() {
  game.settings.register(MODULE_ID, VOLUMES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${VOLUMES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${VOLUMES_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true, onChange: refresh
  });

  route("dnd5e.createMeasuredTemplate", onTemplateData, { label: "area: elevation slice not set" });

  // Piège du cœur 14.368 (vu en jeu le 2026-09-23) : `RegionDocument#segmentizeMovementPath` lit le champ
  // privé `#polygonTree` (client/documents/region.mjs, #testSamples) sans passer par l'accesseur qui le
  // construit ; un changement d'élévation PUR d'un token (sans x/y) plante alors « Cannot read properties
  // of undefined (reading 'testPoint') » tant que rien n'a lu `region.polygonTree`. On le lit pour chaque
  // région de la scène affichée — c'est un cache, pas un patch.
  const warm = () => { for ( const r of canvas?.scene?.regions ?? [] ) r.polygonTree; };
  for ( const hook of ["canvasReady", "createRegion", "updateRegion"] ) route(hook, warm, { label: "regions: polygons not prepared" });

  route("ready", () => {
    const missing = checkSpaceApi();
    if ( missing.length ) {
      console.warn(`${MODULE_ID} | elevation and volumes out of service: core API missing (${missing.join(", ")})`);
      if ( game.user.isGM ) ui.notifications.warn(game.i18n.format("DND5ECOMBAT.VolumesHorsService", { missing: missing.join(", ") }));
    }
    refresh();
    log(`elevation and volumes: ${game.settings.get(MODULE_ID, VOLUMES_SETTING) ? (missing.length ? "out of service" : "in service") : "disabled (setting)"}`);
  }, { label: "space: API check" });
}
