/**
 * §439 : le message de mise à jour. Deux choses tenues ici :
 *  - le GARDE-FOU DE RELEASE : la version de `module/module.json` a sa note dans `content/releases.mjs`, chaque nouveauté et chaque
 *    risque a son texte dans les trois langues, chaque vérification conseillée existe dans le diagnostic ;
 *  - les règles pures de `core/release-notes.mjs` (quelles notes montrer, modules en retard, écarts de version, conditions).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { RELEASES } from "../module/scripts/content/releases.mjs";
import {
  compareVersions, versionGap, notesBetween, testedFor, lateModules, compatibility, matches, activeRisks, recommendedChecks,
  releaseReport, hasNews, validateReleases
} from "../module/scripts/core/release-notes.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MANIFEST = JSON.parse(read("module/module.json"));
const LANGS = Object.fromEntries(["en", "fr", "pt-BR"].map(l => [l, JSON.parse(read(`module/lang/${l}.json`))]));
const CHECK_IDS = [...read("module/scripts/runtime/diagnostic/checks.mjs").matchAll(/^\s*id: "([a-z0-9-]+)"/gm)].map(m => m[1]);

describe("garde-fou de release : les notes de version", () => {
  it("la version de module.json a sa note de nouveautés, et la table est saine", () => {
    expect(CHECK_IDS.length).toBeGreaterThan(5);
    expect(validateReleases(RELEASES, { version: MANIFEST.version, checkIds: CHECK_IDS })).toEqual([]);
  });

  it("chaque nouveauté, chaque risque et chaque vérification a son texte en en, fr et pt-BR", () => {
    const missing = [];
    for ( const r of RELEASES ) {
      const keys = [
        ...r.highlights.map(id => `DND5ECOMBAT.Nouveautes.Point.${id}`),
        ...(r.risks ?? []).flatMap(x => [`DND5ECOMBAT.Nouveautes.Risque.${x.id}.Titre`, `DND5ECOMBAT.Nouveautes.Risque.${x.id}.Texte`]),
        ...(r.checks ?? []).map(c => `DND5ECOMBAT.Diagnostic.Verif.${c.id}.Nom`)
      ];
      for ( const [lang, table] of Object.entries(LANGS) ) {
        for ( const key of keys ) if ( !table[key] ) missing.push(`${lang}.json « ${key} » (note ${r.version})`);
      }
    }
    expect(missing, "textes manquants dans module/lang/").toEqual([]);
  });

  it("aucun texte de nouveauté sans note qui le cite", () => {
    const used = new Set(RELEASES.flatMap(r => [...r.highlights.map(id => `Point.${id}`), ...(r.risks ?? []).map(x => `Risque.${x.id}`)]));
    const orphans = Object.keys(LANGS.en).map(k => /^DND5ECOMBAT\.Nouveautes\.((?:Point|Risque)\.[A-Za-z0-9]+)/.exec(k)?.[1])
      .filter(k => k && !used.has(k));
    expect(orphans).toEqual([]);
  });

  it("le français des notes n'emploie pas le pronom « on »", () => {
    const bad = Object.entries(LANGS.fr).filter(([k, v]) => k.startsWith("DND5ECOMBAT.Nouveautes.") && /(^|[\s'’(«])on\s/i.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("le garde-fou parle quand une version n'a pas sa note", () => {
    expect(validateReleases(RELEASES, { version: "99.0.0" }).join("\n")).toMatch(/99\.0\.0.*n'a pas sa note/);
    expect(validateReleases([{ version: "1.0.0", highlights: [], tested: { foundry: "14.370", system: "6.1.0" } }])).toHaveLength(1);
    expect(validateReleases([{ version: "1.0.0", highlights: ["a"], tested: { foundry: "14.370", system: "6.1.0" }, checks: [{ id: "inconnue" }] }],
      { checkIds: ["connue"] })[0]).toMatch(/inconnue du diagnostic/);
    const two = [{ version: "1.0.0", highlights: ["a"], tested: { foundry: "14", system: "6.1.0" } }, { version: "1.1.0", highlights: ["b"], tested: { foundry: "14", system: "6.1.0" } }];
    expect(validateReleases(two)[0]).toMatch(/plus récente à la plus ancienne/);
  });
});

const NOTES = [
  { version: "0.3.0", highlights: ["c"], tested: { foundry: "14.370", system: "6.1.0", books: { livre: "3.0.0" }, modules: { voisin: "0.5.0", autre: "1.2.0" } },
    risks: [{ id: "fiches", when: { module: "livre", min: "3.0.0" } }, { id: "toujours" }],
    checks: [{ id: "reparer", when: { module: "livre", min: "3.0.0" } }, { id: "marques", when: { system: "6.1.0" } }] },
  { version: "0.2.1", highlights: ["b"], tested: { foundry: "14.370", system: "6.0.6" }, checks: [{ id: "reparer" }] },
  { version: "0.2.0", highlights: ["a"], tested: { foundry: "14.360", system: "6.0.6" } }
];
const world = (over={}) => ({
  foundry: "14.370", system: "6.1.0",
  modules: [{ id: "voisin", title: "Voisin", version: "0.5.0", active: true }, { id: "autre", title: "Autre", version: "1.2.0", active: true },
    { id: "livre", title: "Le Livre", version: "3.0.0", active: true }],
  ...over
});

describe("règles du message de mise à jour", () => {
  it("compare les versions nombre par nombre", () => {
    expect(compareVersions("0.283.0", "0.282.1")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("14.370", "14.370")).toBe(0);
    expect(compareVersions("6.1", "6.1.0")).toBe(0);
  });

  it("les notes des versions sorties depuis la dernière vue, la plus récente d'abord", () => {
    expect(notesBetween(NOTES, { seen: "0.2.0", current: "0.3.0" }).map(n => n.version)).toEqual(["0.3.0", "0.2.1"]);
    expect(notesBetween(NOTES, { seen: "0.1.0", current: "0.2.1" }).map(n => n.version)).toEqual(["0.2.1", "0.2.0"]);
    expect(notesBetween(NOTES, { seen: "0.3.0", current: "0.3.0" })).toEqual([]);
    // Ouverture à la main : les dernières, jamais une note plus récente que le module installé.
    expect(notesBetween(NOTES, { current: "0.2.1", limit: 5 }).map(n => n.version)).toEqual(["0.2.1", "0.2.0"]);
    expect(testedFor(NOTES, "0.2.5").system).toBe("6.0.6");
  });

  it("les modules actifs plus anciens que la version testée", () => {
    const installed = world({ modules: [{ id: "voisin", title: "Voisin", version: "0.4.9", active: true }, { id: "autre", title: "Autre", version: "1.0.0", active: false }] });
    expect(lateModules(NOTES[0].tested, installed)).toEqual([{ id: "voisin", title: "Voisin", version: "0.4.9", tested: "0.5.0" }]);
    expect(lateModules(NOTES[0].tested, world())).toEqual([]);
    expect(lateModules(NOTES[1].tested, world())).toEqual([]);
  });

  it("l'écart d'une version avec la version testée : correctif = info, au-delà = alerte", () => {
    expect(versionGap("6.1.0", "6.1.0")).toBeNull();
    expect(versionGap("6.1.2", "6.1.0")).toEqual({ way: "newer", level: "info" });
    expect(versionGap("6.0.6", "6.1.0")).toEqual({ way: "older", level: "warn" });
    expect(versionGap("14.371", "14.370")).toEqual({ way: "newer", level: "info" });
    expect(versionGap("15.380", "14.370")).toEqual({ way: "newer", level: "warn" });
  });

  it("Foundry, le système et les livres installés face aux versions testées", () => {
    expect(compatibility(NOTES[0].tested, world())).toEqual([]);
    const old = world({ system: "6.0.6", modules: [{ id: "livre", title: "Le Livre", version: "2.2.0", active: true }] });
    expect(compatibility(NOTES[0].tested, old).map(g => [g.kind, g.way, g.level])).toEqual([["system", "older", "warn"], ["book", "older", "warn"]]);
    // Un livre absent ou inactif n'est pas un écart.
    expect(compatibility(NOTES[0].tested, world({ modules: [{ id: "livre", version: "2.2.0", active: false }] }))).toEqual([]);
  });

  it("les conditions : module actif à partir d'une version, avant une version, système", () => {
    expect(matches(null, world())).toBe(true);
    expect(matches({ module: "livre", min: "3.0.0" }, world())).toBe(true);
    expect(matches({ module: "livre", below: "3.0.0" }, world())).toBe(false);
    expect(matches({ module: "absent" }, world())).toBe(false);
    expect(matches({ system: "6.1.0" }, world({ system: "6.0.6" }))).toBe(false);
  });

  it("risques et vérifications conseillées, sans doublon, selon le monde", () => {
    const notes = notesBetween(NOTES, { seen: "0.2.0", current: "0.3.0" });
    expect(activeRisks(notes, world()).map(r => r.id)).toEqual(["fiches", "toujours"]);
    expect(recommendedChecks(notes, world()).map(c => c.id)).toEqual(["reparer", "marques"]);
    const sansLivre = world({ system: "6.0.6", modules: [] });
    expect(activeRisks(notes, sansLivre).map(r => r.id)).toEqual(["toujours"]);
    expect(recommendedChecks(notes, sansLivre).map(c => c.id)).toEqual(["reparer"]);
  });

  it("le rapport complet, et s'il y a quelque chose à dire", () => {
    const report = releaseReport(NOTES, { seen: "0.2.1", current: "0.3.0", installed: world() });
    expect(report.notes.map(n => n.version)).toEqual(["0.3.0"]);
    expect(hasNews(report)).toBe(true);
    expect(hasNews(releaseReport([], { seen: "0.1.0", current: "0.2.0", installed: world() }))).toBe(false);
  });

  it("la note livrée de la prochaine version : le Manuel 3.0.0 amène son risque et ses deux vérifications", () => {
    const next = RELEASES[0];
    const installed = { foundry: next.tested.foundry, system: next.tested.system,
      modules: [{ id: "dnd-players-handbook", title: "PHB", version: "3.0.0", active: true }] };
    const report = releaseReport(RELEASES, { seen: RELEASES[1]?.version ?? "0.0.1", current: next.version, installed });
    if ( next.version === "0.283.0" ) {
      expect(report.risks.map(r => r.id)).toEqual(["phb3Fiches"]);
      expect(report.checks.map(c => c.id)).toEqual(["phb3-subclasses", "phb3-items", "magical-effects"]);
      expect(report.compatibility).toEqual([]);
    }
  });
});
