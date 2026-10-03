/**
 * Renvoi des morts-vivants par la Calcination (SPEC §16.25) : seuls les morts-vivants sont affectés (un humanoïde hostile
 * dans la zone ne l'est pas) ; un mort-vivant qui rate sa sauvegarde est Renvoyé (Effrayé, Neutralisé) et subit les
 * dégâts radiants, qui ne mettent pas fin au renvoi ; des dégâts subis ensuite y mettent fin.
 * Monde `ravenloft` : Alara, un « Zombie Plague Spreader » posé pour l'occasion, Rahadin amené dans la zone.
 * Ailleurs : non applicable (pas d'Alara).
 */
const UNDEAD = "Zombie Plague Spreader";
const HUMANOID = "Rahadin, chambellan du château";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "renvoi — Calcination des morts-vivants",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Alara") ) { ctx.log("pas d'Alara sur la scène : non applicable"); return; }
    const alara = await ctx.token("Alara");
    const { actors } = await ctx.call("list-actors", {}).then(r => ({ actors: r.actors ?? r }));
    const undeadActor = actors.find(a => a.name === UNDEAD);
    if ( !undeadActor ) { ctx.log(`pas d'acteur « ${UNDEAD} » : non applicable`); return; }

    const grid = await ctx.gridSize();
    const at = await ctx.position(alara);
    const placed = await ctx.call("place-token", { actorId: undeadActor.id, x: at.x + (2 * grid), y: at.y });
    const zombieId = placed.tokenId ?? placed.id ?? placed.token?._id ?? placed.data?._id;
    ctx.expect(!!zombieId, `${UNDEAD} posé à 10 ft d'Alara`);
    if ( !zombieId ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Token", objectId: zombieId }).catch(() => {}));
    const { data: aTok } = await ctx.call("get-scene-object", { type: "Token", objectId: alara.id });
    await ctx.call("update-scene-object", { type: "Token", objectId: zombieId, data: { disposition: -1, ...(aTok.level ? { level: aTok.level } : {}) } });
    const zombie = { id: zombieId, name: UNDEAD, actorId: undeadActor.id };
    const humanoid = tokens.some(t => t.name === HUMANOID) ? await ctx.token(HUMANOID) : null;
    if ( humanoid ) await ctx.call("move-token", { tokenId: humanoid.id, x: at.x - (2 * grid), y: at.y });

    // La Calcination, lancée jusqu'à ce que le mort-vivant rate sa sauvegarde (Sagesse 5 : presque toujours).
    const center = { x: at.x + grid / 2, y: at.y + grid / 2 };
    let r = null;
    for ( let n = 1; n <= 6; n++ ) {
      await ctx.setHp(zombie, 78);
      for ( const e of await ctx.effects(zombie) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Scene.${(await ctx.scene()).sceneId}.Token.${zombieId}.Actor.${undeadActor.id}`, effectId: e._id }).catch(() => {});
      }
      const used = await ctx.use({ tokenId: alara.id, identifier: "sear-undead", activityType: "save", consume: false,
        area: { shape: "circle", ...center, radius: 6.5 * grid } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      r = await ctx.settle(used.usageMessageId);
      if ( r.targets.find(t => t.token.endsWith(zombieId))?.save?.success === false ) break;
    }
    const z = r.targets.find(t => t.token.endsWith(zombieId));
    const h = humanoid ? r.targets.find(t => t.token.endsWith(humanoid.id)) : null;
    ctx.expect(!!z && (z.save?.success === false), `le mort-vivant rate sa sauvegarde (${z?.save?.total ?? "—"})`);
    if ( humanoid ) ctx.expect(!h || !!h.unaffected, `${HUMANOID}, humanoïde, n'est pas affecté${h ? ` (${h.unaffected?.reason})` : " (hors des cibles)"}`);
    ctx.expect((z?.damage?.applied ?? 0) > 0, `dégâts radiants appliqués (${z?.damage?.applied ?? 0})`);
    await pause(1500);
    const turned = async () => (await ctx.effects(zombie)).some(e => (e.statuses ?? []).includes("frightened"));
    ctx.expect(await turned(), "Renvoyé : l'effet tient malgré les dégâts de la Calcination");

    // Des dégâts ensuite : le renvoi cesse.
    const kaalisti = tokens.some(t => t.name === "Kaalisti") ? await ctx.token("Kaalisti") : null;
    if ( !kaalisti ) return;
    await ctx.call("move-token", { tokenId: kaalisti.id, x: at.x + (3 * grid), y: at.y });
    for ( let n = 1; n <= 8; n++ ) {
      const used = await ctx.use({ tokenId: kaalisti.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [zombieId] });
      const hit = await ctx.settle(used.usageMessageId);
      if ( hit.targets[0]?.hit ) break;
    }
    await pause(2000);
    ctx.expect(!(await turned()), "touché par Kaalisti : le renvoi cesse");
  }
};
