/**
 * §112 : l'application d'une résolution (dégâts, soins, effets) attend la fin de l'animation qui la montre — retour de séance
 * (2026-10-08) : les PV tombaient au départ du projectile de BLFX, pas à son arrivée.
 *
 * BLFX (Boss Loot) n'annonce pas la fin de ses animations, mais il les joue par Sequencer, qui le fait sur chaque client :
 * `createSequencerEffect` à la lecture et `endedSequencerEffect` à la fin (sequencer.js 4.2.3 : 15468, 15485 ; l'effet porte
 * `sourceDocument` / `targetDocument`, 14889-14958, et `data.persist`). BLFX lance l'animation après les dés 3D, comme le moteur
 * (helperFunctions.js:1711-1733, `waitForDiceSoNiceRoll`) : les deux partaient ensemble.
 *
 * Avant d'appliquer (commande `apply`, runtime/engine.mjs), chez le MJ actif : si Sequencer est là, on guette un court moment une
 * animation qui part de l'auteur ou arrive sur une cible (core/animations.mjs), puis on attend sa fin — borné par le réglage
 * `animationWait` (secondes). Rien à attendre : on applique aussitôt. Fenêtre sans rendu (onglet masqué, réduite) : aucune
 * animation n'y joue, on n'attend pas.
 */

import { MODULE_ID } from "../constants.mjs";
import { relevantAnimations } from "../core/animations.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const SYNC_SETTING = "syncAnimations";
export const WAIT_SETTING = "animationWait";

/** Le temps laissé à BLFX pour lancer son animation, après les dés (il attend les mêmes dés que le moteur). */
const LOOK_MS = 600;

/** id → { id, source, target, persist, started, ended, done: Promise } */
const live = new Map();

/** Relevé des derniers débuts d'animation et des attentes (pour `api.mcp.animations`, scénarios). */
const journal = [];
function note(entry) {
  journal.push({ ...entry, at: Date.now() });
  if ( journal.length > 40 ) journal.shift();
}

/** Les animations suivies et le relevé récent (test). */
export function animationState() {
  return { live: [...live.values()].map(({ done, resolve, ...e }) => e), journal: [...journal] };
}

const docUuid = doc => (doc?.uuid ?? null);

function onCreate(effect) {
  if ( !effect?.id ) return;
  let resolve;
  const done = new Promise(r => { resolve = r; });
  let source = null, target = null;
  try { source = docUuid(effect.sourceDocument); } catch {}
  try { target = docUuid(effect.targetDocument); } catch {}
  live.set(effect.id, { id: effect.id, source, target, persist: !!effect.data?.persist, started: Date.now(), ended: false, done, resolve });
  note({ kind: "start", id: effect.id, source, target, persist: !!effect.data?.persist });
}

function onEnded(effect) {
  const entry = live.get(effect?.id);
  if ( !entry ) return;
  entry.ended = true;
  entry.resolve();
  live.delete(effect.id);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sequencerActive = () => !!game.modules.get("sequencer")?.active;

/**
 * Attendre la fin des animations de ces tokens (auteur, cibles) avant d'appliquer. Rend la durée attendue (ms), 0 sans attente.
 * @param {Array<string|null|undefined>} uuids
 * @returns {Promise<number>}
 */
export async function waitForAnimations(uuids) {
  if ( !game.settings.get(MODULE_ID, SYNC_SETTING) || !sequencerActive() || (document.hidden === true) ) { note({ kind: "skip", hidden: document.hidden === true }); return 0; }
  const maxMs = Math.max(0, Number(game.settings.get(MODULE_ID, WAIT_SETTING)) || 0) * 1000;
  if ( !maxMs ) return 0;
  const t0 = Date.now();
  let ids = relevantAnimations([...live.values()], uuids, Date.now());
  // BLFX n'a peut-être pas encore lancé la sienne : on la guette un court moment.
  while ( !ids.length && ((Date.now() - t0) < LOOK_MS) ) {
    await sleep(50);
    ids = relevantAnimations([...live.values()], uuids, Date.now());
  }
  if ( !ids.length ) { note({ kind: "none", uuids: uuids.filter(Boolean) }); return 0; }
  const pending = ids.map(id => live.get(id)?.done).filter(Boolean);
  const left = Math.max(0, maxMs - (Date.now() - t0));
  const outcome = await Promise.race([Promise.all(pending).then(() => "done"), sleep(left).then(() => "late")]);
  const waited = Date.now() - t0;
  note({ kind: "waited", ids, ms: waited, late: outcome === "late" });
  log(`animations: ${ids.length} awaited, ${waited} ms${outcome === "late" ? " (maximum wait reached)" : ""}`);
  return waited;
}

export function registerAnimations() {
  game.settings.register(MODULE_ID, SYNC_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SYNC_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SYNC_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, WAIT_SETTING, {
    name: `DND5ECOMBAT.Reglage.${WAIT_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${WAIT_SETTING}.Aide`,
    scope: "world", config: true, type: Number, default: 3, range: { min: 1, max: 10, step: 0.5 }
  });
  route("createSequencerEffect", onCreate, { label: "animations: start (Sequencer)" });
  route("endedSequencerEffect", onEnded, { label: "animations: end (Sequencer)" });
}
