/**
 * Balayage des 391 sorts du Manuel des joueurs dans l'« Arène des sorts » (`tools/lib/balayage.mjs` : les invariants vérifiés). Le
 * relevé de lecture (`prive/RELEVE_SORTS.md`) disait ce que chaque sort DEVRAIT faire ; plus de la moitié n'avaient jamais été joués
 * par un scénario (relevé des trous, 2026-10-22). Ne se joue que nommé : `node tools/scenario.mjs balayage-sorts`. Variables :
 * `NIVEAUX=0-3`, `SORTS=fireball,web` (identifiants), `DEPUIS=<identifiant>` (reprendre), `PILE=1` (piles d'erreurs complètes).
 * §406 : `MONTEE=2` lance chaque sort de niveau 1+ dont les dés montent deux niveaux au-dessus du sien et vérifie le nombre de dés
 * (invariant 8) ; rapport `prive/balayages/sorts-montee-<date>.md`.
 */
import { sweep } from "../lib/balayage.mjs";
import { ARENE_SORTS } from "../lib/stages.mjs";

const [lo, hi] = (process.env.NIVEAUX ?? "0-9").split("-").map(Number);
const only = (process.env.SORTS ?? "").split(",").filter(Boolean);
const upcast = Math.max(0, Number(process.env.MONTEE) || 0);

export default {
  name: "balayage des sorts du Manuel des joueurs (Arène des sorts)",
  scene: ARENE_SORTS.name,
  audit: true,
  run: ctx => sweep(ctx, {
    kind: upcast ? "sorts-montee" : "sorts",
    upcast,
    packs: ["dnd-players-handbook.spells"],
    select: d => (d.type === "spell")
      && (only.length ? only.includes(d.system.identifier) : (d.system.level >= lo) && (d.system.level <= (hi ?? lo))),
    sortKey: d => `${d.system.level}|${d.name}`,
    lend: { method: "spell", prepared: 1 },
    consume: true
  })
};
