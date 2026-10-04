/**
 * Marcher d'un niveau à l'autre par le chemin du MOTEUR (P2 b, SPEC §14.2) sur une scène à niveaux et escaliers
 * (Restored Keep) — comme un clic de déplacement, par `call-module-api` (connecteur ≥ 0.28.0) et `api.mcp.move`.
 *  1. Hors combat : l'A* va à une case de l'autre niveau voisine d'un escalier — un seul pas `displace` sur l'escalier,
 *     avec sa hauteur (`climb`), puis de la marche. Le token arrive au niveau et à la case prévus, à l'élévation du plan,
 *     sans dialogue « Change Level » du cœur (on n'entre jamais dans un escalier en marchant), et la vue du MJ suit.
 *  2. Retour à la case de départ, même chemin en sens inverse.
 *  2 bis. Clic sur une case d'escalier de son propre niveau (§18.26) : le token s'arrête à côté et y entre en marchant, le
 *     cœur ouvre son dialogue « Change Level », le scénario y répond (connecteur ≥ 0.29.0 : list-dialogs, answer-dialog)
 *     et le token passe à l'autre niveau.
 *  3. En combat, posé à côté de l'escalier : un budget d'une unité sous la hauteur laisse l'escalier hors budget ; avec
 *     le budget du tour, la montée passe et sa hauteur est notée (`climbed`) et comptée comme dépensée.
 * Remet la vue du MJ sur son niveau ; le filet de sécurité replace le token. Sans escalier, non applicable.
 */
const NAMES = ["Paladin", "Guerrier"];
const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
const MAX_CANDIDATES = 40;

export default {
  scene: "keep",   // §83 : étages et escaliers, dans Restored Keep
  name: "escaliers — l'A* du moteur change de niveau par un escalier",

  async run(ctx) {
    const { levels } = await ctx.call("list-levels", {});
    if ( !(levels?.length > 1) ) { ctx.log("scène à un seul niveau : non applicable"); return; }
    const { tokens } = await ctx.scene();
    const name = NAMES.find(n => tokens.some(t => t.name === n));
    if ( !name ) { ctx.log(`aucun de ${NAMES.join(", ")} sur la scène : non applicable`); return; }
    const walker = await ctx.token(name);
    const levelName = id => levels.find(l => l.id === id)?.name ?? id;

    const start = await ctx.engine("movement", { tokenId: walker.id });
    const home = start.position;
    const initialView = start.viewedLevel;
    if ( initialView ) ctx.restore(() => ctx.engine("view", { levelId: initialView }));
    const size = await ctx.gridSize();
    const centerOf = w => ({ x: w.x + (size / 2), y: w.y + (size / 2) });

    // Les escaliers qui partent du niveau du token.
    const stairs = (await ctx.engine("stairs", { tokenId: walker.id })).filter(s => s.levels.includes(home.level) && (s.levels.length > 1));
    if ( !stairs.length ) { ctx.log(`aucun escalier au niveau « ${levelName(home.level)} » : non applicable`); return; }

    // Une destination : case voisine d'un escalier, sur l'autre niveau, hors de l'escalier, que l'A* atteint en passant par lui.
    let found = null;
    let tried = 0;
    search: for ( const s of stairs ) {
      const inside = new Set(s.cells.map(c => `${c.i},${c.j}`));
      for ( const other of s.levels.filter(l => l !== home.level) ) {
        for ( const c of s.cells ) for ( const [di, dj] of NEIGHBOURS ) {
          const cell = { i: c.i + di, j: c.j + dj };
          if ( inside.has(`${cell.i},${cell.j}`) ) continue;
          if ( ++tried > MAX_CANDIDATES ) break search;
          const plan = await ctx.engine("plan", { tokenId: walker.id, cell, levelId: other, maxCost: 1e9 });
          const index = plan.found ? plan.waypoints.findIndex(w => (w.action === "displace") && w.level) : -1;
          if ( plan.arrives && (index >= 0) && (index < plan.waypoints.length - 1) ) { found = { stairs: s, level: other, cell, plan, index }; break search; }
        }
      }
    }
    if ( !ctx.expect(found, `un chemin vers un autre niveau par un escalier (${tried} case(s) essayée(s))`) ) return;
    const { plan, index, level } = found;
    const change = plan.waypoints[index];
    const last = plan.waypoints.at(-1);
    ctx.log(`destination : case ${found.cell.i},${found.cell.j} au niveau « ${levelName(level)} » par « ${found.stairs.name} », ${plan.waypoints.length} point(s)`);
    ctx.expect(plan.waypoints.filter(w => w.action === "displace").length === 1, "un seul pas `displace` dans le chemin");
    ctx.expect((change.level === level) && (change.climb > 0), `le pas d'escalier change de niveau et porte sa hauteur (climb ${change.climb})`);

    // 1. Aller.
    const there = await ctx.engine("move", { tokenId: walker.id, cell: found.cell, levelId: level });
    ctx.log(`aller : ${there.elapsedMs} ms`);
    ctx.expect(there.after.level === level, `arrivé au niveau « ${levelName(there.after.level)} »`);
    ctx.expect((there.after.x === last.x) && (there.after.y === last.y), `à la case prévue (${there.after.x}, ${there.after.y} ; plan ${last.x}, ${last.y})`);
    if ( last.elevation !== null ) ctx.expect(there.after.elevation === last.elevation, `à l'élévation du plan (${there.after.elevation} ; plan ${last.elevation})`);
    ctx.expect(!there.newWindows.length, `aucun dialogue ouvert${there.newWindows.length ? ` — ${there.newWindows.map(w => w.title ?? w.id).join(", ")}` : ""}`);
    if ( initialView === home.level ) ctx.expect(there.viewedLevel === level, `la vue du MJ suit le token (« ${levelName(there.viewedLevel)} »)`);

    // 2. Retour.
    const back = await ctx.engine("move", { tokenId: walker.id, cell: home.cell, levelId: home.level });
    ctx.log(`retour : ${back.elapsedMs} ms`);
    ctx.expect((back.after.level === home.level) && (back.after.x === home.x) && (back.after.y === home.y), `revenu à la case de départ, niveau « ${levelName(back.after.level)} »`);
    ctx.expect(!back.newWindows.length, "aucun dialogue au retour");

    // 2 bis. §18.26 : un clic sur l'escalier de son propre niveau — le token s'arrête à côté puis y entre en marchant, et le
    // cœur ouvre son dialogue « Change Level » ; on y répond (connecteur ≥ 0.29.0 : list-dialogs, answer-dialog).
    const ownStairs = found.stairs.cells.find(c => (c.i !== home.cell.i) || (c.j !== home.cell.j));
    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    let entering = await ctx.call("call-module-api", { moduleId: "dnd5e-combat", fn: "move", args: { tokenId: walker.id, cell: ownStairs, levelId: home.level }, waitMs: 500 });
    let dialog = null;
    for ( let n = 0; (n < 4) && !dialog && !entering.settled; n++ ) {
      dialog = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 8000 })).windows[0] ?? null;
    }
    const levelField = dialog?.fields?.find(f => f.name === "level");
    ctx.expect(!!levelField && levelField.options.some(o => o.value === level), `le cœur ouvre son dialogue « ${dialog?.title ?? "—"} » (niveaux proposés : ${levelField?.options.map(o => o.label).join(", ") ?? "—"})`);
    if ( dialog ) {
      const yes = dialog.buttons.find(b => b.action === "yes");
      const answer = await ctx.call("answer-dialog", { id: dialog.id, ...(levelField?.disabled ? {} : { fields: { level } }), button: "yes" });
      ctx.expect(!answer.stillOpen, `répondu « ${answer.clicked?.label ?? yes?.label} », dialogue fermé`);
    }
    for ( let n = 0; (n < 8) && !entering.settled; n++ ) entering = await ctx.call("call-module-api", { callId: entering.callId, waitMs: 8000 });
    if ( ctx.expect(entering.settled, "le déplacement s'achève après la réponse") ) {
      // Le cœur change le niveau APRÈS la fin du pas (change-level.mjs, `#moveToken`) : on attend qu'il l'ait fait.
      let upstairs = entering.result.after;
      for ( let n = 0; (n < 20) && (upstairs.level !== level); n++ ) {
        await new Promise(r => setTimeout(r, 250));
        upstairs = (await ctx.engine("movement", { tokenId: walker.id })).position;
      }
      ctx.expect(upstairs.level === level, `passé au niveau « ${levelName(upstairs.level)} » par le dialogue du cœur`);
    }

    // 3. En combat, depuis la case d'où part le pas d'escalier (sur le niveau de départ).
    const from = index > 0 ? plan.waypoints[index - 1] : home;
    const placed = await ctx.call("move-token", { tokenId: walker.id, x: from.x, y: from.y, levelId: home.level, elevation: home.elevation });
    if ( initialView ) await ctx.engine("view", { levelId: initialView });
    if ( !ctx.expect(placed.moved, `posé à côté de l'escalier (${from.x}, ${from.y})`) ) return;
    await ctx.startCombat([walker]);
    const fresh = await ctx.engine("movement", { tokenId: walker.id });
    if ( !ctx.expect(fresh.combat, "le token est dans le combat") ) return;
    ctx.log(`vitesse ${fresh.combat.speed} ${fresh.combat.units}, plafond ${fresh.cap}, dépensé ${fresh.combat.spent}`);
    const stairsCell = { point: centerOf(change) };

    const short = await ctx.engine("plan", { tokenId: walker.id, ...stairsCell, levelId: level, maxCost: change.climb - 1 });
    ctx.expect(short.found && !short.arrives && short.beyond.some(w => (w.action === "displace") && (w.level === level)),
      `budget d'une unité sous la hauteur : l'escalier passe hors budget (${short.waypoints?.length ?? 0} point(s) parcourables)`);

    const climb = await ctx.engine("plan", { tokenId: walker.id, ...stairsCell, levelId: level });
    const fits = (fresh.cap === null) || (change.climb <= fresh.cap);
    if ( !fits ) {
      ctx.expect(!climb.arrives, `hauteur ${change.climb} au-delà du plafond du tour ${fresh.cap} : escalier hors budget`);
      return;
    }
    ctx.expect(climb.arrives && (climb.waypoints.at(-1)?.level === level), "avec le budget du tour, la montée passe");
    const up = await ctx.engine("move", { tokenId: walker.id, ...stairsCell, levelId: level });
    ctx.expect(up.after.level === level, `en combat, arrivé au niveau « ${levelName(up.after.level)} »`);
    const spent = await ctx.engine("movement", { tokenId: walker.id });
    const climbed = spent.combat?.climbed ?? 0;
    const want = climb.waypoints.find(w => w.action === "displace")?.climb ?? change.climb;
    ctx.expect(climbed === want, `hauteur notée au budget du tour (climbed ${climbed}, attendu ${want})`);
    ctx.expect((spent.combat?.spent ?? 0) >= climbed, `et comptée comme dépensée (dépensé ${spent.combat?.spent} ${spent.combat?.units})`);
  }
};
