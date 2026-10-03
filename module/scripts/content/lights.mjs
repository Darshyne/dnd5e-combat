/**
 * Lumière et ténèbres des sorts (SPEC §16.31, clé `light` de core/content.mjs). Textes du PHB 2.2.0 (FR) et de dnd5e 6 :
 *  - Ténèbres : « des Ténèbres magiques s'étendent […] sphère de 4,50 m » ; « la vision dans le noir ne permet pas de voir à
 *    travers, et une lumière non magique ne peut pas l'éclairer » — activité utilitaire à sphère de 15 ft, rien d'autre ;
 *  - Lumière du jour : « sphère de Lumière vive de 18 m de rayon, et Lumière faible sur 18 m de plus » ; « si une partie de la
 *    zone recouvre des Ténèbres créées par un sort de niveau 3 ou inférieur, ce sort est dissipé » ;
 *  - Poussière d'étoile : la cible luit d'une Lumière faible sur 3 m (effet « Illuminé », sans changement) ;
 *  - Lueurs féeriques : « les objets et créatures affectés émettent une Lumière faible dans un rayon de 3 m » (effet « Nimbée ») ;
 *  - Lumière : l'objet touché « produit une Lumière vive sur 6 m et faible sur 6 m de plus » ; « le sort prend fin si vous le
 *    lancez à nouveau » — activité d'invocation d'un objet « Lumière » (TP, lumière 20/40 sur le token) ;
 *  - Flamme éternelle : même montage, sans fin à la relance.
 * `carried` (§16.35) : « Vous touchez un objet » — au lancement, l'objet est posé au sol ou tenu par le lanceur, au choix.
 */

/**
 * « Ne peut pas bénéficier de l'état Invisible » (§16.36, `revealsInvisible`) — Poussière d'étoile : jusqu'à la fin du prochain
 * tour du lanceur, la cible luit et perd le bénéfice d'Invisible ; Lueurs féeriques : « pendant
 * la durée du sort, les créatures affectées […] ne peuvent bénéficier de l'état Invisible ».
 */
export const REVEALS_INVISIBLE = Object.freeze(["starry-wisp", "faerie-fire"]);

export const LIGHTS = Object.freeze({
  "darkness": { on: "area", darkness: true },
  "daylight": { on: "area", bright: 60, dim: 120, units: "ft", dispels: 3 },
  "starry-wisp": { on: "effect", dim: 10, units: "ft" },
  "faerie-fire": { on: "effect", dim: 10, units: "ft" },
  // Lame de feu (§16.41) : « la lame émet une Lumière vive dans un rayon de 3 m et une Lumière faible sur 3 m de plus » — sur la
  // trace que le moteur pose au lanceur.
  "flame-blade": { on: "effect", bright: 10, dim: 20, units: "ft" },
  // Flammes (§16.42) : « une Lumière vive sur un rayon de 6 m et une Lumière faible sur 6 m de plus ».
  "produce-flame": { on: "effect", bright: 20, dim: 40, units: "ft" },
  "light": { on: "summon", carried: true, single: true },
  "continual-flame": { on: "summon", carried: true }
});
