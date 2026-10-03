/**
 * Attaque sournoise et Frappes rusées du Roublard (SPEC §20).
 *
 *  - Sur le client de l'auteur, au jet de dégâts d'une attaque (`dnd5e.preRollDamageV2`) : si l'Attaque sournoise s'applique
 *    (core/sneak.mjs : arme de Finesse ou à distance, Avantage ou allié à 1,50 m de la cible sans Désavantage, une fois par tour),
 *    ses dés s'ajoutent au jet, du type de l'arme — moins ceux des Frappes rusées choisies juste avant (adapter/messages.mjs,
 *    `rollDamageForAttack`) —, avec les parts de plus (Assassinat au premier round). Le critique les double comme les autres.
 *    Le jet porte `flags["dnd5e-combat"].sneak` : l'item, les dés lancés, les Frappes choisies, la cible.
 *  - Sur le MJ actif, une fois l'attaque résolue et ses dégâts appliqués (`dnd5e-combat.resolution`) : chaque Frappe rusée
 *    « a lieu aussitôt après que les dégâts de l'attaque ont été infligés » — sa sauvegarde joue sur la cible (Poison,
 *    Croc-en-jambe, Hébétement, Assommer, Aveugler : adapter/areas.mjs, `strikeAgainst`), ou Repli ouvre à l'auteur un
 *    déplacement de la moitié de sa Vitesse sans attaque d'opportunité.
 * Limite : un jet de dégâts lancé hors du moteur (bouton de la carte) a l'Attaque sournoise, sans question de Frappe rusée.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { settleStrikes, affordableStrikes } from "../core/sneak.mjs";
import { sneakAttackFor, attackMessageFor, markSneakSpent, sneakBonusesOf, strikeOptionsOf, strikeMaxOf } from "../adapter/sneak.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { combatantFor, readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

/** Libellés des raisons pour lesquelles l'Attaque sournoise ne s'applique pas (journal seulement). */
const WHY = Object.freeze({
  spent: "déjà utilisée ce tour", notWeapon: "pas une attaque d'arme", weaponKind: "arme ni de Finesse ni à distance",
  disadvantage: "Désavantage au jet", noAdvantage: "ni Avantage ni allié à 1,50 m de la cible"
});

function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const actor = activity?.actor;
  if ( !actor || !config.rolls?.length ) return true;
  const origin = foundry.utils.getProperty(message ?? {}, "data.system.origin") ?? null;
  // Le jet de dégâts peut être celui d'une variante (M5) : l'attaque est celle du jet d'attaque rattaché au même message.
  const attackMessage = attackMessageFor(origin, activity);
  const attack = attackMessage ? (fromUuidSync(attackMessage.system?.activity?.uuid ?? "", { strict: false }) ?? activity) : null;
  const sneak = attack ? sneakAttackFor(attack, attackMessage) : null;
  if ( !sneak ) return true;
  if ( sneak.issue ) { log(`attaque sournoise : non (${WHY[sneak.issue] ?? sneak.issue})`); return true; }

  const options = affordableStrikes(strikeOptionsOf(actor, sneak.target), sneak.dice.number);
  const { strikes, dice } = settleStrikes(config[MODULE_ID]?.strikes ?? [], options, { dice: sneak.dice.number, max: strikeMaxOf(actor) });
  // Du type de l'arme : celui que porte le premier jet (le type choisi, pour une arme qui en propose plusieurs).
  const type = config.rolls[0]?.options?.type ?? Array.from(attack.item?.system?.damage?.base?.types ?? [])[0] ?? null;
  const data = activity.getRollData();
  const push = (formula, rollData=data) => config.rolls.push({ data: rollData, parts: [formula], options: { type, types: type ? [type] : [], properties: [] } });
  if ( dice > 0 ) push(`${dice}d${sneak.dice.faces}`);
  const bonuses = sneakBonusesOf(actor);
  for ( const b of bonuses ) push(b.formula, b.data);
  markSneakSpent(actor).catch(err => console.warn(`${MODULE_ID} | attaque sournoise : tour non marqué`, err));
  foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.sneak`, {
    item: sneak.item.uuid, dice, faces: sneak.dice.faces, strikes, target: sneak.target.uuid, source: sneak.source.uuid,
    bonuses: bonuses.map(b => b.name)
  });
  log(`attaque sournoise : +${dice}d${sneak.dice.faces} ${type ?? ""}${strikes.length ? ` (Frappes rusées : ${strikes.join(", ")})` : ""}${bonuses.length ? ` ; ${bonuses.map(b => `${b.name} +${b.formula}`).join(", ")}` : ""}`);
  return true;
}

/* -------------------------------------------- */
/*  Après les dégâts : les Frappes rusées       */
/* -------------------------------------------- */

const seen = new Set();

/** Repli : « aussitôt après l'attaque, vous vous déplacez jusqu'à la moitié de votre Vitesse sans provoquer d'attaque d'opportunité ». */
async function withdraw(sourceToken) {
  const combatant = sourceToken?.actor ? combatantFor(sourceToken.actor) : null;
  const own = combatant && (game.combat?.combatant?.id === combatant.id);
  if ( !own ) { log(`Repli : ${sourceToken?.name ?? "?"} n'est pas à son tour, rien à ouvrir (au MJ)`); return; }
  const movement = movementOf(combatant, readUnitFactors());
  if ( !movement ) return;
  const budget = readBudget(combatant);
  const extra = movement.speed / 2;
  await writeBudget(combatant, { ...budget, bonusMove: (Number(budget.bonusMove) || 0) + extra, disengaged: true });
  notice(sourceToken, loc("Sournoise.Repli", { n: extra, units: movement.units }), "gain");
  log(`Repli : ${sourceToken.name} peut se déplacer de ${extra} ${movement.units} de plus, sans attaque d'opportunité`);
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const damage = game.messages.get(resolution.damageRoll?.messageId ?? "");
  const sneak = damage?.getFlag(MODULE_ID, "sneak");
  if ( !sneak?.strikes?.length ) return;
  seen.add(resolution.id);
  const hit = (resolution.targets ?? []).find(t => (t.token === sneak.target) && (t.hit === true));
  const target = hit ? fromUuidSync(sneak.target, { strict: false }) : null;
  const source = fromUuidSync(sneak.source ?? "", { strict: false }) ?? tokenOf(fromUuidSync(resolution.source ?? "", { strict: false }));
  if ( !target?.actor || !source?.actor ) return;
  const options = strikeOptionsOf(source.actor, target);
  for ( const key of sneak.strikes ) {
    const option = options.find(o => o.key === key);
    if ( !option ) continue;
    if ( option.withdraw ) { await withdraw(source); continue; }
    // Une cible tombée à 0 PV sous les dégâts n'a plus de sauvegarde à faire.
    if ( (target.actor.system.attributes?.hp?.value ?? 0) <= 0 ) { log(`${option.label} : ${target.name} est à 0 PV, sans objet`); continue; }
    log(`${option.label} : ${target.name} fait sa sauvegarde (Frappe rusée de ${source.name})`);
    await strikeAgainst(option.activity, source, target);
  }
}

export function registerSneak() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "attaque sournoise" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`sneak:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "frappes rusées non jouées" });
}
