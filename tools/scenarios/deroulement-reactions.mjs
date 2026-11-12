/**
 * §418 : le réglage « Réactions » (`reactionPrompts`, cadre « Déroulement ») — à qui le moteur propose une réaction, vérifié sur
 * l'attaque d'opportunité, « Arène des refus » (`node tools/arene-refus.mjs`), en combat :
 *  - le Mannequin (créature du MJ) quitte l'allonge du Guerrier (personnage de joueur) : la fenêtre du Guerrier ;
 *  - le Guerrier quitte l'allonge du Mannequin : la fenêtre du Mannequin.
 *
 *                      fenêtre du Guerrier (joueur)   fenêtre du Mannequin (MJ)
 *   `ask`              oui                            oui
 *   `players`          oui                            non
 *   `off`              non                            non
 *
 * Personne ne réagit (« ne pas réagir ») : la Réaction reste. Le joueur n'étant pas connecté, sa fenêtre s'ouvre chez le MJ. Le réglage
 * « Action impossible » est coupé le temps du scénario : les déplacements hors de son tour partent sans fenêtre. Tout est remis.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "déroulement : réactions — demander à chacun, aux joueurs seulement, jamais",
  scene: "Arène des refus",

  async run(ctx) {
    const fighter = await ctx.token("Guerrier des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const script = async (code, args={}) => (await ctx.call("run-script", { waitMs: 8000, args, code }))?.result;
    const grid = await ctx.gridSize();
    const where = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data;
    const home = { fighter: await where(fighter), dummy: await where(dummy) };
    const place = (t, x, y) => script(`await canvas.scene.tokens.get(args.id).move([{ x: args.x, y: args.y, action: "blink" }], { "${MODULE_ID}": { cleared: true } }); return true;`, { id: t.id, x, y });
    ctx.restore(() => place(fighter, home.fighter.x, home.fighter.y).catch(() => {}));
    ctx.restore(() => place(dummy, home.dummy.x, home.dummy.y).catch(() => {}));

    const settings = {};
    for ( const key of ["reactionPrompts", "refusalMode"] ) settings[key] = (await ctx.engine("setting", { key }))?.now;
    ctx.restore(async () => { for ( const [key, value] of Object.entries(settings) ) await ctx.engine("setting", { key, value }); });
    await ctx.engine("setting", { key: "refusalMode", value: "off" });

    // Le Mannequin de l'arène n'a aucun objet (tools/lib/arena.mjs, sans `keepItems`) : une arme le temps du scénario, pour qu'il menace.
    const club = await script(`const a = canvas.tokens.get(args.d).actor;
      const [item] = await a.createEmbeddedDocuments("Item", [{ name: "Gourdin d'essai", type: "weapon", img: "icons/svg/sword.svg",
        system: { type: { value: "simpleM" }, equipped: true, range: { reach: 5, units: "ft" },
          damage: { base: { number: 1, denomination: 4, types: ["bludgeoning"] } },
          activities: { dnd5eCombatEssai: { _id: "dnd5eCombatEssai", type: "attack", activation: { type: "action" },
            attack: { type: { value: "melee", classification: "weapon" } } } } } }]);
      return item.id;`, { d: dummy.id });
    ctx.restore(() => script(`await canvas.tokens.get(args.d).actor.items.get(args.i)?.delete(); return true;`, { d: dummy.id, i: club }).catch(() => {}));
    const owned = await script(`return { fighter: canvas.tokens.get(args.f).actor.hasPlayerOwner, dummy: canvas.tokens.get(args.d).actor.hasPlayerOwner,
      dummyAttack: canvas.tokens.get(args.d).actor.items.some(i => i.type === "weapon") };`, { f: fighter.id, d: dummy.id });
    if ( !ctx.expect(owned.fighter && !owned.dummy, `le Guerrier appartient à un joueur, le Mannequin au MJ (${JSON.stringify(owned)})`) ) return;
    if ( !ctx.expect(owned.dummyAttack, "le Mannequin a une arme pour son attaque d'opportunité") ) return;

    // Côte à côte, le Mannequin à l'est du Guerrier ; en combat.
    const side = { x: home.fighter.x + grid, y: home.fighter.y };
    await place(dummy, side.x, side.y);
    await pause(800);
    await ctx.startCombat([fighter, dummy]);
    await pause(1000);

    /** La fenêtre de réaction de `name` (« Réaction — nom », un bouton « ne pas réagir ») ; refermée sur « ne pas réagir ». */
    const reactionWindow = async (name, ms=5000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 800 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${name}`) && (w.buttons ?? []).some(b => b.action === "none"));
        if ( d ) { await ctx.call("answer-dialog", { id: d.id, button: "none" }).catch(() => {}); return true; }
      }
      return false;
    };
    ctx.restore(async () => { for ( const t of [fighter, dummy] ) await reactionWindow(t.name, 300); });

    /**
     * `mover` s'éloigne de trois cases comme par un clic, dans la première direction libre ; rend si la fenêtre de `reactor` s'est
     * ouverte (null s'il n'a pas pu bouger) ; chacun revient à sa place.
     */
    const leave = async (mover, reactor, back) => {
      const from = await where(mover);
      const ways = (mover === dummy) ? [[3, 0], [3, 3], [3, -3]] : [[-3, 0], [0, -3], [0, 3], [-3, -3], [-3, 3]];
      for ( const [dx, dy] of ways ) {
        const call = ctx.engine("move", { tokenId: mover.id, point: { x: from.x + dx * grid + grid / 2, y: from.y + dy * grid + grid / 2 }, stopAfterMs: 9000 },
          { timeoutMs: 20000 }).catch(() => null);
        const opened = await reactionWindow(reactor.name);
        const moved = await call;
        await pause(600);
        const went = !!moved && ((moved.after?.x !== moved.before?.x) || (moved.after?.y !== moved.before?.y));
        await place(mover, back.x, back.y);
        await pause(600);
        if ( went || opened ) return opened;
      }
      return null;
    };

    const expected = { ask: [true, true], players: [true, false], off: [false, false] };
    for ( const [mode, [forFighter, forDummy]] of Object.entries(expected) ) {
      await ctx.engine("setting", { key: "reactionPrompts", value: mode });
      const a = await leave(dummy, fighter, side);
      ctx.expect(a === forFighter, `${mode} : le Mannequin quitte l'allonge du Guerrier — fenêtre du joueur ${a ? "ouverte" : "absente"} (attendu : ${forFighter ? "ouverte" : "absente"})`);
      const b = await leave(fighter, dummy, home.fighter);
      ctx.expect(b === forDummy, `${mode} : le Guerrier quitte l'allonge du Mannequin — fenêtre du MJ ${b ? "ouverte" : "absente"} (attendu : ${forDummy ? "ouverte" : "absente"})`);
    }
  }
};
