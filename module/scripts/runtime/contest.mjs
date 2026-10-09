/**
 * §72 : le test en opposition (clé de contenu `contest` : `{ activity?, skill, against, effect, exclusive? }`) — Combat perspicace :
 * « un test de Sagesse (Perspicacité) contre une créature qu'il voit, en opposition au test de Charisme (Tromperie) de la cible ; en cas
 * de succès… ». À `dnd5e.postUseActivity`, sur le client de l'auteur : son jet, puis celui de la cible (chez son joueur s'il est
 * connecté, sinon ici), l'issue annoncée au chat ; gagné, l'effet `effect` de l'activité est posé sur la cible (`exclusive` : ceux posés
 * ailleurs par le même item tombent). Ce que l'effet donne (avantage, désavantage) se déclare à part (`triggers`, `preAttackRoll`).
 */

import { MODULE_ID } from "../constants.mjs";
import { contestOf, rollContestSkill, playerOwnerOf, applyContestWin, announceContest } from "../adapter/contest.mjs";
import { contestOutcome } from "../core/contest.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

export const CONTEST_QUERY = `${MODULE_ID}.contest`;
const CONTEST_TIMEOUT = 30000;

/** Le jet de la cible : chez son joueur s'il est connecté (requête), sinon sur ce client. */
async function targetRoll(actor, skills) {
  const player = playerOwnerOf(actor);
  if ( player && (player !== game.user) ) {
    const answer = await player.query(CONTEST_QUERY, { actor: actor.uuid, skills }, { timeout: CONTEST_TIMEOUT }).catch(() => null);
    if ( answer ) return answer;
  }
  return rollContestSkill(actor, skills);
}

async function onPostUse(activity, usageConfig, results) {
  const rule = contestOf(activity);
  if ( !rule || !results?.message ) return;
  const actor = activity.actor;
  const target = (results.message.system?.targets ?? []).map(t => fromUuidSync(t.token ?? "", { strict: false })).find(Boolean)
    ?? [...game.user.targets][0]?.document ?? null;
  if ( !actor || !target?.actor ) return ui.notifications.info(loc("Opposition.SansCible", { item: activity.item.name }));
  const mine = await rollContestSkill(actor, [rule.skill]);
  const theirs = await targetRoll(target.actor, rule.against);
  if ( !mine || !theirs ) return;
  const outcome = contestOutcome(mine.total, theirs.total);
  log(`${activity.item.name}: ${actor.name} ${mine.skill} ${mine.total} vs ${target.name} ${theirs.skill} ${theirs.total} → ${outcome}`);
  await announceContest({ actor, target, mine, theirs, outcome, item: activity.item });
  if ( outcome !== "win" ) return;
  const n = await applyContestWin(results.message, activity, target, rule);
  if ( n ) log(`${activity.item.name}: effect applied to ${target.name}`);
}

export function registerContest() {
  CONFIG.queries[CONTEST_QUERY] = async ({ actor: uuid, skills }) => rollContestSkill(await fromUuid(uuid), skills);
  route("dnd5e.postUseActivity", onPostUse, { label: "contest not played" });
}
