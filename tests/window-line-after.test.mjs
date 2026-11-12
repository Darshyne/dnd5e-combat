import { describe, it, expect } from "vitest";
import { createWindowLine } from "../module/scripts/core/window-line.mjs";

const tick = () => new Promise(r => setTimeout(r, 0));

// §422 : une fenêtre sans délai (un refus) passe après la question en cours, sans retenir les suivantes ; le compteur « ensuite ».
describe("§422 : passer après la fenêtre en cours, compter celles qui attendent", () => {
  it("`after` attend la fenêtre ouverte avant de s'ouvrir", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });   // pas de plafond
    const opened = [];
    let closeFirst;
    inLine(() => { opened.push("question"); return new Promise(r => { closeFirst = r; }); });
    const refusal = inLine.after(async () => { opened.push("refus"); return "ok"; });
    await tick();
    expect(opened).toEqual(["question"]);
    closeFirst();
    expect(await refusal).toBe("ok");
    expect(opened).toEqual(["question", "refus"]);
  });

  it("`after` ne retient pas les questions suivantes : elles n'attendent pas qu'il se ferme", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    const opened = [];
    inLine.after(() => { opened.push("refus"); return new Promise(() => {}); });   // jamais fermé
    const question = inLine(async () => { opened.push("question"); return "q"; });
    expect(await question).toBe("q");
    expect(opened).toEqual(["refus", "question"]);
  });

  it("sans rien d'ouvert, `after` s'ouvre aussitôt", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    expect(await inLine.after(async () => "tout de suite")).toBe("tout de suite");
  });

  it("`waiting` compte les fenêtres qui n'ont pas encore leur tour", async () => {
    const inLine = createWindowLine({ wait: () => new Promise(() => {}) });
    let closeFirst;
    const first = inLine(() => new Promise(r => { closeFirst = r; }));
    const second = inLine(async () => "b");
    const third = inLine(async () => "c");
    await tick();
    expect(inLine.waiting()).toBe(2);
    closeFirst();
    await Promise.all([first, second, third]);
    expect(inLine.waiting()).toBe(0);
  });
});
