/**
 * Chercher (Search, SPEC §16.49, règles 2024), sur le client de celui qui cherche — comme la Furtivité (runtime/hide.mjs),
 * c'est lui qui lance le dé :
 *  - l'item Chercher utilisé : les créatures cachées hostiles de la scène sont jugées (adapter/search.mjs) ; un test de
 *    Sagesse (Perception), au Désavantage si l'une d'elles est en zone légèrement obscurcie pour lui (core/search.mjs) ;
 *  - une créature trouvée cesse d'être cachée (« si un ennemi vous trouve ») : son effet de Furtivité est retiré — par le MJ
 *    actif quand elle n'appartient pas à celui qui cherche.
 * Chercher un objet ou un indice reste au MJ : le test est lancé de toute façon.
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { hiddenEffectsOf } from "../adapter/hide.mjs";
import { searchCandidates, perceptionRollParts } from "../adapter/search.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { searchRollMode, searchVerdicts } from "../core/search.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

export const SEARCH_QUERY = `${MODULE_ID}.search`;

async function removeHiding(targetUuid) {
  const actor = (await fromUuid(targetUuid))?.actor;
  const ids = hiddenEffectsOf(actor).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

async function reveal(token) {
  if ( token.actor?.isOwner ) return removeHiding(token.uuid);
  return game.users.activeGM?.query(SEARCH_QUERY, { target: token.uuid }, { timeout: 10000 }).catch(() => 0) ?? 0;
}

async function onPostUse(activity) {
  if ( basicActionOf(activity.item) !== "search" ) return;
  const actor = activity.actor;
  const searcher = usageTokenOf(activity);
  if ( !actor || !searcher ) return;
  const candidates = searchCandidates(searcher);
  const mode = searchRollMode(candidates);
  // §94 : ce que les traits ajoutent à la fouille — un dé (Guetteurs), l'Avantage (Œil vif, une utilisation de l'item s'il en reste).
  const bonuses = actor.items.map(i => ({ item: i, rule: contentOf(i).entry?.searchBonus })).filter(b => b.rule);
  const parts = bonuses.map(b => b.rule.formula).filter(Boolean);
  const keen = bonuses.find(b => b.rule.advantage && (!Number(b.item.system.uses?.max) || (Number(b.item.system.uses.value) > 0)));
  const rolls = await actor.rollSkill({ skill: "prc", disadvantage: mode === "disadvantage", ...(keen ? { advantage: true } : {}),
    ...(parts.length ? { rolls: [{ parts }] } : {}) }, { configure: false });
  const roll = rolls?.[0];
  if ( !Number.isFinite(roll?.total) ) return;
  const verdicts = searchVerdicts(candidates, perceptionRollParts(roll));
  const byId = new Map(candidates.map(c => [c.id, c.token]));
  log(`chercher : ${actor.name} (${roll.total}, ${mode}) — `
    + (verdicts.map(v => `${byId.get(v.id)?.name} DD ${v.dc} : ${v.found ? "trouvé" : "non"} (${v.reason}${v.total !== undefined ? ` ${v.total}` : ""})`).join(" ; ") || "aucune créature cachée"));
  const found = verdicts.filter(v => v.found).map(v => byId.get(v.id)).filter(Boolean);
  // Œil vif : « si le test échoue, l'utilisation n'est pas dépensée ».
  if ( keen && found.length && Number(keen.item.system.uses?.max) ) await keen.item.update({ "system.uses.spent": (Number(keen.item.system.uses.spent) || 0) + 1 });
  if ( parts.length || keen ) log(`chercher : ${[...parts, ...(keen ? [`Avantage (${keen.item.name})`] : [])].join(", ")}`);
  for ( const token of found ) {
    await reveal(token);
    notice(token, loc("Chercher.Trouve"), "ended");
  }
  if ( found.length ) ui.notifications.info(loc("Chercher.Trouves", { name: actor.name, names: found.map(t => t.name).join(", ") }));
  else ui.notifications.info(loc("Chercher.Rien", { name: actor.name, total: roll.total }));
}

export function registerSearch() {
  CONFIG.queries[SEARCH_QUERY] = ({ target }) => removeHiding(target);
  route("dnd5e.postUseActivity", activity => { onPostUse(activity).catch(err => console.error(`${MODULE_ID} | chercher`, err)); },
    { label: "chercher" });
}
