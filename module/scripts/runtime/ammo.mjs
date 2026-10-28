/**
 * §274 : le choix de la munition quand le jet d'attaque part sans la fenêtre de dnd5e (issue #23).
 *
 * `dnd5e.preRollAttackV2` (inscrit après la légalité, registerTurn : le mode d'attaque et la confirmation sont déjà posés), sur le
 * client qui lance :
 *  - une munition imposée (configuration d'utilisation `{ "dnd5e-combat": { ammunition } }`, portée par la carte comme le mode
 *    d'attaque §150, ou `rollAttack({ ammunition })` autre que la mémoire de dnd5e) est tirée telle quelle ;
 *  - sinon, la dernière munition retenue si elle reste utilisable, la seule utilisable s'il n'y en a qu'une ;
 *  - plusieurs utilisables et pas de fenêtre de dnd5e : une petite fenêtre demande, la dernière présélectionnée — le jet est
 *    suspendu (le hook est synchrone) puis relancé avec le choix, retenu sur l'arme (`setAmmo`).
 * Une créature du MJ sans joueur garde son choix sans rien demander ; réglage client `ammoPrompt` pour ne jamais demander.
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { esc, loc } from "./shared.mjs";
import { ammoState, announceAmmoChange, setAmmo } from "../adapter/ammo.mjs";

export const AMMO_PROMPT_SETTING = "ammoPrompt";
const AMMO_CLASS = "dnd5e-combat-ammo";

/** La munition imposée par l'appelant, ou null. */
function explicitAmmo(activity, config, message) {
  const own = config[MODULE_ID]?.ammunition;
  if ( own ) return own;
  const usageId = message?.data?.system?.origin ?? null;
  const carried = usageId ? game.messages.get(usageId)?.getFlag(MODULE_ID, "ammunition") : null;
  if ( carried ) return carried;
  // `rollAttack` fusionne la mémoire de dnd5e dans sa configuration, ou à défaut la première munition (activity/attack.mjs:92-108) :
  // seule une autre valeur est demandée.
  const remembered = activity.item.getFlag("dnd5e", `last.${activity.id}.ammunition`);
  const byDefault = (remembered === undefined) ? (activity.item.system.ammunitionOptions?.[0]?.value ?? null) : remembered;
  return (config.ammunition && (config.ammunition !== byDefault)) ? config.ammunition : null;
}

/** Pose la munition dans la configuration du jet : `_buildAttackConfig` la lit (attack.mjs:247), le message aussi (options). */
function applyAmmo(config, id) {
  config.ammunition = id;
  if ( config.rolls?.[0]?.options ) config.rolls[0].options.ammunition = id;
}

/** Demander ici ? Pas pour une créature du MJ sans joueur, ni si ce client l'a coupé. */
function shouldAsk(actor) {
  if ( !game.settings.get(MODULE_ID, AMMO_PROMPT_SETTING) ) return false;
  return !game.user.isGM || !!actor?.hasPlayerOwner;
}

function onPreRollAttack(config, dialog, message) {
  const activity = config.subject;
  if ( !activity?.item || config[MODULE_ID]?.ammoChosen ) return true;
  const state = ammoState(activity.item, activity, { explicit: explicitAmmo(activity, config, message) });
  if ( !state?.options.length ) return true;
  // La fenêtre de dnd5e s'ouvrira : sa liste « Munitions » présélectionne notre choix, le joueur y garde la main.
  const fast = dialog?.configure === false;
  if ( !state.ask || !fast || !shouldAsk(activity.actor) ) {
    if ( state.current ) applyAmmo(config, state.current);
    return true;
  }
  askAmmo(activity, state).then(async id => {
    if ( !id ) return;
    if ( id !== activity.item.getFlag("dnd5e", `last.${activity.id}.ammunition`) ) await setAmmo(activity.item, id);
    const { event, ability, attackMode, mastery, advantage, disadvantage } = config;
    activity.rollAttack({
      event, ability, attackMode, mastery, advantage, disadvantage, ammunition: id,
      // Le mode est celui que la légalité a déjà tranché (lancer, deux mains) : il est repris tel quel.
      [MODULE_ID]: { ...(config[MODULE_ID] ?? {}), ammoChosen: true, ...(attackMode ? { modeChosen: true } : {}) }
    }, { configure: false }, message);
  });
  return false;
}

/** La fenêtre : une ligne par munition (icône, nom, reste), la présélection cochée ; Entrée confirme, double-clic aussi. */
async function askAmmo(activity, state) {
  const lines = state.options.map(o => `
    <label class="${AMMO_CLASS}-line${o.quantity > 0 ? "" : " empty"}">
      <input type="radio" name="ammo" value="${esc(o.id)}"${o.id === state.current ? " checked" : ""}${o.quantity > 0 ? "" : " disabled"}>
      ${o.img ? `<img src="${esc(o.img)}" alt="">` : ""}
      <span class="name">${esc(o.name)}</span>
      <span class="qty">× ${o.quantity}</span>
    </label>`).join("");
  return foundry.applications.api.DialogV2.wait({
    window: { title: loc("Munitions.Titre", { name: activity.item.name }), icon: "fa-solid fa-bullseye" },
    classes: [AMMO_CLASS],
    position: { width: 340 },
    content: `<p>${loc("Munitions.Question")}</p><div class="${AMMO_CLASS}-list">${lines}</div>`,
    buttons: [
      { action: "fire", label: loc("Munitions.Tirer"), icon: "fa-solid fa-crosshairs", default: true,
        callback: (event, button) => button.form.elements.ammo?.value ?? null },
      { action: "cancel", label: loc("Renoncer") }
    ],
    render: (event, dialog) => {
      dialog.element.querySelectorAll(`.${AMMO_CLASS}-line:not(.empty)`).forEach(line => line.addEventListener("dblclick", () => {
        dialog.element.querySelector('button[data-action="fire"]')?.click();
      }));
    },
    rejectClose: false
  }).then(result => ((result && (result !== "cancel")) ? result : null));
}

export function registerAmmo() {
  game.settings.register(MODULE_ID, AMMO_PROMPT_SETTING, { scope: "client", config: true, type: Boolean, default: true,
    name: `DND5ECOMBAT.Reglage.${AMMO_PROMPT_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AMMO_PROMPT_SETTING}.Aide` });
  route("dnd5e.preRollAttackV2", onPreRollAttack, { cancellable: true, label: "ammunition chosen" });
  route("updateItem", announceAmmoChange, { label: "ammunition choice announced" });
}
