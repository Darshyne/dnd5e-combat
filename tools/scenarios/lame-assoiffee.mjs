/**
 * Lame assoiffée (SPEC §16.25) : l'action Attaquer de l'occultiste ouvre deux attaques. Monde `ravenloft` : Kaalisti, au
 * contact de Rahadin, à son tour de combat — la première attaque à l'épée à deux mains dépense l'action et en ouvre deux
 * (`attacks.granted`), la seconde est prise sans nouvelle action. Ailleurs : non applicable.
 */
const MODULE_ID = "dnd5e-combat";
const VICTIM = "Rahadin, chambellan du château";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "deux attaques — Lame assoiffée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Kaalisti") || !tokens.some(t => t.name === VICTIM) ) { ctx.log("Kaalisti ou Rahadin absent : non applicable"); return; }
    const kaalisti = await ctx.token("Kaalisti");
    const victim = await ctx.token(VICTIM);
    const grid = await ctx.gridSize();
    const at = await ctx.position(kaalisti);
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + grid, y: at.y });

    await ctx.startCombat([kaalisti, victim]);
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      const current = combat.combatants?.find(c => c.id === combat.currentCombatantId);
      if ( current?.tokenId === kaalisti.id ) break;
      await ctx.nextTurn();
      await sleep(800);
    }

    const spentOn = async usageMessageId => {
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
        const message = (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(m => m.id === usageMessageId);
        const spent = message?.flags?.[MODULE_ID]?.spent ?? message?.flags?.spent;
        if ( spent ) return spent;
      }
      return null;
    };
    const swing = async () => {
      const used = await ctx.use({ tokenId: kaalisti.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [victim.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      return spentOn(used.usageMessageId);
    };
    const first = await swing();
    ctx.expect(first?.after?.action === 0 && first?.after?.attacks?.granted === 2 && first?.after?.attacks?.used === 1,
      `1re attaque : action ${first?.before?.action} → ${first?.after?.action}, attaques ${first?.after?.attacks?.used}/${first?.after?.attacks?.granted}`);
    const second = await swing();
    ctx.expect(second?.after?.attacks?.used === 2 && second?.before?.action === 0,
      `2e attaque dans la même action : attaques ${second?.after?.attacks?.used}/${second?.after?.attacks?.granted}`);
  }
};
