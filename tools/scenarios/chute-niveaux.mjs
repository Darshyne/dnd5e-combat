/**
 * §218 : chute d'un niveau vers un niveau inférieur, hors combat (la chute automatique n'agit qu'en combat par défaut), sur Restored
 * Keep : le toit de chaume de l'écurie est à 20 ft (Second Floor), la cour herbeuse à l'est est à 0 (First Floor).
 *  1. Saut : du toit, un saut en longueur vers la cour — le Guerrier retombe au-dessus du vide et tombe aussitôt jusqu'au sol de la
 *     cour, au rez-de-chaussée, avec les dégâts de chute de dnd5e (2d6 pour 20 ft) ; il était laissé « En chute » en l'air.
 *  2. Déplacer un token « En chute » : posé en l'air au-dessus de la cour, il tombe d'abord (dégâts compris) au lieu d'être recalé au
 *     sol en silence.
 * Remet position, niveau, PV, états.
 */
const MODULE_ID = "dnd5e-combat";
const FIRST = "rcWKCTvbgKJhN2DV";
const SECOND = "DlCYcaprf0tbAual";
const ROOF = { x: 4620, y: 4760 };        // le toit de chaume, au bord est
const YARD = { i: 34, j: 34 };            // la cour, à l'est
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "keep",
  name: "chute d'un niveau à l'autre — après un saut, ou en bougeant un token en chute",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const home = await ctx.position(hero);
    const hp0 = await ctx.hp(hero);
    const reset = async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      for ( const s of ["prone", "falling"] ) {
        await ctx.removeStatusEffects(hero, s);
        await ctx.call("set-status", { tokenId: hero.id, statusId: s, active: false }).catch(() => {});
      }
      await ctx.setHp(hero, hp0);
    };
    ctx.restore(async () => {
      await reset();
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: home.elevation ?? 0, levelId: home.level }).catch(() => {});
    });
    const tokenNow = async () => (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.find(t => t.id === hero.id);
    /** Attend l'arrivée au sol (la chute de dnd5e attend la fin de l'animation : jusqu'à 5 s, fenêtre en arrière-plan). */
    const landed = async () => {
      for ( let n = 0; n < 30; n++ ) {
        const t = await tokenNow();
        if ( (t.elevation ?? 0) === 0 ) { await pause(2500); return; }
        await pause(500);
      }
    };
    const fell = async (label, since) => {
      await landed();
      const pos = await tokenNow();
      const hp = await ctx.hp(hero);
      ctx.expect((pos.elevation ?? 0) === 0 && (pos.level === FIRST), `${label} : au sol de la cour (${pos.elevation} ft, niveau ${pos.level})`);
      ctx.expect((hp0 - hp >= 2) && (hp0 - hp <= 12), `${label} : 2d6 de chute appliqués (${hp0} → ${hp})`);
    };

    // 1. Le saut du toit vers la cour.
    await ctx.call("move-token", { tokenId: hero.id, ...ROOF, elevation: 20, levelId: SECOND });
    await pause(1500);
    let since = await ctx.lastMessageId();
    const j = await ctx.engine("jump", { tokenId: hero.id, cell: YARD });
    ctx.expect(j.done !== false, `saut vers la cour (${j.reason ?? "ok"}${j.warnings?.length ? ` — ${j.warnings.join(" ; ")}` : ""})`);
    await fell("après le saut", since);

    // 2. Bouger un token « En chute » au-dessus de la cour.
    await reset();
    await ctx.call("move-token", { tokenId: hero.id, x: 4760, y: 4760, elevation: 20, levelId: SECOND });
    await pause(1500);
    await ctx.call("set-status", { tokenId: hero.id, statusId: "falling", active: true });
    await pause(800);
    since = await ctx.lastMessageId();
    await ctx.engine("move", { tokenId: hero.id, cell: { i: 34, j: 35 } }).catch(() => null);
    await fell("en bougeant un token en chute", since);
  }
};
