/**
 * Suivre (SPEC §41.3) : un token en suit un autre — un personnage suit un allié, un familier ou une invocation suit son
 * maître. L'ordre se donne au menu contextuel (ui/pointer.mjs) ; il vit dans un flag du token qui suit
 * (`flags["dnd5e-combat"].follow = { leader: id du token suivi, by: id de l'utilisateur qui a donné l'ordre }`), donc il
 * survit à un F5 et tout le monde le lit.
 *
 * Qui fait marcher : le client de l'utilisateur `by`, et lui seul (plusieurs propriétaires — le joueur et le MJ — ne
 * doivent pas marcher deux fois).
 *
 * Comment : **le suiveur refait le trajet du meneur**. Chaque déplacement du meneur (hook `moveToken` : son départ et ses
 * étapes, changement de niveau compris) est noté dans la piste du suiveur ; après un court délai, le suiveur parcourt cette
 * piste sauf sa dernière étape — la case où se tient le meneur —, puis fait le dernier pas par l'A* du moteur (`joinToken`,
 * quelques cases : au contact, sur le bon niveau). Sans piste (l'ordre vient d'être donné, le meneur a été téléporté), il
 * rejoint par l'A* seul. Refaire le trajet plutôt que chercher un chemin d'un bout à l'autre de la carte : c'est ce que
 * « suivre » veut dire, cela ne coûte rien, et la recherche d'un chemin vers une cible lointaine, d'un niveau à l'autre,
 * s'épuisait une fois sur deux (vu le 2026-10-01 sur Restored Keep : 6 000 cases explorées, jusqu'à 0,8 s, pour rien).
 * Une file se forme toute seule : chacun refait le trajet de celui qu'il suit.
 *
 * Ce qui arrête : « Ne plus suivre » ; un déplacement du suiveur qui ne vient pas d'ici (son joueur le prend en main, le
 * MJ le déplace) — les pas du suivi se reconnaissent à la marque `follow` que porte leur opération de déplacement ; le
 * token suivi qui disparaît. En combat, on ne suit pas — chacun joue son tour — et le suivi reprend après, au prochain
 * déplacement du meneur.
 */

import { MODULE_ID } from "../constants.mjs";
import { footprintDistance } from "../core/orders.mjs";
import { footprintOf } from "../adapter/movement.mjs";
import { combatantFor } from "../adapter/turn.mjs";
import { joinToken, followTrail } from "./actions.mjs";
import { route } from "./router.mjs";
import { loc, log, notice } from "./shared.mjs";

const FLAG = "follow";
/** Délai avant de se mettre en marche : le meneur a fini de donner ses ordres de déplacement. */
const DELAY_MS = 350;
/** Étapes gardées dans une piste : au-delà (un suiveur bloqué loin derrière), on oublie le début et l'A* reprend la main. */
const MAX_TRAIL = 80;

const orderOf = token => token?.flags?.[MODULE_ID]?.[FLAG] ?? null;

/** Le token que celui-ci suit, s'il est encore sur sa scène. */
export function leaderOf(token) {
  const order = orderOf(token);
  return order?.leader ? (token.parent?.tokens.get(order.leader) ?? null) : null;
}

/** Les tokens de la scène qui suivent celui-ci. */
export function followersOf(leader) {
  return (leader?.parent?.tokens.contents ?? []).filter(t => orderOf(t)?.leader === leader.id);
}

/**
 * Ce token peut-il se mettre à suivre celui-là ? Il faut le posséder, être sur la même scène, et ne pas fermer une boucle
 * (A suit B qui suit A).
 */
export function canFollow(follower, leader) {
  if ( !follower?.isOwner || !leader || (follower === leader) || (follower.parent !== leader.parent) || !follower.actor ) return false;
  for ( let t = leader, n = 0; t && (n < 50); t = leaderOf(t), n++ ) if ( t === follower ) return false;
  return true;
}

export async function follow(follower, leader) {
  if ( !canFollow(follower, leader) ) return false;
  trails.delete(follower.id);
  await follower.setFlag(MODULE_ID, FLAG, { leader: leader.id, by: game.user.id });
  notice(follower, loc("Suivi.Debut", { name: leader.name }), "prompt");
  log(`${follower.name} suit ${leader.name}`);
  schedule(follower);
  return true;
}

export async function unfollow(follower, { silent=false }={}) {
  const order = orderOf(follower);
  if ( !order || !follower.isOwner ) return false;
  const leader = leaderOf(follower);
  clearTimeout(timers.get(follower.id));
  timers.delete(follower.id);
  trails.delete(follower.id);
  await follower.unsetFlag(MODULE_ID, FLAG);
  if ( !silent ) notice(follower, loc("Suivi.Fin", { name: leader?.name ?? "" }), "prompt");
  log(`${follower.name} ne suit plus ${leader?.name ?? "personne"}`);
  return true;
}

/** Les tokens que le suivi fait marcher en ce moment : un seul pas à la fois par suiveur. */
const walking = new Set();
/** Ceux dont le meneur a encore bougé pendant qu'ils marchaient : un pas de plus ensuite. */
const again = new Set();
const timers = new Map();
/** La piste de chaque suiveur : les étapes du meneur qu'il n'a pas encore refaites (`{ x, y, elevation, level, action }`). */
const trails = new Map();

function schedule(follower) {
  clearTimeout(timers.get(follower.id));
  timers.set(follower.id, setTimeout(() => {
    timers.delete(follower.id);
    step(follower).catch(err => console.warn(`${MODULE_ID} | suivi de ${follower.name}`, err));
  }, DELAY_MS));
}

const touching = (follower, leader) => ((follower._source.level ?? null) === (leader._source.level ?? null))
  && (footprintDistance(footprintOf(follower), footprintOf(leader)) <= 0);

async function step(follower) {
  const order = orderOf(follower);
  if ( !order || (order.by !== game.user.id) || !follower.parent ) return;
  const leader = leaderOf(follower);
  if ( !leader ) return unfollow(follower, { silent: true });
  // En combat, chacun joue son tour : le suivi attend (et la piste d'avant ne vaut plus).
  if ( game.combat?.started && follower.actor && combatantFor(follower.actor) ) { trails.delete(follower.id); return; }
  if ( walking.has(follower.id) ) { again.add(follower.id); return; }
  if ( touching(follower, leader) ) { trails.delete(follower.id); return; }
  walking.add(follower.id);
  try {
    // La piste du meneur, moins sa dernière étape (la case où il se tient) ; le dernier pas est pour l'A*.
    const trail = trails.get(follower.id) ?? [];
    trails.delete(follower.id);
    if ( trail.length > 1 ) await followTrail(follower, trail.slice(0, -1), { follow: true });
    if ( !orderOf(follower) ) return;
    const result = await joinToken(follower, leader, { follow: true });
    // « exhausted » : arrivé là où était le meneur, qui a encore bougé — le pas suivant (ci-dessous) reprend.
    if ( !result.arrived && (result.reason !== "exhausted") ) {
      const at = t => { const f = footprintOf(t); return `${f.i},${f.j}@${t._source.level ?? ""}`; };
      log(`${follower.name} ne rejoint pas ${leader.name} (${result.reason}) : en ${at(follower)}, meneur en ${at(leader)}`);
    }
  }
  finally {
    walking.delete(follower.id);
    if ( (again.delete(follower.id) || trails.has(follower.id)) && orderOf(follower) ) schedule(follower);
  }
}

/** Ce qu'on garde d'une étape du meneur pour la refaire : où, à quelle hauteur, sur quel niveau, par quelle action. */
const stepOf = ({ x, y, elevation, level, action }) => ({ x, y, snapped: true, ...(Number.isFinite(elevation) ? { elevation } : {}),
  ...(level ? { level } : {}), ...(action ? { action } : {}) });

/** Le meneur vient de se déplacer : son trajet s'ajoute à la piste de ses suiveurs (chez celui qui a donné l'ordre). */
function onMoveToken(token, movement) {
  const followers = followersOf(token).filter(f => orderOf(f).by === game.user.id);
  if ( !followers.length ) return;
  const steps = (movement?.passed?.waypoints ?? []).map(stepOf);
  if ( !steps.length ) return;
  for ( const follower of followers ) {
    const trail = trails.get(follower.id) ?? [];
    // Piste vide : elle commence là d'où part le meneur — le suiveur, à son contact, y est à un pas.
    if ( !trail.length && movement.origin ) trail.push(stepOf({ ...movement.origin, action: null }));
    trail.push(...steps);
    trails.set(follower.id, trail.slice(-MAX_TRAIL));
    schedule(follower);
  }
}

const MOVED = ["x", "y", "elevation", "level"];

function onUpdateToken(token, changes, options) {
  if ( !MOVED.some(k => k in changes) ) return;
  // Le suiveur déplacé autrement que par le suivi : il est repris en main, l'ordre tombe (chez celui qui l'a donné).
  const own = orderOf(token);
  if ( own && (own.by === game.user.id) && !options?.[MODULE_ID]?.follow ) {
    unfollow(token).catch(err => console.warn(`${MODULE_ID} | fin du suivi de ${token.name}`, err));
  }
  // Un meneur déplacé sans trajet (téléporté, posé ailleurs) : pas de piste, le suiveur rejoint par l'A*.
  for ( const follower of followersOf(token) ) {
    if ( orderOf(follower).by === game.user.id ) schedule(follower);
  }
}

/** Le meneur retiré de la scène : l'ordre de ses suiveurs tombe (chez celui qui l'a donné). */
function onDeleteToken(token) {
  for ( const follower of followersOf(token) ) {
    if ( orderOf(follower).by === game.user.id ) unfollow(follower, { silent: true }).catch(() => {});
  }
}

export function registerFollow() {
  route("moveToken", onMoveToken, { label: "suivi : le trajet du meneur" });
  route("updateToken", onUpdateToken, { label: "suivi : le meneur a bougé" });
  route("deleteToken", onDeleteToken, { label: "suivi : le meneur a disparu" });
}
