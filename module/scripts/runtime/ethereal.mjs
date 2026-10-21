/**
 * §225 : passer des créatures dans le plan Éthéré ou les en faire revenir — l'état `ethereal` de dnd5e, celui que le menu des états du
 * HUD du token pose aussi. Pour la macro du compendium « Outils du MJ » et les voisins : `api.ethereal.toggle(tokens, active)`.
 */

import { isEthereal, perceivesPlane } from "../adapter/plane.mjs";
import { log } from "./shared.mjs";

const docOf = t => t?.document ?? t;

/**
 * Bascule l'état Éthéré des tokens donnés (par défaut les tokens contrôlés). `active` : true / false force le sens ; sans lui, chaque
 * token passe de l'un à l'autre — sauf un groupe mixte, qui passe tout entier dans l'Éthéré.
 * @returns {Promise<Array<{name: string, ethereal: boolean}>>}
 */
export async function toggleEthereal(tokens=null, active=null) {
  const docs = (tokens ?? canvas?.tokens?.controlled ?? []).map(docOf).filter(d => d?.actor?.isOwner);
  if ( active === null ) active = !docs.every(d => isEthereal(d));
  const out = [];
  for ( const doc of docs ) {
    if ( isEthereal(doc) !== active ) await doc.actor.toggleStatusEffect("ethereal", { active });
    out.push({ name: doc.name, ethereal: active });
    log(`${doc.name}: ${active ? "enters" : "leaves"} the Ethereal Plane`);
  }
  return out;
}

export const etherealApi = Object.freeze({
  is: t => isEthereal(docOf(t)),
  perceives: (observer, target) => perceivesPlane(docOf(observer), docOf(target)),
  toggle: toggleEthereal
});
