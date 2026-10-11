/**
 * Sorts du clerc et du druide qui portaient plusieurs effets (audit du compendium, le 2026-09-27). Le Clerc lance sur le
 * Guerrier (sorts ajoutés à volonté pour le scénario, retirés à la fin) :
 *  1. Aide (niveau 2) : un seul effet, celui du niveau lancé (« +5 PV max ») — le moteur posait les huit profils.
 *  2. Protection contre l'énergie (feu), Amélioration de caractéristique (Sagesse), Agrandissement/rapetissement
 *     (agrandi, sauvegarde ratée) : un seul effet, celui choisi.
 *  3. Protection contre le poison : l'état Empoisonné cesse ; le Guerrier sauvegarde ensuite avec l'avantage contre un
 *     effet qui empoisonne (Nuage nauséabond du Zombi), le Clerc — qui a le sort sur sa fiche mais pas l'effet — sans.
 *  4. Retour à la vie : le Guerrier, Mort à 0 PV, revient à 1 PV ou plus, sans l'état Mort.
 * Remet PV, effets et états.
 */
const MODULE_ID = "dnd5e-combat";
const SPELLS = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "sorts du clerc et du druide — effets au niveau lancé, effets au choix, poison, retour à la vie",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const atWill = { system: { method: "atwill" } };
    for ( const id of ["phbsplAid0000000", "phbProtectionFro", "phbsplEnhanceAbi", "phbsplEnlargeRed", "phbsplProtection", "phbsplRevivify00"] ) {
      await ctx.ensureItem(cleric, SPELLS + id, atWill);
    }
    await ctx.ensureItem(zombi, SPELLS + "phbsplStinkingCl", atWill);
    const hp0 = await ctx.hp(fighter);
    const clericHp0 = await ctx.hp(cleric);
    const spellEffects = /pv max|Protection|Amélioration|Agrandissement|Rapetissement|concentr|Poison nauséabond/i;
    // Les effets des sorts du scénario, par l'identifiant du sort (le nom d'un effet suit la langue du client du MJ).
    const SPELL_IDS = ["aid", "protection-from-energy", "enhance-ability", "enlarge-reduce", "protection-from-poison", "revivify", "stinking-cloud"];
    const cleanup = async () => {
      await ctx.removeEffectsNamed(fighter, spellEffects);
      await ctx.removeEffectsNamed(cleric, spellEffects);
      await ctx.removeEffectsFrom(fighter, ...SPELL_IDS);
      await ctx.removeEffectsFrom(cleric, ...SPELL_IDS);
      for ( const s of ["poisoned", "dead"] ) await ctx.call("set-status", { tokenId: fighter.id, statusId: s, active: false }).catch(() => {});
      await ctx.call("set-status", { tokenId: cleric.id, statusId: "poisoned", active: false }).catch(() => {});
      await ctx.setHp(fighter, hp0);
      await ctx.setHp(cleric, clericHp0);
    };
    ctx.restore(cleanup);
    const from = (token, identifier) => ctx.effectsFrom(token, identifier).then(list => list.map(e => ({ ...e, name: e.effect })));
    // Le nom, dans la langue du client, d'un effet de l'item du Clerc (le profil choisi), pour le reconnaître une fois posé.
    const profileName = async (identifier, effectId) => {
      const item = ((await ctx.call("get-actor", { actorId: cleric.actorId })).items ?? []).find(i => i.system?.identifier === identifier);
      return (item?.effects ?? []).find(e => (e._id ?? e.id) === effectId)?.name ?? null;
    };
    // `roll` : soins ou dégâts laissés au bouton de la carte (Aide, Retour à la vie) — le clic de l'auteur, par api.mcp.rollCard.
    const cast = async (identifier, { roll=false, ...params }={}) => {
      const used = await ctx.use({ tokenId: cleric.id, identifier, consume: false, targetTokenIds: [fighter.id], ...params });
      if ( roll ) {
        await pause(1200);
        const r = await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(err => ({ error: err.message }));
        if ( !r?.rolled ) ctx.log(`jet de la carte (${identifier}) : ${JSON.stringify(r)}`);
      }
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      return used;
    };

    // 1. Aide au niveau 2 : le seul profil « Niveau 2 ».
    await cast("aid", { roll: true });
    const aid = await from(fighter, "aid");
    ctx.expect(aid.length === 1, `Aide : un seul effet posé (${aid.map(e => e.name).join(", ") || "aucun"})`);
    await cleanup();

    // 2. Effets au choix.
    const choices = [
      ["protection-from-energy", "DsflUNYKqETaLgxG", "Protection contre l'énergie"],
      ["enhance-ability", "EGnngHgGBzTyThW6", "Amélioration de caractéristique"]
    ];
    for ( const [identifier, choice, label] of choices ) {
      const wanted = await profileName(identifier, choice);
      await cast(identifier, { usageConfig: { [MODULE_ID]: { choice } } });
      const posed = await from(fighter, identifier);
      ctx.expect((posed.length === 1) && (posed[0].name === wanted), `${label} : un seul effet, le choisi « ${wanted} » (${posed.map(e => e.name).join(", ") || "aucun"})`);
      await cleanup();
    }
    // Agrandissement : sauvegarde de Con (le Guerrier peut réussir) ; on rejoue jusqu'à un échec.
    let enlarged = null;
    const enlargeName = await profileName("enlarge-reduce", "Wi2E10l7n6Ka8k6u");
    for ( let n = 1; (n <= 20) && !enlarged; n++ ) {
      await cast("enlarge-reduce", { usageConfig: { [MODULE_ID]: { choice: "Wi2E10l7n6Ka8k6u" } } });
      const posed = await from(fighter, "enlarge-reduce");
      if ( posed.length ) enlarged = posed;
    }
    ctx.expect(enlarged?.length === 1 && (enlarged[0].name === enlargeName), `Agrandissement/rapetissement : un seul effet, « ${enlargeName} » (${enlarged?.map(e => e.name).join(", ") ?? "aucune sauvegarde ratée"})`);
    await cleanup();

    // 3. Protection contre le poison.
    await ctx.call("set-status", { tokenId: fighter.id, statusId: "poisoned", active: true });
    await pause(800);
    await cast("protection-from-poison");
    const statuses = async token => (await ctx.effects(token)).flatMap(e => e.statuses ?? []);
    ctx.expect(!(await statuses(fighter)).includes("poisoned"), "Protection contre le poison : l'état Empoisonné cesse");
    ctx.expect((await from(fighter, "protection-from-poison")).length === 1, "Protection contre le poison : l'effet est posé");
    const saveMode = async target => {
      const used = await ctx.use({ tokenId: zombi.id, identifier: "stinking-cloud", activityType: "save", consume: false, targetTokenIds: [target.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      const save = (await ctx.messagesSince(used.usageMessageId)).find(m => (m.type === "save") && (m.alias === target.name));
      const raw = save?.rolls?.[0];
      const roll = (typeof raw === "string") ? JSON.parse(raw) : raw;
      return { found: !!save, mode: roll?.options?.advantageMode ?? null, formula: roll?.formula ?? "" };
    };
    const protectedSave = await saveMode(fighter);
    ctx.expect(protectedSave.found && (protectedSave.mode === 1), `le Guerrier protégé sauvegarde contre le poison avec l'avantage (${protectedSave.formula}, mode ${protectedSave.mode})`);
    // Le Clerc de `dnd-6` est nain : Résistance naine (§31) lui donne à bon droit l'Avantage contre Empoisonné — le contrôle « le sort
    // ne vaut pas pour son lanceur » ne se fait alors pas sur lui.
    const dwarf = ((await ctx.call("get-actor", { actorId: cleric.actorId })).items ?? []).some(i => i.system?.identifier === "dwarven-resilience");
    const casterSave = await saveMode(cleric);
    if ( dwarf ) ctx.log(`le Clerc est nain (Résistance naine) : avantage attendu de son espèce (${casterSave.formula})`);
    else ctx.expect(casterSave.found && (casterSave.mode !== 1), `le Clerc, qui a le sort mais pas l'effet, sans avantage (${casterSave.formula}, mode ${casterSave.mode})`);
    await cleanup();

    // 4. Retour à la vie.
    await ctx.setHp(fighter, 0);
    await ctx.call("set-status", { tokenId: fighter.id, statusId: "dead", active: true });
    await pause(1200);
    await cast("revivify", { roll: true });
    await pause(800);
    const hp = await ctx.hp(fighter);
    ctx.expect(hp >= 1, `Retour à la vie : le Guerrier revient à ${hp} PV`);
    ctx.expect(!(await statuses(fighter)).includes("dead"), "Retour à la vie : l'état Mort est retiré");
  }
};
