/**
 * Armes de sort (SPEC §16.41). Monde `ravenloft` : Sylaene (druide 5), Bramo (un Bâton non magique).
 *  1. Lame de feu : « Invoquer une lame » pose une trace sur Sylaene — icône sur le token, lumière (`token.light.*`), liée à la
 *     concentration ; la concentration retirée, la trace part.
 *  2. Arme élémentaire (profil Feu +1, l'arme passée d'office : la fenêtre des armes demande un clic) : le Bâton de Bramo reçoit
 *     l'enchantement, lié à la concentration de Sylaene ; la concentration retirée, l'enchantement part.
 * Non applicable sans Sylaene et Bramo.
 */
const MODULE_ID = "dnd5e-combat";
const FIRE_PLUS_ONE = "JSh7FcMkMvrPuUze";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "armes de sort — Lame de feu, Arme élémentaire",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Sylaene", "Bramo"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Sylaene ou Bramo absent : non applicable"); return; }
    const druid = await ctx.token("Sylaene");
    const bramo = await ctx.token("Bramo");
    const actorOf = id => ctx.call("get-actor", { actorId: id });
    const concentrations = async () => ((await actorOf(druid.actorId)).effects ?? []).filter(e => (e.statuses ?? []).includes("concentrating"));
    const dropConcentration = async () => {
      for ( const e of await concentrations() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: druid.actorId, effectId: e._id }).catch(() => {});
      await pause(2500);
    };
    ctx.restore(dropConcentration);
    ctx.restore(() => ctx.removeEffectsNamed(druid, /Lame de feu|Flame Blade/i));

    // 1. Lame de feu.
    const blade = await ctx.use({ tokenId: druid.id, identifier: "flame-blade", activityId: "OIU1htXAoSF0cU3U" });
    ctx.expect(blade.used, "« Invoquer une lame » utilisé");
    await pause(2500);
    const trace = ((await actorOf(druid.actorId)).effects ?? []).find(e => e.flags?.[MODULE_ID]?.trace);
    ctx.expect(!!trace, `trace posée sur Sylaene (${trace?.name})`);
    ctx.expect(trace?.showIcon === CONST_ALWAYS, `icône toujours visible sur le token (showIcon ${trace?.showIcon})`);
    const changes = trace?.system?.changes ?? trace?.changes ?? [];
    const dim = changes.find(c => c.key === "token.light.dim");
    const bright = changes.find(c => c.key === "token.light.bright");
    ctx.expect(!!dim && !!bright, `la lame éclaire (vive ${bright?.value}, faible ${dim?.value})`);
    ctx.expect(!!trace?.flags?.[MODULE_ID]?.traceConcentration, "trace liée à la concentration");
    await dropConcentration();
    const after = ((await actorOf(druid.actorId)).effects ?? []).find(e => e.flags?.[MODULE_ID]?.trace);
    ctx.expect(!after, "concentration retirée : la lame disparaît");

    // 1 bis. Flammes : trace visible, lumière 20/40, coût « action Bonus » sur la carte ; relancée, la flamme est remplacée.
    ctx.restore(() => ctx.removeEffectsNamed(druid, /Flammes|Produce Flame/i));
    const flameTraces = async () => ((await actorOf(druid.actorId)).effects ?? []).filter(e => /produce-flame|Flammes/i.test(e.name ?? "") && e.flags?.[MODULE_ID]?.trace);
    const cast = await ctx.use({ tokenId: druid.id, identifier: "produce-flame", activityId: "MModRd17Oi6hhztj" });
    ctx.expect(cast.used, "Flammes : « Incanter » utilisé");
    await pause(2500);
    const flame = (await flameTraces())[0];
    const fc = flame?.system?.changes ?? flame?.changes ?? [];
    ctx.expect(!!flame && flame.showIcon === CONST_ALWAYS, `Flammes : trace visible sur le token (${flame?.name})`);
    ctx.expect(fc.some(c => (c.key === "token.light.bright") && (String(c.value) === "20")) && fc.some(c => (c.key === "token.light.dim") && (String(c.value) === "40")), "Flammes : lumière vive 20, faible 40");
    const card = (await ctx.messagesSince(cast.usageMessageId)).find(m => m.id === cast.usageMessageId) ?? (await ctx.call("list-chat-messages", { limit: 10, flagScope: MODULE_ID })).messages?.find(m => m.id === cast.usageMessageId);
    const cost = card?.flags?.[MODULE_ID]?.cost ?? card?.flags?.cost;
    ctx.expect(cost === "bonus", `Flammes : coûte l'action Bonus (carte : ${cost})`);
    await ctx.use({ tokenId: druid.id, identifier: "produce-flame", activityId: "MModRd17Oi6hhztj" });
    await pause(2500);
    ctx.expect((await flameTraces()).length === 1, "Flammes relancé : une seule flamme");
    await ctx.removeEffectsNamed(druid, /Flammes|Produce Flame/i);

    // 2. Arme élémentaire sur le Bâton de Bramo.
    const staff = ((await actorOf(bramo.actorId)).items ?? []).find(i => i.type === "weapon" && i.system?.identifier === "staff");
    ctx.expect(!!staff, "Bramo a un Bâton");
    if ( !staff ) return;
    const staffUuid = `Actor.${bramo.actorId}.Item.${staff._id}`;
    const enchantments = async () => ((await actorOf(bramo.actorId)).items ?? []).find(i => i._id === staff._id)?.effects ?? [];
    ctx.restore(async () => {
      for ( const e of await enchantments() ) await ctx.call("remove-embedded-effect", { uuid: staffUuid, effectId: e._id }).catch(() => {});
    });
    const used = await ctx.use({ tokenId: druid.id, identifier: "elemental-weapon", activityType: "enchant",
      usageConfig: { enchantmentProfile: FIRE_PLUS_ONE, [MODULE_ID]: { enchantItem: staffUuid } } });
    ctx.expect(used.used, "Arme élémentaire utilisée");
    await pause(3000);
    const ench = (await enchantments()).find(e => e.flags?.dnd5e?.enchantmentProfile === FIRE_PLUS_ONE);
    ctx.expect(!!ench, `le Bâton de Bramo est enchanté (${ench?.name})`);
    ctx.expect(!!ench?.flags?.dnd5e?.dependentOn, "l'enchantement dépend de la concentration de Sylaene");
    ctx.expect(!!ench?.duration?.value || !!ench?.duration?.seconds, `il a une durée (${JSON.stringify(ench?.duration)})`);
    await dropConcentration();
    ctx.expect(!(await enchantments()).some(e => e.flags?.dnd5e?.enchantmentProfile === FIRE_PLUS_ONE), "concentration retirée : l'enchantement disparaît");
  }
};

const CONST_ALWAYS = 2;   // CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS (common/constants.mjs:168)
