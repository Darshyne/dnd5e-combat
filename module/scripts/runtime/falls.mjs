/**
 * §208 : la chute automatique et ce que le saut retient d'un tour.
 *  - dnd5e pose l'état « En chute » à un token en l'air qui ne peut plus s'y tenir (documents/token.mjs `_isFalling` : sans vol, ou
 *    volant mais À terre ou Neutralisé, et sans surplace), mais la chute n'a lieu qu'au clic du MJ sur l'icône (`plummet`). Avec le
 *    réglage de monde `autoFall` (« en combat » par défaut), le MJ actif fait tomber le token dès que l'état apparaît ; la carte de dégâts
 *    de dnd5e est appliquée par le moteur (runtime/climb.mjs, `onFallCard` — À terre si elle fait des dégâts).
 *  - Règles 2024 (glossaire, « Flying ») : une créature volante dont la Vitesse tombe à 0 tombe aussi — dnd5e ne compte pas ce cas.
 *    Agrippée, Entravée (ou Vitesse de vol et de marche à 0), sans surplace et sans escalade : le MJ actif la fait tomber lui-même, avec
 *    la carte de dégâts de dnd5e (`dnd5e.rules.postFallDamage`).
 *  - Pas du vent par un point de focus (`jump.double`) : la distance de saut est doublée pour le tour (budget `jumpDouble`).
 */
import { MODULE_ID } from "../constants.mjs";
import { combatantFor, readBudget, writeBudget, committedPosition } from "../adapter/turn.mjs";
import { contentOf } from "../adapter/content.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { groundUnder } from "../adapter/altitude.mjs";
import { fallLikeDnd5e, climbFallInProgress } from "./climb.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, say } from "./shared.mjs";

export const AUTO_FALL_SETTING = "autoFall";
const MODES = ["off", "combat", "always"];

const mode = () => {
  try { const m = game.settings.get(MODULE_ID, AUTO_FALL_SETTING); return MODES.includes(m) ? m : "combat"; } catch { return "combat"; }
};
const wanted = actor => (mode() === "always") || ((mode() === "combat") && !!combatantFor(actor));

/** Les tokens de cet acteur sur la scène affichée (le MJ actif voit la scène du combat). */
const tokensOf = actor => (actor?.getActiveTokens?.(false, true) ?? []).filter(t => t.parent === canvas?.scene);

/** Un token en l'air, au-dessus de son sol. */
const aloft = token => (token._source.elevation ?? 0) > groundUnder(token, committedPosition(token)) + 1e-6;

/** Une créature volante qui ne peut plus bouger : Agrippée ou Entravée (sa Vitesse est de 0), sans surplace. */
function grounded(token) {
  const actor = token.actor;
  const movement = actor?.system?.attributes?.movement;
  if ( !movement || movement.hover || actor.system?.traits?.ci?.value?.has?.("falling") ) return false;
  // Sans vol (ou un vol ramené à 0 par un effet) : c'est la règle ordinaire de dnd5e, qui fait déjà tomber.
  if ( !((movement.speeds?.fly ?? movement.fly ?? 0) > 0) ) return false;
  if ( ["climb"].includes(token._source.movementAction) ) return false;      // l'escalade a ses propres chutes (runtime/climb.mjs)
  const statuses = actor.statuses ?? new Set();
  if ( statuses.has("falling") || statuses.has("prone") || statuses.has("incapacitated") ) return false;   // dnd5e s'en charge
  return statuses.has("grappled") || statuses.has("restrained");
}

/** La chute d'une créature volante à Vitesse 0 : descendue sur son sol, carte de dégâts de dnd5e. MJ actif. */
async function dropFlier(token) {
  const pos = committedPosition(token);
  const ground = groundUnder(token, pos);
  const distance = (pos.elevation ?? 0) - ground;
  if ( distance <= 1e-6 ) return;
  await token.move({ action: "fall", elevation: ground }, { animate: false, dnd5e: { fall: { distance } } });
  await globalThis.dnd5e?.rules?.postFallDamage?.([token], distance);
  await say({ token }, loc("Chute.Vol", { name: token.name }));
  log(`${token.name}: flying with a Speed of 0, falls ${distance}`);
}

/** MJ actif, à chaque changement d'effet : « En chute » posé par dnd5e → la chute ; créature volante immobilisée → la chute. */
function onEffectChange(effect) {
  const actor = actorOfEffect(effect);
  if ( !actor || !wanted(actor) ) return;
  // Sans attendre : le routeur passe les écouteurs d'un hook l'un après l'autre, et l'attente ci-dessous retarderait l'escalade (§192),
  // qui écoute les mêmes changements d'effet (vu : un grimpeur qui rate son test restait suspendu, son statut retiré trop tard).
  void enqueue(`fall:${actor.uuid}`, async () => {
    for ( const token of tokensOf(actor) ) {
      if ( !aloft(token) ) continue;
      if ( actor.statuses?.has("falling") ) {
        // Un grimpeur tombe par runtime/climb.mjs (au mur, en train de lâcher prise, ou déjà en chute là-bas).
        if ( (token._source.movementAction === "climb") || climbFallInProgress(token) ) continue;
        // Le joueur qui lâche un mur fait tomber son token de son côté (runtime/climb.mjs) : on lui laisse un instant, puis on revérifie.
        await new Promise(resolve => setTimeout(resolve, 2000));
        if ( !actor.statuses?.has("falling") || !aloft(token) || climbFallInProgress(token) ) continue;
        if ( await fallLikeDnd5e(token) ) log(`${token.name}: falls (dnd5e's Falling status, automatic)`);
      } else if ( grounded(token) ) await dropFlier(token);
    }
  }).catch(err => console.error(`${MODULE_ID} | automatic fall`, err));
}

/** Pas du vent par un point de focus : la distance de saut doublée pour le tour. Sur le client qui l'utilise. */
async function onPostUse(activity) {
  const double = contentOf(activity?.item).entry?.jump?.double;
  if ( !double?.includes(activity.id) ) return;
  const combatant = combatantFor(activity.actor);
  if ( !combatant ) return;
  await writeBudget(combatant, { ...readBudget(combatant), jumpDouble: true });
  log(`${activity.actor.name}: jump distance doubled for the turn (${activity.name})`);
}

export function registerFalls() {
  game.settings.register(MODULE_ID, AUTO_FALL_SETTING, {
    name: `DND5ECOMBAT.Reglage.${AUTO_FALL_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AUTO_FALL_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: Object.fromEntries(MODES.map(m => [m, `DND5ECOMBAT.Reglage.${AUTO_FALL_SETTING}.${m}`])), default: "combat"
  });
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, onEffectChange, { executor: true, label: "fall: not triggered automatically" });
  }
  route("dnd5e.postUseActivity", onPostUse, { label: "jump: Step of the Wind doubling not noted" });
}
