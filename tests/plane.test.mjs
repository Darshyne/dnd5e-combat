import { describe, it, expect } from "vitest";
import { planeOf, samePlane, perceivesAcross, crossesEtherealWall, etherealStepCost, nearestFreeCell, shuntDamage, etherealPlaneOn, setEtherealPlaneState, ETHEREAL } from "../module/scripts/core/plane.mjs";
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

  it("lot 3 : un pas franchit un mur de force, extrémités comprises ; le vertical coûte double", () => {
    const wall = [[100, 0, 100, 100]];
    expect(crossesEtherealWall({ x: 50, y: 50 }, { x: 150, y: 50 }, wall)).toBe(true);
    expect(crossesEtherealWall({ x: 50, y: 50 }, { x: 90, y: 50 }, wall)).toBe(false);
    expect(crossesEtherealWall({ x: 50, y: 50 }, { x: 150, y: 150 }, wall)).toBe(true);
    expect(crossesEtherealWall({ x: 50, y: 150 }, { x: 150, y: 150 }, wall)).toBe(false);
    expect(crossesEtherealWall({ x: 50, y: 50 }, { x: 150, y: 50 }, [])).toBe(false);
    expect(etherealStepCost(5, 0)).toBe(5);
    expect(etherealStepCost(5, -5)).toBe(10);
  });

  it("lot 4 : la case libre la plus proche, anneau par anneau, orthogonale d'abord ; dégâts 2 × pieds", () => {
    const taken = new Set(["5,5", "5,6", "4,5"]);
    const free = c => !taken.has(`${c.i},${c.j}`);
    expect(nearestFreeCell({ i: 5, j: 5 }, free)).toEqual({ i: 5, j: 4, rings: 1 });
    expect(nearestFreeCell({ i: 1, j: 1 }, free)).toEqual({ i: 1, j: 1, rings: 0 });
    expect(nearestFreeCell({ i: 0, j: 0 }, () => false, 3)).toBe(null);
    const ring2 = c => (Math.max(Math.abs(c.i), Math.abs(c.j)) >= 2);
    expect(nearestFreeCell({ i: 0, j: 0 }, ring2)?.rings).toBe(2);
    expect(shuntDamage(5)).toBe(10);
    expect(shuntDamage(0)).toBe(0);
  });

  it("l'interrupteur du MJ : coupé, tout le monde est sur le plan matériel", () => {
    expect(etherealPlaneOn()).toBe(true);
    setEtherealPlaneState(false);
    try {
      expect(planeOf(ethereal)).toBe("material");
      expect(samePlane(ethereal, material)).toBe(true);
    }
    finally { setEtherealPlaneState(true); }
    expect(planeOf(ethereal)).toBe("ethereal");
  });
});
