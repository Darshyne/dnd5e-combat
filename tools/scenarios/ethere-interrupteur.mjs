/**
 * §225 : l'interrupteur du MJ « Plan Éthéré automatisé » (réglage de monde `etherealPlane`). Arène, le Zombi Éthéré.
 *  1. Allumé : action de déplacement « ethereal », le Trait de feu ne l'affecte pas, le Guerrier ne le voit pas.
 *  2. Coupé : son action d'avant revient, le Trait de feu l'affecte, le Guerrier le voit ; personne n'a bougé, aucun dégât de retour.
 *  3. Rallumé : action « ethereal » de nouveau, non affecté.
 * Remet le réglage, l'état, les PV.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "plan Éthéré — l'interrupteur du MJ coupe toute la gestion, sans rien déplacer",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Ensorceleur", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ensorceleur, Guerrier, Zombi requis : non applicable"); return; }
    const [sorc, fighter, zombi] = await Promise.all(["Ensorceleur", "Guerrier", "Zombi"].map(n => ctx.token(n)));
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const was = await ctx.engine("setting", { key: "etherealPlane", value: true });
    ctx.restore(async () => {
      await ctx.engine("setting", { key: "etherealPlane", value: was.before }).catch(() => {});
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "ethereal", active: false }).catch(() => {});
      await pause(1200);
      await ctx.setHp(zombi, hp0);
    });
    const action = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id })).data?.movementAction;
    const fireBolt = async () => {
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      return (await ctx.settle(used.usageMessageId)).targets.find(t => t.name === "Zombi");
    };
    const sees = async () => (await ctx.engine("sees", { observerId: fighter.id, targetId: zombi.id })).sees;

    // 1. Allumé.
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "ethereal", active: true });
    await pause(1500);
    ctx.expect((await action()) === "ethereal", `allumé : action « ethereal » (${await action()})`);
    ctx.expect((await fireBolt())?.unaffected?.reason === "plane", "allumé : le Trait de feu n'affecte pas le Zombi Éthéré");
    ctx.expect((await sees()) === false, "allumé : le Guerrier ne le voit pas");

    // 2. Coupé.
    await ctx.engine("setting", { key: "etherealPlane", value: false });
    await pause(2000);
    const off = await action();
    ctx.expect(off !== "ethereal", `coupé : son action d'avant revient (${off})`);
    const hpBefore = await ctx.hp(zombi);
    const t2 = await fireBolt();
    ctx.expect(!!t2 && !t2.unaffected, `coupé : le Trait de feu vise le Zombi (${t2 ? (t2.hit ? "touché" : "raté") : "—"})`);
    ctx.expect((await sees()) === true, "coupé : le Guerrier le voit");
    const pos = await ctx.position(zombi);
    ctx.expect((pos.x === home.x) && (pos.y === home.y), `coupé : personne n'a bougé (${pos.x}, ${pos.y})`);
    if ( !t2?.hit ) ctx.expect((await ctx.hp(zombi)) === hpBefore, "coupé : aucun dégât de retour");
    await ctx.setHp(zombi, hp0);

    // 3. Rallumé.
    await ctx.engine("setting", { key: "etherealPlane", value: true });
    await pause(2000);
    ctx.expect((await action()) === "ethereal", `rallumé : action « ethereal » de nouveau (${await action()})`);
    ctx.expect((await fireBolt())?.unaffected?.reason === "plane", "rallumé : de nouveau non affecté");
  }
};
