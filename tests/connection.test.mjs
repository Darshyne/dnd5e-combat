import { describe, expect, it } from "vitest";
import { apiShape, browserFamily, compareClients, connectionMarkdown, diagnose, fingerprint, pingStats, worstLevel } from "../module/scripts/core/connection.mjs";

const ids = list => list.map(f => `${f.level} ${f.id}`);

describe("§388 pingStats", () => {
  it("médiane, meilleur, pire, irrégularité ; l'écart d'horloge lu sur l'essai le plus court", () => {
    const s = pingStats([
      { sent: 0, received: 100, remote: 5050 },
      { sent: 1000, received: 1040, remote: 6020 },   // le plus court : milieu 1020 → écart 5000
      { sent: 2000, received: 2300, remote: 7150 },
      { lost: true }
    ]);
    expect(s).toMatchObject({ count: 4, lost: 1, min: 40, median: 100, worst: 300, jitter: 260, offset: 5000 });
  });
  it("aucun essai réussi : rien à mesurer", () => {
    expect(pingStats([{ lost: true }, { lost: true }])).toMatchObject({ count: 2, lost: 2, median: null, offset: null });
  });
});

describe("§388 empreinte du code", () => {
  it("la forme d'une API, ordre indifférent", () => {
    const a = { ui: { cost() {}, cell() {} }, open() {} };
    const b = { open() {}, ui: { cell() {}, cost() {} } };
    expect(apiShape(a)).toEqual(["open", "ui", "ui.cell", "ui.cost"]);
    expect(fingerprint(apiShape(a))).toBe(fingerprint(apiShape(b)));
    expect(fingerprint(apiShape({ ...a, extra: 1 }))).not.toBe(fingerprint(apiShape(a)));
    expect(fingerprint([])).toBeNull();
  });
});

describe("§388 compareClients", () => {
  const gm = { foundry: "14.370", system: "dnd5e 6.0.6", modules: [{ id: "dnd5e-combat", version: "0.280.0", code: "aaa" },
    { id: "darsh-loot", version: "0.20.0", code: "bbb" }], activeModules: ["dnd5e-combat", "darsh-loot", "babele"] };
  it("version différente : page pas rechargée ; même version et autre code : cache", () => {
    const d = compareClients(gm, { foundry: "14.370", system: "dnd5e 6.0.6",
      modules: [{ id: "dnd5e-combat", version: "0.279.0", code: "old" }, { id: "darsh-loot", version: "0.20.0", code: "zzz" }],
      activeModules: ["dnd5e-combat", "darsh-loot", "dice-so-nice"] });
    expect(d.modules).toEqual([
      { id: "dnd5e-combat", gm: "0.280.0", player: "0.279.0", code: false },
      { id: "darsh-loot", gm: "0.20.0", player: "0.20.0", code: true }
    ]);
    expect(d.missing).toEqual(["babele"]);
    expect(d.extra).toEqual(["dice-so-nice"]);
    expect(d.foundry).toBeNull();
  });
});

describe("§388 diagnose", () => {
  const reference = { foundry: "14.370", system: "dnd5e 6.0.6", language: "fr", viewedScene: "s1",
    modules: [{ id: "dnd5e-combat", version: "1", code: "x" }], activeModules: ["dnd5e-combat"] };
  const probe = { ...reference, gpu: "ANGLE (NVIDIA GeForce RTX 3080)", webgl2: true, maxTextureSize: 16384, canvas: true, fps: 60,
    hidden: false, character: "owned", errors: 0, browserFamily: "chromium" };
  const pings = { count: 10, lost: 0, min: 20, median: 30, worst: 50, jitter: 30, offset: 100 };

  it("tout va bien : ok seulement", () => {
    const f = diagnose({ pings, probe, reference });
    expect(worstLevel(f)).toBe("ok");
    expect(ids(f)).toEqual(["ok ping", "ok versions", "ok fps"]);
  });

  it("pas de réponse du tout", () => {
    const f = diagnose({ pings: { count: 10, lost: 10, median: null }, probe: null, reference });
    expect(ids(f)).toEqual(["bad noAnswer"]);
  });

  it("répond aux allers-retours mais pas à la sonde", () => {
    expect(ids(diagnose({ pings, probe: null, reference }))).toEqual(["bad noProbe", "ok ping"]);
  });

  it("les problèmes triés du plus grave au moins grave", () => {
    const f = diagnose({
      pings: { ...pings, median: 450, worst: 1200, jitter: 1150, lost: 1, offset: -12500 },
      probe: { ...probe, modules: [{ id: "dnd5e-combat", version: "1", code: "y" }], gpu: "Google SwiftShader", fps: 15, hidden: false,
        babele: true, filesBrowse: false, language: "en", character: "none", audioLocked: true, viewedScene: "s2", errors: 3,
        browserFamily: "firefox", diceSoNice: true },
      reference
    });
    expect(ids(f)).toEqual(["bad clock", "bad browserCache", "bad softwareGpu", "warn ping", "warn jitter", "warn lost", "warn filesBrowse",
      "warn audioLocked", "warn fps", "warn errors", "info language", "info noCharacter", "info diceSoNice", "info browser", "info scene"]);
    expect(f.find(x => x.id === "clock").data.seconds).toBe(-12.5);
  });

  it("fenêtre cachée : les images par seconde ne comptent pas", () => {
    const f = diagnose({ pings, probe: { ...probe, hidden: true, fps: null }, reference });
    expect(ids(f)).toEqual(["warn hidden", "ok ping", "ok versions"]);
  });
});

describe("§388 divers", () => {
  it("famille du navigateur", () => {
    expect(browserFamily("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("chromium");
    expect(browserFamily("Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("firefox");
    expect(browserFamily("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15")).toBe("safari");
    expect(browserFamily("Mozilla/5.0 Electron/30.0 Chrome/124")).toBe("chromium");
  });
  it("le Markdown : un constat par ligne, les mesures repliées, le rôle sans nom", () => {
    const md = connectionMarkdown({ role: "Player 2", pings: { count: 10, lost: 0, min: 1, median: 2, worst: 3, offset: 0 },
      findings: [{ id: "ping", level: "ok", data: {} }, { id: "hidden", level: "warn", data: {} }],
      probe: { foundry: "14.370", gpu: "X", modules: [{ id: "dnd5e-combat", version: "1", code: "abc" }] } }, key => key);
    expect(md).toContain("### Titre — Player 2");
    expect(md).toContain("- ✅ Constat.ping");
    expect(md).toContain("- ⚠️ Constat.hidden");
    expect(md).toContain("<details>");
    expect(md).toContain("dnd5e-combat 1 [abc]");
  });
});
