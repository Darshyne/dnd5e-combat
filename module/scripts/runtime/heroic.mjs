/**
 * §282 : l'Inspiration héroïque (PHB 2024) — « si vous (un personnage joueur) avez l'Inspiration héroïque, vous pouvez la dépenser pour
 * relancer n'importe quel dé juste après l'avoir lancé, et vous devez utiliser le nouveau jet ». Demande de l'utilisateur (2026-10-30) :
 * à chaque jet, AVANT qu'il ne soit validé et avant l'Inspiration bardique, une fenêtre au premier plan propose de relancer un dé.
 *
 * Où la question se pose (chaque fois avant les autres dés d'après le jet) :
 *  - jet d'attaque (runtime/engine-messages.mjs, `inspiredAttack`) : un d20 au choix si Avantage / Désavantage ; le nouveau d20 refait
 *    le critique et l'échec automatique ;
 *  - sauvegarde demandée par une résolution (même fichier, `onSaveMessage`) ;
 *  - test libre (`dnd5e.rollSkill`, `rollAbilityCheck`, `rollToolCheck`) : ici, puis runtime/roll-bonus.mjs attend la réponse
 *    (`heroicAfter`) avant ses propres dés — les inscrits d'un même hook ne s'attendent pas entre eux (runtime/router.mjs) ;
 *  - jet demandé par le MJ (runtime/group-roll.mjs, `decideBonus`) ;
 *  - initiative (carte du cœur, MJ actif) : ici, l'Hypervigilance attend (`heroicAfter`) ;
 *  - dégâts et soins (runtime/engine-messages.mjs, `onDamageMessage`) : le joueur choisit LE dé à relancer (choix de l'utilisateur).
 *
 * Le réglage de client `heroicInspiration` filtre chez celui qui répond (adapter/heroic.mjs) : à chaque jet, seulement sur un échec (un
 * jet de dégâts : un dé à la moitié de son maximum ou moins), jamais. Le jet d'origine n'est pas réécrit : la relance part en clair sur
 * sa propre carte, attend la fin de Dice So Nice, puis le résultat compte. Retour à toute la table : texte au-dessus du token et son.
 *
 * Retour à la table seulement quand l'Inspiration est UTILISÉE (demande de l'utilisateur, 2026-10-30) : éclat doré sur le token, texte qui
 * défile, coup de tambour — chez chaque client. Ni la fenêtre ni le gain ne font de bruit.
 */

import { MODULE_ID } from "../constants.mjs";
import { rerolledD20, damageDiceLow, keptOf } from "../core/heroic.mjs";
import { HEROIC_QUERY, HEROIC_SETTING, askHeroic, d20Facts, damageDice, hasHeroic, handleHeroicQuery, spendHeroic } from "../adapter/heroic.mjs";
import { route } from "./router.mjs";
import { loc, log, notice, tokenOfActor, waitForDice } from "./shared.mjs";

/** Le résultat de la question posée sur un jet (un `Roll` ou l'id d'un message), pour les dés qui attendent leur tour. */
const pending = new WeakMap();
const pendingById = new Map();

/** Les dés d'après le jet attendent que l'Inspiration héroïque soit tranchée sur ce jet (`Roll` ou id de message) ; null sinon. */
export function heroicAfter(key) {
  return ((typeof key === "string") ? pendingById.get(key) : pending.get(key)) ?? null;
}

function remember(key, promise) {
  if ( typeof key === "string" ) {
    pendingById.set(key, promise);
    promise.finally(() => setTimeout(() => pendingById.delete(key), 60000));
  }
  else if ( key ) pending.set(key, promise);
  return promise;
}

/** Le son et le texte d'une relance, pour toute la table. */
function announce(actor, data) {
  const token = tokenOfActor(actor);
  if ( token ) notice(token, { key: "Heroique.Avis", data }, "heroic", { all: true, action: "heroic", outcome: "success" });
}

/** L'option « Garder le jet ». */
const keepOption = () => ({ id: "keep", label: loc("Heroique.Garder"), icon: "fa-solid fa-check", class: "dnd5e-combat-heroic-keep" });

/** Les icônes de dé de Font Awesome, par faces. */
const DIE_ICONS = { 4: "fa-dice-d4", 6: "fa-dice-d6", 8: "fa-dice-d8", 10: "fa-dice-d10", 12: "fa-dice-d12", 20: "fa-dice-d20" };

/** Un dé à relancer, en tuile : sa valeur en gros, une légende dessous (« gardé », « d8 Feu »), le détail en infobulle. */
function dieOption(index, { value, faces, caption, state, tooltip }) {
  return { id: String(index), label: String(value), icon: `fa-solid ${DIE_ICONS[faces] ?? "fa-dice"}`, caption, tooltip,
    class: ["dnd5e-combat-heroic-die", state].filter(Boolean).join(" ") };
}

/**
 * Un jet d20 de la créature, lu sur sa carte : la question, puis la relance du d20 choisi. Rend null (pas d'Inspiration, refus, réglage) ou
 * `{ total, delta, old, kept, critical, fumble }` — le jet après la relance.
 * @param {Actor} actor
 * @param {{roll: Roll, what: string, needed?: number|null, failed?: boolean|null, total?: number}} context
 *   `total` : le total en vigueur s'il diffère de celui du jet ; `failed` : l'issue quand le moteur la juge lui-même (une attaque contre
 *   plusieurs cibles) ; sinon déduite de `needed` (null : inconnue).
 */
export async function offerHeroicD20(actor, { roll, what, needed=null, failed, total }={}) {
  if ( !hasHeroic(actor) ) return null;
  const facts = d20Facts(roll);
  if ( !facts ) return null;
  if ( Number.isFinite(total) ) facts.total = total;
  const outcome = (failed !== undefined) ? failed : (Number.isFinite(needed) ? (facts.total < needed) : null);
  const two = facts.values.length > 1;
  // Avantage / Désavantage : le d20 qui compte est marqué « gardé », l'autre « écarté » (un seul gardé si les deux sont égaux).
  const keptIndex = two ? facts.values.indexOf(keptOf(facts.values, facts.mode)) : 0;
  const answer = await askHeroic(actor, {
    actor: actor.uuid, item: loc("Heroique.Nom"), failed: outcome,
    prompt: loc(Number.isFinite(needed) ? "Heroique.QuestionD20DD" : "Heroique.QuestionD20", { what, total: facts.total, needed }),
    // « Garder » d'abord : sans réponse dans le délai, la fenêtre retient la première option. Chaque d20 est une tuile à sa valeur.
    options: [keepOption(),
      ...facts.values.map((value, i) => dieOption(i, { value, faces: 20,
        caption: two ? loc(i === keptIndex ? "Heroique.Garde" : "Heroique.Ecarte") : "d20",
        state: two ? (i === keptIndex ? "kept" : "dropped") : "kept",
        tooltip: loc(two ? "Heroique.RelancerUn" : "Heroique.RelancerD20", { value }) }))]
  });
  const index = Number(answer?.id);
  if ( !answer || !Number.isInteger(index) || !(index in facts.values) ) return null;
  if ( !await spendHeroic(actor) ) return null;
  const reroll = await new Roll("1d20").evaluate();
  const after = rerolledD20(facts, index, reroll.total);
  const message = await reroll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc("Heroique.CarteD20", { name: actor.name, what, old: facts.values[index], new: reroll.total, before: facts.total, after: after.total }),
    flags: { [MODULE_ID]: { heroic: { kind: "d20", old: facts.values[index], new: reroll.total, total: after.total } } } });
  if ( message ) await waitForDice(message);
  announce(actor, { old: facts.values[index], new: reroll.total });
  log(`${actor.name}: Heroic Inspiration, d20 ${facts.values[index]} → ${reroll.total} (${what} ${facts.total} → ${after.total})`);
  return after;
}

/**
 * Un jet de dégâts ou de soin de la créature : le joueur choisit le dé à relancer. Rend null, ou `{ type, properties, old, now }` — la part
 * de l'agrégat du moteur qui change, et de combien.
 * @param {Actor} actor
 * @param {Roll[]} rolls  Les `DamageRoll` du message.
 */
export async function offerHeroicDamage(actor, rolls) {
  if ( !hasHeroic(actor) || !rolls?.length ) return null;
  const dice = damageDice(rolls);
  if ( !dice.length ) return null;
  const total = rolls.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const typeLabel = type => CONFIG.DND5E.damageTypes?.[type]?.label ?? CONFIG.DND5E.healingTypes?.[type]?.label ?? "";
  const answer = await askHeroic(actor, {
    actor: actor.uuid, item: loc("Heroique.Nom"), failed: damageDiceLow(dice),
    prompt: loc("Heroique.QuestionDegats", { total }),
    // Un dé à la moitié de son maximum ou moins ressort (le bon candidat à la relance).
    options: [keepOption(),
      ...dice.map((d, i) => dieOption(i, { value: d.value, faces: d.faces, caption: `d${d.faces} ${typeLabel(d.type)}`.trim(),
        state: (d.value <= d.faces / 2) ? "low" : null,
        tooltip: loc("Heroique.RelancerDe", { faces: d.faces, value: d.value, type: typeLabel(d.type) }) }))]
  });
  const die = dice[Number(answer?.id)];
  if ( !answer || (answer.id === "keep") || !die ) return null;
  if ( !await spendHeroic(actor) ) return null;
  // Les modificateurs qui bornent le dé (Style Armes à deux mains : « min3 ») valent aussi pour la relance.
  const reroll = await new Roll(`1d${die.faces}${die.modifiers.join("")}`).evaluate();
  const message = await reroll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc("Heroique.CarteDegats", { name: actor.name, faces: die.faces, old: die.value, new: reroll.total, before: total, after: total - die.value + reroll.total }),
    flags: { [MODULE_ID]: { heroic: { kind: "damage", faces: die.faces, old: die.value, new: reroll.total } } } });
  if ( message ) await waitForDice(message);
  announce(actor, { old: die.value, new: reroll.total });
  log(`${actor.name}: Heroic Inspiration, d${die.faces} ${die.value} → ${reroll.total}`);
  return { type: die.type, properties: die.properties, old: die.value, now: reroll.total };
}

/* -------------------------------------------- */
/*  Tests libres et initiative                  */
/* -------------------------------------------- */

function checkName({ skill, tool, ability }) {
  if ( skill ) return CONFIG.DND5E.skills?.[skill]?.label ?? skill;
  if ( tool ) return CONFIG.DND5E.tools?.[tool]?.label ?? game.i18n.localize("DND5E.ToolCheck");
  return CONFIG.DND5E.abilities?.[ability]?.label ?? ability ?? "";
}

/** Un test lancé par ce client : la question, retenue pour runtime/roll-bonus.mjs. Un jet demandé par le MJ a son propre circuit. */
function onCheckRolled(rolls, { skill=null, tool=null, ability=null, subject }={}) {
  const roll = rolls?.[0];
  if ( !subject?.isOwner || !roll || roll.options?.[MODULE_ID]?.groupRoll || !hasHeroic(subject) ) return;
  const needed = Number.isFinite(roll.options?.target) ? roll.options.target : null;
  return remember(roll, offerHeroicD20(subject, { roll, what: checkName({ skill, tool, ability }), needed }).catch(err => {
    console.warn(`${MODULE_ID} | Heroic Inspiration on a check`, err);
    return null;
  }));
}

/** Le combattant dont la carte d'initiative porte le jet (son token, et l'initiative égale au total). */
function combatantOfMessage(message) {
  const { token, actor } = message.speaker ?? {};
  const total = message.rolls?.[0]?.total;
  const matches = game.combats.contents.flatMap(combat => combat.combatants.filter(c => (token ? c.tokenId === token : c.actorId === actor)));
  return matches.find(c => Number.isFinite(total) && (Math.abs(c.initiative - total) < 1e-6)) ?? null;
}

/** Initiative (MJ actif) : la relance corrige la valeur en vigueur de la différence. */
function onInitiativeMessage(message) {
  if ( !message.getFlag?.("core", "initiativeRoll") ) return;
  const combatant = combatantOfMessage(message);
  const actor = combatant?.actor;
  if ( !hasHeroic(actor) ) return;
  return remember(message.id, (async () => {
    const after = await offerHeroicD20(actor, { roll: message.rolls?.[0], what: game.i18n.localize("DND5E.Initiative"), failed: null });
    if ( !after?.delta ) return after;
    await combatant.update({ initiative: (combatant.initiative ?? after.total - after.delta) + after.delta });
    return after;
  })().catch(err => {
    console.warn(`${MODULE_ID} | Heroic Inspiration on Initiative`, err);
    return null;
  }));
}

/* -------------------------------------------- */
/*  Donner l'Inspiration (MJ)                   */
/* -------------------------------------------- */

/** Le MJ donne ou retire l'Inspiration (menu du moteur, `api.heroic.set`) ; une carte le dit à la table. */
export async function setHeroic(actor, on) {
  if ( (actor?.type !== "character") || (!!actor.system.attributes?.inspiration === !!on) ) return false;
  await actor.update({ "system.attributes.inspiration": !!on });
  await ChatMessage.create({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${foundry.utils.escapeHTML(loc(on ? "Heroique.CarteDonnee" : "Heroique.CarteRetiree", { name: actor.name }))}</p>`,
    flags: { [MODULE_ID]: { heroic: { kind: on ? "given" : "removed" } } } });
  return true;
}

export function registerHeroic() {
  game.settings.register(MODULE_ID, HEROIC_SETTING, {
    name: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.Aide`,
    scope: "client", config: true, type: String, default: "on",
    choices: { on: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.on`, failure: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.failure`,
      off: `DND5ECOMBAT.Reglage.${HEROIC_SETTING}.off` }
  });
  CONFIG.queries[HEROIC_QUERY] = handleHeroicQuery;   // sur tous les clients : c'est le joueur qui répond
  // dnd5e 6.0 : documents/actor/actor.mjs — `dnd5e.roll${name}` après un test, sur le client qui l'a lancé (`subject` = l'acteur).
  for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
    route(hook, onCheckRolled, { label: "Heroic Inspiration not offered on a check" });
  }
  route("createChatMessage", onInitiativeMessage, { executor: true, label: "Heroic Inspiration not offered on Initiative" });
}
