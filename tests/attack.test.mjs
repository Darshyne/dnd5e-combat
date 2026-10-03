import { describe, it, expect } from "vitest";
import { resolveAttack } from "../module/scripts/core/attack.mjs";

const gobelin = { token: "Scene.s.Token.g", name: "Gobelin", ac: 15 };
const ogre = { token: "Scene.s.Token.o", name: "Ogre", ac: 11 };
const roll = (total, flags = {}) => ({ total, isCritical: false, isFumble: false, ...flags });

describe("resolveAttack", () => {
  it("touche quand le total égale la CA", () => {
    expect(resolveAttack(roll(15), [gobelin])[0]).toMatchObject({ hit: true, critical: false, reason: "ac" });
  });
  it("rate sous la CA", () => {
    expect(resolveAttack(roll(14), [gobelin])[0]).toMatchObject({ hit: false, reason: "miss" });
  });
  it("un 20 naturel touche même une CA hors d'atteinte, et c'est un critique", () => {
    const [r] = resolveAttack(roll(21, { isCritical: true }), [{ ...gobelin, ac: 30 }]);
    expect(r).toMatchObject({ hit: true, critical: true, reason: "critical" });
  });
  it("un 1 naturel rate même si le total suffit", () => {
    expect(resolveAttack(roll(16, { isFumble: true }), [gobelin])[0]).toMatchObject({ hit: false, reason: "fumble" });
  });
  it("un abri total ne peut pas être touché, même sur un critique", () => {
    const [r] = resolveAttack(roll(25, { isCritical: true }), [{ ...gobelin, ac: null }]);
    expect(r).toMatchObject({ hit: false, critical: false, reason: "cover" });
  });
  it("tranche chaque cible séparément", () => {
    expect(resolveAttack(roll(12), [gobelin, ogre]).map(t => t.hit)).toEqual([false, true]);
  });
});

import { throwableAttackMode } from "../module/scripts/core/attack.mjs";

describe("§39.2 mode d'une arme qui se lance", () => {
  const dagger = { byDefault: "oneHanded", canThrow: true, hasTargets: true };
  it("un « lancer » mémorisé contre une cible à l'allonge redevient le mode par défaut", () => {
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "thrown", allBeyondReach: false })).toBe("oneHanded");
    expect(throwableAttackMode({ ...dagger, requested: "thrown-offhand", remembered: "thrown-offhand", allBeyondReach: false })).toBe("oneHanded");
  });
  it("hors d'allonge : lancer, présélectionné ou gardé", () => {
    expect(throwableAttackMode({ ...dagger, requested: "oneHanded", remembered: "oneHanded", allBeyondReach: true })).toBe("thrown");
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "thrown", allBeyondReach: true })).toBeNull();
    expect(throwableAttackMode({ ...dagger, requested: null, remembered: null, allBeyondReach: true })).toBe("thrown");
  });
  it("un mode demandé (pas de la mémoire) est gardé", () => {
    expect(throwableAttackMode({ ...dagger, requested: "offhand", remembered: "thrown", allBeyondReach: false })).toBeNull();
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "oneHanded", allBeyondReach: false })).toBeNull();
  });
  it("une main secondaire mémorisée n'est pas touchée (hors sujet)", () => {
    expect(throwableAttackMode({ ...dagger, requested: "offhand", remembered: "offhand", allBeyondReach: false })).toBeNull();
  });
  it("sans cible, rien", () => {
    expect(throwableAttackMode({ ...dagger, hasTargets: false, requested: "thrown", remembered: "thrown", allBeyondReach: false })).toBeNull();
  });
});
