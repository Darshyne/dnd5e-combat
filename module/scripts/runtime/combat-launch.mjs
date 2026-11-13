/**
 * §397 : « Lancer un combat » (MJ, demande de l'utilisateur, 2026-11-07). La règle de tri est dans core/combat-launch.mjs, la fenêtre dans
 * ui/combat-launch.mjs.
 *
 *  1. `beginLaunch` : le jeu se met en pause pour toute la table, avec « Un combat commence, tenez-vous prêts » sous l'icône de pause
 *     (`renderGamePause`, le bandeau du cœur : client/applications/ui/game-pause.mjs) ; la fenêtre s'ouvre chez le MJ.
 *  2. `launchCandidates` : les tokens de la scène, rangés (joueurs connectés, vus par les joueurs, reste de la carte).
 *  3. `launchCombat` : le combat de la scène (créé au besoin), ses combattants — un PNJ que les joueurs ne voient pas entre caché dans
 *     la frise (`hidden`) et apparaît dès qu'un token des joueurs le voit ; l'état Surpris de dnd5e sur les surpris (Désavantage à
 *     l'initiative, retiré une fois le jet fait : runtime/knockout.mjs) ; la musique ; la pause levée ; l'initiative — les joueurs par la
 *     demande de jets du MJ (type « initiative », runtime/group-roll.mjs : la fenêtre de jet d'une interface voisine, délai, suivi),
 *     les PNJ par dnd5e si demandé ; une invocation « juste après son maître » reçoit son initiative dès que le maître a la sienne
 *     (`initiativeAfter`) ; le premier round commence seul quand tout le monde a lancé.
 *  4. À la fin de ce combat, la musique d'avant reprend.
 * L'état (en attente, combat lancé, musique d'avant) est un réglage de monde caché : tous les clients le lisent.
 */

import { MODULE_ID } from "../constants.mjs";
import { classify, initiativeGroups, allRolled } from "../core/combat-launch.mjs";
import { initiativeAfter } from "../core/turn.mjs";
import { canSee } from "../adapter/vision.mjs";
import { summonItemOf } from "../adapter/summons.mjs";
import { contentOf } from "../adapter/content.mjs";
import { requestGroupRoll } from "./group-roll.mjs";
import { route } from "./router.mjs";
import { log, loc, isExecutor } from "./shared.mjs";
import { tokenArt } from "../adapter/token-art.mjs";

export const LAUNCH_STATE = "combatLaunch";
export const LAUNCH_BUTTON = "combatLaunchButton";
export const LAUNCH_PLAYLIST = "combatLaunchPlaylist";
const HIDDEN_FLAG = "revealWhenSeen";

const state = () => { try { return game.settings.get(MODULE_ID, LAUNCH_STATE) ?? {}; } catch { return {}; } };
const setState = changes => game.settings.set(MODULE_ID, LAUNCH_STATE, { ...state(), ...changes });

/** La règle d'initiative d'une invocation (content/summons.mjs `summon.initiative`), null pour une créature ordinaire. */
function summonRule(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  if ( !item ) return null;
  return contentOf(item).entry?.summon?.initiative ?? "own";
}

/** Le maître d'une invocation : son token sur la scène, ou null. */
function masterToken(tokenDoc) {
  const actor = summonItemOf(tokenDoc)?.actor;
  return actor?.getActiveTokens?.(false, true)?.find(t => t.parent === tokenDoc.parent) ?? null;
}

const isCreature = actor => ["character", "npc"].includes(actor?.type);
const alive = actor => {
  if ( actor?.statuses?.has?.("dead") ) return false;
  const hp = actor?.system?.attributes?.hp;
  return !(Number(hp?.max) > 0) || (Number(hp?.value) > 0);
};
const ownersOnline = actor => game.users.some(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
const sameLevel = token => !canvas.level || !token.level || (token.level === canvas.level.id);

/**
 * Les tokens qui « voient pour les joueurs » : toutes les créatures des joueurs sur la scène, connectés ou non (un personnage dont le
 * joueur est absent voit quand même ce qui l'entoure).
 */
function playerTokens(scene) {
  return scene.tokens.filter(t => t.actor?.hasPlayerOwner && isCreature(t.actor) && alive(t.actor));
}

/** Les tokens de la scène, rangés pour la fenêtre (core/combat-launch.mjs `classify`). */
export function launchCandidates(scene=canvas.scene) {
  if ( !scene ) return { players: [], seen: [], rest: [] };
  const observers = playerTokens(scene);
  const entries = scene.tokens.filter(t => t.actor).map(token => {
    const actor = token.actor;
    const player = !!actor.hasPlayerOwner;
    const online = player && ownersOnline(actor);
    const seen = !player && observers.some(o => {
      const verdict = canSee(o, token);
      return (verdict === null) ? !token.hidden : verdict;
    });
    const summon = summonRule(token);
    return {
      id: token.id, uuid: token.uuid, name: token.name, img: tokenArt(token),
      actorKey: (token.actorLink ? actor.id : token.actorId) ?? actor.id,
      player, online, creature: isCreature(actor), alive: alive(actor), sameLevel: sameLevel(token),
      notCombatant: token.getFlag?.(MODULE_ID, "notCombatant") === true || actor.getFlag?.(MODULE_ID, "notCombatant") === true,
      summon, master: summon === "after" ? masterToken(token)?.id ?? null : null, seen, hiddenToken: token.hidden
    };
  });
  return classify(entries);
}

/** MJ : la pause pour toute la table, avec son message. */
export async function beginLaunch() {
  if ( !game.user.isGM ) return false;
  if ( !canvas.scene ) { ui.notifications.warn(loc("Lancement.SansScene")); return false; }
  const running = game.combats.find(c => c.started && (c.scene?.id === canvas.scene.id));
  if ( running ) { ui.notifications.warn(loc("Lancement.DejaEnCours")); return false; }
  await setState({ pending: true, wasPaused: game.paused });
  game.togglePause(true, { broadcast: true });
  log("combat launch: game paused, choosing the participants");
  return true;
}

/** MJ : la fenêtre fermée sans lancer — la pause d'avant revient. */
export async function cancelLaunch() {
  if ( !game.user.isGM || !state().pending ) return;
  const was = state().wasPaused;
  await setState({ pending: false });
  if ( !was ) game.togglePause(false, { broadcast: true });
  log("combat launch: cancelled");
}

/** La musique en cours (playlists et pistes), pour la reprendre à la fin du combat. */
function playingNow() {
  return game.playlists.filter(p => p.playing).map(p => ({ playlist: p.id, sounds: p.sounds.filter(s => s.playing).map(s => s.id) }));
}

async function startMusic(playlistId) {
  const playlist = game.playlists.get(playlistId ?? "");
  if ( !playlist ) return null;
  const previous = playingNow().filter(p => p.playlist !== playlist.id);
  for ( const p of previous ) await game.playlists.get(p.playlist)?.stopAll();
  await playlist.playAll();
  return { previous, current: playlist.id };
}

async function restoreMusic(music) {
  if ( !music ) return;
  await game.playlists.get(music.current ?? "")?.stopAll();
  for ( const p of music.previous ?? [] ) {
    const playlist = game.playlists.get(p.playlist);
    if ( !playlist ) continue;
    const sounds = p.sounds.map(id => playlist.sounds.get(id)).filter(Boolean);
    if ( sounds.length ) for ( const s of sounds ) await playlist.playSound(s);
    else await playlist.playAll();
  }
}

/**
 * MJ : lance le combat.
 * @param {object} input
 * @param {Array<{uuid: string, surprised?: boolean}>} input.participants
 * @param {boolean} [input.npcAuto=true]       Les PNJ lancent leur initiative tout seuls.
 * @param {boolean} [input.grouped=false]     Une initiative par type de créature.
 * @param {string|null} [input.playlist]      La playlist de combat.
 * @returns {Promise<Combat|null>}
 */
export async function launchCombat({ participants=[], npcAuto=true, grouped=false, playlist=null }={}) {
  if ( !game.user.isGM ) return null;
  const scene = canvas.scene;
  const tokens = participants.map(p => ({ token: fromUuidSync(p.uuid, { strict: false }), surprised: !!p.surprised })).filter(p => p.token?.actor);
  if ( !scene || !tokens.length ) { ui.notifications.warn(loc("Lancement.Personne")); return null; }
  const observers = playerTokens(scene);
  const unseen = token => !token.actor.hasPlayerOwner && !observers.some(o => canSee(o, token) === true);

  let combat = game.combats.find(c => !c.started && (c.scene?.id === scene.id)) ?? null;
  combat ??= await Combat.implementation.create({ scene: scene.id, active: true });
  if ( !combat.active ) await combat.activate();
  const already = new Set(combat.combatants.map(c => c.tokenId));
  const data = tokens.filter(p => !already.has(p.token.id)).map(({ token }) => {
    const hidden = token.hidden || unseen(token);
    return { tokenId: token.id, sceneId: scene.id, actorId: token.actorId, hidden,
      ...(hidden && !token.hidden ? { flags: { [MODULE_ID]: { [HIDDEN_FLAG]: true } } } : {}) };
  });
  if ( data.length ) await combat.createEmbeddedDocuments("Combatant", data);

  for ( const { token, surprised } of tokens ) {
    if ( surprised && !token.actor.statuses?.has("surprised") ) await token.actor.toggleStatusEffect("surprised", { active: true });
  }

  const music = playlist ? await startMusic(playlist) : null;
  await setState({ pending: false, combat: combat.id, music, grouped });
  game.togglePause(false, { broadcast: true });
  log(`combat launch: ${tokens.length} participant(s)${music ? ", combat music on" : ""}`);

  // L'initiative : les joueurs par la demande de jets, les PNJ par dnd5e, les invocations « après » quand leur maître a la sienne.
  const ids = new Set(tokens.map(p => p.token.id));
  const members = combat.combatants.filter(c => ids.has(c.tokenId));
  const rule = c => summonRule(c.token);
  const players = members.filter(c => c.actor?.hasPlayerOwner && ownersOnline(c.actor) && (rule(c) !== "after"));
  const npcs = members.filter(c => !players.includes(c) && (rule(c) !== "after"));
  if ( npcAuto && npcs.length ) {
    const actorKey = c => (c.token?.actorLink ? c.actor?.id : c.token?.actorId) ?? c.id;
    for ( const group of initiativeGroups(npcs.map(c => ({ id: c.id, actorKey: actorKey(c) })), grouped) ) {
      await combat.rollInitiative([group.roll]);
      const value = combat.combatants.get(group.roll)?.initiative;
      if ( group.copies.length && Number.isFinite(value) ) {
        await combat.updateEmbeddedDocuments("Combatant", group.copies.map(id => ({ _id: id, initiative: value })));
      }
    }
  }
  if ( players.length ) {
    const actors = [...new Set(players.map(c => c.actor.uuid))];
    requestGroupRoll({ actors, type: "initiative", combat: combat.id, label: loc("Lancement.Libelle") })
      .catch(err => console.error(`${MODULE_ID} | combat launch: initiative request failed`, err));
  }
  await followSummons(combat);
  await startWhenReady(combat);
  return combat;
}

/** Les invocations « juste après leur maître » : leur initiative suit celle du maître dès qu'il l'a. */
async function followSummons(combat) {
  const updates = [];
  for ( const c of combat.combatants ) {
    if ( Number.isFinite(c.initiative) || (summonRule(c.token) !== "after") ) continue;
    const master = masterToken(c.token);
    const mine = master ? combat.combatants.find(x => x.tokenId === master.id) : null;
    if ( !Number.isFinite(mine?.initiative) ) continue;
    const others = combat.combatants.filter(x => (x !== mine) && (x !== c)).map(x => x.initiative);
    updates.push({ _id: c.id, initiative: initiativeAfter(mine.initiative, others) });
  }
  if ( updates.length ) await combat.updateEmbeddedDocuments("Combatant", updates);
}

/** Le premier round, dès que tout le monde a lancé. */
async function startWhenReady(combat) {
  if ( !combat || combat.started || (state().combat !== combat.id) ) return;
  if ( !allRolled(combat.combatants.map(c => c.initiative)) ) return;
  await combat.startCombat();
  log("combat launch: everyone rolled, round 1 starts");
}

/** Un PNJ caché dans la frise faute d'être vu : il apparaît dès qu'un token des joueurs le voit. */
async function revealSeen(combat) {
  if ( !combat?.scene || (state().combat !== combat.id) ) return;
  const observers = playerTokens(combat.scene);
  const updates = combat.combatants.filter(c => c.hidden && c.getFlag(MODULE_ID, HIDDEN_FLAG) && c.token && !c.token.hidden
    && observers.some(o => canSee(o, c.token) === true)).map(c => ({ _id: c.id, hidden: false, [`flags.${MODULE_ID}.${HIDDEN_FLAG}`]: null }));
  if ( updates.length ) {
    await combat.updateEmbeddedDocuments("Combatant", updates);
    log(`combat launch: ${updates.length} creature(s) now seen, shown in the initiative`);
  }
}

/** Le bandeau de pause : le message du lancement pendant le choix des participants. */
function onRenderPause(_app, element) {
  if ( !state().pending || !game.paused ) return;
  const caption = (element instanceof HTMLElement ? element : element?.[0])?.querySelector?.("figcaption");
  if ( caption ) caption.innerText = loc("Lancement.Pause");
}

export function registerCombatLaunch() {
  game.settings.register(MODULE_ID, LAUNCH_STATE, { scope: "world", config: false, type: Object, default: {},
    onChange: () => ui.pause?.render?.() });
  game.settings.register(MODULE_ID, LAUNCH_BUTTON, {
    name: `DND5ECOMBAT.Reglage.${LAUNCH_BUTTON}.Nom`, hint: `DND5ECOMBAT.Reglage.${LAUNCH_BUTTON}.Aide`,
    scope: "world", config: true, type: Boolean, default: true, onChange: () => ui.controls?.render?.({ reset: true })
  });
  game.settings.register(MODULE_ID, LAUNCH_PLAYLIST, { scope: "client", config: false, type: String, default: "" });
  route("renderGamePause", onRenderPause, { always: true, label: "combat launch: pause message not shown" });
  route("updateCombatant", (combatant, changes) => {
    if ( !("initiative" in changes) ) return;
    const combat = combatant.combat;
    if ( state().combat !== combat?.id ) return;
    return followSummons(combat).then(() => startWhenReady(combat));
  }, { executor: true, label: "combat launch: initiative not followed" });
  route("updateToken", (token, changes) => {
    if ( !("x" in changes) && !("y" in changes) && !("hidden" in changes) && !("elevation" in changes) ) return;
    const combat = game.combats.get(state().combat ?? "");
    if ( combat?.scene?.id === token.parent?.id ) return revealSeen(combat);
  }, { executor: true, label: "combat launch: seen creature not shown" });
  route("deleteCombat", combat => {
    const s = state();
    if ( s.combat !== combat.id ) return;
    return restoreMusic(s.music).finally(() => setState({ combat: null, music: null }));
  }, { executor: true, label: "combat launch: music not restored" });
}

export const launchApi = Object.freeze({ candidates: launchCandidates, begin: beginLaunch, cancel: cancelLaunch, launch: launchCombat,
  /** Un lancement de combat est-il en cours (pause posée par `begin`, participants pas encore choisis) ? Réglage de monde, tout client. */
  pending: () => !!state().pending });
