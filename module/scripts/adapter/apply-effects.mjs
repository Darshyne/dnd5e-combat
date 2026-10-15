/**
 * L'application d'une résolution sur un token : effets de l'activité (repris du compendium s'ils manquent), poussées, états,
 * marques, retrait d'effets. Extrait d'adapter/saves.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { currentTurnKey } from "./turn.mjs";
import { effectKey, poolEffectsOf } from "./usage.mjs";
import { pushOf } from "./basics.mjs";
import { blockedFor } from "./eligibility.mjs";
import { conditionImmunitiesOf } from "./facts.mjs";
import { activityFor } from "./saves.mjs";

/**
 * §71 : l'effet qu'un profil de l'activité cite, absent de l'item du monde — la Dague des ombres d'un Familier de vampire importé le
 * 2026-10-04 l'avait perdu (l'activité gardait le profil `dsK5sPtkUMySmyvw`, l'item n'avait plus d'effet). On le prend sur la fiche
 * d'origine (compendium) : même acteur (`_stats.compendiumSource`, sinon un compendium d'acteurs qui a son id), même item, même effet.
 * L'effet du compendium s'applique tel quel (dnd5e note sa source, effect-application.mjs:237). Rien d'écrit sur la fiche.
 * §154 : d'abord la source de l'item lui-même — l'Image miroir de Kaalisti dans `dnd-6` (sort du Manuel, copié sur une fiche de
 * personnage) citait trois effets qu'elle n'avait plus ; le sort du compendium les a, sous les mêmes ids.
 */
async function lostEffectOf(activity, effectId) {
  const item = activity?.item;
  const actor = item?.actor;
  if ( !item || !actor ) return null;
  const own = [item._stats?.compendiumSource, item.flags?.core?.sourceId].filter(u => typeof u === "string" && u.startsWith("Compendium."));
  for ( const uuid of own ) {
    const effect = (await fromUuid(uuid).catch(() => null))?.effects?.get(effectId);
    if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from the item's source (${uuid}): the world item lost it`); return effect; }
  }
  const base = actor.isToken ? (actor.baseActor ?? actor) : actor;
  const sources = [base._stats?.compendiumSource, base.flags?.core?.sourceId].filter(u => typeof u === "string" && u.startsWith("Compendium."));
  for ( const uuid of sources ) {
    const source = await fromUuid(uuid).catch(() => null);
    const effect = source?.items?.get(item.id)?.effects?.get(effectId);
    if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from the source sheet (${uuid}): the world item lost it`); return effect; }
  }
  for ( const pack of game.packs.filter(p => p.documentName === "Actor") ) {
    if ( !pack.index.has(base.id) ) continue;
    const source = await pack.getDocument(base.id).catch(() => null);
    const effect = source?.items?.get(item.id)?.effects?.get(effectId);
    if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from ${pack.collection}: the world item lost it`); return effect; }
  }
  return null;
}

export async function applyEffectsToToken(usageMessage, tokenUuid, refs) {
  if ( !refs.length ) return [];
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return [];
  const tray = document.createElement("effect-application");
  tray.chatMessage = usageMessage;
  const applied = [];
  for ( const ref of refs ) {
    const activity = activityFor(usageMessage, ref.activity);
    // §37 : un effet de la réserve (`choice.pool`) n'est pas un profil de l'activité.
    const profile = [...(activity?.effects ?? []), ...poolEffectsOf(activity)].find(e => effectKey(e) === ref.id);
    const effect = (await profile?.getEffect()) ?? (profile ? await lostEffectOf(activity, ref.id) : null);
    if ( !effect ) {
      console.log(`${MODULE_ID} | effect ${ref.id} not found on ${activity?.item?.name ?? ref.activity}, nor on its source sheet`);
      continue;
    }
    // §16.8 : immunisée contre l'un de ses états, la créature ne reçoit pas l'effet (Motif hypnotique sans Charmé).
    if ( blockedFor(effect, actor).length ) continue;
    const result = await tray._applyEffectToActor(effect, actor);
    if ( result?.uuid ) applied.push(result.uuid);
  }
  return applied;
}

/**
 * Sépare des effets du plan ceux qui sont des poussées (« repoussé » de la Bousculade,
 * content/actions.mjs) : ils ne se posent pas, le moteur déplace la cible.
 * @returns {Promise<{effects: Array<{id: string, activity: string}>, pushes: object[]}>}
 */
export async function splitPushes(usageMessage, refs) {
  const effects = [];
  const pushes = [];
  for ( const ref of refs ) {
    const activity = activityFor(usageMessage, ref.activity);
    // §37 : un effet de la réserve (`choice.pool`) n'est pas un profil de l'activité.
    const profile = [...(activity?.effects ?? []), ...poolEffectsOf(activity)].find(e => effectKey(e) === ref.id);
    const push = pushOf(await profile?.getEffect());
    if ( push ) pushes.push(push);
    else effects.push(ref);
  }
  return { effects, pushes };
}

/**
 * Pose un état natif sur la cible (SPEC §16, étape `status` : À terre de Tempête de neige, Agrippé d'une
 * morsure…), avec l'activité pour origine — `hasEffectFrom` le retrouve, et l'annulation le retire comme
 * un effet de l'activité. `Actor#toggleStatusEffect` du cœur (client/documents/actor.mjs:547) ; un état
 * déjà porté n'est pas doublé. Rend l'UUID de l'effet créé, ou null.
 */
export async function applyStatusToToken(usageMessage, tokenUuid, status) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor || !CONFIG.statusEffects.some(s => s.id === status) ) return null;
  if ( actor.statuses.has(status) ) return null;
  if ( conditionImmunitiesOf(actor).includes(status) ) return null;   // §16.8 : immunisée, rien n'est posé
  const effect = await actor.toggleStatusEffect(status, { active: true });
  if ( !effect?.uuid ) return null;
  // Un état est un effet `condition`, dont le modèle de dnd5e retire `system.origin` (data/active-effect/
  // condition.mjs:12) : l'origine va dans le champ `origin` du cœur, que `originItemOf` lit en repli.
  const activity = usageMessage.getAssociatedActivity?.();
  // §157 : le tour de la pose noté, comme pour un effet d'item (runtime/cantrips.mjs) — « jusqu'à la fin de votre prochain tour ».
  if ( activity ) await effect.update({ origin: activity.uuid, ...(game.combat?.started ? { [`flags.${MODULE_ID}.placedOn`]: currentTurnKey() } : {}) });
  return effect.uuid;
}

/**
 * §54 : une marque (étape d'issue `mark`) — un effet nommé, à l'image de l'item, rattaché à l'activité et au message
 * d'utilisation (l'item peut être détruit : une fiole d'huile lancée), d'une durée en secondes. Une marque déjà là est remplacée.
 */
export async function applyMarkToToken(usageMessage, tokenUuid, step, label) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return null;
  const old = actor.effects.filter(e => e.getFlag(MODULE_ID, "mark") === step.mark).map(e => e.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  const activity = usageMessage.getAssociatedActivity?.();
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: label, img: activity?.item?.img ?? "icons/svg/aura.svg", type: "base", origin: activity?.uuid ?? null,
    system: { origin: { activity: activity?.uuid ?? null, message: usageMessage.uuid } },
    duration: step.seconds ? { seconds: step.seconds } : {},
    flags: { [MODULE_ID]: { mark: step.mark } }
  }]);
  return effect?.uuid ?? null;
}

/** Retire des effets posés par une résolution (annulation). */
export async function removeEffects(uuids) {
  for ( const uuid of uuids ) await (await fromUuid(uuid))?.delete();
}
