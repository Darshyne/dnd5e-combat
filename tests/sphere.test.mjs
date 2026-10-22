import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("Sphère résiliente d'Otiluke (§232)", () => {
  it("encloses et willingFails : vrais ou absents, gardés par la fusion des couches", () => {
    expect(validateEntry({ encloses: true, willingFails: true })).toEqual([]);
    expect(validateEntry({ encloses: 1 }).length).toBe(1);
    expect(validateEntry({ willingFails: "oui" }).length).toBe(1);
    expect(mergeEntries([{ encloses: true }, { willingFails: true }])).toEqual({ encloses: true, willingFails: true });
  });
  it("le sort livré les déclare", () => {
    expect(CONTENT["otilukes-resilient-sphere"]).toMatchObject({ encloses: true, willingFails: true });
  });
});
