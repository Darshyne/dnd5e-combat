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
    if ( ended.length ) log(`${prompt.actor.name}: Incapacitated, concentration ended`);
    await message.delete();
    return;
  }
  if ( rollerFor(prompt.actor) ) return;
  log(`${prompt.actor.name}: concentration saving throw DC ${prompt.dc}`);
  await rollConcentration(prompt, message.id);
}

/** Une sauvegarde de concentration ratée rompt la concentration, quel que soit celui qui l'a lancée. */
async function onSave(message) {
  const save = readConcentrationSave(message);
  if ( !save ) return;
  await waitForDice(message);
  if ( save.failed ) {
    const ended = await breakConcentration(save.actor, message);
    log(`${save.actor.name}: concentration saving throw failed${ended.length ? `, ${ended.map(e => e.name).join(", ")} ended` : ""}`);
  } else log(`${save.actor.name}: concentration maintained`);
  // La carte de demande que le moteur a servie lui-même n'a plus d'objet.
  if ( save.prompt ) await game.messages.get(save.prompt)?.delete();
}

export function registerConcentration() {
  route("createChatMessage", message => {
    if ( message.type === "prompt" ) return onPrompt(message);
    if ( message.type === "save" ) return onSave(message);
  }, { executor: true, label: "concentration: processing interrupted" });

  // Fin de concentration, quelle qu'en soit la cause (bouton du joueur, nouveau sort à concentration,
  // sauvegarde ratée, mort, effet supprimé à la main) : la suppression de l'effet est vue par tous les
  // clients, le MJ actif retire les zones. Pas `dnd5e.endConcentration` : hook local au client qui a mis fin.
  route("deleteActiveEffect", async effect => {
    if ( !isConcentrationEffect(effect) ) return;
    const removed = await removeRegionsOf(effect.uuid);
    if ( removed ) log(`${effect.parent?.name ?? "?"}: ${removed} area(s) removed with concentration`);
    // §16.13 : les créatures invoquées que la concentration maintenait disparaissent avec elle.
    const gone = await removeSummonsOf(effect.uuid);
    if ( gone ) log(`${effect.parent?.name ?? "?"}: ${gone} summoned creature(s) removed with concentration`);
    // §16.41 : la trace d'un sort à concentration (Lame de feu).
    const actor = effect.parent;
    const traces = (actor?.effects ?? []).filter(e => e.getFlag("dnd5e-combat", "traceConcentration") === effect.uuid).map(e => e.id);
    if ( traces.length ) {
      // Déjà retirée ailleurs entre-temps (à la main, par un scénario) : rien à dire.
      const still = traces.filter(id => actor.effects.has(id));
      if ( still.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", still).catch(() => {});
      log(`${actor.name}: trace removed with concentration`);
    }
  }, { executor: true, label: "concentration: areas not removed" });
  // Désactiver la concentration, c'est y mettre fin : l'effet est supprimé, la route ci-dessus fait le reste (et dnd5e
  // retire les effets dépendants). `endConcentration` ne le trouverait plus : il ne voit que les effets actifs.
  route("updateActiveEffect", async (effect, changes) => {
    if ( !concentrationDisabled(effect, changes) ) return;
    log(`${effect.parent?.name ?? "?"}: concentration disabled (${effect.name}), ending it`);
    await effect.delete();
  }, { executor: true, label: "concentration disabled: not ended" });
  // §16.13 : une créature invoquée (activité « summon » de dnd5e) est rattachée à la concentration de son invocateur,
  // et entre au combat selon le contenu de l'item.
  route("createToken", async tokenDoc => {
    const item = summonItemOf(tokenDoc);
    if ( !item ) return;
    const effect = await tieSummonToConcentration(tokenDoc);
    if ( effect ) log(`${tokenDoc.name}: sustained by ${item.actor?.name}'s concentration (${item.name})`);
    const combatant = await joinSummonerCombat(tokenDoc);
    if ( combatant ) log(`${tokenDoc.name}: in combat (initiative ${combatant.initiative ?? "to roll"})`);
  }, { executor: true, label: "summon: creature not attached" });
}
