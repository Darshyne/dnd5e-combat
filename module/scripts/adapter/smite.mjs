/**
 * Sorts de châtiment (SPEC §25) lus et dépensés dans dnd5e 6.0 : quels châtiments l'auteur d'un coup peut lancer, à quels niveaux,
 * ce qu'ils ajoutent au jet de dégâts. Sur le client de l'auteur (ce sont ses emplacements).
 *
 * Vérifié dans dnd5e 6.0.3 : les emplacements restants sont dans `system.spells.spell<N>.value` et `system.spells.pact`
 * (`value`, `level`) ; un sort à utilisation gratuite (Châtiment divin du paladin) porte `system.uses` (max 1, repos long) ; une part
 * de dégâts « whole » grandit de `scaling.number` dés par niveau au-dessus de celui du sort.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { combatantFor, readBudget } from "./turn.mjs";
import { creatureTypeOf, originItemOf, carriesEffectFrom } from "./facts.mjs";
import { timedWait } from "./dialogs.mjs";
import { isSpellCast } from "./scrolls.mjs";

const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Chatiment.${key}`, data ?? {});

/** Un coup au corps à corps avec une arme ou une frappe à mains nues ? */
export function meleeWeaponHit(activity, attackMode) {
  const mode = attackMode ?? "";
  return (activity?.type === "attack") && (activity.attack?.type?.value === "melee") && !mode.startsWith("thrown")
    && ((activity.item?.type === "weapon") || (activity.attack?.type?.classification === "unarmed"));
}

/**
 * Les châtiments possibles : pour chaque sort qui en déclare un, chaque niveau d'emplacement restant (et l'emplacement de pacte), et
 * l'utilisation gratuite de l'item s'il en a une. Rien sans action Bonus disponible en combat.
 * @returns {Array<{item: Item5e, rule: object, level: number, slot: string|null, free: boolean, label: string}>}
 */
export function smiteOptions(actor) {
  const combatant = combatantFor(actor);
  if ( combatant && !((readBudget(combatant)?.bonus ?? 1) >= 1) ) return [];
  const spells = actor?.system?.spells ?? {};
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = isSpellCast(item) ? contentOf(item).entry?.smite : null;
    // Une copie plus ancienne du sort, sans l'activité de dégâts déclarée, n'est pas proposée.
    if ( !rule || !item.system.activities?.get(rule.damage) ) continue;
    const base = Number(item.system.level) || 1;
    const uses = item.system.uses;
    if ( Number(uses?.max) && ((uses.value ?? (Number(uses.max) - (uses.spent ?? 0))) > 0) ) {
      out.push({ item, rule, level: base, slot: null, free: true, label: t("Gratuit", { item: item.name }) });
    }
    for ( let level = base; level <= 9; level++ ) {
      if ( (Number(spells[`spell${level}`]?.value) || 0) > 0 ) out.push({ item, rule, level, slot: `spell${level}`, free: false, label: t("Niveau", { item: item.name, level }) });
    }
    const pact = spells.pact;
    if ( ((Number(pact?.value) || 0) > 0) && ((pact.level ?? 0) >= base) ) {
      out.push({ item, rule, level: pact.level, slot: "pact", free: false, label: t("Niveau", { item: item.name, level: pact.level }) });
    }
  }
  return out;
}

/**
 * « Une fois par tour » (Frappe occulte) : n'importe quel tour, en combat — le combat où l'acteur se bat, pas `game.combat` (le combat
 * affiché, qui peut en être un autre).
 */
function turnKey(actor) {
  const combat = combatantFor(actor)?.parent ?? null;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

/**
 * L'arme du coup est-elle enchantée par l'item `id` (arme de pacte : « pact-of-the-blade ») ? Si aucune arme de l'acteur ne l'est
 * (pacte jamais posé sur cette fiche, arme liée à la main du temps de Midi), toute arme de corps à corps compte.
 */
function wieldsBound(activity, actor, id) {
  const bound = item => (item?.effects ?? []).some(e => !e.disabled && (e.isAppliedEnchantment ?? (e.type === "enchantment"))
    && (identifierOf(originItemOf(e) ?? {}).id === id));
  if ( bound(activity?.item) ) return true;
  return !(actor?.items ?? []).some(i => (i.type === "weapon") && bound(i));
}

/**
 * Ce qu'on peut ajouter à un coup qui touche (`hitRider`) : §31, les faveurs d'espèce (Ascendance gigante — Brûlure ignée, Froid
 * mordant, Renversement des coteaux), tant que l'item a une utilisation ; §47 bis, la Frappe occulte (emplacement de pacte, arme de
 * pacte au corps à corps, une fois par tour). L'état (À terre) ne vaut que contre une cible de taille `sizeAtMost` au plus ; une
 * faveur qui ne fait que cela n'est pas proposée contre une plus grande.
 */
export function riderOptions(actor, target, activity=null, attackMode=null) {
  const sizes = ["tiny", "sm", "med", "lg", "huge", "grg"];
  const turn = turnKey(actor);
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.hitRider;
    if ( !rule ) continue;
    let left;
    let level = null;
    // §87 : la faveur se paie avec une utilisation d'un AUTRE item (les manœuvres : les dés de Supériorité martiale).
    const payer = rule.pays ? (actor.items.find(i => identifierOf(i).id === rule.pays) ?? null) : null;
    if ( rule.pays && !payer ) continue;
    if ( payer ) {
      const uses = payer.system.uses ?? {};
      left = Number.isFinite(Number(uses.value)) ? Number(uses.value) : (Number(uses.max) || 0) - (Number(uses.spent) || 0);
    } else if ( rule.slot === "pact" ) {
      const pact = actor.system?.spells?.pact ?? {};
      left = Number(pact.value) || 0;
      level = Number(pact.level) || 0;
    } else if ( !(item.system.uses?.max ?? "") ) left = Infinity;   // §78 : sans maximum, sans compter (Piqué)
    else {
      const uses = item.system.uses ?? {};
      left = Number.isFinite(Number(uses.value)) ? Number(uses.value) : (Number(uses.max) || 0) - (Number(uses.spent) || 0);
    }
    if ( !(left > 0) ) continue;
    // §95 : seulement tant qu'un effet de l'item est sur le porteur (Avatar terrifiant : sous la Forme d'effroi).
    if ( rule.whileActive && !carriesEffectFrom(actor, identifierOf(item).id) ) continue;
    if ( rule.weapon && !(meleeWeaponHit(activity, attackMode) && wieldsBound(activity, actor, rule.weapon)) ) continue;
    // §78 : seulement avec l'arme de cet identifiant (Piqué : l'épée courte).
    if ( rule.item && (identifierOf(activity?.item ?? {}).id !== rule.item) ) continue;
    const key = identifierOf(item).id ?? item.id;
    if ( rule.oncePerTurn && turn && (actor.getFlag(MODULE_ID, `oncePerTurn.${key}`) === turn) ) continue;
    const size = target?.actor?.system?.traits?.size;
    const fits = !rule.sizeAtMost || !size || (sizes.indexOf(size) <= sizes.indexOf(rule.sizeAtMost));
    if ( !fits && !rule.damage && !rule.effect ) continue;
    const unlimited = left === Infinity;
    const label = (rule.slot === "pact") ? t("FaveurPacte", { item: item.name, level, n: left })
      : (unlimited ? item.name : t("Faveur", { item: item.name, n: left }));
    out.push({ item, rule, rider: true, free: false, unlimited, level, fits, payer, once: rule.oncePerTurn ? key : null, label });
  }
  return out;
}

/** Les dés que le châtiment ajoute, au niveau lancé, contre cette cible : `{ formula, type }`, ou null. */
export function smiteDamage(option, target) {
  const { item, rule, level } = option;
  if ( option.rider ) {
    // Une faveur sans dégâts (Renversement des coteaux) : rien à lancer, mais elle vaut.
    const part = rule.damage ? item.system.activities?.get(rule.damage)?.damage?.parts?.[0] : null;
    const type = Array.from(part?.types ?? [])[0] ?? null;
    // Une formule libre (Frappe occulte : « (1 + @spells.pact.level)d8 »), lue avec les données de l'acteur : « 4d8 » au niveau 3.
    if ( part?.custom?.enabled && part.custom.formula ) {
      const formula = Roll.replaceFormulaData(part.custom.formula, item.actor?.getRollData() ?? {});
      const sum = formula.match(/^\(\s*(\d+)\s*\+\s*(\d+)\s*\)d(\d+)$/);
      return { formula: sum ? `${Number(sum[1]) + Number(sum[2])}d${sum[3]}` : formula, type };
    }
    if ( !part?.number || !part.denomination ) return { formula: null, type: null };
    return { formula: `${part.number}d${part.denomination}`, type };
  }
  const undead = ["fiend", "undead"].includes(creatureTypeOf(target?.actor));
  const activity = item.system.activities?.get((undead && rule.fiends) ? rule.fiends : rule.damage);
  const part = activity?.damage?.parts?.[0];
  if ( !part?.number || !part.denomination ) return null;
  const extra = Math.max(0, level - (Number(item.system.level) || 1)) * (Number(part.scaling?.number) || 0);
  const type = Array.from(part.types ?? [])[0] ?? null;
  return { formula: `${part.number + extra}d${part.denomination}`, type };
}

/** Dépense ce que coûte le châtiment choisi : l'utilisation gratuite, ou l'emplacement. */
export async function spendSmite(actor, option) {
  if ( option.once ) {
    const turn = turnKey(actor);
    if ( turn ) await actor.setFlag(MODULE_ID, `oncePerTurn.${option.once}`, turn);
  }
  if ( option.rider && (option.rule.slot === "pact") ) {
    const value = Number(actor.system.spells?.pact?.value) || 0;
    await actor.update({ "system.spells.pact.value": Math.max(0, value - 1) });
    return;
  }
  if ( option.unlimited ) return;
  if ( option.payer ) {   // §87
    await option.payer.update({ "system.uses.spent": (Number(option.payer.system.uses.spent) || 0) + 1 });
    return;
  }
  if ( option.free || option.rider ) {
    await option.item.update({ "system.uses.spent": (Number(option.item.system.uses.spent) || 0) + 1 });
    return;
  }
  const value = Number(actor.system.spells[option.slot]?.value) || 0;
  await actor.update({ [`system.spells.${option.slot}.value`]: Math.max(0, value - 1) });
}

/**
 * La question, sur le client de l'auteur : un bouton par châtiment possible, et « pas de châtiment ». Sans réponse : aucun.
 * @returns {Promise<object|null>}  L'option choisie.
 */
export async function askSmite(actor, target, options) {
  if ( !options.length ) return null;
  const riders = options.every(o => o.rider);
  const picked = await timedWait({
    window: { title: t(riders ? "TitreFaveur" : "Titre", { name: actor.name }) },
    content: `<p>${t(riders ? "QuestionFaveur" : "Question", { name: target?.name ?? "" })}</p>`,
    buttons: [
      ...options.map((o, i) => ({ action: `smite${i}`, label: o.label, icon: "fa-solid fa-sun", default: i === 0 })),
      { action: "none", label: t(riders ? "AucuneFaveur" : "Aucun") }
    ]
  }, { fallback: "none" });
  const i = Number(String(picked ?? "").replace("smite", ""));
  return (typeof picked === "string") && picked.startsWith("smite") ? (options[i] ?? null) : null;
}

/**
 * Au jet de dégâts d'un coup (`rollDamageForAttack`, client de l'auteur) : la question, puis ce que le jet doit porter —
 * `{ item, level, formula, type, save, target }` —, l'emplacement ou l'utilisation déjà dépensés. null sans châtiment.
 */
/** §87 : le type de dégâts du coup — celui que porte le jet d'attaque, sinon le premier de l'arme. */
function weaponDamageType(activity, attackMessage) {
  const chosen = attackMessage?.getFlag?.(MODULE_ID, "damageType");
  if ( chosen ) return chosen;
  const base = activity?.damage?.includeBase !== false ? activity?.item?.system?.damage?.base?.types : null;
  const parts = activity?.damage?.parts ?? [];
  return Array.from(base ?? [])[0] ?? Array.from(parts[0]?.types ?? [])[0] ?? null;
}

export async function chooseSmite(activity, attackMessage) {
  const actor = activity?.actor;
  const targets = attackMessage?.system?.targets ?? [];
  if ( !actor || (targets.length !== 1) || (activity?.type !== "attack") ) return null;
  const target = fromUuidSync(targets[0].token ?? "", { strict: false });
  if ( !target ) return null;
  // Les châtiments : un coup au corps à corps avec une arme ou à mains nues ; les faveurs d'espèce : tout jet d'attaque.
  const mode = attackMessage.system?.mode;
  const options = [...(meleeWeaponHit(activity, mode) ? smiteOptions(actor) : []), ...riderOptions(actor, target, activity, mode)];
  if ( !options.length ) return null;
  const option = await askSmite(actor, target, options);
  const dice = option ? smiteDamage(option, target) : null;
  if ( !dice ) return null;
  await spendSmite(actor, option);
  if ( option.rider ) {
    // §87 : les dés au type de dégâts de l'arme (manœuvres) ; la sauvegarde d'une faveur bornée en taille, seulement contre une cible
    // assez petite (Attaque repoussante, Croc-en-jambe : « Large or smaller »).
    const weaponType = option.rule.weaponDamage ? weaponDamageType(activity, attackMessage) : null;
    return { kind: "rider", item: option.item.uuid, name: option.item.name, ...dice, ...(weaponType ? { type: weaponType } : {}),
      effect: option.rule.effect ?? null, status: option.fits ? (option.rule.status ?? null) : null,
      save: option.fits ? (option.rule.save ?? null) : null, target: target.uuid };
  }
  return { item: option.item.uuid, name: option.item.name, level: option.level, free: option.free, ...dice,
    save: option.rule.save ?? null, effect: option.rule.effect ?? null,
    scaling: Math.max(0, option.level - (Number(option.item.system.level) || 1)), target: target.uuid };
}
