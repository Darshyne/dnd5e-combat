/**
 * §414 : l'Égide arcanique (B14, §16.11 ; Égide projetée §38 ; Lien protecteur §156) dans des conditions de jeu réalistes, sur
 * l'« Arène de l'abjuration » (`node tools/arene-abjuration.mjs`) : un Magicien abjurateur de niveau 6 (Int 18, 40 PV), un Guerrier
 * allié (60 PV) à 10 ft, un Ogre (gourdin 2d8 + 4) qui les touche tous deux. Remplace, pour l'égide, les tokens partagés de l'Arène de
 * test (`reduction`), dont l'état laissé par d'autres scénarios faussait le résultat (2026-11-12). Vérifie, dans l'ordre :
 *  1. Création : l'activité « créer l'égide » donne une réserve de 2 × niveau + mod. d'Int = 16, pleine.
 *  2. Absorption : un coup de l'Ogre sur l'Abjurateur — la réserve prend ce qu'elle peut, les PV le reste ; carte « absorbe ».
 *  3. Recharge : un sort d'abjuration lancé avec un emplacement rend 2 × son niveau (Armure du mage au niveau 1 : +2, au niveau 2 : +4),
 *     l'emplacement est dépensé ; un tour de magie (Rayon de givre) ne recharge rien.
 *  4. Lien protecteur, égide pleine : l'Ogre touche le Protégé (Résistance du Lien : moitié) ; l'Abjurateur subit le même montant, que
 *     son égide absorbe (ce sont des dégâts qu'il subit) — ses PV ne bougent pas.
 *  5. Lien protecteur, égide vide : les mêmes dégâts partagés font baisser les PV de l'Abjurateur.
 *  6. Égide projetée (réaction) : l'Ogre touche le Protégé, l'égide de l'Abjurateur absorbe à sa place ; vide, le Protégé subit le reste.
 * Tout se remet : PV, réserve, emplacements, effets (le lanceur ajoute son filet de sécurité).
 */
const MODULE_ID = "dnd5e-combat";
const CREATE = "Hha69hPMTYWhDE4A";
const pause = ms => new Promise(r => setTimeout(r, ms));
const sum = rolls => (rolls ?? []).reduce((s, r) => s + (r.total ?? 0), 0);

export default {
  name: "égide de l'abjurateur — création, absorption, recharge, Lien protecteur, Égide projetée",
  scene: "Arène de l'abjuration",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Abjurateur", "Protégé", "Ogre"].every(n => tokens.some(t => t.name === n)) ) {
      ctx.log("Abjurateur, Protégé ou Ogre absent (node tools/arene-abjuration.mjs) : non applicable");
      return;
    }
    const abj = await ctx.token("Abjurateur");
    const prot = await ctx.token("Protégé");
    const ogre = await ctx.token("Ogre");
    const id = {};
    for ( const k of ["arcane-ward", "projected-ward", "warding-bond", "mage-armor", "ray-of-frost"] ) id[k] = await ctx.itemId(abj.id, k).catch(() => null);
    if ( !ctx.expect(!!id["arcane-ward"] && !!id["warding-bond"] && !!id["mage-armor"], "l'Abjurateur a l'Égide arcanique, le Lien protecteur et l'Armure du mage") ) return;
    const ogreItems = (await ctx.call("get-actor", { actorId: ogre.actorId })).items ?? [];
    const club = ogreItems.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!club, `l'Ogre a une arme (${club?.name})`) ) return;

    /** L'état préparé, lu chez le MJ : PV, réserve de l'égide (max calculé par dnd5e), création, emplacements, effets. */
    const live = async () => (await ctx.call("run-script", { waitMs: 8000, args: { abj: abj.id, prot: prot.id, ward: id["arcane-ward"] }, code: `
      const A = canvas.tokens.get(args.abj).actor, P = canvas.tokens.get(args.prot).actor, w = A.items.get(args.ward);
      const hp = a => ({ value: a.system.attributes.hp.value, temp: a.system.attributes.hp.temp || 0, max: a.system.attributes.hp.max });
      return { abj: hp(A), prot: hp(P), ward: { max: Number(w.system.uses.max) || 0, value: Number(w.system.uses.value) || 0, spent: Number(w.system.uses.spent) || 0,
          created: (w.system.activities.get("${CREATE}")?.uses?.spent ?? 0) > 0 },
        level: A.items.find(i => i.type === "class")?.system.levels, intMod: A.system.abilities.int.mod,
        slots: { 1: A.system.spells.spell1.value, 2: A.system.spells.spell2.value },
        effects: { abj: A.effects.map(e => e.name), prot: P.effects.map(e => e.name) } };` })).result;
    /** Remet PV et réserve (dépense, création). */
    const set = async ({ abjHp, protHp, spent, created } = {}) => ctx.call("run-script", { waitMs: 8000,
      args: { abj: abj.id, prot: prot.id, ward: id["arcane-ward"], abjHp, protHp, spent, created }, code: `
      const A = canvas.tokens.get(args.abj).actor, P = canvas.tokens.get(args.prot).actor, w = A.items.get(args.ward);
      if ( args.abjHp != null ) await A.update({ "system.attributes.hp.value": args.abjHp, "system.attributes.hp.temp": 0 });
      if ( args.protHp != null ) await P.update({ "system.attributes.hp.value": args.protHp, "system.attributes.hp.temp": 0 });
      const upd = {};
      if ( args.spent != null ) upd["system.uses.spent"] = args.spent;
      if ( args.created != null ) upd["system.activities.${CREATE}.uses.spent"] = args.created ? 1 : 0;
      if ( Object.keys(upd).length ) await w.update(upd);
      return true;` });

    const s0 = await live();
    ctx.log(`départ : niveau ${s0.level}, Int ${s0.intMod >= 0 ? "+" : ""}${s0.intMod}, Abjurateur ${s0.abj.value}/${s0.abj.max}, Protégé ${s0.prot.value}/${s0.prot.max}, emplacements ${JSON.stringify(s0.slots)}`);
    const effects0 = { abj: new Set(s0.effects.abj), prot: new Set(s0.effects.prot) };
    ctx.restore(() => set({ abjHp: s0.abj.max, protHp: s0.prot.max, spent: 0, created: false }));
    ctx.restore(async () => {
      for ( const [t, key] of [[abj, "abj"], [prot, "prot"]] ) {
        const fresh = (await ctx.effects(t)).filter(e => !effects0[key].has(e.name) && !e.flags?.[MODULE_ID]?.aura);
        for ( const e of fresh ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    ctx.restore(() => ctx.call("run-script", { args: { abj: abj.id, slots: s0.slots }, code: `
      const A = canvas.tokens.get(args.abj).actor;
      await A.update({ "system.spells.spell1.value": args.slots[1], "system.spells.spell2.value": args.slots[2] }); return true;` }));

    /** L'Ogre frappe `target` (PV pleins) jusqu'à toucher. `react` : « none » (personne ne réagit) ou « first » (Égide projetée). */
    const strike = async (target, react = "none") => {
      for ( let i = 0; i < 20; i++ ) {
        await set({ abjHp: s0.abj.max, protHp: s0.prot.max });
        const before = await live();
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: ogre.id, itemId: club._id, activityType: "attack", targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { autoReact: react } } });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !r?.targets?.find(t => t.name === target.name)?.hit ) continue;
        await pause(2500);
        const msgs = await ctx.messagesSince(since);
        return { before, after: await live(), dealt: sum(msgs.find(m => m.type === "damage")?.rolls), msgs };
      }
      return null;
    };

    // 1. Création de l'égide.
    await set({ abjHp: s0.abj.max, protHp: s0.prot.max, spent: 0, created: false });
    await ctx.use({ tokenId: abj.id, itemId: id["arcane-ward"], activityId: CREATE, consume: true });
    await pause(1500);
    const s1 = await live();
    const expected = 2 * (s1.level ?? 0) + (s1.intMod ?? 0);
    ctx.expect(s1.ward.created, "« créer l'égide » utilisé (une fois par repos long)");
    ctx.expect(s1.ward.max === expected, `réserve de l'égide = 2 × niveau ${s1.level} + Int ${s1.intMod} = ${expected} (lu : ${s1.ward.max})`);
    ctx.expect(s1.ward.value === s1.ward.max, `égide pleine à la création (${s1.ward.value}/${s1.ward.max})`);

    // 2. Absorption sur l'Abjurateur.
    await set({ spent: 0 });
    const hit = await strike(abj);
    if ( ctx.expect(!!hit, "l'Ogre touche l'Abjurateur (20 essais au plus)") ) {
      const absorbed = hit.after.ward.spent - hit.before.ward.spent;
      const lost = hit.before.abj.value - hit.after.abj.value;
      const want = Math.min(hit.before.ward.value, hit.dealt);
      ctx.expect(absorbed === want, `l'égide absorbe ${absorbed} (jet ${hit.dealt}, réserve ${hit.before.ward.value} : attendu ${want})`);
      ctx.expect(lost === Math.min(hit.before.abj.value, hit.dealt - want), `l'Abjurateur ne perd que le reste : ${lost} PV`);
      ctx.expect(hit.msgs.some(m => m.flags?.[MODULE_ID]?.absorbed || /absorb/i.test(`${m.content ?? ""} ${m.text ?? ""}`)), "une carte dit ce que l'égide a absorbé");
    }

    // 3. Recharge par un sort d'abjuration lancé avec un emplacement.
    const recharge = async (level, label) => {
      await set({ spent: 10 });
      const b = await live();
      await ctx.use({ tokenId: abj.id, itemId: id["mage-armor"], activityType: "utility", targetTokenIds: [abj.id], consume: true,
        usageConfig: { spell: { slot: `spell${level}` } } });
      await pause(2000);
      const a = await live();
      ctx.expect(a.ward.spent === b.ward.spent - 2 * level, `${label} : l'égide regagne ${2 * level} (dépensé ${b.ward.spent} → ${a.ward.spent})`);
      ctx.expect(a.slots[level] === b.slots[level] - 1, `${label} : un emplacement de niveau ${level} dépensé (${b.slots[level]} → ${a.slots[level]})`);
    };
    await recharge(1, "Armure du mage au niveau 1");
    await recharge(2, "Armure du mage au niveau 2");
    // Un tour de magie (Rayon de givre sur l'Ogre : une attaque, sans fenêtre) ne recharge rien.
    if ( id["ray-of-frost"] ) {
      await set({ spent: 10 });
      const u = await ctx.use({ tokenId: abj.id, itemId: id["ray-of-frost"], activityType: "attack", targetTokenIds: [ogre.id],
        usageConfig: { [MODULE_ID]: { autoReact: "none" } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      ctx.expect((await live()).ward.spent === 10, "un tour de magie (Rayon de givre) ne recharge rien");
    }

    // 4. Lien protecteur, égide pleine : l'égide prend les dégâts partagés.
    await set({ spent: 0 });
    await ctx.use({ tokenId: abj.id, itemId: id["warding-bond"], activityType: "utility", targetTokenIds: [prot.id], consume: true,
      usageConfig: { spell: { slot: "spell2" } } });
    await pause(2000);
    const bonded = await live();
    ctx.expect(bonded.effects.prot.some(n => /Warding Bond|Bonded|Lien protecteur|Lié/i.test(n)), `le Protégé porte le Lien protecteur (${bonded.effects.prot.join(", ")})`);
    const shared = async label => {
      const h = await strike(prot);
      if ( !ctx.expect(!!h, `${label} : l'Ogre touche le Protégé (20 essais au plus)`) ) return null;
      const lostProt = h.before.prot.value - h.after.prot.value;
      const absorbed = h.after.ward.spent - h.before.ward.spent;
      const lostAbj = h.before.abj.value - h.after.abj.value;
      ctx.log(`${label} : jet ${h.dealt}, Protégé −${lostProt}, égide −${absorbed} (réserve ${h.before.ward.value}), Abjurateur −${lostAbj}`);
      ctx.expect(lostProt === Math.floor(h.dealt / 2), `${label} : Résistance du Lien, le Protégé perd la moitié (${lostProt} pour ${h.dealt})`);
      ctx.expect(h.msgs.some(m => m.flags?.[MODULE_ID]?.shared), `${label} : le partage est annoncé`);
      return { h, lostProt, absorbed, lostAbj };
    };
    const full = await shared("égide pleine");
    if ( full ) {
      const want = Math.min(full.h.before.ward.value, full.lostProt);
      ctx.expect(full.absorbed === want, `égide pleine : elle absorbe les ${full.lostProt} partagés (${full.absorbed})`);
      ctx.expect(full.lostAbj === full.lostProt - want, `égide pleine : l'Abjurateur perd ${full.lostAbj} PV (attendu ${full.lostProt - want})`);
    }

    // 5. Lien protecteur, égide vide : l'Abjurateur subit les dégâts partagés.
    await set({ spent: s1.ward.max });
    const empty = await shared("égide vide");
    if ( empty ) {
      ctx.expect(empty.absorbed === 0, `égide vide : rien d'absorbé (${empty.absorbed})`);
      ctx.expect(empty.lostAbj === empty.lostProt && empty.lostAbj > 0, `égide vide : l'Abjurateur perd autant que le Protégé (${empty.lostAbj} = ${empty.lostProt})`);
    }
    // Le Lien retiré avant l'Égide projetée (sinon les deux se mêlent).
    for ( const e of (await ctx.effects(prot)).filter(e => /Warding Bond|Bonded|Lien protecteur|Lié/i.test(e.name ?? "")) ) {
      await ctx.call("remove-embedded-effect", { documentType: "Actor", id: prot.actorId, effectId: e._id ?? e.id }).catch(() => {});
    }
    for ( const e of (await ctx.effects(abj)).filter(e => /Warding Bond|Bonded|Lien protecteur|Lié|Concentr/i.test(e.name ?? "")) ) {
      await ctx.call("remove-embedded-effect", { documentType: "Actor", id: abj.actorId, effectId: e._id ?? e.id }).catch(() => {});
    }
    await pause(1000);

    // 6. Égide projetée : en réaction, l'égide de l'Abjurateur prend les dégâts du Protégé.
    if ( id["projected-ward"] ) {
      await set({ spent: 0 });
      const p = await strike(prot, "first");
      if ( ctx.expect(!!p, "Égide projetée : l'Ogre touche le Protégé (20 essais au plus)") ) {
        const absorbed = p.after.ward.spent - p.before.ward.spent;
        const lostProt = p.before.prot.value - p.after.prot.value;
        ctx.expect(absorbed === Math.min(p.before.ward.value, p.dealt), `Égide projetée : l'égide absorbe ${absorbed} (jet ${p.dealt})`);
        ctx.expect(lostProt + absorbed === p.dealt, `Égide projetée : Protégé −${lostProt} + égide −${absorbed} = ${p.dealt}`);
        ctx.expect(p.after.abj.value === p.before.abj.value, "Égide projetée : les PV de l'Abjurateur ne bougent pas");
      }
    }
  }
};
