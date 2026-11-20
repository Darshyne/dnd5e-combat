import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("zones du SRD 5.2 dont la sauvegarde vient à l'entrée et au tour, pas à la pose", () => {
  it("Zone de vérité : à l'entrée et au début du tour ; rien à la pose ; l'effet tombe en sortant", () => {
    const entry = CONTENT["zone-of-truth"];
    expect(entry.triggers).toEqual([{ on: ["enter", "turnStart"], do: [{ type: "replay" }] }]);
    expect(entry.quietPose).toBe(true);
    expect(entry.zoneEffects).toBe(true);
    expect(validateEntry(entry)).toEqual([]);
  });
  it("Contrôle de l'eau : le tourbillon, à l'entrée et à la FIN du tour ; rien à la pose", () => {
    const entry = CONTENT["control-water"];
    expect(entry.triggers).toEqual([{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dnd5eactivity000" }] }]);
    expect(entry.quietPose).toBe(true);
    expect(validateEntry(entry)).toEqual([]);
  });
});
