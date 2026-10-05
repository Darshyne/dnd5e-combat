/**
 * Le tour vu depuis dnd5e 6.0 et le cœur de Foundry V14 : combattant, budget persistant, coût
 * d'une activité, distances, déplacement.
 *
 * Vérifié :
 *  - un joueur peut modifier les `flags` de son propre combattant (common/documents/combatant.mjs:76-84) :
 *    le budget y vit, lisible par tous, corrigeable par son propriétaire et par le MJ
 *  - le cœur tient l'historique de déplacement de chaque token et le vide au début de son tour
 *    (client/documents/combat.mjs:1106, token.mjs:371) : le moteur ne recompte rien, il lit
 *  - vitesses : `system.attributes.movement.speeds.<type>` en 6.0, unité dans `movement.units`
 */

import { spentMovement } from "../core/movement.mjs";
import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { freshBudget, costOf } from "../core/turn.mjs";
import { convertLength } from "../core/units.mjs";
import { depthOf, verticalExtent, verticalGap } from "../core/space.mjs";
import { multiattackOf, useKeysOf, isMultiattackItem } from "./multiattack.mjs";
import { pendingMetamagic, distantRange } from "./metamagic.mjs";

/** Le combattant d'un acteur dans le combat en cours, ou null hors combat. */
export function combatantFor(actor) {
  if ( !actor || !game.combat?.started ) return null;
  return game.combat.getCombatantsByActor(actor)[0] ?? null;
}

/** Le tour de jeu en cours (« combat.round.turn »), pour « une réaction par tour » (§19.6). */
export function currentTurnKey() {
  const c = game.combat;
  return c?.started ? `${c.id}.${c.round}.${c.turn}` : null;
}

/** Réactions par round d'un acteur (contenu `reactions.perRound`, par exemple trois), une sinon. */
export function reactionsPerRound(actor) {
  let n = 1;
  for ( const item of actor?.items ?? [] ) n = Math.max(n, contentOf(item).entry?.reactions?.perRound ?? 1);
  return n;
}

/** Budget neuf d'un combattant, à ses réactions par round. */
export function freshBudgetFor(combatant) {
  return freshBudget({ reactions: reactionsPerRound(combatant?.actor) });
}

export function isOwnTurn(combatant) {
  return game.combat?.combatant?.id === combatant.id;
}

export function readBudget(combatant) {
  return combatant.getFlag(MODULE_ID, "turn") ?? freshBudgetFor(combatant);
}

export async function writeBudget(combatant, budget) {
  await combatant.setFlag(MODULE_ID, "turn", budget);
}

/**
 * Ce qu'une activité demande au budget (UseRequest du cœur). `costOverride` : « utiliser ma réaction ».
 * `attackMode` : le mode d'attaque s'il est connu. `offhand` est le mode de dnd5e pour une arme Légère
 * (data/item/weapon.mjs:188-195 ; les dégâts y perdent déjà le modificateur positif, attack-data.mjs:426) ;
 * Coup double se lit dans les bottes que l'acteur maîtrise pour cette arme (`masteryOptions`, weapon.mjs:331).
 */
export function requestFor(activity, costOverride=null, { attackMode=null }={}) {
  const item = activity.item;
  const weapon = item?.type === "weapon";
  const offhand = weapon && (attackMode?.endsWith("offhand") === true);
  const spellSlot = (item?.type === "spell") && ((item.system.level ?? 0) > 0)
    && !["atwill", "innate", "ritual"].includes(item.system.method)
    && (activity.consumption?.spellSlot !== false);
  // §31 : une activité qui « remplace une de vos attaques » (Souffle) se décompte comme une attaque de l'action Attaquer — §90 : même
  // sans activation dans la donnée (Frappe commandée : « lorsque vous entreprenez l'action Attaque »).
  const replaces = contentOf(item).entry?.replacesAttack === true;
  return {
    cost: costOverride ?? costOf(activity.activation?.type) ?? (replaces ? "action" : null),
    weaponAttack: ((activity.type === "attack") && ["weapon", "unarmed"].includes(activity.attack?.type?.classification)) || replaces,
    usesSpellSlot: spellSlot,
    lightWeapon: weapon && (item.system.properties?.has("lgt") === true),
    offhand,
    nick: offhand && !!item.system.masteryOptions?.some(m => m.value === "nick"),
    // M1 (§18.6) : les Attaques multiples d'un monstre, lues dans son texte anglais.
    multiattack: multiattackOf(activity.actor),
    keys: useKeysOf(activity),
    opensMultiattack: !!item && isMultiattackItem(item)
  };
}

/**
 * Nombre d'attaques qu'ouvre l'action Attaquer. Limite assumée : le système n'expose pas ce
 * nombre, on le déduit (Attaque supplémentaire, guerrier 11 et 20). Un PNJ à Attaques multiples
 * suit son plan (M1, core/multiattack.mjs) ; si son texte ne se lit pas, on ne le limite pas.
 */
export function attacksPerAction(actor) {
  const has = identifier => actor.items.some(i => i.system.identifier === identifier);
  if ( actor.type === "npc" ) return (actor.items.some(isMultiattackItem) && !multiattackOf(actor)) ? 99 : 1;
  const fighter = actor.classes?.fighter?.system.levels ?? 0;
  if ( fighter >= 20 ) return 4;
  if ( fighter >= 11 ) return 3;
  // Lame assoiffée (occultiste 5, §16.25) : une Attaque supplémentaire, réservée à l'arme de pacte — l'arme n'est
  // pas jugée (le budget ne connaît pas l'arme de la seconde attaque).
  // Lame dévorante (occultiste 12, §29) : l'attaque de plus devient deux.
  if ( has("devouring-blade") ) return 3;
  return (has("extra-attack") || has("thirsting-blade")) ? 2 : 1;
}

/**
 * Portée d'une activité. Pour une attaque d'arme on lit l'item : la portée préparée de l'activité
 * écrase la portée normale d'une arme de lancer par sa portée longue (vu en jeu : Lance 6/18 m →
 * `activity.range.value = 18`), ce qui ferait perdre le désavantage à portée longue.
 *
 * Une arme de mêlée qui se lance (Dague 20/60) a deux portées selon le **mode d'attaque** choisi
 * dans le dialogue du jet (weapon.mjs:196-205) : son allonge en mêlée, sa portée de lancer en
 * mode « thrown ». Tant que le mode n'est pas connu (à l'utilisation de l'item), on prend la plus
 * généreuse des deux ; c'est au jet d'attaque que la portée est jugée pour de bon.
 * @param {Activity} activity
 * @param {string|null} [attackMode]  Mode d'attaque retenu, s'il est connu.
 */
export function rangeOf(activity, attackMode=null) {
  // §16.43 : la portée de la règle quand les données disent autre chose (Trait ensorcelé : « personnelle » → 18 m).
  const fixed = activity.item ? contentOf(activity.item).entry?.ranges?.[activity.id] : null;
  if ( fixed ) return { value: fixed.value, long: null, units: fixed.units };
  const prepared = activity.range ?? {};
  const weapon = (activity.type === "attack") && (activity.item?.type === "weapon") ? activity.item.system.range : null;
  if ( !weapon ) {
    const range = { value: prepared.value ?? prepared.reach ?? null, long: prepared.long ?? null, units: prepared.units };
    // §32 : Sort ample, retenu pour ce sort.
    const distant = (activity.item?.type === "spell") && (range.units !== "self") && pendingMetamagic(activity.actor).includes("distant");
    return distant ? distantRange(range) : range;
  }
  const units = weapon.units ?? prepared.units;
  const reach = weapon.reach ?? prepared.reach ?? null;
  if ( activity.attack?.type?.value === "ranged" ) return { value: weapon.value ?? null, long: weapon.long ?? null, units };
  if ( !canBeThrown(activity) ) return { value: reach, long: null, units };
  if ( attackMode?.startsWith("thrown") ) return { value: weapon.value ?? null, long: weapon.long ?? null, units };
  if ( attackMode ) return { value: reach, long: null, units };
  return { value: Math.max(reach ?? 0, weapon.value ?? 0) || null, long: weapon.long ?? null, units };
}

/** Cette attaque est-elle celle d'une arme de mêlée qui peut aussi se lancer ? */
export function canBeThrown(activity) {
  return (activity.type === "attack") && (activity.item?.type === "weapon")
    && (activity.attack?.type?.value !== "ranged") && (activity.item.system.properties?.has("thr") === true);
}

/** Allonge de mêlée d'une attaque d'arme, avec son unité. */
export function reachOf(activity) {
  const weapon = activity.item?.system.range ?? {};
  return { value: weapon.reach ?? activity.range?.reach ?? null, long: null, units: weapon.units ?? activity.range?.units };
}

/**
 * Position VALIDÉE d'un token : celle de ses données source, c'est-à-dire la destination de son
 * dernier déplacement. Piège de Foundry V14, vu en jeu le 2026-09-20 : `token.x` / `token.y` sont
 * la position VISUELLE, qui suit l'animation. Lue 200 ms après un `moveToken`, elle est encore
 * proche du point de départ : le moteur calculait tout avec un coup de retard (une aura retirée
 * quand on s'approche, remise quand on s'éloigne). Dans un onglet masqué l'animation ne tourne
 * pas et l'écart ne se résorbe jamais. Toute mesure du moteur part donc de `_source`.
 */
export function committedPosition(token) {
  return positionOf(token._source);
}

/**
 * Ce qui fait une position de token, extrait de n'importe quel objet qui la porte (source, point de
 * passage). `depth` (hauteur en cases, champ du cœur V14) passe par la règle du moteur : dnd5e ne le
 * renseigne pas, une créature est tenue pour aussi haute que large (core/space.mjs, P2).
 */
export function positionOf({ x, y, elevation, width, height, depth, shape, level }) {
  return { x, y, elevation, width, height, depth: depthOf({ width, height, depth }), shape, level };
}

/** Le token qui utilise une activité. `getUsageToken()` rend déjà un TokenDocument (activity/mixin.mjs:1252). */
export function usageTokenOf(activity) {
  return activity.getUsageToken?.() ?? activity.actor?.token ?? activity.actor?.getActiveTokens()[0]?.document ?? null;
}

/** Centres des cases qu'un token occupe à une position donnée. Géométrie pure : ni murs, ni niveaux. */
function occupiedCenters(token, pos) {
  const grid = token.parent.grid;
  const width = Math.max(pos.width ?? token._source.width ?? 1, 0.5);
  const height = Math.max(pos.height ?? token._source.height ?? 1, 0.5);
  if ( grid.isGridless || !grid.isSquare ) {
    return [{ x: pos.x + ((width * grid.sizeX) / 2), y: pos.y + ((height * grid.sizeY) / 2) }];
  }
  const centers = [];
  for ( let i = 0; i < Math.ceil(height); i++ ) for ( let j = 0; j < Math.ceil(width); j++ ) {
    centers.push(grid.getCenterPoint({ x: pos.x + ((j + 0.5) * grid.sizeX), y: pos.y + ((i + 0.5) * grid.sizeY) }));
  }
  return centers;
}

/**
 * Distance entre deux tokens, unité de la grille, **en trois dimensions** (P2, §14.2) : la plus courte
 * entre deux cases qu'ils occupent, à leur position validée, plus l'écart vertical entre les tranches
 * qu'ils occupent (des pieds à la tête, `depth`) — nul quand elles se chevauchent. La règle de la
 * diagonale est celle de la grille : `measurePath` du cœur la joue en 3D dès que les points portent
 * une élévation (common/grid/square.mjs:542-545, gridless.mjs:167). Un vol à 60 ft au-dessus d'un
 * ennemi n'est plus « adjacent ».
 *
 * `posA` / `posB` : position hypothétique (départ ou arrivée d'un déplacement) à la place. On
 * n'utilise pas `getOccupiedGridSpaceOffsets` du cœur : il part de la position visuelle et écarte
 * les cases masquées par un mur, ce qui n'a rien à faire ici.
 */
export function distanceBetween(a, b, { posA, posB }={}) {
  const grid = a.parent.grid;
  const pa = posA ? { ...committedPosition(a), ...posA } : committedPosition(a);
  const pb = posB ? { ...committedPosition(b), ...posB } : committedPosition(b);
  const gap = verticalGap(verticalExtent(pa, grid.distance), verticalExtent(pb, grid.distance));
  let best = Infinity;
  for ( const p of occupiedCenters(a, pa) ) {
    for ( const q of occupiedCenters(b, pb) ) {
      best = Math.min(best, grid.measurePath([{ x: p.x, y: p.y, elevation: 0 }, { x: q.x, y: q.y, elevation: gap }]).distance);
    }
  }
  return { value: best, units: grid.units };
}

/**
 * L'historique de déplacement du tour d'un token, séparé en dépensé et en téléporté (`blink`, `displace` : actions
 * que le cœur marque `teleport`, CONFIG.Token.movement.actions ; le cœur mesure pourtant un `blink` comme un pas).
 * @returns {{spent: number, excluded: number}}
 */
export function historyCosts(token) {
  return spentMovement((token?.movementHistory ?? []).map(w => ({ cost: w.cost, teleport: CONFIG.Token.movement.actions[w.action]?.teleport === true })));
}

/**
 * Déplacement dépensé ce tour et vitesse de marche, dans l'unité de la grille.
 * @returns {{spent: number, speed: number, units: string}|null}
 */
export function movementOf(combatant, factors) {
  const token = combatant.token;
  const movement = combatant.actor?.system.attributes?.movement;
  if ( !token || !movement ) return null;
  // P2 : plus la hauteur franchie par les escaliers de ce tour, que le cœur ne retient pas (voir walk, adapter/movement.mjs).
  // §16.10 : une téléportation ou un déplacement forcé ne consomme pas de déplacement.
  // §17.2 : plus le déplacement dépensé pour se relever.
  const budget = readBudget(combatant);
  const spent = historyCosts(token).spent + (Number(budget.climbed) || 0) + (Number(budget.stood) || 0);
  return { spent, ...speedOf(combatant.actor, factors) };
}

/**
 * Vitesse de marche d'un acteur, dans l'unité de la grille (hors combat aussi : §67, la réaction qui rejoint l'attaquant).
 * @returns {{speed: number, units: string}|null}
 */
export function speedOf(actor, factors) {
  const movement = actor?.system.attributes?.movement;
  if ( !movement ) return null;
  const gridUnits = canvas.scene?.grid.units ?? movement.units;
  const walk = movement.speeds?.walk ?? movement.walk ?? 0;
  let speed = walk;
  try { speed = convertLength(walk, movement.units, gridUnits, factors); } catch { /* unité inconnue : valeur brute */ }
  return { speed, units: gridUnits };
}
