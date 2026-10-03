/**
 * Frappe occulte au toucher (§47 bis). Monde `ravenloft` : Kaalisti (Occultiste 5, Pacte de la lame, emplacement de pacte de
 * niveau 3) frappe Rahadin (à défaut, le Zombi) avec Porte-Fardeau, en combat.
 *  1. Au jet de dégâts du coup, la question propose la Frappe occulte : choisie → +(1 + niveau)d8 de force sur ce jet, un
 *     emplacement de pacte dépensé, la cible (taille M) À terre.
 *  2. Un second coup qui touche dans le même tour : la Frappe occulte n'est plus proposée (une fois par tour).
 * Non applicable sans Kaalisti. Remet l'emplacement, la marque du tour, les PV et l'état de la cible.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Frappe occulte — proposée au toucher, emplacement de pacte, À terre, une fois par tour",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Kaalisti") ) { ctx.log("Kaalisti absent : non applicable"); return; }
    const warlock = await ctx.token("Kaalisti");
    // Une cible qui survit au coup (le Zombi, 22 PV au plus, mourait de l'épée et des 4d8 : à 0 PV, pas d'À terre) : Rahadin (M).
    const target = tokens.find(t => /^Rahadin/.test(t.name)) ?? await ctx.token("Zombi");
    const actor = () => ctx.call("get-actor", { actorId: warlock.actorId });
    const pactValue = async () => Number((await actor()).system?.spells?.pact?.value) || 0;
    const slots0 = await pactValue();
    ctx.restore(() => ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "system.spells.pact.value": slots0 } }).catch(() => {}));
    await ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "system.spells.pact.value": 2 } });
    // La marque « une fois par tour » d'une passe précédente (Kaalisti peut être dans un combat de l'utilisateur, qui n'avance pas).
    const clearOnce = () => ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "flags.dnd5e-combat.oncePerTurn.-=eldritch-smite": null } }).catch(() => {});
    await clearOnce();
    ctx.restore(clearOnce);

    const hp0 = await ctx.hp(target);
    const home = await ctx.position(target);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(target, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.call("set-status", { tokenId: target.id, statusId: "prone", active: false }).catch(() => {}));
    const w = await ctx.position(warlock);
    await ctx.call("move-token", { tokenId: target.id, x: w.x + grid, y: w.y, elevation: w.elevation });
    await ctx.setHp(target, (await ctx.engine("stats", { tokenId: target.id }))?.hp?.max ?? hp0);

    await ctx.startCombat([warlock, target]);
    const sword = await ctx.itemId(warlock.id, "greatsword");
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(x => x.id);
    /** La question au toucher : rend ce qu'elle proposait, après avoir répondu par le bouton qui correspond à `pick`. */
    const answer = async (ids, pick, ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        const d = (r?.windows ?? []).find(x => /toucher|On hit|Châtiment|Smite/i.test(`${x.title ?? ""}`));
        if ( !d ) continue;
        const labels = (d.buttons ?? []).map(b => b.label ?? "");
        const b = (d.buttons ?? []).find(x => pick.test(x.label ?? "")) ?? (d.buttons ?? []).at(-1);
        await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
        return labels;
      }
      return null;
    };
    /** Kaalisti frappe jusqu'à toucher (10 essais) ; rend la question vue et le jet de dégâts. */
    const hits = async pick => {
      for ( let n = 0; n < 10; n++ ) {
        const ids = await known();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: warlock.id, itemId: sword, activityType: "attack", targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
        const asked = await answer(ids, pick);
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === target.name)?.hit !== true ) continue;
        await pause(2000);
        return { asked, damage: (await ctx.messagesSince(since)).find(m => m.type === "damage") };
      }
      return null;
    };

    const first = await hits(/Frappe occulte|Eldritch Smite/i);
    if ( !ctx.expect(!!first, `Porte-Fardeau touche ${target.name} (10 essais au plus)`) ) return;
    ctx.expect((first.asked ?? []).some(l => /Frappe occulte|Eldritch Smite/i.test(l)), `Frappe occulte proposée (${(first.asked ?? []).join(" / ") || "aucune question"})`);
    const smite = first.damage?.flags?.[MODULE_ID]?.smite;
    ctx.expect((smite?.kind === "rider") && (smite?.formula === "4d8") && (smite?.type === "force"), `+4d8 de force sur le jet (${JSON.stringify(smite)})`);
    ctx.expect((await pactValue()) === 1, `un emplacement de pacte dépensé (2 → ${await pactValue()})`);
    await pause(1500);
    const prone = (await ctx.engine("stats", { tokenId: target.id }))?.statuses?.includes("prone");
    ctx.expect(prone === true, `${target.name} est À terre (${prone})`);

    // Toujours le tour de Kaalisti : un second coup ne la propose plus.
    await ctx.call("set-status", { tokenId: target.id, statusId: "prone", active: false }).catch(() => {});
    const second = await hits(/Frappe occulte|Eldritch Smite/i);
    if ( !ctx.expect(!!second, "second coup qui touche (10 essais au plus)") ) return;
    ctx.expect(!(second.asked ?? []).some(l => /Frappe occulte|Eldritch Smite/i.test(l)), `une fois par tour : plus proposée (${(second.asked ?? []).join(" / ") || "aucune question"})`);
    ctx.expect((await pactValue()) === 1, `aucun autre emplacement dépensé (${await pactValue()})`);
  }
};
