/**
 * §381 (issue #35) : qui la table attend — Arène, le Zombi. Le client du MJ ouvre une vraie fenêtre du moteur (`timedWait`, celle des
 * réactions et des choix), marquée pour le Zombi.
 *  1. Ouverte : une attente « reaction » au nom du MJ, sur le token du Zombi, avec son délai, sans rien de ce qu'elle demande ;
 *     répondue (`answer-dialog`) : l'attente tombe.
 *  2. Laissée sans réponse (délai court) : elle se résout seule et l'attente tombe.
 *  3. Annulée (fenêtre fermée sans choisir) : l'attente tombe.
 * Le dessin du sablier et ce qu'en voit un joueur se vérifient au navigateur (un seul client ici).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "attente — sablier : publiée à l'ouverture, retirée à la réponse, au délai, à l'annulation",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Zombi") ) { ctx.log("Zombi requis : non applicable"); return; }
    const zombie = await ctx.token("Zombi");
    const list = async () => (await ctx.engine("awaiting", { action: "list" })) ?? [];
    const ours = async () => (await list()).filter(e => e.token?.endsWith(`Token.${zombie.id}`));
    const result = () => ctx.engine("awaiting", { action: "result" });
    const probeDialog = async (ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => /DAS awaiting probe/.test(w.title ?? ""));
        if ( d ) return d;
      }
      return null;
    };
    const settled = async (ms=20000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; await pause(300) ) {
        const r = await result();
        if ( r.done ) return r;
      }
      return result();
    };
    ctx.restore(async () => {
      const d = await probeDialog(500);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "no" }).catch(() => {});
    });

    // 1. Répondue.
    await ctx.engine("awaiting", { action: "open", tokenId: zombie.id, kind: "reaction", seconds: 30 });
    const open = await ours();
    ctx.expect(open.length === 1, `une attente publiée pour le Zombi (${open.length})`);
    const e = open[0] ?? {};
    ctx.expect(e.kind === "reaction" && e.gm === true && e.seconds === 30, `sorte « reaction », fenêtre du MJ, délai 30 s (${e.kind}, ${e.gm}, ${e.seconds})`);
    const keys = Object.keys(e).sort().join(",");
    ctx.expect(keys === "actor,gm,id,kind,player,refreshed,seconds,since,token,userId,userName", `rien d'autre que la forme publique (${keys})`);
    ctx.expect(!JSON.stringify(e).includes("probe"), "rien de ce que la fenêtre demande");
    const d1 = await probeDialog();
    if ( ctx.expect(!!d1, "la fenêtre est ouverte chez le MJ") ) await ctx.call("answer-dialog", { id: d1.id, button: "yes" });
    const r1 = await settled();
    ctx.expect(r1.value === "yes", `la réponse revient (${r1.value})`);
    ctx.expect(!(await ours()).length, "répondue : l'attente est retirée");

    // 2. Délai.
    await ctx.engine("awaiting", { action: "open", tokenId: zombie.id, kind: "choice", seconds: 3 });
    ctx.expect((await ours()).length === 1, "délai : une attente publiée");
    const r2 = await settled(12000);
    ctx.expect(r2.value === "timeout", `au bout du délai, la réponse par défaut (${r2.value})`);
    ctx.expect(!(await ours()).length, "délai : l'attente est retirée");

    // 3. Annulée.
    await ctx.engine("awaiting", { action: "open", tokenId: zombie.id, kind: "roll", seconds: 30 });
    const d3 = await probeDialog();
    if ( ctx.expect(!!d3, "annulation : la fenêtre est ouverte") ) await ctx.call("answer-dialog", { id: d3.id, close: true }).catch(async () => {
      await ctx.call("answer-dialog", { id: d3.id, button: "no" });
    });
    await settled();
    ctx.expect(!(await ours()).length, "annulée : l'attente est retirée");

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
