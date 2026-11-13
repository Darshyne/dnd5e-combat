/**
 * §436 : l'antimagie de dnd5e 6.1 tenue par le moteur, monde `dnd-6`, arène (comme `releve-sorts-8`). Sorts prêtés du Manuel des joueurs
 * (à volonté). Le Champ antimagie du Manuel n'a pas le comportement de région du SRD 6.1 : le moteur le lui ajoute, dnd5e pose alors
 * le statut `antimagic`.
 *  1. Bénédiction du Clerc sur le Guerrier, loin du champ : l'effet posé est marqué magique.
 *  2. Le Magicien lance le Champ : la région porte `dnd5e.antimagic`, le Magicien a le statut.
 *  3. Le Guerrier entre dans le champ : statut, Bénédiction suspendue ; il en sort : plus de statut, Bénédiction rétablie.
 *  4. Le Zombi, dehors, lance Flamme sacrée sur le Magicien : non affecté (raison `antimagic`), PV inchangés.
 *  5. Le Magicien lance Trait de feu (une cible ; Projectile magique ouvrirait d'abord la visée des projectiles) : fenêtre de légalité — « Renoncer » : rien ; « Utiliser quand même » : carte marquée
 *     `overridden` (la raison du champ), alerte au MJ.
 *  6. Le Guerrier, dans le champ, frappe le Bandit avec une arme non magique : aucun souci de légalité, l'attaque se résout.
 * Remet positions, effets, PV.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "antimagie de dnd5e 6.1 — statut lu, effets suspendus, sort refusé et forçable, attaque ordinaire",

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
    const legality = async (who, ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${who.name}`));
        if ( d ) return d;
      }
      return null;
    };
    const reset = async () => {
      const d = await legality(mage, 300);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
      for ( const t of all ) {
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(1500);
    };
    ctx.restore(reset);
    const lend = (t, id) => ctx.ensureItem(t, PHB + id, { system: { method: "atwill" } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(1200); };
    const statuses = async t => new Set((await ctx.effects(t)).flatMap(e => e.statuses ?? []));
    const bless = async () => (await ctx.effectsFrom(fighter, "bless")).find(e => !(e.statuses ?? []).includes("concentrating")) ?? null;
    const weaponOf = async t => ((await ctx.call("get-actor", { actorId: t.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && !(i.system?.properties ?? []).includes("mgc")
        && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack" && a.attack?.type?.value === "melee"))?._id ?? null;

    const m = homes.get(mage.id).pos;
    await place(fighter, m.x - 6 * grid, m.y);
    await place(cleric, m.x - 7 * grid, m.y);
    await place(zombi, m.x + 5 * grid, m.y);
    await place(bandit, m.x + 2 * grid, m.y);

    // 1. Bénédiction, loin du champ.
    const blessId = await lend(cleric, "phbsplBless00000");
    const b = await ctx.use({ tokenId: cleric.id, itemId: blessId, targetTokenIds: [fighter.id], consume: false });
    if ( b.usageMessageId ) await ctx.settle(b.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(1500);
    let blessed = await bless();
    if ( !ctx.expect(!!blessed, "Bénédiction posée sur le Guerrier") ) return;
    ctx.expect(blessed.magical === true, `l'effet de Bénédiction (sort du Manuel) est marqué magique (magical=${blessed.magical})`);

    // 2. Le Champ.
    const field = await lend(mage, "phbsplAntimagicF");
    // La pose sans clic du moteur (§47), comme à la table : le connecteur seul (`use-activity`) coupe la pose des gabarits.
    const used = await ctx.engine("use", { tokenId: mage.id, itemId: field, activityType: "utility" });
    for ( const r of used.regions ?? [] ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
    if ( used.messageId ) await ctx.settle(used.messageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(2500);
    const regions = used.regions ?? [];
    const fieldRegion = await (async () => {
      for ( const r of regions ) {
        const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: r.id }).catch(() => ({ data: null }));
        if ( (data?.behaviors ?? []).some(x => x.type === "dnd5e.antimagic") ) return data;
      }
      return null;
    })();
    ctx.expect(!!fieldRegion, `la région du Champ porte le comportement « dnd5e.antimagic » (${regions.length} région(s))`);
    ctx.expect((await statuses(mage)).has("antimagic"), "le Magicien porte le statut « antimagic »");

    // 3. Le Guerrier entre, puis sort.
    await place(fighter, m.x - grid, m.y);
    await pause(1000);
    blessed = await bless();
    ctx.expect((await statuses(fighter)).has("antimagic") && blessed?.suppressed === true,
      `dans le champ : statut et Bénédiction suspendue (suppressed=${blessed?.suppressed})`);
    await place(fighter, m.x - 6 * grid, m.y);
    await pause(1000);
    blessed = await bless();
    ctx.expect(!(await statuses(fighter)).has("antimagic") && blessed?.suppressed === false,
      `hors du champ : plus de statut, Bénédiction rétablie (suppressed=${blessed?.suppressed})`);

    // 4. Flamme sacrée de l'extérieur sur le Magicien.
    const flame = await lend(zombi, "phbsplSacredFlam");
    const hp = await ctx.hp(mage);
    const f = await ctx.use({ tokenId: zombi.id, itemId: flame, targetTokenIds: [mage.id], consume: false });
    if ( f.usageMessageId ) await ctx.settle(f.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(1500);
    const log = (await ctx.engineLog()).filter(l => /unaffected/.test(l) && /\(antimagic/.test(l));
    ctx.expect(log.length > 0 && ((await ctx.hp(mage)) === hp), `Flamme sacrée sur le Magicien dans le champ → ${log.at(-1) ?? "rien au journal"}`);

    // 5. Trait de feu depuis le champ : refusé, forçable.
    const missile = await lend(mage, "phbsplFireBolt00");
    const issues = await ctx.engine("issues", { tokenId: mage.id, itemId: missile });
    ctx.expect(issues.some(l => /no spell can be cast|aucun sort/i.test(l)), `le souci du champ (${issues.join(" ; ") || "aucun souci"})`);
    const alerts = messages => messages.filter(msg => msg.flags?.[MODULE_ID]?.gmAlert);
    const usages = messages => messages.filter(msg => (msg.type === "usage") && (msg.flags?.[MODULE_ID]?.overridden?.length));
    // Comme un clic du moteur (`engine use`) : dnd5e 6.1 refuserait sèchement le sort (`requireMagic`), la fenêtre du moteur passe avant.
    const attempt = async button => {
      const since = await ctx.lastMessageId();
      ctx.engine("use", { tokenId: mage.id, itemId: missile, activityType: "attack" }).catch(() => null);
      const d = await legality(mage);
      if ( !d ) return null;
      await ctx.call("answer-dialog", { id: d.id, button });
      if ( button === "go" ) {
        // Une autre raison de la légalité (pas de cible désignée…) : passée outre aussi, la carte garde la raison du champ.
        const more = await legality(mage, 2500);
        if ( more ) await ctx.call("answer-dialog", { id: more.id, button: "go" });
      }
      await pause(button === "go" ? 3500 : 1500);
      return ctx.messagesSince(since);
    };
    let after = await attempt("cancel");
    if ( ctx.expect(!!after, "Trait de feu dans le champ : la fenêtre de légalité s'ouvre") ) {
      ctx.expect(!usages(after).length && !alerts(after).length, `renoncé : ni carte, ni alerte (${after.length} message(s))`);
    }
    after = await attempt("go");
    if ( ctx.expect(!!after, "la fenêtre se rouvre") ) {
      const reasons = usages(after)[0]?.flags?.[MODULE_ID]?.overridden ?? [];
      ctx.expect(reasons.some(r => /no spell can be cast|aucun sort/i.test(r)), `forcé : la carte porte la raison du champ (${reasons.join(" | ")})`);
      const text = alerts(after)[0]?.flags?.[MODULE_ID]?.gmAlert?.text ?? "";
      ctx.expect(!!text && /no spell can be cast|aucun sort/i.test(text), `une alerte au MJ, avec la raison du champ (${text})`);
      const card = usages(after)[0];
      if ( card ) await ctx.settle(card._id ?? card.id, { timeoutMs: 30000 }).catch(() => null);
    }

    // 6. Une attaque non magique dans le champ.
    await place(fighter, m.x + grid, m.y);
    const weapon = await weaponOf(fighter);
    if ( ctx.expect(!!weapon, "le Guerrier a une arme de corps à corps non magique") ) {
      const wIssues = await ctx.engine("issues", { tokenId: fighter.id, itemId: weapon });
      ctx.expect(!wIssues.some(l => /antimag|no spell|aucun sort|no power|aucun pouvoir/i.test(l)), `aucun souci d'antimagie (${wIssues.join(" ; ") || "aucun souci"})`);
      const a = await ctx.use({ tokenId: fighter.id, itemId: weapon, activityType: "attack", targetTokenIds: [bandit.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
      const res = a.usageMessageId ? await ctx.settle(a.usageMessageId, { timeoutMs: 30000 }).catch(() => null) : null;
      const step = res?.step ?? (a.usageMessageId ? (await ctx.resolution(a.usageMessageId).catch(() => null))?.step : null);
      ctx.expect(["done", "missed", "applied"].includes(step), `l'attaque du Guerrier se résout (étape ${step ?? "?"})`);
    }

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
