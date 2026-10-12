/**
 * §162 : les murs d'une zone de sort (adapter/walls.mjs) naissent avec elle, la suivent quand elle bouge, et partent avec elle. MJ actif.
 */

import { wallRuleOf, wallDataFor, zoneWallsOf } from "../adapter/walls.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { enqueue } from "./queue.mjs";

async function raise(region) {
  const rule = wallRuleOf(region);
  if ( !rule ) return;
  const data = wallDataFor(region, rule);
  if ( !data.length ) return;
  await region.parent.createEmbeddedDocuments("Wall", data);
  log(`area "${region.name}": ${data.length} wall(s) raised`);
}

async function lower(region) {
  const ids = zoneWallsOf(region).map(w => w.id);
  if ( ids.length ) await region.parent.deleteEmbeddedDocuments("Wall", ids);
}

/** Murs posés de nouveau, à la file par région : la création et un redessin aussitôt après (l'anneau du §169) ne se croisent pas. */
const redraw = region => enqueue(`walls:${region.id}`, async () => {
  await lower(region);
  if ( region.parent?.regions.has(region.id) ) await raise(region);
});

export function registerWalls() {
  route("createRegion", region => (wallRuleOf(region) ? redraw(region) : null), { executor: true, label: "area: walls not raised" });
  route("updateRegion", (region, changes) => ((("shapes" in changes) && wallRuleOf(region)) ? redraw(region) : null),
    { executor: true, label: "area: walls not moved" });
  route("deleteRegion", region => enqueue(`walls:${region.id}`, () => lower(region)), { executor: true, label: "area: walls not removed" });
}
