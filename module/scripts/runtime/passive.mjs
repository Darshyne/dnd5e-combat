/**
 * Perception passive contre la Furtivité (SPEC §16.51), sur le MJ actif. Règle 2024 : « le MJ se sert de la Perception
 * passive pour savoir si une créature remarque quelque chose sans faire consciemment de test de Sagesse (Perception) ». Un
 * ennemi dont la Perception passive atteint le DD de la cachette (−5 s'il la voit en zone légèrement obscurcie, rien s'il ne
 * peut pas la voir) la repère (core/search.mjs, `passiveNotice`).
 *
 * Jugé quand une créature se cache (effet de Furtivité créé) et à chaque déplacement validé — de la créature cachée, ou d'un
 * de ses ennemis —, sur la scène affichée par le MJ actif. Réglage de monde :
 *  - "auto" : la Furtivité est retirée ; le MJ et les propriétaires de la créature sont prévenus (message privé) ;
 *  - "gm"   : le MJ seul est prévenu (une fois par cachette et par observateur), il tranche ;
 *  - "off"  : rien.
 */

import { MODULE_ID } from "../constants.mjs";
import { hiddenEffectsOf } from "../adapter/hide.mjs";
import { hiddenDcOf, passiveObservers } from "../adapter/search.mjs";
import { passiveNotice } from "../core/search.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

const SETTING = "passivePerception";
/** Mode "gm" : les paires (effet de Furtivité, observateur) déjà signalées, pour ne pas répéter le message à chaque pas. */
const told = new Set();

function recipients(actor, withOwners) {
  return game.users.filter(u => u.isGM || (withOwners && actor.testUserPermission(u, "OWNER"))).map(u => u.id);
}

/** Juge une créature cachée ; rend les observateurs qui la repèrent. */
async function judge(hidden) {
  const mode = game.settings.get(MODULE_ID, SETTING);
  const actor = hidden?.actor;
  if ( (mode === "off") || !actor ) return [];
  const dc = hiddenDcOf(actor);
  if ( dc === null ) return [];
  const effects = hiddenEffectsOf(actor);
  const spotted = passiveObservers(hidden)
    .map(o => ({ ...o, ...passiveNotice(o, dc) }))
    .filter(o => o.notices && ((mode === "auto") || !told.has(`${effects[0]?.uuid}|${o.token.uuid}`)));
  if ( !spotted.length ) return [];
  const observers = spotted.map(o => (o.score === null) ? `${o.token.name} (${loc("PerceptionPassive.Sens")})` : `${o.token.name} (${o.score})`).join(", ");
  log(`perception passive : ${hidden.name} (DD ${dc}) repéré par ${observers} — mode ${mode}`);
  if ( mode === "auto" ) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
    notice(hidden, loc("PerceptionPassive.Court"), "ended");
  } else for ( const o of spotted ) told.add(`${effects[0]?.uuid}|${o.token.uuid}`);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ token: hidden }),
    whisper: recipients(actor, mode === "auto"),
    content: `<p>${loc(`PerceptionPassive.${mode === "auto" ? "Repere" : "RepereMJ"}`, { name: hidden.name, observers, dc })}</p>`,
    flags: { [MODULE_ID]: { passivePerception: { hidden: hidden.uuid, dc, mode, by: spotted.map(o => o.token.uuid) } } }
  });
  return spotted;
}

/** Les créatures cachées de la scène à rejuger quand ce token a bougé : lui s'il est caché, sinon celles dont il est l'ennemi. */
function affectedBy(token) {
  if ( hiddenDcOf(token.actor) !== null ) return [token];
  return token.parent.tokens.filter(t => (t !== token) && (hiddenDcOf(t.actor) !== null));
}

function run(tokens) {
  for ( const t of tokens ) judge(t).catch(err => console.error(`${MODULE_ID} | perception passive`, err));
}

export function registerPassivePerception() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "DND5ECOMBAT.Reglage.passivePerception.Nom", hint: "DND5ECOMBAT.Reglage.passivePerception.Aide",
    scope: "world", config: true, type: String, default: "auto",
    choices: {
      auto: "DND5ECOMBAT.Reglage.passivePerception.auto",
      gm: "DND5ECOMBAT.Reglage.passivePerception.gm",
      off: "DND5ECOMBAT.Reglage.passivePerception.off"
    }
  });
  const opts = { executor: true, label: "perception passive" };
  route("createActiveEffect", effect => {
    if ( !effect.getFlag?.(MODULE_ID, "hidden") || !(effect.parent instanceof Actor) ) return;
    run(effect.parent.getActiveTokens(false, true).filter(t => t.parent === canvas.scene));
  }, opts);
  route("updateToken", (token, changes) => {
    if ( !["x", "y", "elevation", "level"].some(k => k in changes) || (token.parent !== canvas.scene) ) return;
    run(affectedBy(token));
  }, opts);
  route("deleteActiveEffect", effect => { if ( effect.getFlag?.(MODULE_ID, "hidden") ) for ( const k of told ) if ( k.startsWith(`${effect.uuid}|`) ) told.delete(k); }, opts);
}
