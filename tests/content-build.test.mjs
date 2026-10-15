import { describe, it, expect } from "vitest";
import { BRICKS, ENTRY_TABLES } from "../module/scripts/content/index.mjs";
import { MERGE } from "../module/scripts/core/content/merge.mjs";

/**
 * Le contenu livré se compose de tables par brique puis de tables d'entrées (content/index.mjs). Deux écritures d'une même clé
 * pour un même identifiant ne se voient pas : la seconde remplace la première. Seule la fusion champ par champ (`shallow`) est
 * permise entre deux tables ; tout le reste doit être déclaré en un seul endroit.
 */
describe("composition du contenu livré", () => {
  const writes = [];
  for ( const [source, key] of BRICKS ) {
    const ids = Array.isArray(source) ? source : Object.keys(source);
    for ( const id of ids ) for ( const k of (key ? [key] : Object.keys(source[id])) ) writes.push({ id, key: k, from: "brique" });
  }
  ENTRY_TABLES.forEach((table, i) => {
    for ( const [id, entry] of Object.entries(table) ) for ( const k of Object.keys(entry) ) writes.push({ id, key: k, from: `table ${i}` });
  });

  it("aucune clé écrite deux fois pour un même identifiant (hors fusion champ par champ)", () => {
    const seen = new Map();
    const twice = [];
    for ( const w of writes ) {
      const tag = `${w.id}.${w.key}`;
      if ( seen.has(tag) && (MERGE[w.key] !== "shallow") ) twice.push(`${tag} : ${seen.get(tag)} puis ${w.from}`);
      seen.set(tag, w.from);
    }
    expect(twice).toEqual([]);
  });
});
