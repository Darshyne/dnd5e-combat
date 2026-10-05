/**
 * §92 : ce qu'un trait ajoute à une téléportation de soi (clé `afterTeleport: { spells, options }`) — la Foulée des fées du
 * Protecteur Archifée : « chaque fois que vous lancez [Foulée brumeuse], vous pouvez choisir l'un des effets supplémentaires » ;
 * l'Échappatoire brumeuse en ajoute deux. La téléportation faite (runtime/actions.mjs, `teleportSelf`), sur le client de celui qui
 * se téléporte : la question (« Aucun » d'abord), puis l'activité choisie, utilisée — sur la créature elle-même, ou (`around`) sur
 * les créatures à 1,50 m de la case quittée (`"left"`) ou de la case d'arrivée (`"arrival"`), elle exceptée.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { loc, log } from "./shared.mjs";

/** Les options que les traits de l'acteur ajoutent à cette téléportation. */
function optionsFor(actor, spell) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.afterTeleport;
    if ( !rule?.spells?.includes(spell) ) continue;
    for ( const option of rule.options ?? [] ) {
      const activity = item.system.activities?.get(option.activity);
      if ( activity ) out.push({ ...option, activity, item });
    }
  }
  return out;
}

/** Les créatures à 1,50 m d'une case (le token y étant posé par hypothèse), lui excepté. */
function around(token, at) {
  const scene = token.parent;
  let reach = 5;
  try { reach = convertLength(5, "ft", scene.grid.units, readUnitFactors()); } catch { /* grille en pieds */ }
  return scene.tokens.filter(t => t.actor && (t !== token) && (distanceBetween(t, token, { posB: at }).value <= (reach + 1e-6)));
}

/**
 * @param {Activity} activity   L'activité qui a téléporté (le sort).
 * @param {TokenDocument} token
 * @param {{x: number, y: number, elevation: number, level?: string}} from  La case quittée.
 */
export async function afterTeleportOptions(activity, token, from) {
  const actor = token?.actor;
  const spell = identifierOf(activity?.item).id;
  const options = optionsFor(actor, spell);
  if ( !options.length ) return;
  const label = o => (o.around ? loc(o.around === "left" ? "Foulee.Depart" : "Foulee.Arrivee", { name: o.activity.name }) : o.activity.name);
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: options[0].item.name, prompt: loc("Foulee.Question", { spell: activity.item.name }),
    options: [{ id: "none", label: loc("Foulee.Aucun") }, ...options.map((o, i) => ({ id: String(i), label: label(o) }))]
  });
  const chosen = options[Number(answer?.id)];
  if ( !chosen ) return;
  const here = { x: token._source.x, y: token._source.y, elevation: token._source.elevation ?? 0, level: token._source.level ?? null };
  const targets = chosen.around ? around(token, chosen.around === "left" ? from : here) : [token];
  canvas.tokens.setTargets(targets.map(t => t.id));
  log(`${chosen.item.name} : ${chosen.activity.name}${chosen.around ? ` sur ${targets.map(t => t.name).join(", ") || "personne"}` : ""}`);
  if ( chosen.around && !targets.length ) return;
  await chosen.activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false })
    .catch(err => console.error(`${MODULE_ID} | option de téléportation`, err));
}
