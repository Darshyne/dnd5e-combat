/** Les effets posés par un item, complétés selon son contenu (SPEC §16.38, adapter/effects.mjs). */

import { setRestExpiry, setTextExpiry } from "../adapter/effects.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const EXPIRY_LABEL = {
  targetStart: "at the start of their next turn", targetEnd: "at the end of their next turn",
  sourceStart: "at the start of the source's next turn", sourceEnd: "at the end of the source's next turn"
};

export function registerEffects() {
  route("preCreateActiveEffect", effect => {
    const rest = setRestExpiry(effect);
    if ( rest ) log(`${effect.parent?.name ?? "?"}: ${effect.name} ends on a ${rest === "longRest" ? "Long Rest" : "Short Rest"}`);
    // M4 (§18.7) : la durée écrite dans le texte (« jusqu'à la fin de son prochain tour »), pour un effet posé sans durée.
    const turn = rest ? null : setTextExpiry(effect);
    if ( turn ) log(`${effect.parent?.name ?? "?"}: ${effect.name} ends ${EXPIRY_LABEL[turn]}`);
  }, { label: "effect: end on rest or next turn not applied" });
}
