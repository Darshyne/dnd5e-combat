/**
 * §245 (issue #21) : la vérification « D&D Beyond » du diagnostic, en lecture seule, sur un acteur créé pour le test.
 *  - Une Armure d'Agathys du Manuel, marquée importée de DDB (`flags.ddbimporter`) et dont les activités ont reçu d'autres ids : la
 *    règle du moteur cite l'activité de riposte du Manuel, absente de la copie → signalée, avec le pack de l'objet officiel.
 *  - La même, marquée DDB mais avec les ids du Manuel : rien à signaler.
 *  - La copie aux ids changés, sans marque DDB : pas l'affaire de cette vérification.
 *  L'analyse n'écrit rien.
 */
const MODULE_ID = "dnd5e-combat";
const PACK = "dnd-players-handbook.spells";

export default {
  name: "diagnostic-ddb — objet DDB aux ids d'activité changés signalé, en lecture seule",

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
    ctx.expect(!mine.some(t => t.fixable), "lecture seule : rien de réparable");
    const after = JSON.stringify((await ctx.call("get-actor", { actorId })).items?.map(i => [i.name, i.flags, Object.keys(i.system?.activities ?? {})]));
    ctx.expect(after === before, "l'analyse n'a rien écrit");
  }
};
