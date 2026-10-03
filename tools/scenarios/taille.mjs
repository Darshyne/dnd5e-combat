/**
 * Taille (Maître d'armes lourdes, SPEC §16.26) : après une créature abattue (ou un critique) à l'arme de corps à corps, la
 * même arme attaque pour une action Bonus. Monde `ravenloft` : Kaalisti, à son tour, abat Rahadin laissé à 1 PV — la visée
 * « Taille » s'ouvre sur le client de l'auteur (celui du MJ, ici : à voir à l'écran, clic droit pour la fermer) ; le
 * scénario attaque ensuite avec \`cost: "bonus"\` et vérifie la dépense : action Bonus débitée, action inchangée.
 * Ailleurs : non applicable.
 */
const MODULE_ID = "dnd5e-combat";
const VICTIM = "Rahadin, chambellan du château";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "attaque en action Bonus — Taille",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Kaalisti") || !tokens.some(t => t.name === VICTIM) ) { ctx.log("Kaalisti ou Rahadin absent : non applicable"); return; }
    const kaalisti = await ctx.token("Kaalisti");
    const victim = await ctx.token(VICTIM);
    const grid = await ctx.gridSize();
    const at = await ctx.position(kaalisti);
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + grid, y: at.y });

    await ctx.startCombat([kaalisti, victim]);
    const toKaalisti = async () => {
      for ( let i = 0; i < 3; i++ ) {
        const state = await ctx.combat();
        const combat = state.combat ?? state.combats?.[0] ?? state;
        if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId === kaalisti.id ) return;
        await ctx.nextTurn();
        await sleep(800);
      }
    };
    const spentOn = async usageMessageId => {
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
        const message = (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(m => m.id === usageMessageId);
        const spent = message?.flags?.[MODULE_ID]?.spent ?? message?.flags?.spent;
        if ( spent ) return spent;
      }
      return null;
    };

    // Kaalisti frappe jusqu'à abattre Rahadin (1 PV) ; seule la première attaque dépense l'action.
    // Deux attaques par tour (Lame assoiffée) ; les jets sont aléatoires : jusqu'à six tours.
    let felled = false;
    for ( let turn = 1; (turn <= 6) && !felled; turn++ ) {
      if ( turn > 1 ) { await ctx.nextTurn(); await sleep(800); }
      await toKaalisti();
      for ( let n = 1; (n <= 2) && !felled; n++ ) {
        await ctx.setHp(victim, 1);
        const used = await ctx.use({ tokenId: kaalisti.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [victim.id] });
        await ctx.settle(used.usageMessageId).catch(() => null);
        felled = (await ctx.hp(victim)) === 0;
      }
    }
    ctx.expect(felled, `${VICTIM} tombe sous l'épée de Kaalisti${felled ? " — la visée « Taille » s'ouvre à l'écran du MJ" : ""}`);
    if ( !felled ) return;

    await ctx.setHp(victim, 50);
    const hew = await ctx.use({ tokenId: kaalisti.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [victim.id],
      usageConfig: { [MODULE_ID]: { cost: "bonus" } } });
    await ctx.settle(hew.usageMessageId).catch(() => null);
    const spent = await spentOn(hew.usageMessageId);
    ctx.expect((spent?.before?.bonus === 1) && (spent?.after?.bonus === 0), `Taille : action Bonus ${spent?.before?.bonus} → ${spent?.after?.bonus}`);
    ctx.expect(spent?.after?.action === spent?.before?.action, `l'action n'est pas débitée une seconde fois (${spent?.before?.action} → ${spent?.after?.action})`);
  }
};
