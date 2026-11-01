/**
 * C12-d : activités données à une autre créature (`grants`, core/content.mjs). Souffle du dragon : « vous touchez une créature consentante
 * et lui donnez la faculté d'exhaler […] ; jusqu'à la fin du sort, la créature peut prendre une action Magie pour exhaler » — c'est elle qui
 * souffle, par sa propre action, au DD de sorts du lanceur et au niveau du lancement.
 *
 * Sur le MJ actif, au message d'utilisation de l'activité `from` : chaque cible reçoit une copie de l'item réduite à l'activité donnée
 * (méthode « à volonté », DD fixé à celui du lanceur, dés du niveau lancé), marquée `flags.dnd5e-combat.granted`. La copie part quand la
 * concentration du lanceur sur ce sort tombe (ou, sans concentration, quand le lanceur la retire). Rien n'est écrit sur l'item d'origine.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { concentrationOn } from "../adapter/summons.mjs";

/** La copie de l'item donnée à la cible : la seule activité donnée, au DD et au niveau du lanceur. */
function grantedData(item, rule, { dc, scaling }) {
  const data = item.toObject();
  delete data._id;
  const activity = foundry.utils.deepClone(data.system.activities?.[rule.activity]);
  if ( !activity ) return null;
  if ( activity.save ) activity.save.dc = { calculation: "", formula: String(dc) };
  // Les dés du niveau lancé : « +1d6 par niveau d'emplacement au-dessus du 2e » — la mise à l'échelle de la part, posée en dur.
  for ( const part of activity.damage?.parts ?? [] ) {
    const step = Number(part.scaling?.number) || 0;
    if ( scaling && step && Number.isFinite(part.number) ) part.number += step * scaling;
    part.scaling = { mode: "", number: null, formula: "" };
  }
  data.system.activities = { [rule.activity]: activity };
  data.system.method = "atwill";
  data.system.properties = (data.system.properties ?? []).filter(p => p !== "concentration");
  data.effects = [];
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { granted: { item: item.uuid, caster: item.actor?.uuid ?? null } } };
  return data;
}

/** MJ actif : l'activité qui donne a été utilisée — chaque cible du message reçoit sa copie. */
async function onUsage(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  const item = activity?.item;
  const rule = item ? contentOf(item).entry?.grants : null;
  if ( !rule || (rule.from !== activity.id) ) return;
  const caster = item.actor;
  const dc = Number(caster?.system?.attributes?.spell?.dc) || 10;
  const scaling = Math.max(0, (Number(message.getFlag("dnd5e", "scaling")) || 0));
  for ( const t of message.system?.targets ?? [] ) {
    const target = fromUuidSync(t.token ?? t.actor ?? "", { strict: false });
    const actor = target?.actor ?? target;
    if ( !actor || (actor === caster) ) continue;
    const old = actor.items.filter(i => i.getFlag(MODULE_ID, "granted")?.item === item.uuid).map(i => i.id);
    if ( old.length ) await actor.deleteEmbeddedDocuments("Item", old);
    const data = grantedData(item, rule, { dc, scaling });
    if ( !data ) continue;
    await actor.createEmbeddedDocuments("Item", [data]);
    log(`${item.name}: ${actor.name} can now use "${data.system.activities[rule.activity].name || item.name}" (DC ${dc})`);
  }
}

/** MJ actif : la concentration du lanceur sur un sort qui donne tombe — les copies partent. */
async function onConcentrationEnds(effect) {
  if ( !effect.statuses?.has?.("concentrating") ) return;
  const caster = effect.parent;
  const data = effect.getFlag("dnd5e", "item") ?? {};
  const itemId = data.id ?? data.data?._id;
  if ( !caster || !itemId ) return;
  const uuidEnd = `Item.${itemId}`;
  const actors = new Set([...game.actors, ...(canvas?.scene?.tokens ?? []).filter(t => !t.actorLink).map(t => t.actor)].filter(Boolean));
  for ( const actor of actors ) {
    const ids = actor.items.filter(i => {
      const g = i.getFlag(MODULE_ID, "granted");
      return g?.item?.endsWith(uuidEnd) && ((g.caster === caster.uuid) || (g.caster === caster.actor?.uuid) || !g.caster);
    }).map(i => i.id);
    if ( !ids.length ) continue;
    await actor.deleteEmbeddedDocuments("Item", ids);
    log(`${actor.name}: the granted activity ends with ${caster.name}'s concentration`);
  }
}

/**
 * C12-g : Double illusoire — « vous devenez Invisible au moment où un double illusoire apparaît » : dnd5e pose les effets d'une activité
 * d'invocation sur la créature invoquée (documents/activity/summon.mjs) ; `summonEffectsOnCaster` les remet sur le lanceur, liés à sa
 * concentration. Sur le client qui invoque.
 */
async function onPostSummon(activity, profile, tokens) {
  const item = activity?.item;
  const caster = item?.actor;
  if ( !caster || (contentOf(item).entry?.summonEffectsOnCaster !== true) ) return;
  const ids = (activity.effects ?? []).map(e => e._id).filter(Boolean);
  if ( !ids.length ) return;
  for ( const token of tokens ?? [] ) {
    const actor = token.actor ?? token.document?.actor;
    const copies = (actor?.effects ?? []).filter(e => ids.some(id => String(e._stats?.compendiumSource ?? e._stats?.duplicateSource ?? e.origin ?? "").includes(id) || (e.name === item.effects.get(id)?.name)));
    if ( copies.length && actor.isOwner ) await actor.deleteEmbeddedDocuments("ActiveEffect", copies.map(e => e.id));
  }
  const concentration = concentrationOn(item);
  for ( const id of ids ) {
    const placed = await placeItemEffect(item, id, caster);
    if ( placed && concentration?.addDependent ) await concentration.addDependent(placed);
    log(`${item.name}: "${item.effects.get(id)?.name ?? id}" on ${caster.name}, not on the summoned creature`);
  }
}

export function registerGrants() {
  route("dnd5e.postSummon", (activity, profile, tokens) => { onPostSummon(activity, profile, tokens).catch(err => console.error(`${MODULE_ID} | summon effects`, err)); },
    { label: "summon effects not moved to the caster" });
  route("createChatMessage", message => enqueue(`grants:${message.id}`, () => onUsage(message)), { executor: true, label: "granted activity not given" });
  route("deleteActiveEffect", effect => enqueue(`grants-end:${effect.id}`, () => onConcentrationEnds(effect)), { executor: true, label: "granted activity not removed" });
}
