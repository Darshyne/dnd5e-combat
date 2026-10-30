/**
 * §284 : chantiers du 2026-10-30, lot 2 (effets vides dans la donnée), monde `dnd-6`, Arène de test. Le Clerc reçoit les sorts du
 * Manuel des joueurs (à volonté, rien de consommé). Vérifie :
 *  - Danse irrésistible d'Otto : sauvegarde ratée → Vitesses à 0, Désavantage aux attaques du Zombi, Avantage contre lui, Dex en
 *    Désavantage dans les changements ; sauvegarde réussie → danse courte, Vitesses à 0, aucune raison d'attaque ;
 *  - Épine mentale : sauvegarde ratée → le Zombi Invisible ou caché reste vu du Clerc, et l'Invisible ne gêne plus l'attaque du Clerc ;
 *  - Aliénation : sous son effet, un sort du Clerc a un souci de légalité, son arme non ;
 *  - Prémonition : Avantage aux attaques du porteur, Désavantage aux attaques contre lui.
 * Saut n'a rien à vérifier ici : `saut` le joue déjà (§208). Remet PV, effets, états.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = { otto: "phbsplOttosIrres", spike: "phbsplMindSpike0", befuddle: "phbsplBefuddleme", foresight: "phbsplForesight0", bolt: "phbsplFireBolt00" };
const CHARMED_DANCE = "MpToumiJ2o3S16K7";
const SHORT_DANCE = "UhFtBDEZEDpVgz9G";

export default {
  name: "sorts lot 2 — Danse d'Otto, Épine mentale, Aliénation, Prémonition (effets vides dans la donnée)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Clerc", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Clerc et Zombi requis : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const ids = {};
    for ( const [k, id] of Object.entries(SPELLS) ) ids[k] = await ctx.ensureItem(cleric, PHB + id, { system: { method: "atwill" } });
    const slam = await ctx.itemId(zombi.id, "slam");
    const zhp = await ctx.hp(zombi);
    const { data: ctok } = await ctx.call("get-scene-object", { type: "Token", objectId: cleric.id });
    const { data: ztok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const sceneId = (await ctx.scene()).sceneId;
    const zombiTarget = ztok.actorLink ? { documentType: "Actor", id: ztok.actorId }
      : { uuid: `Scene.${sceneId}.Token.${zombi.id}.Actor.${ztok.actorId}` };
    const clericTarget = { documentType: "Actor", id: ctok.actorId };
    const before = { zombi: new Set((await ctx.effects(zombi)).map(e => e._id ?? e.id)), cleric: new Set((await ctx.effects(cleric)).map(e => e._id ?? e.id)) };
    const clear = async () => {
      for ( const [tok, target, keep] of [[zombi, zombiTarget, before.zombi], [cleric, clericTarget, before.cleric]] ) {
        for ( const e of await ctx.effects(tok) ) {
          if ( !keep.has(e._id ?? e.id) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
      }
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: false }).catch(() => {});
    };
    ctx.restore(async () => { await clear(); await ctx.setHp(zombi, zhp); });

    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await clear(); await ctx.setHp(zombi, zhp); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const cast = async key => {
      const used = await ctx.use({ tokenId: cleric.id, itemId: ids[key], consume: false, targetTokenIds: [zombi.id] });
      const r = used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      return r?.targets?.find(x => x.name === "Zombi") ?? null;
    };
    const reasons = (attacker, target, itemId) => ctx.engine("attackReasons", { attackerId: attacker.id, targetId: target.id, itemId });
    /** Pose sur le Clerc l'effet d'un de ses propres sorts (origine = son item), comme un lanceur sur lui-même. */
    const selfEffect = async (key, name) => {
      const r = await ctx.call("upsert-embedded-effect", { ...clericTarget, effectData: {
        name, img: "icons/svg/aura.svg", origin: `Actor.${ctok.actorId}.Item.${ids[key]}`, transfer: false } });
      return r?.effectId ?? r?.id ?? r?.effect?._id;
    };

    await part("Danse d'Otto", async () => {
      const base = { zombi: await reasons(zombi, cleric, slam), cleric: await reasons(cleric, zombi, ids.bolt) };
      const seen = { failed: false, saved: false };
      for ( let n = 1; (n <= 15) && !(seen.failed && seen.saved); n++ ) {
        await clear();
        const t = await cast("otto");
        if ( !t?.save ) continue;
        const effects = await ctx.effects(zombi);
        const from = id => effects.find(e => !e.disabled && String(e._stats?.compendiumSource ?? e._stats?.duplicateSource ?? "").endsWith(`.ActiveEffect.${id}`));
        const speed = (await ctx.engine("stats", { tokenId: zombi.id }))?.speed ?? {};
        const still = ["walk", "fly", "swim", "climb", "burrow"].every(m => speed[m] === 0);   // `jump`, `speed`, `max` : dérivés par dnd5e
        const r = { zombi: await reasons(zombi, cleric, slam), cleric: await reasons(cleric, zombi, ids.bolt) };
        const more = (side, kind) => r[side][kind].length - base[side][kind].length;
        if ( t.save.success ) {
          if ( seen.saved ) continue;
          seen.saved = true;
          ctx.expect(!!from(SHORT_DANCE), `sauvegarde réussie (${t.save.total}) : danse courte posée`);
          ctx.expect(still, `danse courte : Vitesses à 0 (${JSON.stringify(speed)})`);
          ctx.expect(!more("zombi", "disadvantage") && !more("cleric", "advantage"), "danse courte : aucune raison d'attaque ajoutée");
        } else {
          if ( seen.failed ) continue;
          seen.failed = true;
          const dance = from(CHARMED_DANCE);
          ctx.expect(!!dance, `sauvegarde ratée (${t.save.total}) : danse sous Charmé posée`);
          ctx.expect(still, `danse : Vitesses à 0 (${JSON.stringify(speed)})`);
          ctx.expect((dance?.system?.changes ?? dance?.changes ?? []).some(c => c.key === "system.abilities.dex.save.roll.mode"),
            "danse : Désavantage aux JS de Dextérité dans les changements");
          ctx.expect(more("zombi", "disadvantage") === 1, `le Zombi attaque avec le Désavantage (${JSON.stringify(r.zombi.disadvantage)})`);
          ctx.expect(more("cleric", "advantage") === 1, `le Clerc l'attaque avec l'Avantage (${JSON.stringify(r.cleric.advantage)})`);
        }
      }
      ctx.expect(seen.failed && seen.saved, `les deux issues vues (ratée : ${seen.failed}, réussie : ${seen.saved})`);
    });

    await part("Épine mentale", async () => {
      let t = null;
      for ( let n = 1; (n <= 15) && !(t?.save && !t.save.success); n++ ) { await clear(); await ctx.setHp(zombi, zhp); t = await cast("spike"); }
      if ( !ctx.expect(t?.save?.success === false, "sauvegarde ratée obtenue") ) return;
      const unseen = r => r.disadvantage.some(k => /unseen|invisible/i.test(k));
      const sees = async () => (await ctx.engine("sees", { observerId: cleric.id, targetId: zombi.id }))?.sees === true;
      /** Invisible puis caché (Furtivité du moteur, DD 30) : ce que voit le Clerc dans chaque cas. */
      const look = async () => {
        await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: true });
        await pause(800);
        const out = { reasons: await reasons(cleric, zombi, ids.bolt), invisibleSeen: await sees() };
        await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: false });
        const r = await ctx.call("upsert-embedded-effect", { ...zombiTarget, effectData: {
          name: "Essai : caché", img: "icons/svg/cowled.svg", transfer: false, flags: { "dnd5e-combat": { hidden: { dc: 30 } } } } });
        await pause(800);
        out.hiddenSeen = await sees();
        await ctx.call("remove-embedded-effect", { ...zombiTarget, effectId: r?.effectId ?? r?.id ?? r?.effect?._id }).catch(() => {});
        return out;
      };
      const spiked = await look();
      ctx.expect(!unseen(spiked.reasons), `Zombi Invisible : pas de Désavantage pour le Clerc (${JSON.stringify(spiked.reasons.disadvantage)})`);
      ctx.expect(spiked.invisibleSeen, "Zombi Invisible : toujours vu du Clerc");
      ctx.expect(spiked.hiddenSeen, "Zombi caché : toujours vu du Clerc");
      // Sans l'Épine, l'Invisible et la Furtivité jouent de nouveau : la preuve que c'est bien elle.
      for ( const e of await ctx.effects(zombi) ) {
        if ( !before.zombi.has(e._id ?? e.id) && /Spike|Épine/i.test(e.name ?? "") ) await ctx.call("remove-embedded-effect", { ...zombiTarget, effectId: e._id ?? e.id });
      }
      const plain = await look();
      ctx.expect(unseen(plain.reasons) && !plain.invisibleSeen, `sans l'Épine, l'Invisible gêne de nouveau (${JSON.stringify(plain.reasons.disadvantage)})`);
      ctx.expect(!plain.hiddenSeen, "sans l'Épine, le Zombi caché échappe au Clerc");
    });

    await part("Aliénation", async () => {
      const blank = await ctx.engine("issues", { tokenId: cleric.id, itemId: ids.bolt });
      await selfEffect("befuddle", "Essai : Aliénation");
      await pause(500);
      const spell = await ctx.engine("issues", { tokenId: cleric.id, itemId: ids.bolt });
      ctx.expect(spell.length === blank.length + 1, `un sort a un souci de plus (${spell.join(" | ")})`);
      const mace = await ctx.itemId(cleric.id, "mace").catch(() => null);
      if ( mace ) {
        const weapon = await ctx.engine("issues", { tokenId: cleric.id, itemId: mace });
        ctx.expect(!weapon.some(l => /Magi/i.test(l)), `l'arme reste permise (${weapon.join(" | ") || "aucun souci"})`);
      }
    });

    await part("Prémonition", async () => {
      const base = { cleric: await reasons(cleric, zombi, ids.bolt), zombi: await reasons(zombi, cleric, slam) };
      await selfEffect("foresight", "Essai : Prémonition");
      await pause(500);
      const r = { cleric: await reasons(cleric, zombi, ids.bolt), zombi: await reasons(zombi, cleric, slam) };
      ctx.expect(r.cleric.advantage.length === base.cleric.advantage.length + 1, `le porteur attaque avec l'Avantage (${JSON.stringify(r.cleric.advantage)})`);
      ctx.expect(r.zombi.disadvantage.length === base.zombi.disadvantage.length + 1, `le Zombi l'attaque avec le Désavantage (${JSON.stringify(r.zombi.disadvantage)})`);
    });
  }
};
