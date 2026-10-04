/**
 * Dague des ombres (§71, Familier de vampire du Monster Manual 2024, `mmVampireFamilia`) : « si la cible tombe à 0 point de vie en
 * raison de cette attaque, elle se retrouve Stabilisée mais Empoisonnée 1 heure, et Paralysée tant qu'elle est Empoisonnée ».
 *  - le PNJ (PNJ ordinaire, que le moteur tue d'office à 0 PV) à 1 PV, touché : Stabilisé, Inconscient, Empoisonné, Paralysé — pas Mort ;
 *  - un personnage joueur de la scène à pleins PV, touché : ni Empoisonné ni Paralysé (l'effet ne passe qu'à 0 PV) ; à 1 PV, touché :
 *    Stabilisé (aucun jet contre la mort dû), Empoisonné, Paralysé.
 * L'item du monde peut avoir perdu son effet : le moteur le reprend sur la fiche d'origine (compendium).
 * Le familier est posé le temps du scénario (l'acteur du monde, sous son id), au contact. Le filet de sécurité remet PV et états.
 */
const FAMILIAR = "mmVampireFamilia";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "dague des ombres — stabilisée, empoisonnée et paralysée seulement à 0 PV",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const familiar = await ctx.call("get-actor", { actorId: FAMILIAR }).catch(() => null);
    if ( !familiar ) { ctx.log("Familier de vampire (mmVampireFamilia) absent du monde : non applicable"); return; }
    // La cible PNJ : le premier PNJ ordinaire de la scène qui n'est pas un familier (le moteur le tuerait d'office à 0 PV).
    let npcRef = null;
    for ( const t of tokens.filter(x => x.actorId !== FAMILIAR) ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( (a?.type === "npc") && !a.system?.traits?.important ) { npcRef = t; break; }
    }
    if ( !npcRef ) { ctx.log("aucun PNJ ordinaire sur la scène : non applicable"); return; }
    const dagger = familiar.items.find(i => i.system?.identifier === "umbral-dagger");
    if ( !ctx.expect(!!dagger, "le familier a sa Dague des ombres") ) return;
    const grid = await ctx.gridSize();

    // Le familier, à poser au contact d'une cible.
    const placeNextTo = async target => {
      const at = await ctx.position(target);
      const before = new Set((await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.map(t => t.id));
      await ctx.call("place-token", { actorId: FAMILIAR, x: at.x - grid, y: at.y });
      const token = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.find(t => !before.has(t.id));
      ctx.restore(() => ctx.call("delete-scene-object", { type: "Token", objectId: token.id }).catch(() => {}));
      await sleep(1000);
      return token;
    };
    const statusesOf = async token => {
      const effects = await ctx.effects(token);
      return new Set(effects.flatMap(e => e.statuses ?? []));
    };
    // Les états d'issue arrivent après les dégâts : attendre qu'ils soient là (8 s au plus).
    const settledStatuses = async (token, wanted) => {
      let s = await statusesOf(token);
      for ( let n = 0; (n < 16) && !wanted.every(x => s.has(x)); n++ ) { await sleep(500); s = await statusesOf(token); }
      return s;
    };
    // Jusqu'à toucher (10 essais).
    const stab = async (attacker, target) => {
      for ( let n = 0; n < 10; n++ ) {
        const u = await ctx.use({ tokenId: attacker.id, itemId: dagger._id, activityType: "attack", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        if ( r?.targets?.[0]?.hit ) { await sleep(3000); return true; }
      }
      return false;
    };

    const zombie = await ctx.token(npcRef.name);
    const familiarToken = await placeNextTo(zombie);

    // 2. À 1 PV : stabilisé, empoisonné, paralysé, pas mort.
    await ctx.setHp(zombie, 1);
    if ( ctx.expect(await stab(familiarToken, zombie), "le familier touche le PNJ (1 PV)") ) {
      const s = await settledStatuses(zombie, ["stable", "unconscious", "poisoned", "paralyzed"]);
      ctx.expect((await ctx.hp(zombie)) === 0, "le PNJ tombe à 0 PV");
      ctx.expect(s.has("stable") && !s.has("dead"), `le PNJ est Stabilisé, pas Mort (${[...s].join(", ")})`);
      ctx.expect(s.has("unconscious"), "le PNJ est Inconscient");
      ctx.expect(s.has("poisoned") && s.has("paralyzed"), "le PNJ est Empoisonné et Paralysé");
    }

    // 3. Un personnage joueur à 1 PV.
    const pcs = [];
    for ( const t of tokens.filter(x => x.actorId !== FAMILIAR) ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( a?.type === "character" ) { pcs.push(t); break; }
    }
    if ( !pcs.length ) { ctx.log("aucun personnage joueur sur la scène : cas 3 non joué"); return; }
    const pc = await ctx.token(pcs[0].name);
    const near = await placeNextTo(pc);
    // Pleins PV : touché sans tomber, ni Empoisonné ni Paralysé (l'effet ne passe qu'à 0 PV).
    // Ses PV au départ (le maximum calculé n'est pas dans les données brutes) : un coup, même critique, ne le fait pas tomber.
    const start = await ctx.hp(pc);
    await ctx.setHp(pc, Math.max(start, 30));
    if ( ctx.expect(await stab(near, pc), `le familier touche ${pc.name} (pleins PV)`) ) {
      const s0 = await statusesOf(pc);
      ctx.expect((await ctx.hp(pc)) > 0, `${pc.name} tient debout (${await ctx.hp(pc)} PV)`);
      ctx.expect(!s0.has("poisoned") && !s0.has("paralyzed"), `pas à 0 PV : ni Empoisonné ni Paralysé (${[...s0].join(", ") || "aucun état"})`);
    }
    await ctx.setHp(pc, 1);
    if ( ctx.expect(await stab(near, pc), `le familier touche ${pc.name} (1 PV)`) ) {
      const s = await settledStatuses(pc, ["stable", "poisoned", "paralyzed"]);
      ctx.expect((await ctx.hp(pc)) === 0, `${pc.name} tombe à 0 PV`);
      ctx.expect(s.has("stable") && !s.has("dead"), `${pc.name} est Stabilisé (${[...s].join(", ")})`);
      ctx.expect(s.has("poisoned") && s.has("paralyzed"), `${pc.name} est Empoisonné et Paralysé`);
      const a = await ctx.call("get-actor", { actorId: pc.actorId });
      ctx.expect(!(a.system?.attributes?.death?.failure > 0), `aucun échec contre la mort (${a.system?.attributes?.death?.failure ?? 0})`);
    }
  }
};
