/**
 * §113 : la section « Aides » de la fenêtre de jet d'un test de compétence ou d'outil (SkillToolRollConfigurationDialog de
 * dnd5e) — à la manière de BG3. Un bouton par aide possible (adapter/skill-aid.mjs) ; un clic envoie la demande à l'aidant
 * (runtime/skill-aid.mjs). Accordée :
 *  - Assistance : l'effet natif du sort arrive sur le testeur, puis la fenêtre se reconstruit — dnd5e relit la fiche à chaque
 *    reconstruction (`_buildSkillToolConfig`, documents/actor/actor.mjs:1466) et le 1d4 entre dans la formule ;
 *  - Inspiration bardique : on attend l'effet « Inspiré » sur le testeur ; le dé se proposera après le jet (runtime/roll-bonus.mjs) ;
 *  - Soutien : l'Avantage est posé sur la configuration de la fenêtre (`app.config`, relue à chaque reconstruction,
 *    applications/dice/roll-configuration-dialog.mjs:286-312) — le bouton Avantage devient celui par défaut.
 */

import { aidsFor, isGuided } from "../adapter/skill-aid.mjs";
import { inspirationOf } from "../adapter/inspiration.mjs";
import { requestSkillAid } from "../runtime/skill-aid.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Les demandes de chaque fenêtre (`{status: "pending"|"granted"|"refused", aid}`), gardées d'un rendu à l'autre. */
const states = new WeakMap();
const keyOf = aid => `${aid.kind}.${aid.token.id}`;

/** Attend que l'effet de l'aide soit posé sur le testeur (la résolution passe par le MJ actif). */
async function untilApplied(test, ms=10000) {
  for ( let waited = 0; waited < ms; waited += 250 ) {
    if ( test() ) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function grantAdvantage(app) {
  app.config.advantage = true;
  // `advantageMode` : la formule affichée le montre ; le bouton cliqué décide toujours au final (_finalizeConfig).
  const mode = CONFIG.Dice.D20Roll.ADV_MODE;
  for ( const roll of app.config.rolls ?? [] ) {
    roll.options ??= {};
    roll.options.advantage = true;
    roll.options.advantageMode = roll.options.disadvantage ? mode.NORMAL : mode.ADVANTAGE;
  }
  app.rebuild();
  app.render({ parts: ["buttons"] });
}

async function onAsk(app, aid, test) {
  const state = states.get(app);
  const key = keyOf(aid);
  if ( state.get(key) ) return;
  state.set(key, { status: "pending", aid });
  if ( app.rendered ) app.render({ parts: ["formulas"] });   // partiel : le choix de caractéristique du formulaire reste
  const granted = await requestSkillAid({ kind: aid.kind, helper: aid.helper, tester: aid.tester, ...test });
  if ( granted && (aid.kind === "guidance") ) await untilApplied(() => isGuided(app.config.subject, test.skill));
  if ( granted && (aid.kind === "inspiration") ) await untilApplied(() => !!inspirationOf(app.config.subject));
  state.set(key, { status: granted ? "granted" : "refused", aid });
  if ( !app.rendered ) return;
  if ( granted && (aid.kind === "help") ) grantAdvantage(app);
  else if ( granted && (aid.kind === "guidance") ) app.rebuild();
  app.render({ parts: ["formulas"] });
}

function onRender(app, element) {
  const actor = app.config?.subject;
  const test = { skill: app.config?.skill ?? null, tool: app.config?.tool ?? null };
  if ( !(actor instanceof Actor) || !actor.isOwner || (!test.skill && !test.tool) ) return;
  if ( !states.has(app) ) states.set(app, new Map());
  const state = states.get(app);
  // Une aide demandée reste affichée même si elle ne serait plus proposée (l'Assistance posée retire l'offre).
  const offered = aidsFor(actor, test);
  const asked = Array.from(state.values(), s => s.aid).filter(a => !offered.some(o => keyOf(o) === keyOf(a)));
  const aids = [...offered, ...asked];
  if ( !aids.length ) return element.querySelector(".dnd5e-combat-aids")?.remove();
  const buttons = aids.map(aid => {
    const status = state.get(keyOf(aid))?.status ?? "";
    const label = loc({ guidance: aid.self ? "AideTest.AssistanceSoi" : "AideTest.Assistance", inspiration: "AideTest.Inspiration",
      help: "AideTest.Soutien" }[aid.kind], { name: aid.helper.name });
    const gain = loc({ guidance: "AideTest.Gain1d4", inspiration: "AideTest.GainInspiration", help: "AideTest.GainAvantage" }[aid.kind],
      { formula: aid.formula ?? "" });
    const tip = status ? loc(`AideTest.Etat.${status}`) : gain;
    return `<button type="button" class="dnd5e-combat-aid" data-aid="${esc(keyOf(aid))}" data-status="${status}"
      data-tooltip="${esc(tip)}" ${status ? "disabled" : ""}>
      <img src="${esc(aid.token.texture?.src ?? aid.helper.img)}" alt=""><span>${esc(label)}</span><small>${esc(status ? tip : gain)}</small></button>`;
  }).join("");
  let section = element.querySelector(".dnd5e-combat-aids");
  if ( !section ) {
    section = document.createElement("fieldset");
    section.className = "dnd5e-combat-aids";
    const anchor = element.querySelector('[data-application-part="buttons"]');
    if ( anchor ) anchor.before(section);
    else (element.querySelector(".window-content") ?? element).append(section);
    section.addEventListener("click", event => {
      const button = event.target.closest("[data-aid]");
      if ( !button ) return;
      event.preventDefault();
      const aid = (section._aids ?? []).find(a => keyOf(a) === button.dataset.aid);
      if ( aid ) onAsk(app, aid, test);
    });
  }
  section._aids = aids;
  section.innerHTML = `<legend>${esc(loc("AideTest.Titre"))}</legend>${buttons}`;
}

export function registerSkillAidUi() {
  // ApplicationV2 appelle un hook par classe de la lignée : celui de la fenêtre des tests de compétence et d'outil.
  route("renderSkillToolRollConfigurationDialog", onRender, { label: "check aids not offered", level: "warn" });
}
