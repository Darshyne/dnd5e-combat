/**
 * Bottes d'arme (SPEC §21) lues et écrites dans dnd5e 6.0 : la botte employée par une attaque, les marques que posent Sape, Coup
 * vexant et Ralentissement (des effets du moteur, `flags["dnd5e-combat"].mastery`), l'Avantage et le Désavantage qu'elles
 * donnent, et les créatures qu'Enchaînement peut atteindre. Les règles sont dans core/mastery.mjs.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - le message d'attaque porte la botte employée dans `system.mastery` (data/chat-message/attack-message-data.mjs:29), choisie
 *    parmi `masteryOptions` de l'arme — seulement si l'acteur maîtrise l'arme de base (data/item/weapon.mjs:331) ;
 *  - la caractéristique de l'attaque est `system.ability` du même message ;
 *  - la Vitesse se réduit par `system.attributes.movement.bonus`, ajouté à chaque vitesse non nulle (attributes.mjs:563-567).
 */

import { MODULE_ID } from "../constants.mjs";
import { isWithinRange } from "../core/units.mjs";
import { readUnitFactors, lengthIn } from "./units.mjs";
import { distanceBetween, reachOf, combatantFor, currentTurnKey } from "./turn.mjs";
import { isObjectToken } from "./bodies.mjs";
import { isDeadActor } from "./death.mjs";
import { areEnemies } from "./factions.mjs";
import { masterySources } from "../core/mastery.mjs";

const loc = (key, data) => game.i18n.format(`DND5ECOMBAT.Botte.${key}`, data ?? {});

/** La botte employée par ce jet d'attaque, ou null. */
export const masteryOf = attackMessage => attackMessage?.system?.mastery ?? null;

/** Le modificateur de la caractéristique employée pour ce jet d'attaque. */
export function attackModOf(attackMessage) {
  const actor = attackMessage?.getAssociatedActor?.();
  const ability = attackMessage?.system?.ability;
  return Number(actor?.system?.abilities?.[ability]?.mod) || 0;
}

/** Les marques de botte d'une sorte portées par un acteur. */
export function marksOn(actor, kind=null) {
  return Array.from(actor?.effects ?? []).filter(e => {
    const m = e.getFlag?.(MODULE_ID, "mastery");
    return m && (!kind || (m.kind === kind));
  });
}

const IMAGES = Object.freeze({ sap: "icons/svg/downgrade.svg", vex: "icons/svg/target.svg", slow: "icons/svg/net.svg", studied: "icons/svg/eye.svg",
  reckless: "icons/svg/sword.svg" });

/**
 * L'effet d'une marque. `bearer` : qui la porte (la cible pour Sape et Ralentissement, l'attaquant pour Ouverture).
 * @param {"sap"|"vex"|"slow"} kind
 * @param {{source: TokenDocument, target: TokenDocument, weapon: Item5e, turnKey: string|null}} context
 */
export function markData(kind, { source, target, weapon, turnKey }) {
  const changes = [];
  if ( kind === "slow" ) {
    // « Réduire sa Vitesse de 3 m » : 10 ft, dans l'unité de vitesse de la créature ralentie.
    const units = target.actor?.system?.attributes?.movement?.units ?? "ft";
    let value = lengthIn(10, "ft", units);
    changes.push({ key: "system.attributes.movement.bonus", value: String(-value), type: "add" });
  }
  return {
    name: loc(`Marque.${kind}`, { source: source.name, target: target.name, weapon: weapon?.name ?? "" }),
    img: IMAGES[kind],
    transfer: false, disabled: false,
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    origin: weapon?.uuid ?? null,
    // Hors combat, une marque ne vit qu'un round (au MJ de la retirer plus tôt) ; en combat, le moteur la retire à son heure.
    duration: { value: 12, units: "seconds" },
    system: { changes },
    flags: { [MODULE_ID]: { mastery: {
      kind, source: source.actor?.uuid ?? null, sourceToken: source.uuid, target: target.uuid,
      combatant: combatantFor(source.actor)?.id ?? null, placedOn: turnKey
    } } }
  };
}

/**
 * L'Avantage et le Désavantage que donnent les marques pour une attaque de `sourceToken` contre `targetToken` : Sape portée par
 * l'attaquant (Désavantage à son prochain jet), Ouverture portée par l'attaquant contre cette cible (Avantage).
 * @returns {{advantage: string[], disadvantage: string[], consumed: ActiveEffect[]}}
 */
export function markModifiers(sourceToken, targetToken, activity=null) {
  const out = { advantage: [], disadvantage: [], consumed: [] };
  const attacker = sourceToken?.actor;
  if ( !attacker ) return out;
  // §22 : Témérité — « l'Avantage aux jets d'attaque utilisant la Force », et « les jets d'attaque contre vous ont l'Avantage ».
  // Jusqu'au début de son prochain tour ; rien n'est consommé.
  if ( (activity?.ability === "str") ) for ( const effect of marksOn(attacker, "reckless") ) out.advantage.push(effect.name);
  for ( const effect of marksOn(targetToken?.actor, "reckless") ) out.advantage.push(effect.name);
  for ( const effect of marksOn(attacker, "sap") ) {
    out.disadvantage.push(effect.name);
    out.consumed.push(effect);
  }
  // Ouverture, et Attaques avisées du Guerrier (§21) : l'Avantage contre la créature marquée seulement.
  for ( const effect of [...marksOn(attacker, "vex"), ...marksOn(attacker, "studied")] ) {
    if ( effect.getFlag(MODULE_ID, "mastery").target !== targetToken?.uuid ) continue;
    out.advantage.push(effect.name);
    out.consumed.push(effect);
  }
  return out;
}

/**
 * Enchaînement : les créatures qu'une seconde attaque peut viser — hostiles à l'attaquant, autres que la première, à 1,50 m
 * d'elle et à l'allonge de l'arme, ni mortes ni cachées, pas des objets.
 * @param {TokenDocument} attacker
 * @param {TokenDocument} first
 * @param {Activity} activity
 */
export function cleaveCandidates(attacker, first, activity) {
  const factors = readUnitFactors();
  const r = reachOf(activity);
  const reach = { value: r.value ?? 5, units: r.units ?? "ft" };   // allonge non renseignée : 1,50 m
  const near = (a, b, range) => { try { return isWithinRange(distanceBetween(a, b), range, factors); } catch { return false; } };
  return first.parent.tokens.filter(t => (t !== first) && (t !== attacker) && t.actor && !t.hidden && !isObjectToken(t)
    && !isDeadActor(t.actor) && ((t.actor.system.attributes?.hp?.value ?? 1) > 0)
    && areEnemies(attacker, t)
    && near(first, t, { value: 5, units: "ft" }) && near(attacker, t, reach));
}

/** Enchaînement déjà employé à ce tour de combat par cet acteur ? (« une fois par tour » ; hors combat, jamais.) */
export const cleaveSpent = actor => !!currentTurnKey() && (actor?.getFlag(MODULE_ID, "cleaveTurn") === currentTurnKey());

/* -------------------------------------------- */
/*  Les bottes choisies (§222)                  */
/* -------------------------------------------- */

/**
 * Le drapeau d'acteur posé à la fin d'un Repos long : `{ allowance }`, le nombre de bottes que le joueur peut encore changer.
 * Retiré une fois dépensé, ou quand l'acteur entre en combat.
 */
export const MASTERY_REST_FLAG = "masteryRest";

/** Les bottes choisies, telles qu'enregistrées (pas celles qu'un effet ajoute) : `system.traits.weaponProf.mastery.value`. */
export const chosenMasteries = actor => Array.from(actor?._source?.system?.traits?.weaponProf?.mastery?.value ?? []);

/** Ce qu'un Repos long laisse encore changer. */
export const restAllowanceOf = actor => Math.max(0, Number(actor?.getFlag?.(MODULE_ID, MASTERY_REST_FLAG)?.allowance) || 0);

/**
 * Les sources de bottes de l'acteur (core/mastery.mjs `masterySources`) : avancements « Trait » en mode « mastery » de ses items —
 * classe (data/item/class.mjs, `system.levels`), sous-classe (niveau de sa classe, `item.class`), don ou autre (toujours).
 * Lus dans la source de l'item (`_source.system.advancement`, objet par id en dnd5e 6).
 */
export function masterySourcesOf(actor) {
  const items = [];
  for ( const item of actor?.items ?? [] ) {
    const advancements = Object.values(item._source?.system?.advancement ?? {})
      .filter(a => (a?.type === "Trait") && (a.configuration?.mode === "mastery"))
      .map(a => ({ level: Number(a.level) || 0,
        count: (a.configuration?.grants?.length ?? 0) + (a.configuration?.choices ?? []).reduce((n, c) => n + (Number(c.count) || 0), 0) }));
    if ( !advancements.length ) continue;
    const classLevel = (item.type === "class") ? Number(item.system.levels)
      : (item.type === "subclass") ? Number(item.class?.system?.levels ?? NaN) : null;
    items.push({ item: item.id, label: (item.type === "class") ? `${item.name} ${classLevel}` : item.name,
      identifier: (item.type === "subclass") ? (item.system.classIdentifier ?? "") : (item.system.identifier ?? ""),
      kind: item.type, classLevel, advancements });
  }
  return masterySources(items);
}

/** L'aptitude ou le don qui ouvre la fenêtre des bottes : « Bottes d'arme » d'une classe, « Maître d'armes ». */
export const MASTERY_FEATURES = Object.freeze(["weapon-mastery", "weapon-master"]);

let weaponIndex = null;

/**
 * Les armes de base de dnd5e (`CONFIG.DND5E.weaponIds`) : clé, nom (`Trait.keyLabel`, traduit), corps à corps ou distance, catégorie
 * (`weaponProficienciesMap`), botte (`system.mastery` de l'item du compendium, lu dans son index). L'index se lit une fois.
 * @returns {Promise<Array<{key: string, label: string, melee: boolean, category: string|null, mastery: string|null}>>}
 */
export async function baseWeapons() {
  if ( weaponIndex ) return weaponIndex;
  const fields = ["system.mastery", "system.type.value"];
  const packs = new Map();
  const out = [];
  for ( const [key, id] of Object.entries(CONFIG.DND5E.weaponIds ?? {}) ) {
    const uuid = dnd5e.documents.Trait.getBaseItemUUID(id);
    const { collection, documentId } = foundry.utils.parseUuid(uuid);
    let entry = null;
    if ( collection ) {
      const pack = collection.metadata.id;
      if ( !packs.has(pack) ) packs.set(pack, await collection.getIndex({ fields }).catch(() => null));
      entry = packs.get(pack)?.get(documentId) ?? null;
    }
    const type = entry?.system?.type?.value ?? "";
    out.push({ key, label: dnd5e.documents.Trait.keyLabel(key, { trait: "weapon" }) ?? key, melee: !type.endsWith("R"),
      category: CONFIG.DND5E.weaponProficienciesMap?.[type] ?? null, mastery: entry?.system?.mastery || null });
  }
  weaponIndex = out.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  return weaponIndex;
}

/** L'acteur maîtrise-t-il cette arme de base (sa catégorie ou elle-même, `system.traits.weaponProf.value` préparé) ? */
export function proficientWith(actor, weapon) {
  const prof = actor?.system?.traits?.weaponProf?.value;
  const has = k => (prof?.has?.(k) ?? Array.from(prof ?? []).includes(k));
  return has(weapon.key) || (!!weapon.category && has(weapon.category));
}

/**
 * Les armes de base, telles que la règle les juge pour cet acteur : `{ clé: { melee, proficient } }`. Synchrone (pour un hook `pre…`) :
 * vide tant que `baseWeapons()` n'a pas été lu une fois (le moteur le lit à `ready`).
 */
export function weaponFacts(actor) {
  return Object.fromEntries((weaponIndex ?? []).map(w => [w.key, { melee: w.melee, proficient: proficientWith(actor, w) }]));
}
