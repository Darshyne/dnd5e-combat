import { describe, it, expect } from "vitest";
import { fleeGaps } from "../module/scripts/core/flee.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

describe("§147 : Murmures dissonants, la fuite", () => {
  it("du plus loin que la Vitesse permet au plus près, jamais l'écart actuel", () => {
    expect(fleeGaps(0, 6)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(fleeGaps(2, 3)).toEqual([5, 4, 3]);
    expect(fleeGaps(1, 0)).toEqual([]);
  });
  it("la déclaration est livrée et valide", () => {
    expect(SHIPPED["dissonant-whispers"].fleeOnFailedSave).toBe(true);
    expect(validateEntry(SHIPPED["dissonant-whispers"])).toEqual([]);
    expect(validateEntry({ fleeOnFailedSave: "oui" }).length).toBeGreaterThan(0);
  });
});
