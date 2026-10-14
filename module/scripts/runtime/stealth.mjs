/**
 * §183–§184 : le mode furtif d'un PJ et la Furtivité « BG3 ».
 *
 * §183 — Hors combat, un joueur passe son personnage en mode furtif (raccourci, bouton d'un voisin) ; l'interface lui montre les cônes
 * de vision (§182) des créatures qu'il voit. État : flag du token `sneaking`, écrit par son propriétaire ; il tombe quand le token
 * entre dans un combat commencé.
 *
 * §184 — Décisions de l'utilisateur (2026-10-14), réglage de monde `stealthRules` = `bg3` :
 *  - en mode furtif, le PJ marche à **demi-vitesse** (animation du cœur, `speedMultiplier`) ;
 *  - une créature du MJ ne le voit pas tant qu'elle ne l'a pas **repéré** (adapter/stealth.mjs) ; quand il **entre** dans ce qu'elle
 *    voit (cône compris), une fois par entrée : en **pleine lumière** (lumière du moteur au point du PJ), repéré aussitôt ; sinon test
 *    de Discrétion du PJ contre la Perception passive de la créature — ou active (test de Perception) si elle a déjà eu un doute ;
 *    un premier échec = doute (« ? »), un second = repéré (« ! ») ;
 *  - attaquer depuis la furtivité donne l'Avantage (la cible ne le voit pas), puis fait **sortir du mode**.
 * Hook `dnd5e-combat.stealthNoticed(observer, target, { level: "suspicious" | "spotted", point, reason })` : un voisin (l'IA des PNJ)
 * fait se tourner, chercher, alerter. Sans voisin : un message au MJ.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { isSneaking, spottedBy, stealthRules, RULES_SETTING } from "../adapter/stealth.mjs";
import { canSee } from "../adapter/vision.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { lightAt, tokenPoint } from "../adapter/illumination.mjs";
import { LIGHT } from "../core/illumination.mjs";

export { isSneaking };

const OUT = ["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned", "sleeping"];
const playerSide = actor => !!actor && ((actor.type === "character") || !!actor.hasPlayerOwner);
/** Figure-t-il dans un combat commencé ? */
const fighting = doc => !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.tokenId === doc.id));
const able = doc => {
  const actor = doc?.actor;
  if ( !actor || doc.hidden || ((actor.system?.attributes?.hp?.value ?? 1) <= 0) ) return false;
  return ![...OUT, CONFIG.specialStatusEffects.DEFEATED].some(s => actor.statuses?.has(s));
};

/**
 * Passer en mode furtif ou en sortir (`on` absent : basculer). Refusé en combat, et pour qui ne possède pas le token. Entrer ou
 * sortir efface qui l'avait repéré.
 * @returns {Promise<{sneaking: boolean, reason?: string}>}
 */
export async function setSneaking(token, on=undefined) {
  const doc = token?.document ?? token;
  if ( !doc?.isOwner ) return { sneaking: isSneaking(doc), reason: "notOwner" };
  const wanted = (on === undefined) ? !isSneaking(doc) : !!on;
  if ( wanted && fighting(doc) ) return { sneaking: false, reason: "inCombat" };
  if ( wanted === isSneaking(doc) ) return { sneaking: wanted };
  if ( wanted ) await doc.update({ [`flags.${MODULE_ID}.sneaking`]: true, [`flags.${MODULE_ID}.stealth`]: { spottedBy: [] } });
  else await doc.update({ [`flags.${MODULE_ID}`]: { sneaking: new foundry.data.operators.ForcedDeletion(), stealth: new foundry.data.operators.ForcedDeletion() } });
  Hooks.callAll(`${MODULE_ID}.sneak`, doc, wanted);
  return { sneaking: wanted };
}

/** Un combat commence, ou accueille un token : il sort du mode furtif (MJ actif). */
async function leaveOnCombat(combat) {
  if ( !combat?.started ) return;
  for ( const c of combat.combatants ) {
    const doc = c.token;
    if ( doc && isSneaking(doc) ) {
      await doc.update({ [`flags.${MODULE_ID}`]: { sneaking: new foundry.data.operators.ForcedDeletion(), stealth: new foundry.data.operators.ForcedDeletion() } });
      Hooks.callAll(`${MODULE_ID}.sneak`, doc, false);
      log(`sneak: ${doc.name} leaves sneak mode (combat)`);
    }
  }
}

/* -------------------------------------------- */
/*  §184 : la détection                          */
/* -------------------------------------------- */

/** Par couple observateur | PJ (MJ actif) : `{ inView, fails }`. */
const views = new Map();
let timer = null;

/** Juger la scène affichée bientôt (plusieurs évènements → un seul passage). */
function schedule() {
  if ( timer || (stealthRules() !== "bg3") || (game.users.activeGM?.isSelf !== true) ) return;
  timer = setTimeout(() => { timer = null; check(canvas?.scene).catch(err => console.error(`${MODULE_ID} | stealth: check failed`, err)); }, 250);
}

let busy = false;
/** Pour chaque PJ furtif de la scène et chaque créature du MJ qui pourrait le voir : entré dans sa vue ? */
export async function check(scene) {
  if ( busy || !scene || (stealthRules() !== "bg3") ) return;
  busy = true;
  try {
    const sneakers = scene.tokens.filter(t => isSneaking(t) && able(t) && !fighting(t));
    for ( const pc of sneakers ) {
      for ( const obs of scene.tokens ) {
        if ( (obs === pc) || !able(obs) || playerSide(obs.actor) || fighting(obs) || !areEnemies(pc, obs) ) continue;
        if ( spottedBy(pc).includes(obs.id) ) continue;
        const key = `${obs.id}|${pc.id}`;
        const state = views.get(key) ?? { inView: false, fails: 0 };
        const sees = canSee(obs, pc, { ignoreSneak: true }) === true;
        if ( sees && !state.inView ) {
          state.inView = true;
          views.set(key, state);
          await entered(obs, pc, state);
        }
        else if ( !sees && state.inView ) { state.inView = false; views.set(key, state); }
      }
    }
  } finally { busy = false; }
}

/** Le PJ entre dans ce que voit la créature. */
async function entered(obs, pc, state) {
  const point = tokenPoint(pc);
  const light = lightAt(point)?.level ?? null;
  if ( light === LIGHT.BRIGHT ) return spot(obs, pc, point, "bright");
  const stealth = (await pc.actor.rollSkill({ skill: "ste" }, { configure: false }))?.[0];
  if ( !stealth ) return;
  let dc;
  if ( state.fails > 0 ) {
    const perception = (await obs.actor.rollSkill({ skill: "prc" }, { configure: false }))?.[0];
    dc = perception?.total ?? 10;
  } else dc = Number(obs.actor.system?.skills?.prc?.passive) || 10;
  if ( stealth.total >= dc ) { log(`stealth: ${pc.name} ${stealth.total} vs ${obs.name} ${dc} — unseen`); return; }
  state.fails += 1;
  if ( state.fails >= 2 ) return spot(obs, pc, point, "failed");
  log(`stealth: ${pc.name} ${stealth.total} vs ${obs.name} ${dc} — ${obs.name} suspects something`);
  Hooks.callAll(`${MODULE_ID}.stealthNoticed`, obs, pc, { level: "suspicious", point, reason: "failed" });
  await whisper(loc("Furtif.Doute", { observer: obs.name, target: pc.name }), false, pc);
}

/** Repéré : la créature le voit désormais (jusqu'à la sortie du mode furtif). */
async function spot(obs, pc, point, reason) {
  const list = [...new Set([...spottedBy(pc), obs.id])];
  await pc.update({ [`flags.${MODULE_ID}.stealth`]: { spottedBy: list } });
  log(`stealth: ${obs.name} spots ${pc.name} (${reason})`);
  Hooks.callAll(`${MODULE_ID}.stealthNoticed`, obs, pc, { level: "spotted", point, reason });
  await whisper(loc(reason === "bright" ? "Furtif.ReperePleineLumiere" : "Furtif.Repere", { observer: obs.name, target: pc.name }), true, pc);
}

/** Un message au MJ (et au joueur du PJ s'il est repéré). */
async function whisper(content, toOwner, pc) {
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  const owners = toOwner ? game.users.filter(u => !u.isGM && pc.actor?.testUserPermission?.(u, "OWNER")).map(u => u.id) : [];
  await ChatMessage.create({ content: `<p>${foundry.utils.escapeHTML(content)}</p>`, whisper: [...gms, ...owners],
    speaker: { alias: loc("Furtif.Titre") } });
}

/* -------------------------------------------- */
/*  Demi-vitesse, sortie à l'attaque              */
/* -------------------------------------------- */

/** §184 : en mode furtif, l'animation du déplacement va à demi-vitesse (cœur : `speedMultiplier`, placeables/token.mjs:2286). */
function onPreMove(token, movement, options) {
  if ( (stealthRules() !== "bg3") || !isSneaking(token) ) return true;
  options.animation = { ...(options.animation ?? {}), speedMultiplier: 0.5 * (options.animation?.speedMultiplier ?? 1) };
  return true;
}

/** Une attaque (ou une activité qui blesse) lancée en mode furtif : on en sort, après le jet (l'Avantage est déjà pris). */
async function leaveOnAttack(activity) {
  const actor = activity?.actor;
  if ( !actor ) return;
  const harmful = (activity.type === "attack") || (activity.type === "save") || ((activity.type === "damage") && !!activity.damage?.parts?.length);
  if ( !harmful ) return;
  for ( const t of actor.getActiveTokens?.(false, true) ?? [] ) {
    if ( isSneaking(t) && t.isOwner ) await setSneaking(t, false);
  }
}

/** Pour les scénarios : l'état de la détection des couples où figure ce PJ. */
export function stealthViews(pcId) {
  return Object.fromEntries([...views].filter(([k]) => k.endsWith(`|${pcId}`)).map(([k, v]) => [k.split("|")[0], { ...v }]));
}

export const stealthApi = Object.freeze({
  is: isSneaking, set: setSneaking, toggle: token => setSneaking(token), spottedBy, rules: () => stealthRules(),
  check: () => check(canvas?.scene)
});

export function registerStealthMode() {
  game.settings.register(MODULE_ID, RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: { 2024: `DND5ECOMBAT.Reglage.${RULES_SETTING}.2024`, bg3: `DND5ECOMBAT.Reglage.${RULES_SETTING}.bg3` }, default: "2024",
    onChange: () => { views.clear(); schedule(); }
  });
  const label = { executor: true, label: "sneak: not left on combat" };
  route("combatStart", combat => leaveOnCombat(combat), label);
  route("createCombatant", combatant => leaveOnCombat(combatant.parent), label);
  route("preMoveToken", onPreMove, { label: "sneak: half speed" });
  route("dnd5e.postUseActivity", activity => leaveOnAttack(activity), { label: "sneak: not left on attack" });
  // Ce qui peut faire entrer un PJ dans une vue : il bouge, une créature bouge ou se tourne, un état, une lumière, la scène.
  const watch = { label: "stealth: detection not scheduled" };
  route("updateToken", (doc, changes) => {
    if ( ["x", "y", "rotation", "hidden", "elevation"].some(k => k in changes) || changes.flags?.[MODULE_ID] ) schedule();
  }, watch);
  for ( const hook of ["createActiveEffect", "deleteActiveEffect", "updateAmbientLight", "createAmbientLight", "deleteAmbientLight",
    "canvasReady", `${MODULE_ID}.sneak`] ) route(hook, schedule, watch);
  route(`${MODULE_ID}.sneak`, (doc, on) => { if ( !on ) for ( const k of [...views.keys()] ) if ( k.endsWith(`|${doc.id}`) ) views.delete(k); }, watch);
}
