/**
 * §436 (suite) : le Cône antimagie du tyrannœil (Manuel des monstres), joué en combat. « Jusqu'au début du prochain tour du tyrannœil »,
 * la zone est un champ antimagie : le moteur lui donne le comportement `dnd5e.antimagic` du système (contenu `antimagicZone`) et la fait
 * tomber au début du tour suivant de son lanceur (`endsOnTurn`), pas au changement de round (l'heure du monde avance de 6 s avant son
 * tour quand il ne joue pas en premier). Monde `dnd-6`, arène ; le Zombi prête son corps au tyrannœil.
 *  1. Bénédiction du Clerc sur le Guerrier.
 *  2. Combat : le Guerrier joue avant le Zombi. Au tour du Zombi, le Cône posé sur le Guerrier : comportement, statut, Bénédiction
 *     suspendue.
 *  3. Tour suivant (nouveau round, tour du Guerrier) : le champ tient encore.
 *  4. Tour du Zombi : la zone tombe, plus de statut, Bénédiction rétablie.
 * Remet positions, effets, PV ; le combat est retiré.
 */
const CONE = "Compendium.dnd-monster-manual.features.Item.mmAntimagicCone0";
const BLESS = "Compendium.dnd-players-handbook.spells.Item.phbsplBless00000";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "antimagie — Cône antimagie du tyrannœil, en combat jusqu'au début de son tour suivant",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Clerc", "Guerrier", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [cleric, fighter, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [cleric, fighter, zombi];
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t),
      effects: new Set((await ctx.effects(t)).map(e => e._id ?? e.id)) });
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    ctx.restore(async () => {
      for ( const t of all ) {
        const h = homes.get(t.id);
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !h.effects.has(e._id ?? e.id)) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(1500);
    });
    const grid = await ctx.gridSize();
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(1200); };
    const statuses = async t => new Set((await ctx.effects(t)).flatMap(e => e.statuses ?? []));
    const bless = async () => (await ctx.effectsFrom(fighter, "bless")).find(e => !(e.statuses ?? []).includes("concentrating")) ?? null;
    const z = homes.get(zombi.id).pos;
    await place(fighter, z.x + 3 * grid, z.y);
    await place(cleric, z.x + 3 * grid, z.y + 3 * grid);

    // 1. Bénédiction.
    const blessId = await ctx.ensureItem(cleric, BLESS, { system: { method: "atwill" } });
    const b = await ctx.use({ tokenId: cleric.id, itemId: blessId, targetTokenIds: [fighter.id], consume: false });
    if ( b.usageMessageId ) await ctx.settle(b.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(1500);
    if ( !ctx.expect(!!(await bless()), "Bénédiction posée sur le Guerrier") ) return;

    const cone = await ctx.ensureItem(zombi, CONE).catch(err => { ctx.log(`Cône non prêté : ${err.message}`); return null; });
    if ( !cone ) { ctx.log("Manuel des monstres absent : non applicable"); return; }

    // 2. Combat, le Guerrier avant le Zombi ; le Cône au tour du Zombi.
    await ctx.startCombat([fighter, zombi]);
    const state = async () => ctx.combat();
    let c = await state();
    const by = id => c.combatants.find(x => x.tokenId === id);
    await ctx.call("set-initiative", { combatId: c.id, combatantId: by(fighter.id).id, value: 20 });
    await ctx.call("set-initiative", { combatId: c.id, combatantId: by(zombi.id).id, value: 5 });
    for ( let i = 0; i < 4; i++ ) {
      c = await state();
      if ( c.currentCombatantId === by(zombi.id)?.id ) break;
      await ctx.nextTurn();
      await pause(1500);
    }
    c = await state();
    if ( !ctx.expect(c.currentCombatantId === by(zombi.id)?.id, `tour du Zombi (round ${c.round})`) ) return;
    const castRound = c.round;
    const at = await ctx.box(fighter);
    const used = await ctx.use({ tokenId: zombi.id, itemId: cone, consume: false,
      area: { shape: "circle", x: at.x + at.width / 2, y: at.y + at.height / 2, radius: 2 * grid } });
    const regionId = used.regionId ?? used.regions?.[0]?.id ?? null;
    if ( regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {}));
    if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(2500);
    const region = async () => regionId ? ((await ctx.call("get-scene-object", { type: "Region", objectId: regionId }).catch(() => null))?.data ?? null) : null;
    let r = await region();
    if ( !ctx.expect(!!r, `le Cône pose sa zone (${regionId ?? "aucune"})`) ) return;
    ctx.expect((r.behaviors ?? []).some(x => x.type === "dnd5e.antimagic"), "la zone porte le comportement « dnd5e.antimagic »");
    const turn = r.flags?.["dnd5e-combat"]?.endsOnTurn;
    ctx.expect(turn?.combatant === by(zombi.id)?.id && turn?.round === castRound, `la zone attend le début du tour suivant du Zombi (${JSON.stringify(turn)})`);
    ctx.expect((await statuses(fighter)).has("antimagic") && (await bless())?.suppressed === true,
      `dans le cône : statut et Bénédiction suspendue (suppressed=${(await bless())?.suppressed})`);

    // 3. Nouveau round, tour du Guerrier : l'heure du monde a avancé de 6 s, le champ tient.
    await ctx.nextTurn();
    await pause(2500);
    c = await state();
    r = await region();
    ctx.expect(c.round === castRound + 1 && c.currentCombatantId === by(fighter.id)?.id, `round ${c.round}, tour du Guerrier`);
    ctx.expect(!!r && (await statuses(fighter)).has("antimagic"), "au tour du Guerrier (nouveau round) : le champ tient encore");

    // 4. Tour du Zombi : fin.
    await ctx.nextTurn();
    await pause(2500);
    c = await state();
    ctx.expect(c.currentCombatantId === by(zombi.id)?.id, `tour du Zombi (round ${c.round})`);
    ctx.expect(!(await region()), "au début du tour suivant du Zombi : la zone a pris fin");
    ctx.expect(!(await statuses(fighter)).has("antimagic") && (await bless())?.suppressed === false,
      `plus de statut, Bénédiction rétablie (suppressed=${(await bless())?.suppressed})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
