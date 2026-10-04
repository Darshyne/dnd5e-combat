/** M8 (SPEC §18.13) : Régénération — lecture du texte anglais d'origine, décision au début du tour. */
import { describe, it, expect } from "vitest";
import { readRegeneration, regenerationAtTurnStart, stopsRegeneration } from "../module/scripts/core/regeneration.mjs";
import { downedStatus } from "../module/scripts/core/death.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const TROLL = `<p>The [[lookup @name lowercase]] regains [[lookup @activities.healing.formula]] Hit Points at the start of each of its turns. If the troll takes Acid or Fire damage, this trait doesn't function on the troll's next turn. The troll dies only if it starts its turn with 0 Hit Points and doesn't regenerate.</p>`;
// Troll : SRD 5.2 ; les deux suivants sont synthétiques (créatures inventées), de même grammaire que le Monster Manual.
const MIRE_BEAST = `<p>The [[lookup @name lowercase]] regains [[lookup @activities.healing.formula]] Hit Points at the start of each of its turns if it has at least 1 Hit Point.</p>`;
const GRAVE_KNIGHT = `<p>The [[lookup @name lowercase]] regains … Hit Points at the start of each of its turns. If the grave knight takes &amp;Reference[Fire] or Radiant damage, this trait doesn’t function at the start of its next turn. It is destroyed only if it starts its turn with 0 Hit Points and doesn’t regenerate.</p>`;

describe("Régénération (M8)", () => {
  it("lit ce qui la coupe, et qui survit à 0 PV", () => {
    expect(readRegeneration(TROLL)).toEqual({ needsHp: false, silveredBy: [], stoppedBy: ["acid", "fire"], survivesZero: true });
    expect(readRegeneration(MIRE_BEAST)).toEqual({ needsHp: true, silveredBy: [], stoppedBy: [], survivesZero: false });
    expect(readRegeneration(GRAVE_KNIGHT)).toEqual({ needsHp: false, silveredBy: [], stoppedBy: ["fire", "radiant"], survivesZero: true });
  });

  it("au début du tour", () => {
    const troll = { needsHp: false, survivesZero: true, dead: false };
    expect(regenerationAtTurnStart({ ...troll, hp: 0, stopped: false })).toBe("heal");
    expect(regenerationAtTurnStart({ ...troll, hp: 0, stopped: true })).toBe("dies");
    expect(regenerationAtTurnStart({ ...troll, hp: 30, stopped: true })).toBe("none");
    const slaad = { needsHp: true, survivesZero: false, dead: false, stopped: false };
    expect(regenerationAtTurnStart({ ...slaad, hp: 0 })).toBe("none");
    expect(regenerationAtTurnStart({ ...slaad, hp: 1 })).toBe("heal");
    expect(regenerationAtTurnStart({ ...slaad, hp: 5, dead: true })).toBe("none");
  });

  it("coupée par les types nommés seulement", () => {
    expect(stopsRegeneration(["acid", "fire"], ["slashing", "fire"])).toBe(true);
    expect(stopsRegeneration(["acid", "fire"], ["slashing"])).toBe(false);
  });

  it("un troll à 0 PV est Inconscient, pas Mort", () => {
    expect(downedStatus({ hp: 0, saves: false, statuses: [], regenerates: true })).toBe("unconscious");
    expect(downedStatus({ hp: 0, saves: false, statuses: [] })).toBe("dead");
  });

  it("contenu livré", () => {
    expect(CONTENT.regeneration).toEqual({ regeneration: true });
    expect(validateEntry(CONTENT.regeneration)).toEqual([]);
    expect(validateEntry({ regeneration: "oui" })).toHaveLength(1);
  });
});

describe("§78 : Régénération d'un lycanthrope (arme argentée)", () => {
  const WERE = "<p>The wereraven regains 10 hit points at the start of its turn if it hasn’t taken necrotic damage or bludgeoning, piercing, or slashing damage from a silvered weapon since its last turn. It dies only if it starts its turn with 0 hit points and doesn&#39;t regenerate.</p>";
  it("nécrotique toujours, contondant/perforant/tranchant seulement d'une arme argentée", () => {
    expect(readRegeneration(WERE)).toEqual({ needsHp: false, stoppedBy: ["necrotic"], silveredBy: ["bludgeoning", "piercing", "slashing"], survivesZero: true });
  });
  it("une arme ordinaire ne la coupe pas, une arme argentée oui", () => {
    const r = readRegeneration(WERE);
    expect(stopsRegeneration(r.stoppedBy, ["piercing"], r.silveredBy, [])).toBe(false);
    expect(stopsRegeneration(r.stoppedBy, ["piercing"], r.silveredBy, ["piercing"])).toBe(true);
    expect(stopsRegeneration(r.stoppedBy, ["necrotic"], r.silveredBy, [])).toBe(true);
  });
});
