/**
 * §120, monde `ravenloft` (fiche réelle d'Alara, dhampir clerc, qui connaît Caresse du vampire et a le don Survivant) :
 *  1. Caresse du vampire sur le Zombi au contact : chaque attaque qui touche rend à Alara la moitié (arrondie en dessous) des
 *     dégâts nécrotiques ; la relance, tant que la concentration tient, ne dépense pas d'emplacement.
 *  2. Survivant, Hypervigilance : un jet d'initiative dont le d20 fait 9 ou moins est relancé, et l'initiative corrigée de la
 *     différence des deux d20.
 * Remet PV, emplacements (filet de sécurité), concentration et combat.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Caresse du vampire (soin, relance) et Survivant (Hypervigilance) — Alara",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Alara", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Alara ou le Zombi absent : non applicable"); return; }
    const alara = await ctx.token("Alara");
    const zombi = await ctx.token("Zombi");
    const hpAlara = await ctx.hp(alara);
    const hpZombi = await ctx.hp(zombi);
    ctx.restore(async () => {
      await ctx.setHp(alara, hpAlara);
      await ctx.setHp(zombi, hpZombi);
      await ctx.removeEffectsNamed(alara, /concentr|Caresse|Vampiric/i);
    });
    const slots = async () => (await ctx.call("get-actor", { actorId: alara.actorId })).system?.spells?.spell3?.value ?? null;

    // 1. Caresse du vampire.
    const grid = await ctx.gridSize();
    const at = await ctx.position(alara);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y });
    await ctx.setHp(alara, 5);
    let hits = 0;
    for ( let n = 1; (n <= 12) && !hits; n++ ) {
      // Un lancement neuf à chaque essai : la concentration retirée, l'utilisation n'est pas une relance.
      await ctx.removeEffectsNamed(alara, /concentr/i);
      await pause(800);
      if ( (await ctx.hp(zombi)) < 8 ) await ctx.setHp(zombi, hpZombi);
      const before = await ctx.hp(alara);
      const used = await ctx.use({ tokenId: alara.id, identifier: "vampiric-touch", targetTokenIds: [zombi.id] });
      ctx.expect(used.used, `Caresse du vampire lancée (${n})`);
      if ( !used.used ) break;
      const r = await ctx.settle(used.usageMessageId);
      await pause(1500);
      const t = r.targets?.[0];
      const now = await ctx.hp(alara);
      if ( !t?.hit ) { ctx.expect(now === before, `attaque ${n} ratée : PV d'Alara inchangés (${now})`); continue; }
      hits++;
      const dealt = Number(t.damage?.applied ?? NaN);
      ctx.expect(now - before === Math.floor(dealt / 2), `attaque ${n} touchée, ${dealt} dégâts nécrotiques : Alara +${now - before} (moitié)`);
    }
    ctx.expect(hits > 0, "au moins une Caresse a touché");

    // La relance, concentration en cours : une nouvelle carte, notée relance, sans emplacement dépensé (consommation demandée).
    // Un emplacement de niveau 3 au moins, pour qu'une dépense se voie (le filet de sécurité remet ceux de la fiche).
    if ( !(await slots()) ) await ctx.call("update-actor", { actorId: alara.actorId, actorData: { "system.spells.spell3.value": 1 } });
    const slotsBefore = await slots();
    const since = await ctx.lastMessageId();
    const again = await ctx.use({ tokenId: alara.id, identifier: "vampiric-touch", targetTokenIds: [zombi.id], consume: true });
    let recast = null;
    for ( let w = 0; !recast && (w < 20); w++ ) {
      await pause(500);
      recast = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.recast) ?? null;
    }
    ctx.expect(!again.used && !!recast, "relancée tant que la concentration tient : carte de relance");
    ctx.expect((await slots()) === slotsBefore, `relance sans emplacement (niveau 3 : ${slotsBefore} → ${await slots()})`);
    await ctx.removeEffectsNamed(alara, /concentr/i);

    // 2. Hypervigilance.
    const combat = await ctx.startCombat([alara, zombi]);
    const cid = (combat.combatants ?? []).find(c => c.tokenId === alara.id)?.id
      ?? (await ctx.combat()).combatants?.find(c => c.tokenId === alara.id)?.id;
    // La question va au joueur d'Alara, sinon au MJ : sans propriétaire joueur dans ce monde, c'est une fenêtre chez le MJ.
    const known = async () => ((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id);
    let kept = 0, rerolled = 0;
    for ( let n = 1; (n <= 30) && !(kept && rerolled); n++ ) {
      const since = await ctx.lastMessageId();
      const before = await known();
      await ctx.call("roll-initiative", { combatId: ctx.ownCombat, combatantIds: [cid] });
      const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: before, waitMs: 3000 }).catch(() => null))?.windows?.[0] ?? null;
      const init0 = (await ctx.combat()).combatants?.find(c => c.id === cid)?.initiative;
      if ( !d ) { ctx.log(`initiative ${n} : ${init0}, pas de question (d20 au-dessus de 9)`); continue; }
      const choose = kept ? /Relancer|Reroll/i : /Garder|Keep/i;
      const b = (d.buttons ?? []).find(x => choose.test(x.label ?? ""));
      await ctx.call("answer-dialog", { id: d.id, button: b?.action ?? b?.label });
      await pause(2500);
      const { messages } = await ctx.call("list-chat-messages", { limit: 10, ...(since ? { sinceId: since } : {}) });
      const reroll = (messages ?? []).find(m => m.flags?.[MODULE_ID]?.rerollInitiative);
      const init = (await ctx.combat()).combatants?.find(c => c.id === cid)?.initiative;
      if ( !kept ) {
        kept++;
        ctx.expect(!reroll && (init === init0), `initiative ${n} : question posée, « Garder » → pas de relance (${init})`);
        continue;
      }
      rerolled++;
      const r = reroll?.flags?.[MODULE_ID]?.rerollInitiative;
      ctx.expect(!!r && (r.old <= 9), `initiative ${n} : « Relancer » → d20 ${r?.old} relancé → ${r?.new}`);
      ctx.expect(!!r && (Math.round(init - init0) === r.new - r.old), `initiative ${n} : ${init0} → ${init}`);
    }
    ctx.expect(kept && rerolled, "les deux réponses vues (garder, relancer)");
  }
};
