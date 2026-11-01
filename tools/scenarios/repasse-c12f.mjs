/**
 * §310, sous-lot C12-f de la repasse terme par terme : dégâts, soins, PV. Arène des sorts (Lanceur, Allié, Cible, Ennemi au contact, Héros).
 * Chaque partie prête ses items depuis le Manuel des joueurs et remet tout.
 *  - Défenses envoûtantes : l'Ennemi au contact touche le Lanceur ; la réaction (prise d'office) fait sauvegarder l'Ennemi ; ratée, il
 *    subit autant de dégâts psychiques que le Lanceur en a subi ;
 *  - Désintégration : le Héros (un personnage) à 5 PV, sauvegarde ratée — Mort, pas Inconscient ;
 *  - Toucher du médecin : la Main guérisseuse sur l'Allié Empoisonné lui retire l'état ;
 *  - Modification de mémoire : la Cible sous « Memory Modification » subit des dégâts — l'effet tombe.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c12f — Défenses envoûtantes, Désintégration, Toucher du médecin, Modification de mémoire (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié", "Cible", "Ennemi au contact", "Héros"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally, target, enemy, hero] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, ally, target, enemy, hero];
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });

    const lent = [];
    const lend = async (t, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([t, r.id]);
      return r.id;
    };
    const reset = async () => {
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
      for ( const t of all ) {
        for ( const e of await ctx.effects(t) ) {
          await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
        }
        for ( const s of ["dead", "unconscious", "prone", "poisoned"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        const h = homes.get(t.id);
        await ctx.setHp(t, t === hero ? h.hp : 999).catch(() => {});
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: 0 }).catch(() => {});
      }
      await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.attributes.death.success": 0, "system.attributes.death.failure": 0, "flags.dnd5e-combat.-=retort": null } }).catch(() => {});
      await ctx.call("update-actor", { actorId: caster.actorId, actorData: { "flags.dnd5e-combat.-=retort": null } }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const cast = async params => {
      const used = await ctx.use(params);
      await pause(1500);
      if ( used.usageMessageId ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null);
      return used.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
    };
    const statuses = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? [];

    await part("Défenses envoûtantes", async () => {
      const defenses = await lend(caster, `${PHB}.classes.Item.phbwlkBeguilingD`, { "system.uses.spent": 0 });
      const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      let done = false;
      for ( let n = 0; (n < 15) && !done; n++ ) {
        await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: defenses } });
        await ctx.setHp(caster, 999); await ctx.setHp(enemy, 999);
        await pause(600);
        const u = await ctx.use({ tokenId: enemy.id, itemId: club, activityType: "attack", targetTokenIds: [caster.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(2500);
        if ( !r?.targets?.find(t => t.name === "Lanceur")?.hit ) continue;
        const lost = 999 - await ctx.hp(caster);
        const back = 999 - await ctx.hp(enemy);
        ctx.log(`essai ${n + 1} : le Lanceur perd ${lost} PV, l'Ennemi ${back}`);
        if ( back > 0 ) {
          done = true;
          ctx.expect(back === lost, `sauvegarde ratée : l'Ennemi subit autant que le Lanceur (${back} = ${lost})`);
        }
      }
      ctx.expect(done, "un coup suivi d'une sauvegarde ratée (15 essais)");
    });

    await part("Désintégration", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplDisintegra`, { "system.method": "atwill" });
      let dead = false;
      for ( let n = 0; (n < 10) && !dead; n++ ) {
        for ( const s of ["dead", "unconscious", "prone"] ) await ctx.call("set-status", { tokenId: hero.id, statusId: s, active: false }).catch(() => {});
        await ctx.setHp(hero, 5);
        await pause(800);
        const r = await cast({ tokenId: caster.id, itemId: spell, targetTokenIds: [hero.id], consume: false });
        await pause(2500);
        const saved = r?.targets?.find(t => t.name === "Héros")?.save?.success;
        const st = await statuses(hero);
        ctx.log(`essai ${n + 1} : sauvegarde ${saved ? "réussie" : "ratée"}, ${await ctx.hp(hero)} PV, ${st.join(", ") || "aucun état"}`);
        if ( saved === false ) {
          dead = st.includes("dead");
          ctx.expect(dead, `réduit à 0 PV par le sort : Mort (${st.join(", ")})`);
          break;
        }
      }
    });

    await part("Toucher du médecin", async () => {
      const touch = await lend(caster, `${PHB}.classes.Item.phbmnkPhysicians`);
      await ctx.setHp(ally, 10);
      await ctx.call("set-status", { tokenId: ally.id, statusId: "poisoned", active: true });
      await pause(1000);
      await cast({ tokenId: caster.id, itemId: touch, activityId: "stWL2fvcxsh0HFw2", targetTokenIds: [ally.id], consume: false });
      await pause(2500);
      ctx.expect(!(await statuses(ally)).includes("poisoned"), `l'Allié n'est plus Empoisonné (${(await statuses(ally)).join(", ") || "aucun état"})`);
    });

    await part("Modification de mémoire", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbsplModifyMemo`, { "system.method": "atwill" });
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: spell, effectId: "ayfixWGhTtaIUusk" });
      await pause(1200);
      ctx.expect((await ctx.effectsFrom(target, "modify-memory")).length === 1, "la Cible est sous « Memory Modification »");
      await ctx.engine("hurt", { tokenId: target.id, amount: 3 });
      await pause(2500);
      ctx.expect((await ctx.effectsFrom(target, "modify-memory")).length === 0, "blessée, l'effet tombe");
    });
  }
};
