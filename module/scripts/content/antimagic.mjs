/**
 * §436 : l'antimagie de dnd5e 6.1 (runtime/antimagic.mjs, adapter/antimagic.mjs).
 *  - `MAGICAL` : les capacités de monstres qui sont magiques sans être des sorts — aucune donnée ne les distingue (dnd5e n'a pas d'action
 *    Magie), d'où cette liste, relevée dans le Manuel des monstres 2024 (texte qui dit la capacité magique, téléportation, passage dans
 *    l'Éthéré, possession, charme). Une activité « lancer un sort » (`cast`) l'est toujours, sans liste. Ajoutés à la demande de
 *    l'utilisateur (2026-11-14) malgré le doute : le Changement de forme des lycanthropes et des vampires (`shape-shift`) et `roar`
 *    (identifiant porté par plusieurs monstres, que le Manuel ne dit magique que pour un seul : tous comptent comme magiques).
 *  - `ANTIMAGIC_ZONES` : les items dont la région devient un champ antimagie du système quand leur activité n'en pose pas.
 *  - `ANTIMAGIC_ZONE_LASTS` : le Cône antimagie dure jusqu'au début du tour suivant du tyrannoeil (un round).
 */

export const MAGICAL = Object.freeze(Object.fromEntries([
  "eye-rays", "darkness-aura", "negative-energy-cone", "hunger-of-yeenoghu", "luring-song", "weird-insight", "lordly-presence",
  "animate-trees", "mind-corrosion", "possession", "teleport", "deathly-teleport", "shadowy-teleport", "radiant-teleport", "etherealness",
  "ethereal-stride", "ethereal-jaunt", "warding-charm", "captains-charm", "telekinetic-thrust", "shape-shift", "roar"
].map(id => [id, true])));

export const ANTIMAGIC_ZONES = Object.freeze({ "antimagic-field": true, "antimagic-cone": true });

export const ANTIMAGIC_ZONE_LASTS = Object.freeze({ "antimagic-cone": Object.freeze({ seconds: 6 }) });
