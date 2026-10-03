import { describe, it, expect } from "vitest";
import { auraRecipients, wantedAuraEffects, planAuraChanges } from "../module/scripts/core/aura.mjs";

const paladin = over => ({
  token: "T.pal", key: "aura-of-protection", disposition: 1, inactive: false,
  radius: 10, affects: "ally", includeSelf: false, value: 3, ...over
});
const at = (token, distance, disposition = 1) => ({ token, distance, disposition });

describe("qui reçoit l'aura", () => {
  const around = [at("T.pal", 0), at("T.mage", 5), at("T.roublard", 10), at("T.loin", 15), at("T.zombi", 5, -1)];

  it("les alliés à 10 ft ou moins, pas les ennemis, pas ceux qui sont trop loin", () => {
    expect(auraRecipients(paladin(), around)).toEqual(["T.mage", "T.roublard"]);
  });
  it("le porteur seulement si l'aura le prévoit (il a déjà l'effet d'origine)", () => {
    expect(auraRecipients(paladin({ includeSelf: true }), around)).toContain("T.pal");
    expect(auraRecipients(paladin(), around)).not.toContain("T.pal");
  });
  it("une aura éteinte ne touche personne", () => {
    expect(auraRecipients(paladin({ inactive: true }), around)).toEqual([]);
  });
  it("une aura hostile vise l'autre camp", () => {
    expect(auraRecipients(paladin({ affects: "enemy" }), around)).toEqual(["T.zombi"]);
  });
  it("une aura sans camp touche tout le monde à portée", () => {
    expect(auraRecipients(paladin({ affects: "any" }), around)).toEqual(["T.mage", "T.roublard", "T.zombi"]);
  });
});

describe("plusieurs auras", () => {
  it("deux auras de même nom ne se cumulent pas : la plus forte l'emporte", () => {
    const wanted = wantedAuraEffects([
      { source: paladin({ value: 2 }), recipients: ["T.mage"] },
      { source: paladin({ token: "T.pal2", value: 4 }), recipients: ["T.mage", "T.roublard"] }
    ]);
    expect(wanted).toEqual([
      { target: "T.mage", key: "aura-of-protection", source: "T.pal2", value: 4 },
      { target: "T.roublard", key: "aura-of-protection", source: "T.pal2", value: 4 }
    ]);
  });
  it("deux auras de noms différents coexistent sur la même créature", () => {
    const wanted = wantedAuraEffects([
      { source: paladin(), recipients: ["T.mage"] },
      { source: paladin({ key: "aura-of-courage" }), recipients: ["T.mage"] }
    ]);
    expect(wanted.map(w => w.key)).toEqual(["aura-of-protection", "aura-of-courage"]);
  });
});

describe("plan de mise à jour", () => {
  const wanted = [{ target: "T.mage", key: "aura-of-protection", source: "T.pal", value: 3 }];

  it("crée ce qui manque", () => {
    expect(planAuraChanges([], wanted)).toEqual({ create: wanted, update: [], remove: [] });
  });
  it("ne touche à rien quand tout est en place", () => {
    const existing = [{ id: "e1", ...wanted[0] }];
    expect(planAuraChanges(existing, wanted)).toEqual({ create: [], update: [], remove: [] });
  });
  it("retire la copie de celui qui est sorti de l'aura", () => {
    const existing = [{ id: "e1", target: "T.roublard", key: "aura-of-protection", source: "T.pal", value: 3 }];
    expect(planAuraChanges(existing, wanted).remove).toEqual(existing);
  });
  it("met à jour quand le bonus du porteur change, ou quand un autre porteur prend le relais", () => {
    const existing = [{ id: "e1", ...wanted[0], value: 2 }];
    expect(planAuraChanges(existing, wanted).update).toEqual([{ ...wanted[0], id: "e1" }]);
    const other = [{ id: "e1", ...wanted[0], source: "T.pal2" }];
    expect(planAuraChanges(other, wanted).update).toEqual([{ ...wanted[0], id: "e1" }]);
  });
  it("retire un doublon", () => {
    const existing = [{ id: "e1", ...wanted[0] }, { id: "e2", ...wanted[0] }];
    expect(planAuraChanges(existing, wanted).remove.map(e => e.id)).toEqual(["e2"]);
  });
});

describe("auraRecipients — ligne d'effet (P2)", () => {
  it("un allié à portée mais sans ligne d'effet (plancher entre les deux) ne reçoit pas l'aura ; inconnu la reçoit", () => {
    const source = { token: "T.pal", key: "protection", disposition: 1, inactive: false, radius: 10, affects: "ally", includeSelf: false, value: 3 };
    const out = auraRecipients(source, [
      { token: "T.a", disposition: 1, distance: 5, lineOfEffect: true },
      { token: "T.b", disposition: 1, distance: 5, lineOfEffect: false },
      { token: "T.c", disposition: 1, distance: 5, lineOfEffect: null },
      { token: "T.d", disposition: 1, distance: 5 }
    ]);
    expect(out).toEqual(["T.a", "T.c", "T.d"]);
  });
});

describe("auras à bonus du Monster Manual (§18.12)", () => {
  it("types : seulement les morts-vivants alliés, le porteur exclu", async () => {
    const source = { token: "DK", disposition: -1, inactive: false, radius: 60, affects: "ally", includeSelf: false, value: 12, types: ["undead"] };
    expect(auraRecipients(source, [
      { token: "DK", disposition: -1, distance: 0, type: "undead" },
      { token: "Squelette", disposition: -1, distance: 30, type: "undead" },
      { token: "Cultiste", disposition: -1, distance: 10, type: "humanoid" },
      { token: "Zombi PJ", disposition: 1, distance: 10, type: "undead" }
    ])).toEqual(["Squelette"]);
  });

  it("le contenu livré déclare des changements valides, sans état", async () => {
    const { CONTENT } = await import("../module/scripts/content/index.mjs");
    const { validateEntry } = await import("../module/scripts/core/content.mjs");
    for ( const id of ["aura-of-authority", "marshal-undead", "aura-of-bravery"] ) {
      expect(validateEntry(CONTENT[id], { at: `${id}.` })).toEqual([]);
    }
    expect(CONTENT["aura-of-authority"].aura.changes).toHaveLength(12);
    expect(CONTENT["aura-of-authority"].aura.changes[0]).toEqual({ key: "system.abilities.str.attack.roll.mode", value: "1", type: "add" });
    expect(validateEntry({ aura: { changes: [{ key: "x", value: 1, type: "add" }] } })).toHaveLength(1);   // valeur en chaîne
    expect(validateEntry({ aura: { types: ["mort-vivant"] } })).toHaveLength(1);
  });
});
