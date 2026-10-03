/**
 * Liens (SPEC §16.43, clés `tether` et `ranges`). Trait ensorcelé (PHB 2024, portée 18 m, concentration 1 minute) : un arc de foudre
 * relie le lanceur à la cible ; aux tours suivants, une action Bonus lui inflige 1d12 de foudre sans jet, que la première attaque
 * ait touché ou non ; le lien se rompt si la cible quitte la portée ou se trouve derrière un abri total. dnd5e 6 (PHB 2.2.0) :
 * l'attaque (`dnd5eactivity000`, portée « personnelle » dans les données), l'effet « Foudre continue » posé au toucher
 * seulement, et « Bonus Action Damage » (`ffuqn0xdclG9YAQt`, 1d12, sans cible).
 */

export const TETHERS = Object.freeze({
  "witch-bolt": {
    ranges: { "dnd5eactivity000": { value: 60, units: "ft" } },
    tether: { attack: "dnd5eactivity000", activity: "ffuqn0xdclG9YAQt", range: { value: 60, units: "ft" } },
    atTurnStart: { activity: "ffuqn0xdclG9YAQt" }
  }
});
