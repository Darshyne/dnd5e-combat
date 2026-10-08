import { MODULE_ID, MIN_SYSTEM_VERSION } from "./constants.mjs";
import { readUnitFactors } from "./adapter/units.mjs";
import { registerEngine } from "./runtime/engine.mjs";
import { registerUsage } from "./runtime/usage.mjs";
import { registerStorm } from "./runtime/storm.mjs";
import { registerContest } from "./runtime/contest.mjs";
import { registerConcentration } from "./runtime/concentration.mjs";
import { registerPilot } from "./runtime/pilot.mjs";
import { registerDeath } from "./runtime/death.mjs";
import { registerCoven } from "./runtime/coven.mjs";
import { registerReduction } from "./runtime/reduction.mjs";
import { registerZones } from "./runtime/zones.mjs";
import { registerAltitude } from "./runtime/altitude.mjs";
import { registerActions, approach } from "./runtime/actions.mjs";
import { registerFollow } from "./runtime/follow.mjs";
import { registerFacing } from "./runtime/facing.mjs";
import { registerTurn } from "./runtime/turn.mjs";
import { registerMetamagic } from "./runtime/metamagic.mjs";
import { registerReactions } from "./runtime/reactions.mjs";
import { registerGates } from "./runtime/gates.mjs";
import { registerPortent } from "./runtime/portent.mjs";
import { registerDispel } from "./runtime/dispel.mjs";
import { registerTriggers } from "./runtime/triggers.mjs";
import { registerContent, contentApi } from "./runtime/content.mjs";
import { registerIcons } from "./runtime/icons.mjs";
import { registerConditions } from "./runtime/conditions.mjs";
import { registerVision } from "./runtime/vision.mjs";
import { registerSpace } from "./runtime/space.mjs";
import { registerSelfAreas } from "./runtime/self-area.mjs";
import { registerAreas } from "./runtime/areas.mjs";
import { registerBursts } from "./runtime/bursts.mjs";
import { registerFelled } from "./runtime/felled.mjs";
import { registerProjectiles } from "./runtime/projectiles.mjs";
import { registerAuras } from "./runtime/auras.mjs";
import { registerEmanations } from "./runtime/emanations.mjs";
import { registerRegeneration } from "./runtime/regeneration.mjs";
import { registerFortitude } from "./runtime/fortitude.mjs";
import { registerDrain } from "./runtime/drain.mjs";
import { registerSpaceSharing } from "./runtime/space-sharing.mjs";
import { registerEmpower } from "./runtime/empower.mjs";
import { registerDischarge } from "./runtime/discharge.mjs";
import { registerSneak } from "./runtime/sneak.mjs";
import { registerMastery } from "./runtime/mastery.mjs";
import { registerFighter } from "./runtime/fighter.mjs";
import { registerBarbarian } from "./runtime/barbarian.mjs";
import { registerCantrips } from "./runtime/cantrips.mjs";
import { registerEndings } from "./runtime/endings.mjs";
import { registerActionEnd } from "./runtime/action-end.mjs";
import { registerActivityChoice } from "./runtime/activity-choice.mjs";
import { registerMonk } from "./runtime/monk.mjs";
import { registerSmite } from "./runtime/smite.mjs";
import { registerManeuverDice } from "./runtime/maneuver-dice.mjs";
import { registerRollBonus } from "./runtime/roll-bonus.mjs";
import { registerNaturalOne } from "./runtime/natural-one.mjs";
import { registerRise } from "./runtime/rise.mjs";
import { registerAfterSneak } from "./runtime/after-sneak.mjs";
import { registerSwallow } from "./runtime/swallow.mjs";
import { registerBasics } from "./runtime/basics.mjs";
import { registerFamiliars } from "./runtime/familiar.mjs";
import { basicActionData } from "./adapter/basics.mjs";
import { stopAllWalks } from "./adapter/movement.mjs";
import { budgetIssues, spendBudget } from "./runtime/neighbours.mjs";
import { registerGrapple } from "./runtime/grapple.mjs";
import { registerProne } from "./runtime/prone.mjs";
import { registerBreaks } from "./runtime/breaks.mjs";
import { registerCure } from "./runtime/cure.mjs";
import { registerCureUi } from "./ui/cure.mjs";
import { registerKindleUi } from "./ui/kindle.mjs";
import { registerHelp } from "./runtime/help.mjs";
import { registerHide } from "./runtime/hide.mjs";
import { registerSearch } from "./runtime/search.mjs";
import { registerPassivePerception } from "./runtime/passive.mjs";
import { registerIllumination } from "./runtime/illumination.mjs";
import { registerLights } from "./runtime/lights.mjs";
import { registerEffects } from "./runtime/effects.mjs";
import { registerWildShape } from "./runtime/wildshape.mjs";
import { registerEnchant } from "./runtime/enchant.mjs";
import { registerTether } from "./runtime/tether.mjs";
import { registerDefenses } from "./runtime/defenses.mjs";
import { registerSize } from "./runtime/size.mjs";
import { registerOrders } from "./runtime/orders.mjs";
import { describeRoutes } from "./runtime/router.mjs";
import { testApi } from "./runtime/testing.mjs";
import { registerPointer } from "./ui/pointer.mjs";
import { registerRecast } from "./runtime/recast.mjs";
import { registerChat } from "./ui/chat.mjs";
import { registerCompact } from "./ui/compact.mjs";
import { registerPurge } from "./runtime/purge.mjs";
import { registerPerf, perfApi } from "./runtime/perf.mjs";
import { registerFeedback } from "./ui/feedback.mjs";
import { registerTracker } from "./ui/tracker.mjs";
import { registerLightIndicator, lightState } from "./ui/illumination.mjs";
import { registerPerception } from "./ui/perception.mjs";
import { registerVigor } from "./ui/vigor.mjs";
import { registerAutomation, reportsApi } from "./ui/automation.mjs";
import { uiApi } from "./ui/api.mjs";
import { scrollSpellOf } from "./adapter/scrolls.mjs";
import { registerStabilize } from "./runtime/stabilize.mjs";
import { registerPotions } from "./runtime/potions.mjs";
import { registerOil } from "./runtime/oil.mjs";

/**
 * État global du module, exposé sur game.modules.get(MODULE_ID).api pour l'inspection.
 * `routes()` : qui écoute quel hook, dans quel ordre (runtime/router.mjs).
 * `content` : contenu livré, surcouche du monde (`set`), ce qu'un acteur déclare (`inspect`).
 * `reports` : les items signalés en partie par le MJ, et le panneau du bilan (ui/automation.mjs, SPEC §9.2).
 * `perf` : le relevé des temps du moteur sur ce client (§98, runtime/perf.mjs) — `table()`, `report()`, `longTasks()`, `reset()`.
 * `mcp` : fonctions de test appelées par le connecteur (`call-module-api`), arguments et résultats en JSON (runtime/testing.mjs).
 * `ui` : ce qu'une interface externe lit (§40.1, ui/api.mjs) — `budget(combatant)`, `movement(token)`, `issues(activity)`,
 *   `multiattackLeft(actor)`, `light(token)`, `globalLight()`. Le moteur ne connaît aucune interface.
 * `light(token)` : la lumière où se tient un token (ui/illumination.mjs) — le même que `ui.light`, gardé à ce nom.
 * `approach(token, { cells, level })` : faire marcher un token par le chemin du moteur jusqu'à la plus proche des cases
 *   données (§39.1) — pour les modules (fouille de Darsh Loot) ; le moteur n'en connaît aucun.
 * `stopWalks()` : arrêter les marches du moteur lancées par ce client (§102) — pour un module qui arrête tout (Darsh Loot : une
 *   découverte) ; seul le client qui a lancé une marche peut l'arrêter.
 * `budget.issues(actor, cost)` / `budget.spend(actor, cost)` : ce qui empêche une dépense du budget du tour, et la dépense
 *   (chez le MJ actif) — pour une action d'un module (§102). Hors combat : rien ne coûte.
 * `scrolls.spellOf(item)` : le sort d'un parchemin `{ identifier, level, school }` ou null (§48) — pour la macro de reprise des
 *   parchemins du monde (tools/macros/reprendre-parchemins.js).
 */
const state = {
  active: false, reason: null, unitFactors: null, routes: describeRoutes, content: contentApi, reports: reportsApi, mcp: testApi, perf: perfApi,
  ui: uiApi, light: lightState, approach, scrolls: { spellOf: scrollSpellOf }, basics: { data: basicActionData },
  stopWalks: stopAllWalks, budget: { issues: budgetIssues, spend: spendBudget }
};

/** Pourquoi le moteur doit rester en veille dans ce monde, ou null s'il peut tourner. */
function standbyReason() {
  // SPEC §2 : exclusif vis-à-vis de Midi-QOL. En sa présence, on ne branche rien.
  if ( game.modules.get("midi-qol")?.active ) return "midi-qol";
  if ( foundry.utils.isNewerVersion(MIN_SYSTEM_VERSION, game.system.version) ) return "system";
  return null;
}

// Les hooks se branchent dès `init` : le journal de chat rend les messages existants avant
// `ready`, et un hook de rendu posé plus tard ne les voit pas (verdicts absents après un F5).
Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = state;
  state.reason = standbyReason();
  if ( state.reason ) return;
  // L'ordre de ces appels est l'ordre d'appel des inscrits d'un même hook (runtime/router.mjs).
  // Le moteur d'abord ; la souris (ui/pointer) avant la légalité (turn) : une activité sans cible
  // passe en mode visée avant qu'on juge son budget ; le reste de l'interface en dernier.
  registerPerf();   // §98 : le seuil du relevé des temps, avant que les hooks ne tournent
  registerContent();
  registerIcons();
  registerEngine();
  registerConcentration();
  registerPilot();   // après la concentration : l'objet créé y est d'abord rattaché
  registerReduction();   // avant les 0 PV : ce que la réserve absorbe n'atteint pas la créature
  registerDeath();
  registerCoven();   // après les 0 PV : la seconde phase remplace la chute que registerDeath ne pose plus (§19.5)
  registerAltitude();   // avant le plafond du tour et les attaques d'opportunité : ils jugent le chemin aligné sur le sol
  registerActions();
  registerFollow();   // §41.3 : après les actions — le suivi marche par `approach`
  registerFacing();
  registerRecast();   // avant la souris : une relance repasse par la visée et la légalité
  registerPointer();
  registerProjectiles();   // après la visée (les cibles sont désignées), avant la légalité
  registerUsage();   // §68 : avant la métamagie et la légalité — l'emplacement choisi est celui qu'elles liront
  registerMetamagic();   // §32 : avant registerTurn — le Sort accéléré change le coût que la légalité lit
  registerTurn();
  registerGates();   // après la légalité : une porte ne s'ouvre que pour une utilisation confirmée
  registerReactions();
  registerPortent();   // §36 : Présage (Repos long, requête du devin)
  registerDispel();   // §37.2 : Dissipation de la magie
  registerTriggers();
  registerVision();
  registerSpace();
  registerConditions();
  registerAreas();
  registerContest();   // §72 : test en opposition (Combat perspicace)
  registerStorm();   // §70 : Appel de la foudre, le dé de l'orage déjà là
  registerSelfAreas();   // §47 : une zone « sur soi » se pose d'office sur le lanceur
  registerBursts();
  registerFelled();
  registerZones();
  registerAuras();
  registerEmanations();
  registerRegeneration();
  registerFortitude();   // §61 : Robustesse de la non-vie (la sauvegarde due part avec les PV, adapter/death.mjs)
  registerDrain();
  registerSpaceSharing();
  registerEmpower();   // §19.9 : Morsure vampirique (Dhampir)
  registerDischarge();   // §19.9 : Chemin vers la tombe, fin anticipée de la malédiction
  registerMastery();   // §21 : bottes d'arme (après registerTriggers : les marques consommées au même message d'attaque)
  registerSneak();   // §20 : Attaque sournoise (après registerAreas : le type de dégâts choisi est déjà posé), Frappes rusées
  registerFighter();   // §21 : Héros du champ d'honneur, styles Armes à deux mains et Armes de jet
  registerMonk();   // §24 : Frappe étourdissante, Technique de la main ouverte
  registerSmite();   // §25 : sorts de châtiment (après registerSneak : les dés du châtiment suivent ceux de l'Attaque sournoise)
  registerManeuverDice();   // §89, §90 : dés de manœuvre (Fente, Feinte, Jeu de jambes évasif, Balayage, Chassé-croisé, Frappe commandée)
  registerRollBonus();      // §90 : un dé ajouté à un test ou à l'initiative (Embuscade, Autorité naturelle, Évaluation tactique)
  registerNaturalOne();     // §93 : un 1 naturel à un Test d20 (Dons sombres de Ravenloft)
  registerRise();           // §95 : se relever à 0 PV (Cosse nécrotique, Force du tombeau, Courroux persistant)
  registerAfterSneak();     // §95 : après une Attaque sournoise (Lamentations d'outre-tombe)
  registerActivityChoice();   // §42.1 : le choix d'activité de dnd5e, répondu quand il n'y a rien à choisir
  registerCantrips();   // §23 : tours de magie (durées, soins bloqués, Glas, Frappe assurée)
  registerEndings();   // §42.2 : ce qui suit la fin d'un effet (léthargie de Hâte)
  registerActionEnd();   // §43.2 : une action met fin à un effet (requête au MJ actif)
  registerBarbarian();   // §22 : Rage entretenue, Rage implacable, Témérité (après la légalité : la question vient une fois l'usage confirmé)
  registerSwallow();
  registerBasics();
  registerFamiliars();   // §107 : vision et poche dimensionnelle des familiers (leurs actions de base : registerBasics)
  registerGrapple();
  registerProne();
  registerBreaks();
  registerCure();
  registerStabilize();   // §50 : trousse de soins
  registerPotions();   // §53 : sort d'une potion sans concentration
  registerOil();   // §54 : l'huile s'enflamme
  registerHelp();
  registerHide();
  registerSearch();
  registerPassivePerception();
  registerIllumination();
  registerLights();
  registerEffects();
  registerWildShape();
  registerEnchant();
  registerTether();
  registerDefenses();
  registerSize();
  registerOrders();   // après le budget (registerTurn) : un ordre achève le tour que la remise à neuf vient d'ouvrir
  registerCompact();   // §58 : avant registerChat — le résumé des dés précède le verdict
  registerChat();
  registerPurge();
  registerFeedback();
  registerTracker();
  registerLightIndicator();
  registerPerception();   // §62 : la brume cache à l'écran, l'ouïe montre ce qu'on entend
  registerVigor();
  registerCureUi();
  registerKindleUi();   // §52 : boîte à amadou
  registerAutomation();
  state.active = true;
});

Hooks.once("ready", () => {
  if ( state.reason === "midi-qol" ) {
    if ( game.user.isGM ) ui.notifications.warn("DND5ECOMBAT.MidiActif", { localize: true, permanent: true });
    return;
  }
  if ( state.reason === "system" ) {
    if ( game.user.isGM ) ui.notifications.warn(
      game.i18n.format("DND5ECOMBAT.SystemeTropAncien", { version: game.system.version }), { permanent: true });
    return;
  }
  state.unitFactors = readUnitFactors();
  console.log(`${MODULE_ID} | actif — dnd5e ${game.system.version}, Foundry ${game.version}`);
});
