/** §79 : fins de charme par les dégâts du camp du lanceur, et durées « 1 tour » génériques lues dans le texte de l'item. */
import { describe, it, expect } from "vitest";
import { expiryFromText } from "../module/scripts/core/durations.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("fins de charme : « si vous ou vos alliés lui infligez des dégâts »", () => {
  for ( const id of ["charm-person", "charm-monster", "animal-friendship"] ) {
    it(id, () => {
      expect(CONTENT[id].triggers).toEqual([{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }]);
      expect(validateEntry(CONTENT[id])).toEqual([]);
    });
  }
  it("les cibles restent bornées (Humanoïde, Bête)", () => {
    expect(CONTENT["charm-person"].targets).toEqual({ types: ["humanoid"] });
    expect(CONTENT["animal-friendship"].targets).toEqual({ types: ["beast"] });
  });
});

describe("« before the end of your next turn » borne l'effet comme « until »", () => {
  it("anglais", () => {
    expect(expiryFromText("<p>The next attack roll made against it before the end of your next turn has Advantage.</p>", [], { alone: true })).toBe("sourceEnd");
    expect(expiryFromText("<p>…before the start of its next turn.</p>", [], { alone: true })).toBe("targetStart");
  });
  it("français", () => {
    expect(expiryFromText("<p>… avant la fin de votre prochain tour.</p>", [], { alone: true })).toBe("sourceEnd");
    expect(expiryFromText("<p>… avant le début de son tour suivant.</p>", [], { alone: true })).toBe("targetStart");
  });
});

describe("repli d'une durée générique sur le texte de l'item (fallback)", () => {
  it("état écrit sans lien : la durée unique du texte", () => {
    const menacing = "<p>The target must succeed on a Wisdom saving throw or have the Frightened condition until the end of your next turn.</p>";
    expect(expiryFromText(menacing, ["frightened"])).toBeNull();
    expect(expiryFromText(menacing, ["frightened"], { fallback: true })).toBe("sourceEnd");
  });
  it("effet sans état : la durée unique du texte, même répétée", () => {
    const slasher = "<p>…reduce the Speed of that creature by 10 feet until the start of your next turn. …it has Disadvantage on attack rolls until the start of your next turn.</p>";
    expect(expiryFromText(slasher, [])).toBeNull();
    expect(expiryFromText(slasher, [], { fallback: true })).toBe("sourceStart");
  });
  it("des durées différentes : rien", () => {
    const two = "<p>…until the start of its next turn. …until the end of your next turn.</p>";
    expect(expiryFromText(two, [], { fallback: true })).toBeNull();
  });
  it("l'état nommé ailleurs sans durée ne prend pas celle d'une autre phrase", () => {
    const pws = "<p>If the target has 150 Hit Points or fewer, it has the &amp;Reference[Stunned] condition. Otherwise, its Speed is 0 until the start of your next turn.</p>";
    expect(expiryFromText(pws, ["stunned"], { fallback: true })).toBeNull();
  });
});
