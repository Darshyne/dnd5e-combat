/**
 * Macro (à lancer en MJ) : recopie les effets actifs qui manquent aux items venus du Manuel des joueurs 2024 (espèces, classes,
 * dons), d'après leur item du compendium (SPEC §31).
 *
 * Pourquoi : une fiche garde la copie de l'item telle qu'elle était à son import. Des items importés d'une version plus ancienne du
 * module premium ont perdu depuis des effets que dnd5e utilise seul — Ruse gnome (Avantage aux sauvegardes d'Int., Sag., Cha.),
 * Chance (relancer un 1), Agilité halfeline, Forte carrure, Ténacité naine… Le trait paraît alors « manuel ».
 *
 * Ce qu'elle fait : pour chaque acteur du monde, chaque item dont la source est un compendium `dnd-players-handbook.origins`,
 * `.classes` ou `.feats`, crée les effets du compendium absents de l'item (même identifiant ; rien n'est modifié ni supprimé).
 * Deux choix : « Rapport » (ne modifie rien) ou « Réparer ». Le compte rendu part dans le chat, en message privé au MJ. Rejouable sans risque : un effet déjà là n'est pas recréé.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Réparation des effets : réservé au MJ.");
  const mode = await foundry.applications.api.DialogV2.wait({
    window: { title: "Réparation des effets du Manuel des joueurs" },
    content: "<p>« Rapport » ne modifie rien.</p>",
    buttons: [{ action: "report", label: "Rapport", default: true }, { action: "repair", label: "Réparer" }],
    rejectClose: false
  });
  if ( !mode ) return;
  const DRY = mode !== "repair";
  const SOURCES = /^Compendium\.dnd-players-handbook\.(origins|classes|feats)\.Item\./;
  const lines = [];
  let count = 0;
  for ( const actor of game.actors ) {
    for ( const item of actor.items ) {
      const source = item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId;
      if ( !source || !SOURCES.test(source) ) continue;
      const reference = await fromUuid(source);
      if ( !reference?.effects?.size ) continue;
      const missing = reference.effects.filter(e => !item.effects.has(e.id));
      if ( !missing.length ) continue;
      if ( !DRY ) await item.createEmbeddedDocuments("ActiveEffect", missing.map(e => e.toObject()), { keepId: true });
      count += missing.length;
      lines.push(`<li><b>${actor.name}</b> — ${item.name} : ${missing.map(e => e.name).join(", ")}</li>`);
    }
  }
  const content = count
    ? `<p>Effets ${DRY ? "à recopier (rapport : rien n'a été modifié)" : "recopiés"} depuis le Manuel des joueurs : ${count}</p><ul>${lines.join("")}</ul>`
    : "<p>Effets du Manuel des joueurs : rien ne manquait.</p>";
  await ChatMessage.create({ content, whisper: [game.user.id], speaker: { alias: "Réparation des effets" } });
})();
