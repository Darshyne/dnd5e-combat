import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Le module se LIE-t-il sous Node comme dans le navigateur ? Vitest transforme les fichiers et laisse passer ce qu'un navigateur
 * refuse à l'import (le 2026-09-28 : `import { ROGUE }` en double dans content/index.mjs — le moteur ne se chargeait plus chez
 * le MJ, tous les tests passaient). Hors de Foundry, l'import s'arrête au premier global absent (`foundry`, `Hooks`…) : c'est
 * attendu ; une SyntaxError ou un export introuvable, non.
 */
describe("liaison du module", () => {
  it("dnd5e-combat.mjs se lie sans erreur de syntaxe ni d'export", () => {
    const entry = fileURLToPath(new URL("../module/scripts/dnd5e-combat.mjs", import.meta.url)).replace(/\\/g, "/");
    const out = execFileSync(process.execPath, ["-e",
      `import(${JSON.stringify("file:///" + entry.replace(/^\//, ""))}).then(() => console.log("ok"), e => console.log(e.name + ": " + e.message))`],
      { encoding: "utf8" }).trim();
    expect(out).not.toMatch(/^SyntaxError/);
    expect(out === "ok" || /^ReferenceError: (foundry|Hooks|game|CONFIG|canvas) is not defined/.test(out)).toBe(true);
  });
});
