/**
 * Fonctions de test exposées au connecteur MCP (`call-module-api`, connecteur ≥ 0.28.0) sous
 * `game.modules.get("dnd5e-combat").api.mcp` : ce que les scénarios (tools/scenarios/) ne peuvent pas
 * faire par les outils génériques — faire marcher un token par le chemin du MOTEUR (A*, escaliers,
 * budget), comme un clic. Arguments et résultats en JSON (ids, cases, points), jamais de document.
 *
 * Client du MJ seulement (celui qui exécute le connecteur), sur la scène qu'il affiche : l'A* lit le
 * canevas (murs, polygones des régions).
 */

import { MODULE_ID } from "../constants.mjs";
import { perfApi } from "./perf.mjs";
import { reports as itemReports } from "../adapter/automation.mjs";
import { rollDamageFor } from "../adapter/messages.mjs";
import { reportsText } from "../core/automation.mjs";
import { identifierOf, contentOf } from "../adapter/content.mjs";
import { animationState } from "./animations.mjs";
import { carriedLightState } from "../adapter/lights.mjs";
import { toggleCarriedLight } from "./lights.mjs";
import { listBackups as diagBackups, repairTasks, restore as diagRestore, scanWorld } from "./diagnostic/index.mjs";
import { gmOnly, windows, viewedToken } from "./testing-shared.mjs";
import { climbEntries } from "./climb.mjs";
import { climbSystemOn } from "../core/climb-system.mjs";
import { flight, hoist, grab, jump, climb, climbState, climbHolds, climbToward, climbCeiling, climbDown, reachCheck, dropDown, rawMove, dash, door, lock, familiar, familiarPocket, familiarRecall, follow, followState, move, movement, plan, stairs, stairsAt, takeStairs, teleport, teleportPick, threats, transpose, unfollow, view } from "./testing-moves.mjs";
import { range, ready, burning, actionEnd, attackReasons, budget, cover, effectOrigins, enchant, endings, factions, heal, hurt, identify, issues, naturalOne, overrideContent, perceived, portent, rollCheck, rollSave, saveChance, flammable, scatter, sees, skillAid, skillAids, stats, stealth, use, masteries, etherealWalls, groupRoll, groupRollState, groupRollBreakdown } from "./testing-rules.mjs";
import { placeRegionAt, planning, storm, stormStrike, summonAt, wall, wallSide } from "./testing-areas.mjs";

/** Ferme une fenêtre (un dialogue fermé vaut « non » : le déplacement mis en pause par le cœur se termine). */
async function closeWindow({ id }) {
  gmOnly();
  const app = foundry.applications.instances.get(id);
  if ( !app ) return { closed: false };
  await app.close();
  return { closed: true };
}

/** Les items signalés en partie par le MJ (SPEC §9.2), pour le bilan relu par Claude. */
function reports() {
  return { entries: itemReports(), text: reportsText(itemReports()) };
}

/**
 * Le clic sur « Dégâts » ou « Soins » d'une carte d'utilisation dont le moteur attend le jet de l'auteur (soins, dégâts
 * laissés au système) : ce que le connecteur ne fait pas seul (il ne lance que les attaques). Même chemin que le moteur
 * (adapter/messages.mjs, `rollDamageFor`) : le jet est rattaché à la carte, sur les cibles de la résolution.
 */
async function rollCard({ messageId }) {
  gmOnly();
  const carrier = game.messages.get(messageId);
  if ( !carrier ) throw new Error(`message ${messageId} not found`);
  const resolution = carrier.getFlag(MODULE_ID, "resolution");
  if ( !resolution ) throw new Error(`message ${messageId}: no engine resolution`);
  const rolls = await rollDamageFor(carrier, resolution, false);
  return { rolled: !!rolls, step: resolution.step ?? null };
}

/**
 * §121 : allumer ou éteindre une source portée sans passer par son activité (la Torche n'en a pas), comme le menu de l'inventaire ;
 * rend le résultat et l'état de la source. `on` absent : l'inverse.
 */
async function toggleLight({ actorId, itemId, on=null }) {
  gmOnly();
  const item = game.actors.get(actorId)?.items.get(itemId);
  if ( !item ) throw new Error("item not found");
  const result = await toggleCarriedLight(item, on);
  return { ...result, state: item.actor?.items.get(itemId) ? carriedLightState(item) : null };
}

/** §121 : l'état d'une source portée (allumée, temps restant, combustible), ou null si elle n'est plus là. */
function lightState({ actorId, itemId }) {
  const item = game.actors.get(actorId)?.items.get(itemId);
  return item ? carriedLightState(item) : null;
}

/** §121 : faire passer le temps du monde (secondes, négatif pour revenir en arrière) ; rend le temps du monde. */
async function advanceTime({ seconds }) {
  gmOnly();
  await game.time.advance(Number(seconds) || 0);
  return { worldTime: game.time.worldTime };
}

/**
 * Rend un item à un acteur sous son identifiant d'origine (`keepId`), pour un scénario qui le lui a fait perdre (Lâche
 * d'Injonction posée en tas par un module voisin) : le connecteur crée toujours un nouvel identifiant, et le filet de sécurité du lanceur
 * retire les items qu'il ne connaissait pas.
 */
async function restoreItem({ actorId, itemData }) {
  gmOnly();
  const actor = game.actors.get(actorId);
  if ( !actor ) throw new Error(`actor ${actorId} not found`);
  if ( actor.items.has(itemData?._id) ) return { restored: false, id: itemData._id };
  const [item] = await actor.createEmbeddedDocuments("Item", [itemData], { keepId: true });
  return { restored: !!item, id: item?.id ?? null };
}

/** §98 : le relevé des temps du moteur sur le client du MJ (les `limit` lignes les plus coûteuses), et les tâches longues. */
function perf({ limit=20, reset=false }={}) {
  const out = { hooks: perfApi.report().slice(0, limit), longTasks: perfApi.longTasks() };
  if ( reset ) perfApi.reset();
  return out;
}

/** Heure de chargement du code du moteur dans ce client : change à chaque rechargement. */
const BOOTED_AT = Date.now();

/**
 * L'état du client qui exécute (le MJ du connecteur) : version et heure de chargement du moteur, et s'il est le MJ actif
 * — celui qui exécute le moteur (`game.users.activeGM`). `tools/reload.mjs` s'en sert pour savoir que le F5 a eu lieu.
 */
function status() {
  return { version: game.modules.get(MODULE_ID)?.version ?? null, bootedAt: BOOTED_AT, ready: game.ready === true, hidden: document.hidden === true, worldTime: game.time?.worldTime ?? null,
    user: game.user.name, activeGM: game.users.activeGM?.id === game.user.id };
}

/**
 * Lance une macro (par son uuid : monde ou compendium « Outils du MJ », §56) sans attendre sa fin : ses fenêtres se lisent et se
 * répondent ensuite par `list-dialogs` / `answer-dialog` du connecteur. Réservé au MJ.
 */
async function runMacro({ uuid }={}) {
  gmOnly();
  const macro = await fromUuid(uuid);
  if ( !(macro instanceof Macro) ) throw new Error(`not a macro: ${uuid}`);
  Promise.resolve(macro.execute()).catch(err => console.error(`${MODULE_ID} | macro "${macro.name}"`, err));
  return { started: macro.name };
}

/**
 * Le F5 du client du MJ, pour qu'il relise le code du moteur après un changement : la réponse part avant le rechargement.
 * Réservé au MJ ; `call-module-api` n'existe que dans un monde où le réglage « Outils de test » du connecteur est activé.
 */
function reload() {
  gmOnly();
  setTimeout(() => window.location.reload(), 300);
  return { reloading: true, bootedAt: BOOTED_AT };
}

/**
 * L'inventaire des capacités du monde (acteurs du monde, pas les tokens non liés) : une ligne par identifiant et type d'item,
 * avec qui la porte, ce que le moteur en connaît (`rules` : les clés de contenu), ses activités, ses effets et le début de son
 * texte anglais d'origine. `types` filtre les types d'item (par défaut tout sauf l'équipement de base et le butin).
 */
function inventory({ types=null, textLength=700 }={}) {
  const skip = new Set(["loot", "container", "class", "subclass", "background", "race"]);
  const rows = new Map();
  for ( const actor of game.actors ) {
    if ( !["character", "npc"].includes(actor.type) ) continue;
    for ( const item of actor.items ) {
      if ( types ? !types.includes(item.type) : skip.has(item.type) ) continue;
      const { id, from } = identifierOf(item);
      const key = `${item.type}|${id ?? item.name}`;
      let row = rows.get(key);
      if ( !row ) {
        const text = String(item.flags?.babele?.originalPayload?.description ?? item.system?.description?.value ?? "")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        row = { identifier: id, from, type: item.type, names: [], actors: [], rules: Object.keys(contentOf(item).entry ?? {}),
          activities: Array.from(item.system.activities ?? []).map(a => a.type), effects: item.effects.size,
          level: item.system.level ?? null, source: item._stats?.compendiumSource ?? null, text: text.slice(0, textLength) };
        rows.set(key, row);
      }
      if ( !row.names.includes(item.name) ) row.names.push(item.name);
      row.actors.push(`${actor.name}${actor.hasPlayerOwner ? " (PC)" : ""}`);
    }
  }
  return Array.from(rows.values()).sort((a, b) => (b.actors.length - a.actors.length) || String(a.identifier).localeCompare(String(b.identifier)));
}

/**
 * §220, §224 : les boutons du moteur dans la barre d'outils des jetons (`present`, `active`) et, pour un token, ce que l'escalade propose
 * dans son menu (libellés) — l'interrupteur de l'escalade lu par le scénario `escalade-interrupteur`.
 */
function controls({ tokenId=null }={}) {
  const tools = ui.controls?.controls?.tokens?.tools ?? {};
  const tool = name => ({ present: name in tools, active: tools[name]?.active === true });
  const token = tokenId ? viewedToken({ tokenId }) : null;
  return { theater: tool("das-theater"), climb: tool("das-climb"), climbSystem: climbSystemOn(),
    climbEntries: token ? climbEntries(token).map(e => e.label) : null };
}

/**
 * §240 : les entrées du menu contextuel de `targetId` pour `tokenId` (pris en main le temps de la lecture), lues par l'API publique
 * `api.ui.tokenMenu` — `runtime/` n'importe pas `ui/`. `run` : lance l'entrée de ce libellé sans l'attendre (un jet peut ouvrir une
 * fenêtre) ; la prise en main d'avant revient quand elle a fini.
 */
function menu({ tokenId, targetId, run=null }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const target = viewedToken({ tokenId: targetId });
  const before = canvas.tokens.controlled.map(t => t.document.id);
  const giveBack = () => {
    canvas.tokens.releaseAll();
    for ( const id of before ) canvas.tokens.get(id)?.control({ releaseOthers: false });
  };
  token.object.control({ releaseOthers: true });
  let entries;
  try { entries = game.modules.get(MODULE_ID).api.ui.tokenMenu(target); }
  catch(err) { giveBack(); throw err; }
  const labels = entries.map(e => e.label);
  const entry = run ? entries.find(e => e.label === run) : null;
  if ( !entry ) {
    giveBack();
    if ( run ) throw new Error(`no menu entry « ${run} » (${labels.join(" | ")})`);
    return { labels };
  }
  Promise.resolve(entry.run()).catch(err => console.error(`${MODULE_ID} | test menu`, err)).finally(giveBack);
  return { labels, started: true };
}

/**
 * Un réglage du moteur (et de lui seul) : rend la valeur d'avant, pour qu'un scénario la remette ; `value` absent : lecture seule.
 * Réservé au MJ (§38.4 : le scénario `presage` désactive le Présage le temps d'une partie).
 */
async function setting({ key, value }) {
  gmOnly();
  if ( !game.settings.settings.has(`${MODULE_ID}.${key}`) ) throw new Error(`unknown setting: ${key}`);
  const before = game.settings.get(MODULE_ID, key);
  if ( value !== undefined ) await game.settings.set(MODULE_ID, key, value);
  return { key, before, now: game.settings.get(MODULE_ID, key) };
}

/**
 * Affiche une scène chez le MJ (`Scene#view`) : activer une scène déjà active ne change pas ce que le MJ regarde (vu le 2026-10-22 :
 * un balayage joué contre l'Arène de test, affichée, l'Arène des sorts étant active). Rend la scène affichée.
 */
async function viewScene({ sceneId }) {
  gmOnly();
  const scene = game.scenes.get(sceneId);
  if ( !scene ) throw new Error(`scene ${sceneId} not found`);
  if ( canvas.scene?.id !== sceneId ) await scene.view();
  return { viewed: canvas.scene?.id ?? null };
}

/**
 * Un réglage de MONDE d'un autre module, lu et changé le temps d'une passe de scénarios (relevé des trous, 2026-10-22) : une horloge
 * qui avance le temps du monde hors combat (« Simple Timekeeping » de `dnd-6` : 600 s par intervalle, réglage `paused`) fait expirer
 * en quelques secondes toute durée d'une minute — concentration comprise, que dnd5e supprime alors hors combat (`_onUpdate`, effet
 * expiré). Rend `{ absent: true }` si le réglage n'existe pas (module absent ou inactif).
 */
async function foreignSetting({ namespace, key, value }) {
  gmOnly();
  const config = game.settings.settings.get(`${namespace}.${key}`);
  if ( !config ) return { absent: true };
  if ( config.scope !== "world" ) throw new Error(`${namespace}.${key}: not a world setting`);
  const before = game.settings.get(namespace, key);
  if ( value !== undefined ) await game.settings.set(namespace, key, value);
  return { key, before, now: game.settings.get(namespace, key) };
}

/**
 * Les effets et sons en cours de Sequencer (module tiers : les animations de Boss Loot / BLFX), et la fin de ceux qu'on désigne —
 * pour que le lanceur de scénarios termine ce qu'un scénario a fait naître (vu le 2026-09-29 : le son en boucle de l'Aspersion acide
 * restait après le scénario `presage`). `Sequencer.EffectManager.effects` / `.endEffects({ effects: [ids] })`,
 * `Sequencer.SoundManager.sounds` / `.endSounds({ sounds: [ids] })` (sequencer.js 4.2.3 : 10723, 10842, 11538, 11626, 30899-30900) ; les
 * autres clients sont prévenus par Sequencer. Sans Sequencer : rien.
 */
async function sequencer({ end=null }={}) {
  const S = globalThis.Sequencer;
  if ( !S?.EffectManager || !S?.SoundManager ) return { available: false, effects: [], sounds: [] };
  if ( end?.effects?.length ) await S.EffectManager.endEffects({ effects: end.effects }).catch(() => null);
  if ( end?.sounds?.length ) await S.SoundManager.endSounds({ sounds: end.sounds });
  return {
    available: true,
    effects: (S.EffectManager.effects ?? []).map(e => ({ id: e.id, name: e.data?.name ?? null, file: String(e.data?.file ?? "") })),
    sounds: (S.SoundManager.sounds ?? []).map(s => ({ id: s.data?._id ?? s.id, name: s.data?.name ?? null }))
  };
}

/**
 * §58 : les dernières cartes du journal telles que le MJ les voit — type, repliée ou non (`display` calculé), résumé des jets
 * de la carte unique et verdict. Lecture seule.
 */
function chatCards({ count=6 }={}) {
  return game.messages.contents.slice(-count).map(m => {
    const li = document.querySelector(`#chat .chat-message[data-message-id="${m.id}"]`);
    return { id: m.id, type: m.type, origin: m._source.system?.origin ?? null, inLog: !!li,
      hidden: li ? (getComputedStyle(li).display === "none") : null,
      rolls: li ? [...li.querySelectorAll(".dnd5e-combat-rolls p")].map(p => p.textContent) : [],
      details: li?.querySelector(".dnd5e-combat-details")?.textContent ?? null,
      verdict: li ? [...li.querySelectorAll(".dnd5e-combat-result:not(.dnd5e-combat-rolls) p")].map(p => p.textContent) : [] };
  });
}

/* -------------------------------------------- */

const plainTask = t => ({ id: t.id, check: t.check, root: t.root ?? null, fixable: typeof t.apply === "function", preselect: !!t.preselect,
  where: String(t.where ?? "").replace(/<[^>]+>/g, ""), text: String(t.text ?? "").replace(/<[^>]+>/g, "") });

/** Analyse (rien n'est écrit) : les tâches, sans leurs fonctions. */
async function diagnosticScan({ checks=null }={}) {
  const scan = await scanWorld(checks);
  return Object.fromEntries(Object.entries(scan).map(([id, tasks]) => [id, tasks.map(plainTask)]));
}

/** Répare les tâches réparables de ces vérifications dont la racine est l'un de ces uuid (toutes si `roots` est absent). */
async function diagnosticRepair({ checks=null, roots=null }={}) {
  const scan = await scanWorld(checks);
  const tasks = Object.values(scan).flat().filter(t => t.apply && (!roots || roots.includes(t.root?.uuid)));
  const { backup, results } = await repairTasks(tasks);
  return { backup, results: results.map(r => ({ ...plainTask(r.task), ok: r.ok, line: String(r.line).replace(/<[^>]+>/g, "") })) };
}

const diagnosticBackups = () => diagBackups();

/** Après un scénario : retire ces entrées de sauvegarde, et le compendium s'il est vide et que le scénario l'a créé (`dropPack`). */
async function diagnosticForget({ uuids=[], dropPack=false, actors=[] }={}) {
  for ( const uuid of uuids ) await (await fromUuid(uuid).catch(() => null))?.delete();
  // Les acteurs que le scénario a créés (marqués `flags.dnd5e-combat.scenario`), jamais un autre.
  for ( const id of actors ) { const a = game.actors.get(id); if ( a?.getFlag(MODULE_ID, "scenario") ) await a.delete(); }
  const pack = game.packs.get("world.das-backups");
  const left = pack ? (await pack.getIndex()).size : 0;
  if ( pack && dropPack && !left ) await pack.deleteCompendium();
  return { left, dropped: !!(pack && dropPack && !left) };
}
const diagnosticRestore = ({ uuid }) => diagRestore(uuid);


/** Ce que `api.mcp` expose. */
export const testApi = Object.freeze({ controls, menu, wall, wallSide, cover, issues, planning, stormStrike, storm, placeRegionAt, effectOrigins, enchant, overrideContent, heal, hurt, rollSave, rollCheck, range, naturalOne, perf, threats, attackReasons, perceived, inventory, budget, identify, stairs, plan, movement, move, windows, closeWindow, view, reports, rollCard, status, reload, summonAt, stats, teleport, teleportPick, restoreItem, runMacro, saveChance, portent, transpose, dash, chatCards, setting, foreignSetting, viewScene, sequencer, stairsAt, takeStairs, follow, unfollow, followState, endings, actionEnd, use, familiar, familiarPocket, familiarRecall, skillAids, skillAid, animations: animationState, toggleLight, lightState, advanceTime, door, lock, diagnosticScan, diagnosticRepair, diagnosticBackups, diagnosticRestore, diagnosticForget, factions, sees, stealth, scatter, flammable, climb, climbState, climbHolds, climbToward, climbCeiling, climbDown, reachCheck, dropDown, rawMove, jump, hoist, grab, ready, burning, masteries, etherealWalls, flight, groupRoll, groupRollState, groupRollBreakdown });
