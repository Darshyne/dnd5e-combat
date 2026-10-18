/**
 * §204 : un objet ou une créature créé depuis un compendium traduit, mais resté en anglais (joueur sans droit de parcourir les
 * fichiers, client dans une autre langue, traduction qui ne traduit pas les noms d'effets), prend tout de suite la traduction —
 * sans passer par le diagnostic. Réglage `autoTranslate` : actif, une créature créée en anglais avec ses objets est traduite (un
 * objet sans identifiant enregistré garde celui tiré du nom anglais) ; un objet ajouté ensuite à la fiche aussi, y compris le cas de
 * table (nom traduit, enchantement « Walloping Ammunition ») ; réglage coupé, rien ne bouge.
 */
const MODULE_ID = "dnd5e-combat";
const WALLOPING = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgWallopingAmmu";
const SKIRMISHER = "Compendium.dnd-monster-manual.actors.mmAarakocraSkirm";

export default {
  name: "traduction à la création — objets et créatures restés en anglais",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 60000 });
    const item = await ctx.call("get-compendium-entry", { uuid: WALLOPING }).catch(() => null);
    const creature = await ctx.call("get-compendium-entry", { uuid: SKIRMISHER }).catch(() => null);
    const itemOrig = item?.data?.flags?.babele?.originalPayload;
    const actorOrig = creature?.data?.flags?.babele?.originalPayload;
    if ( !itemOrig || !actorOrig ) { ctx.log("compendiums non traduits sur ce client : non applicable"); return; }
    const auto = await api("setting", { key: "autoTranslate", value: true });
    ctx.restore(() => api("setting", { key: "autoTranslate", value: auto.before }));
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: [], dropPack: false, actors }));

    const origEffect = Object.values(itemOrig.effects ?? {})[0]?.name;
    const english = () => {
      const { _id, folder, ownership, _stats, ...data } = clone(item.data);
      data.name = itemOrig.name;
      data.system.description.value = itemOrig.description;
      for ( const [id, a] of Object.entries(itemOrig.activities ?? {}) ) if ( data.system.activities?.[id] ) data.system.activities[id].name = a.name;
      for ( const e of data.effects ?? [] ) e.name = origEffect;
      data._stats = { compendiumSource: WALLOPING };
      return data;
    };
    const bare = english();
    bare.system.identifier = "";
    const create = async (name, flags, items) => {
      const created = await ctx.call("create-actor", { actorData: { name, type: "npc", prototypeToken: { name }, flags, items } });
      const id = created.id ?? created.actorId ?? created.actor?._id;
      if ( id ) actors.push(id);
      return id;
    };
    const settle = async (actorId, test) => {
      for ( let i = 0; i < 20; i++ ) {
        const a = await ctx.call("get-actor", { actorId });
        if ( test(a) ) return a;
        await new Promise(r => setTimeout(r, 300));
      }
      return ctx.call("get-actor", { actorId });
    };

    // 1. Une créature créée en anglais, avec deux objets en anglais.
    const actorId = await create(actorOrig.name, { core: { sourceId: SKIRMISHER }, [MODULE_ID]: { scenario: "traduction-creation" } }, [english(), bare]);
    if ( !ctx.expect(!!actorId, `créature créée en anglais (${actorOrig.name})`) ) return;
    const after = await settle(actorId, a => (a.name === creature.data.name) && (a.items ?? []).every(i => i.name === item.data.name));
    ctx.expect(after.name === creature.data.name, `nom de la créature traduit à la création (${after.name})`);
    const items = after.items ?? [];
    ctx.expect(items.length === 2 && items.every(i => i.name === item.data.name), `objets traduits à la création (${items.map(i => i.name).join(", ")})`);
    ctx.expect(items.every(i => (i.effects ?? []).every(e => e.name !== origEffect)), `enchantements traduits (${items.flatMap(i => (i.effects ?? []).map(e => e.name)).join(", ")})`);
    // L'objet complet garde son identifiant du compendium ; celui qui n'en avait pas reçoit celui tiré de son nom anglais.
    const ids = items.map(i => i.system?.identifier).sort();
    ctx.expect(JSON.stringify(ids) === JSON.stringify([item.data.system.identifier, "walloping-ammunition"].sort()), `identifiants gardés (${ids.join(", ")})`);

    // 2. Un objet ajouté ensuite : le cas de table, nom traduit et enchantement resté en anglais.
    const laurent = clone(item.data);
    delete laurent._id;
    // Le connecteur retire `_stats` d'un objet ajouté à une fiche : la source par l'ancien drapeau, que le moteur lit aussi.
    laurent.flags = { ...(laurent.flags ?? {}), core: { sourceId: WALLOPING } };
    for ( const e of laurent.effects ?? [] ) e.name = origEffect;
    await ctx.call("upsert-embedded-item", { documentType: "Actor", id: actorId, itemData: laurent });
    const added = await settle(actorId, a => (a.items ?? []).length === 3 && (a.items ?? []).every(i => (i.effects ?? []).every(e => e.name !== origEffect)));
    const third = (added.items ?? []).find(i => !items.some(j => j._id === i._id));
    ctx.expect(!!third && (third.effects ?? []).every(e => e.name === item.data.name), `objet ajouté : enchantement traduit (${(third?.effects ?? []).map(e => e.name).join(", ")})`);

    // 3. Réglage coupé : rien ne bouge.
    await api("setting", { key: "autoTranslate", value: false });
    const offId = await create(actorOrig.name, { core: { sourceId: SKIRMISHER }, [MODULE_ID]: { scenario: "traduction-creation" } }, [english()]);
    await new Promise(r => setTimeout(r, 2000));
    const off = await ctx.call("get-actor", { actorId: offId });
    ctx.expect((off.name === actorOrig.name) && ((off.items ?? [])[0]?.name === itemOrig.name), `réglage coupé : laissé en anglais (${off.name}, ${(off.items ?? [])[0]?.name})`);
  }
};

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}
