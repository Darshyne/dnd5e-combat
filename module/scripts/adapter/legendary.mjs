/**
 * Résistance légendaire (SPEC §18.9, M6) : « si la créature rate une sauvegarde, elle peut choisir de la réussir ». dnd5e 6 la
 * gère en natif : `resources.legres` du PNJ, un bouton « Résister » sur la carte d'une sauvegarde ratée
 * (`SaveMessageData#canResist`, data/chat-message/save-message-data.mjs:77-81) et `actor.system.resistSave(message)`
 * (data/actor/npc.mjs:572-600), qui dépense une résistance et marque la sauvegarde `resisted` (réussie). Le moteur, qui
 * applique l'issue dès le jet, pose la question AVANT d'appliquer, puis appelle la méthode du système.
 */

import { timedWait } from "./dialogs.mjs";

/** Résistances légendaires restantes, ou 0. */
export const legendaryLeft = actor => actor?.system?.resources?.legres?.value ?? 0;

/** Le système permet-il de résister à cette sauvegarde (PNJ, raté, pas déjà résisté, résistance restante) ? */
export const canResistSave = message => message?.system?.canResist === true;

/**
 * Demande au MJ s'il dépense une Résistance légendaire. Sans réponse dans le délai des fenêtres de combat : non.
 * @returns {Promise<boolean>}
 */
export async function askLegendary(actor, { total, dc, item }) {
  const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Legendaire.${key}`, data ?? {});
  const answer = await timedWait({
    window: { title: t("Titre") },
    content: `<p>${t("Question", { name: actor.name, total, dc, item: item ?? "", left: legendaryLeft(actor) })}</p>`,
    buttons: [
      { action: "yes", label: t("Oui"), icon: "fa-solid fa-shield", default: true },
      { action: "no", label: t("Non"), icon: "fa-solid fa-xmark" }
    ]
  }, { fallback: "no" });
  return answer === "yes";
}

/** Dépense une Résistance légendaire sur cette sauvegarde : la méthode du système (compteur, carte marquée « résistée »). */
export async function resistSave(message) {
  await message.getAssociatedActor()?.system?.resistSave?.(message);
}
