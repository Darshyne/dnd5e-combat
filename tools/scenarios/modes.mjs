/**
 * Modes de déplacement et élévation (SPEC §17.4) : un PJ (Guerrier dans `dnd-6`, Bramo dans `ravenloft`), hors combat.
 *  - sans vitesse de vol, choisir le vol (HUD du token) l'accorde par un effet du moteur et fait décoller à 5 ft ;
 *    revenir à la marche fait atterrir et retire l'effet ;
 *  - avec une vitesse de vol (effet temporaire « fly (scénario) ») : monter par l'élévation en marchant fait voler,
 *    jamais sous 5 ft en vol, redescendre au sol fait marcher ;
 *  - choisir le fouissement l'accorde et enfonce à −5 ft, marcher ramène au sol et retire l'effet.
 * Le vol monte au plus sous le plafond du niveau (tête comprise : le cœur arrête le token à la Surface du dessus). Sur un
 * plancher en Surface (niveau en dessous), le cœur interdit de le traverser : fouir y est refusé, mode et élévation
 * inchangés, vitesse accordée retirée — c'est ce que le scénario vérifie alors.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "keep",   // §83 : étages et escaliers, dans Restored Keep
  name: "modes — vol, marche, fouissement : élévation cohérente",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    const name = ["Guerrier", "Bramo"].find(n => tokens.some(t => t.name === n));
    if ( !name ) { ctx.log("Guerrier ou Bramo absent : non applicable"); return; }
    const pc = await ctx.token(name);
    const read = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: pc.id });
      return { mode: data.movementAction ?? null, elevation: data.elevation ?? 0, data };
    };
    const waitFor = async test => {
      for ( let i = 0; i < 24; i++ ) { const s = await read(); if ( test(s) ) return s; await pause(250); }
      return read();
    };
    const setMode = mode => ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { movementAction: mode } });
    const setElevation = elevation => ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { elevation } });

    const start = await read();
    const ground = start.elevation;
    const { levels = [] } = await ctx.call("list-levels", {});
    const top = levels.find(l => l.id === start.data.level)?.elevation?.top ?? null;
    const high = ground + Math.min(20, (top === null) ? 20 : (top - ground - 5));
    if ( high < ground + 10 ) { ctx.log(`niveau trop bas (plafond ${top}) : non applicable`); return; }

    const target = start.data.actorLink ? { documentType: "Actor", id: start.data.actorId }
      : { uuid: `Scene.${sceneId}.Token.${pc.id}.Actor.${start.data.actorId}` };
    const effectsOf = async () => {
      if ( start.data.actorLink ) {
        const a = await ctx.call("get-actor", { actorId: start.data.actorId });
        return a.effects ?? a.actor?.effects ?? [];
      }
      return (await read()).data.delta?.effects ?? [];
    };
    const grantedIds = async () => (await effectsOf()).filter(e => e.flags?.["dnd5e-combat"]?.grantedSpeed).map(e => e._id);
    const granted = async () => (await grantedIds()).length;
    const speed = key => ({ name: `${key} (scénario)`, img: "icons/svg/wing.svg",
      system: { changes: [{ key: `system.attributes.movement.${key}`, value: 30, type: "upgrade", phase: "initial" }] } });
    ctx.restore(async () => {
      await ctx.removeEffectsNamed(pc, /\(scénario\)/);
      for ( const effectId of await grantedIds() ) await ctx.call("remove-embedded-effect", { ...target, effectId }).catch(() => {});
      await ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { movementAction: start.mode ?? "walk" } }).catch(() => {});
      await ctx.call("move-token", { tokenId: pc.id, elevation: ground }).catch(() => {});
    });

    // 1. Sans vitesse de vol : choisir le vol l'accorde ; revenir à la marche la retire.
    const actor = await ctx.call("get-actor", { actorId: start.data.actorId });
    const movement = (actor.system ?? actor.actor?.system)?.attributes?.movement ?? {};
    let s;
    if ( !(Number(movement.speeds?.fly ?? movement.fly ?? 0) > 0) ) {
      await setMode("fly").catch(() => {});
      s = await waitFor(s => (s.mode === "fly") && (s.elevation === ground + 5));
      ctx.expect((s.mode === "fly") && (s.elevation === ground + 5), `${pc.name} sans vol, vol choisi : mode ${s.mode}, élévation ${s.elevation}`);
      const n = await granted();
      ctx.expect(n === 1, `vitesse de vol accordée par un effet (${n})`);
      await setMode("walk").catch(() => {});
      s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
      await pause(500);
      const left = await granted();
      ctx.expect((s.mode === "walk") && (s.elevation === ground) && (left === 0), `retour à la marche : mode ${s.mode}, élévation ${s.elevation}, effets accordés ${left}`);
    }

    // 2. Vol par l'élévation (vitesse de vol prêtée par un effet du scénario).
    await ctx.call("upsert-embedded-effect", { ...target, effectData: speed("fly") });
    await pause(300);
    await setMode("fly").catch(() => {});
    s = await waitFor(s => (s.mode === "fly") && (s.elevation === ground + 5));
    ctx.expect((s.mode === "fly") && (s.elevation === ground + 5), `décolle : mode ${s.mode}, élévation ${s.elevation} (attendu ${ground + 5})`);

    await setMode("walk").catch(() => {});
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    ctx.expect((s.mode === "walk") && (s.elevation === ground), `atterrit : mode ${s.mode}, élévation ${s.elevation}`);

    await setElevation(high).catch(() => {});
    s = await waitFor(s => (s.mode === "fly") && (s.elevation === high));
    ctx.expect((s.mode === "fly") && (s.elevation === high), `monte par l'élévation : mode ${s.mode}, élévation ${s.elevation} (attendu ${high})`);

    if ( top !== null ) {
      // Le niveau suit l'élévation (levelAt) : au-dessus du haut du niveau, le token passe dans celui du dessus — sauf
      // plancher (Surface) au-dessus de lui, qui l'arrête dessous, tête comprise, niveau inchangé (régression du 2026-09-26 :
      // monté SUR ce plancher, le token ne pouvait plus redescendre).
      const above = levels.find(l => l.elevation?.bottom === top);
      await setElevation(top + 1).catch(() => {});
      await pause(1500);
      s = await read();
      if ( s.elevation >= top ) ctx.expect(!!above && (s.data.level === above.id), `au-dessus de ${top} : niveau ${s.data.level} (attendu ${above?.name ?? "aucun"})`);
      else ctx.expect((s.data.level === start.data.level) && (s.elevation <= high), `plancher au-dessus : pieds à ${s.elevation} (au plus ${high}), niveau inchangé`);
      await setElevation(ground + 5).catch(() => {});
      s = await waitFor(s => (s.elevation === ground + 5) && (s.data.level === start.data.level));
      ctx.expect((s.mode === "fly") && (s.data.level === start.data.level) && (s.elevation === ground + 5), `redescendu : mode ${s.mode}, élévation ${s.elevation} (attendu ${ground + 5}), niveau de départ (${s.data.level})`);
    }

    await setElevation(ground + 2).catch(() => {});
    s = await waitFor(s => s.elevation === ground + 5);
    ctx.expect((s.mode === "fly") && (s.elevation === ground + 5), `en vol, jamais sous 5 ft : mode ${s.mode}, élévation ${s.elevation}`);

    await setElevation(ground).catch(() => {});
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    ctx.expect((s.mode === "walk") && (s.elevation === ground), `redescend au sol : mode ${s.mode}, élévation ${s.elevation}`);

    // 2 bis. Changer de niveau par le HUD (niveau seul) : posé au sol du niveau choisi, dans son mode ; retour au sol de départ.
    const upper = levels.find(l => (top !== null) && (l.elevation?.bottom === top));
    if ( upper ) {
      const setLevel = level => ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { level } });
      await setLevel(upper.id).catch(() => {});
      s = await waitFor(s => s.data.level === upper.id);
      ctx.expect((s.data.level === upper.id) && (s.mode === "walk") && (s.elevation >= upper.elevation.bottom) && (s.elevation < (upper.elevation.top ?? Infinity)),
        `niveau changé par le HUD : ${s.data.level}, mode ${s.mode}, élévation ${s.elevation} (dans ${upper.elevation.bottom}–${upper.elevation.top})`);
      await setLevel(start.data.level).catch(() => {});
      s = await waitFor(s => (s.data.level === start.data.level) && (s.elevation === ground));
      ctx.expect((s.data.level === start.data.level) && (s.elevation === ground) && (s.mode === "walk"), `retour par le HUD : niveau ${s.data.level}, élévation ${s.elevation}, mode ${s.mode}`);
    }

    // 3. Fouissement : la vitesse est accordée par le choix du mode.
    await setMode("burrow").catch(() => {});
    s = await waitFor(s => (s.mode === "burrow") && (s.elevation === ground - 5));
    if ( s.mode !== "burrow" ) {
      // Plancher en Surface : le cœur ne laisse pas le traverser ; le moteur n'a rien changé et retire ce qu'il a accordé.
      await pause(500);
      const left = await granted();
      ctx.expect((s.mode === "walk") && (s.elevation === ground) && (left === 0), `fouir à travers un plancher : refusé, mode ${s.mode}, élévation ${s.elevation}, effets accordés ${left}`);
      return;
    }
    ctx.expect(s.elevation === ground - 5, `s'enfouit : mode ${s.mode}, élévation ${s.elevation}`);

    await setMode("walk").catch(() => {});
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    await pause(500);
    const left = await granted();
    ctx.expect((s.mode === "walk") && (s.elevation === ground) && (left === 0), `remonte : mode ${s.mode}, élévation ${s.elevation}, effets accordés ${left}`);
  }
};
