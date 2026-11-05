/** §364 : alerte MJ — la clé de contenu `gmAlert`. */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import fs from "node:fs";

const en = JSON.parse(fs.readFileSync(new URL("../module/lang/en.json", import.meta.url), "utf8"));

describe("§364 : gmAlert", () => {
  it("accepte une clé, un texte, des activités, une liste", () => {
    expect(validateEntry({ gmAlert: { key: "Titan" } })).toEqual([]);
    expect(validateEntry({ gmAlert: { text: "Au MJ", activities: ["6WJ08JWazu3OZign"] } })).toEqual([]);
    expect(validateEntry({ gmAlert: [{ key: "Titan" }, { text: "x" }] })).toEqual([]);
  });
  it("refuse les formes fautives", () => {
    for ( const bad of [{}, { key: "a b" }, { key: "A", text: "B" }, { text: "" }, { key: "A", activities: ["court"] }, { key: "A", other: 1 }, []] ) {
      expect(validateEntry({ gmAlert: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
  it("chaque clé livrée a son texte", () => {
    const keys = Object.values(CONTENT).flatMap(e => [e?.gmAlert].flat().filter(Boolean)).map(r => r.key).filter(Boolean);
    expect(keys.length).toBeGreaterThan(5);
    for ( const k of keys ) expect(en[`DND5ECOMBAT.AlerteMJ.${k}`], k).toBeTruthy();
  });
});
