/**
 * Fonctions de test (api.mcp) : règles du tour et de la résolution — fins d'effets, abri, perception, avantage, sauvegardes,
 * soins et dégâts, aides aux tests, budget, présage, utilisation, factions, furtivité. Extrait de runtime/testing.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { naturalOneFor } from "./natural-one.mjs";
import { combatantFor, readBudget } from "../adapter/turn.mjs";
import { useIssues } from "./turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { movementCap } from "./actions.mjs";
import { ownEndingsOf, endingsOn, endFor } from "./action-end.mjs";
import { escapeGrapple } from "./grapple.mjs";
import { saveChanceOf } from "../adapter/hitchance.mjs";
import { identifierOf, contentOf, worldOverrides, setWorldOverride } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { attackContext, areAdjacent } from "../adapter/conditions.mjs";
import { attackModifiers } from "../core/conditions.mjs";
import { portentDice, portentOf, rollPortent } from "../adapter/portent.mjs";
import { aidsFor, isGuided } from "../adapter/skill-aid.mjs";
import { requestSkillAid } from "./skill-aid.mjs";
import { coverFor } from "../adapter/cover.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { factionsApi } from "./factions.mjs";
import { coneOf } from "../adapter/cone.mjs";
import { canSee as canSeeToken } from "../adapter/vision.mjs";
import { sightingOf } from "../adapter/search.mjs";
import { setHidden, check as stealthCheck, stealthViews } from "./stealth.mjs";
import { pickableNear, pickUp, scatterZones } from "./scatter.mjs";
import { unlitZones, ignitableNear, ignite } from "./flammable.mjs";
import { lastingRegions } from "../adapter/areas.mjs";
import { readAreaState } from "../adapter/areas.mjs";
import { isHidden, spottedBy } from "../adapter/stealth.mjs";
import { lightAt as lightAtPoint, tokenPoint as stealthPoint } from "../adapter/illumination.mjs";
import { sleep } from "./shared.mjs";
import { finite, gmOnly, viewedToken } from "./testing-shared.mjs";

/**
 * §43.2 : les effets auxquels une action met fin — ceux du token (`own`), ceux qu'un autre lui retire (`byOther`) ; et le
 * geste : sans `targetId`, le token prend « S'échapper » pour lui-même ; avec, il met fin au premier effet de la cible.
 */
export function endings({ tokenId }) {
  const token = viewedToken({ tokenId });
  const tell = e => ({ effect: e.effect.id, name: e.effect.name, item: e.item.name, by: e.rule.by, roll: e.rule.roll ?? null, dc: e.check?.dc ?? null });
  return { own: ownEndingsOf(token.actor).map(tell), byOther: endingsOn(token).map(tell) };
}

export async function actionEnd({ tokenId, targetId=null }) {
  const token = viewedToken({ tokenId });
  if ( !targetId ) { await escapeGrapple(token); return { done: true }; }
  const target = viewedToken({ tokenId: targetId });
  const ending = endingsOn(target)[0];
  return { done: ending ? await endFor(token, target, ending) : false };
}

/**
 * §62 : ce que le client voit à l'écran par les yeux d'un token — le MJ en prend le contrôle (sa vision devient celle de ce
 * token), on lit `isVisible` et le filtre de détection de chaque cible (le contour de l'ouïe, ou d'un mode spécial), puis le
 * contrôle d'avant est rendu.
 */
export async function perceived({ observerId, targetIds=[] }) {
  gmOnly();
  const observer = canvas.tokens.get(observerId);
  if ( !observer ) throw new Error(`token ${observerId} missing from the viewed scene`);
  const before = canvas.tokens.controlled.map(t => t.id);
  observer.control({ releaseOthers: true });
  canvas.perception.update({ initializeVision: true });
  await sleep(400);
  const out = {};
  for ( const id of targetIds ) {
    const token = canvas.tokens.get(id);
    if ( !token ) continue;
    const visible = token.isVisible;
    const color = token.detectionFilter?.uniforms?.outlineColor;
    out[id] = { name: token.name, visible, filter: visible && token.detectionFilter ? (color ? Array.from(color).map(c => Math.round(c * 100) / 100) : "autre") : null };
  }
  observer.release();
  for ( const id of before ) canvas.tokens.get(id)?.control({ releaseOthers: false });
  canvas.perception.update({ initializeVision: true });
  return out;
}

/** §172 : l'abri de la cible contre l'attaquant, tel que le verdict le calculera (`coverFor`), ou null. */
export function cover({ attackerId, targetId, itemId=null }) {
  const attacker = canvas.scene?.tokens.get(attackerId);
  const target = canvas.scene?.tokens.get(targetId);
  if ( !attacker || !target ) throw new Error("token not found on the viewed scene");
  // §173 : avec l'attaque d'un item (une arme à distance devant le Mur de vent).
  const activity = itemId ? attacker.actor?.items.get(itemId)?.system.activities.find(a => a.type === "attack") ?? null : null;
  return coverFor(attacker, target, { quiet: true, activity });
}

/**
 * Les valeurs calculées d'un token (données préparées par dnd5e, que le connecteur ne rend pas : il lit la source) : CA,
 * vitesses, PV, bonus aux attaques et aux sauvegardes — pour vérifier un effet passif sans passer par une attaque.
 */
export function stats({ tokenId }) {
  const tok = viewedToken({ tokenId });
  const actor = tok.actor;
  const a = actor?.system?.attributes ?? {};
  // dnd5e 6 range les bonus de jets sous `system.rolls` (`system.bonuses` ne garde que le DD de sort) et y traduit les
  // anciennes clés des effets (`system.bonuses.mwak.attack` → `system.rolls.attack.mwak.bonus`), vu en jeu le 2026-09-27.
  const rolls = actor?.system?.rolls ?? {};
  const attack = kind => rolls.attack?.[kind]?.bonus ?? "";
  return {
    ac: a.ac?.value ?? null, hp: { value: a.hp?.value ?? null, max: a.hp?.max ?? null, tempmax: a.hp?.tempmax ?? 0 },
    speed: Object.fromEntries(Object.entries(a.movement ?? {}).filter(([, v]) => typeof v === "number")),
    bonuses: { mwak: attack("mwak"), rwak: attack("rwak"), msak: attack("msak"), rsak: attack("rsak"),
      save: rolls.ability?.save?.bonus ?? "" },
    size: actor?.system?.traits?.size ?? null,
    mods: Object.fromEntries(Object.entries(actor?.system?.abilities ?? {}).map(([k, v]) => [k, v.mod ?? null])),
    statuses: Array.from(actor?.statuses ?? []),
    // §52 : la lumière du token telle que le cœur la rend (données préparées : effets `token.light.*` compris).
    light: (() => { const l = (tok?.document ?? tok)?.light ?? {}; return { bright: l.bright ?? 0, dim: l.dim ?? 0, angle: l.angle ?? 360,
      animation: l.animation?.type ?? null }; })()
  };
}

/** La chance d'échec de la sauvegarde que la pastille afficherait (§15.3), pour la comparer au vrai jet. */
export function saveChance({ casterId, targetId, itemId, activityId=null }) {
  const caster = viewedToken({ tokenId: casterId });
  const target = viewedToken({ tokenId: targetId });
  const item = caster.actor?.items.get(itemId);
  const activity = activityId ? item?.system.activities.get(activityId) : item?.system.activities.find(a => a.type === "save");
  const info = saveChanceOf(caster, target, activity);
  return info ? { ...info, dice: info.dice.map(d => ({ ...d })) } : null;
}

/**
 * Les raisons d'Avantage et de Désavantage que le moteur donnerait à cette attaque (core/conditions.mjs), et les créatures
 * hostiles au contact de l'attaquant — pour comprendre un jet « normal » inattendu.
 */
export function attackReasons({ attackerId, targetId, itemId, attackMode=null }) {
  const origin = viewedToken({ tokenId: attackerId });
  const target = viewedToken({ tokenId: targetId });
  const activity = origin.actor?.items.get(itemId)?.system.activities.find(a => a.type === "attack");
  if ( !activity ) throw new Error("no attack on this item");
  const factors = readUnitFactors();
  const { advantage, disadvantage } = attackModifiers(attackContext(origin, target, activity, attackMode, factors));
  const adjacentHostiles = origin.parent.tokens.filter(t => (t !== origin) && t.actor && !t.hidden
    && areEnemies(origin, t) && areAdjacent(origin, t, factors)).map(t => t.name);
  return { advantage: advantage.map(r => `${r.who}.${r.key}`), disadvantage: disadvantage.map(r => `${r.who}.${r.key}`), adjacentHostiles };
}

/**
 * §27 : pose (ou retire, `entry: null`) l'entrée d'un identifiant dans la surcouche du monde, et rend celle qu'il y avait —
 * pour qu'un scénario la remette (Incantation puissante à la place d'Impact divin).
 */
export async function overrideContent({ identifier, entry=null }) {
  gmOnly();
  const before = worldOverrides()[identifier] ?? null;
  await setWorldOverride(identifier, entry);
  return { before };
}

/**
 * §29 : applique l'enchantement d'une activité (son premier profil, ou `profile`) à un item de l'acteur — ce que dnd5e fait par un
 * glisser-déposer sur la carte (Décharge répulsive sur la Décharge occulte). Rend l'id de l'effet posé.
 */
export async function enchant({ tokenId, itemId, activityId, targetItemId, profile=null }) {
  const actor = viewedToken({ tokenId }).actor;
  const activity = actor?.items.get(itemId)?.system.activities?.get(activityId);
  const target = actor?.items.get(targetItemId);
  if ( !activity || !target ) throw new Error("activity or item not found");
  const effect = await activity.applyEnchantment(profile ?? activity.effects?.[0]?._id, target, { strict: true });
  return { effectId: effect?.id ?? null };
}

/** §23 : soigne un token comme le ferait un sort (`applyDamage` de type « healing ») ; rend ses PV avant et après. */
export async function heal({ tokenId, amount }) {
  const actor = viewedToken({ tokenId }).actor;
  const before = actor.system.attributes.hp.value;
  await actor.applyDamage([{ value: amount, type: "healing" }]);
  return { before, after: actor.system.attributes.hp.value };
}

/** §23 : des dégâts à un token, par `applyDamage` (résistances comprises) ; rend ses PV avant et après. */
export async function hurt({ tokenId, amount, type="bludgeoning", properties=[] }) {
  const actor = viewedToken({ tokenId }).actor;
  const before = actor.system.attributes.hp.value;
  // `properties` : celles du jet (« sil » : arme argentée, §78).
  await actor.applyDamage([{ value: amount, type, properties: new Set(properties) }]);
  return { before, after: actor.system.attributes.hp.value };
}

/** §23 : un jet de sauvegarde du token, sans fenêtre ; rend sa formule et son total. */
export async function rollSave({ tokenId, ability }) {
  const rolls = await viewedToken({ tokenId }).actor.rollSavingThrow({ ability }, { configure: false });
  return { formula: rolls?.[0]?.formula ?? null, total: rolls?.[0]?.total ?? null, d20: rolls?.[0]?.d20?.total ?? null };
}

/** §93 : ce qu'un 1 naturel déclenche chez la créature (le jet lui-même ne se force pas) — sans l'attendre : le scénario répond. */
export function naturalOne({ tokenId }) {
  naturalOneFor(viewedToken({ tokenId }).actor, "test").catch(err => console.error(err));
  return { started: true };
}

/** §90 : un test de compétence (`skill`) ou de caractéristique (`ability`), sans fenêtre ; ce qui suit le jet (dé ajouté) n'est pas attendu. */
export async function rollCheck({ tokenId, skill=null, ability=null }) {
  const actor = viewedToken({ tokenId }).actor;
  const rolls = skill ? await actor.rollSkill({ skill }, { configure: false }) : await actor.rollAbilityCheck({ ability }, { configure: false });
  return { formula: rolls?.[0]?.formula ?? null, total: rolls?.[0]?.total ?? null, d20: rolls?.[0]?.d20?.total ?? null };
}

/** §113 : les aides que la fenêtre d'un test de compétence ou d'outil proposerait à ce token. */
export function skillAids({ tokenId, skill=null, tool=null }) {
  return aidsFor(viewedToken({ tokenId }).actor, { skill, tool }).map(a => ({ kind: a.kind, helper: a.helper.name, token: a.token.id, self: a.self }));
}

/** §113 : l'aide demandée comme le ferait le bouton de la fenêtre ; rend si elle est donnée, et si l'Assistance est posée (attendue 10 s). */
export async function skillAid({ tokenId, helperTokenId, kind, skill=null, tool=null }) {
  const tester = viewedToken({ tokenId });
  const helper = viewedToken({ tokenId: helperTokenId }).actor;
  const granted = await requestSkillAid({ kind, helper, tester, skill, tool });
  let guided = skill ? isGuided(tester.actor, skill) : false;
  for ( let waited = 0; granted && (kind === "guidance") && !guided && (waited < 10000); waited += 250 ) {
    await sleep(250);
    guided = isGuided(tester.actor, skill);
  }
  return { granted, guided };
}

/** Ce qui cloche dans une utilisation (légalité du tour, états), sans l'utiliser ; `cost` force le coût (« bonus », « reaction »). */
export function issues({ tokenId, itemId, activityType=null, cost=null }) {
  const item = viewedToken({ tokenId }).actor?.items.get(itemId);
  const activity = item?.system.activities.find(a => !activityType || (a.type === activityType));
  if ( !activity ) throw new Error("activity not found");
  return useIssues(activity, { cost }).lines;
}

/** §20 : le budget du tour d'un combattant (action, action Bonus, Foncer, Se désengager, Vitesse à 0, déplacement en plus). */
export function budget({ tokenId }) {
  const token = viewedToken({ tokenId });
  const combatant = token.actor ? combatantFor(token.actor) : null;
  return combatant ? { ...readBudget(combatant), combatantId: combatant.id, cap: finite(movementCap(token)) } : null;
}

/**
 * §19.9 : sous quel identifiant le moteur reconnaît chaque item d'un token, d'où il le tient (item, source, compendium, nom) et
 * les clés de contenu qui s'y attachent — pour les items premium sans identifiant (Ravenloft), traduits par Babele.
 */
export function identify({ tokenId }) {
  const actor = viewedToken({ tokenId }).actor;
  return (actor?.items ?? []).map(item => {
    const { id, from } = identifierOf(item);
    return { item: item.name, id: item.id, identifier: id, from, rules: Object.keys(contentOf(item).entry ?? {}) };
  }).filter(r => r.rules.length || (r.from !== "item"));
}

/**
 * §36 : les jets notés du Présage d'un token — `roll: true` les lance comme au Repos long ; `rolls: [n…]` les fixe (scénario : des
 * valeurs connues) ; `clear: true` les efface. Rend le nombre de d20 du devin et son état.
 */
export async function portent({ tokenId, roll=false, rolls=null, clear=false }) {
  const actor = viewedToken({ tokenId }).actor;
  if ( !actor ) throw new Error("token without an actor");
  if ( clear ) await actor.unsetFlag(MODULE_ID, "portent");
  else if ( Array.isArray(rolls) ) await actor.setFlag(MODULE_ID, "portent", { rolls, turn: null });
  else if ( roll ) await rollPortent(actor);
  return { dice: portentDice(actor), ...portentOf(actor) };
}

/**
 * Une activité utilisée comme au clic (§47) : pose de zone de dnd5e comprise — à la différence de `use-activity` du connecteur,
 * qui la coupe (`create.measuredTemplate: false`). Sans emplacement ; la fenêtre de dnd5e, si elle s'ouvre, est relevée puis validée ; réactions du MJ refusées. Rend la carte
 * d'utilisation et les régions nées de cette activité dans les 3 s (une pose interactive, elle, attendrait un clic : rien).
 */
export async function use({ tokenId, itemId, activityType=null, extra=null, consume=false }) {
  gmOnly();
  const token = canvas.scene?.tokens.get(tokenId);
  const item = token?.actor?.items.get(itemId);
  const activity = item?.system.activities.find(a => !activityType || (a.type === activityType));
  if ( !activity ) throw new Error("activity not found");
  const before = new Set(canvas.scene.regions.map(r => r.id));
  const mine = () => canvas.scene.regions.filter(r => !before.has(r.id) && (r.getFlag("dnd5e", "activity") === activity.uuid));
  // La fenêtre d'utilisation de dnd5e, si elle s'ouvre, est relevée (avec ou sans case « Placer le gabarit ») puis validée.
  let dialog = null;
  const hook = Hooks.on("renderActivityUsageDialog", (app, element) => {
    dialog = { templateBox: !!element.querySelector('[name="create.measuredTemplate"]') };
    setTimeout(() => element.querySelector('button[type="submit"], [data-action="use"]')?.click(), 100);
  });
  let used;
  // `consume` : comme un vrai clic, ressources dépensées (§77 : sans charge, la fenêtre « Plus de charge » du MJ).
  try { used = await activity.use({ ...(consume ? {} : { consume: false }), [MODULE_ID]: { confirmed: true, autoReact: "none", ...(extra ?? {}) } }, { configure: true }); }
  finally { Hooks.off("renderActivityUsageDialog", hook); }
  for ( let i = 0; (i < 30) && !mine().length; i++ ) await sleep(100);
  return {
    messageId: used?.message?.id ?? null,
    dialog,
    regions: mine().map(r => ({ id: r.id, shapes: r.shapes.map(s => s.type), attachedTo: r.attachment?.token?.id ?? r.attachment?.token ?? null,
      elevation: { bottom: r.elevation.bottom, top: r.elevation.top } }))
  };
}

/** §53 : pour chaque effet d'un token, l'item d'origine que le moteur retrouve (item détruit : relu dans le message). */
export function effectOrigins({ tokenId }) {
  const actor = viewedToken({ tokenId }).actor;
  return (actor?.effects ?? []).map(e => {
    const item = originItemOf(e);
    return { id: e.id, effect: e.name, origin: e.origin ?? null, systemOrigin: e.system?.origin ?? null, item: item?.name ?? null,
      identifier: item ? identifierOf(item).id : null, statuses: Array.from(e.statuses ?? []), disabled: !!e.disabled };
  });
}

/**
 * §181 : les factions, pour un scénario. `op` : `state` (réglage, rancunes, factions des tokens donnés), `snapshot` / `restore`
 * (le réglage entier, `value`), `add` ({ name } → id), `relation` ({ a, b } faction ids, `relation` ou null), `assign`
 * ({ tokenIds, faction|null, actor }), `between` ({ aId, bId } tokens → relation), `grudges` ({ clear }), `stance`.
 */
export async function factions({ op="state", tokenIds=[], faction=null, actor=false, a, b, relation=null, aId, bId, name, value, clear=false, stance=null }={}) {
  const scene = canvas.scene;
  const tokens = tokenIds.map(id => viewedToken({ tokenId: id }));
  switch ( op ) {
    case "snapshot": return { value: foundry.utils.deepClone(game.settings.get(MODULE_ID, "factions")), grudges: scene.getFlag(MODULE_ID, "grudges") ?? [] };
    case "restore":
      await game.settings.set(MODULE_ID, "factions", value);
      if ( clear ) await scene.unsetFlag(MODULE_ID, "grudges");
      return { restored: true };
    case "add": return { id: await factionsApi.add({ name }) };
    case "relation": await factionsApi.setRelation(a, b, relation); return { relations: factionsApi.relations() };
    case "assign": await factionsApi.assign(tokens.map(t => (actor ? t.baseActor : t)), faction); return { factions: tokens.map(t => factionsApi.of(t)) };
    case "between": return { relation: factionsApi.relation(viewedToken({ tokenId: aId }), viewedToken({ tokenId: bId })) };
    case "grudges": if ( clear ) await factionsApi.grudge(null, null, { clear: true, scene }); return { grudges: factionsApi.grudges(scene) };
    case "stance": for ( const t of tokens ) await factionsApi.stance(t, stance); return { stances: tokens.map(t => t.getFlag(MODULE_ID, "stance") ?? null) };
    default: return {
      relations: factionsApi.relations(), grudges: factionsApi.grudges(scene),
      tokens: tokens.map(t => ({ name: t.name, faction: factionsApi.of(t), disposition: t.disposition }))
    };
  }
}

/** §182 : l'observateur voit-il la cible (vision du moteur), et son cône. */
export function sees({ observerId, targetId }) {
  const observer = viewedToken({ tokenId: observerId });
  const target = viewedToken({ tokenId: targetId });
  return { sees: canSeeToken(observer, target), cone: coneOf(observer), sighting: sightingOf(observer, target) };
}

/** §184 : la Furtivité BG3, pour un scénario. `op` : `state` | `set` ({ on }) | `check` | `forget`. */
export async function stealth({ op="state", tokenId, on=true }={}) {
  const token = viewedToken({ tokenId });
  if ( op === "set" ) await setHidden(token, on);
  if ( op === "check" ) await stealthCheck(token.parent);
  const point = lightAtPoint(stealthPoint(token));
  // Par nom ; deux observateurs du même nom (deux Bandits) se distinguent par leur id, sinon l'un cacherait l'autre.
  const names = token.parent.tokens.contents.map(t => t.name);
  const label = id => {
    const name = token.parent.tokens.get(id)?.name;
    if ( !name ) return id;
    return (names.filter(n => n === name).length > 1) ? `${name}#${id}` : name;
  };
  return { hidden: isHidden(token), sneaking: isHidden(token), spottedBy: spottedBy(token).map(label),
    views: Object.fromEntries(Object.entries(stealthViews(token.id)).map(([id, v]) => [label(id), v])),
    light: point?.level ?? null };
}

/**
 * §187 : les objets répandus de la scène (chausse-trapes, billes) et ceux que ce token peut ramasser ; `pickUp` : ramasse le premier,
 * comme l'entrée « Ramasser » du menu.
 */
export async function scatter({ tokenId, pickUp: take=false }) {
  const token = viewedToken({ tokenId });
  const tell = r => ({ id: r.id, item: readAreaState(r).scatter.item?.name ?? null, tile: readAreaState(r).scatter.tile ?? null });
  const near = pickableNear(token);
  const out = { zones: scatterZones(token.parent).map(tell), near: near.map(tell) };
  if ( take && near.length ) out.picked = await pickUp(token, near[0]);
  return out;
}

/**
 * §188 : les zones inflammables de la scène (en feu ou non) et celles que ce token peut allumer ; `ignite` : embrase la première qu'il
 * peut allumer (ou `regionId`), comme l'entrée « Allumer » du menu.
 */
export async function flammable({ tokenId, ignite: light=false, regionId=null }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const tell = r => ({ id: r.id, burning: readAreaState(r)?.burning ?? null, on: readAreaState(r)?.on ?? [] });
  const zones = lastingRegions(token.parent).filter(r => readAreaState(r)?.flammable || readAreaState(r)?.burning
    || unlitZones(token.parent).includes(r));
  const near = ignitableNear(token);
  const out = { zones: zones.map(tell), near: near.map(tell) };
  const target = regionId ? token.parent.regions.get(regionId) : near[0];
  if ( light && target ) out.lit = await ignite(target, "test");
  return out;
}
