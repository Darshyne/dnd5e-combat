/**
 * §328, lot K7 de la repasse des créatures : ce qu'une capacité de monstre inflige tour après tour, les soins qu'elle bloque, l'absorption
 * d'un type de dégâts (`monsterRecurring`). Arène des sorts : le Lanceur (PNJ) et l'« Ennemi au contact ».
 *  - Spores du Vrock : l'Ennemi Empoisonné subit les dégâts de l'activité « Damage While Poisoned » au début de son tour ;
 *  - Poing putréfié de la Momie : l'Ennemi maudit ne regagne pas de PV ;
 *  - Absorption de l'acide du Golem d'argile (prêtée au Lanceur) : l'acide le soigne au lieu de le blesser.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.Actor";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k7 — dégâts récurrents, soins bloqués, absorption lus dans le texte des monstres (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const casterHp = await ctx.hp(caster);
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const clear = async () => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: enemy.id });
      for ( const e of await ctx.effectsFrom(enemy, "spores", "rotting-fist") ) {
        await ctx.call("remove-embedded-effect", { uuid: `Scene.${scene}.Token.${enemy.id}.Actor.${data.actorId}`, effectId: e.id }).catch(() => {});
      }
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await clear();
      await ctx.setHp(enemy, 999).catch(() => {});
      await ctx.setHp(caster, casterHp).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });

    // Spores : Empoisonné, puis dégâts au début du tour de l'Ennemi.
    const spores = await lend(`${MM}.mmVrock000000000.Item.mmSpores00000000`);
    await ctx.startCombat([caster, enemy]);
    const s = await ctx.combat();
    const combat = s.combat ?? s.combats?.[0] ?? s;
    for ( const [t, v] of [[caster, 20], [enemy, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const current = async () => { const c = await ctx.combat(); const cc = c.combat ?? c.combats?.[0] ?? c; return cc.combatants?.find(x => x.id === cc.currentCombatantId)?.tokenId; };
    for ( let i = 0; (i < 3) && ((await current()) !== caster.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    let poisoned = false;
    for ( let i = 0; (i < 20) && !poisoned; i++ ) {
      await clear();
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: spores, activityId: "voqQeTnihpy3BTFf", activityType: "save", targetTokenIds: [enemy.id], consume: false,
        area: { shape: "rectangle", ...(await ctx.box(enemy)) } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      poisoned = (await ctx.effectsFrom(enemy, "spores")).some(e => e.statuses.includes("poisoned"));
    }
    if ( ctx.expect(poisoned, "l'Ennemi est Empoisonné par les spores (20 essais au plus)") ) {
      await ctx.setHp(enemy, 999);
      await pause(800);
      await ctx.nextTurn();
      await pause(4000);
      const hp = await ctx.hp(enemy);
      ctx.expect(hp < 999, `début de son tour, Empoisonné : il subit les dégâts des spores (999 → ${hp})`);
    }
    if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
    await clear();

    // Poing putréfié : la cible maudite ne regagne pas de PV.
    const fist = await lend(`${MM}.mmMummy000000000.Item.mmRottingFist000`);
    let cursed = false;
    for ( let i = 0; (i < 20) && !cursed; i++ ) {
      await clear();
      const u = await ctx.use({ tokenId: caster.id, itemId: fist, activityId: "8A7HEjh4kbkf9WwX", activityType: "attack", targetTokenIds: [enemy.id], rollDamage: true });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      cursed = (await ctx.effectsFrom(enemy, "rotting-fist")).length > 0;
    }
    if ( ctx.expect(cursed, "le Poing maudit l'Ennemi (20 essais au plus)") ) {
      await ctx.setHp(enemy, 900);
      await pause(600);
      const r = await ctx.engine("heal", { tokenId: enemy.id, amount: 20 });
      ctx.expect(r.after === r.before, `maudit : le soin ne rend rien (${r.before} → ${r.after})`);
    }

    // Absorption de l'acide.
    await lend(`${MM}.mmClayGolem00000.Item.mmAcidAbsorption`);
    await ctx.setHp(caster, Math.max(1, (casterHp ?? 20) - 10));
    await pause(600);
    const r = await ctx.engine("hurt", { tokenId: caster.id, amount: 6, type: "acid" });
    ctx.expect(r.after > r.before, `6 dégâts d'acide : le Lanceur regagne des PV (${r.before} → ${r.after})`);
  }
};
