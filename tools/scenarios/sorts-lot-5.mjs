/**
 * §287 : chantiers du 2026-10-30, lot 5 (lumières), monde `dnd-6`, Arène de test. Le Clerc reçoit les sorts du Manuel des joueurs (à
 * volonté, rien de consommé). Vérifie :
 *  - Rayon de soleil : l'« Initial Cast » fait briller le Clerc (9 m vive, 18 m en tout), l'effet lumineux dépend de sa concentration
 *    et part avec elle ;
 *  - Ténèbres : posées sur le Zombi qui brille des Lueurs féeriques (niveau 1), elles les dissipent (effet retiré, carte « dissipe ») ;
 *    une Lumière du jour (niveau 3) recouverte reste.
 * Remet positions, effets, régions.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = { sunbeam: "phbsplSunbeam000", darkness: "phbsplDarkness00", faerie: "phbsplFaerieFire", daylight: "phbsplDaylight00" };
const OUTLINED = "Y2i0OvwOixxag0ed";

export default {
  name: "sorts lot 5 — Rayon de soleil, Ténèbres qui dissipent les lumières de sort (lumières)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Clerc", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Clerc et Zombi requis : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const ids = {};
    for ( const [k, id] of Object.entries(SPELLS) ) ids[k] = await ctx.ensureItem(cleric, PHB + id, { system: { method: "atwill" } });
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const all = [cleric, zombi];
    const effects0 = new Map();
    for ( const t of all ) effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    const regions0 = new Set(((await ctx.call("list-scene-objects", { types: ["Region"] })).objects?.Region ?? []).map(r => r.id));
    const reset = async () => {
      for ( const r of (await ctx.call("list-scene-objects", { types: ["Region"] })).objects?.Region ?? [] ) {
        if ( !regions0.has(r.id) ) await ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {});
      }
      for ( const t of all ) {
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
      }
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
    const tokenLight = t => ctx.engine("tokenLight", { tokenId: t.id });
    const centerOf = async t => { const p = await ctx.position(t); return { x: p.x + (grid / 2), y: p.y + (grid / 2) }; };

    await part("Rayon de soleil", async () => {
      const z = await centerOf(zombi);
      const c = await centerOf(cleric);
      await ctx.use({ tokenId: cleric.id, itemId: ids.sunbeam, activityId: "o3kffaumfNGjVvg9", consume: false,
        area: { shape: "rectangle", x: Math.min(c.x, z.x), y: c.y - (grid / 2), width: Math.abs(z.x - c.x) || grid, height: grid } });
      await pause(1500);
      const effects = await ctx.effects(cleric);
      const shine = effects.find(e => e.flags?.["dnd5e-combat"]?.lightOf);
      if ( !ctx.expect(!!shine, `le Clerc brille (${effects.map(e => e.name).join(", ")})`) ) return;
      const light = await tokenLight(cleric);
      ctx.expect((light.bright >= 30) && (light.dim >= 60), `lumière du token : ${light.bright}/${light.dim}`);
      const conc = effects.find(e => (e.statuses ?? []).includes("concentrating"));
      const deps = conc?.flags?.dnd5e?.dependents ?? [];
      ctx.expect(deps.some(d => String(d.uuid).endsWith(shine._id ?? shine.id)), `l'effet lumineux dépend de la concentration (${JSON.stringify(deps)})`);
      if ( conc ) await ctx.call("remove-embedded-effect", { ...(await targetOf(cleric)), effectId: conc._id ?? conc.id });
      await pause(1200);
      ctx.expect(!(await ctx.effects(cleric)).some(e => e.flags?.["dnd5e-combat"]?.lightOf), "la concentration finie, il ne brille plus");
    });

    await part("Ténèbres", async () => {
      await ctx.engine("placeItemEffect", { tokenId: zombi.id, casterId: cleric.id, itemId: ids.faerie, effectId: OUTLINED });
      await pause(1000);
      const lit = await tokenLight(zombi);
      if ( !ctx.expect((lit.dim ?? 0) > 0, `le Zombi brille des Lueurs féeriques (${lit.bright}/${lit.dim})`) ) return;
      const z = await centerOf(zombi);
      // Lumière du jour (niveau 3) sur le Zombi d'abord : rien à dissiper encore.
      await ctx.use({ tokenId: cleric.id, itemId: ids.daylight, consume: false, area: { shape: "circle", x: z.x, y: z.y, radius: 12 * grid } });
      await pause(1500);
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: cleric.id, itemId: ids.darkness, consume: false, area: { shape: "circle", x: z.x, y: z.y, radius: 3 * grid } });
      let card = null;
      for ( const until = Date.now() + 10000; !card && (Date.now() < until); ) {
        await pause(700);
        card = (await ctx.messagesSince(since)).find(m => m.flags?.["dnd5e-combat"]?.lightDispelled);
      }
      ctx.expect(!!card, `une carte dit la dissipation (${JSON.stringify(card?.flags?.["dnd5e-combat"]?.lightDispelled?.items ?? null)})`);
      const faerie = (await ctx.effects(zombi)).some(e => String(e._stats?.compendiumSource ?? e._stats?.duplicateSource ?? "").endsWith(OUTLINED) || /Outlined|Nimb|Silhouet/i.test(e.name ?? ""));
      ctx.expect(!faerie, "les Lueurs féeriques ont quitté le Zombi");
      const after = await tokenLight(zombi);
      ctx.expect(!(after.dim > 0), `il ne brille plus (${after.bright}/${after.dim})`);
      const regions = (await ctx.call("list-scene-objects", { types: ["Region"] })).objects?.Region ?? [];
      ctx.expect(regions.filter(r => !regions0.has(r.id)).length === 2, `la Lumière du jour (niveau 3) reste, à côté des Ténèbres (${regions.filter(r => !regions0.has(r.id)).map(r => r.name).join(", ")})`);
    });
  }
};
