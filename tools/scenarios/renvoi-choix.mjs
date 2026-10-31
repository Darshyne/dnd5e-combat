/**
 * §293 : Renvoi des morts-vivants, « chaque Mort-vivant de votre choix dans un rayon de 9 m », monde `dnd-6`, Arène de test. Le Clerc
 * (niveau 1) reçoit, prêtés depuis le compendium du Manuel des joueurs, le Conduit divin (deux utilisations) et Calcination des
 * morts-vivants ; le Zombi, le Bandit et le Guerrier sont posés à 9 m au plus, le Magicien au-delà. Vérifie :
 *  - la liste : les seuls morts-vivants à portée (le Zombi ; ni le Bandit ni le Guerrier, humanoïdes, ni le Magicien, trop loin), cochés
 *    d'avance s'ils sont hostiles ; la Calcination proposée à la place ;
 *  - Renvoi sur le Zombi seul : une sauvegarde de Sagesse, Renvoyé s'il la rate, aucun dégât ;
 *  - case cochée : la Calcination part sur le Zombi et le Bandit, sans zone — le Bandit (humanoïde) n'est pas affecté, le Zombi
 *    qui rate subit les dégâts radiants ; une utilisation de Conduit divin dépensée.
 * Remet positions, PV, effets ; retire les items prêtés.
 */
const CLASSES = "dnd-players-handbook.classes";
const TURN = "aOptL5pMaj3WtR8S";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "renvoi-choix — Renvoi des morts-vivants : liste des créatures à 9 m, Calcination à la place",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    const need = ["Clerc", "Zombi", "Bandit", "Guerrier", "Magicien"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const [cleric, zombi, bandit, fighter, wizard] = await Promise.all(need.map(n => ctx.token(n)));
    const grid = await ctx.gridSize();
    for ( const t of [zombi, bandit] ) { const hp = await ctx.hp(t); ctx.restore(() => ctx.setHp(t, hp)); }

    const lend = async (id, extra=null) => {
      const uuid = `Compendium.${CLASSES}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      if ( extra ) for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: cleric.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const channel = await lend("phbclcChannelDiv", { "system.uses.max": "9", "system.uses.spent": 0 });
    await lend("phbclcSearUndead");

    // Le Clerc au centre, trois créatures à 9 m au plus (6 cases), le Magicien à 8 cases.
    const c = await ctx.position(cleric);
    const place = (t, dx, dy) => ctx.call("move-token", { tokenId: t.id, x: c.x + (dx * grid), y: c.y + (dy * grid), elevation: 0 });
    await place(zombi, -3, 0); await place(bandit, 0, -6); await place(fighter, 2, 2); await place(wizard, -8, 0);
    await pause(1200);

    const list = await ctx.engine("pickTargets", { tokenId: cleric.id, itemId: channel, activityId: TURN });
    const names = (list.creatures ?? []).map(x => x.name);
    ctx.expect(names.includes("Zombi") && !["Bandit", "Guerrier", "Magicien", "Clerc"].some(n => names.includes(n)),
      `liste à ${list.radius} ${list.units} : ${(list.creatures ?? []).map(x => `${x.name}${x.enemy ? " ✓" : ""} (${x.distance})`).join(", ")}`);
    const enemy = n => list.creatures?.find(x => x.name === n)?.enemy;
    ctx.expect(enemy("Zombi") === true, "le Zombi, hostile, coché d'avance");
    ctx.expect(!!list.upgrade, `Calcination proposée à la place (« ${list.upgrade ?? "rien"} »)`);

    const zombiUuid = `Scene.${sceneId}.Token.${zombi.id}.Actor.${zombi.actorId}`;
    const clearEffects = async () => {
      for ( const e of await ctx.effects(zombi) ) await ctx.call("remove-embedded-effect", { uuid: zombiUuid, effectId: e._id }).catch(() => {});
    };
    const turned = async () => (await ctx.effects(zombi)).some(e => (e.statuses ?? []).includes("frightened"));

    // 1. Renvoi sur le Zombi seul, jusqu'à une sauvegarde ratée.
    let z = null;
    for ( let n = 1; (n <= 8) && (z?.save?.success !== false); n++ ) {
      await clearEffects();
      await ctx.setHp(zombi, 100);
      const r = await ctx.engine("castPicked", { tokenId: cleric.id, itemId: channel, activityId: TURN, targetIds: [zombi.id] });
      if ( !ctx.expect(!!r.usageMessageId, `Renvoi utilisé (essai ${n})`) ) return;
      const res = await ctx.settle(r.usageMessageId);
      z = res.targets.find(t => t.token.endsWith(zombi.id));
      if ( n === 1 ) ctx.expect(res.targets.length === 1, `une seule cible, le Zombi (${res.targets.length})`);
    }
    ctx.expect(z?.save?.success === false, `Renvoi : le Zombi rate sa sauvegarde de Sagesse (${z?.save?.total ?? "—"})`);
    ctx.expect(!(z?.damage?.applied), `Renvoi seul : aucun dégât (${z?.damage?.applied ?? 0})`);
    await pause(1500);
    ctx.expect(await turned(), "le Zombi est Renvoyé");

    // 2. La case cochée : Calcination sur le Zombi et le Bandit, sans zone.
    const spent0 = (await ctx.call("get-actor", { actorId: cleric.actorId })).items?.find(i => i._id === channel)?.system?.uses?.spent ?? 0;
    let zs = null, bs = null, regions = 0;
    for ( let n = 1; (n <= 8) && (zs?.save?.success !== false); n++ ) {
      await clearEffects();
      await ctx.setHp(zombi, 100);
      const before = (await ctx.call("list-scene-objects", { type: "Region" })).objects?.Region?.length ?? 0;
      const r = await ctx.engine("castPicked", { tokenId: cleric.id, itemId: channel, activityId: TURN, targetIds: [zombi.id, bandit.id], upgrade: true });
      if ( !ctx.expect(!!r.usageMessageId, `Calcination utilisée (essai ${n})`) ) return;
      const res = await ctx.settle(r.usageMessageId);
      regions = ((await ctx.call("list-scene-objects", { type: "Region" })).objects?.Region?.length ?? 0) - before;
      zs = res.targets.find(t => t.token.endsWith(zombi.id));
      bs = res.targets.find(t => t.token.endsWith(bandit.id));
    }
    ctx.expect(regions === 0, `aucune zone posée (${regions})`);
    ctx.expect(zs?.save?.success === false, `Calcination : le Zombi rate (${zs?.save?.total ?? "—"})`);
    ctx.expect((zs?.damage?.applied ?? 0) > 0, `dégâts radiants (${zs?.damage?.applied ?? 0})`);
    ctx.expect(!bs || !!bs.unaffected, `le Bandit, humanoïde, n'est pas affecté${bs ? ` (${bs.unaffected?.reason ?? "affecté"})` : ""}`);
    await pause(1500);
    ctx.expect(await turned(), "le Zombi est Renvoyé malgré les dégâts");
    const spent1 = (await ctx.call("get-actor", { actorId: cleric.actorId })).items?.find(i => i._id === channel)?.system?.uses?.spent ?? 0;
    ctx.expect(spent1 > spent0, `une utilisation de Conduit divin dépensée (${spent0} → ${spent1})`);

    // 3. §294 (vu en jeu le 2026-10-31) : une deuxième Calcination sur le Zombi déjà renvoyé — ses dégâts ne font pas tomber l'effet,
    // et la résolution ne s'interrompt pas sur un effet supprimé entre-temps.
    let again = null;
    for ( let n = 1; (n <= 8) && (again?.save?.success !== false); n++ ) {
      const r = await ctx.engine("castPicked", { tokenId: cleric.id, itemId: channel, activityId: TURN, targetIds: [zombi.id], upgrade: true });
      if ( !ctx.expect(!!r.usageMessageId, `deuxième Calcination utilisée (essai ${n})`) ) return;
      const res = await ctx.settle(r.usageMessageId);
      again = res.targets.find(t => t.token.endsWith(zombi.id));
    }
    ctx.expect((again?.damage?.applied ?? 0) > 0, `deuxième Calcination : dégâts radiants (${again?.damage?.applied ?? 0})`);
    await pause(3000);
    ctx.expect(await turned(), "le Zombi reste Renvoyé après la deuxième Calcination");
    await clearEffects();
  }
};
