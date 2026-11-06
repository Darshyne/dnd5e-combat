/**
 * Issue #32 : « Succès à un prix » (Guide du maître 2024, chapitre 2), réglage de monde éteint par défaut. Se joue dans l'« Arène du
 * succès à un prix » (`node tools/arene-prix.mjs` la monte) : le Héros (Guerrier pré-tiré, un personnage joueur) au contact du Mannequin
 * (999 PV, CA 15), le Lanceur (PNJ) à 4 cases. Les jets sont aléatoires : chaque partie relance jusqu'à tomber sur un raté de 1 ou 2.
 *  - attaque ratée de 1 ou 2, offerte et acceptée (aucun joueur connecté : le MJ tranche) : la pause s'ouvre, le coup touche « à un prix »,
 *    sans critique, les dégâts sont appliqués une seule fois, la carte publique est posée ;
 *  - attaque ratée de 1 ou 2, pastille fermée par le MJ : l'échec reste, aucun jet de dégâts ;
 *  - pause qui expire sans geste : l'échec reste ;
 *  - sauvegarde demandée par une résolution (Flamme sacrée du Lanceur) ratée de 1 ou 2, acceptée : réussie, aucun dégât ;
 *  - jet demandé par le MJ (§242, Athlétisme DD 15) raté de 1 ou 2 : la ligne passe en réussite à un prix, le verdict suit ;
 *  - aide éteinte : aucune pause.
 * Remet réglages, PV, positions (le lanceur de scénarios replace les tokens de l'arène avant).
 */
const MODULE_ID = "dnd5e-combat";
const SACRED_FLAME = "Compendium.dnd-players-handbook.spells.Item.phbsplSacredFlam";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "succès à un prix — attaque, pastille, pause, sauvegarde, jet demandé",
  scene: "Arène du succès à un prix",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Héros du prix", "Mannequin", "Lanceur du prix"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis (node tools/arene-prix.mjs) : non applicable`); return; }
    const hero = await ctx.token("Héros du prix");
    const dummy = await ctx.token("Mannequin");
    const caster = await ctx.token("Lanceur du prix");
    const homes = new Map();
    for ( const t of [hero, dummy, caster] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const setting = async (key, value) => { const r = await ctx.engine("setting", { key, value }); ctx.restore(() => ctx.engine("setting", { key, value: r.before })); return r; };
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.setHp(tokens.find(x => x.id === id), h.hp);
      }
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };

    // L'arme du Guerrier pré-tiré : la première qui a une attaque.
    const actor = await ctx.call("get-actor", { actorId: hero.actorId });
    const weapon = (actor.items ?? []).find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, "le Héros a une arme") ) return;
    const flame = await ctx.ensureItem(caster, SACRED_FLAME);
    const candidates = () => ctx.engine("atCost", { action: "list" });
    const pauseOn = async (token, ms) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; await pause(250) ) {
        const c = (await candidates()).find(x => x.token?.endsWith(`Token.${token.id}`));
        if ( c ) return c;
      }
      return null;
    };

    /**
     * Utilise une activité jusqu'à ce qu'une pause s'ouvre sur `on` (raté de 1 ou 2), puis `onPause(candidate)`. Rend
     * `{ resolution, since, candidate }`, ou null après `tries` essais.
     */
    const nearMiss = async (use, on, onPause, tries=30) => {
      for ( let n = 0; n < tries; n++ ) {
        const since = await ctx.lastMessageId();
        const used = use();
        const candidate = await pauseOn(on, 6000);
        const u = await used;
        if ( candidate ) await onPause(candidate);
        const resolution = await ctx.settle(u.usageMessageId, { timeoutMs: 60000 }).catch(() => null);
        if ( candidate ) return { resolution, since, candidate };
        await pause(400);
      }
      return null;
    };
    const strike = () => ctx.use({ tokenId: hero.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [dummy.id] });
    const nearMissAttack = (onPause, tries) => nearMiss(strike, hero, onPause, tries);
    const targetOf = (r, token) => r?.resolution?.targets?.find(t => t.name === token.name) ?? null;
    const damageMessages = msgs => msgs.filter(m => m.type === "damage");

    await part("Attaque acceptée", async () => {
      await setting("successAtCost", true); await setting("successAtCostHold", 10);
      // Les PV lus pendant la pause : les essais d'avant ont pu toucher normalement.
      let hp0 = null;
      const r = await nearMissAttack(async c => {
        hp0 = await ctx.hp(dummy);
        ctx.expect((c.by === 1) || (c.by === 2), `la pause dit l'écart (${c.by}, ${c.total} contre ${c.needed})`);
        const offered = await ctx.engine("atCost", { action: "offer", id: c.id, cost: "Test : vous tombez à terre." });
        ctx.expect(offered.accepted === true, "sans joueur connecté, le MJ tranche : accepté");
      });
      if ( !ctx.expect(!!r, "une attaque rate de 1 ou 2 (30 essais au plus)") ) return;
      const t = targetOf(r, dummy);
      ctx.expect(t?.hit === true && t.reason === "atCost" && !t.critical, `touché à un prix, pas critique (${t?.reason}, critique ${t?.critical})`);
      ctx.expect(r.resolution?.atCost?.cost === "Test : vous tombez à terre.", "le prix est noté sur la résolution");
      await pause(2500);
      const msgs = await ctx.messagesSince(r.since);
      ctx.expect(damageMessages(msgs).length === 1, `un seul jet de dégâts (${damageMessages(msgs).length})`);
      ctx.expect(msgs.some(m => m.flags?.[MODULE_ID]?.atCostCard), "carte publique du succès à un prix");
      const hp1 = await ctx.hp(dummy);
      const dealt = t?.damage?.applied ?? null;
      ctx.expect(hp1 < hp0, `PV du Mannequin : ${hp0} → ${hp1}`);
      if ( Number.isFinite(dealt) ) ctx.expect(hp0 - hp1 === dealt, `perte = dégâts appliqués une fois (${hp0 - hp1} = ${dealt})`);
    });

    await part("Pastille fermée", async () => {
      await setting("successAtCost", true); await setting("successAtCostHold", 10);
      const r = await nearMissAttack(c => ctx.engine("atCost", { action: "dismiss", id: c.id }));
      if ( !ctx.expect(!!r, "une attaque rate de 1 ou 2 (30 essais au plus)") ) return;
      ctx.expect(r.resolution?.step === "missed" && targetOf(r, dummy)?.hit === false, `l'échec reste (${r.resolution?.step})`);
      await pause(1500);
      ctx.expect(!damageMessages(await ctx.messagesSince(r.since)).length, "aucun jet de dégâts");
    });

    await part("Pause expirée", async () => {
      await setting("successAtCost", true); await setting("successAtCostHold", 2);
      const r = await nearMissAttack(async () => {});
      if ( !ctx.expect(!!r, "une attaque rate de 1 ou 2 (30 essais au plus)") ) return;
      ctx.expect(r.resolution?.step === "missed", `sans geste du MJ, l'échec reste (${r.resolution?.step})`);
      ctx.expect(!(await candidates()).length, "plus aucune pause ouverte");
    });

    await part("Sauvegarde acceptée", async () => {
      await setting("successAtCost", true); await setting("successAtCostHold", 10);
      let hp0 = null;
      const cast = () => ctx.use({ tokenId: caster.id, itemId: flame, targetTokenIds: [hero.id] });
      const r = await nearMiss(cast, hero, async c => {
        hp0 = await ctx.hp(hero);   // les essais d'avant ont pu infliger des dégâts
        ctx.expect(c.kind === "save", `pause sur une sauvegarde (${c.kind}, ${c.total} contre DD ${c.needed})`);
        await ctx.engine("atCost", { action: "offer", id: c.id, cost: "Test : votre arme tombe." });
      }, 40);
      if ( !ctx.expect(!!r, "une sauvegarde rate de 1 ou 2 (40 essais au plus)") ) return;
      const t = targetOf(r, hero);
      ctx.expect(t?.save?.success === true && !!t.save.atCost, `sauvegarde réussie à un prix (${t?.save?.total})`);
      await pause(1500);
      const hp1 = await ctx.hp(hero);
      ctx.expect(hp1 === hp0 && !(t?.damage?.applied > 0), `aucun dégât (Flamme sacrée : rien sur une réussite ; ${hp0} → ${hp1})`);
    });

    await part("Jet demandé par le MJ", async () => {
      await setting("successAtCost", true);
      let done = null;
      for ( let n = 0; (n < 40) && !done; n++ ) {
        const card = await ctx.engine("groupRoll", { tokenIds: [hero.id], type: "skill", key: "ath", dc: 15, wait: true });
        const id = card?.id;
        if ( !id ) continue;
        const r = await ctx.engine("atCost", { action: "row", card: id, tokenId: hero.id, cost: "Test : la corde lâche." });
        if ( !r.candidate ) continue;
        ctx.expect(r.accepted === true, "accepté (le MJ tranche)");
        await pause(1500);
        done = await ctx.engine("groupRollState", { id });
      }
      if ( !ctx.expect(!!done, "un test d'Athlétisme rate de 1 ou 2 (40 essais au plus)") ) return;
      const entry = done.entries?.[0];
      ctx.expect(entry?.success === true && !!entry.atCost, `la ligne passe en réussite à un prix (${entry?.total} contre 15)`);
      ctx.expect(done.success === true, "le verdict suit");
    });

    await part("Aide éteinte", async () => {
      await setting("successAtCost", false);
      let seen = 0;
      for ( let n = 0; n < 6; n++ ) {
        const used = strike();
        if ( await pauseOn(hero, 3000) ) seen++;
        const u = await used;
        await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      }
      ctx.expect(seen === 0, "aucune pause quand l'aide est éteinte");
    });
  }
};
