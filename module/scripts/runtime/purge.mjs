/**
 * Purge du journal (SPEC §58) : au-delà de `chatPurgeMax` messages (réglage de monde, 0 = jamais), le MJ actif supprime les
 * plus anciens jusqu'à n'en garder que `chatPurgeKeep`. Suppression définitive — décidée par l'utilisateur le 2026-10-02.
 *
 * Jamais supprimé : une action dont la résolution n'est pas close (ni `done`, ni `missed`, ni `undone`), ni les jets qui s'y
 * rattachent (`system.origin`) — le moteur les lit encore. Une carte d'utilisation supprimée emporte ses résumés natifs
 * (documents/chat-message.mjs:625-635, `_preDeleteOperation`) ; ses jets repliés (ui/compact.mjs) partent avec elle ici.
 */

import { MODULE_ID } from "../constants.mjs";
import { current, STEPS } from "../core/action.mjs";
import { planPurge } from "../core/purge.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const PURGE_MAX_SETTING = "chatPurgeMax";
export const PURGE_KEEP_SETTING = "chatPurgeKeep";

const CLOSED = new Set([STEPS.DONE, STEPS.MISSED, STEPS.UNDONE]);

let timer = null;
let running = false;

function setting(key) {
  try { return Math.max(0, Math.floor(Number(game.settings.get(MODULE_ID, key)) || 0)); } catch { return 0; }
}

/** Les messages du plus ancien au plus récent, sous la forme que lit core/purge.mjs. */
function entries() {
  return game.messages.contents.map(m => {
    const resolution = current(m.getFlag(MODULE_ID, "resolution"));
    return { id: m.id, origin: m._source.system?.origin ?? null, open: !!resolution && !CLOSED.has(resolution.step) };
  });
}

async function purge() {
  timer = null;
  if ( running || !game.users.activeGM?.isSelf ) return;
  const max = setting(PURGE_MAX_SETTING);
  const ids = planPurge(entries(), { max, keep: Math.min(setting(PURGE_KEEP_SETTING), max) });
  if ( !ids.length ) return;
  running = true;
  try {
    // Par lots : une seule opération de plusieurs centaines d'ids reste une seule requête, mais un seul rendu du journal par lot.
    for ( let i = 0; i < ids.length; i += 100 ) {
      const batch = ids.slice(i, i + 100).filter(id => game.messages.has(id));
      if ( batch.length ) await ChatMessage.implementation.deleteDocuments(batch);
    }
    log(`chat log purged: ${ids.length} old message(s) deleted, ${game.messages.size} remaining`);
  } catch ( err ) {
    console.error(`${MODULE_ID} | chat log purge`, err);
  } finally { running = false; }
}

/** Une purge à la fin d'une rafale de messages, pas pendant. */
function schedule() {
  if ( setting(PURGE_MAX_SETTING) <= 0 ) return;
  if ( game.messages.size <= setting(PURGE_MAX_SETTING) ) return;
  if ( timer ) clearTimeout(timer);
  timer = setTimeout(purge, 3000);
}

export function registerPurge() {
  const world = (key, value) => game.settings.register(MODULE_ID, key, {
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`,
    scope: "world", config: true, type: Number, default: value, range: { min: 0, max: 2000, step: 50 }, onChange: schedule
  });
  world(PURGE_MAX_SETTING, 300);
  world(PURGE_KEEP_SETTING, 150);
  route("ready", schedule, { executor: true, label: "chat log purge on load" });
  route("createChatMessage", schedule, { executor: true, label: "chat log purge" });
}
