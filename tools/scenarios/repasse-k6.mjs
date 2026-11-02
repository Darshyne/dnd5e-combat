/**
 * §327, lot K6 de la repasse des créatures : les Réactions des monstres lues dans le texte, et les identifiants du MM qui tombaient sur
 * une règle du PHB. Arène des sorts : le Lanceur (PNJ) et l'« Ennemi au contact ».
 *  - Contre-attaque (Commandant de guerre) prêtée au Lanceur : l'Ennemi le frappe, la réaction est prise (`autoReact: "first"`) et
 *    l'effet « +4 CA » posé quand il peut faire rater le coup ;
 *  - Riposte (Capitaine pirate) : reconnue sous son identifiant propre (`mm-riposte`), plus la manœuvre du Maître de guerre ;
 *  - Souffle ralentissant (Dragon de cuivre adulte) : la cible qui rate perd ses Réactions.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const MM = "Compendium.dnd-monster-manual.actors.Actor";
const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k6 — Réactions des monstres : parade lue dans le texte, identifiants propres, Réactions perdues (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const lent = [];
    const lend = async (token, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: token.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([token.actorId, r.id]);
      return r.id;
    };
    const clearOn = async (token, ...idents) => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const target = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${token.id}.Actor.${data.actorId}` };
      for ( const e of await ctx.effectsFrom(token, ...idents) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e.id }).catch(() => {});
    };
    ctx.restore(async () => {
      await clearOn(caster, "counterattack");
      await clearOn(enemy, "slowing-breath");
      for ( const [actorId, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: id }).catch(() => {});
      await ctx.setHp(enemy, 999).catch(() => {});
    });

    // Contre-attaque : l'Ennemi frappe le Lanceur.
    await lend(caster, `${MM}.mmWarriorCommand.Item.mmCounterattack0`);
    const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
    let reacted = null;
    for ( let i = 0; (i < 20) && !reacted; i++ ) {
      await clearOn(caster, "counterattack");
      await pause(400);
      const u = await ctx.use({ tokenId: enemy.id, itemId: club, activityType: "attack", targetTokenIds: [caster.id], rollDamage: true,
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const ac = (await ctx.effectsFrom(caster, "counterattack")).length;
      if ( ac ) reacted = { hit: r?.targets?.find(t => t.name === "Lanceur")?.hit };
    }
    ctx.expect(!!reacted, "touché, le Lanceur prend sa Contre-attaque : effet « +4 CA » posé (20 essais au plus)");

    // Riposte du Capitaine pirate : son identifiant propre.
    const riposte = await lend(caster, `${MM}.mmPirateCaptain0.Item.mmRiposte0000000`);
    const id = (await ctx.engine("identify", { tokenId: caster.id })).find(r => r.id === riposte) ?? (await ctx.engine("identify", { tokenId: caster.id })).find(r => /Riposte/i.test(r.item));
    ctx.expect(id?.identifier === "mm-riposte", `Riposte du Capitaine : identifiant ${id?.identifier ?? "?"} (mm-riposte attendu)`);

    // Souffle ralentissant : la cible qui rate perd ses Réactions.
    const breath = await lend(caster, `${MM}.mmAdultCopperDra.Item.mmSlowingBreath0`);
    let failed = false;
    for ( let i = 0; (i < 20) && !failed; i++ ) {
      await clearOn(enemy, "slowing-breath");
      await pause(400);
      const u = await ctx.use({ tokenId: caster.id, itemId: breath, activityType: "save", targetTokenIds: [enemy.id], consume: false,
        area: { shape: "rectangle", ...(await ctx.box(enemy)) } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      failed = r?.targets?.find(t => t.name === enemy.name)?.save?.success === false;
    }
    if ( ctx.expect(failed, "l'Ennemi rate la sauvegarde du Souffle ralentissant (20 essais au plus)") ) {
      const stats = await ctx.engine("stats", { tokenId: enemy.id });
      ctx.expect(stats?.reactionBlocked === true, `Réactions perdues (${stats?.reactionBlocked})`);
      ctx.expect(stats?.actionOrBonus === true, `action OU action Bonus (${stats?.actionOrBonus})`);
    }
  }
};
