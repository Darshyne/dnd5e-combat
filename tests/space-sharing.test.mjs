/** §105 : partager la case d'une autre créature. */
import { describe, it, expect } from "vitest";
import { mayShareSpace, widerShare } from "../module/scripts/core/space-sharing.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("partage de case (§105)", () => {
  it("entrer dans la case d'une créature, ou l'inverse pour une nuée", () => {
    expect(mayShareSpace("enter", null)).toBe(true);
    expect(mayShareSpace("mutual", null)).toBe(true);
    expect(mayShareSpace(null, "mutual")).toBe(true);    // « and vice versa »
    expect(mayShareSpace(null, "enter")).toBe(false);    // une Forme d'air ne s'ouvre pas aux autres
    expect(mayShareSpace(null, null)).toBe(false);
  });

  it("la plus large l'emporte", () => {
    expect(widerShare(null, "enter")).toBe("enter");
    expect(widerShare("mutual", "enter")).toBe("mutual");
    expect(widerShare("enter", null)).toBe("enter");
  });

  it("contenu livré", () => {
    expect(CONTENT["air-form"].sharesSpace).toBe("enter");
    expect(CONTENT.swarm.sharesSpace).toBe("mutual");
    for ( const id of ["air-form", "fire-form", "water-form", "gaseous-form", "swarm", "misty-form"] ) {
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    expect(validateEntry({ sharesSpace: true })).toHaveLength(1);
  });
});
