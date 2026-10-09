/**
 * Les trois niveaux d'automatisation (SPEC §117), du plus léger au plus complet :
 *  - `essentials` (Essentiel) : déplacement à la souris, A*, menus contextuels, budget du tour, vision et lumière, interface ; les
 *    jets restent ceux de dnd5e (cartes natives, rien de résolu par le moteur) ;
 *  - `assisted` (Assisté) : + la résolution (attaque → touché → dégâts appliqués, sauvegardes, effets de l'activité) et les règles
 *    générales du PHB valables pour toute créature (états, abri, concentration, 0 PV, attaques d'opportunité, actions de base) ;
 *  - `full` (Intégral) : + le contenu par objet (sorts, aptitudes, capacités de monstres, créations d'autres modules).
 *
 * Chaque fonction du point d'entrée (`register…()` de dnd5e-combat.mjs) a son niveau minimal ; au-dessous, elle s'enregistre
 * quand même (réglages, requêtes) mais n'écoute aucun hook (runtime/router.mjs, `suspended`). Le test vérifie que chaque
 * `register…()` du point d'entrée figure ici.
 *
 * Pur : aucune dépendance à Foundry.
 */

export const LEVELS = Object.freeze(["essentials", "assisted", "full"]);
export const DEFAULT_LEVEL = "full";

/** Le rang d'un niveau (inconnu : le niveau par défaut). */
export function levelRank(level) {
  const i = LEVELS.indexOf(level);
  return i >= 0 ? i : LEVELS.indexOf(DEFAULT_LEVEL);
}

/** Le niveau `level` comprend-il ce qui demande `min` ? */
export function atLeast(level, min) {
  return levelRank(level) >= levelRank(min);
}

const E = "essentials";
const A = "assisted";
const F = "full";

/** Le niveau minimal de chaque `register…()` du point d'entrée. */
export const FEATURE_LEVELS = Object.freeze({
  // Toujours : le socle, le déplacement, la souris, le budget du tour, la vision, l'interface.
  registerPerf: E, registerContent: E, registerIcons: E, registerAltitude: E, registerActions: E, registerFollow: E,
  registerFacing: E, registerPointer: E, registerTurn: E, registerVision: E, registerSpace: E, registerBasics: E,
  registerIllumination: E, registerPerception: E, registerTracker: E, registerLightIndicator: E, registerFeedback: E,
  registerPurge: E, registerAutomation: E,

  // Assisté : la résolution, et les règles générales qui valent pour toute créature.
  registerEngine: A, registerConcentration: A, registerDeath: A, registerUsage: A, registerReactions: A, registerTriggers: A,
  registerConditions: A, registerAreas: A, registerSelfAreas: A, registerZones: A, registerGrapple: A, registerProne: A,
  registerStabilize: A, registerHelp: A, registerHide: A, registerSearch: A, registerPassivePerception: A, registerEffects: A,
  registerAnimations: A, registerActivityChoice: A, registerCompact: A, registerChat: A,

  // Intégral : ce que déclare le contenu, objet par objet.
  registerPilot: F, registerReduction: F, registerCoven: F, registerRecast: F, registerProjectiles: F, registerMetamagic: F,
  registerGates: F, registerPortent: F, registerDispel: F, registerContest: F, registerStorm: F, registerBursts: F,
  registerFelled: F, registerAuras: F, registerEmanations: F, registerRegeneration: F, registerFortitude: F, registerDrain: F,
  registerSpaceSharing: F, registerEmpower: F, registerDischarge: F, registerMastery: F, registerSneak: F, registerFighter: F,
  registerMonk: F, registerSmite: F, registerManeuverDice: F, registerRollBonus: F, registerNaturalOne: F, registerRise: F,
  registerAfterSneak: F, registerCantrips: F, registerEndings: F, registerActionEnd: F, registerBarbarian: F,
  registerSwallow: F, registerFamiliars: F, registerBreaks: F, registerCure: F, registerPotions: F, registerOil: F,
  registerSkillAid: F, registerLights: F, registerWildShape: F, registerEnchant: F, registerTether: F, registerDefenses: F,
  registerSize: F, registerOrders: F, registerVigor: F, registerCureUi: F, registerKindleUi: F, registerSkillAidUi: F
});

/** Le niveau minimal d'une fonction (absente de la table : Intégral, par prudence). */
export function featureLevel(name) {
  return FEATURE_LEVELS[name] ?? F;
}
