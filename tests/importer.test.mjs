/**
 * Diagnostic du monde : les objets d'un importeur peuvent porter leurs activités et leurs effets sous d'autres ids que l'objet
 * officiel (§245) — vrai de DDB Importer, que le moteur connaît, et d'autres importeurs, qu'un module compagnon déclare
 * (`api.diagnostic.registerImporter`). Le moteur n'en nomme aucun autre.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DDB_IMPORTER, importerErrors, importerOf } from "../module/scripts/core/importer.mjs";

const read = path => readFileSync(new URL(`../module/${path}`, import.meta.url), "utf8");
const other = { id: "other-importer", flag: "otherimporter", name: "Items imported by Other" };

describe("importerOf — l'importeur d'un objet d'après ses flags", () => {
  it("DDB Importer sans rien déclarer ; un importeur déclaré ; ni l'un ni l'autre", () => {
    expect(importerOf({ ddbimporter: { id: 1 } })).toBe("ddb");
    expect(importerOf({ otherimporter: { page: "spells" } })).toBeNull();
    expect(importerOf({ otherimporter: { page: "spells" } }, [other])).toBe("other-importer");
    expect(importerOf({ "dnd5e-combat": {} }, [other])).toBeNull();
    expect(importerOf({}, [other])).toBeNull();
    expect(importerOf(null, [other])).toBeNull();
    expect(importerOf(undefined)).toBeNull();
  });
  it("un objet passé par deux importeurs n'est compté qu'une fois : par DDB Importer, puis dans l'ordre des déclarations", () => {
    expect(importerOf({ otherimporter: {}, ddbimporter: { id: 2 } }, [other])).toBe("ddb");
    const second = { id: "second", flag: "second" };
    expect(importerOf({ otherimporter: {}, second: {} }, [other, second])).toBe("other-importer");
    expect(importerOf({ otherimporter: {}, second: {} }, [second, other])).toBe("second");
  });
});

describe("importerErrors — la déclaration d'un importeur", () => {
  it("une bonne déclaration : rien", () => {
    expect(importerErrors(other)).toEqual([]);
    expect(importerErrors({ ...other, hint: "Help", icon: "fa-solid fa-file-import" })).toEqual([]);
  });
  it("id, flag et nom sont requis, à la bonne forme", () => {
    expect(importerErrors(null).length).toBe(1);
    expect(importerErrors({ ...other, id: "Other Importer" }).join()).toMatch(/^id:/);
    expect(importerErrors({ ...other, flag: "" }).join()).toMatch(/^flag:/);
    expect(importerErrors({ ...other, name: "  " }).join()).toMatch(/^name:/);
    expect(importerErrors({ ...other, hint: 3 }).join()).toMatch(/^hint:/);
  });
  it("ni l'id ni le flag de DDB Importer, ni ceux d'un importeur déjà déclaré", () => {
    expect(importerErrors({ ...other, id: DDB_IMPORTER.id }).join()).toMatch(/already taken/);
    expect(importerErrors({ ...other, flag: DDB_IMPORTER.flag }).join()).toMatch(/already belongs to "ddb"/);
    expect(importerErrors({ ...other, id: "again" }, [other]).join()).toMatch(/already belongs to "other-importer"/);
    expect(importerErrors({ ...other, flag: "again" }, [other]).join()).toMatch(/already taken/);
  });
});

describe("le moteur ne nomme que DDB Importer", () => {
  it("aucun autre importeur dans le code du diagnostic, ses traductions, ni l'API", () => {
    const sources = ["scripts/core/importer.mjs", "scripts/runtime/diagnostic/checks.mjs", "scripts/runtime/diagnostic/index.mjs",
      "scripts/ui/diagnostic.mjs", "lang/en.json", "lang/fr.json", "lang/it.json"].map(read).join("\n");
    expect(sources).not.toMatch(/plutonium/i);
  });
  it("la vérification d'un importeur déclaré porte son propre nom et sa propre aide", () => {
    const ui = read("scripts/ui/diagnostic.mjs");
    expect(ui).toContain("check.name ?? loc(`Diagnostic.Verif.${check.id}.Nom`)");
    expect(ui).toContain("check.hint ?? loc(`Diagnostic.Verif.${check.id}.Aide`)");
    expect(read("scripts/dnd5e-combat.mjs")).toContain("registerImporter, unregisterImporter })");
  });
});
