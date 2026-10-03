/**
 * Les items dont l'utilisation laisse une trace sur le lanceur (SPEC §16.9, clé `trace` de core/content.mjs) : un
 * effet qui porte leurs déclarations `via: "effect"`, faute d'effet dans les données de l'item.
 */

export const TRACES = Object.freeze([
  // Armure d'Agathys (PHB, spells) : des PV temporaires (activité de soin) et une riposte (activité de dégâts), aucun effet.
  "armor-of-agathys"
]);

/**
 * Traces précisées (§16.41, `trace: { activity, show, attack }`). Lame de feu (PHB 2024) : « vous faites apparaître une lame
 * enflammée dans votre main libre ; elle dure pour la durée du sort » (concentration, 10 minutes) ; « par une action Magie, vous
 * pouvez faire une attaque de sort au corps à corps avec la lame » — activités « Invoquer une lame » (`OIU1htXAoSF0cU3U`, qui
 * dépense l'emplacement) et l'attaque (`dnd5eactivity000`, sans emplacement). dnd5e ne pose aucun effet : rien ne montrait la
 * lame, ni ne la retirait à la fin de la concentration.
 */
export const TRACE_RULES = Object.freeze({
  "flame-blade": { activity: "OIU1htXAoSF0cU3U", show: true, attack: "dnd5eactivity000" },
  // Flammes (PHB 2024) : « une flamme vacillante prend vie dans votre main et y reste pour la durée » (10 minutes, sans
  // concentration) ; « le sort prend fin si vous le lancez à nouveau » (la trace est remplacée) ; « jusqu'à la fin du sort, vous
  // pouvez faire une action Magie pour projeter des flammes » — « Incanter » (`MModRd17Oi6hhztj`), « Projeter des flammes »
  // (`tqKlIEdglRYdqHrp`).
  "produce-flame": { activity: "MModRd17Oi6hhztj", show: true, attack: "tqKlIEdglRYdqHrp" },
  // Voile défensif (§16.46, PHB 2024 : concentration, 1 minute) : l'activité ne pose aucun effet — la trace le porte.
  "blade-ward": { activity: "1wca3rjsdb0agWqk", show: true }
});
