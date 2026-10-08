import { describe, it, expect } from "vitest";
import { skillAids, AID_REACH, GUIDANCE_REACH } from "../module/scripts/core/skill-aid.mjs";

const me = { id: "moi", self: true, inReach: true, able: true };
const clerc = { id: "clerc", inReach: true, able: true, knowsGuidance: true, canCast: true, proficient: false };
const roublard = { id: "roublard", inReach: true, able: true, proficient: true };

describe("aides à un test de compétence (§113)", () => {
  it("un allié à portée qui connaît Assistance, un allié qui maîtrise la compétence : Assistance d'abord", () => {
    expect(skillAids({ skill: "prc", candidates: [roublard, clerc, me] })).toEqual([
      { kind: "guidance", helper: "clerc" }, { kind: "help", helper: "roublard" }
    ]);
  });
  it("le testeur qui connaît Assistance se la lance lui-même, en tête ; il ne se Soutient pas", () => {
    const self = { ...me, knowsGuidance: true, proficient: true };
    expect(skillAids({ skill: "prc", candidates: [clerc, self] })).toEqual([
      { kind: "guidance", helper: "moi" }, { kind: "guidance", helper: "clerc" }
    ]);
  });
  it("hors de portée, neutralisé ou réduit au silence : rien", () => {
    expect(skillAids({ skill: "prc", candidates: [me, { ...clerc, inReach: false }, { ...roublard, able: false }] })).toEqual([]);
    expect(skillAids({ skill: "prc", candidates: [me, { ...clerc, canCast: false }] })).toEqual([]);
  });
  it("déjà sous Assistance pour cette compétence : seul le Soutien reste", () => {
    expect(skillAids({ skill: "prc", guided: true, candidates: [me, clerc, roublard] })).toEqual([{ kind: "help", helper: "roublard" }]);
  });
  it("un test d'outil : le Soutien seulement (Assistance vise une compétence)", () => {
    expect(skillAids({ tool: "thief", candidates: [me, clerc, roublard] })).toEqual([{ kind: "help", helper: "roublard" }]);
  });
  it("hors combat, Assistance a sa propre portée (7,50 m) : un allié trop loin pour le Soutien peut encore l'offrir", () => {
    const far = { ...clerc, proficient: true, inReach: false, inGuidanceReach: true };
    expect(skillAids({ skill: "prc", candidates: [me, far] })).toEqual([{ kind: "guidance", helper: "clerc" }]);
    expect(skillAids({ skill: "prc", candidates: [me, { ...far, inGuidanceReach: false }] })).toEqual([]);
    expect(GUIDANCE_REACH).toEqual({ value: 25, units: "ft" });
  });
  it("Inspiration bardique : un allié barde à sa portée, pas soi-même, pas si le testeur est déjà inspiré", () => {
    const barde = { id: "barde", inReach: false, able: true, inspires: true, inInspirationReach: true };
    expect(skillAids({ tool: "thief", candidates: [me, barde, roublard] })).toEqual([
      { kind: "inspiration", helper: "barde" }, { kind: "help", helper: "roublard" }
    ]);
    expect(skillAids({ skill: "prc", candidates: [{ ...me, inspires: true, inInspirationReach: true }] })).toEqual([]);
    expect(skillAids({ skill: "prc", inspired: true, candidates: [me, barde] })).toEqual([]);
    expect(skillAids({ skill: "prc", candidates: [me, { ...barde, inInspirationReach: false }] })).toEqual([]);
    expect(skillAids({ skill: "prc", inCombat: true, candidates: [me, barde] })).toEqual([{ kind: "inspiration", helper: "barde" }]);
  });
  it("en combat, les mêmes aides, mais Assistance au contact seulement", () => {
    expect(skillAids({ skill: "prc", inCombat: true, candidates: [me, clerc, roublard] })).toEqual([
      { kind: "guidance", helper: "clerc" }, { kind: "help", helper: "roublard" }
    ]);
    const far = { ...clerc, inReach: false, inGuidanceReach: true };
    expect(skillAids({ skill: "prc", inCombat: true, candidates: [me, far] })).toEqual([]);
  });
  it("sans compétence ni outil : rien ; la portée du Soutien est le contact", () => {
    expect(skillAids({ candidates: [me, clerc, roublard] })).toEqual([]);
    expect(AID_REACH).toEqual({ value: 5, units: "ft" });
  });
});
