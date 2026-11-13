/**
 * §436 : le diagnostic « Effets magiques non marqués ». Un acteur créé d'un bloc (ses objets ne passent pas par `preCreateItem`, comme
 * une fiche d'avant la migration 6.1) porte Bénédiction du Manuel des joueurs, dont l'effet n'a pas la marque `system.magical` : l'analyse
 * le trouve, la réparation (sauvegarde d'abord) le marque, une nouvelle analyse ne trouve plus rien. Acteur et sauvegarde retirés.
 */
const MODULE_ID = "dnd5e-combat";
const BLESS = "Compendium.dnd-players-handbook.spells.Item.phbsplBless00000";

export default {
  name: "antimagie — diagnostic des effets magiques non marqués",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const actors = [];
    const backups = [];
    const hadPack = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => [])) ?? "").includes("world.das-backups");
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));
    const { data } = await ctx.call("get-compendium-entry", { uuid: BLESS });
    const { _id, folder, ownership, _stats, ...bless } = JSON.parse(JSON.stringify(data));
    for ( const e of bless.effects ?? [] ) if ( e.system ) e.system.magical = false;
    const created = await ctx.call("create-actor", { actorData: { name: "Antimagie (diagnostic)", type: "character",
      flags: { [MODULE_ID]: { scenario: "antimagie-diagnostic" } }, items: [bless] } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur créé avec Bénédiction") ) return;
    const effectOf = async () => ((await ctx.call("get-actor", { actorId })).items ?? [])[0]?.effects?.[0] ?? null;
    ctx.expect((await effectOf())?.system?.magical !== true, "l'effet de Bénédiction n'est pas marqué (fiche d'avant la migration)");

    const root = `Actor.${actorId}`;
    const scan = await api("diagnosticScan", { checks: ["magical-effects"] });
    const mine = (scan["magical-effects"] ?? []).filter(t => t.root?.uuid === root);
    ctx.expect((mine.length === 1) && mine[0].fixable, `analyse : l'effet est trouvé (${mine.map(t => t.text).join(" | ") || "rien"})`);
    const repaired = await api("diagnosticRepair", { checks: ["magical-effects"], roots: [root] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    ctx.expect(!!repaired.backup?.uuid, "une sauvegarde est faite avant la réparation");
    ctx.expect((repaired.results.length === 1) && repaired.results.every(r => r.ok), `réparation : ${repaired.results.map(r => r.line).join(" | ") || "aucune"}`);
    ctx.expect((await effectOf())?.system?.magical === true, "après réparation : l'effet est marqué magique");
    const again = await api("diagnosticScan", { checks: ["magical-effects"] });
    ctx.expect(!(again["magical-effects"] ?? []).some(t => t.root?.uuid === root), "une nouvelle analyse ne trouve plus rien");
  }
};
