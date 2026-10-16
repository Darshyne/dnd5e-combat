/**
 * Relevé des sorts, lot 5b : barrières (SPEC §163), monde `dnd-6`, arène. Sorts prêtés du Manuel des joueurs (à volonté).
 *  - Champ antimagie (le Magicien) : Flamme sacrée du Zombi sur le Magicien → non affecté ; le Magicien ne peut lancer aucun sort
 *    (souci de légalité) ;
 *  - Coquille antivie (le Clerc) : le Zombi (Mort-vivant) y entre en marchant ; le Bandit (Humanoïde), non ; le Bandit, dehors, au
 *    contact du Guerrier qui est dedans, ne peut pas le frapper au corps à corps (la fenêtre de légalité le dit).
 * Remet positions, effets, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 5b — Champ antimagie, Coquille antivie",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Clerc", "Guerrier", "Bandit", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, cleric, fighter, bandit, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, cleric, fighter, bandit, zombi];
    const grid = await ctx.gridSize();
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const reset = async () => {
      for ( const t of all ) {
        await clearNew(t);
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(1500);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const lend = (t, id) => ctx.ensureItem(t, PHB + id, { system: { method: "atwill" } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(800); };
    const weaponOf = async t => ((await ctx.call("get-actor", { actorId: t.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack" && a.attack?.type?.value === "melee"))?._id ?? null;

    await part("Champ antimagie", async () => {
      const field = await lend(mage, "phbsplAntimagicF");
      const m = await ctx.position(mage);
      await place(zombi, m.x + 4 * grid, m.y);
      const used = await ctx.use({ tokenId: mage.id, itemId: field, targetTokenIds: [mage.id], consume: false });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(2500);
      const flame = await lend(zombi, "phbsplSacredFlam");
      const hp = await ctx.hp(mage);
      const f = await ctx.use({ tokenId: zombi.id, itemId: flame, targetTokenIds: [mage.id], consume: false });
      if ( f.usageMessageId ) await ctx.settle(f.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(1500);
      const log = (await ctx.engineLog()).filter(l => /unaffected/.test(l) && /Antimagic|antimagie/i.test(l));
      ctx.expect(log.length > 0 && ((await ctx.hp(mage)) === hp), `Champ antimagie : Flamme sacrée sur le Magicien → ${log.at(-1) ?? "rien au journal"}`);
      const missile = await lend(mage, "phbsplMagicMissi");
      const issues = await ctx.engine("issues", { tokenId: mage.id, itemId: missile });
      ctx.expect(issues.some(l => /antimag|no spell can be cast|aucun sort/i.test(l)), `Champ antimagie : le Magicien ne lance rien (${issues.join(" ; ") || "aucun souci"})`);
    });

    await part("Coquille antivie", async () => {
      const shell = await lend(cleric, "phbsplAntilifeSh");
      const c = await ctx.position(cleric);
      await place(zombi, c.x - 4 * grid, c.y);
      await place(bandit, c.x, c.y - 4 * grid);
      const used = await ctx.use({ tokenId: cleric.id, itemId: shell, targetTokenIds: [cleric.id], consume: false });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(2500);
      const into = { x: c.x - grid, y: c.y };
      const z = await ctx.engine("move", { tokenId: zombi.id, point: { x: into.x + grid / 2, y: into.y + grid / 2 } });
      ctx.expect((z.after?.x === into.x) && (z.after?.y === into.y), `Coquille antivie : le Zombi (Mort-vivant) entre (${z.before?.x},${z.before?.y} → ${z.after?.x},${z.after?.y})`);
      const b = await ctx.engine("move", { tokenId: bandit.id, point: { x: c.x + grid / 2, y: c.y - grid + grid / 2 } });
      const bAfter = await ctx.position(bandit);
      const inside = Math.hypot((bAfter.x - c.x) / grid, (bAfter.y - c.y) / grid) <= 2;
      ctx.expect(!inside, `Coquille antivie : le Bandit (Humanoïde) n'entre pas (${b.before?.x},${b.before?.y} → ${bAfter.x},${bAfter.y})`);
      // Le Guerrier dedans, au bord ; le Bandit dehors, à son contact.
      await place(fighter, c.x + 2 * grid, c.y);
      await place(bandit, c.x + 3 * grid, c.y);
      const weapon = await weaponOf(bandit);
      const ids = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      ctx.use({ tokenId: bandit.id, itemId: weapon, activityType: "attack", targetTokenIds: [fighter.id],
        usageConfig: { [MODULE_ID]: { confirmed: false } } }).catch(() => null);
      let text = "";
      for ( const stop = Date.now() + 8000; Date.now() < stop && !text; ) {
        const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null))?.windows?.[0];
        if ( !d ) continue;
        text = `${d.title ?? ""} ${d.content ?? d.text ?? ""}`;
        const cancel = (d.buttons ?? []).find(x => (x.action === "cancel") || /Renoncer|Give up|Cancel/i.test(x.label ?? ""));
        await ctx.call("answer-dialog", { id: d.id, button: cancel ? (cancel.action ?? cancel.label) : undefined, close: !cancel }).catch(() => {});
      }
      ctx.expect(/allonge|reach/i.test(text), `Coquille antivie : le coup du Bandit à travers → « ${text.replace(/\s+/g, " ").slice(0, 160)} »`);
    });
  }
};
