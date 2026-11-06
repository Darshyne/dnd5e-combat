import { describe, it, expect } from "vitest";
import {
  stackFrames, packagesOfStack, attribute, formatArgs, errorIn, signature, createRing, createErrorLog, roleLabels,
  createScrubber, scrubDeep, safeSettings, buildReport, reportMarkdown, reportJson, githubRepo, pickRepo, truncateForUrl,
  issueUrl, MAX_FRAMES, MAX_MESSAGE
} from "../module/scripts/core/debug.mjs";

const CHROME = `TypeError: Cannot read properties of undefined (reading 'x')
    at onUse (https://dandd.forge-vtt.com/modules/dnd5e-combat/scripts/runtime/debug.mjs:12:3)
    at wrapper (https://dandd.forge-vtt.com/modules/lib-wrapper/lib-wrapper.js:5:1)
    at resolve (https://dandd.forge-vtt.com/modules/dnd5e-combat/scripts/runtime/engine.mjs:180:22)
    at Activity.use (https://dandd.forge-vtt.com/systems/dnd5e/dnd5e.mjs:9000:10)
    at Hooks.callAll (https://dandd.forge-vtt.com/scripts/foundry.mjs:100:5)`;
const FIREFOX = `use@http://localhost:30000/modules/darsh-loot/scripts/a.mjs?v=3:4:9
call@http://localhost:30000/scripts/foundry.mjs:1:1`;

describe("piles d'appels (§380)", () => {
  it("garde les lignes qui pointent vers un fichier, Chrome comme Firefox", () => {
    expect(stackFrames(CHROME)).toHaveLength(5);
    expect(stackFrames(FIREFOX)).toHaveLength(2);
    expect(stackFrames(undefined)).toEqual([]);
  });

  it("liste les paquets cités, un système préfixé", () => {
    expect(packagesOfStack(CHROME)).toEqual(["dnd5e-combat", "lib-wrapper", "system:dnd5e"]);
  });

  it("attribue au premier paquet non ignoré", () => {
    expect(attribute(CHROME)).toBe("dnd5e-combat");
    expect(attribute(CHROME, { ignore: ["dnd5e-combat/scripts/runtime/debug.mjs", "lib-wrapper"] })).toBe("dnd5e-combat");
    expect(attribute(CHROME, { ignore: ["dnd5e-combat", "lib-wrapper"] })).toBe("system:dnd5e");
    expect(attribute(FIREFOX)).toBe("darsh-loot");
    expect(attribute("Error: x\n    at f (https://h/scripts/foundry.mjs:1:1)")).toBeNull();
  });
});

describe("messages et signatures (§380)", () => {
  it("met les arguments de console en texte", () => {
    expect(formatArgs(["dnd5e-combat |", new TypeError("boom"), { a: 1 }, null])).toBe('dnd5e-combat | TypeError: boom {"a":1} null');
    const cyclic = {}; cyclic.self = cyclic;
    expect(formatArgs([cyclic])).toBe("[object Object]");
    expect(formatArgs(["x".repeat(5000)])).toHaveLength(MAX_MESSAGE);
    const err = new Error("e");
    expect(errorIn(["a", err])).toBe(err);
    expect(errorIn(["a"])).toBeNull();
  });

  it("ignore ce qui varie : identifiants, nombres, hôte, colonne, paramètres", () => {
    const a = signature({ message: "Token abcdefghij123456 at 12 ft", stack: CHROME });
    const b = signature({ message: "Token ZZZZZZZZZZ999999 at 30 ft",
      stack: CHROME.replace(/https:\/\/dandd\.forge-vtt\.com/g, "http://localhost:30000").replace(":12:3", ":12:40") });
    expect(a).toBe(b);
    expect(signature({ message: "Token x", stack: CHROME })).not.toBe(a);
    expect(signature({ kind: "warn", message: "Token abcdefghij123456 at 12 ft", stack: CHROME })).not.toBe(a);
    expect(signature({ message: "m", stack: FIREFOX })).toBe(signature({ message: "m", stack: FIREFOX.replace("?v=3", "?v=9") }));
  });
});

describe("anneau et journal (§380)", () => {
  it("l'anneau garde les derniers", () => {
    const r = createRing(3);
    [1, 2, 3, 4, 5].forEach(n => r.push(n));
    expect(r.list()).toEqual([3, 4, 5]);
    expect(r.last(2)).toEqual([4, 5]);
    expect(r.last(0)).toEqual([]);
    r.clear();
    expect(r.size).toBe(0);
  });

  it("compte une erreur répétée, garde la piste de la première, borne la pile", () => {
    let t = 1000;
    const log = createErrorLog({ now: () => t });
    const long = Array.from({ length: 40 }, (_, i) => `    at f${i} (https://h/modules/m/a.mjs:${i}:1)`).join("\n");
    const first = log.add({ message: "boom", stack: long, client: "GM", trail: Array.from({ length: 30 }, (_, i) => ({ t: i, kind: "use" })) });
    expect(first.isNew).toBe(true);
    expect(first.group.stack).toHaveLength(MAX_FRAMES);
    expect(first.group.trail).toHaveLength(10);
    expect(first.group.modules).toEqual(["m"]);
    t = 2000;
    const again = log.add({ message: "boom", stack: long, client: "Player 1" });
    expect(again.isNew).toBe(false);
    expect(again.group).toMatchObject({ count: 2, first: 1000, last: 2000, clients: ["GM", "Player 1"] });
    expect(log.total()).toBe(2);
  });

  it("le delta n'envoie que ce qui a compté depuis le dernier envoi, et le MJ le fusionne", () => {
    const player = createErrorLog();
    const gm = createErrorLog();
    player.add({ message: "a" });
    player.add({ message: "a" });
    player.add({ message: "b" });
    const d1 = player.delta();
    expect(d1.map(g => [g.message, g.added])).toEqual([["a", 2], ["b", 1]]);
    expect(player.delta()).toEqual([]);
    player.add({ message: "a" });
    const d2 = player.delta();
    expect(d2.map(g => [g.message, g.added])).toEqual([["a", 1]]);
    gm.add({ message: "a", client: "GM" });
    gm.merge(d1, "Player 1");
    gm.merge(d2, "Player 1");
    expect(gm.get(d1[0].sig)).toMatchObject({ count: 4, clients: ["GM", "Player 1"] });
    expect(gm.get(d1[1].sig)).toMatchObject({ count: 1, clients: ["Player 1"] });
  });

  it("au-delà de la limite, les groupes les moins récents partent", () => {
    let t = 0;
    const log = createErrorLog({ limit: 3, now: () => ++t });
    ["a", "b", "c"].forEach(m => log.add({ message: m }));
    log.add({ message: "a" });          // « a » redevient récent
    log.add({ message: "d" });
    expect(log.list().map(g => g.message).sort()).toEqual(["a", "c", "d"]);
    expect(log.size).toBe(3);
  });
});

describe("confidentialité (§380)", () => {
  it("met les utilisateurs en rôles", () => {
    const users = [{ id: "u1", name: "Bob", isGM: false }, { id: "u2", name: "Raph", isGM: true }, { id: "u3", name: "Zoé", isGM: false }];
    expect(Object.fromEntries(roleLabels(users, { gm: "MJ", player: "Joueur" }))).toEqual({ u1: "Joueur 1", u2: "MJ", u3: "Joueur 2" });
    const two = roleLabels([...users, { id: "u4", name: "Co", isGM: true }]);
    expect([two.get("u2"), two.get("u4")]).toEqual(["GM 1", "GM 2"]);
  });

  it("masque noms, monde, hôtes, paramètres, compte Forge et clés", () => {
    const scrub = createScrubber({ names: [["Zoé", "Player 2"], ["Curse of Strahd", "<world>"], ["Al", "Player 3"], ["Zoé Martin", "Player 2"]] });
    expect(scrub("Zoé Martin a lancé un sort ; zoé aussi")).toBe("Player 2 a lancé un sort ; Player 2 aussi");
    expect(scrub("Zoélie reste")).toBe("Zoélie reste");
    expect(scrub("Monde Curse of Strahd chargé, Al ici")).toBe("Monde <world> chargé, Al ici");
    expect(scrub("at f (https://dandd.forge-vtt.com/modules/x/a.mjs?v=12:3:4)")).toBe("at f (/modules/x/a.mjs:3:4)");
    expect(scrub("img https://assets.forge-vtt.com/5f1a2b3c/Visuels/zoe.webp?t=9"))
      .toBe("img https://assets.forge-vtt.com/<account>/Visuels/zoe.webp");
    expect(scrub('token=abc123 apiKey: "zzz" password=hunter2')).toBe('token=<hidden> apiKey: "<hidden>" password=<hidden>');
    expect(scrub(42)).toBe(42);
  });

  it("nettoie toutes les chaînes d'un objet sans toucher aux clés", () => {
    const scrub = createScrubber({ names: [["Zoé", "P2"]] });
    expect(scrubDeep({ Zoé: ["Zoé", { n: 1, s: "par Zoé" }], b: true }, scrub)).toEqual({ Zoé: ["P2", { n: 1, s: "par P2" }], b: true });
  });

  it("ne montre que les réglages simples", () => {
    expect(safeSettings({ a: true, b: 3, c: "full", d: "du texte libre", e: { x: 1 }, f: [1], g: NaN, h: "x".repeat(41), i: false },
      { exclude: ["i"] })).toEqual({ a: true, b: 3, c: "full" });
  });
});

const sample = () => {
  const log = createErrorLog({ now: () => 10_000 });
  log.add({ message: "boom by Zoé", stack: CHROME, module: "dnd5e-combat", label: "Brutal Strike", hook: "dnd5e.rollDamage",
    client: "GM", trail: [{ t: 8000, client: "GM", kind: "use", text: "attack · 1 target" }] });
  log.add({ message: "other", module: "darsh-loot", client: "Player 1" });
  return log.list();
};

describe("rapport (§380)", () => {
  it("garde les erreurs choisies, en temps relatifs, nettoyées", () => {
    const errors = sample();
    const scrub = createScrubber({ names: [["Zoé", "Player 2"]] });
    const report = buildReport({ now: 12_000, description: "Zoé attacked", environment: { foundry: "14.369" }, errors,
      selected: [errors.find(e => e.module === "dnd5e-combat").sig], trail: [{ t: 11_000, kind: "walk", text: "3 cells" }] }, scrub);
    expect(report.schema).toBe(1);
    expect(report.generated).toBe(new Date(12_000).toISOString());
    expect(report.description).toBe("Player 2 attacked");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ message: "boom by Player 2", count: 1, lastAgo: 2, module: "dnd5e-combat" });
    expect(report.errors[0].stack[0]).toBe("at onUse (/modules/dnd5e-combat/scripts/runtime/debug.mjs:12:3)");
    expect(report.errors[0].trail[0]).toMatchObject({ ago: 4, kind: "use" });
    expect(report.trail[0]).toMatchObject({ ago: 1, kind: "walk", text: "3 cells" });
    expect(JSON.stringify(report)).not.toMatch(/Zoé|forge-vtt/);
    expect(JSON.parse(reportJson(report))).toEqual(report);
  });

  it("s'écrit en Markdown, piles en bloc de code, sans casser les blocs", () => {
    const errors = sample();
    errors[0].message = "has ``` inside";
    const report = buildReport({ now: 12_000, environment: { foundry: "14.369", system: "dnd5e 6.0.6",
      modules: [{ id: "dnd5e-combat", version: "0.274.0" }], settings: { automationLevel: "full" } }, errors,
      flagged: [{ identifier: "rage", note: "no bonus" }], sections: [{ module: "darsh-dnd-ui", data: { theme: "bg3" } }],
      context: { actorType: "npc" } });
    const md = reportMarkdown(report);
    expect(md).toContain("## Description\n\n(none)");
    expect(md).toContain("- **modules** (1): dnd5e-combat 0.274.0");
    expect(md).toContain("- **automationLevel**: full");
    expect(md).toContain("## Token context");
    expect(md).toContain("[dnd5e-combat] error ×1 — has ˋˋˋ inside");
    expect(md).toContain("Brutal Strike · hook `dnd5e.rollDamage`");
    expect(md).toContain("- `rage` — no bonus");
    expect(md).toContain("### darsh-dnd-ui");
    expect((md.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(reportMarkdown(report, { errors: "Erreurs" })).toContain("## Erreurs");
    expect(reportMarkdown(buildReport({ now: 0 }))).toContain("No error recorded.");
  });
});

describe("GitHub (§380)", () => {
  it("lit le dépôt d'une adresse de module", () => {
    expect(githubRepo("https://github.com/Darshyne/dnd5e-combat")).toBe("Darshyne/dnd5e-combat");
    expect(githubRepo("https://github.com/Darshyne/darsh-loot.git")).toBe("Darshyne/darsh-loot");
    expect(githubRepo("github.com/a/b/issues")).toBe("a/b");
    expect(githubRepo("https://gitlab.com/a/b")).toBeNull();
    expect(githubRepo(undefined)).toBeNull();
  });

  it("propose le dépôt du module le plus mis en cause", () => {
    const repos = { "dnd5e-combat": "D/core", "darsh-loot": "D/loot" };
    expect(pickRepo([{ module: "darsh-loot", count: 5 }, { module: "dnd5e-combat", count: 2 }, { module: "x", count: 99 }], repos)).toBe("D/loot");
    expect(pickRepo([{ module: "x" }], repos, "D/core")).toBe("D/core");
  });

  it("coupe le corps à une fin de ligne, ferme le bloc de code, ajoute la note", () => {
    const body = ["intro", "```", ...Array.from({ length: 500 }, (_, i) => `    at frame${i} (/modules/m/a.mjs:${i}:1)`), "```"].join("\n");
    const cut = truncateForUrl(body, 2000, "Attach the file.");
    expect(encodeURIComponent(cut).length).toBeLessThanOrEqual(2000);
    expect(cut.endsWith("Attach the file.\n")).toBe(true);
    expect((cut.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(truncateForUrl("short", 2000, "note")).toBe("short");
  });

  it("donne l'adresse « New issue » sous la longueur voulue", () => {
    const url = issueUrl({ repo: "Darshyne/dnd5e-combat", title: "Bug: Rage", body: "x\n".repeat(10_000), max: 7000, note: "Attach." });
    expect(url.startsWith("https://github.com/Darshyne/dnd5e-combat/issues/new?title=Bug%3A%20Rage&body=")).toBe(true);
    expect(url.length).toBeLessThanOrEqual(7000);
    expect(decodeURIComponent(url.split("&body=")[1])).toMatch(/Attach\.\n$/);
    expect(issueUrl({ repo: null, body: "x" })).toBeNull();
  });
});
