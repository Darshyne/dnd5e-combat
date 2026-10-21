import { describe, it, expect } from "vitest";
import { planeOf, samePlane, perceivesAcross, ETHEREAL } from "../module/scripts/core/plane.mjs";
import { selectAreaTargets } from "../module/scripts/core/area.mjs";

describe("§225 : plan Éthéré (statut `ethereal`)", () => {
  const ethereal = new Set([ETHEREAL]);
  const material = new Set(["prone"]);

  it("le statut `ethereal` met la créature dans le plan Éthéré, tout le reste est le plan matériel", () => {
    expect(planeOf(ethereal)).toBe("ethereal");
    expect(planeOf(material)).toBe("material");
    expect(planeOf(new Set())).toBe("material");
    expect(planeOf(null)).toBe("material");
  });

  it("deux créatures ne s'affectent que sur le même plan", () => {
    expect(samePlane(ethereal, new Set([ETHEREAL, "prone"]))).toBe(true);
    expect(samePlane(material, new Set())).toBe(true);
    expect(samePlane(ethereal, material)).toBe(false);
    expect(samePlane(material, ethereal)).toBe(false);
  });

  it("ce qui n'est pas une créature (un point, null) est sur le plan matériel", () => {
    expect(samePlane(null, material)).toBe(true);
    expect(samePlane(null, ethereal)).toBe(false);
  });

  it("une zone laisse de côté les créatures d'un autre plan que son lanceur", () => {
    const candidates = [{ token: "a", disposition: -1 }, { token: "b", disposition: -1, offPlane: true }];
    const picked = selectAreaTargets(candidates, { origin: "o", originDisposition: 1, excludeOrigin: false, affects: "" });
    expect(picked.map(c => c.token)).toEqual(["a"]);
  });

  it("perception d'un plan à l'autre : vue de l'Éthéré à sa portée, 60 ft depuis l'Éthéré, le fantôme visible", () => {
    const base = { observerPlane: "material", targetPlane: ETHEREAL, distance: 30 };
    expect(perceivesAcross({ ...base, observerPlane: ETHEREAL })).toBe(true);
    expect(perceivesAcross(base)).toBe(false);
    expect(perceivesAcross({ ...base, etherealSight: Infinity })).toBe(true);
    expect(perceivesAcross({ ...base, etherealSight: 20 })).toBe(false);
    expect(perceivesAcross({ ...base, etherealSight: 60 })).toBe(true);
    expect(perceivesAcross({ ...base, visibleAcross: true })).toBe(true);
    const fromEthereal = { observerPlane: ETHEREAL, targetPlane: "material", limit: 60 };
    expect(perceivesAcross({ ...fromEthereal, distance: 60 })).toBe(true);
    expect(perceivesAcross({ ...fromEthereal, distance: 65 })).toBe(false);
  });
});
