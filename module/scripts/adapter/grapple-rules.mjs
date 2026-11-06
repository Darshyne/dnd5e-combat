import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { askChoice } from "./choices.mjs";

/**
 * §281 : ce que les items d'un agrippeur ajoutent à l'empoignade — `grappleSize` (`bonus` tailles de plus pour Agripper et Pousser,
 * `dragFree` : traîner sans surcoût une victime d'au plus tant de tailles de plus), `inescapable` (Désavantage contre sa prise),
 * `grappleCover` (abri contre les autres pendant qu'il agrippe).
 */
export function grappleRulesOf(actor) {
  const out = { bonus: 0, dragFree: null, inescapable: false, cover: null };
  for ( const item of actor?.items ?? [] ) {
    const entry = contentOf(item).entry;
    if ( !entry ) continue;
    if ( entry.grappleSize ) {
      out.bonus = Math.max(out.bonus, entry.grappleSize.bonus ?? 0);
      if ( Number.isInteger(entry.grappleSize.dragFree) ) out.dragFree = Math.max(out.dragFree ?? -Infinity, entry.grappleSize.dragFree);
    }
    if ( entry.inescapable === true ) out.inescapable = true;
    else if ( entry.inescapable && (out.inescapable !== true) ) out.inescapable = { item, activity: entry.inescapable.activity };
    if ( entry.grappleCover ) out.cover = entry.grappleCover;
  }
  return out;
}

/** §374 : l'item que vise une consommation « itemUses » (id, ou identifiant que dnd5e n'a pas ramené à un id : DDB Importer), sinon l'item. */
function usesItemOf(activity, target) {
  if ( !target ) return activity.item;
  return activity.actor?.items.get(target) ?? activity.actor?.items.find(i => identifierOf(i).id === target) ?? null;
}

/** §374 : ce que coûte l'activité — `[{ item, n }]` d'utilisations d'items, ou null si l'une manque. */
function costOf(activity) {
  const out = [];
  for ( const t of activity.consumption?.targets ?? [] ) {
    if ( t.type !== "itemUses" ) continue;
    const item = usesItemOf(activity, t.target);
    const n = Number(t.value) || 1;
    const uses = item?.system?.uses ?? {};
    const left = Number.isFinite(Number(uses.value)) ? Number(uses.value) : (Number(uses.max) || 0) - (Number(uses.spent) || 0);
    if ( !item || (left < n) ) return null;
    out.push({ item, n });
  }
  return out;
}

/**
 * §281, §374 : le Désavantage d'Inexorable contre cette sauvegarde ou ce test d'évasion — d'office (`true`), ou, payant, si
 * l'agrippeur (son joueur, sinon le MJ) le veut et peut payer ; la dépense faite. Sans réponse : non.
 * @param {Actor5e|null} grappler
 * @param {string} name  la créature qui fait le jet
 * @returns {Promise<boolean>}
 */
export async function inescapableFor(grappler, name) {
  const rule = grappleRulesOf(grappler).inescapable;
  if ( rule === true ) return true;
  const activity = rule ? rule.item.system.activities?.get(rule.activity) : null;
  const cost = activity ? costOf(activity) : null;
  if ( !cost ) return false;
  const label = activity.name || rule.item.name;
  const answer = await askChoice(grappler, { actor: grappler.uuid, item: label,
    prompt: game.i18n.format("DND5ECOMBAT.Inexorable.Question", { name, item: label }),
    options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.Inexorable.Non") }, { id: "yes", label: game.i18n.localize("DND5ECOMBAT.Inexorable.Oui") }] });
  if ( answer?.id !== "yes" ) return false;
  for ( const { item, n } of cost ) {
    await item.update({ "system.uses.spent": (Number(item.system.uses?.spent) || 0) + n })
      .catch(err => console.warn(`${MODULE_ID} | ${item.name}: use not spent`, err));
  }
  return true;
}
