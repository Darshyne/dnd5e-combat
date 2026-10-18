/**
 * §203 : le diagnostic reprend la traduction des compendiums pour les textes restés dans la langue d'origine. Sur un acteur créé
 * pour le test, venu d'une créature traduite du Manuel des monstres mais resté en anglais (nom, token prototype), qui porte un
 * Projectile percutant tout en anglais (nom, description, activités, enchantement) et dont un texte a été modifié à la main :
 * « Textes restés dans la langue d'origine » les trouve ; réparé (sauvegarde d'abord), tout est en français sauf le texte modifié.
 * Remet tout : acteur, entrées de sauvegarde, et le compendium s'il n'existait pas avant.
 */
const MODULE_ID = "dnd5e-combat";
const WALLOPING = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgWallopingAmmu";
const SKIRMISHER = "Compendium.dnd-monster-manual.actors.mmAarakocraSkirm";
const HAND = "<p>Texte écrit à la main par le MJ.</p>";

export default {
  name: "diagnostic — textes restés en anglais, traduction du compendium reprise",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const item = await ctx.call("get-compendium-entry", { uuid: WALLOPING }).catch(() => null);
    const creature = await ctx.call("get-compendium-entry", { uuid: SKIRMISHER }).catch(() => null);
    const itemOrig = item?.data?.flags?.babele?.originalPayload;
    const actorOrig = creature?.data?.flags?.babele?.originalPayload;
    if ( !itemOrig || !actorOrig ) { ctx.log("compendiums non traduits sur ce client : non applicable"); return; }
    const packBefore = (await ctx.call("list-compendiums", {}).catch(() => [])) ?? [];
    const hadPack = JSON.stringify(packBefore).includes("world.das-backups");
    const backups = [];
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));
    // §204 : sans quoi la fiche serait traduite dès sa création, avant l'analyse.
    const auto = await api("setting", { key: "autoTranslate", value: false });
    ctx.restore(() => api("setting", { key: "autoTranslate", value: auto.before }));

    // L'objet remis dans sa langue d'origine, à partir des valeurs que Babele garde ; son texte de carte modifié à la main.
    const { _id, folder, ownership, _stats, ...itemData } = foundry_clone(item.data);
    itemData.name = itemOrig.name;
    itemData.system.description.value = itemOrig.description;
    itemData.system.description.chat = HAND;
    for ( const [id, a] of Object.entries(itemOrig.activities ?? {}) ) {
      const activity = itemData.system.activities?.[id];
      if ( !activity ) continue;
      activity.name = a.name;
      if ( activity.activation ) activity.activation.condition = a.condition;
      if ( activity.description ) activity.description.chatFlavor = a.chatFlavor;
    }
    const origEffect = Object.values(itemOrig.effects ?? {})[0];
    for ( const e of itemData.effects ?? [] ) if ( origEffect ) e.name = origEffect.name;
    itemData._stats = { compendiumSource: WALLOPING };
    // Un second objet sans identifiant enregistré (dnd5e le tire du nom) : renommé, il doit garder celui tiré du nom anglais.
    const bare = foundry_clone(itemData);
    bare.system.identifier = "";
    const bareId = slug(itemOrig.name);

    const created = await ctx.call("create-actor", { actorData: {
      name: actorOrig.name, type: "npc", prototypeToken: { name: actorOrig.name },
      // La source par l'ancien drapeau, que la vérification lit aussi : le connecteur ne transmet pas `_stats` à la création.
      flags: { core: { sourceId: SKIRMISHER }, [MODULE_ID]: { scenario: "diagnostic-traduction" } }, items: [itemData, bare]
    } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, `acteur de test créé en anglais (${actorOrig.name}, ${itemOrig.name})`) ) return;
    const root = `Actor.${actorId}`;

    const scan = await api("diagnosticScan", { checks: ["retranslate"] });
    const mine = (scan.retranslate ?? []).filter(t => t.root?.uuid === root);
    ctx.expect(mine.length === 3 && mine.every(t => t.fixable), `analyse : l'acteur et l'objet sont trouvés (${mine.map(t => t.text).join(" | ") || "rien"})`);

    const repaired = await api("diagnosticRepair", { checks: ["retranslate"], roots: [root] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    ctx.expect(repaired.results.length === 3 && repaired.results.every(r => r.ok), `réparation : ${repaired.results.map(r => r.line).join(" | ") || "aucune"}`);

    const after = await ctx.call("get-actor", { actorId });
    ctx.expect(after.name === creature.data.name, `nom de la créature traduit (${after.name})`);
    const it = (after.items ?? []).find(i => i.system?.identifier === item.data.system?.identifier);
    const pinned = (after.items ?? []).find(i => i !== it);
    ctx.expect(pinned?.system?.identifier === bareId, `identifiant figé avant de renommer (${pinned?.name} : « ${pinned?.system?.identifier} », attendu « ${bareId} »)`);
    ctx.expect(it?.name === item.data.name, `nom de l'objet traduit (${it?.name})`);
    // Foundry nettoie le HTML à l'enregistrement : comparé par son début, et plus jamais l'anglais.
    const desc = it?.system?.description?.value ?? "";
    ctx.expect((desc !== itemOrig.description) && desc.startsWith(item.data.system.description.value.slice(0, 30)), `description de l'objet traduite (${desc.slice(0, 50)})`);
    ctx.expect(it?.system?.description?.chat === HAND, "le texte modifié à la main n'a pas bougé");
    const acts = Object.entries(it?.system?.activities ?? {});
    ctx.expect(acts.every(([id, a]) => a.name === item.data.system.activities[id]?.name), `activités traduites (${acts.map(([, a]) => a.name).join(", ")})`);
    const names = (it?.effects ?? []).map(e => e.name);
    ctx.expect(!!names.length && !names.includes(origEffect?.name), `enchantement traduit (${names.join(", ")})`);

    const again = await api("diagnosticScan", { checks: ["retranslate"] });
    ctx.expect(!(again.retranslate ?? []).some(t => t.root?.uuid === root), "une nouvelle analyse ne trouve plus rien sur cet acteur");
  }
};

/** Comme `formatIdentifier` de dnd5e (utils.mjs) : minuscules, sans accents, tirets. */
function slug(name) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function foundry_clone(data) {
  return JSON.parse(JSON.stringify(data));
}
