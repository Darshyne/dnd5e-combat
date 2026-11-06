import { describe, it, expect } from "vitest";
import { coverBetween } from "../module/scripts/core/cover.mjs";
import { coverPreviewText } from "../module/scripts/core/cover-preview.mjs";

// #33 : aperçu de l'abri — sources du calcul pur, puis texte de la pastille.
const cell = (i, j) => ({ x: j * 100, y: i * 100, width: 100, height: 100 });
const attacker = cell(0, 0);
const target = cell(0, 3);
const vertical = (x, kind) => (a, b) => (((a.x < x) !== (b.x < x)) ? kind : false);

describe("sources de l'abri (core)", () => {
  it("aucune source sans abri", () => {
    expect(coverBetween({ attacker, target }).sources).toEqual([]);
  });
  it("un mur : « wall » (true vaut aussi un mur)", () => {
    expect(coverBetween({ attacker, target, blocked: vertical(200, "wall"), inset: 10 }).sources).toEqual(["wall"]);
    expect(coverBetween({ attacker, target, blocked: vertical(200, true), inset: 10 }).sources).toEqual(["wall"]);
  });
  it("une surface : « surface »", () => {
    const cover = coverBetween({ attacker, target, blocked: vertical(200, "surface"), inset: 10 });
    expect(cover).toMatchObject({ degree: "total", sources: ["surface"] });
  });
  it("une créature interposée : « creature »", () => {
    const cover = coverBetween({ attacker, target, bodies: [cell(0, 1)], inset: 10 });
    expect(cover).toMatchObject({ degree: "half", byCreature: true, sources: ["creature"] });
  });
});

const t = (key, data) => data ? `${key}${JSON.stringify(data)}` : key;
const base = { degree: "none", bonus: 0, sources: [], zone: null, manual: false, ignored: null };

describe("texte de l'aperçu", () => {
  it("dégagé", () => {
    expect(coverPreviewText(base, t)).toEqual({ css: "clear", main: "Apercu.Degage", sub: null });
  });
  it("abri partiel par un obstacle et une créature, sources dans l'ordre", () => {
    const text = coverPreviewText({ ...base, degree: "half", bonus: 2, sources: ["creature", "wall"] }, t);
    expect(text.css).toBe("half");
    expect(text.main).toBe('Apercu.Bonus{"cover":"Apercu.Nom.half","bonus":2}');
    expect(text.sub).toBe('Apercu.Par{"sources":"Apercu.Source.wall, Apercu.Source.creature"}');
  });
  it("abri total : bloqué", () => {
    expect(coverPreviewText({ ...base, degree: "total", bonus: null, sources: ["surface"] }, t).main).toBe("Apercu.Total");
  });
  it("une zone de sort est nommée", () => {
    const text = coverPreviewText({ ...base, degree: "threeQuarters", bonus: 5, sources: ["zone"], zone: "Barrière de lames" }, t);
    expect(text.sub).toBe('Apercu.Par{"sources":"Barrière de lames"}');
  });
  it("abri posé à la main", () => {
    const text = coverPreviewText({ ...base, degree: "half", bonus: 2, sources: ["manual"], manual: true }, t);
    expect(text.sub).toBe('Apercu.Par{"sources":"Apercu.Source.manual"}');
  });
  it("abri ignoré, avec ce qui l'ignore", () => {
    const text = coverPreviewText({ ...base, ignored: { degree: "threeQuarters", by: "Tireur d'élite" } }, t);
    expect(text).toEqual({ css: "ignored", main: 'Apercu.Ignore{"cover":"Apercu.Nom.threeQuarters","by":"Tireur d\'élite"}', sub: null });
  });
  it("rien sans aperçu", () => {
    expect(coverPreviewText(null, t)).toBeNull();
  });
});

describe("#33 : une créature qui coupe aussi le coin retenu est citée", () => {
  it("mur et créature : le mur décide, les deux sont cités", () => {
    const blocked = (a, b) => (b.y < 50 ? "wall" : false);   // le mur coupe les lignes vers le haut de la cible
    const cover = coverBetween({ attacker, target, bodies: [{ x: 100, y: 0, width: 100, height: 100 }], blocked, inset: 10 });
    expect(cover.degree).toBe("half");
    expect(cover.byCreature).toBe(false);
    expect(cover.sources).toEqual(["wall", "creature"]);
  });
});
