/**
 * §401 : « chaque créature de votre choix dans la zone » (Parole radieuse, Sommeil, Lenteur, Esprits gardiens…) — la question posée au
 * lanceur quand la zone est posée : la liste de ceux qu'elle peut affecter, cochés d'avance comme le moteur le ferait seul (ses ennemis,
 * au plus `zoneMax`). Même circuit que les autres questions (adapter/choices.mjs) : le joueur connecté qui possède le lanceur, sinon le
 * MJ actif ; sans réponse dans le délai, le choix d'office.
 */

import { MODULE_ID } from "../constants.mjs";
import { ZONE_CHOICE_MODES } from "../core/area.mjs";
import { contentOf } from "./content.mjs";
import { timedWait } from "./dialogs.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { rollerFor } from "./concentration.mjs";

export const ZONE_CHOICE_QUERY = `${MODULE_ID}.zoneChoice`;
export const ZONE_CHOICE_SETTING = "zoneChoice";

/** Au-delà, le MJ répond à la place du joueur (le délai de la fenêtre, plus la marge du réseau). */
const ZONE_CHOICE_TIMEOUT = 30000;

export function registerZoneChoiceSetting() {
  game.settings.register(MODULE_ID, ZONE_CHOICE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${ZONE_CHOICE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${ZONE_CHOICE_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: Object.fromEntries(ZONE_CHOICE_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${ZONE_CHOICE_SETTING}.${m}`])), default: "mixed"
  });
}

export function zoneChoiceMode() {
  try { const m = game.settings.get(MODULE_ID, ZONE_CHOICE_SETTING); return ZONE_CHOICE_MODES.includes(m) ? m : "mixed"; } catch { return "mixed"; }
}

/**
 * La zone de cette activité est-elle « au choix » du lanceur ? La donnée le dit (`target.affects.choice`), ou le contenu, qui déclare
 * qui elle affecte quand la donnée se tait (`zoneAffects`, §86) — pas une zone « chaque ennemi » de la donnée (`affects.type`).
 */
export function isChoiceZone(activity) {
  if ( !activity?.item ) return false;
  if ( contentOf(activity.item).entry?.zoneAffects ) return true;
  return activity.target?.affects?.choice === true;
}

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Côté du lanceur : une case par créature, les cochées d'avance comme le moteur. Rend les UUID cochés ; au bout du délai, le choix
 * d'office ; fermée sans valider, null (le MJ n'est pas consulté : le choix d'office tient).
 * @param {{actor: string, item: string, max: number|null, candidates: Array<{token: string, name: string, img: string, checked: boolean, enemy: boolean}>}} payload
 * @returns {Promise<{tokens: string[]}|null>}
 */
export async function handleZoneChoiceQuery({ actor: actorUuid, item, max=null, candidates=[] }) {
  const actor = actorUuid ? await fromUuid(actorUuid) : null;
  const t = (key, data) => game.i18n.format(`DND5ECOMBAT.ZoneChoix.${key}`, data ?? {});
  const rows = candidates.map((c, i) => `
    <label class="dnd5e-combat-pick-row">
      <input type="checkbox" name="pick${i}" value="${i}" data-pick ${c.checked ? "checked" : ""}>
      <img src="${esc(c.img)}" alt="">
      <span class="name">${esc(c.name)}</span>
      <span class="distance">${esc(t(c.enemy ? "Ennemi" : "Allie"))}</span>
    </label>`).join("");
  const limit = Number.isInteger(max) ? `<p class="hint">${esc(t("Max", { max }))}</p>` : "";
  const fallback = { tokens: candidates.filter(c => c.checked).map(c => c.token) };
  const answer = await timedWait({
    window: { title: t("Titre", { item, name: actor?.name ?? "" }), icon: "fa-solid fa-bullseye" },
    classes: ["dnd5e-combat-pick"],
    position: { width: 380 },
    content: `<p class="hint">${esc(t("Aide"))}</p>${limit}<div class="dnd5e-combat-pick-list">${rows}</div>`,
    buttons: [{ action: "ok", label: t("Valider"), icon: "fa-solid fa-check", default: true,
      callback: (event, button) => {
        const picked = Array.from(button.form.querySelectorAll('input[data-pick]:checked'))
          .map(i => candidates[Number(i.value)]?.token).filter(Boolean);
        return { tokens: Number.isInteger(max) ? picked.slice(0, max) : picked };
      } }]
  }, { fallback, awaiting: { actor, kind: "choice" } });
  return (answer && Array.isArray(answer.tokens)) ? answer : null;
}

/**
 * Sur le MJ actif : demande au lanceur (son joueur, sinon le MJ lui-même). Rend les UUID retenus, ou null (le choix d'office tient).
 * @param {Actor} actor
 * @param {object} payload  Voir handleZoneChoiceQuery.
 */
export async function askZoneChoice(actor, payload) {
  payload = { ...payload, actor: actor?.uuid ?? null };
  const userId = actor ? rollerFor(actor) : null;
  try {
    if ( userId && (userId !== game.user.id) ) return await queryPlayer(game.users.get(userId), ZONE_CHOICE_QUERY, payload,
      { timeout: ZONE_CHOICE_TIMEOUT, actor, label: waitLabel("Choix", { item: payload.item ?? "" }) });
    return await handleZoneChoiceQuery(payload);
  } catch(err) {
    console.warn(`${MODULE_ID} | zone choice for ${actor?.name}: no answer`, err);
    return null;
  }
}
