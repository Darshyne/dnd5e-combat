/**
 * §192 (lot 1) : grimper aux murs, sur la scène « Escalade » de `dnd-6` (un mur vertical, un plafond en Surface à 20 ft sur la moitié
 * ouest, un sol en Surface, le Guerrier contre le mur, le Zombi juste au sud de lui, contre le mur aussi).
 *  1. Au sol près du mur : « Grimper » est possible ; sous un plafond à 20 ft, 3 cases au plus (tête comprise).
 *  2. Monter de 2 cases : élévation +10 ft, mode `climb`, statut « En escalade ».
 *  3. Marcher le long du mur à cette hauteur jusqu'au-dessus du Zombi (occupation en trois dimensions : sa case est libre à 10 ft).
 *  4. Se laisser tomber : la chute de dnd5e (carte « Fell 10 ft », 1d6 appliqué par le moteur, À terre), mode au sol, statut retiré.
 *  5. Mis À terre en escalade : il tombe (MJ actif), sans bouger lui-même.
 *  6. En combat (Vitesse 30, sans vitesse d'escalade) : 2 cases coûtent 20 ft (×2, le coût de dnd5e) ; il ne reste qu'une case ;
 *     en demander deux n'en monte qu'une ; puis plus rien.
 *  7. Règles « maison » : DD 15 Force (Athlétisme) pour grimper (un échec : pas de montée), puis à chaque tour en combat (la fenêtre
 *     de jet du MJ est répondue par le scénario ; fermée, le moteur lance sans fenêtre).
 * Remet le mode, l'élévation, les PV, les règles d'escalade ; le filet du lanceur reprend le reste.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "Escalade",
  name: "escalade — grimper au mur, marcher le long, chute, budget, règles maison",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const home = await ctx.position(hero);
    const hp0 = await ctx.hp(hero);
    const state = () => ctx.engine("climbState", { tokenId: hero.id });
    const reset = async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: false }).catch(() => {});
      await ctx.setHp(hero, hp0).catch(() => {});
      await pause(600);
    };
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    ctx.restore(reset);
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

    // 1. Près du mur, au sol.
    let s = await state();
    if ( !ctx.expect(s.walls.length >= 1 && s.canClimb, `au sol contre un mur (${s.walls.length} mur), peut grimper`) ) return;
    ctx.expect((s.room?.max === 3) && (s.room?.ceiling === 15), `plafond à 20 ft : 3 cases au plus, pieds à 15 ft au plus (max ${s.room?.max}, plafond ${s.room?.ceiling})`);
    ctx.expect((s.speed?.native === false) && (s.room?.multiplier === 2), `sans vitesse d'escalade : chaque case coûte le double (×${s.room?.multiplier})`);

    // 2. Monter de deux cases.
    const up = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
    if ( !ctx.expect(up.done && (up.after.elevation === home.elevation + 10) && (up.after.movementAction === "climb"),
      `monte de 2 cases : élévation ${up.after.elevation}, mode ${up.after.movementAction}`) ) return;
    await pause(1200);
    s = await state();
    ctx.expect(s.climbing && s.status && s.canClimb, `en escalade : statut « En escalade » ${s.status ? "posé" : "absent"}, peut monter encore`);
    ctx.expect(s.room?.max === 1, `sous le plafond, une case de plus au plus (max ${s.room?.max})`);

    // 3. Marche le long du mur, au-dessus du Zombi (sa case est libre à 10 ft : occupation en trois dimensions).
    const zc = (await ctx.engine("movement", { tokenId: zombi.id })).position.cell;
    const along = await ctx.engine("move", { tokenId: hero.id, cell: zc });
    ctx.expect((along.after.cell.i === zc.i) && (along.after.cell.j === zc.j) && (along.after.elevation === up.after.elevation) && (along.after.movementAction === "climb"),
      `marche le long du mur au-dessus du Zombi : case (${along.after.cell.i}, ${along.after.cell.j}), élévation ${along.after.elevation}, mode ${along.after.movementAction}`);
    const back = await ctx.engine("move", { tokenId: hero.id, cell: up.after.cell });
    ctx.expect((back.after.cell.i === up.after.cell.i) && (back.after.cell.j === up.after.cell.j) && (back.after.elevation === up.after.elevation), `revient à sa case, toujours à ${back.after.elevation} ft`);

    // 4. Se laisser tomber : la chute de dnd5e, ses dégâts appliqués, À terre.
    await pause(1500);
    const since = await ctx.lastMessageId();
    const drop = await ctx.engine("dropDown", { tokenId: hero.id });
    await pause(4000);
    const hp1 = await ctx.hp(hero);
    const card = (await ctx.messagesSince(since)).find(m => (m.type === "damage") && m.rolls?.length);
    const dmg = card?.rolls?.[0]?.total ?? null;
    ctx.expect(drop.done && (drop.after.elevation === home.elevation) && (drop.after.movementAction !== "climb"), `se laisse tomber : élévation ${drop.after.elevation}, mode ${drop.after.movementAction}`);
    ctx.expect(!!card && (hp0 - hp1 === dmg), `chute de 10 ft : carte de dégâts de dnd5e (${dmg ?? "aucune"}), appliquée (PV ${hp0} → ${hp1})`);
    let statuses = await statusesOf();
    s = await state();
    ctx.expect(statuses.includes("prone") && !s.status && !s.falling, `À terre après des dégâts de chute ; plus « En escalade » ni « En chute » (${statuses.join(", ") || "aucun état"})`);
    await reset();

    // 5. Mis À terre en pleine escalade : il tombe.
    const up2 = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
    if ( ctx.expect(up2.done && (up2.after.elevation === home.elevation + 10), `remonte de 2 cases (${up2.after.elevation} ft)`) ) {
      await pause(1500);
      await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: true });
      let fell = null;
      for ( let i = 0; (i < 30) && !fell; i++ ) { await pause(500); const now = await state(); if ( now.position.elevation === home.elevation ) fell = now; }
      const hp2 = await ctx.hp(hero);
      ctx.expect(!!fell && !fell.climbing && !fell.status, `mis À terre au mur : tombe au sol (élévation ${fell?.position.elevation ?? "—"}, mode ${fell?.position.movementAction ?? "—"}, statut escalade ${fell?.status ?? "—"})`);
      ctx.expect(hp2 < hp0, `la chute blesse (PV ${hp0} → ${hp2})`);
    }
    await reset();

    // 6. En combat : le budget du tour.
    await ctx.startCombat([hero]);
    await pause(1000);
    const m0 = await ctx.engine("movement", { tokenId: hero.id });
    if ( ctx.expect(m0.combat && (m0.combat.speed === 30), `en combat, Vitesse ${m0.combat?.speed ?? "?"} ft`) ) {
      const up3 = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
      const m1 = await ctx.engine("movement", { tokenId: hero.id });
      ctx.expect(up3.done && (m1.combat.spent === 20), `2 cases montées en combat : 20 ft dépensés (×2) — dépensé ${m1.combat.spent}`);
      s = await state();
      ctx.expect(s.room?.max === 1, `il reste 10 ft : une case de plus au plus (max ${s.room?.max})`);
      const up4 = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
      const m2 = await ctx.engine("movement", { tokenId: hero.id });
      ctx.expect(up4.done && (up4.after.elevation === home.elevation + 15) && (m2.combat.spent === 30), `en demander deux n'en monte qu'une : élévation ${up4.after.elevation}, dépensé ${m2.combat.spent}`);
      s = await state();
      ctx.expect(s.room?.max === 0, `déplacement épuisé : plus rien à monter (max ${s.room?.max})`);
    }
    await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    ctx.ownCombat = null;
    await reset();

    // 7. Règles « maison » : DD 15 pour grimper, puis à chaque tour.
    await ctx.engine("setting", { key: "climbRules", value: "house" });
    const seen = { success: false, failure: false };
    for ( let n = 0; (n < 8) && !(seen.success && seen.failure); n++ ) {
      const pending = ctx.engine("climb", { tokenId: hero.id, cells: 1 }, { timeoutMs: 90000 });
      await answerRoll();
      const r = await pending;
      await pause(800);
      const now = await state();
      if ( r.done ) {
        seen.success = true;
        ctx.expect(now.climbing && (now.position.elevation === home.elevation + 5), `test réussi : grimpe (${now.position.elevation} ft)`);
        // À chaque tour en combat : le test est redemandé au début de son tour — dès le début du combat (son tour commence), puis à
        // chaque tour suivant. Fait : l'heure du dernier test a changé, ou le drapeau est parti avec la chute d'un échec.
        const before = now.checkedAt;
        const since = await ctx.lastMessageId();
        await ctx.startCombat([hero]);
        let checked = null;
        for ( let i = 0; (i < 30) && !checked; i++ ) { await pause(500); const c = await state(); if ( c.checkedAt !== before ) checked = c; }
        ctx.expect(!!checked, `au début de son tour, le test est redemandé (${checked ? "fait" : "non fait"})`);
        if ( checked ) {
          await pause(3000);
          const after = await state();
          const held = after.climbing && (after.position.elevation === home.elevation + 5);
          const fallen = !after.climbing && (after.position.elevation === home.elevation);
          ctx.expect(held || fallen, `après le test : ${held ? "tient au mur" : fallen ? "a lâché prise et chute" : `état inattendu (élévation ${after.position.elevation}, mode ${after.position.movementAction})`}`);
          if ( held ) {
            const again = after.checkedAt;
            await ctx.nextTurn();
            let second = null;
            for ( let i = 0; (i < 30) && !second; i++ ) { await pause(500); const c = await state(); if ( c.checkedAt !== again ) second = c; }
            ctx.expect(!!second, `au tour suivant, le test est redemandé (${second ? "fait" : "non fait"})`);
          }
        }
        const msgs = await ctx.messagesSince(since);
        ctx.log(`${msgs.length} message(s) du moteur pendant les tests`);
        await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
        ctx.ownCombat = null;
      }
      else {
        seen.failure = true;
        ctx.expect(!now.climbing && (now.position.elevation === home.elevation), `test raté : pas de montée (${now.position.elevation} ft, mode ${now.position.movementAction})`);
      }
      await reset();
    }
    ctx.log(`règles maison : succès ${seen.success ? "vu" : "non vu"}, échec ${seen.failure ? "vu" : "non vu"} (jets aléatoires)`);
  }
};
