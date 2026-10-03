/**
 * La fenêtre de réaction AVANT le jet d'attaque (SPEC §34), monde `dnd-6`. Le Bandit attaque le Guerrier ; à chaque partie, une
 * seule créature a de quoi réagir, prêté depuis le compendium du Manuel des joueurs :
 *  - Esquive des ombres (Rôdeur) au Guerrier, la cible : le jet du Bandit a le Désavantage ;
 *  - Éclat protecteur (Clerc) au Clerc, à 9 m du Bandit : le jet a le Désavantage ;
 *  - Présage cosmique (Druide), Péril, au Druide : 1d6 retiré du jet ;
 *  - §36 : Présage cosmique, Fortune — le Guerrier attaque le Bandit, le Druide ajoute 1d6 à son jet.
 * La réaction est prise d'office (`autoReact: "first"`) ; le connecteur rend la main dès que la porte suspend l'utilisation, la
 * suite se lit dans le chat. Remet positions, PV, utilisations ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "avant l'attaque — Esquive des ombres, Éclat protecteur, Présage cosmique (Péril, Fortune)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit", "Clerc", "Druide"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const cleric = await ctx.token("Clerc");
    const druid = await ctx.token("Druide");
    const homes = new Map();
    for ( const t of [fighter, bandit, cleric, druid] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    // Restored Keep, colonne x = 3080 : le Clerc et le Druide en 4760 et 4900 (à 9 m du Bandit), le Guerrier en 5040, le Bandit en 5180.
    const spot = { cleric: { x: 3080, y: 4760 }, druid: { x: 3080, y: 4900 }, fighter: { x: 3080, y: 5040 }, bandit: { x: 3080, y: 5180 } };
    const place = async (t, p) => { await ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: 0 }); await pause(600); };
    const lend = async (who, pack, id) => {
      const uuid = `Compendium.${pack}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: who.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      const remove = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: who.actorId, itemId: r.id }).catch(() => {});
      ctx.restore(remove);
      return remove;
    };

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** Le Bandit attaque le Guerrier, réaction prise d'office ; rend la formule du jet et les cartes produites. */
    const banditAttacks = async () => {
      await place(cleric, spot.cleric); await place(druid, spot.druid); await place(fighter, spot.fighter); await place(bandit, spot.bandit);
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [fighter.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      let attack = null;
      for ( const stop = Date.now() + 25000; !attack && (Date.now() < stop); await pause(800) ) {
        attack = (await ctx.messagesSince(since)).find(m => (m.type === "attack") && (m.alias === "Bandit"));
      }
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      return { formula: attack?.rolls?.[0]?.formula ?? "", msgs };
    };

    await part("Esquive des ombres", async () => {
      const remove = await lend(fighter, CLASSES, "phbrgrShadowyDod");
      const { formula, msgs } = await banditAttacks();
      const reacted = msgs.some(m => (m.type === "usage") && (m.alias === fighter.name || m.alias === "Guerrier"));
      ctx.expect(reacted && /dis|kl/.test(formula), `le Guerrier réagit (${reacted}) ; jet du Bandit : ${formula}`);
      await remove();
    });

    await part("Éclat protecteur", async () => {
      const remove = await lend(cleric, CLASSES, "phbclcWardingFla");
      const { formula, msgs } = await banditAttacks();
      const reacted = msgs.some(m => (m.type === "usage") && /Clerc/.test(m.alias ?? ""));
      ctx.expect(reacted && /dis|kl/.test(formula), `le Clerc réagit (${reacted}) ; jet du Bandit : ${formula}`);
      await remove();
    });

    await part("Présage cosmique", async () => {
      const remove = await lend(druid, CLASSES, "phbdrdCosmicOmen");
      const { formula, msgs } = await banditAttacks();
      const woe = msgs.find(m => (m.rolls ?? []).some(r => /^1d6$/.test(r.formula)) && /Druide/.test(m.alias ?? ""));
      const n = woe?.rolls?.[0]?.total;
      ctx.expect(!!woe && formula.includes(`- ${n}`), `le Druide réagit : 1d6 = ${n} ; jet du Bandit : ${formula}`);
      await remove();
    });

    // §36 : Fortune — le Guerrier attaque le Bandit ; le Druide, son allié à 1,50 m, ajoute 1d6 au jet (seule l'activité Fortune est
    // proposée dans cette fenêtre, `autoReact: "first"` la prend).
    await part("Fortune", async () => {
      const remove = await lend(druid, CLASSES, "phbdrdCosmicOmen");
      await place(cleric, spot.cleric); await place(druid, spot.druid); await place(fighter, spot.fighter); await place(bandit, spot.bandit);
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: fighter.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      let attack = null;
      for ( const stop = Date.now() + 25000; !attack && (Date.now() < stop); await pause(800) ) {
        attack = (await ctx.messagesSince(since)).find(m => (m.type === "attack") && (m.alias === "Guerrier"));
      }
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const formula = attack?.rolls?.[0]?.formula ?? "";
      const weal = msgs.find(m => (m.rolls ?? []).some(r => /^1d6$/.test(r.formula)) && /Druide/.test(m.alias ?? ""));
      const n = weal?.rolls?.[0]?.total;
      ctx.expect(!!weal && formula.includes(`+ ${n}`), `le Druide réagit : 1d6 = ${n} ; jet du Guerrier : ${formula}`);
      const reactions = msgs.filter(m => (m.type === "usage") && /Druide/.test(m.alias ?? ""));
      ctx.expect(reactions.length === 1, `une seule réaction du Druide (${reactions.length})`);
      await remove();
    });
  }
};
