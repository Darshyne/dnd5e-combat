/**
 * §393 : les invocations qui visent, dans l'« Arène des invocations » (`node tools/arene-invocations.mjs` d'abord) — ce que le balayage
 * des invocations saute dans l'Arène des sorts, faute de cible :
 *  1. Doigt de mort, activité « Relever un zombi », sur le Cadavre (un roturier mort) : darsh-loot relève le corps (§118,
 *     `summonOnTargets`) — le token du Cadavre devient un zombi du Manuel des monstres.
 *  2. Animation des morts sur le Cadavre déjà visé : le moteur lance le sort sans viser (§388, `summon.untargeted`), mais une cible
 *     désignée avant reste celle que darsh-loot relève.
 *  3. Doigt de mort sur la Bête morte (un loup) : pas un humanoïde, darsh-loot ne la relève pas.
 * Sans darsh-loot actif, le scénario n'est pas applicable. Le Cadavre relevé est remis (token recréé, mort) ; les zombis, leurs acteurs
 * et le tas d'affaires du mort sont retirés.
 */
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "invocations ciblées — cadavre relevé par Doigt de mort et Animation des morts, bête morte refusée (Arène des invocations)",
  scene: "Arène des invocations",

  async run(ctx) {
    // darsh-loot actif : son réglage se lit (un module inactif n'en enregistre aucun).
    const lootActive = await ctx.call("get-setting", { namespace: "darsh-loot", key: "dropMode" }).then(() => true, () => false);
    if ( !lootActive ) { ctx.log("darsh-loot inactif : non applicable"); return; }

    const caster = await ctx.token("Lanceur");
    const at = await ctx.position(caster);
    const grid = await ctx.gridSize();
    const sceneId = (await ctx.scene()).sceneId;
    const listTokens = async () => (await ctx.call("list-scene-objects", { sceneId, type: "Token" })).objects.Token ?? [];
    const listRegions = async () => (await ctx.call("list-scene-objects", { sceneId, type: "Region" })).objects.Region ?? [];
    const listTiles = async () => (await ctx.call("list-scene-objects", { sceneId, type: "Tile" })).objects.Tile ?? [];
    const before = { tokens: await listTokens(), regions: new Set((await listRegions()).map(r => r.id)),
      tiles: new Set((await listTiles()).map(t => t.id)), actors: new Set((await ctx.call("list-actors", {})).map(a => a.id)) };
    const corpse0 = before.tokens.find(t => t.name === "Cadavre");
    if ( !ctx.expect(!!corpse0, "le Cadavre est sur la scène (sinon : node tools/arene-invocations.mjs)") ) return;
    const corpseActorId = corpse0.actorId;
    // Les tokens déjà là avant chaque cas (la remise, elle, s'appuie sur `before`) : un zombi du cas précédent n'est pas un nouveau.
    let seen = new Set(before.tokens.map(t => t.id));
    const corpsePos = { x: corpse0.x, y: corpse0.y };

    // La remise : les tokens et acteurs nés du test partent, le Cadavre revient mort à sa case.
    ctx.restore(async () => {
      const keep = new Set(before.tokens.map(t => t.id));
      for ( const t of await listTokens() ) if ( !keep.has(t.id) ) await ctx.call("delete-scene-object", { sceneId, type: "Token", objectId: t.id }).catch(() => {});
      for ( const r of await listRegions() ) if ( !before.regions.has(r.id) ) await ctx.call("delete-scene-object", { sceneId, type: "Region", objectId: r.id }).catch(() => {});
      for ( const t of await listTiles() ) if ( !before.tiles.has(t.id) ) await ctx.call("delete-scene-object", { sceneId, type: "Tile", objectId: t.id }).catch(() => {});
      for ( const a of await ctx.call("list-actors", {}) ) if ( !before.actors.has(a.id) ) await ctx.call("trash-document", { documentType: "Actor", documentId: a.id }).catch(() => {});
      if ( !(await listTokens()).some(t => t.name === "Cadavre") ) {
        await ctx.call("place-token", { sceneId, actorId: corpseActorId, x: corpsePos.x, y: corpsePos.y }).catch(() => {});
      }
      await ctx.call("update-actor", { actorId: corpseActorId, actorData: { system: { attributes: { hp: { value: 0 } } } } }).catch(() => {});
      await ctx.call("set-status", { actorId: corpseActorId, statusId: "dead", active: true }).catch(() => {});
    });

    // Une invocation visée, puis ce que la scène est devenue (jusqu'à 10 s).
    const cast = async (source, targetName, slot) => {
      const itemId = await ctx.ensureItem(caster, SPELLS + source);
      const target = (await listTokens()).find(t => t.name === targetName);
      await ctx.engine("castFromBar", { tokenId: caster.id, itemId, slot, targetIds: target ? [target.id] : [], x: at.x + (6 * grid), y: at.y });
      let raised = null;
      for ( let i = 0; (i < 20) && !raised; i++ ) {
        await pause(500);
        for ( const t of await listTokens() ) {
          if ( seen.has(t.id) || !t.actorId ) continue;
          const actor = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
          if ( actor?.flags?.["darsh-loot"]?.raised ) raised = { token: t, from: actor.flags["darsh-loot"].raised.from };
        }
        // Une fenêtre (forme, nombre) : sa réponse par défaut, comme un joueur pressé.
        for ( const w of (await ctx.call("list-dialogs", { dialogsOnly: true })).windows ?? [] ) {
          const button = (w.buttons ?? []).find(b => b.default) ?? (w.buttons ?? [])[0];
          if ( button ) await ctx.call("answer-dialog", { id: w.id, button: button.action }).catch(() => {});
        }
      }
      return raised;
    };

    // 1. Doigt de mort sur le Cadavre.
    const finger = await cast("phbsplFingerofDe", "Cadavre", "spell7");
    ctx.expect(finger?.from === "Cadavre", `Doigt de mort : darsh-loot relève le Cadavre (${finger ? `${finger.token.name}` : "rien de relevé"})`);
    ctx.expect(!(await listTokens()).some(t => t.name === "Cadavre"), "Doigt de mort : le token du Cadavre a laissé place au zombi");

    // Remis en place pour le cas suivant : la remise du scénario fait le même travail.
    for ( const t of await listTokens() ) if ( !before.tokens.some(b => b.id === t.id) ) await ctx.call("delete-scene-object", { sceneId, type: "Token", objectId: t.id }).catch(() => {});
    if ( !(await listTokens()).some(t => t.name === "Cadavre") ) {
      await ctx.call("place-token", { sceneId, actorId: corpseActorId, x: corpsePos.x, y: corpsePos.y });
      await ctx.call("set-status", { actorId: corpseActorId, statusId: "dead", active: true }).catch(() => {});
    }
    seen = new Set((await listTokens()).map(t => t.id));

    // 2. Animation des morts sur le Cadavre visé d'avance.
    const animate = await cast("phbsplAnimateDea", "Cadavre", "spell3");
    ctx.expect(animate?.from === "Cadavre", `Animation des morts : la cible désignée d'avance est relevée (${animate ? animate.token.name : "rien de relevé"})`);

    seen = new Set((await listTokens()).map(t => t.id));
    // 3. Doigt de mort sur la Bête morte : refusé.
    const beast = await cast("phbsplFingerofDe", "Bête morte", "spell7");
    ctx.expect(!beast, `Doigt de mort sur un loup mort : rien n'est relevé par darsh-loot (${beast ? beast.token.name : "rien"})`);
    ctx.expect((await listTokens()).some(t => t.name === "Bête morte"), "la Bête morte reste sur la scène");
  }
};
