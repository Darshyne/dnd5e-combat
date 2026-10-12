/**
 * §162 : les murs d'une zone de sort (adapter/walls.mjs) naissent avec elle, la suivent quand elle bouge, et partent avec elle. MJ actif.
 */

import { wallRuleOf, wallDataFor, zoneWallsOf } from "../adapter/walls.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

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

export function registerWalls() {
  route("createRegion", raise, { executor: true, label: "area: walls not raised" });
  route("updateRegion", async (region, changes) => {
    if ( !("shapes" in changes) || !wallRuleOf(region) ) return;
    await lower(region);
    await raise(region);
  }, { executor: true, label: "area: walls not moved" });
  route("deleteRegion", region => lower(region), { executor: true, label: "area: walls not removed" });
}
