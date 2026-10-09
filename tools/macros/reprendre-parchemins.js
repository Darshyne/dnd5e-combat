/**
 * Macro (à lancer en MJ, moteur ≥ 0.155.1 actif) : reprend les parchemins de sort du monde (SPEC §48.4).
 *
 * Pourquoi : dnd5e ne garde pas, sur un parchemin, le sort qu'il contient. Le moteur le retrouve d'après les noms (§48), et note
 * désormais le sort sur les parchemins qu'on crée ; ceux qui existent déjà n'ont pas cette note. Certains, en plus, sont d'un
 * ancien format : venus de l'ancien compendium `dnd5e.items` (le parchemin d'Arme spirituelle : une activité utilitaire et une
 * attaque, pas d'invocation), ou importés de D&D Beyond / réglés pour Midi-QOL (activités et flags d'un autre outil).
 *
 * Trois choix, le premier ne touche à rien :
 *  - Rapport : la liste de tous les parchemins (monde, fiches, tokens non liés des scènes), le sort retrouvé et ce qui serait fait ;
 *  - Noter le sort : pose `flags.dnd5e-combat.scroll` (identifiant, niveau, école) sur chaque parchemin reconnu ;
 *  - Noter et reconstruire les anciens : en plus, refait les parchemins d'ancien format au format actuel de dnd5e — une seule
 *    activité « lancer un sort » vers le sort du Manuel des joueurs (`createScrollFromCompendiumSpell`, au niveau du parchemin,
 *    DD et bonus d'attaque du parchemin) : c'est alors le vrai sort qui est lancé, avec toute son automatisation. EN PLACE —
 *    même id, même quantité, même conteneur, mêmes flags des autres modules (butin, marchands) : activités, effets, description,
 *    propriétés et nom remplacés ; flags d'import et de Midi-QOL retirés.
 * Un parchemin déjà au format actuel (activité « lancer un sort ») n'a besoin de rien : le moteur voit le sort lancé.
 * Le compte rendu part dans le chat, en message privé au MJ. Rejouable : un parchemin déjà noté et à jour n'est plus touché.
 */
(async () => {
  // Textes : clés DND5ECOMBAT.Macro.Scrolls.* des fichiers de langue du module.
  const t = (key, data) => data ? game.i18n.format(`DND5ECOMBAT.Macro.Scrolls.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.Macro.Scrolls.${key}`);
  if ( !game.user.isGM ) return ui.notifications.warn(t("GmOnly"));
  const engine = game.modules.get("dnd5e-combat");
  const spellOf = engine?.active ? engine.api?.scrolls?.spellOf : null;
  if ( !spellOf ) return ui.notifications.error(t("EngineRequired"));

  const isScroll = item => (item.type === "consumable") && (item.system?.type?.value === "scroll");
  // Ancien format : ancien compendium dnd5e, import D&D Beyond, réglages Midi-QOL ou CPR.
  const legacyOf = item => {
    const source = item._stats?.compendiumSource ?? "";
    if ( source.startsWith("Compendium.dnd5e.items.") ) return t("LegacyOldCompendium");
    if ( item.flags?.ddbimporter ) return t("LegacyDdb");
    if ( item.flags?.["chris-premades"] || item.flags?.["midi-qol"] || item.flags?.midiProperties ) return t("LegacyMidi");
    return null;
  };

  // Tous les parchemins : items du monde, fiches du monde, tokens non liés de chaque scène (leur copie de l'acteur).
  const found = [];
  for ( const item of game.items ) if ( isScroll(item) ) found.push({ owner: t("World"), item });
  for ( const actor of game.actors ) for ( const item of actor.items ) if ( isScroll(item) ) found.push({ owner: actor.name, item });
  // Un token non lié a sa propre copie de l'inventaire : seuls les items de son delta (ajoutés ou changés) lui sont propres,
  // les autres sont ceux de l'acteur de base, déjà comptés.
  for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
    if ( token.actorLink || !token.actor ) continue;
    for ( const own of token.delta?.items ?? [] ) {
      const item = token.actor.items.get(own.id);
      if ( item && isScroll(item) ) found.push({ owner: t("TokenOwner", { token: token.name, scene: scene.name }), item });
    }
  }

  const rows = found.map(f => {
    // Format actuel : une activité « lancer un sort » — rien à faire, le moteur voit le vrai sort lancé.
    if ( f.item.system.activities?.some?.(a => a.type === "cast") ) return { ...f, modern: true };
    const spell = spellOf(f.item);
    const noted = f.item.flags?.["dnd5e-combat"]?.scroll?.identifier ?? null;
    return { ...f, spell, legacy: legacyOf(f.item), noted, toNote: !!spell && (noted !== spell.identifier) };
  });

  const mode = await foundry.applications.api.DialogV2.wait({
    window: { title: t("Title") },
    content: `<p>${t("DialogSummary", { count: rows.length, recognized: rows.filter(r => r.spell).length, modern: rows.filter(r => r.modern).length,
      unknown: rows.filter(r => !r.spell && !r.modern).length, legacy: rows.filter(r => r.legacy && r.spell).length })}</p>`
      + `<p>${t("ReportChangesNothing")}</p>`,
    buttons: [
      { action: "report", label: t("Report"), default: true },
      { action: "note", label: t("Note") },
      { action: "rebuild", label: t("Rebuild") }
    ],
    rejectClose: false
  });
  if ( !mode ) return;

  // Le sort source, par identifiant : Manuel des joueurs d'abord, puis les sorts 2024 de dnd5e, puis tout compendium d'items.
  const sources = new Map();
  if ( mode === "rebuild" ) {
    const FIRST = ["dnd-players-handbook.spells", "dnd5e.spells24"];
    const rank = pack => (FIRST.includes(pack.collection) ? FIRST.indexOf(pack.collection) : FIRST.length);
    const packs = [...game.packs].filter(p => p.documentName === "Item").sort((a, b) => rank(a) - rank(b));
    for ( const pack of packs ) {
      const index = await pack.getIndex({ fields: ["system.identifier"] });
      for ( const e of index ) if ( (e.type === "spell") && e.system?.identifier && !sources.has(e.system.identifier) ) sources.set(e.system.identifier, e.uuid);
    }
  }

  const ForcedReplacement = foundry.data.operators.ForcedReplacement;
  const ForcedDeletion = foundry.data.operators.ForcedDeletion;
  const lines = [];
  let noted = 0, rebuilt = 0, failed = 0;
  for ( const row of rows ) {
    const { item, spell } = row;
    const where = `<b>${row.owner}</b> — ${item.name}`;
    if ( row.modern ) { lines.push(`<li>${t("LineModern", { where })}</li>`); continue; }
    if ( !spell ) { lines.push(`<li>${t("LineNotFound", { where })}</li>`); continue; }
    const label = t("SpellLabel", { identifier: spell.identifier, level: spell.level ?? "?" });
    const rebuild = (mode === "rebuild") && row.legacy;
    if ( mode === "report" ) {
      const todo = [t(row.toNote ? "ToNote" : "AlreadyNoted"), row.legacy ? t("LegacyFormat", { legacy: row.legacy }) : null].filter(Boolean).join(", ");
      lines.push(`<li>${where} → ${label} — ${todo}</li>`);
      continue;
    }
    try {
      if ( rebuild ) {
        const uuid = sources.get(spell.identifier);
        if ( !uuid ) throw new Error(t("SpellNotInCompendiums"));
        const source = await fromUuid(uuid);
        const Item5e = CONFIG.Item.documentClass;
        const scroll = await Item5e.createScrollFromSpell(source, {}, { dialog: false, level: spell.level ?? source.system.level });
        if ( !scroll ) throw new Error(t("ScrollNotCreated"));
        const data = scroll.toObject();
        await item.update({
          name: data.name,
          "system.activities": ForcedReplacement.create(data.system.activities),
          "system.description": data.system.description,
          "system.properties": data.system.properties,
          "system.source": data.system.source,
          "system.identifier": data.system.identifier,
          "system.uses.max": data.system.uses?.max ?? item.system.uses?.max,
          "flags.dnd5e.spellLevel": data.flags?.dnd5e?.spellLevel ?? item.flags?.dnd5e?.spellLevel,
          "flags.dnd5e.scaling": data.flags?.dnd5e?.scaling ?? 0,
          "flags.dnd5e-combat.scroll": { identifier: spell.identifier, level: spell.level, school: spell.school },
          "flags.ddbimporter": new ForcedDeletion(),
          "flags.midi-qol": new ForcedDeletion(),
          "flags.midiProperties": new ForcedDeletion(),
          "flags.chris-premades": new ForcedDeletion()
        });
        // Les effets du parchemin sont ceux du sort ; les activités y renvoient par leur id (d'où keepId).
        if ( item.effects.size ) await item.deleteEmbeddedDocuments("ActiveEffect", item.effects.map(e => e.id));
        if ( data.effects?.length ) await item.createEmbeddedDocuments("ActiveEffect", data.effects, { keepId: true });
        rebuilt++;
        lines.push(`<li>${t("LineRebuilt", { where, label, legacy: row.legacy, name: data.name })}</li>`);
      } else if ( row.toNote ) {
        await item.update({ "flags.dnd5e-combat.scroll": { identifier: spell.identifier, level: spell.level, school: spell.school } });
        noted++;
        lines.push(`<li>${t("LineNoted", { where, label, legacy: row.legacy ? ` (${t("LegacyFormat", { legacy: row.legacy })})` : "" })}</li>`);
      } else {
        lines.push(`<li>${t("LineAlreadyNoted", { where, label })}</li>`);
      }
    } catch(err) {
      failed++;
      console.error("Scrolls |", item.name, err);
      lines.push(`<li>${t("LineFailed", { where, label, error: err.message })}</li>`);
    }
  }

  const head = (mode === "report")
    ? `<p>${t("HeadReport", { count: rows.length })}</p>`
    : `<p>${t("HeadDone", { noted, rebuilt, failed })}</p>`;
  await ChatMessage.create({ content: `${head}<ul>${lines.join("")}</ul>`, whisper: [game.user.id], speaker: { alias: t("Speaker") } });
})();
