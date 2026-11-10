import { describe, it, expect } from "vitest";
import { createWindowLine } from "../module/scripts/core/window-line.mjs";

const tick = () => new Promise(r => setTimeout(r, 0));

describe("§401 : la file des fenêtres d'un poste", () => {
  it("une fenêtre attend que la précédente soit fermée", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });   // pas de plafond
    const opened = [];
    let closeFirst;
    const first = inLine(() => { opened.push("A"); return new Promise(r => { closeFirst = r; }); });
    const second = inLine(async () => { opened.push("B"); return "b"; });
    await tick(); await tick();
    expect(opened).toEqual(["A"]);
    closeFirst("a");
    expect(await first).toBe("a");
    expect(await second).toBe("b");
    expect(opened).toEqual(["A", "B"]);
  });

  it("trois fenêtres s'ouvrent dans l'ordre où elles ont été demandées", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    const order = [];
    const slow = name => () => new Promise(r => setTimeout(() => { order.push(name); r(name); }, 5));
    await Promise.all([inLine(slow("A")), inLine(slow("B")), inLine(slow("C"))]);
    expect(order).toEqual(["A", "B", "C"]);
  });

  it("au bout du plafond, la fenêtre s'ouvre même si la précédente reste ouverte", async () => {
    let fire;
    const inLine = createWindowLine({ wait: () => new Promise(r => { fire = r; }) });
    inLine(() => new Promise(() => {}));   // jamais fermée
    const opened = [];
    const second = inLine(async () => { opened.push("B"); return "b"; });
    await tick();
    expect(opened).toEqual([]);
    fire();
    expect(await second).toBe("b");
  });

  it("une entrée jamais fermée ne retarde que la fenêtre qui la suit, pas toutes les suivantes", async () => {
    const fires = [];
    const inLine = createWindowLine({ wait: () => new Promise(r => { fires.push(r); }) });
    inLine(() => new Promise(() => {}), "fuite");
    const opened = [];
    const second = inLine(async () => { opened.push("B"); return "b"; }, "B");
    const third = inLine(async () => { opened.push("C"); return "c"; }, "C");
    await tick();
    expect(opened).toEqual([]);
    fires[1]();   // le plafond de B (fires[0] : celui de la fuite, derrière une file vide)
    expect(await second).toBe("b");
    expect(await third).toBe("c");   // C n'attend que B, pas la fuite
    expect(inLine.state().map(e => e.label)).toEqual(["fuite"]);
  });

  it("une fenêtre qui échoue libère la suivante", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    const first = inLine(async () => { throw new Error("fermée"); });
    const second = inLine(async () => "b");
    await expect(first).rejects.toThrow("fermée");
    expect(await second).toBe("b");
  });
});
