import { describe, it, expect } from "vitest";
import { replaceKeepingScroll } from "../module/scripts/ui/scroll.mjs";

/** Un faux contenu : des zones par sélecteur, chacune avec son `scrollTop`. */
const fake = zones => ({ zones, querySelectorAll: s => zones[s] ?? [] });
const container = first => {
  const content = { scrollTop: 0, current: first,
    querySelectorAll: s => content.current.querySelectorAll(s),
    replaceChildren(r) { content.current = r; content.scrollTop = 0; } };
  return content;
};

describe("replaceKeepingScroll", () => {
  it("garde le défilement d'une zone quand la vue ne change pas", () => {
    const content = container(fake({ ".pane": [{ scrollTop: 0 }] }));
    const memo = {};
    replaceKeepingScroll(content, fake({ ".pane": [{ scrollTop: 0 }] }), [".pane"], memo, "scan");
    content.current.zones[".pane"][0].scrollTop = 420;
    content.scrollTop = 30;
    const next = fake({ ".pane": [{ scrollTop: 0 }] });
    replaceKeepingScroll(content, next, [".pane"], memo, "scan");
    expect(next.zones[".pane"][0].scrollTop).toBe(420);
    expect(content.scrollTop).toBe(30);
  });

  it("repart en haut quand la vue change (autre onglet)", () => {
    const content = container(fake({ ".pane": [{ scrollTop: 0 }] }));
    const memo = {};
    replaceKeepingScroll(content, fake({ ".pane": [{ scrollTop: 0 }] }), [".pane"], memo, "scan");
    content.current.zones[".pane"][0].scrollTop = 420;
    const next = fake({ ".pane": [{ scrollTop: 0 }] });
    replaceKeepingScroll(content, next, [".pane"], memo, "backups");
    expect(next.zones[".pane"][0].scrollTop).toBe(0);
  });

  it("supporte une zone absente du nouveau contenu", () => {
    const content = container(fake({ ".pane": [{ scrollTop: 0 }] }));
    const memo = { view: "scan" };
    content.current.zones[".pane"][0].scrollTop = 99;
    const next = fake({});
    expect(() => replaceKeepingScroll(content, next, [".pane"], memo, "scan")).not.toThrow();
  });
});
