/**
 * §439 : les notes de version du moteur, de la plus récente à la plus ancienne — ce que le message de mise à jour montre au MJ à la
 * première ouverture d'un monde après une mise à jour (ui/release-notes.mjs, règles dans core/release-notes.mjs).
 *
 * UNE ENTRÉE PAR VERSION PUBLIÉE, ajoutée en tête au moment du changement de version de `module/module.json`
 * (tests/release-notes.test.mjs échoue sinon) :
 *  - `version`    : celle de `module.json`.
 *  - `highlights` : les nouveautés, quelques-unes. Chaque id a son texte `DND5ECOMBAT.Nouveautes.Point.<id>` dans module/lang/
 *                   (en, fr, pt-BR) : une phrase pour un MJ, pas pour un développeur.
 *  - `tested`     : avec quoi cette version a été jouée sur le banc de test (les versions du résumé de la dernière passe complète) —
 *                   `foundry`, `system` (dnd5e), `books` (modules premium, par id), `modules` (le reste de la suite DAS, par id :
 *                   la version la plus ancienne avec laquelle cette version du moteur a été testée). Ces ids sont des données
 *                   d'affichage : le moteur ne demande rien à ces modules.
 *  - `risks`      : les risques de compatibilité écrits à la main, `{ id, when? }` — textes `Nouveautes.Risque.<id>.Titre` / `.Texte`.
 *  - `checks`     : les vérifications du Diagnostic du monde conseillées, `{ id, when? }` (id de runtime/diagnostic/checks.mjs).
 *  `when` : `{ module, min?, below? }` (ce module est actif, à partir de `min`, avant `below`) et / ou `{ system: "6.1.0" }`.
 */

const PHB = "dnd-players-handbook";

export const RELEASES = Object.freeze([
  {
    version: "0.283.0",
    highlights: ["dnd61", "antimagie", "phb3", "tokensVideo", "ptBR"],
    tested: {
      foundry: "14.370",
      system: "6.1.0",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.35.0", "darsh-loot": "0.21.0", "dnd5e-lumiere": "0.15.0", "darsh-animations": "0.15.1",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [{ id: "phb3Fiches", when: { module: PHB, min: "3.0.0" } }],
    checks: [
      { id: "phb3-subclasses", when: { module: PHB, min: "3.0.0" } },
      { id: "phb3-items", when: { module: PHB, min: "3.0.0" } },
      { id: "magical-effects", when: { system: "6.1.0" } }
    ]
  },
  {
    version: "0.282.1",
    highlights: ["niveauDeLancement", "visionDuDiable"],
    tested: {
      foundry: "14.370",
      system: "6.0.6",
      books: { [PHB]: "2.2.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0" },
      modules: {}
    }
  }
]);
