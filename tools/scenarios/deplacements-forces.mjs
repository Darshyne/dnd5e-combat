/**
 * §412 (issue #44, lot 5) : les refus de déplacement ouvrent la fenêtre de légalité ; forcé, le geste part et le MJ est prévenu.
 * « Arène des refus » (`node tools/arene-refus.mjs`). Le MJ n'est retenu ni par le déplacement du tour ni par une case prise (la garde des
 * joueurs, vérifiée côté joueur) : ici, ce qui retient tout le monde.
 *  1. Saut en longueur bien au-delà de la limite du Guerrier (« Sauter ici ») : fenêtre « trop long » ; renoncé, il ne bouge pas ; forcé, il
 *     arrive, une alerte MJ.
 *  2. Guerrier Agrippé, un clic au sol (`moveTo`) : fenêtre « Agrippé » ; forcé, il y va, une alerte MJ.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "déplacements forcés — saut trop long, Agrippé",
  scene: "Arène des refus",

  async run(ctx) {
    const fighter = await ctx.token("Guerrier des refus");
    const script = async code => (await ctx.call("run-script", { code }))?.result;
    const where = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id })).data;
    const home = await where();
    const grid = await script(`return canvas.scene.grid.size;`);
    const back = () => script(`await canvas.scene.tokens.get("${fighter.id}").move([{ x: ${home.x}, y: ${home.y}, elevation: 0, action: "blink" }], { "${MODULE_ID}": { cleared: true, forcedMove: true } }); return true;`);
    ctx.restore(async () => {
      await script(`await canvas.scene.tokens.get("${fighter.id}").actor.toggleStatusEffect("grappled", { active: false }); return true;`).catch(() => {});
      await back().catch(() => {});
    });
    const legality = async (ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${fighter.name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      const d = await legality(300);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
    });
    const textOf = d => [d?.title, d?.content, d?.text].filter(Boolean).join(" ");
    const alerts = messages => messages.filter(m => m.flags?.[MODULE_ID]?.gmAlert);
    const actions = `const { jumpTo, moveTo } = await import("/modules/${MODULE_ID}/scripts/runtime/actions.mjs"); const t = canvas.scene.tokens.get("${fighter.id}");`;
    // Huit cases à l'est (40 ft) : au-delà de tout saut en longueur du Guerrier.
    const goal = { x: home.x + (8 * grid), y: home.y };
    const at = `{ x: ${goal.x} + canvas.scene.grid.size / 2, y: ${goal.y} + canvas.scene.grid.size / 2 }`;

    // 1. Saut trop long.
    await script(`${actions} jumpTo(t, ${at}, { configure: false }).catch(err => console.error(err)); return true;`);
    let d = await legality();
    ctx.expect(!!d && /jump|saut/i.test(textOf(d)), `saut trop long : la fenêtre le dit (${textOf(d).slice(0, 160)})`);
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
    await pause(1500);
    let now = await where();
    ctx.expect((now.x === home.x) && (now.y === home.y), `renoncé : le Guerrier ne bouge pas (${now.x},${now.y})`);
    let since = await ctx.lastMessageId();
    await script(`${actions} jumpTo(t, ${at}, { configure: false }).catch(err => console.error(err)); return true;`);
    d = await legality();
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "go" });
    await pause(3500);
    now = await where();
    ctx.expect((now.x === goal.x) && (now.y === goal.y), `forcé : il arrive (${now.x},${now.y} / ${goal.x},${goal.y})`);
    let after = await ctx.messagesSince(since);
    ctx.expect(alerts(after).length === 1, `forcé : une alerte MJ (${alerts(after).length})`);
    await back();
    await pause(1000);

    // 2. Agrippé : un clic au sol.
    await script(`await canvas.scene.tokens.get("${fighter.id}").actor.toggleStatusEffect("grappled", { active: true }); return true;`);
    await pause(800);
    since = await ctx.lastMessageId();
    const near = { x: home.x + (2 * grid), y: home.y };
    await script(`${actions} moveTo(t, { x: ${near.x} + canvas.scene.grid.size / 2, y: ${near.y} + canvas.scene.grid.size / 2 }).catch(err => console.error(err)); return true;`);
    d = await legality();
    ctx.expect(!!d && /grappl|agripp|immobil/i.test(textOf(d)), `Agrippé : la fenêtre le dit (${textOf(d).slice(0, 160)})`);
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "go" });
    await pause(3500);
    now = await where();
    ctx.expect((now.x === near.x) && (now.y === near.y), `forcé : il y va (${now.x},${now.y} / ${near.x},${near.y})`);
    after = await ctx.messagesSince(since);
    ctx.expect(alerts(after).length === 1, `forcé : une alerte MJ (${alerts(after).length})`);
  }
};
