/**
 * §245, §257 (issue #21) : la vérification « D&D Beyond » du diagnostic, sur un acteur créé pour le test.
 *  - Une Armure d'Agathys du Manuel, marquée importée de DDB (`flags.ddbimporter`) et dont les activités ont reçu d'autres ids : la
 *    règle du moteur cite l'activité de riposte du Manuel, absente de la copie → signalée, avec le pack de l'objet officiel.
 *  - La même, marquée DDB mais avec les ids du Manuel : rien à signaler.
 *  - La copie aux ids changés, sans marque DDB : pas l'affaire de cette vérification.
 *  L'analyse n'écrit rien ; la réparation met l'objet officiel à la place, sans puis avec le verrou de DDB Importer.
 */
const MODULE_ID = "dnd5e-combat";
const PACK = "dnd-players-handbook.spells";

export default {
  name: "diagnostic-ddb — objet DDB aux ids d'activité changés signalé, puis remplacé par l'officiel, avec et sans verrou",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const index = await ctx.call("list-compendium-entries", { packId: PACK, search: "Agathys" }).catch(() => []);
    const uuid = (Array.isArray(index) ? index : []).find(e => /Agathys/i.test(e.name))?.uuid;
    const ref = uuid ? await ctx.call("get-compendium-entry", { uuid }).catch(() => null) : null;
    const activities = ref?.data?.system?.activities ?? {};
    if ( !Object.keys(activities).length ) { ctx.log(`Armure d'Agathys introuvable dans ${PACK} : non applicable`); return; }

    const { _id, folder, ownership, _stats, ...base } = ref.data;
    const rekeyed = {};
    Object.values(activities).forEach((activity, i) => {
      const id = `ddbTestActivit${String(i).padStart(2, "0")}`;
      rekeyed[id] = { ...activity, _id: id };
    });
    const ddbFlag = { ddbimporter: { id: 123456, dndbeyond: { test: true } } };
    const items = [
      { ...base, name: "DAS DDB renamed", system: { ...base.system, activities: rekeyed }, flags: { ...(base.flags ?? {}), ...ddbFlag } },
      { ...base, name: "DAS DDB intact", flags: { ...(base.flags ?? {}), ...ddbFlag } },
      { ...base, name: "DAS not DDB", system: { ...base.system, activities: rekeyed } }
    ];
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: [], dropPack: false, actors }));
    const created = await ctx.call("create-actor", { actorData: {
      name: "DAS diagnostic DDB (test)", type: "npc", flags: { [MODULE_ID]: { scenario: "diagnostic-ddb" } }, items
    } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur de test créé, avec trois copies de l'Armure d'Agathys") ) return;
    const root = `Actor.${actorId}`;
    const before = JSON.stringify((await ctx.call("get-actor", { actorId })).items?.map(i => [i.name, i.flags, Object.keys(i.system?.activities ?? {})]));

    const scan = await api("diagnosticScan", { checks: ["ddb"] });
    const mine = (scan.ddb ?? []).filter(t => t.root?.uuid === root);
    ctx.expect(mine.length === 1, `une seule ligne pour l'acteur de test (${mine.map(t => t.text).join(" | ") || "aucune"})`);
    ctx.expect(/DAS DDB renamed/.test(mine[0]?.text ?? ""), `la copie DDB aux ids changés est signalée : ${mine[0]?.text ?? "—"}`);
    ctx.expect((mine[0]?.text ?? "").includes(PACK), `la ligne renvoie à l'objet officiel (${PACK})`);
    ctx.expect(!mine.some(t => /DAS DDB intact|DAS not DDB/.test(t.text)), "ni la copie DDB intacte, ni la copie sans marque DDB");
    ctx.expect(mine[0]?.fixable === true, "la copie DDB aux ids changés est réparable");
    const after = JSON.stringify((await ctx.call("get-actor", { actorId })).items?.map(i => [i.name, i.flags, Object.keys(i.system?.activities ?? {})]));
    ctx.expect(after === before, "l'analyse n'a rien écrit");

    // La réparation : l'objet officiel à la place, même id, flags DDB gardés ; avec le verrou, `ignoreItemImport` et le nom DDB
    // (pas de `definitionId` sur la copie de test : DDB Importer ne l'apparierait plus que par son nom).
    const packBefore = (await ctx.call("list-compendiums", {}).catch(() => [])) ?? [];
    const hadPack = JSON.stringify(packBefore).includes("world.das-backups");
    const backups = [];
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors: [] }));
    const officialIds = Object.keys(activities).sort().join(",");
    const itemsOf = async () => (await ctx.call("get-actor", { actorId })).items ?? [];
    const renamedId = (await itemsOf()).find(i => i.name === "DAS DDB renamed")?._id;
    for ( const lock of [false, true] ) {
      if ( lock ) {
        // Remettre la copie DDB aux ids changés, sous le même id, pour le second passage.
        await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: renamedId });
        await ctx.engine("restoreItem", { actorId, itemData: { ...items[0], _id: renamedId } });
      }
      const repaired = await api("diagnosticRepair", { checks: ["ddb"], roots: [root], options: { ddb: { lock } } });
      if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
      ctx.expect(repaired.results?.length === 1 && repaired.results[0].ok, `${lock ? "avec" : "sans"} verrou : une réparation réussie (${repaired.results?.map(r => r.line).join(" | ")})`);
      const item = (await itemsOf()).find(i => i._id === renamedId);
      ctx.expect(!!item, `${lock ? "avec" : "sans"} verrou : l'objet garde son id`);
      ctx.expect(Object.keys(item?.system?.activities ?? {}).sort().join(",") === officialIds, `${lock ? "avec" : "sans"} verrou : ids d'activités du Manuel`);
      ctx.expect(item?.flags?.ddbimporter?.id === 123456, `${lock ? "avec" : "sans"} verrou : flags de DDB Importer gardés`);
      ctx.expect(!!item?.flags?.ddbimporter?.ignoreItemImport === lock, `${lock ? "avec" : "sans"} verrou : ignoreItemImport ${lock ? "posé" : "absent"}`);
      if ( lock ) ctx.expect(item?.name === "DAS DDB renamed", `avec verrou : nom DDB gardé (${item?.name})`);
      else ctx.expect(item?.name === ref.data.name, `sans verrou : nom de l'objet officiel (${item?.name})`);
      const rescan = await api("diagnosticScan", { checks: ["ddb"] });
      ctx.expect(!(rescan.ddb ?? []).some(t => t.root?.uuid === root), `${lock ? "avec" : "sans"} verrou : plus rien de signalé pour l'acteur de test`);
    }
  }
};
