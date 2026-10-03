/**
 * Potions du Guide du maître (SPEC §53), bues pour de vrai (consommées, donc détruites) par le Guerrier, sans cible désignée.
 * `ONLY=speed,growth` ne joue que les parties dont le nom contient l'un de ces mots. Remet tout.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const DMG = "Compendium.dnd-dungeon-masters-guide.equipment";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "potions du Guide du maître — bues et consommées",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Guerrier", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Guerrier et Zombi requis : non applicable"); return; }
    const packs = JSON.stringify(await ctx.call("list-compendiums", {}).catch(() => null) ?? "");
    if ( !packs.includes("dnd-dungeon-masters-guide.equipment") ) { ctx.log("Guide du maître absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const g = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const actorId = (await ctx.call("get-scene-object", { type: "Token", objectId: g.id })).data.actorId;
    const actor = () => ctx.call("get-actor", { actorId });
    const a0 = await actor();
    const hp0 = a0.system.attributes.hp.value;
    const baseEffects = new Set((a0.effects ?? []).map(e => e._id));
    const baseItems = new Set((a0.items ?? []).map(i => i._id));
    const newEffects = async () => ((await actor()).effects ?? []).filter(e => !baseEffects.has(e._id) && !(e.statuses ?? []).includes("bloodied") && !/^Aura/.test(e.name ?? ""));
    const reset = async () => {
      const a = await actor();
      for ( const e of a.effects ?? [] ) if ( !baseEffects.has(e._id) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => {});
      await pause(800);   // une suite d'effet (léthargie) aurait le temps de naître
      const b = await actor();
      for ( const i of b.items ?? [] ) if ( !baseItems.has(i._id) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: i._id }).catch(() => {});
      await ctx.call("update-actor", { actorId, actorData: { "system.attributes.hp.value": hp0, "system.attributes.hp.temp": 0, "system.attributes.exhaustion": 0 } });
    };
    ctx.restore(reset);
    const only = (process.env.ONLY ?? "").split(",").map(s => s.trim()).filter(Boolean);
    const part = async (name, fn) => {
      if ( only.length && !only.some(o => name.toLowerCase().includes(o)) ) return;
      await reset();
      await pause(500);
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
    };
    /** Boit la potion `id` du Guide (activité `type`) : prêtée, consommée. Rend l'id de l'item prêté. */
    const drink = async (id, type="utility") => {
      const { data } = await ctx.call("get-compendium-entry", { uuid: `${DMG}.${id}` });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      const r = await ctx.call("upsert-embedded-item", { documentType: "Actor", id: actorId, itemData, match: { path: "name", value: data.name } });
      const used = await ctx.use({ tokenId: g.id, itemId: r.itemId, activityType: type, targetTokenIds: [], consume: true });
      await pause(1200);
      if ( ["heal", "save", "damage"].includes(type) ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null);
      await ctx.settle(used.usageMessageId, { timeoutMs: 20000 }).catch(() => null);
      await pause(2500);
      return r.itemId;
    };
    const names = async () => (await newEffects()).map(e => e.name);
    const has = async status => (await newEffects()).some(e => (e.statuses ?? []).includes(status));

    await part("invisibilité", async () => {
      await drink("dmgPotionOfInvis");
      ctx.expect(await has("invisible"), `Potion d'invisibilité : Invisible (${(await names()).join(", ")})`);
      if ( process.env.DETAIL ) ctx.log(JSON.stringify((await ctx.engine("effectOrigins", { tokenId: g.id })).filter(e => /invis/i.test(e.effect))));
      const sword = (await actor()).items.find(i => i.type === "weapon" && Object.values(i.system.activities ?? {}).some(x => x.type === "attack"));
      await ctx.use({ tokenId: g.id, itemId: sword._id, activityType: "attack", targetTokenIds: [zombi.id], rollAttack: true });
      await pause(3000);
      ctx.expect(!(await has("invisible")), "elle cesse à la première attaque");
    });

    await part("invisibilité supérieure", async () => {
      await drink("dmgPotionOfGreat");
      const sword = (await actor()).items.find(i => i.type === "weapon" && Object.values(i.system.activities ?? {}).some(x => x.type === "attack"));
      await ctx.use({ tokenId: g.id, itemId: sword._id, activityType: "attack", targetTokenIds: [zombi.id], rollAttack: true });
      await pause(3000);
      ctx.expect(await has("invisible"), "Invisibilité supérieure : elle reste après une attaque");
    });

    await part("rapidité", async () => {
      await drink("dmgPotionOfSpeed", "cast");
      const fx = await names();
      ctx.expect(fx.some(n => /h[aâ]t/i.test(n)) && !(await has("concentrating")), `Potion de rapidité : Hâte, sans concentration (${fx.join(", ")})`);
      for ( const e of await newEffects() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => {});
      await pause(3000);
      ctx.expect(!(await has("incapacitated")), `fin de l'effet : pas de léthargie (${(await names()).join(", ") || "rien"})`);
    });

    await part("croissance", async () => {
      await drink("dmgPotionOfGrowt", "cast");
      const fx = await names();
      ctx.expect((fx.length === 1) && !(await has("concentrating")), `Potion de croissance : un seul effet, sans concentration (${fx.join(", ")})`);
      ctx.log(`taille : ${(await ctx.engine("stats", { tokenId: g.id }))?.size}`);
    });

    await part("rapetissement", async () => {
      await drink("dmgPotionOfDimin", "cast");
      const fx = await names();
      ctx.expect((fx.length === 1) && !(await has("concentrating")), `Potion de rapetissement : un seul effet, sans concentration (${fx.join(", ")})`);
      ctx.log(`taille : ${(await ctx.engine("stats", { tokenId: g.id }))?.size}`);
    });

    await part("résistance", async () => {
      await drink("dmgPotionOfResis");
      const fx = await names();
      ctx.expect(fx.length === 1, `Potion de résistance : une seule résistance (${fx.join(", ")})`);
    });

    await part("force de géant", async () => {
      await drink("dmgHillPotionOfG");
      const str = (await ctx.engine("stats", { tokenId: g.id }))?.mods?.str;
      ctx.expect(str === 5, `Force des collines : modificateur de Force ${str} (+5, Force 21)`);
    });

    await part("poison", async () => {
      const before = (await actor()).system.attributes.hp.value;
      await drink("dmgPotionOfPoiso", "save");
      const after = (await actor()).system.attributes.hp.value;
      ctx.expect(after < before, `Potion de poison : le buveur subit ${before - after} dégâts de poison`);
    });

    await part("vitalité", async () => {
      await ctx.call("update-actor", { actorId, actorData: { "system.attributes.exhaustion": 2 } });
      await ctx.call("set-status", { tokenId: g.id, status: "poisoned", active: true });
      await pause(1000);
      await drink("dmgPotionOfVital");
      const a = await actor();
      ctx.expect((a.system.attributes.exhaustion === 0) && !(await has("poisoned")) && !(a.statuses ?? []).includes("poisoned"),
        `Potion de vitalité : Épuisement ${a.system.attributes.exhaustion}, Empoisonné retiré`);
    });

    await part("héroïsme", async () => {
      await drink("dmgPotionOfHeroi", "heal");
      const a = await actor();
      const fx = await names();
      ctx.expect(((a.system.attributes.hp.temp ?? 0) === 10) && fx.some(n => /bless|béni/i.test(n)),
        `Potion d'héroïsme : 10 PV temporaires (${a.system.attributes.hp.temp}) et la Bénédiction (${fx.join(", ")})`);
    });

    await part("vol", async () => {
      const walk = (await ctx.engine("stats", { tokenId: g.id }))?.speed?.walk;
      await drink("dmgPotionOfFlyin");
      const speed = (await ctx.engine("stats", { tokenId: g.id }))?.speed ?? {};
      ctx.expect((speed.fly === walk) && (walk > 0), `Potion de vol : vitesse de vol ${speed.fly} = vitesse au sol ${walk}`);
    });

    await part("escalade", async () => {
      const walk = (await ctx.engine("stats", { tokenId: g.id }))?.speed?.walk;
      await drink("dmgPotionOfClimb");
      const speed = (await ctx.engine("stats", { tokenId: g.id }))?.speed ?? {};
      ctx.expect((speed.climb === walk) && (walk > 0), `Potion d'escalade : vitesse d'escalade ${speed.climb} = vitesse au sol ${walk}`);
    });

    await part("élixir", async () => {
      for ( const s of ["blinded", "poisoned"] ) await ctx.call("set-status", { tokenId: g.id, status: s, active: true });
      await pause(1000);
      await drink("dmgElixirOfHealt");
      const st = (await actor()).statuses ?? [];
      ctx.expect(!st.includes("blinded") && !st.includes("poisoned"), `Élixir de santé : Aveuglé et Empoisonné retirés (états : ${st.join(", ")})`);
    });

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
