/**
 * L'attente des dés 3D est bornée (SPEC §12) : une animation qui ne se joue pas — fenêtre en
 * arrière-plan, rendu suspendu — ne doit jamais retenir une résolution.
 */
import { describe, it, expect } from "vitest";
import { createDiceWait } from "../module/scripts/runtime/shared.mjs";

const never = () => new Promise(() => {});
const message = { id: "msg0000000000001" };

function setup({ animation, hidden=false, sleep=never, maxMs=8000 }) {
  const reports = [];
  const calls = [];
  const wait = createDiceWait({
    animation: id => { calls.push(id); return animation?.(id) ?? null; },
    isHidden: () => hidden,
    sleep,
    report: why => reports.push(why)
  }, maxMs);
  return { wait, reports, calls };
}

describe("attente des dés 3D", () => {
  it("rend la main tout de suite sans dés 3D, sans rien consigner", async () => {
    const { wait, reports } = setup({ animation: null });
    await wait(message);
    expect(reports).toEqual([]);
  });

  it("attend la fin de l'animation quand elle vient à temps", async () => {
    let finish;
    const { wait, reports } = setup({ animation: () => new Promise(resolve => { finish = resolve; }) });
    let done = false;
    const waiting = wait(message).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await waiting;
    expect(done).toBe(true);
    expect(reports).toEqual([]);
  });

  it("continue sans les dés passé le délai, et le consigne", async () => {
    const { wait, reports } = setup({ animation: never, sleep: () => Promise.resolve(), maxMs: 8000 });
    await wait(message);
    expect(reports).toEqual(["over 8000 ms"]);
  });

  it("n'attend pas du tout quand la fenêtre est en arrière-plan : l'animation n'est même pas demandée", async () => {
    const { wait, reports, calls } = setup({ animation: never, hidden: true });
    await wait(message);
    expect(calls).toEqual([]);
    expect(reports).toEqual(["window in the background"]);
  });

  it("interroge les dés 3D avec l'identifiant du message", async () => {
    const { wait, calls } = setup({ animation: () => Promise.resolve() });
    await wait(message);
    expect(calls).toEqual(["msg0000000000001"]);
  });
});
