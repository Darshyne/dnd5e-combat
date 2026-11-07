/**
 * Issue #42 : Ténèbres et Vision du diable, dans l'« Arène de la vision » (`node tools/arene-vision.mjs` d'abord). L'Occultiste du
 * diable lance Ténèbres depuis sa fiche sur la Cible dans les ténèbres ; puis, pour chaque observateur, ce que jugent les règles
 * (`api.mcp.visionMatrix`, `canSee` — c'est lui qui refuse une cible « pas en vue ») et ce que montre l'écran par ses yeux.
 *
 * Règles attendues (PHB 2024) :
 *  - Humain, Rôdeur elfe (vision dans le noir) : ne voient ni la cible dans les ténèbres, ni celle derrière ; voient le témoin au loin.
 *  - Occultiste du diable (Vision du diable, 120 ft) : voit dans les ténèbres et à travers ; plus au-delà de 120 ft.
 *  - Vision véritable (120 ft) : voit dans et à travers. Vision aveugle (30 ft) : la cible dans les ténèbres (25 ft), pas celle derrière.
 * Écran : ce que les règles voient s'affiche net (« seen ») ou par le contour de son sens (« outline » : vision aveugle, vision
 * véritable, filtres de dnd5e) ; ce qu'elles ne voient pas n'est jamais net (caché, ou contour de l'ouïe, « heard », §62). Puis le même relevé réglage « Vision simulée » coupé, pour comparer avec le rendu du cœur seul (journal, sans attente).
 *
 * Sans l'Arène de la vision (autre monde), non applicable : le lanceur saute un scénario dont la scène manque.
 */
import { ARENE_VISION } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const OBSERVERS = ["Humain", "Occultiste du diable", "Rôdeur elfe", "Vision véritable", "Vision aveugle"];
const TARGETS = ["Cible dans les ténèbres", "Cible derrière les ténèbres", "Cible au loin"];

// observateur → cible → les règles voient-elles ?
const EXPECTED = {
  "Humain": { "Cible dans les ténèbres": false, "Cible derrière les ténèbres": false, "Cible au loin": true },
  "Rôdeur elfe": { "Cible dans les ténèbres": false, "Cible derrière les ténèbres": false, "Cible au loin": true },
  "Occultiste du diable": { "Cible dans les ténèbres": true, "Cible derrière les ténèbres": true, "Cible au loin": true },
  "Vision véritable": { "Cible dans les ténèbres": true, "Cible derrière les ténèbres": true, "Cible au loin": true },
  "Vision aveugle": { "Cible dans les ténèbres": true, "Cible derrière les ténèbres": false, "Cible au loin": true }
};

export default {
  name: "vision — Ténèbres, Vision du diable, vision dans le noir, vision véritable, vision aveugle (Arène de la vision)",
  scene: ARENE_VISION.name,

  async run(ctx) {
    const tokens = {};
    for ( const name of [...OBSERVERS, ...TARGETS] ) tokens[name] = await ctx.token(name);
    const warlock = tokens["Occultiste du diable"];
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.removeEffectsNamed(warlock, /concentr/i));

    const matrix = async () => (await ctx.engine("visionMatrix", { observerIds: OBSERVERS.map(n => tokens[n].id), targetIds: TARGETS.map(n => tokens[n].id) })).rows;
    const show = rows => {
      for ( const r of rows ) {
        const why = [r.rules.blocked.length ? `zone ${r.rules.blocked.join("+")}` : null, `${r.rules.distance} ft`,
          r.rules.devilsSight ? `Vision du diable ${r.rules.devilsSight}` : null, r.rules.lineOfSight ? null : (r.rules.lineOfSightThroughDarkness ? "vue coupée par les ténèbres seules" : "pas de ligne de vue"),
          r.rules.hears ? "entend" : null].filter(Boolean).join(", ");
        ctx.log(`  ${r.observer} → ${r.target} : règles ${r.rules.sees ? "voit" : "ne voit pas"} (${why}) ; écran ${r.screen}`);
      }
    };

    // 0. Avant les Ténèbres : tout le monde voit tout (pleine lumière).
    const before = await matrix();
    ctx.expect(before.every(r => r.rules.sees === true), "pleine lumière : chaque observateur voit chaque cible (règles)");
    ctx.expect(before.every(r => r.screen === "seen"), "pleine lumière : chaque cible s'affiche nette");

    // 1. Ténèbres depuis la fiche de l'Occultiste du diable, centrées sur la Cible dans les ténèbres.
    const box = await ctx.box(tokens[ARENE_VISION.darknessOn]);
    const centre = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
    const dark = await ctx.use({ tokenId: warlock.id, identifier: "darkness", area: { shape: "circle", ...centre, radius: 3 * grid } });
    ctx.expect(dark.used && !!dark.regionId, "Ténèbres posées");
    if ( !dark.regionId ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: dark.regionId }).catch(() => {}));
    await pause(2000);

    // 2. Règles et écran, observateur par observateur. Le témoin : la Vision du diable et la vision véritable traversent les ténèbres.
    const rows = await matrix();
    show(rows);
    for ( const r of rows ) {
      const want = EXPECTED[r.observer]?.[r.target];
      if ( want === undefined ) continue;
      ctx.expect(r.rules.sees === want, `${r.observer} ${want ? "voit" : "ne voit pas"} ${r.target} (règles)`);
      // Vue : nette, ou par le contour de son propre sens (vision aveugle, vision véritable : le filtre de dnd5e) — jamais l'ouïe.
      if ( r.rules.sees ) ctx.expect(["seen", "outline"].includes(r.screen), `${r.observer} : ${r.target} vue par les règles, affichée par sa vue ou son sens (écran : ${r.screen})`);
      else ctx.expect(r.screen !== "seen", `${r.observer} : ${r.target} non vue par les règles, jamais nette à l'écran (écran : ${r.screen})`);
    }

    // 2 bis. Le refus de cible (le panneau de l'issue) : Maléfice, « une créature que vous voyez », prêté à l'Occultiste et à l'Humain.
    const HEX = "Compendium.dnd-players-handbook.spells.phbsplHex0000000";
    for ( const name of ["Occultiste du diable", "Humain"] ) await ctx.ensureItem(tokens[name], HEX, { system: { method: "atwill" } });
    const aimed = ["Cible dans les ténèbres", "Cible derrière les ténèbres"].map(n => tokens[n].id);
    const seer = await ctx.engine("sightIssues", { tokenId: warlock.id, identifier: "hex", targetIds: aimed });
    ctx.expect(seer.requiresSight, "Maléfice demande de voir sa cible");
    ctx.expect(!seer.unseen.length, `l'Occultiste du diable peut viser dans et derrière les Ténèbres (refusées : ${seer.unseen.join(", ") || "aucune"})`);
    const blind = await ctx.engine("sightIssues", { tokenId: tokens["Humain"].id, identifier: "hex", targetIds: aimed });
    ctx.expect(blind.unseen.length === 2, `l'Humain, lui, ne peut pas (refusées : ${blind.unseen.join(", ") || "aucune"})`);

    // 3. Portée de la Vision du diable : l'Occultiste à 125 ft de la cible dans les ténèbres (colonne 42).
    const [, row] = ARENE_VISION.tokens["Occultiste du diable"];
    const far = await ctx.call("move-token", { tokenId: warlock.id, x: 42 * grid, y: row * grid, elevation: 0 });
    ctx.expect(!!far, "Occultiste du diable déplacé à 125 ft");
    await pause(800);
    const away = (await ctx.engine("visionMatrix", { observerIds: [warlock.id], targetIds: [tokens["Cible dans les ténèbres"].id], screen: true })).rows[0];
    show([away]);
    ctx.expect(away.rules.sees === false, `au-delà de 120 ft, la Vision du diable ne voit plus dans les ténèbres (${away.rules.distance} ft)`);
    ctx.expect(away.screen !== "seen", `au-delà de 120 ft, la cible n'est pas nette à l'écran (écran : ${away.screen})`);
    const [x0, y0] = ARENE_VISION.tokens["Occultiste du diable"];
    await ctx.call("move-token", { tokenId: warlock.id, x: x0 * grid, y: y0 * grid, elevation: 0 });
    await pause(800);

    // 4. Réglage « Vision simulée » coupé : le rendu du cœur seul, pour comparaison (journal).
    const setting = await ctx.call("get-setting", { namespace: "dnd5e-combat", key: "vision" });
    const was = setting?.value ?? setting;
    ctx.restore(() => ctx.call("set-setting", { namespace: "dnd5e-combat", key: "vision", value: was }));
    await ctx.call("set-setting", { namespace: "dnd5e-combat", key: "vision", value: false });
    await pause(800);
    ctx.log("réglage « Vision simulée » coupé (rendu du cœur seul) :");
    show(await matrix());
  }
};
