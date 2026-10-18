/**
 * §202 : le diagnostic du monde rétablit l'enchantement perdu d'un objet du Guide du maître (Projectile percutant), sur un acteur
 * créé pour le test : l'objet, sans effet, est trouvé par « Objets aux effets perdus » ; réparé (sauvegarde d'abord), il est remplacé
 * par une copie neuve du compendium qui garde son nom et porte l'enchantement — au nom de l'objet traduit, jamais au nom anglais
 * quand l'objet est traduit (core/localize.mjs).
 * Remet tout : acteur, entrées de sauvegarde, et le compendium s'il n'existait pas avant.
 */
const MODULE_ID = "dnd5e-combat";
const WALLOPING = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgWallopingAmmu";

export default {
  name: "diagnostic — enchantement perdu rétabli, au nom de l'objet traduit",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const index = await ctx.call("list-compendium-entries", { packId: "dnd-dungeon-masters-guide.equipment", search: "Walloping" }).catch(() => []);
    const uuid = (Array.isArray(index) ? index : []).find(e => /Walloping|percutant/i.test(e.name))?.uuid ?? WALLOPING;
    const ref = await ctx.call("get-compendium-entry", { uuid }).catch(() => null);
    if ( !ref?.data?.effects?.length ) { ctx.log(`Projectile percutant introuvable (${uuid}) : non applicable`); return; }
    const packBefore = (await ctx.call("list-compendiums", {}).catch(() => [])) ?? [];
    const hadPack = JSON.stringify(packBefore).includes("world.das-backups");
    const backups = [];
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));

    const { _id, folder, ownership, _stats, effects, ...itemData } = ref.data;
    itemData._stats = { compendiumSource: uuid };
    const created = await ctx.call("create-actor", { actorData: {
      name: "DAS diagnostic effets (test)", type: "npc", flags: { [MODULE_ID]: { scenario: "diagnostic-effets" } }, items: [{ ...itemData, effects: [] }]
    } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur de test créé, avec le Projectile percutant sans enchantement") ) return;
    const root = `Actor.${actorId}`;

    const scan = await api("diagnosticScan", { checks: ["item-effects"] });
    const task = (scan["item-effects"] ?? []).find(t => t.root?.uuid === root);
    ctx.expect(!!task?.fixable, `analyse : l'objet sans effet est trouvé (${task?.text ?? "rien"})`);

    const repaired = await api("diagnosticRepair", { checks: ["item-effects"], roots: [root] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    ctx.expect(repaired.results.length === 1 && repaired.results[0].ok, `réparation : ${repaired.results.map(r => r.line).join(" | ") || "aucune"}`);
    const after = await ctx.call("get-actor", { actorId });
    const item = (after.items ?? []).find(i => i.system?.identifier === itemData.system?.identifier);
    const names = (item?.effects ?? []).map(e => e.name);
    ctx.expect(!!item && (item.name === itemData.name), `l'objet garde son nom (${item?.name ?? "absent"})`);
    ctx.expect(names.length === ref.data.effects.length, `l'enchantement est rétabli (${names.join(", ") || "aucun"})`);
    const original = ref.data.flags?.babele?.originalName ?? null;
    if ( original && (original !== itemData.name) ) {
      ctx.expect(!names.includes(original), `pas de nom anglais d'origine (« ${original} ») sur les effets : ${names.join(", ")}`);
    }
  }
};
