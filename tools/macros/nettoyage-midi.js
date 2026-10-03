/**
 * Nettoyage Midi-QOL / DAE / CPR / GPS des fiches de PJ (étape 9 du SPEC, premier essai sur le monde `ravenloft`, 2026-09-25).
 * Macro de monde, à lancer par le MJ. Elle propose les fiches qui portent des traces de Midi/DAE/CPR (celles des joueurs
 * cochées), puis « Rapport » (n'écrit rien, compte rendu chuchoté au MJ) ou « Nettoyer ».
 *
 * Pour chaque item d'une fiche :
 *  - SUPPRIMÉ : actions génériques CPR (remplacées par les actions de base du moteur), doublons (copie CPR de Bénédiction du
 *    Ténébreux, Voile défensif d'un compendium partagé de la Forge, Égide « v4 » de Midi quand l'Égide du PHB est là) ;
 *  - REMPLACÉ par sa version officielle (PHB, puis dnd5e 2024), **même id** (liens d'avancement, favoris, barre BG3) :
 *    sorts et capacités portant des flags Midi/DAE/CPR, ou venant d'un compendium tiers (CPR, Midi Item Showcase, Forge,
 *    D&D Beyond, BLFX) ; on garde l'état de la fiche (préparation, utilisations dépensées, quantité, équipé, harmonisé,
 *    contenant) et, pour un objet, son nom et son image ;
 *  - NETTOYÉ (flags retirés, rien d'autre) : objets propres à la campagne (nom différent de l'officiel), et ce qui n'a pas
 *    de version officielle (Voile spirituel, Anneau de Chaleur Maudit, parchemins) — les effets d'Aura Effects, invalides
 *    sans le module, y sont supprimés.
 * Sur les acteurs : flags Midi/CPR/GPS retirés ; les effets actifs de l'acteur ne sont QUE signalés (état de jeu).
 */
if ( !game.user.isGM ) return ui.notifications.warn("Nettoyage Midi/DAE/CPR : réservé au MJ.");
const BAD = ["midi-qol", "midiProperties", "dae", "chris-premades", "gambits-premades", "itemacro", "autoanimations", "ActiveAuras",
  "times-up", "automated-conditions-5e", "darsh-automation", "cat", "link-item-resource-5e", "custom-character-sheet-sections", "boss-loot-assets-premium"];
// Le Monster Manual compte comme officiel : les attaques d'une forme sauvage (Morsure, Griffes) n'ont pas d'équivalent au
// PHB ; une telle attaque marquée par Midi n'est remplacée que par sa propre source.
const OFFICIAL = /^Compendium\.(dnd-players-handbook|dnd-monster-manual|dnd5e)\./;
const PHYSICAL = new Set(["weapon", "equipment", "consumable", "loot", "tool", "container"]);
const STRIP_ONLY = new Set(["spirit-shroud", "anneau-de-chaleur-maudit", "staff"]);
const RENAMED = { "blfx-scorching-ray": "scorching-ray", "bullseye-lantern-11438": "bullseye-lantern", "arcane-ward-resource-usage-10010": "arcane-ward" };
// Ordre de recherche : le PHB d'abord (son équipement avant ses capacités de classe : l'Attaque à mains nues est dans les deux),
// puis dnd5e 2024.
const PACK_ORDER = ["dnd-players-handbook.equipment", "dnd-players-handbook.spells", "dnd-players-handbook.feats", "dnd-players-handbook.origins",
  "dnd-players-handbook.classes", "dnd5e.equipment24", "dnd5e.spells24", "dnd5e.feats24", "dnd5e.origins24", "dnd5e.classes24"];
const PACKS = PACK_ORDER.map(id => game.packs.get(id)).filter(p => p?.documentName === "Item");
/** Un compendium d'automatisation tiers : ses objets se remplacent même renommés (ils n'ont rien de propre à la campagne). */
const THIRD_PARTY = /^Compendium.(chris-premades|midi-item-showcase|forge-vtt-shared|boss-loot)|^Compendium.world.ddb/;

const del = foundry.data.operators.ForcedDeletion;
const hasBad = flags => Object.keys(flags ?? {}).some(k => BAD.includes(k));
const cleanFlags = flags => Object.fromEntries(Object.entries(foundry.utils.deepClone(flags ?? {})).filter(([k]) => !BAD.includes(k)));
const deletion = flags => Object.fromEntries(Object.keys(flags ?? {}).filter(k => BAD.includes(k)).map(k => [`flags.${k}`, new del()]));
const badEffect = e => hasBad(e.flags) || (e.type !== "base" && e.type !== "enchantment")
  || (e.system?.changes ?? e.changes ?? []).some(c => /midi-qol|chris-premades|DamageBonusMacro|ItemMacro/.test(c.key ?? ""));
const needsWork = item => hasBad(item.flags) || item.effects.some(badEffect) || (item.effects.invalidDocumentIds?.size > 0)
  || !OFFICIAL.test(item._stats?.compendiumSource ?? "") && !!item._stats?.compendiumSource;

/** Une version officielle : la source de l'item si elle est officielle, sinon par identifiant (et type), PHB d'abord. */
async function officialFor(item) {
  const src = item._stats?.compendiumSource ?? "";
  if ( OFFICIAL.test(src) ) { const doc = await fromUuid(src).catch(() => null); if ( doc ) return doc; }
  const identifier = RENAMED[item.system.identifier] ?? item.system.identifier;
  for ( const pack of PACKS ) {
    const index = await pack.getIndex({ fields: ["system.identifier"] });
    const hit = index.find(e => (e.system?.identifier === identifier) && (e.type === item.type));
    if ( hit ) return pack.getDocument(hit._id);
  }
  return null;
}

/** Les données de remplacement : l'officiel, avec l'id, les flags propres et l'état de la fiche d'origine. */
function replacement(item, doc) {
  const data = doc.toObject();
  const old = item.toObject();
  data._id = item.id;
  const kept = cleanFlags(old.flags);
  data.flags = foundry.utils.mergeObject(foundry.utils.deepClone(data.flags ?? {}), { ...kept, babele: data.flags?.babele ?? kept.babele }, { inplace: false });
  if ( !data.flags.babele ) delete data.flags.babele;
  data._stats = { ...(data._stats ?? {}), compendiumSource: doc.uuid };
  data.sort = old.sort;
  const s = old.system ?? {};
  const keep = paths => { for ( const p of paths ) { const v = foundry.utils.getProperty(s, p); if ( v !== undefined ) foundry.utils.setProperty(data.system, p, v); } };
  keep(["uses.spent", "container"]);
  if ( item.type === "spell" ) keep(["method", "prepared", "sourceClass", "ability"]);
  if ( PHYSICAL.has(item.type) ) {
    if ( !(item.system.identifier in RENAMED) ) { data.name = old.name; data.img = old.img; }
    keep(["quantity", "equipped", "attuned", "attunement", "identified"]);
  }
  // Utilisations dépensées des activités qui existent des deux côtés.
  for ( const [id, activity] of Object.entries(s.activities ?? {}) ) {
    if ( data.system.activities?.[id] && (activity.uses?.spent !== undefined) ) foundry.utils.setProperty(data.system.activities[id], "uses.spent", activity.uses.spent);
  }
  return data;
}

// Les fiches touchées : un flag Midi/DAE/CPR… sur l'acteur, un de ses items ou un de leurs effets, ou un item d'un compendium
// d'automatisation tiers. Celles d'un joueur (PJ, formes sauvages) sont cochées d'office ; « Rapport » n'écrit rien.
const touched = actor => hasBad(actor.flags) || actor.effects.some(e => hasBad(e.flags))
  || actor.items.some(i => hasBad(i.flags) || i.effects.some(e => hasBad(e.flags)) || THIRD_PARTY.test(i._stats?.compendiumSource ?? ""));
const candidates = game.actors.filter(touched).sort((a, b) => (b.hasPlayerOwner - a.hasPlayerOwner) || a.name.localeCompare(b.name));
if ( !candidates.length ) {
  await ChatMessage.create({ content: "<p><b>Nettoyage Midi/DAE/CPR</b> : aucune fiche ne porte de trace de Midi-QOL, DAE ou CPR — rien à faire.</p>",
    whisper: ChatMessage.getWhisperRecipients("GM"), speaker: { alias: "dnd5e-combat" } });
  return;
}
const escape = foundry.utils.escapeHTML ?? (t => t);
const picked = await foundry.applications.api.DialogV2.wait({
  window: { title: "Nettoyage Midi/DAE/CPR" },
  position: { width: 460 },
  content: `<p>Fiches qui portent des traces de Midi-QOL, DAE ou CPR (celles des joueurs cochées). « Rapport » ne modifie rien.</p>
    <div style="max-height: 320px; overflow-y: auto">${candidates.map(a => `<label style="display: block"><input type="checkbox" name="${a.id}"
    ${a.hasPlayerOwner ? "checked" : ""}> ${escape(a.name)} <small>(${a.type})</small></label>`).join("")}</div>`,
  buttons: ["report", "apply"].map(action => ({ action, label: action === "apply" ? "Nettoyer" : "Rapport", default: action === "report",
    callback: (event, button) => ({ action, ids: candidates.filter(a => button.form.elements[a.id]?.checked).map(a => a.id) }) })),
  rejectClose: false
});
if ( !picked ) return;
if ( !picked.ids.length ) return ui.notifications.info("Nettoyage Midi/DAE/CPR : aucune fiche choisie, rien n'a été fait.");
const DRY = picked.action !== "apply";
const ACTORS = picked.ids;

const report = [];
for ( const actorId of ACTORS ) {
  const actor = game.actors.get(actorId);
  if ( !actor ) continue;
  const lines = [];
  const ids = identifier => actor.items.filter(i => i.system.identifier === identifier);

  for ( const item of [...actor.items] ) {
    const id = item.system.identifier;
    const src = item._stats?.compendiumSource ?? "";
    // Suppressions.
    const duplicate = (id === "dark-ones-blessing" && src.startsWith("Compendium.chris-premades") && ids(id).length > 1)
      || (id === "blade-ward" && !OFFICIAL.test(src) && ids(id).length > 1)
      || (id === "arcane-ward-resource-usage-10010" && ids("arcane-ward").length > 0);
    if ( (id === "generic-actions") || duplicate ) {
      lines.push(`🗑 ${item.name}`);
      if ( !DRY ) await item.delete();
      continue;
    }
    if ( !needsWork(item) ) continue;

    const doc = STRIP_ONLY.has(id) || /^spell-scroll/.test(id) ? null : await officialFor(item);
    // Un objet n'est remplacé que s'il porte le nom de l'officiel, vient d'un compendium tiers, ou d'une copie « v4 » de Midi :
    // un objet nommé autrement (Amulette de Shar, Dague rituelle) est un objet de campagne, qu'on ne fait que nettoyer.
    const custom = PHYSICAL.has(item.type) && !!doc && (doc.name !== item.name) && !THIRD_PARTY.test(src) && !(id in RENAMED);
    if ( doc && !custom ) {
      lines.push(`♻ ${item.name} ← ${doc.name} (${doc.uuid.replace("Compendium.", "")})`);
      if ( !DRY ) {
        const data = replacement(item, doc);
        await actor.deleteEmbeddedDocuments("Item", [item.id]);
        await actor.createEmbeddedDocuments("Item", [data], { keepId: true });
      }
      continue;
    }
    // Nettoyage sur place (rien à retirer : rien à dire).
    if ( !hasBad(item.flags) && !item.effects.some(badEffect) && !(item.effects.invalidDocumentIds?.size > 0) ) continue;
    const invalid = [...(item.effects.invalidDocumentIds ?? [])];
    const effects = item.effects.filter(badEffect);
    lines.push(`🧹 ${item.name}${doc ? " (objet de campagne)" : ""} : flags ${Object.keys(deletion(item.flags)).map(k => k.slice(6)).join(", ") || "—"}`
      + `${invalid.length ? ` ; ${invalid.length} effet(s) Aura Effects supprimé(s)` : ""}${effects.length ? ` ; effets nettoyés : ${effects.map(e => e.name).join(", ")}` : ""}`);
    if ( DRY ) continue;
    if ( invalid.length ) await item.deleteEmbeddedDocuments("ActiveEffect", invalid);
    const update = deletion(item.flags);
    if ( Object.keys(update).length ) await item.update(update);
    for ( const e of effects ) {
      const changes = (e.system?.changes ?? e.changes ?? []).filter(c => !/midi-qol|chris-premades|DamageBonusMacro|ItemMacro/.test(c.key ?? ""));
      await e.update({ ...deletion(e.flags), "system.changes": changes });
    }
  }

  // Arme de pacte réglée à la main (vu sur l'arme de pacte de l'occultiste de la table, 2026-09-26) : les types nécrotique, psychique et radiant
  // inscrits dans les dégâts de base de l'arme, et le Charisme en bonus fixe. Le moteur les donne désormais par le pacte (§16.45 :
  // type choisi, Charisme) : l'arme redevient elle-même — ses types physiques, sans bonus fixe (sinon le Charisme compte deux fois).
  if ( ids("pact-of-the-blade").length ) {
    const PACT_TYPES = ["necrotic", "psychic", "radiant"];
    for ( const weapon of actor.items.filter(i => (i.type === "weapon") && (i.system.type?.value !== "natural")) ) {
      const base = weapon._source.system.damage?.base ?? {};
      const types = [...(base.types ?? [])];
      if ( !PACT_TYPES.every(t => types.includes(t)) ) continue;
      const kept = types.filter(t => !PACT_TYPES.includes(t));
      const bonus = /^\s*[+-]?\d+\s*$/.test(String(base.bonus ?? "")) ? "" : base.bonus;
      lines.push(`🗡 ${weapon.name} : arme de pacte réglée à la main — types ${types.join(", ")} → ${kept.join(", ") || "—"}`
        + `${bonus !== base.bonus ? `, bonus fixe ${base.bonus} retiré` : ""}`);
      if ( !DRY ) await weapon.update({ "system.damage.base.types": kept, "system.damage.base.bonus": bonus ?? "" });
    }
  }

  // L'acteur : ses flags ; ses effets ne sont que signalés.
  const actorDeletion = deletion(actor.flags);
  if ( Object.keys(actorDeletion).length ) {
    lines.push(`🧹 fiche : flags ${Object.keys(actorDeletion).map(k => k.slice(6)).join(", ")}`);
    if ( !DRY ) await actor.update(actorDeletion);
  }
  for ( const e of actor.effects ) {
    if ( !DRY && hasBad(e.flags) ) await e.update(deletion(e.flags));
    lines.push(`👁 effet actif sur la fiche : ${e.name}${e.disabled ? " (désactivé)" : ""}`);
  }
  report.push(`<h3>${actor.name}</h3><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>`);
}

// Un message par fiche : un seul, trop long, se lit mal (et le connecteur le tronque).
const title = DRY ? "Nettoyage Midi/DAE/CPR — rapport (rien n'est écrit)" : "Nettoyage Midi/DAE/CPR — fait";
for ( const part of report ) {
  await ChatMessage.create({ content: `<h2>${title}</h2>${part}`, whisper: ChatMessage.getWhisperRecipients("GM"), speaker: { alias: "dnd5e-combat" } });
}
