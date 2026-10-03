/**
 * Projectiles (SPEC §16.27) : Projectile magique, Rayon ardent, Décharge occulte. dnd5e 6 n'en fait qu'un par lancement ;
 * le texte en donne plusieurs (3 projectiles + 1 par niveau ; 3 rayons + 1 par niveau ; 2 rayons au niveau 5). Chaque
 * projectile est un lancement à part, avec ses propres dés — son jet d'attaque s'il en a un, ses dégâts.
 *  - Visée multiple (ui/pointer.mjs) : après le choix du niveau, un clic par projectile (`picks`) ; le premier est le
 *    lancement, les autres sont gardés sur sa carte (`projectileQueue`). Sans visée multiple (connecteur, plusieurs cibles
 *    déjà désignées), le premier part vers la première cible et l'auteur répartit le reste après coup.
 *  - Ceux qui touchent d'office (Projectile magique) : le jet de dégâts enchaîné de dnd5e est coupé, le moteur les lance.
 *  - Quand la résolution du premier est tranchée, chez l'auteur, le moteur enchaîne chaque projectile restant — même
 *    activité, sans emplacement ni concentration, au niveau du lancement, sans coût d'action (`cost: "free"`), son jet
 *    d'attaque rattaché à sa carte — en attendant que chacun soit tranché avant le suivant.
 */

import { MODULE_ID } from "../constants.mjs";
import { allocateDarts } from "../core/action.mjs";
import { projectilesOf, projectileCount, handleAllocationQuery, leapOf } from "../adapter/projectiles.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { convertLength } from "../core/units.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

const started = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * §16.27 : le rebond de l'Orbe chromatique vise une créature à `radius` de la dernière cible, jamais visée par ce lancement ;
 * sinon il est refusé (la visée se referme, le rebond est perdu).
 */
export function leapProblem(activity, leap, target) {
  return leapRefused(activity, leap, target);
}

function leapRefused(activity, leap, target=[...game.user.targets][0]?.document) {
  const rule = leapOf(activity?.item);
  const from = leap.from ? fromUuidSync(leap.from, { strict: false }) : null;
  if ( !rule || !target || !from ) return false;
  if ( (leap.chain ?? []).includes(target.uuid) ) return loc("Rebond.DejaVise", { name: target.name });
  let limit = rule.radius;
  try { limit = convertLength(rule.radius, rule.units, from.parent.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  if ( distanceBetween(from, target).value > limit + 1e-6 ) return loc("Rebond.TropLoin", { name: target.name, distance: limit, units: from.parent.grid.units });
  return false;
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  const leap = usageConfig?.[MODULE_ID]?.leap;
  if ( leap ) {
    const refused = leapRefused(activity, leap);
    if ( refused ) {
      log(`rebond refusé : ${refused}`);
      ui.notifications.warn(refused);
      notice([...game.user.targets][0]?.document, refused.replace(/^[^:]*:\s*/, ""));
      return false;
    }
    log(`${activity.item.name} : rebond vers ${[...game.user.targets][0]?.name ?? "?"}`);
    return true;
  }
  if ( usageConfig?.[MODULE_ID]?.projectileOf ) return true;
  const rule = projectilesOf(activity?.item);
  if ( !rule ) return true;
  // Chaque projectile est un lancement à part, avec ses propres dés : ceux qui touchent d'office (Projectile magique) ont
  // leurs dégâts lancés par le moteur (adapter/usage.mjs, `damage: "author"`), pas par l'action enchaînée de dnd5e.
  if ( rule.attack === false ) usageConfig.subsequentActions = false;
  // §16.27 : la visée multiple (ui/pointer) a désigné chaque projectile — le premier est ce lancement, les autres, dans
  // l'ordre des clics, seront enchaînés.
  const picks = usageConfig?.[MODULE_ID]?.picks;
  if ( picks?.length ) {
    if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.projectileQueue`, picks.slice(1));
    // dnd5e a déjà relevé les cibles de la carte, toutes (mixin.mjs:239-242, avant ce hook) : le premier ne vise que la sienne.
    const captured = messageConfig?.data?.system?.targets;
    if ( Array.isArray(captured) ) messageConfig.data.system.targets = captured.filter(t => t.token === picks[0]);
    for ( const t of Array.from(game.user.targets) ) if ( t.document.uuid !== picks[0] ) t.setTarget(false, { releaseOthers: false, groupSelection: true });
    return true;
  }
  const targets = [...game.user.targets];
  if ( targets.length < 2 ) return true;
  if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.projectileTargets`, targets.map(t => t.document.uuid));
  for ( const t of targets.slice(1) ) t.setTarget(false, { releaseOthers: false, groupSelection: true });
  return true;
}

/** Attend qu'une résolution soit tranchée (ou 30 s). */
async function settled(messageId) {
  for ( const until = Date.now() + 30000; Date.now() < until; await sleep(300) ) {
    const step = game.messages.get(messageId)?.getFlag(MODULE_ID, "resolution")?.step;
    if ( ["done", "missed", "undone"].includes(step) ) return step;
  }
  return null;
}

/** Les rayons restants, dans l'ordre : répartis par l'auteur, moins celui qui est déjà parti vers la première cible. */
async function remainingShots(activity, usage, resolution, count) {
  const designated = usage.getFlag(MODULE_ID, "projectileQueue");   // la visée multiple a déjà tout désigné
  if ( Array.isArray(designated) ) return [...designated];
  const first = resolution.targets?.[0]?.token ?? null;
  const listed = usage.getFlag(MODULE_ID, "projectileTargets") ?? (first ? [first] : []);
  if ( !listed.length ) return [];
  let counts = { [listed[0]]: count };
  if ( listed.length > 1 ) {
    const targets = await Promise.all(listed.map(async token => ({ token, name: (await fromUuid(token))?.name ?? token })));
    ui.notifications.info(loc("Repartition.Rayons", { item: activity.item.name, count }));
    const answer = await handleAllocationQuery({ item: activity.item.name, count, targets });
    counts = allocateDarts(count, listed, answer?.counts ?? {});
  }
  const queue = listed.flatMap(token => Array(counts[token] ?? 0).fill(token));
  const gone = queue.indexOf(first ?? listed[0]);
  if ( gone >= 0 ) queue.splice(gone, 1);
  else queue.pop();
  return queue;
}

async function chain(usage, resolution) {
  const scaled = usage.getAssociatedActivity?.({ scaled: true });
  const base = usage.getAssociatedActivity?.();
  if ( !scaled || !base ) return;
  const count = projectileCount(scaled);
  if ( count < 2 ) return;
  const queue = await remainingShots(scaled, usage, resolution, count);
  const level = base.item.system.level ?? 0;
  const scaling = Number(usage.system?.scaling) || 0;
  log(`${base.item.name} : ${count} projectile(s), ${queue.length} enchaîné(s)`);
  for ( const tokenUuid of queue ) {
    const token = (await fromUuid(tokenUuid))?.object;
    if ( !token ) continue;
    token.setTarget(true, { releaseOthers: true });
    const config = {
      consume: { spellSlot: false },
      concentration: { begin: false },
      subsequentActions: false,
      ...(level > 0 ? { scaling, spell: { slot: `spell${level + scaling}` } } : {}),
      [MODULE_ID]: { confirmed: true, cost: "free", projectileOf: usage.id }
    };
    const used = await base.use(config, { configure: false }, { data: { flags: { [MODULE_ID]: { projectileOf: usage.id } } } });
    if ( !used?.message ) break;
    if ( projectilesOf(base.item)?.attack ) await base.rollAttack({}, { configure: false }, { data: { system: { origin: used.message.id } } });
    await settled(used.message.id);
  }
}

/** Chez l'auteur : la résolution du premier projectile est tranchée — on enchaîne les autres, une fois. */
function onResolutionFlag(message, changes) {
  const diff = changes.flags?.[MODULE_ID]?.resolution;
  if ( !diff || !("step" in diff) || !message.isAuthor ) return;
  const resolution = message.getFlag(MODULE_ID, "resolution");
  if ( !["done", "missed"].includes(resolution?.step) ) return;
  const usage = game.messages.get(resolution.origin ?? message.id) ?? message;
  if ( usage.getFlag(MODULE_ID, "projectileOf") || started.has(usage.id) ) return;
  if ( !projectilesOf(usage.getAssociatedActivity?.()?.item) ) return;
  started.add(usage.id);
  chain(usage, resolution).catch(err => console.error(`${MODULE_ID} | projectiles enchaînés`, err));
}

/**
 * Intention « lancer avec ces projectiles » (visée multiple, ui/pointer.mjs) : l'utilisation suspendue repart, le niveau
 * déjà choisi, chaque projectile désigné (`picks`, uuids de tokens dans l'ordre des clics).
 */
export function castWithPicks(activity, [config, dialog, message], picks) {
  // dnd5e fige les cibles dans la configuration du message dès la première utilisation (activity/mixin.mjs:239-242) — celle
  // qui a été suspendue pour la visée, sans cible : on les laisse se relire (comme runtime/actions.mjs, `engage`).
  const messageConfig = foundry.utils.deepClone(message ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  return activity.use({ ...config, [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), picks } }, dialog, messageConfig);
}

/** À inscrire après la souris (la visée a désigné les cibles) et avant la légalité. */
export function registerProjectiles() {
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "projectiles : un par cible, le reste enchaîné" });
  route("updateChatMessage", onResolutionFlag, { label: "projectiles enchaînés" });
}
