/** Les effets posés par un item, complétés selon son contenu (SPEC §16.38, adapter/effects.mjs). */

import { setRestExpiry, setTextExpiry } from "../adapter/effects.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const EXPIRY_LABEL = {
  targetStart: "at the start of their next turn", targetEnd: "at the end of their next turn",
  sourceStart: "at the start of the source's next turn", sourceEnd: "at the end of the source's next turn"
};

/**
 * §146 : un effet qui naît déjà expiré. dnd5e applique l'effet d'une activité depuis sa source — et, quand l'item de la fiche l'a
 * perdu, depuis le compendium (`compendiumSource`), avec la date de début qui y est restée (`start.time` : 72 s pour la Rage du
 * Barbare pré-tiré) ; Foundry garde une date fournie (ActiveEffect#_preCreate : « Prefer user-defined duration data »). Une Rage de
 * 10 minutes « commencée » à 72 s est expirée dès sa création : au tour suivant, plus de +2 ni de résistances. Sur un acteur, un
 * effet dont la durée en secondes est déjà écoulée à sa création repart de maintenant. Un effet copié encore en cours (forme,
 * transfert) garde son début.
 */
function freshStart(effect) {
  if ( !(effect.parent instanceof Actor) ) return;
  const start = Number(effect._source.start?.time);
  const d = effect._source.duration ?? {};
  const seconds = (d.units === "seconds") ? Number(d.value) : (d.units === "minutes") ? Number(d.value) * 60
    : (d.units === "hours") ? Number(d.value) * 3600 : (d.units === "days") ? Number(d.value) * 86400 : Number(d.seconds);
  if ( !Number.isFinite(start) || !(seconds > 0) || (start + seconds > game.time.worldTime) ) return;
  effect.updateSource({ start: CONFIG.ActiveEffect.documentClass.getEffectStart?.() ?? { time: game.time.worldTime } });
  log(`${effect.parent.name}: ${effect.name} was created already expired (start ${start} s) — starts now`);
}

export function registerEffects() {
  route("preCreateActiveEffect", freshStart, { label: "effect: stale start not reset" });
  route("preCreateActiveEffect", effect => {
    const rest = setRestExpiry(effect);
    if ( rest ) log(`${effect.parent?.name ?? "?"}: ${effect.name} ends on a ${rest === "longRest" ? "Long Rest" : "Short Rest"}`);
    // M4 (§18.7) : la durée écrite dans le texte (« jusqu'à la fin de son prochain tour »), pour un effet posé sans durée.
    const turn = rest ? null : setTextExpiry(effect);
    if ( turn ) log(`${effect.parent?.name ?? "?"}: ${effect.name} ends ${EXPIRY_LABEL[turn]}`);
  }, { label: "effect: end on rest or next turn not applied" });
}
