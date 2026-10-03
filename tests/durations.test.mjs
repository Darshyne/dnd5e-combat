import { describe, it, expect } from "vitest";
import { expiryFromText, namesStatus } from "../module/scripts/core/durations.mjs";

describe("durée écrite dans le texte (M4)", () => {
  it("anglais : « its » = le porteur, « the <monstre>'s » = la source", () => {
    expect(expiryFromText("<p>The target has the &amp;Reference[Paralyzed apply=false] condition until the end of its next turn.</p>", ["paralyzed"])).toBe("targetEnd");
    expect(expiryFromText("<p>The target can't take Reactions until the start of its next turn.</p>", [], { alone: true })).toBe("targetStart");
    expect(expiryFromText("<p>The target has the &amp;Reference[Poisoned] condition until the start of the [[lookup @name lowercase]]’s next turn.</p>", ["poisoned"])).toBe("sourceStart");
    expect(expiryFromText("<p>…until the end of the attacking creature's next turn.</p>", [], { alone: true })).toBe("sourceEnd");
    expect(expiryFromText("<p>…until the end of the target’s next turn.</p>", [], { alone: true })).toBe("targetEnd");
    expect(expiryFromText("<p>…until the start of your next turn.</p>", [], { alone: true })).toBe("sourceStart");
  });

  it("français (MM-fr, PHB-fr)", () => {
    expect(expiryFromText("<p>La cible subit l'état &amp;Reference[Paralyzed apply=false] jusqu'à la fin de son tour suivant.</p>", ["paralyzed"])).toBe("targetEnd");
    expect(expiryFromText("<p>… jusqu'au début de son propre tour suivant.</p>", [], { alone: true })).toBe("targetStart");
    expect(expiryFromText("<p>… jusqu'au début du tour suivant du [[lookup @name lowercase]]{monstre}.</p>", [], { alone: true })).toBe("sourceStart");
    expect(expiryFromText("<p>… jusqu'à la fin du tour suivant de la créature attaquante.</p>", [], { alone: true })).toBe("sourceEnd");
    expect(expiryFromText("<p>… jusqu'au début du tour suivant de l'utilisateur.</p>", [], { alone: true })).toBe("sourceStart");
    expect(expiryFromText("<p>… jusqu'à la fin de votre tour suivant.</p>", [], { alone: true })).toBe("sourceEnd");
  });

  it("plusieurs durées : la phrase qui nomme l'état de l'effet", () => {
    const text = "<p>Failure: the target has the &amp;Reference[Prone] condition until the start of its next turn. The target also has the &amp;Reference[Poisoned] condition until the end of the [[lookup @name lowercase]]'s next turn.</p>";
    expect(expiryFromText(text, ["prone"])).toBe("targetStart");
    expect(expiryFromText(text, ["poisoned"])).toBe("sourceEnd");
    expect(expiryFromText(text, [])).toBeNull();   // rien pour choisir : on ne devine pas
  });

  it("une durée écrite pour autre chose que l'état de l'effet n'est pas la sienne (Mot de pouvoir étourdissant)", () => {
    const pws = "<p>If the target has 150 Hit Points or fewer, it has the &amp;Reference[Stunned] condition. Otherwise, its Speed is 0 until the start of your next turn.</p>";
    expect(expiryFromText(pws, ["stunned"])).toBeNull();
    // Sans état, une durée n'est reprise que de la description de l'effet lui-même.
    expect(expiryFromText("<p>… until the start of your next turn.</p>", [])).toBeNull();
  });

  it("la durée suit l'état dans la phrase (texte synthétique, forme « (A) … ou (B) … » du MM)", () => {
    const warp = "<p>The creature picks one: (A) the target has the &amp;Reference[Charmed apply=false] condition until the start of the creature's next turn, or (B) the target has the &amp;Reference[Prone apply=false] condition.</p>";
    expect(expiryFromText(warp, ["charmed"])).toBe("sourceStart");
    expect(expiryFromText(warp, ["prone"])).toBeNull();
  });

  it("la description d'un effet qui nomme son état fait foi (Tyran de la mort)", () => {
    expect(namesStatus("<p>The target has the &amp;Reference[Restrained apply=false] condition and repeats the save.</p>", ["restrained"])).toBe(true);
    expect(namesStatus("<p>No condition here.</p>", ["restrained"])).toBe(false);
  });

  it("ce qui n'est pas une durée", () => {
    expect(expiryFromText("<p>The target has the Restrained condition and repeats the save at the end of its next turn.</p>", ["restrained"])).toBeNull();
    expect(expiryFromText("<p>The target has the Prone condition.</p>", ["prone"])).toBeNull();
    expect(expiryFromText("")).toBeNull();
  });
});
