/**
 * §282 : Inspiration héroïque, monde `dnd-6`, Arène de test. Le Guerrier (personnage joueur) reçoit l'Inspiration héroïque et attaque le
 * Zombi à l'épée à deux mains. Personne ne possède le Guerrier en ligne : la question s'ouvre chez le MJ, au premier plan, avant tout autre
 * dé. Vérifie :
 *  - attaque : « Relancer » → une carte de relance, le total de la résolution = total du jet − ancien d20 + nouveau d20, le verdict rejugé
 *    sur ce total (touché ⇔ critique, ou total ≥ CA hors 1 naturel), l'Inspiration dépensée ;
 *  - dégâts : l'attaque gardée (« Garder le jet »), puis sur un coup, la question des dégâts → le premier dé relancé ; les dégâts appliqués
 *    au Zombi = total du jet de dégâts − ancien dé + nouveau dé ;
 *  - sans Inspiration : aucune question.
 * Suppose le réglage de client `heroicInspiration` du MJ sur « À chaque jet » (défaut). Remet PV et Inspiration.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "heroique — Inspiration héroïque (attaque, dégâts)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Guerrier", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Guerrier et Zombi requis : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const sword = await ctx.itemId(fighter.id, "greatsword");
    const zhp = await ctx.hp(zombi);
    const pos = await ctx.position(fighter);
    const zpos = await ctx.position(zombi);
    const inspiredNow = async () => !!(await ctx.call("get-actor", { actorId: fighter.actorId }))?.system?.attributes?.inspiration;
    const was = await inspiredNow();
    const setInspiration = on => ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.inspiration": on } });
    ctx.restore(async () => {
      await setInspiration(was);
      await ctx.setHp(zombi, zhp);
      await ctx.call("move-token", { tokenId: fighter.id, x: pos.x, y: pos.y, elevation: pos.elevation ?? 0 }).catch(() => {});
    });
    // Au contact du Zombi, pour l'épée.
    const grid = await ctx.gridSize();
    await ctx.call("move-token", { tokenId: fighter.id, x: zpos.x - grid, y: zpos.y, elevation: 0 });
    await pause(800);

    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** Répond à la question héroïque qui s'ouvre (`pick` : l'expression du bouton) ; rend le texte vu, ou null. */
    const answer = async (ids, pick, ms=12000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const text = `${d.title ?? ""} ${d.content ?? d.text ?? ""}`;
          if ( !/h[ée]ro[iï]que|Heroic/i.test(text) ) continue;
          const b = (d.buttons ?? []).find(x => pick.test(x.label ?? ""));
          if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
          return { text, buttons: (d.buttons ?? []).map(x => x.label) };
        }
      }
      return null;
    };
    const attack = () => ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [zombi.id],
      usageConfig: { [MODULE_ID]: { confirmed: true } } });

    // 1. Attaque relancée.
    await setInspiration(true);
    await ctx.setHp(zombi, zhp);
    {
      const ids = await known();
      const since = await ctx.lastMessageId();
      const u = await attack();
      const seen = await answer(ids, /Relancer|Reroll/i);
      ctx.expect(!!seen, `attaque : la question héroïque s'ouvre${seen ? ` (${seen.buttons.join(" / ")})` : ""}`);
      // Reconnaissable : le titre et le bandeau la nomment, la règle est rappelée.
      ctx.expect(!!seen && /(Heroic Inspiration|Inspiration héroïque).*(Heroic Inspiration|Inspiration héroïque)/is.test(seen.text)
        && /Reroll a die you just rolled|Relancez un dé que vous venez de lancer/i.test(seen.text),
        `attaque : la fenêtre nomme l'Inspiration héroïque (titre et bandeau) et rappelle la règle`);
      // Les dégâts d'un coup posent leur propre question : garder.
      const damageIds = await known();
      const later = answer(damageIds, /Garder|Keep/i, 15000);
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await later;
      await pause(1000);
      const msgs = await ctx.messagesSince(since);
      const raw = msgs.find(m => m.type === "attack")?.rolls?.[0]?.total;
      const card = msgs.find(m => m.flags?.[MODULE_ID]?.heroic?.kind === "d20")?.flags?.[MODULE_ID]?.heroic;
      const t = r?.targets?.[0];
      const roll = r?.attack?.roll ?? {};
      ctx.expect(!!card, `attaque : carte de relance (d20 ${card?.old} → ${card?.new})`);
      ctx.expect(Number.isFinite(raw) && card && (roll.total === raw - card.old + card.new),
        `attaque : total ${raw} − ${card?.old} + ${card?.new} = ${roll.total}`);
      const should = roll.isCritical || (!roll.isFumble && (roll.total >= t?.ac));
      ctx.expect(t && (t.hit === should), `attaque : ${roll.total} contre CA ${t?.ac} → ${t?.hit ? "touché" : "raté"}, comme il se doit`);
      ctx.expect(!(await inspiredNow()), "attaque : l'Inspiration est dépensée");
    }

    // 2. Dégâts relancés : l'attaque gardée, jusqu'à un coup.
    let damaged = false;
    for ( let n = 0; (n < 12) && !damaged; n++ ) {
      await setInspiration(true);
      await ctx.setHp(zombi, zhp);
      const ids = await known();
      const since = await ctx.lastMessageId();
      const before = await ctx.hp(zombi);
      const u = await attack();
      await answer(ids, /Garder|Keep/i);
      const ids2 = await known();
      const dmg = answer(ids2, /^d\d+/i, 15000);
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const seen = await dmg;
      if ( !r?.targets?.[0]?.hit ) continue;
      await pause(1200);
      const msgs = await ctx.messagesSince(since);
      const rolled = msgs.find(m => m.type === "damage")?.rolls?.reduce((s, x) => s + (x.total ?? 0), 0);
      const card = msgs.find(m => m.flags?.[MODULE_ID]?.heroic?.kind === "damage")?.flags?.[MODULE_ID]?.heroic;
      ctx.expect(!!seen && !!card, `dégâts : question et carte de relance (d${card?.faces} ${card?.old} → ${card?.new})`);
      const expected = card ? Math.max(0, rolled - card.old + card.new) : rolled;
      const applied = r.targets[0].damage?.applied;
      ctx.expect(applied === Math.min(expected, before), `dégâts : ${rolled} − ${card?.old} + ${card?.new} = ${expected}, appliqués ${applied}`);
      ctx.expect(!(await inspiredNow()), "dégâts : l'Inspiration est dépensée");
      damaged = true;
    }
    ctx.expect(damaged, "dégâts : un coup en douze essais");

    // 3. Sans Inspiration : pas de question.
    await setInspiration(false);
    {
      const ids = await known();
      const u = await attack();
      const seen = await answer(ids, /$^/, 5000);
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      ctx.expect(!seen, "sans Inspiration : aucune question");
    }
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
