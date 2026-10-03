import { describe, it, expect } from "vitest";
import { createRouter } from "../module/scripts/runtime/router.mjs";

function setup({ executor=true }={}) {
  const hooks = new Map();
  const errors = [];
  const router = createRouter({
    subscribe: (hook, fn) => hooks.set(hook, [...(hooks.get(hook) ?? []), fn]),
    isExecutor: () => executor,
    report: (entry, err) => errors.push(`${entry.label}: ${err.message}`)
  });
  const fire = (hook, ...args) => hooks.get(hook)[0](...args);
  return { hooks, errors, router, fire };
}

describe("routeur de hooks", () => {
  it("branche chaque hook une seule fois, quel que soit le nombre d'inscrits", () => {
    const { hooks, router } = setup();
    router.on("createChatMessage", () => {});
    router.on("createChatMessage", () => {});
    router.on("moveToken", () => {});
    expect(hooks.get("createChatMessage")).toHaveLength(1);
    expect(hooks.get("moveToken")).toHaveLength(1);
  });

  it("appelle les inscrits dans l'ordre d'inscription, avec les arguments du hook", () => {
    const { router, fire } = setup();
    const seen = [];
    router.on("h", (a, b) => seen.push(["un", a, b]));
    router.on("h", (a, b) => seen.push(["deux", a, b]));
    fire("h", 1, 2);
    expect(seen).toEqual([["un", 1, 2], ["deux", 1, 2]]);
  });

  it("saute les inscrits réservés au MJ actif sur les autres clients", () => {
    const { router, fire } = setup({ executor: false });
    const seen = [];
    router.on("h", () => seen.push("mj"), { executor: true });
    router.on("h", () => seen.push("tous"));
    fire("h");
    expect(seen).toEqual(["tous"]);
  });

  it("une erreur synchrone est consignée et n'arrête pas les suivants", () => {
    const { router, fire, errors } = setup();
    const seen = [];
    router.on("h", () => { throw new Error("boum"); }, { label: "premier" });
    router.on("h", () => seen.push("second"));
    expect(fire("h")).toBe(true);
    expect(seen).toEqual(["second"]);
    expect(errors).toEqual(["premier: boum"]);
  });

  it("une promesse rejetée est consignée, sans être attendue", async () => {
    const { router, fire, errors } = setup();
    const seen = [];
    router.on("h", async () => { throw new Error("tard"); }, { label: "lent" });
    router.on("h", () => seen.push("second"));
    fire("h");
    expect(seen).toEqual(["second"]);
    await Promise.resolve(); await Promise.resolve();
    expect(errors).toEqual(["lent: tard"]);
  });

  it("false n'annule que si l'inscrit est déclaré annulable, et arrête alors la chaîne", () => {
    const { router, fire } = setup();
    const seen = [];
    router.on("callAll", () => false);
    router.on("callAll", () => seen.push("suivant"));
    expect(fire("callAll")).toBe(true);
    expect(seen).toEqual(["suivant"]);

    router.on("pre", () => false, { cancellable: true });
    router.on("pre", () => seen.push("jamais"), { cancellable: true });
    expect(fire("pre")).toBe(false);
    expect(seen).toEqual(["suivant"]);
  });

  it("décrit qui écoute quoi, dans l'ordre", () => {
    const { router } = setup();
    router.on("h", () => {}, { label: "a", executor: true });
    router.on("h", () => {}, { label: "b", cancellable: true });
    expect(router.describe()).toEqual({ h: [
      { label: "a", executor: true, cancellable: false },
      { label: "b", executor: false, cancellable: true }
    ] });
  });
});
