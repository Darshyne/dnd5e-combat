/**
 * §183–§185 : être caché, au jeu. Un seul état (l'effet de Furtivité, runtime/hide.mjs) : le raccourci Alt+C et le bouton d'un voisin
 * prennent l'action Furtivité (hors combat, sans coût) ou en sortent ; le joueur d'un token caché voit les cônes de vision (§182) des
 * créatures qu'il voit (ui/stealth.mjs).
 *
 * Règles `bg3` (décisions de l'utilisateur, 2026-10-14) — en combat comme hors combat :
 *  - un token caché marche à **demi-vitesse** (animation du cœur, `speedMultiplier`, placeables/token.mjs:2286) ;
 *  - un ennemi ne le voit pas tant qu'il ne l'a pas **repéré** (adapter/stealth.mjs) ; quand le token **entre** dans ce qu'il voit
 *    (cône hors combat, 360° en combat ; sens et lumière compris), une fois par entrée : en **pleine lumière** (lumière du moteur au
 *    point du token), repéré aussitôt ; sinon Discrétion contre sa Perception passive — active (test) s'il a déjà un doute ; un
 *    premier échec = doute (« ? »), un second = repéré ;
 *  - attaquer donne l'Avantage (la cible ne le voit pas), puis la Furtivité cesse (runtime/hide.mjs).
 * Règles `2024` : la Perception passive des ennemis contre le DD de la cachette (runtime/passive.mjs, §16.51), jugée à chaque
 * déplacement — ce qui revient à « quand il entre dans un cône » (rien n'y est tiré au dé).
 * Hook `dnd5e-combat.stealthNoticed(observer, target, { level: "suspicious" | "spotted", point, reason })`.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log, loc, isExecutor } from "./shared.mjs";
import { isHidden, spottedBy, stealthRules, RULES_SETTING } from "../adapter/stealth.mjs";
import { canSee } from "../adapter/vision.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { lightAt, tokenPoint } from "../adapter/illumination.mjs";
import { LIGHT } from "../core/illumination.mjs";
import { toggleHidden, endHiding } from "./hide.mjs";

export { isHidden };

/** Les états d'une créature qui ne guette plus rien (avec 0 PV et Vaincu) : elle ne repère ni ne voit de cône. */
export const OUT = Object.freeze(["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned", "sleeping"]);
const able = doc => {
  const actor = doc?.actor;
  if ( !actor || doc.hidden || ((actor.system?.attributes?.hp?.value ?? 1) <= 0) ) return false;
  return ![...OUT, CONFIG.specialStatusEffects.DEFEATED].some(s => actor.statuses?.has(s));
};

/** Se cacher ou ne plus l'être (`on` absent : basculer). */
export async function setHidden(token, on=undefined) {
  const doc = token?.document ?? token;
  const now = isHidden(doc);
  if ( (on !== undefined) && (!!on === now) ) return { hidden: now };
  if ( (on === false) && doc?.actor ) { await endHiding(doc.actor, "by hand"); return { hidden: false }; }
  return toggleHidden(doc);
}

/* -------------------------------------------- */
/*  §184 : la détection (règles BG3)             */
/* -------------------------------------------- */

/** Par couple observateur | caché (MJ actif) : `{ inView, fails }`. */
const views = new Map();
let timer = null;

/** Juger la scène affichée bientôt (plusieurs évènements → un seul passage). */
function schedule() {
  if ( timer || (stealthRules() !== "bg3") || !isExecutor() ) return;
  timer = setTimeout(() => { timer = null; check(canvas?.scene).catch(err => console.error(`${MODULE_ID} | stealth: check failed`, err)); }, 250);
}

let busy = false;
/** Pour chaque token caché de la scène et chaque ennemi en état : entré dans sa vue ? */
export async function check(scene) {
  if ( busy || !scene || (stealthRules() !== "bg3") ) return;
  busy = true;
  try {
    for ( const target of scene.tokens.filter(t => isHidden(t) && able(t)) ) {
      for ( const obs of scene.tokens ) {
        if ( (obs === target) || !able(obs) || !areEnemies(target, obs) ) continue;
        if ( !isHidden(target) ) break;
        if ( spottedBy(target).includes(obs.id) ) continue;
        const key = `${obs.id}|${target.id}`;
        const state = views.get(key) ?? { inView: false, fails: 0 };
        const sees = canSee(obs, target, { ignoreHidden: true }) === true;
        if ( sees && !state.inView ) {
          state.inView = true;
          views.set(key, state);
          await entered(obs, target, state);
        }
        else if ( !sees && state.inView ) { state.inView = false; views.set(key, state); }
      }
    }
  } finally { busy = false; }
}

/** Le token caché entre dans ce que voit l'ennemi. */
async function entered(obs, target, state) {
  const point = tokenPoint(target);
  if ( lightAt(point)?.level === LIGHT.BRIGHT ) return spot(obs, target, point, "bright");
  const stealth = (await target.actor.rollSkill({ skill: "ste" }, { configure: false }))?.[0];
  if ( !stealth ) return;
  let dc;
  if ( state.fails > 0 ) dc = (await obs.actor.rollSkill({ skill: "prc" }, { configure: false }))?.[0]?.total ?? 10;
  else dc = Number(obs.actor.system?.skills?.prc?.passive) || 10;
  if ( stealth.total >= dc ) { log(`stealth: ${target.name} ${stealth.total} vs ${obs.name} ${dc} — unseen`); return; }
  state.fails += 1;
  if ( state.fails >= 2 ) return spot(obs, target, point, "failed");
  log(`stealth: ${target.name} ${stealth.total} vs ${obs.name} ${dc} — ${obs.name} suspects something`);
  Hooks.callAll(`${MODULE_ID}.stealthNoticed`, obs, target, { level: "suspicious", point, reason: "failed" });
  await whisper(loc("Furtif.Doute", { observer: obs.name, target: target.name }), false, target);
}

/** Repéré : cet ennemi le voit désormais (tant qu'il reste caché). */
async function spot(obs, target, point, reason) {
  await target.update({ [`flags.${MODULE_ID}.stealth`]: { spottedBy: [...new Set([...spottedBy(target), obs.id])] } });
  log(`stealth: ${obs.name} spots ${target.name} (${reason})`);
  Hooks.callAll(`${MODULE_ID}.stealthNoticed`, obs, target, { level: "spotted", point, reason });
  await whisper(loc(reason === "bright" ? "Furtif.ReperePleineLumiere" : "Furtif.Repere", { observer: obs.name, target: target.name }), true, target);
}

/** Un message au MJ (et aux joueurs du token s'il est repéré). */
async function whisper(content, toOwner, target) {
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  const owners = toOwner ? game.users.filter(u => !u.isGM && target.actor?.testUserPermission?.(u, "OWNER")).map(u => u.id) : [];
  await ChatMessage.create({ content: `<p>${foundry.utils.escapeHTML(content)}</p>`, whisper: [...gms, ...owners],
    speaker: { alias: loc("Furtif.Titre") } });
}

/** BG3 : caché, l'animation du déplacement va à demi-vitesse. */
function onPreMove(token, movement, options) {
  if ( (stealthRules() !== "bg3") || !isHidden(token) ) return true;
  options.animation = { ...(options.animation ?? {}), speedMultiplier: 0.5 * (options.animation?.speedMultiplier ?? 1) };
  return true;
}

/** Pour les scénarios : la détection des couples où figure ce token. */
export function stealthViews(id) {
  return Object.fromEntries([...views].filter(([k]) => k.endsWith(`|${id}`)).map(([k, v]) => [k.split("|")[0], { ...v }]));
}

/** `api.sneak` : `is`, `set`, `toggle` (l'action Furtivité hors combat), `spottedBy`, `rules`, `check`. */
export const stealthApi = Object.freeze({
  is: isHidden, set: setHidden, toggle: token => setHidden(token), spottedBy, rules: () => stealthRules(),
  check: () => check(canvas?.scene)
});

export function registerStealthMode() {
  game.settings.register(MODULE_ID, RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: { 2024: `DND5ECOMBAT.Reglage.${RULES_SETTING}.2024`, bg3: `DND5ECOMBAT.Reglage.${RULES_SETTING}.bg3` }, default: "2024",
    onChange: () => { views.clear(); schedule(); }
  });
  route("preMoveToken", onPreMove, { label: "hidden: half speed" });
  // Ce qui peut faire entrer un token caché dans une vue : il bouge, un ennemi bouge ou se tourne, un état, une lumière, la scène.
  const watch = { label: "stealth: detection not scheduled" };
  route("updateToken", (doc, changes) => {
    if ( ["x", "y", "rotation", "hidden", "elevation"].some(k => k in changes) || changes.flags?.[MODULE_ID] ) schedule();
  }, watch);
  for ( const hook of ["createActiveEffect", "deleteActiveEffect", "updateAmbientLight", "createAmbientLight", "deleteAmbientLight",
    "canvasReady", "combatStart", "deleteCombat", `${MODULE_ID}.sneak`] ) route(hook, schedule, watch);
  // Ne plus être caché : ses couples repartent de zéro.
  route("deleteActiveEffect", effect => {
    if ( !effect.getFlag?.(MODULE_ID, "hidden") || !(effect.parent instanceof Actor) ) return;
    for ( const t of effect.parent.getActiveTokens(false, true) ) for ( const k of [...views.keys()] ) if ( k.endsWith(`|${t.id}`) ) views.delete(k);
  }, watch);
}
