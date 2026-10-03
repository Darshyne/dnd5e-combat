/**
 * Lecture des messages de jet de dnd5e 6.0 et écriture des conséquences. Seul endroit, avec
 * units.mjs, qui connaît la forme des documents du système (SPEC §5.1).
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - un jet d'attaque crée un message `type: "attack"` avec `system.targets` (token, ca),
 *    `system.activity.uuid` et `system.origin` = message d'utilisation (activity/attack.mjs:158-166)
 *  - un jet de dégâts crée un message `type: "damage"` de même forme (activity/mixin.mjs:879-885)
 *  - le critique du dernier jet d'attaque est reporté sur le jet de dégâts par le système
 *    lui-même (activity/attack.mjs:306-310) : le moteur n'a pas à s'en mêler.
 */

import { MODULE_ID } from "../constants.mjs";
import { timedWait } from "./dialogs.mjs";
import { applyDamageShields } from "./defenses.mjs";
import { damageVariant } from "./variants.mjs";
import { sneakAttackFor, askStrikes } from "./sneak.mjs";
import { chooseSmite } from "./smite.mjs";

/** Id du message d'utilisation à l'origine d'un jet, ou null. */
function originOf(message) {
  return message._source.system?.origin ?? null;
}

/**
 * @param {ChatMessage} message  Message de type "attack".
 * @returns {object|null}        Entrées du cœur, ou null si le message n'est pas exploitable.
 */
export function readAttackMessage(message) {
  const roll = message.rolls?.[0];
  const activity = message.system?.activity?.uuid;
  if ( !roll || !activity ) return null;
  return {
    origin: originOf(message),
    activity,
    source: message.getAssociatedActor?.()?.uuid ?? null,
    roll: { total: roll.total, isCritical: roll.isCritical === true, isFumble: roll.isFumble === true },
    targets: (message.system.targets ?? []).map(t => ({ token: t.token, actor: t.actor, name: t.name, ac: t.ac ?? null }))
  };
}

/**
 * @param {ChatMessage} message  Message de type "damage" ou "healing" (même forme, heal.mjs:69-73).
 * @returns {{origin: string|null, activity: string, damages: object[]}|null}
 */
export function readDamageMessage(message) {
  const activity = message.system?.activity?.uuid;
  const rolls = message.rolls?.filter(r => r instanceof CONFIG.Dice.DamageRoll) ?? [];
  if ( !activity || !rolls.length ) return null;
  // Même agrégation que le plateau de dégâts du système (applications/components/damage-application.mjs:271).
  const damages = dnd5e.dice.aggregateDamageRolls(rolls, { respectProperties: true }).map(roll => ({
    properties: new Set(roll.options.properties ?? []),
    type: roll.options.type,
    value: Math.max(0, roll.total)
  }));
  return { origin: originOf(message), activity, damages };
}

/**
 * L'auteur d'une action lance ses dégâts au signal de la résolution : ceux de son attaque si elle
 * en a une, sinon ceux de l'activité, comme le bouton « Dégâts » de la carte (save.mjs:104-106).
 * À appeler sur le client de l'auteur : ce sont ses dés.
 * @param {ChatMessage} carrier   Le message qui porte la résolution.
 * @param {object} resolution
 * @param {boolean} critical      Verdict du moteur (core/action.mjs, isCriticalHit).
 */
export async function rollDamageFor(carrier, resolution, critical) {
  if ( resolution.attack ) {
    const attackMessage = game.messages.get(resolution.attack.messageId);
    return attackMessage ? rollDamageForAttack(attackMessage, { critical, variant: resolution.plan.variant?.activity ?? null }) : null;
  }
  const activity = carrier.getAssociatedActivity?.({ scaled: true });
  if ( !activity?.rollDamage ) return null;
  // Zone parcourue case par case (§16.20) : les dés sont multipliés au hook `preRollDamageV2` (runtime/areas.mjs).
  const times = carrier.getFlag?.(MODULE_ID, "areaTick")?.times ?? 1;
  const damageType = await chosenDamageType(carrier, activity);
  const ours = { ...(times > 1 ? { times } : {}), ...(damageType ? { damageType } : {}) };
  // Les modules d'animation (BLFX, `_afterAttackOrDamageRoll`) prennent les cibles de l'utilisateur au hook du jet, à défaut les
  // tokens qu'il contrôle : pour une zone ou une aura (Esprits gardiens à l'entrée, en début de tour), ce ne sont pas les créatures
  // touchées. Le temps du jet, les cibles de l'auteur sont celles de la résolution, puis on remet les siennes (§55).
  const restore = targetResolution(resolution.targets.map(t => t.token));
  try {
    return await activity.rollDamage(Object.keys(ours).length ? { [MODULE_ID]: ours } : {}, { configure: false }, {
      // Les cibles de la résolution, pas celles du message : pour une zone, seules les premières sont justes.
      data: { system: { origin: carrier.id, targets: resolution.targets.map(({ token, actor, name }) => ({ token, actor, name })) } }
    });
  } finally {
    restore();
  }
}

/**
 * Désigne ces tokens (uuids) comme les cibles de l'utilisateur de ce client, les autres relâchées. Rend la fonction qui remet
 * les cibles d'avant. Sans effet si les cibles sont déjà celles-là, ou si aucun de ces tokens n'est sur la scène affichée.
 * @param {string[]} uuids
 * @returns {() => void}
 */
export function targetResolution(uuids) {
  // Les tokens de la scène affichée (TokenLayer#setTargets, client/canvas/layers/tokens.mjs:341 : diffusé aux autres clients).
  const ids = uuids.map(uuid => fromUuidSync(uuid, { strict: false })?.object).filter(t => t?.scene === canvas.scene).map(t => t.id);
  const before = Array.from(game.user.targets).map(t => t.id);
  if ( !ids.length || ((before.length === ids.length) && ids.every(id => before.includes(id))) ) return () => {};
  canvas.tokens.setTargets(ids);
  return () => canvas.tokens.setTargets(before);
}

/**
 * Lance les dégâts d'une attaque qui a touché, sans dialogue, comme le ferait le bouton « Dégâts »
 * de la carte (activity/attack.mjs:303-311) : mêmes caractéristique, munition, mode d'attaque et
 * critique que le jet d'attaque. À appeler sur le client de l'auteur de l'attaque : ce sont ses dés.
 * @param {ChatMessage} attackMessage
 */
export async function rollDamageForAttack(attackMessage, { critical, variant=null }={}) {
  const used = await fromUuid(attackMessage.system.activity.uuid);
  // M5 (§18.8) : les dégâts de la variante choisie au plan (charge, En sang), sinon ceux de la variante « Attack with
  // Advantage » si le jet avait l'avantage (« plus 1d4 if the attack roll had Advantage »).
  const activity = (variant ? await fromUuid(variant) : null) ?? damageVariant(used, attackMessage.rolls[0]) ?? used;
  if ( !activity?.rollDamage ) return null;
  const { ability, ammunitionItem: ammunition, mode: attackMode } = attackMessage.system;
  // Le verdict du moteur prime : un coup qui touche une cible paralysée à 5 ft est critique sans 20 naturel.
  const isCritical = critical ?? (attackMessage.rolls[0]?.isCritical === true);
  const origin = originOf(attackMessage);
  const damageType = await chosenDamageType(game.messages.get(origin ?? "") ?? attackMessage, activity);
  // §20 : Frappes rusées — choisies avant le jet, elles retirent des dés à l'Attaque sournoise (runtime/sneak.mjs).
  const sneak = sneakAttackFor(used, attackMessage);
  const strikes = (sneak && !sneak.issue) ? await askStrikes(used.actor, sneak.target, sneak.dice) : [];
  // §25 : un châtiment — lancé « immédiatement après avoir touché », ses dés s'ajoutent à ce jet (runtime/smite.mjs).
  const smite = await chooseSmite(used, attackMessage);
  const ours = { ...(damageType ? { damageType } : {}), ...(strikes.length ? { strikes } : {}), ...(smite ? { smite } : {}) };
  return activity.rollDamage(
    { ability, ammunition, attackMode, isCritical, ...(Object.keys(ours).length ? { [MODULE_ID]: ours } : {}) },
    { configure: false },
    origin ? { data: { system: { origin } } } : {}
  );
}

/**
 * Les types au choix d'une activité (Orbe chromatique : acide, froid, feu… ; Étincelle divine : nécrotique ou radiant) :
 * ceux de la première part de dégâts qui en propose plusieurs (`DamageData#types`, un Set). dnd5e ne les fait choisir que
 * dans la fenêtre du jet — que le moteur ne montre pas : sans choix, il garderait le premier.
 */
export function damageTypeChoices(activity) {
  const size = types => types?.size ?? types?.length ?? 0;
  const part = (activity?.damage?.parts ?? []).find(p => size(p.types) > 1);
  if ( part ) return [...part.types];
  // §16.45 : les dégâts de base d'une arme (l'arme de pacte : son type normal, nécrotique, psychique ou radiant, au choix à
  // chaque attaque) — le type normal en premier, choisi par défaut.
  const base = (activity?.damage?.includeBase && (activity.item?.type === "weapon")) ? activity.item.system.damage?.base?.types : null;
  return size(base) > 1 ? [...base] : [];
}

/**
 * Le type choisi par l'auteur, sur son client, avant le jet (SPEC §16.27) ; retenu sur la carte d'utilisation (`damageType`)
 * pour qu'un rebond ou une relance reprenne le même. Sans réponse : le premier. null si l'activité n'offre pas de choix.
 */
async function chosenDamageType(carrier, activity) {
  const types = damageTypeChoices(activity);
  if ( types.length < 2 ) return null;
  const known = carrier?.getFlag?.(MODULE_ID, "damageType");
  if ( types.includes(known) ) return known;
  const label = t => game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t);
  const choice = await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.TypeDegats.Titre", { item: activity.item?.name ?? "" }) },
    content: `<p>${game.i18n.localize("DND5ECOMBAT.TypeDegats.Texte")}</p>`,
    buttons: types.map((t, i) => ({ action: t, label: label(t), default: i === 0 }))
  }, { fallback: types[0] });
  const type = types.includes(choice) ? choice : types[0];
  if ( carrier?.isOwner ) await carrier.setFlag(MODULE_ID, "damageType", type).catch(() => {});
  return type;
}

function readHp(actor) {
  const hp = actor.system.attributes.hp;
  return { value: hp.value, temp: hp.temp ?? 0 };
}

/**
 * Applique des dégâts à un token par la méthode publique du système, qui gère résistances,
 * immunités, vulnérabilités et PV temporaires. À n'appeler que sur le client du MJ actif.
 * @returns {Promise<object|null>}  Entrée de journal pour recordDamage(), ou null si la cible a disparu.
 */
export async function applyDamageToToken(tokenUuid, raw, originMessage, { multiplier=1, reduction=0, absorbInto=null }={}) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return null;
  const before = readHp(actor);
  // §16.46 : Résistance — les dégâts du type protégé réduits, avant leur application.
  const shielded = await applyDamageShields(actor, raw);
  const shields = shielded.done;
  // §24 : Parade — « réduit les dégâts totaux de l'attaque » : retiré part après part (avant résistances et multiplicateur).
  let left = Math.max(0, Number(reduction) || 0);
  const damages = shielded.damages.map(d => {
    const cut = Math.min(left, d.value);
    left -= cut;
    return cut ? { ...d, value: d.value - cut } : d;
  });
  // `multiplier` : part des dégâts subie après une sauvegarde réussie (actor.mjs:872).
  // §38 : `absorbInto` — la réserve d'un autre (Égide projetée) absorbe d'abord (adapter/absorb.mjs, `absorbDamage`).
  await actor.applyDamage(damages, { isDelta: true, origin: originMessage, multiplier, ...(absorbInto ? { [MODULE_ID]: { absorbInto } } : {}) });
  return {
    token: tokenUuid,
    actor: actor.uuid,
    rolled: damages.map(d => ({ type: d.type, value: d.value })),
    before,
    after: readHp(actor),
    shields
  };
}

/**
 * Le maximum d'un jet de soin (Lueur d'espoir, §16.24) : chaque jet du message relancé au maximum (`maximize` du cœur),
 * rendu dans la forme des dégâts sérialisés (un par type). null si le message manque.
 */
export async function maximizedHealing(damageMessage) {
  const rolls = damageMessage?.rolls ?? [];
  if ( !rolls.length ) return null;
  const out = [];
  for ( const roll of rolls ) {
    const max = await roll.clone().evaluate({ maximize: true });
    const type = roll.options?.type ?? "healing";
    out.push({ type, value: max.total, properties: new Set(roll.options?.properties ?? []) });
  }
  return out;
}

/** Restaure des PV consignés dans le journal d'une résolution. */
export async function restoreHp(actorUuid, hp) {
  const actor = await fromUuid(actorUuid);
  await actor?.update({ "system.attributes.hp.value": hp.value, "system.attributes.hp.temp": hp.temp });
}
