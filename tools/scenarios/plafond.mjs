/**
 * §192 (lot 2) : marcher au plafond, sur la scène « Escalade » de `dnd-6` (un mur vertical en x = 700, une Surface « Plafond » à 20 ft
 * sur la moitié ouest, un sol en Surface, le Guerrier contre le mur, le Zombi juste au sud de lui).
 *  1. Sans capacité (règles 2024) : le plafond est là (perchoir à 15 ft, 3 cases), mais « Grimper au plafond » n'est pas proposé.
 *  2. Pattes d'araignée prêtée et lancée sur lui-même : la capacité est reconnue par l'effet du sort ; il gagne le plafond d'un coup
 *     (élévation 15, mode `climb`, drapeau `ceiling`, statut « Au plafond » à la place d'« En escalade ») et, le réglage « Orienter les
 *     tokens » coupé, le MJ actif le retourne (`texture.scaleY` −1, l'échelle d'origine gardée).
 *  3. Il marche sous le plafond, loin du mur, jusqu'au-dessus du Zombi (occupation en trois dimensions) ; au-delà du plafond, aucun chemin.
 *  4. L'attaque de base du Zombi le juge hors d'allonge (10 ft de vide : écart 2 cases) : aucune approche (« tooHigh »), aucune carte,
 *     le Zombi ne bouge pas.
 *  5. Revenu au-dessus de sa case, il descend le long du mur d'une case (statut « En escalade », remis à l'endroit), puis se laisse tomber :
 *     chute de dnd5e, À terre, plus aucun statut de prise, échelle d'origine rendue.
 *  6. Règles « maison », sans la capacité : « Grimper au plafond » est proposé, au DD 20 Force (Athlétisme) ; un échec le laisse au sol,
 *     un succès le pose au plafond ; glissé par le MJ hors du plafond, il tombe (« plus de plafond »).
 * Remet les règles, le réglage d'orientation, la position, le mode, l'échelle, les PV ; le filet du lanceur reprend le reste.
 */
const MODULE_ID = "dnd5e-combat";
const SPIDER_CLIMB = "Compendium.dnd-players-handbook.spells.phbsplSpiderClim";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "Escalade",
  name: "plafond — Pattes d'araignée, marche au plafond, hors d'allonge, retournement, descente, chute, DD 20 maison",

  async run(ctx) {
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.spells") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const home = await ctx.position(hero);
    const hp0 = await ctx.hp(hero);
    const state = () => ctx.engine("climbState", { tokenId: hero.id });
    const reset = async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", "texture.scaleY": 1,
        [`flags.${MODULE_ID}.climb`]: null, [`flags.${MODULE_ID}.ceilingFlip`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const statusId of ["prone", "falling", "climbing", "ceiling"] ) await ctx.call("set-status", { tokenId: hero.id, statusId, active: false }).catch(() => {});
      await ctx.setHp(hero, hp0).catch(() => {});
      await pause(600);
    };
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    // §246 : sans la rotation automatique du cœur, le token au plafond est retourné (`ceilingFlip`).
    const facing = await ctx.engine("foreignSetting", { namespace: "core", key: "tokenAutoRotate", value: false });
    ctx.restore(() => ctx.engine("foreignSetting", { namespace: "core", key: "tokenAutoRotate", value: facing?.before ?? true }));
    ctx.restore(reset);
    ctx.restore(() => ctx.removeEffectsFrom(hero, "spider-climb"));
    const statusesOf = async () => (await ctx.effects(hero)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    /** La fenêtre de jet de dnd5e chez le MJ (règles maison) : on la valide ; introuvable, le moteur lance sans fenêtre au délai. */
    const answerRoll = async () => {
      for ( let i = 0; i < 15; i++ ) {
        const { windows = [] } = await ctx.call("list-dialogs", {}).catch(() => ({}));
        const w = windows.find(w => /RollConfiguration/i.test(w.className ?? "") || /athl/i.test(w.title ?? ""));
        if ( w ) {
          for ( const button of ["roll", "normal", "Roll", "Normal"] ) {
            if ( await ctx.call("answer-dialog", { id: w.id, button }).then(() => true).catch(() => false) ) return true;
          }
          await ctx.call("answer-dialog", { id: w.id, close: true }).catch(() => {});
          return true;
        }
        await pause(400);
      }
      return false;
    };

    // 1. Sans capacité : un plafond, mais pas d'entrée de menu (règles 2024).
    let s = await state();
    if ( !ctx.expect((s.perch === 15) && (s.ceiling?.cells === 3) && s.walls.length, `au sol contre le mur, sous un plafond à 20 ft : perchoir à ${s.perch} ft, ${s.ceiling?.cells} cases`) ) return;
    ctx.expect(!s.walksCeilings && !s.canCeiling, `sans capacité, « Grimper au plafond » n'est pas proposé (capacité ${s.walksCeilings}, proposé ${s.canCeiling})`);

    // 2. Pattes d'araignée lancée sur lui-même : la capacité vient de l'effet du sort.
    const spellId = await ctx.ensureItem(hero, SPIDER_CLIMB, { system: { method: "atwill" } });
    await ctx.use({ tokenId: hero.id, itemId: spellId, targetTokenIds: [hero.id], collectMs: 1500 });
    await pause(800);
    s = await state();
    if ( !ctx.expect(s.walksCeilings && s.canCeiling, `Pattes d'araignée en effet : capacité ${s.walksCeilings}, « Grimper au plafond » proposé ${s.canCeiling}`) ) return;
    const up = await ctx.engine("climbCeiling", { tokenId: hero.id });
    if ( !ctx.expect(up.done && (up.after.elevation === 15) && (up.after.movementAction === "climb") && up.onCeiling,
      `gagne le plafond : élévation ${up.after.elevation}, mode ${up.after.movementAction}, au plafond ${up.onCeiling}`) ) return;
    await pause(1500);
    s = await state();
    ctx.expect(s.ceilingStatus && !s.status, `statut « Au plafond » ${s.ceilingStatus ? "posé" : "absent"}, « En escalade » ${s.status ? "encore là" : "retiré"}`);
    ctx.expect((s.scaleY === -1) && (s.flip?.scaleY === 1), `orientation coupée : token retourné (scaleY ${s.scaleY}, origine ${s.flip?.scaleY ?? "—"})`);
    ctx.expect(!s.canClimb && s.canDown, `au plafond : plus de « Grimper au mur » (${s.canClimb}), « Descendre le long du mur » proposé (${s.canDown})`);

    // 3. Marche sous le plafond, loin du mur, puis au-dessus du Zombi ; au-delà du plafond, aucun chemin.
    const away = { i: up.after.cell.i, j: up.after.cell.j - 2 };
    const far = await ctx.engine("move", { tokenId: hero.id, cell: away });
    ctx.expect((far.after.cell.j === away.j) && (far.after.elevation === 15) && (far.after.movementAction === "climb"),
      `marche sous le plafond à deux cases du mur : case (${far.after.cell.i}, ${far.after.cell.j}), élévation ${far.after.elevation}, mode ${far.after.movementAction}`);
    const beyond = await ctx.engine("plan", { tokenId: hero.id, cell: { i: up.after.cell.i, j: up.after.cell.j + 2 } });
    ctx.expect(!beyond.found || !beyond.arrives, `au-delà du plafond (derrière le mur) : aucun chemin (trouvé ${beyond.found}, arrive ${beyond.arrives ?? "—"})`);
    const zc = (await ctx.engine("movement", { tokenId: zombi.id })).position.cell;
    const over = await ctx.engine("move", { tokenId: hero.id, cell: zc });
    ctx.expect((over.after.cell.i === zc.i) && (over.after.cell.j === zc.j) && (over.after.elevation === 15), `au plafond au-dessus du Zombi : case (${over.after.cell.i}, ${over.after.cell.j}), élévation ${over.after.elevation}`);
    s = await state();
    ctx.expect(s.onCeiling && s.ceilingStatus && (s.scaleY === -1), `toujours au plafond après la marche (statut ${s.ceilingStatus}, scaleY ${s.scaleY})`);

    // 4. L'attaque de base du Zombi : hors d'allonge, pas d'approche, pas de carte.
    const since = await ctx.lastMessageId();
    const reach = await ctx.engine("reachCheck", { tokenId: zombi.id, targetId: hero.id, engage: true, approach: true });
    ctx.expect(reach.tooHigh && (reach.gap === 2) && (reach.vertical === 2) && reach.status?.out,
      `vu du Zombi (${reach.weapon}) : écart ${reach.gap} cases dont ${reach.vertical} de vide, trop haut ${reach.tooHigh}, hors de portée ${reach.status?.out}`);
    ctx.expect((reach.approach?.arrived === false) && (reach.approach?.reason === "tooHigh") && !reach.moved,
      `l'approche refuse (${reach.approach?.reason ?? "—"}) et le Zombi ne bouge pas (${reach.moved ? "a bougé" : "immobile"})`);
    const cards = (await ctx.messagesSince(since)).filter(m => m.type === "attack" || m.rolls?.length);
    ctx.expect((reach.engaged?.messages === 0) && !cards.length, `attaque de base refusée : ${reach.engaged?.messages ?? "?"} message, ${cards.length} carte d'attaque`);

    // 5. Retour au-dessus de sa case ; descente d'une case le long du mur ; chute volontaire.
    const back = await ctx.engine("move", { tokenId: hero.id, cell: up.after.cell });
    ctx.expect((back.after.cell.j === up.after.cell.j) && (back.after.elevation === 15), `revient au-dessus de sa case (élévation ${back.after.elevation})`);
    const down = await ctx.engine("climbDown", { tokenId: hero.id, cells: 1 });
    await pause(1500);
    s = await state();
    ctx.expect(down.done && (down.after.elevation === 10) && (down.after.movementAction === "climb") && !s.onCeiling,
      `descend d'une case le long du mur : élévation ${down.after.elevation}, mode ${down.after.movementAction}, au plafond ${s.onCeiling}`);
    ctx.expect(s.status && !s.ceilingStatus && (s.scaleY === 1) && !s.flip, `au mur : « En escalade » ${s.status}, « Au plafond » ${s.ceilingStatus}, remis à l'endroit (scaleY ${s.scaleY})`);
    const upAgain = await ctx.engine("climbCeiling", { tokenId: hero.id });
    ctx.expect(upAgain.done && (upAgain.after.elevation === 15) && upAgain.onCeiling, `regagne le plafond depuis le mur (élévation ${upAgain.after.elevation})`);
    await pause(1500);
    const before = await ctx.lastMessageId();
    const drop = await ctx.engine("dropDown", { tokenId: hero.id });
    await pause(4000);
    const hp1 = await ctx.hp(hero);
    const card = (await ctx.messagesSince(before)).find(m => (m.type === "damage") && m.rolls?.length);
    const dmg = card?.rolls?.[0]?.total ?? null;
    ctx.expect(drop.done && (drop.after.elevation === home.elevation) && (drop.after.movementAction !== "climb"), `se laisse tomber du plafond : élévation ${drop.after.elevation}, mode ${drop.after.movementAction}`);
    ctx.expect(!!card && (hp0 - hp1 === dmg), `chute de 15 ft : carte de dégâts de dnd5e (${dmg ?? "aucune"}), appliquée (PV ${hp0} → ${hp1})`);
    const statuses = await statusesOf();
    s = await state();
    ctx.expect(statuses.includes("prone") && !s.status && !s.ceilingStatus && !s.falling, `À terre ; plus « En escalade », « Au plafond » ni « En chute » (${statuses.join(", ") || "aucun état"})`);
    ctx.expect((s.scaleY === 1) && !s.flip, `échelle d'origine rendue après la chute (scaleY ${s.scaleY})`);
    await reset();

    // 6. Règles « maison », sans la capacité : DD 20.
    await ctx.removeEffectsFrom(hero, "spider-climb");
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: spellId }).catch(() => {});
    await ctx.engine("setting", { key: "climbRules", value: "house" });
    await pause(400);
    s = await state();
    ctx.expect(!s.walksCeilings && s.canCeiling, `règles maison, sans capacité : « Grimper au plafond » proposé (${s.canCeiling})`);
    const seen = { success: false, failure: false };
    for ( let n = 0; (n < 10) && !(seen.success && seen.failure); n++ ) {
      const pending = ctx.engine("climbCeiling", { tokenId: hero.id }, { timeoutMs: 90000 });
      await answerRoll();
      const r = await pending;
      await pause(1200);
      const now = await state();
      if ( r.done ) {
        seen.success = true;
        ctx.expect(now.onCeiling && (now.position.elevation === 15) && now.ceilingStatus, `test DD 20 réussi : au plafond (${now.position.elevation} ft, statut ${now.ceilingStatus})`);
        // Glissé par le MJ là où il n'y a plus de plafond (derrière le mur, un `displace`) : il tombe.
        await ctx.call("move-token", { tokenId: hero.id, x: home.x + 200, y: home.y, elevation: 15 });
        let fell = null;
        for ( let i = 0; (i < 30) && !fell; i++ ) { await pause(500); const c = await state(); if ( c.position.elevation === home.elevation ) fell = c; }
        ctx.expect(!!fell && !fell.onCeiling && !fell.climbing && (fell.scaleY === 1), `sans plafond au-dessus de lui : tombe (élévation ${fell?.position.elevation ?? "—"}, mode ${fell?.position.movementAction ?? "—"}, scaleY ${fell?.scaleY ?? "—"})`);
      }
      else {
        seen.failure = true;
        ctx.expect(!now.climbing && (now.position.elevation === home.elevation), `test DD 20 raté : reste au sol (${now.position.elevation} ft, mode ${now.position.movementAction})`);
      }
      await reset();
    }
    ctx.log(`règles maison : succès ${seen.success ? "vu" : "non vu"}, échec ${seen.failure ? "vu" : "non vu"} (jets aléatoires)`);
  }
};
