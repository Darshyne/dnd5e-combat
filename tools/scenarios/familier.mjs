/**
 * Familiers (SPEC §107), monde `dnd-6`. Le Magicien reçoit Appel de familier (Manuel des joueurs) ; le familier est invoqué par
 * `api.mcp.summonAt` (la créature fournie : la Stryge du monde, pour ne rien importer). Vérifie :
 *  - à l'invocation : reconnu comme familier, vision activée, actions de base sans l'attaque à mains nues (Soutien compris) ;
 *  - hors combat : le congé dans la poche dimensionnelle (token retiré, poche notée avec ses PV) ; le rappel refusé trop loin
 *    et sur une case occupée ; accepté à deux cases (token recréé, mêmes PV, vision et actions de base, poche vide) ;
 *  - en combat, au tour du Magicien : le congé coûte son action (budget), le rappel ensuite la demande encore — « Utiliser
 *    quand même » (fenêtre du mode souple chez le MJ) — et le familier rentre au combat avec sa propre initiative.
 * Remet combat, poche, items prêtés ; retire le familier.
 */
const SPELL = "Compendium.dnd-players-handbook.spells.Item.phbsplFindFamili";
const CREATURE = "Actor.mmStirge00000000";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "familier — actions de base, vision, poche dimensionnelle",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien ou Zombi absent : non applicable"); return; }
    const wizard = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const spellId = await ctx.ensureItem(wizard, SPELL);
    const grid = await ctx.gridSize();
    const home = await ctx.position(wizard);
    const tokens0 = new Set(tokens.map(t => t.id));
    ctx.restore(async () => {
      await ctx.engine("familiar", { tokenId: wizard.id, clear: true }).catch(() => {});
      for ( const t of (await ctx.liveTokens()).filter(t => !tokens0.has(t.id)) ) {
        await ctx.call("delete-scene-object", { type: "Token", objectId: t.id }).catch(() => {});
      }
    });
    const state = id => ctx.engine("familiar", { tokenId: id });
    const familiarsNow = async () => (await ctx.liveTokens()).filter(t => !tokens0.has(t.id));
    const center = (cx, cy) => ({ x: home.x + (cx * grid) + (grid / 2), y: home.y + (cy * grid) + (grid / 2) });

    // 1. L'invocation.
    const s = await ctx.engine("summonAt", { tokenId: wizard.id, itemId: spellId, actorUuid: CREATURE, x: home.x + (2 * grid), y: home.y });
    await pause(2500);
    const fam = s?.tokens?.[0];
    if ( !ctx.expect(!!fam, `le familier est invoqué (${fam?.name ?? "rien"})`) ) return;
    let st = await state(fam.id);
    ctx.expect(st.familiar === true, "reconnu comme familier");
    ctx.expect(st.sight === true, "vision activée sur son token");
    ctx.expect(st.basics.includes("help") && st.basics.includes("dodge") && !st.basics.includes("unarmed"),
      `actions de base sans l'attaque (${st.basics.join(", ")})`);
    ctx.expect(st.canPocket === true, "le MJ peut le congédier");
    const hp0 = (await ctx.engine("stats", { tokenId: fam.id })).hp.value;

    // 2. Hors combat : la poche, puis le rappel.
    const out = await ctx.engine("familiarPocket", { tokenId: fam.id });
    await pause(1500);
    ctx.expect(out.done === true, "congédié dans la poche dimensionnelle");
    ctx.expect(!(await familiarsNow()).length, "son token est retiré de la scène");
    st = await state(wizard.id);
    ctx.expect(!!st.pocket && (st.pocket.hp === null || st.pocket.hp === hp0), `la poche du Magicien le garde (${JSON.stringify(st.pocket)})`);
    ctx.expect(st.canRecall === true, "le Magicien peut le rappeler");
    const far = await ctx.engine("familiarRecall", { tokenId: wizard.id, point: center(9, 0) });
    ctx.expect(!far.done && !!far.refusal, `à 45 ft : refusé (${far.refusal})`);
    const busy = await ctx.engine("familiarRecall", { tokenId: wizard.id, point: center(0, 0) });
    ctx.expect(!busy.done && !!busy.refusal, `sur la case du Magicien : refusé (${busy.refusal})`);
    const back = await ctx.engine("familiarRecall", { tokenId: wizard.id, point: center(0, 2) });
    await pause(2000);
    ctx.expect(back.done === true, "rappelé à deux cases");
    const again = (await familiarsNow())[0];
    if ( !ctx.expect(!!again, "son token est revenu") ) return;
    st = await state(again.id);
    ctx.expect(st.familiar && st.sight && st.basics.includes("help") && !st.basics.includes("unarmed"), "toujours familier, vision et actions de base");
    ctx.expect((await ctx.engine("stats", { tokenId: again.id })).hp.value === hp0, `mêmes PV (${hp0})`);
    ctx.expect(!(await state(wizard.id)).pocket, "la poche est vide");

    // 3. En combat, au tour du Magicien.
    await ctx.startCombat([wizard, zombi]);
    const combat = await ctx.combat();
    for ( const [t, value] of [[wizard, 20], [zombi, 10]] ) {
      const cb = (combat.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
      if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
    }
    await pause(1000);
    const inCombat = await ctx.engine("familiarPocket", { tokenId: again.id });
    await pause(1500);
    ctx.expect(inCombat.done === true, "en combat : congédié");
    const budget = await ctx.engine("budget", { tokenId: wizard.id });
    ctx.expect(budget?.action === 0 || budget?.action === false, `l'action du Magicien est dépensée (${JSON.stringify(budget)})`);
    // Le rappel demande encore une action : la fenêtre du mode souple s'ouvre chez le MJ, on répond « Utiliser quand même ».
    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const pending = ctx.engine("familiarRecall", { tokenId: wizard.id, point: center(2, 0) }).catch(err => ({ error: String(err) }));
    const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 6000 }).catch(() => null))?.windows?.[0];
    ctx.expect(!!d, `sans action, le rappel demande confirmation (${d?.title ?? "aucune fenêtre"})`);
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "go" });
    const recalled = await pending;
    await pause(2500);
    ctx.expect(recalled.done === true, "rappelé quand même");
    const third = (await familiarsNow())[0];
    const cbs = (await ctx.combat()).combatants ?? [];
    const joined = third ? cbs.find(c => c.tokenId === third.id) : null;
    ctx.expect(!!joined, `il rentre au combat (initiative ${joined?.initiative ?? "?"})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
