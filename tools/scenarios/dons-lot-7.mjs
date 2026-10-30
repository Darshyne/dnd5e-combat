/**
 * §289 : chantiers du 2026-10-30, lot 7 (dons), monde `dnd-6`, Arène de test. Le Paladin reçoit les dons sombres de Ravenloft et la
 * Faveur de vigueur ; leurs effets sont posés comme la sauvegarde ratée les poserait (`api.mcp.placeItemEffect`). Vérifie :
 *  - Anatomie aberrante : Étourdi jusqu'à la FIN de son prochain tour (la donnée l'arrêtait au début) ;
 *  - Murmures recueillis : Voix d'outre-tombe donne aussi le Désavantage aux jets d'attaque ;
 *  - Ombre vivante : Neutralisé jusqu'au début de son prochain tour, puis la table « Volonté de l'ombre » est tirée ;
 *  - Seconde peau : le catalyseur déclaré par le MJ, la sauvegarde de Charisme au début de son tour suivant ; ratée, forme alternative
 *    déjà dépensée : Étourdi jusqu'au début du tour d'après ;
 *  - Faveur de vigueur : le bonus de Constitution une fois jusqu'au début de son prochain tour, pas à chaque tour d'un autre.
 * Remet effets, combat, utilisations ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const RAVENLOFT = "Compendium.dnd-ravenloft-horrors-within.options.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "dons lot 7 — fins des dons sombres de Ravenloft, Seconde peau, Faveur de vigueur",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Paladin", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-ravenloft-horrors-within.options") ) { ctx.log("Ravenloft absent : non applicable"); return; }
    const pal = await ctx.token("Paladin");
    const zombi = await ctx.token("Zombi");
    const sceneId = (await ctx.scene()).sceneId;
    const effects0 = new Set((await ctx.effects(pal)).map(e => e._id ?? e.id));
    const palTarget = { documentType: "Actor", id: pal.actorId };
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: pal.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const ids = {
      aberrant: await lend(`${RAVENLOFT}rhwAberrantAnato`),
      whispers: await lend(`${RAVENLOFT}rhwGatheredWhisp`),
      shadow: await lend(`${RAVENLOFT}rhwLivingShadow2`),
      skin: await lend(`${RAVENLOFT}rhwSecondSkinkc1`),
      fortitude: await lend("Compendium.dnd-players-handbook.feats.Item.phbBoonofFortitu")
    };
    const sword = await ctx.itemId(pal.id, "longsword");
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const e of (await ctx.effects(pal)).filter(e => !effects0.has(e._id ?? e.id) && !e.flags?.[MODULE_ID]?.aura && !e.transfer) ) {
        await ctx.call("remove-embedded-effect", { ...palTarget, effectId: e._id ?? e.id }).catch(() => {});
      }
      await ctx.call("update-actor", { actorId: pal.actorId, actorData: { [`flags.${MODULE_ID}.-=catalyst`]: null, [`flags.${MODULE_ID}.-=fortifiedHealing`]: null } }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await reset(); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** Combat Paladin (20) / Zombi (10), au tour du Paladin. */
    const fight = async () => {
      await ctx.startCombat([pal, zombi]);
      const c = await ctx.combat();
      for ( const [t, value] of [[pal, 20], [zombi, 10]] ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
      const now = await ctx.combat();
      if ( (now.combatants ?? []).find(x => x.isCurrent || x.current)?.name !== pal.name ) await ctx.nextTurn();
      await pause(800);
    };
    const next = async () => { await ctx.nextTurn(); await pause(2000); };
    const place = (key, effectId) => ctx.engine("placeItemEffect", { tokenId: pal.id, casterId: pal.id, itemId: ids[key], effectId });
    const has = async (re) => (await ctx.effects(pal)).some(e => re.test(e.name ?? ""));

    await part("Anatomie aberrante", async () => {
      await fight();
      await place("aberrant", "ON3Q0GCwGVqeS0WV");
      await pause(800);
      const STUN = /Warping Flesh|Chair déformante/i;
      ctx.expect(await has(STUN), "Étourdi posé (au tour du Paladin)");
      await next();   // fin du tour du Paladin (celui de la pose), tour du Zombi
      ctx.expect(await has(STUN), "la fin du tour de la pose ne compte pas");
      await next();   // round 2, tour du Paladin : la donnée le faisait tomber ici
      ctx.expect(await has(STUN), "au début de son tour suivant, toujours Étourdi");
      await next();   // fin de ce tour
      ctx.expect(!(await has(STUN)), "à la fin de son tour suivant, l'effet tombe");
    });

    await part("Murmures recueillis", async () => {
      const base = await ctx.engine("attackReasons", { attackerId: pal.id, targetId: zombi.id, itemId: sword });
      await place("whispers", "T67RGbFPYgYo6Ics");
      await pause(800);
      const r = await ctx.engine("attackReasons", { attackerId: pal.id, targetId: zombi.id, itemId: sword });
      ctx.expect(r.disadvantage.length === base.disadvantage.length + 1, `Voix d'outre-tombe : Désavantage aux jets d'attaque (${JSON.stringify(r.disadvantage)})`);
    });

    await part("Ombre vivante", async () => {
      await fight();
      await place("shadow", "MmYLSlBTwu1FC8UR");
      await pause(800);
      const WILL = /Ominous Will|Volonté funeste/i;
      ctx.expect(await has(WILL), "Neutralisé posé");
      await next();   // tour du Zombi
      ctx.expect(await has(WILL), "toujours Neutralisé pendant le tour du Zombi");
      const since = await ctx.lastMessageId();
      await next();   // round 2, tour du Paladin
      ctx.expect(!(await has(WILL)), "au début de son tour, l'effet tombe");
      let drawn = null;
      for ( const stop = Date.now() + 10000; !drawn && (Date.now() < stop); await pause(700) ) {
        drawn = (await ctx.messagesSince(since)).find(m => /Shadow|Volonté|ombre/i.test(`${m.flavor ?? ""} ${m.text ?? ""}`));
      }
      ctx.expect(!!drawn, `la table « Volonté de l'ombre » est tirée (« ${(drawn?.text ?? drawn?.flavor ?? "").slice(0, 80)} »)`);
    });

    await part("Seconde peau", async () => {
      // Forme alternative déjà dépensée, et la sauvegarde de Charisme ratée à coup sûr (essai).
      await ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData: { "system.uses.spent": 1 }, match: { path: "_id", value: ids.skin } });
      await ctx.call("upsert-embedded-effect", { ...palTarget, effectData: { name: "Essai : âme vacillante", img: "icons/svg/daze.svg", transfer: false,
        changes: [{ key: "system.abilities.cha.bonuses.save", value: "-40", type: "add" }] } });
      await fight();
      const armed = await ctx.engine("catalyst", { tokenId: pal.id });
      ctx.expect(armed?.armed === true, `en combat, le catalyseur est noté (${JSON.stringify(armed)})`);
      await next();   // tour du Zombi
      const since = await ctx.lastMessageId();
      await next();   // round 2, tour du Paladin : la sauvegarde
      let card = null;
      for ( const stop = Date.now() + 20000; !card && (Date.now() < stop); await pause(700) ) card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.catalyst);
      const c = card?.flags?.[MODULE_ID]?.catalyst;
      ctx.expect(c?.success === false && c?.outcome === "stunned", `au début de son tour, la sauvegarde ratée, forme dépensée : Étourdi (${JSON.stringify(c ?? null)})`);
      const STUN = /Involuntary Change|Changement involontaire/i;
      ctx.expect(await has(STUN), "l'effet Étourdi de l'item est posé");
      await next(); await next();   // tour du Zombi, puis round 3 : son tour suivant commence
      ctx.expect(!(await has(STUN)), "au début de son tour suivant, il n'est plus Étourdi");
    });

    await part("Faveur de vigueur", async () => {
      await fight();
      const first = await ctx.engine("fortified", { tokenId: pal.id });
      if ( !(first.con > 0) ) { ctx.log(`modificateur de Constitution ${first.con} : rien à vérifier`); return; }
      ctx.expect(first.extra === first.con, `premier soin de son tour : +${first.extra}`);
      ctx.expect((await ctx.engine("fortified", { tokenId: pal.id })).extra === 0, "second soin du même tour : rien");
      await next();   // tour du Zombi : l'ancienne règle (une fois par tour de combat) le rendait ici
      ctx.expect((await ctx.engine("fortified", { tokenId: pal.id })).extra === 0, "pendant le tour du Zombi : toujours rien");
      await next();   // son tour suivant
      ctx.expect((await ctx.engine("fortified", { tokenId: pal.id })).extra === first.con, "au début de son tour suivant : de nouveau");
    });
  }
};
