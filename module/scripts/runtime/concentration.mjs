import {
  rollerFor, readConcentrationPrompt, rollConcentration, readConcentrationSave, breakConcentration, removeRegionsOf,
  isConcentrationEffect, concentrationDisabled
} from "../adapter/concentration.mjs";
import { tieSummonToConcentration, removeSummonsOf, joinSummonerCombat, summonItemOf } from "../adapter/summons.mjs";

import { route } from "./router.mjs";
import { log, waitForDice } from "./shared.mjs";

/**
 * Le système vient de demander une sauvegarde de concentration, ou de proposer d'y mettre fin.
 * Pour un PJ dont le joueur est connecté, la carte native reste : c'est à lui de cliquer, ce sont
 * ses dés. Pour tous les autres, le moteur fait ce que ferait le clic du MJ.
 */
async function onPrompt(message) {
  const prompt = readConcentrationPrompt(message);
  if ( !prompt ) return;
  if ( prompt.kind === "end" ) {
    // Mort ou neutralisé : la règle ne prévoit aucun jet, la concentration tombe.
    const ended = await breakConcentration(prompt.actor);
    if ( ended.length ) log(`${prompt.actor.name} : neutralisé, concentration terminée`);
    await message.delete();
    return;
  }
  if ( rollerFor(prompt.actor) ) return;
  log(`${prompt.actor.name} : sauvegarde de concentration DD ${prompt.dc}`);
  await rollConcentration(prompt, message.id);
}

/** Une sauvegarde de concentration ratée rompt la concentration, quel que soit celui qui l'a lancée. */
async function onSave(message) {
  const save = readConcentrationSave(message);
  if ( !save ) return;
  await waitForDice(message);
  if ( save.failed ) {
    const ended = await breakConcentration(save.actor, message);
    log(`${save.actor.name} : sauvegarde de concentration ratée${ended.length ? `, ${ended.map(e => e.name).join(", ")} terminé` : ""}`);
  } else log(`${save.actor.name} : concentration maintenue`);
  // La carte de demande que le moteur a servie lui-même n'a plus d'objet.
  if ( save.prompt ) await game.messages.get(save.prompt)?.delete();
}

export function registerConcentration() {
  route("createChatMessage", message => {
    if ( message.type === "prompt" ) return onPrompt(message);
    if ( message.type === "save" ) return onSave(message);
  }, { executor: true, label: "concentration : traitement interrompu" });

  // Fin de concentration, quelle qu'en soit la cause (bouton du joueur, nouveau sort à concentration,
  // sauvegarde ratée, mort, effet supprimé à la main) : la suppression de l'effet est vue par tous les
  // clients, le MJ actif retire les zones. Pas `dnd5e.endConcentration` : hook local au client qui a mis fin.
  route("deleteActiveEffect", async effect => {
    if ( !isConcentrationEffect(effect) ) return;
    const removed = await removeRegionsOf(effect.uuid);
    if ( removed ) log(`${effect.parent?.name ?? "?"} : ${removed} zone(s) retirée(s) avec la concentration`);
    // §16.13 : les créatures invoquées que la concentration maintenait disparaissent avec elle.
    const gone = await removeSummonsOf(effect.uuid);
    if ( gone ) log(`${effect.parent?.name ?? "?"} : ${gone} créature(s) invoquée(s) retirée(s) avec la concentration`);
    // §16.41 : la trace d'un sort à concentration (Lame de feu).
    const actor = effect.parent;
    const traces = (actor?.effects ?? []).filter(e => e.getFlag("dnd5e-combat", "traceConcentration") === effect.uuid).map(e => e.id);
    if ( traces.length ) {
      // Déjà retirée ailleurs entre-temps (à la main, par un scénario) : rien à dire.
      const still = traces.filter(id => actor.effects.has(id));
      if ( still.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", still).catch(() => {});
      log(`${actor.name} : trace retirée avec la concentration`);
    }
  }, { executor: true, label: "concentration : zones non retirées" });
  // Désactiver la concentration, c'est y mettre fin : l'effet est supprimé, la route ci-dessus fait le reste (et dnd5e
  // retire les effets dépendants). `endConcentration` ne le trouverait plus : il ne voit que les effets actifs.
  route("updateActiveEffect", async (effect, changes) => {
    if ( !concentrationDisabled(effect, changes) ) return;
    log(`${effect.parent?.name ?? "?"} : concentration désactivée (${effect.name}), on y met fin`);
    await effect.delete();
  }, { executor: true, label: "concentration désactivée : non terminée" });
  // §16.13 : une créature invoquée (activité « summon » de dnd5e) est rattachée à la concentration de son invocateur,
  // et entre au combat selon le contenu de l'item.
  route("createToken", async tokenDoc => {
    const item = summonItemOf(tokenDoc);
    if ( !item ) return;
    const effect = await tieSummonToConcentration(tokenDoc);
    if ( effect ) log(`${tokenDoc.name} : maintenu par la concentration de ${item.actor?.name} (${item.name})`);
    const combatant = await joinSummonerCombat(tokenDoc);
    if ( combatant ) log(`${tokenDoc.name} : au combat (initiative ${combatant.initiative ?? "à lancer"})`);
  }, { executor: true, label: "invocation : créature non rattachée" });
}
