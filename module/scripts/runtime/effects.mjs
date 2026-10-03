/** Les effets posés par un item, complétés selon son contenu (SPEC §16.38, adapter/effects.mjs). */

import { setRestExpiry, setTextExpiry } from "../adapter/effects.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const EXPIRY_LABEL = {
  targetStart: "au début de son prochain tour", targetEnd: "à la fin de son prochain tour",
  sourceStart: "au début du prochain tour de la source", sourceEnd: "à la fin du prochain tour de la source"
};

export function registerEffects() {
  route("preCreateActiveEffect", effect => {
    const rest = setRestExpiry(effect);
    if ( rest ) log(`${effect.parent?.name ?? "?"} : ${effect.name} prend fin au ${rest === "longRest" ? "repos long" : "repos court"}`);
    // M4 (§18.7) : la durée écrite dans le texte (« jusqu'à la fin de son prochain tour »), pour un effet posé sans durée.
    const turn = rest ? null : setTextExpiry(effect);
    if ( turn ) log(`${effect.parent?.name ?? "?"} : ${effect.name} prend fin ${EXPIRY_LABEL[turn]}`);
  }, { label: "effet : fin au repos ou au prochain tour non posée" });
}
