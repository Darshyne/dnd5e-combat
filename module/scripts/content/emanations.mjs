/**
 * M7 (SPEC §18.11) : auras de monstre qui agissent, par identifiant dnd5e (Monster Manual 2024). Le rayon est celui du
 * gabarit de l'activité (ou sa portée), « sauf s'il est Neutralisé », « autre qu'un … » et l'immunité après une
 * sauvegarde réussie se lisent dans le texte anglais d'origine (core/emanation.mjs).
 */

export const EMANATIONS = Object.freeze({
  // « À la fin de chacun de ses tours, chaque créature de son choix dans l'émanation subit … » : Balor, Salamandres,
  // Élémentaire du feu, Azers (ceux-ci : « sauf s'il est Neutralisé »).
  "fire-aura": { on: "ownTurnEnd", affects: "enemy" },
  // Même forme, chaque créature : Rémorhaz, Gorgone d'airain.
  "heat-aura": { on: "ownTurnEnd" },
  "flame-aura": { on: "ownTurnEnd" },
  // Sauvegarde de chaque créature dans l'émanation à la fin du tour du porteur : Manes (vaporeux).
  "sickening-vapors": { on: "ownTurnEnd" },
  // Sauvegarde d'une créature qui commence son tour dans l'émanation.
  "stench": { on: "turnStart" },             // Blême, Hezrou, Troglodyte
  "fetid-aura": { on: "turnStart" },         // Nuée de dretchs
  "fear-aura": { on: "turnStart", affects: "enemy" },   // Diantrefosse : « any enemy that starts its turn in the aura »
  "gibbering": { on: "turnStart" },          // Bouche gibbering : la sauvegarde seule, la table d1d8 reste au MJ
  "vile-appearance": { on: "turnStart", sees: true },   // Guenaude aquatique : « and can see the hag's true form »
  // M8 (§18.14) : à sa mort, l'émanation part d'elle-même — Méphites, Squelette flamboyant, Champignon à spores, Magmatique.
  "death-burst": { on: "death" },
  "death-throes": { on: "death" }                       // Balor : « explodes when it dies »
});

/** M8 (§18.13) : Régénération — Trolls, Slaads, Oni, Gardien du bouclier, Revenant (le texte dit le reste). */
export const REGENERATIONS = Object.freeze(["regeneration"]);

/** §61 : Robustesse de la non-vie — Zombi, Zombi ogre, Zombi tyrannœil (core/fortitude.mjs). */
export const FORTITUDES = Object.freeze(["undead-fortitude"]);

/** M8 (§18.15) : ne provoque pas d'attaque d'opportunité (adapter/opportunity.mjs). */
/**
 * M8 (§18.16) : drain du maximum de PV. « bite » et « slam » sont des identifiants partagés : seul l'item dont le texte
 * anglais dit la réduction draine (adapter/drain.mjs).
 */
export const DRAINS = Object.freeze(["life-drain", "proboscis", "slam", "bite", "fell-word", "draining-kiss", "sanguine-drain", "energy-drain"]);

/** M8 (§18.17) : Avaler / Engloutir (adapter/swallow.mjs). */
export const SWALLOWS = Object.freeze(["swallow", "engulf"]);

export const NO_OPPORTUNITY = Object.freeze({
  "agile": "always",                 // Cerf, Rat
  "flyby": "flying",                 // Hibou, Chouette géante, Gargouille, Hippogriffe, Guêpe géante, Péryton, Ptéranodon…
  // Actions : « moves up to its Speed without provoking Opportunity Attacks » (le texte doit le dire, voir Engulf).
  "feral-strike": "afterUse", "frenzied-rush": "afterUse", "smelting-charge": "afterUse", "trampling-charge": "afterUse",
  "entangling-trail": "afterUse", "stomp": "afterUse", "rumbling-movement": "afterUse", "engulf": "afterUse",
  "bubble-dash": "afterUse", "watery-rush": "afterUse", "swoop": "afterUse", "blazing-movement": "afterUse",
  "charging-horn": "afterUse", "tactical-charge": "afterUse", "prowl": "afterUse"
});
