import { registerLevel, gated, automationLevel, levelAtLeast } from "./runtime/levels.mjs";
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
import { registerActions, approach, pathTo, fleeFrom, gapCells, verticalGapCells } from "./runtime/actions.mjs";
import { registerFollow } from "./runtime/follow.mjs";
import { registerFacing } from "./runtime/facing.mjs";
import { registerTurn } from "./runtime/turn.mjs";
import { registerMetamagic } from "./runtime/metamagic.mjs";
import { registerReactions } from "./runtime/reactions.mjs";
import { registerGates } from "./runtime/gates.mjs";
import { registerPortent } from "./runtime/portent.mjs";
import { registerGrimoire } from "./runtime/grimoire.mjs";
import { registerFlee } from "./runtime/flee.mjs";
import { registerDispel } from "./runtime/dispel.mjs";
import { registerTriggers } from "./runtime/triggers.mjs";
import { registerContent, contentApi } from "./runtime/content.mjs";
import { registerIcons } from "./runtime/icons.mjs";
import { registerConditions } from "./runtime/conditions.mjs";
import { registerVision } from "./runtime/vision.mjs";
import { canSee as visionCanSee, isVisionAvailable } from "./adapter/vision.mjs";
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
import { registerLifesteal } from "./runtime/lifesteal.mjs";
import { registerDischarge } from "./runtime/discharge.mjs";
import { registerSneak } from "./runtime/sneak.mjs";
import { registerMastery } from "./runtime/mastery.mjs";
import { registerFighter } from "./runtime/fighter.mjs";
import { registerFeats } from "./runtime/feats.mjs";
import { registerEffectWhile } from "./runtime/effect-while.mjs";
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
import { registerAnimations } from "./runtime/animations.mjs";
import { basicActionData } from "./adapter/basics.mjs";
import { stopAllWalks } from "./adapter/movement.mjs";
import { budgetIssues, spendBudget, takeBasicAction, requestSave, dropHeldBy } from "./runtime/neighbours.mjs";
import { registerGrapple } from "./runtime/grapple.mjs";
import { registerProne } from "./runtime/prone.mjs";
import { registerClimb, climbApi } from "./runtime/climb.mjs";
import { registerSpeedGrants } from "./runtime/speed-grants.mjs";
import { registerBreaks } from "./runtime/breaks.mjs";
import { registerCure } from "./runtime/cure.mjs";
import { registerBlink } from "./runtime/blink.mjs";
import { registerWalls } from "./runtime/walls.mjs";
import { registerWallSide } from "./runtime/wall-side.mjs";
import { registerElevationSpells } from "./runtime/elevation-spells.mjs";
import { registerCureUi } from "./ui/cure.mjs";
import { registerWallSideUi } from "./ui/wall-side.mjs";
import { registerKindleUi } from "./ui/kindle.mjs";
import { registerSkillAid } from "./runtime/skill-aid.mjs";
import { registerSkillAidUi } from "./ui/skill-aid.mjs";
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
import { registerSummonHandover } from "./runtime/summon-handover.mjs";
import { registerAutoTranslate } from "./runtime/auto-translate.mjs";
import { registerCriticals } from "./runtime/criticals.mjs";
import { registerFalls } from "./runtime/falls.mjs";
import { registerKnockout } from "./runtime/knockout.mjs";
import { registerTheater, theaterApi } from "./runtime/theater.mjs";
import { registerReady } from "./runtime/ready.mjs";
import { registerBurning } from "./runtime/burning.mjs";
import { registerImprovised } from "./runtime/improvised.mjs";
import { registerArmorTraining } from "./runtime/armor-training.mjs";
import { isNonLethal, setNonLethal, isKnockedOut } from "./adapter/knockout.mjs";
import { describeRoutes, skippedRoutes } from "./runtime/router.mjs";
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
import { registerScatter } from "./runtime/scatter.mjs";
import { registerFlammable } from "./runtime/flammable.mjs";
import { registerWelcome, openWelcome } from "./ui/welcome.mjs";
import { registerFactions, factionsApi } from "./runtime/factions.mjs";
import { coneOf } from "./adapter/cone.mjs";
import { canHear as hearingCanHear } from "./adapter/hearing.mjs";
import { registerStealthMode, stealthApi } from "./runtime/stealth.mjs";
import { registerStealthUI } from "./ui/stealth.mjs";
import { registerFactionsUI, openFactions } from "./ui/factions.mjs";
import { registerSettingsWindow, openSettings, registerWindow } from "./ui/settings.mjs";
import { openDiagnostic } from "./ui/diagnostic.mjs";

/**
 * État global du module, exposé sur game.modules.get(MODULE_ID).api pour l'inspection.
 * `routes()` : qui écoute quel hook, dans quel ordre (runtime/router.mjs).
 * `content` : contenu livré, surcouche du monde (`set`), ce qu'un acteur déclare (`inspect`).
 * `reports` : les items signalés en partie par le MJ, et le panneau du bilan (ui/automation.mjs, SPEC §9.2).
 * `perf` : le relevé des temps du moteur sur ce client (§98, runtime/perf.mjs) — `table()`, `report()`, `longTasks()`, `reset()`.
 * `mcp` : fonctions de test appelées par le connecteur (`call-module-api`), arguments et résultats en JSON (runtime/testing.mjs).
 * `nonLethal` : `get(actor)`, `set(actor, on)` — les coups non létaux de l'acteur (§210, l'interrupteur de DAS UI) ; `knockedOut(actor)`.
 * `ui` : ce qu'une interface externe lit (§40.1, ui/api.mjs) — `budget(combatant)`, `movement(token)`, `issues(activity)`, `cost(activity)` (§137), `cell(activity)` (les deux en un calcul, §205),
 *   `ritual(activity)` (§139 : « none » / « ritual » / « ask »),
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
 * `level()` : le niveau d'automatisation du monde, « essentials » | « assisted » | « full » (§117) ; `levelAtLeast(niveau)` ;
 *   `skippedRoutes()` : les écoutes non branchées à ce niveau.
 * §179 : `approach(token, { target, reachCells, seeing })` — s'approcher d'une cible jusqu'à une allonge ou une portée (en cases), en
 *   la voyant si demandé ; `path(token, { cells | target, reachCells, seeing }, { maxCost, extra })` → `{ arrives, moves, door }` ou null — un
 *   chemin sans le parcourir (`extra` : la Vitesse en plus, pour un Sprint) ; `basics.take(actor, "dash" | "disengage" | "dodge")` — l'action de base sans item (PNJ), par le budget.
 * §180 : `flee(token, from, { extra, dryRun })` → `{ moved, from, to, reason? }` — s'éloigner d'une menace aussi loin que le
 *   déplacement du tour le permet (plus `extra`), ou seulement tester (`dryRun`) ; `save(actor, { ability, dc, advantage,
 *   disadvantage, flavor })` → `{ total, d20, dc, success }` — une sauvegarde hors résolution, sans fenêtre ; `drop(token)` → `{ items,
 *   pile, kept }` — lâcher ce qu'on tient (comme l'ordre « Lâche »).
 * `vision.canSee(observer, target)` (§178) : l'observateur voit-il la cible, selon les règles de vision du moteur (lumière, murs,
 *   vision dans le noir, brume et ténèbres, Invisible — donc une Furtivité réussie —, Aveuglé) ? `true` / `false`, ou `null` quand on
 *   ne peut pas juger (vision simulée coupée, canevas absent, token non dessiné). Tokens ou documents ; lecture seule.
 * §196 : `climb` — l'escalade pour les voisins (runtime/climb.mjs `climbApi` : `state`, `holds`, `entries`, `up`, `run`, `ceiling`,
 *   `down`, `drop`, `toward`) ; `gap(a, b)` → `{ cells, vertical }` — l'écart de deux tokens en cases, en trois dimensions (la distance
 *   du moteur, des pieds à la tête : 0 superposés, 1 au contact) et son seul vide vertical (au plafond, en vol). Lecture seule.
 * `welcome.open()` : l'écran d'accueil (§177) ; `diagnostic.open({ check })` : le diagnostic du monde (vérifications, réparation après
 *   sauvegarde, restauration), sur une seule vérification si `check` est donné (macros « Outils du MJ »).
 */
const state = {
  active: false, reason: null, unitFactors: null, routes: describeRoutes, content: contentApi, reports: reportsApi, mcp: testApi, perf: perfApi,
  ui: uiApi, light: lightState, approach, nonLethal: { get: isNonLethal, set: setNonLethal, knockedOut: isKnockedOut }, scrolls: { spellOf: scrollSpellOf }, basics: { data: basicActionData, take: takeBasicAction }, path: pathTo,
  flee: fleeFrom, save: requestSave, drop: dropHeldBy,
  stopWalks: stopAllWalks, budget: { issues: budgetIssues, spend: spendBudget },
  level: automationLevel, levelAtLeast, skippedRoutes,
  welcome: { open: openWelcome }, diagnostic: { open: openDiagnostic }, settings: { open: openSettings, registerWindow },
  vision: { canSee: publicCanSee, cone: publicCone, canHear: publicCanHear },
  factions: { ...factionsApi, open: () => openFactions() },
  sneak: stealthApi,
  climb: climbApi,
  theater: theaterApi,   // §220 : Théâtre de l'esprit — `active()`, `set(on)` ; hook `dnd5e-combat.theater`
  gap: publicGap
};

/** §196 : l'écart de deux tokens en cases (3D, et son vide vertical), pour un voisin qui juge une allonge — null s'il ne se mesure pas. */
function publicGap(a, b) {
  const da = a?.document ?? a;
  const db = b?.document ?? b;
  if ( !da?.parent?.grid || (da.parent !== db?.parent) ) return null;
  try { return { cells: gapCells(da, db), vertical: verticalGapCells(da, db) }; } catch { return null; }
}

/** §178 : la vision du moteur pour un voisin (lecture seule) — null quand la vision simulée est coupée ou ne peut pas juger. */
function publicCanSee(observer, target) {
  if ( !isVisionAvailable() ) return null;
  return visionCanSee(observer?.document ?? observer, target?.document ?? target);
}

/** §186 : l'ouïe du moteur pour un voisin (lecture seule) — murs et planchers qui arrêtent le son, Assourdi, cible cachée ; sans portée. */
function publicCanHear(observer, target) {
  return hearingCanHear(observer?.document ?? observer, target?.document ?? target);
}

/** §182 : le cône de vision d'une créature (`{ angle, rotation }`, convention du cœur), ou null quand elle voit à 360°. */
function publicCone(token) {
  return coneOf(token?.document ?? token);
}

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
  // §177 : l'accueil et le diagnostic, même en veille (le diagnostic nettoie justement les traces de Midi-QOL). Hors niveaux.
  registerWelcome({ menu: !!state.reason });
  if ( state.reason ) return;
  // L'ordre de ces appels est l'ordre d'appel des inscrits d'un même hook (runtime/router.mjs).
  // Le moteur d'abord ; la souris (ui/pointer) avant la légalité (turn) : une activité sans cible
  // passe en mode visée avant qu'on juge son budget ; le reste de l'interface en dernier.
  // §117 : le niveau d'automatisation d'abord (son réglage en tête de la fenêtre) ; chaque fonction s'inscrit selon lui.
  registerLevel();
  gated(registerTheater);   // §220 : Théâtre de l'esprit — hors des niveaux d'automatisation : son bouton existe toujours
  gated(registerPerf);   // §98 : le seuil du relevé des temps, avant que les hooks ne tournent
  gated(registerContent);
  gated(registerFactions);   // §181 : la table des factions, avant toute règle qui juge ami / ennemi
  gated(registerStealthMode);   // §183 : mode furtif des PJ (sort du mode à l'entrée en combat)
  gated(registerIcons);
  gated(registerEngine);
  gated(registerConcentration);
  gated(registerPilot);   // après la concentration : l'objet créé y est d'abord rattaché
  gated(registerReduction);   // avant les 0 PV : ce que la réserve absorbe n'atteint pas la créature
  gated(registerDeath);
  gated(registerCoven);   // après les 0 PV : la seconde phase remplace la chute que registerDeath ne pose plus (§19.5)
  gated(registerAltitude);   // avant le plafond du tour et les attaques d'opportunité : ils jugent le chemin aligné sur le sol
  gated(registerActions);
  gated(registerFollow);   // §41.3 : après les actions — le suivi marche par `approach`
  gated(registerFacing);
  gated(registerRecast);   // avant la souris : une relance repasse par la visée et la légalité
  gated(registerPointer);
  gated(registerProjectiles);   // après la visée (les cibles sont désignées), avant la légalité
  gated(registerUsage);   // §68 : avant la métamagie et la légalité — l'emplacement choisi est celui qu'elles liront
  gated(registerMetamagic);   // §32 : avant registerTurn — le Sort accéléré change le coût que la légalité lit
  gated(registerTurn);
  gated(registerGates);   // après la légalité : une porte ne s'ouvre que pour une utilisation confirmée
  gated(registerSummonHandover);   // §118 : après la légalité — une utilisation refusée ne réclame rien aux voisins
  gated(registerAutoTranslate);
  gated(registerCriticals);   // §207 : options de coup critique (écart à la CA, table de critiques), désactivées par défaut   // §204 : traduction reprise à la création (objets et créatures restés dans la langue d'origine)
  gated(registerReactions);
  gated(registerPortent);   // §36 : Présage (Repos long, requête du devin)
  gated(registerGrimoire);   // §139 : rituels sans emplacement, Restauration magique
  gated(registerFlee);   // §147 : Murmures dissonants, la fuite par la Réaction
  gated(registerDispel);   // §37.2 : Dissipation de la magie
  gated(registerTriggers);
  gated(registerVision);
  gated(registerSpace);
  gated(registerConditions);
  gated(registerAreas);
  gated(registerContest);   // §72 : test en opposition (Combat perspicace)
  gated(registerStorm);   // §70 : Appel de la foudre, le dé de l'orage déjà là
  gated(registerSelfAreas);   // §47 : une zone « sur soi » se pose d'office sur le lanceur
  gated(registerBursts);
  gated(registerFelled);
  gated(registerZones);
  gated(registerAuras);
  gated(registerEmanations);
  gated(registerRegeneration);
  gated(registerFortitude);   // §61 : Robustesse de la non-vie (la sauvegarde due part avec les PV, adapter/death.mjs)
  gated(registerDrain);
  gated(registerSpaceSharing);
  gated(registerEmpower);   // §19.9 : Morsure vampirique (Dhampir)
  gated(registerLifesteal);   // §120 : Caresse du vampire
  gated(registerDischarge);   // §19.9 : Chemin vers la tombe, fin anticipée de la malédiction
  gated(registerMastery);   // §21 : bottes d'arme (après registerTriggers : les marques consommées au même message d'attaque)
  gated(registerSneak);   // §20 : Attaque sournoise (après registerAreas : le type de dégâts choisi est déjà posé), Frappes rusées
  gated(registerFighter);   // §21 : Héros du champ d'honneur, styles Armes à deux mains et Armes de jet
  gated(registerFeats);   // §129 : Sauvagerie martiale, Guérisseur
  gated(registerEffectWhile);   // §130 : effets de don conditionnels (Défense, Duel…)
  gated(registerMonk);   // §24 : Frappe étourdissante, Technique de la main ouverte
  gated(registerSmite);   // §25 : sorts de châtiment (après registerSneak : les dés du châtiment suivent ceux de l'Attaque sournoise)
  gated(registerManeuverDice);   // §89, §90 : dés de manœuvre (Fente, Feinte, Jeu de jambes évasif, Balayage, Chassé-croisé, Frappe commandée)
  gated(registerRollBonus);      // §90 : un dé ajouté à un test ou à l'initiative (Embuscade, Autorité naturelle, Évaluation tactique)
  gated(registerNaturalOne);     // §93 : un 1 naturel à un Test d20 (Dons sombres de Ravenloft)
  gated(registerRise);           // §95 : se relever à 0 PV (Cosse nécrotique, Force du tombeau, Courroux persistant)
  gated(registerAfterSneak);     // §95 : après une Attaque sournoise (Lamentations d'outre-tombe)
  gated(registerActivityChoice);   // §42.1 : le choix d'activité de dnd5e, répondu quand il n'y a rien à choisir
  gated(registerCantrips);   // §23 : tours de magie (durées, soins bloqués, Glas, Frappe assurée)
  gated(registerEndings);   // §42.2 : ce qui suit la fin d'un effet (léthargie de Hâte)
  gated(registerActionEnd);   // §43.2 : une action met fin à un effet (requête au MJ actif)
  gated(registerBarbarian);   // §22 : Rage entretenue, Rage implacable, Témérité (après la légalité : la question vient une fois l'usage confirmé)
  gated(registerSwallow);
  gated(registerBasics);
  gated(registerAnimations);   // §112 : l'application attend la fin de l'animation (Sequencer / BLFX)
  gated(registerFamiliars);   // §107 : vision et poche dimensionnelle des familiers (leurs actions de base : registerBasics)
  gated(registerGrapple);
  gated(registerProne);
  gated(registerClimb);   // §192 : grimper aux murs, chute du grimpeur qui ne tient plus
  gated(registerFalls);   // §208 : chute automatique (« En chute » de dnd5e, vol à Vitesse 0), Pas du vent
  gated(registerKnockout);   // §210 : coups non létaux (réveil, premiers soins), surprise à l'initiative
  gated(registerReady);
  gated(registerBurning);
  gated(registerImprovised);
  gated(registerArmorTraining);   // §214 : formation au port d'armure   // §213 : armes improvisées, demandées au MJ   // §212 : En feu — brûlures au début du tour, éteindre ses flammes, propagation   // §211 : Se tenir prêt — l'action préparée, son déclencheur, la Réaction
  gated(registerSpeedGrants);   // §195 : vitesses que le contenu accorde (Athlète : escalade)
  gated(registerBreaks);
  gated(registerCure);
  gated(registerBlink);
  gated(registerWalls);
  gated(registerWallSide);   // §169 : Mur de feu — côté brûlant, anneau fin, face brûlante
  gated(registerElevationSpells);
  gated(registerStabilize);   // §50 : trousse de soins
  gated(registerPotions);   // §53 : sort d'une potion sans concentration
  gated(registerOil);   // §54 : l'huile s'enflamme
  gated(registerScatter);   // §187 : chausse-trapes et billes répandues au sol
  gated(registerFlammable);   // §188 : huile au sol, toile — zones qui s'embrasent
  gated(registerHelp);
  gated(registerSkillAid);   // §113 : Assistance et Soutien demandés pour un test de compétence (requête à l'aidant)
  gated(registerHide);
  gated(registerSearch);
  gated(registerPassivePerception);
  gated(registerIllumination);
  gated(registerLights);
  gated(registerEffects);
  gated(registerWildShape);
  gated(registerEnchant);
  gated(registerTether);
  gated(registerDefenses);
  gated(registerSize);
  gated(registerOrders);   // après le budget (registerTurn) : un ordre achève le tour que la remise à neuf vient d'ouvrir
  gated(registerCompact);   // §58 : avant registerChat — le résumé des dés précède le verdict
  gated(registerChat);
  gated(registerPurge);
  gated(registerFeedback);
  gated(registerTracker);
  gated(registerLightIndicator);
  gated(registerPerception);   // §62 : la brume cache à l'écran, l'ouïe montre ce qu'on entend
  gated(registerVigor);
  gated(registerCureUi);
  gated(registerWallSideUi);   // §171 : anneau de feu — vers l'intérieur ou vers l'extérieur
  gated(registerKindleUi);   // §52 : boîte à amadou
  gated(registerSkillAidUi);   // §113 : section « Aides » de la fenêtre de jet d'un test
  gated(registerAutomation);
  gated(registerFactionsUI);   // §181 : fenêtre, outil de la barre, HUD du token
  gated(registerStealthUI);   // §183 : raccourci du mode furtif, cônes dessinés chez le joueur
  gated(registerSettingsWindow);   // la fenêtre de réglages : en dernier, elle range au `setup` ce que les autres ont déclaré
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
  console.log(`${MODULE_ID} | active — dnd5e ${game.system.version}, Foundry ${game.version}`);
});
