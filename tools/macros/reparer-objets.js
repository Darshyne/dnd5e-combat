/**
 * Macro (à lancer en MJ) : redonne aux objets des fiches les effets qu'ils ont perdus, d'après le même objet dans les compendiums du
 * Guide du maître et du Manuel des joueurs (SPEC §54).
 *
 * Pourquoi : une fiche garde la copie de l'objet telle qu'elle était à son import. Des objets importés d'ailleurs (ancien compendium,
 * D&D Beyond, autre version) n'ont pas les effets que dnd5e applique seul — la Cape de protection du magicien de la table n'avait ni son +1 à la CA
 * ni son +1 aux sauvegardes.
 *
 * Ce qu'elle fait : pour chaque objet (monde, fiches, tokens non liés des scènes) qui n'a AUCUN effet, alors que l'objet de même
 * identifiant (`system.identifier`) dans `dnd-dungeon-masters-guide.equipment` ou `dnd-players-handbook.equipment` en a, elle
 * recopie ses effets (mêmes ids : les activités y renvoient). Un objet qui a déjà des effets n'est jamais touché, même s'ils
 * diffèrent : il est seulement signalé. Deux choix : « Rapport » (ne modifie rien) ou « Réparer ». Compte rendu dans le chat, en
 * message privé au MJ. Rejouable sans risque.
 */
(async () => {
  // Textes : clés DND5ECOMBAT.Macro.RepairItems.* des fichiers de langue du module.
  const t = (key, data) => data ? game.i18n.format(`DND5ECOMBAT.Macro.RepairItems.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.Macro.RepairItems.${key}`);
  if ( !game.user.isGM ) return ui.notifications.warn(t("GmOnly"));
  const PACKS = ["dnd-dungeon-masters-guide.equipment", "dnd-players-handbook.equipment"];
  const TYPES = new Set(["equipment", "weapon", "consumable", "tool", "loot", "container"]);

  // Les références : identifiant → document du compendium (le premier pack l'emporte).
  const refs = new Map();
  for ( const id of PACKS ) {
    const pack = game.packs.get(id);
    if ( !pack ) continue;
    const index = await pack.getIndex({ fields: ["system.identifier"] });
    for ( const e of index ) if ( e.system?.identifier && !refs.has(e.system.identifier) ) refs.set(e.system.identifier, { pack, id: e._id });
  }
  if ( !refs.size ) return ui.notifications.error(t("PacksMissing"));

  // Les objets : monde, fiches, tokens non liés (leur delta seulement : le reste est l'acteur de base).
  const found = [];
  for ( const item of game.items ) found.push({ owner: t("World"), item });
  for ( const actor of game.actors ) for ( const item of actor.items ) found.push({ owner: actor.name, item });
  for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
    if ( token.actorLink || !token.actor ) continue;
    for ( const own of token.delta?.items ?? [] ) {
      const item = token.actor.items.get(own.id);
      if ( item ) found.push({ owner: t("TokenOwner", { token: token.name, scene: scene.name }), item });
    }
  }

  const cache = new Map();
  const reference = async identifier => {
    if ( cache.has(identifier) ) return cache.get(identifier);
    const r = refs.get(identifier);
    const doc = r ? await r.pack.getDocument(r.id) : null;
    cache.set(identifier, doc);
    return doc;
  };
  const rows = [];
  for ( const { owner, item } of found ) {
    if ( !TYPES.has(item.type) ) continue;
    const identifier = item.system?.identifier;
    if ( !identifier || !refs.has(identifier) ) continue;
    const ref = await reference(identifier);
    if ( !ref?.effects?.size ) continue;
    if ( item.effects.size ) {
      const missing = ref.effects.filter(e => !item.effects.has(e.id));
      if ( missing.length ) rows.push({ owner, item, ref, kind: "different" });
      continue;
    }
    rows.push({ owner, item, ref, kind: "missing" });
  }

  const missing = rows.filter(r => r.kind === "missing");
  const mode = await foundry.applications.api.DialogV2.wait({
    window: { title: t("Title") },
    content: `<p>${t("DialogSummary", { missing: missing.length, different: rows.length - missing.length })}</p><p>${t("ReportChangesNothing")}</p>`,
    buttons: [{ action: "report", label: t("Report"), default: true }, { action: "repair", label: t("Repair") }],
    rejectClose: false
  });
  if ( !mode ) return;

  const lines = [];
  let repaired = 0;
  for ( const row of rows ) {
    const names = row.ref.effects.map(e => e.name).join(", ");
    const where = `<b>${row.owner}</b> — ${row.item.name}`;
    if ( row.kind === "different" ) { lines.push(`<li>${t("LineDifferent", { where, names })}</li>`); continue; }
    if ( mode === "report" ) { lines.push(`<li>${t("LineToCopy", { where, names })}</li>`); continue; }
    try {
      // Des effets d'enchantement (Huile d'affûtage) ne s'ajoutent pas à un objet existant : dnd5e les y croit appliqués et les
      // refuse sans erreur (data/active-effect/enchantment.mjs, `_preCreate`). Ils ne naissent qu'avec l'objet : on le remplace par
      // une copie neuve du compendium, qui garde nom, quantité, conteneur, prix, ordre et flags des autres modules.
      if ( row.ref.effects.some(e => e.type === "enchantment") ) {
        const data = game.items.fromCompendium(row.ref);
        const old = row.item;
        data.name = old.name;
        data.sort = old.sort;
        Object.assign(data.system, { quantity: old.system.quantity, container: old.system.container ?? null, price: old.system.price ?? data.system.price });
        for ( const [scope, value] of Object.entries(old.flags ?? {}) ) if ( !["dnd5e", "core"].includes(scope) ) data.flags[scope] = foundry.utils.deepClone(value);
        if ( old.parent ) await old.parent.createEmbeddedDocuments("Item", [data]);
        else await Item.implementation.create({ ...data, folder: old.folder?.id ?? null });
        await old.delete();
        repaired++;
        lines.push(`<li>${t("LineReplaced", { where, names })}</li>`);
        continue;
      }
      await row.item.createEmbeddedDocuments("ActiveEffect", row.ref.effects.map(e => e.toObject()), { keepId: true });
      // dnd5e peut refuser un effet sans lever d'erreur : on vérifie qu'ils sont bien là.
      const missingAfter = row.ref.effects.filter(e => !row.item.effects.has(e.id)).map(e => e.name);
      if ( missingAfter.length ) throw new Error(t("EffectsRefused", { names: missingAfter.join(", ") }));
      repaired++;
      lines.push(`<li>${t("LineCopied", { where, names })}</li>`);
    } catch(err) {
      console.error("Repair items |", row.item.name, err);
      lines.push(`<li>${t("LineFailed", { where, error: err.message })}</li>`);
    }
  }
  const head = (mode === "report")
    ? `<p>${t("HeadReport")}</p>`
    : `<p>${t("HeadDone", { count: repaired })}</p>`;
  await ChatMessage.create({ content: `${head}<ul>${lines.join("") || `<li>${t("NothingToReport")}</li>`}</ul>`, whisper: [game.user.id],
    speaker: { alias: t("Title") } });
})();
