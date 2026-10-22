import { describe, it, expect } from "vitest";
import { maximizeDice } from "../module/scripts/core/max-dice.mjs";

describe("dés de soin au maximum (§233)", () => {
  it("NdF, dF et (expression)dF deviennent leur maximum ; le reste ne bouge pas", () => {
    expect(maximizeDice("2d4 + 2")).toBe("(2*4) + 2");
    expect(maximizeDice("d8")).toBe("(1*8)");
    expect(maximizeDice("(@scale.channel-divinity.spark)d8 + @abilities.wis.mod")).toBe("((@scale.channel-divinity.spark)*8) + @abilities.wis.mod");
    expect(maximizeDice("1d4r1 + 3")).toBe("(1*4) + 3");
  });
  it("un mot n'est pas un dé", () => {
    expect(maximizeDice("@flags.dnd5e.x + 5")).toBe("@flags.dnd5e.x + 5");
    expect(maximizeDice("@abilities.wis.mod")).toBe("@abilities.wis.mod");
  });
});
