/**
 * Issue #32 : « Succès à un prix » (Guide du maître 2024, chapitre 2), ce qui touche Foundry et les fenêtres — la fenêtre du MJ qui
 * décrit le prix, la question au joueur qui accepte ou refuse.
 *
 * Le prix est le texte du MJ : rien n'est appliqué d'office. Les suggestions de la fenêtre ne font que remplir le champ.
 */

import { MODULE_ID } from "../constants.mjs";
import { handleChoiceQuery } from "./choices.mjs";
import { rollerFor } from "./concentration.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";

export const AT_COST_QUERY = `${MODULE_ID}.successAtCost`;

/** Le délai laissé au joueur pour répondre (secondes) ; au-delà, c'est un refus. */
export const AT_COST_ANSWER_SECONDS = 30;

/** Les suggestions de prix de la fenêtre du MJ (clés `DND5ECOMBAT.APrix.Idee.<id>`). */
const IDEAS = Object.freeze(["prone", "drop", "alert", "advantage", "noise"]);

const t = (key, data) => (data ? game.i18n.format(`DND5ECOMBAT.APrix.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.APrix.${key}`));
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Chez le MJ : la fenêtre qui décrit le prix. Rend `{ cost }` (texte, éventuellement vide) pour proposer, ou null pour laisser l'échec.
 * Sans délai : la résolution attend le MJ, qui a déjà choisi de s'en occuper.
 * @param {{name: string, what: string, total: number, needed: number, by: number}} candidate
 */
export async function askCost({ name, what, total, needed, by }) {
  const ideas = IDEAS.map(id => `<button type="button" class="das-at-cost__idea" data-idea="${id}">${esc(t(`Idee.${id}`))}</button>`).join("");
  const content = `<p class="das-at-cost__rule">${esc(t("Regle"))}</p>`
    + `<p>${esc(t("QuestionMJ", { name, what, total, needed, by }))}</p>`
    + `<label class="das-at-cost__label">${esc(t("Prix"))}`
    + `<input type="text" name="cost" maxlength="300" autofocus placeholder="${esc(t("PrixAide"))}"></label>`
    + `<div class="das-at-cost__ideas">${ideas}</div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: t("TitreMJ", { name }), icon: "fa-solid fa-scale-balanced" },
    classes: ["das-at-cost"],
    content,
    buttons: [
      { action: "offer", label: t("Proposer"), icon: "fa-solid fa-scale-balanced", default: true,
        callback: (event, button) => ({ cost: button.form?.elements?.cost?.value ?? "" }) },
      { action: "keep", label: t("LaisserEchec"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false,
    // Une suggestion remplit le champ (le MJ peut la reprendre à sa façon).
    render: (event, dialog) => {
      const input = dialog.element?.querySelector?.("input[name=cost]");
      for ( const b of dialog.element?.querySelectorAll?.(".das-at-cost__idea") ?? [] ) {
        b.addEventListener("click", () => { if ( input ) { input.value = t(`Idee.${b.dataset.idea}`); input.focus(); } });
      }
    }
  });
  return (result && (typeof result === "object")) ? result : null;
}

/** Chez le joueur : la question, au premier plan. Rend `{ id: "yes" | "no" }`, ou null (fermée, délai). */
export function handleAtCostQuery({ actor, name, what, cost }) {
  const heading = `<p class="das-at-cost__rule">${esc(t("Regle"))}</p>`;
  return handleChoiceQuery({
    actor, item: t("Nom"), front: true, heading, icon: "fa-solid fa-scale-balanced", classes: ["das-at-cost"],
    seconds: AT_COST_ANSWER_SECONDS,
    // Le prix sur sa propre ligne : le texte du MJ garde sa ponctuation.
    prompt: cost ? `${esc(t("QuestionJoueur", { name, what }))}<span class="das-at-cost__cost">${esc(cost)}</span>`
      : esc(t("QuestionJoueurSansPrix", { name, what })),
    // « Refuser » d'abord : sans réponse dans le délai, la fenêtre retient la première option — l'échec reste.
    options: [{ id: "no", label: t("Refuser"), icon: "fa-solid fa-xmark" }, { id: "yes", label: t("Accepter"), icon: "fa-solid fa-check" }]
  });
}

/**
 * Sur le MJ actif : la question au joueur connecté qui possède l'acteur. Sans joueur connecté (PNJ, joueur absent), c'est le MJ qui a
 * déjà tranché en proposant : accepté. Rend true (accepté) ou false.
 * @param {Actor} actor
 * @param {{name: string, what: string, cost: string|null}} payload
 */
export async function askPlayerAtCost(actor, payload) {
  const userId = rollerFor(actor);
  if ( !userId || (userId === game.user.id) ) return { accepted: true, by: "gm" };
  try {
    const answer = await queryPlayer(game.users.get(userId), AT_COST_QUERY, { actor: actor.uuid, ...payload },
      { timeout: (AT_COST_ANSWER_SECONDS + 15) * 1000, actor, label: waitLabel("APrix") });
    return { accepted: answer?.id === "yes", by: "player" };
  } catch(err) {
    console.warn(`${MODULE_ID} | success at a cost for ${actor.name}: no answer from the player`, err);
    return { accepted: false, by: "player" };
  }
}
