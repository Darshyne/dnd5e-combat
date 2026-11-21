import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("Petite hutte (SRD 5.2) : les sorts de niveau 3 ou moins n'y entrent pas", () => {
  const entry = CONTENT["tiny-hut"];
  it("le globe du Globe d'invulnérabilité, au niveau 3, dans l'Émanation de 3 m", () => {
    expect(entry.globe).toEqual({ radius: 10, units: "ft", maxLevel: 3 });
    expect(CONTENT["globe-of-invulnerability"].globe.maxLevel).toBe(5);
  });
  it("tenu par une marque sur le lanceur : créée, reliée à l'activité, posée sur soi", () => {
    expect(entry.ranges).toEqual({ dnd5eactivity000: { units: "self" } });
    const plan = dataFixPlan({ effects: [], system: { activities: { dnd5eactivity000: { effects: [] } } } }, entry.dataFixes);
    expect(plan.create[0]).toMatchObject({ _id: "dasTinyHut000000", name: "Tiny Hut", duration: { value: 8, units: "hours" } });
    expect(plan.item).toEqual({ "system.activities.dnd5eactivity000.effects": [{ _id: "dasTinyHut000000" }] });
  });
  it("l'entrée est valide", () => {
    expect(validateEntry(entry)).toEqual([]);
  });
});
