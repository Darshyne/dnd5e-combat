/**
 * §171 : un anneau de feu posé (Mur de feu, variante anneau) — chez celui qui l'a posé, de quel côté il brûle : vers l'intérieur (ce qui
 * est dedans brûle) ou vers l'extérieur (ce qui est dedans est protégé). Fermer la fenêtre garde le côté du moteur (celui où le lanceur
 * n'est pas). L'interface demande ; runtime/wall-side.mjs écrit, par le MJ actif.
 */

import { wallSideRuleOf, wallGeometryOf } from "../adapter/wall-side.mjs";
import { flipWallSide } from "../runtime/wall-side.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

/** Rend +1 (vers l'intérieur), -1 (vers l'extérieur) ou null (fenêtre fermée). */
async function askRingSide(name) {
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: name, icon: "fa-solid fa-fire" },
    content: `<p>${loc("MurFace.Question")}</p>`,
    buttons: [
      { action: "inward", label: loc("MurFace.Interieur"), icon: "fa-solid fa-arrows-to-circle", default: true, callback: () => 1 },
      { action: "outward", label: loc("MurFace.Exterieur"), icon: "fa-solid fa-arrows-left-right-to-line", callback: () => -1 }
    ],
    rejectClose: false
  }).catch(() => null);
  return [1, -1].includes(answer) ? answer : null;
}

async function onCreate(region, options, userId) {
  if ( (userId !== game.user.id) || !wallSideRuleOf(region) || !wallGeometryOf(region)?.ring ) return;
  const side = await askRingSide(region.name.replace(/\s*\[.*\]$/, ""));
  if ( side ) await flipWallSide(region, side);
}

export function registerWallSideUi() {
  route("createRegion", onCreate, { label: "wall: ring side not asked" });
}
