/**
 * §113 : une aide demandée pour un test de compétence ou d'outil (à la manière de BG3) — la demande part au joueur de l'aidant
 * (requête `user.query` du cœur ; à défaut le MJ actif), qui accepte ou refuse :
 *  - Assistance : l'aidant lance VRAIMENT le sort sur le testeur (sa concentration, l'effet de la compétence choisi d'avance,
 *    sans la question des 18 effets) ; l'effet natif ajoute le 1d4, à ce test et aux suivants tant que le sort dure ;
 *  - Inspiration bardique : le barde utilise pour de bon son Inspiration sur le testeur (une utilisation, l'effet « Inspiré ») ; le
 *    dé se lance après le test, s'il est raté (runtime/roll-bonus.mjs) ;
 *  - Soutien : rien n'est lancé, le test a l'Avantage (l'interface le pose dans la fenêtre du jet) et une carte le dit.
 * Celui qui demande et possède déjà l'aidant (le même joueur, ou le MJ sans joueur connecté) n'est pas questionné.
 */

import { MODULE_ID } from "../constants.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { timedWait, combatWindowSeconds } from "../adapter/dialogs.mjs";
import { guidanceSpellOf, guidanceEffectFor } from "../adapter/skill-aid.mjs";
import { inspirationSourceOf, usesLeftFor } from "../adapter/inspiration.mjs";
import { castOnTargets } from "./actions.mjs";
import { log, loc } from "./shared.mjs";

export const SKILL_AID_QUERY = `${MODULE_ID}.skillAid`;

/** Un test libre n'est pas un combat : on laisse à l'aidant le temps de lire. */
const answerSeconds = () => Math.max(20, combatWindowSeconds());

/** Le nom du test : la compétence ou l'outil. */
export function testLabel({ skill=null, tool=null }) {
  if ( skill ) return game.i18n.localize(CONFIG.DND5E.skills?.[skill]?.label ?? skill);
  return globalThis.dnd5e?.documents?.Trait?.keyLabel?.(tool, { trait: "tool" }) ?? tool ?? "";
}

/** L'aide, sur le client qui possède l'aidant. Rend true si elle est donnée. */
async function perform({ kind, helper, tester, skill, tool }) {
  const actor = await fromUuid(helper);
  const target = await fromUuid(tester);
  if ( !actor || !target?.actor ) return false;
  const what = testLabel({ skill, tool });
  if ( kind === "help" ) {
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<p>${loc("AideTest.CarteSoutien", { helper: actor.name, name: target.name, test: what })}</p>`
    });
    log(`soutien : ${actor.name} aide ${target.name} à son test de ${what} (Avantage)`);
    return true;
  }
  if ( kind === "inspiration" ) {
    const source = inspirationSourceOf(actor);
    if ( !source ) {
      ui.notifications.warn(loc("AideTest.SansInspiration", { name: actor.name }));
      return false;
    }
    await castOnTargets(source.activity, [{ [MODULE_ID]: { confirmed: true } }, { configure: false }, {}], [target.uuid]);
    log(`inspiration bardique : ${actor.name} inspire ${target.name} (${what})`);
    return true;
  }
  const spell = guidanceSpellOf(actor);
  const found = guidanceEffectFor(spell, skill);
  if ( !found ) {
    ui.notifications.warn(loc("AideTest.SansSort", { name: actor.name }));
    return false;
  }
  await castOnTargets(found.activity, [{ [MODULE_ID]: { choice: found.effectId, confirmed: true } }, { configure: false }, {}], [target.uuid]);
  log(`assistance : ${actor.name} lance ${spell.name} sur ${target.name} (${what})`);
  return true;
}

/**
 * Côté de l'aidant : la question, puis l'aide. « Non » au bout du délai.
 * @param {{kind: "guidance"|"inspiration"|"help", helper: string, tester: string, skill: string|null, tool: string|null}} payload
 *   `helper` : uuid de l'acteur qui aide ; `tester` : uuid du token qui fait le test.
 */
export async function handleSkillAidQuery(payload) {
  const actor = await fromUuid(payload.helper);
  const target = await fromUuid(payload.tester);
  if ( !actor || !target ) return false;
  const what = testLabel(payload);
  // Lancer Assistance met fin à la concentration en cours (dnd5e la remplace sans fenêtre) : on le dit.
  const current = payload.kind === "guidance" ? Array.from(actor.concentration?.effects ?? [])[0] : null;
  const source = payload.kind === "inspiration" ? inspirationSourceOf(actor) : null;
  const ask = { guidance: "DemandeAssistance", inspiration: "DemandeInspiration", help: "DemandeSoutien" }[payload.kind];
  const lines = [loc(`AideTest.${ask}`, { name: target.name, test: what, formula: source?.formula ?? "",
    left: source ? usesLeftFor(source.activity) : 0 })];
  if ( current ) lines.push(loc("AideTest.FinConcentration", { effect: current.name }));
  const answer = await timedWait({
    window: { title: loc(`AideTest.${{ guidance: "TitreAssistance", inspiration: "TitreInspiration", help: "TitreSoutien" }[payload.kind]}`, { name: actor.name }) },
    content: lines.map(l => `<p>${l}</p>`).join(""),
    buttons: [
      { action: "yes", label: loc("AideTest.Accepter"), icon: "fa-solid fa-hand-holding-heart", default: true },
      { action: "no", label: loc("AideTest.Refuser"), icon: "fa-solid fa-xmark" }
    ]
  }, { fallback: "no", seconds: answerSeconds() });
  if ( answer !== "yes" ) return false;
  return perform(payload);
}

/**
 * Sur le client du testeur : demande l'aide à qui joue l'aidant. Rend true si elle est donnée (l'Assistance est alors lancée ;
 * son effet arrive un peu après, par la résolution du MJ actif).
 * @param {{kind: "guidance"|"inspiration"|"help", helper: Actor, tester: TokenDocument, skill?: string|null, tool?: string|null}} request
 */
export async function requestSkillAid({ kind, helper, tester, skill=null, tool=null }) {
  const payload = { kind, helper: helper.uuid, tester: tester.uuid, skill, tool };
  const userId = rollerFor(helper);
  if ( (userId === game.user.id) || (!userId && helper.isOwner) ) return perform(payload);
  const user = userId ? game.users.get(userId) : game.users.activeGM;
  if ( !user ) {
    ui.notifications.warn(loc("AideTest.Personne", { name: helper.name }));
    return false;
  }
  try { return (await user.query(SKILL_AID_QUERY, payload, { timeout: (answerSeconds() + 15) * 1000 })) === true; }
  catch(err) {
    console.warn(`${MODULE_ID} | aide au test : pas de réponse pour ${helper.name}`, err);
    return false;
  }
}

export function registerSkillAid() {
  CONFIG.queries[SKILL_AID_QUERY] = handleSkillAidQuery;   // sur tous les clients : c'est le joueur de l'aidant qui répond
}
