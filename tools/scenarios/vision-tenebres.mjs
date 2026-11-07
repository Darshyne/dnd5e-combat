/**
 * Issue #42 : Ténèbres et Vision du diable, dans l'« Arène de la vision » (`node tools/arene-vision.mjs` d'abord). L'Occultiste du
 * diable lance Ténèbres depuis sa fiche sur la Cible dans les ténèbres ; puis, pour chaque observateur, ce que jugent les règles
 * (`api.mcp.visionMatrix`, `canSee` — c'est lui qui refuse une cible « pas en vue ») et ce que montre l'écran par ses yeux.
 *
 * Règles attendues (PHB 2024) :
 *  - Humain, Rôdeur elfe (vision dans le noir) : ne voient ni la cible dans les ténèbres, ni celle derrière ; voient le témoin au loin.
 *  - Occultiste du diable (Vision du diable, 120 ft) : voit dans les ténèbres et à travers ; plus au-delà de 120 ft.
 *  - Vision véritable (120 ft) : voit dans et à travers. Vision aveugle (30 ft) : la cible dans les ténèbres (25 ft), pas celle derrière.
 * Puis Aveuglé (Occultiste, Vision véritable, Vision aveugle) et Assourdi (Humain) : seule la vision aveugle perçoit encore, le reste
 * s'entend (contour de l'ouïe) ; l'Assourdi n'entend plus rien.
 * Puis Lumière du jour à côté : les Ténèbres sont dissipées, l'Humain voit de nouveau.
 * Écran : ce que les règles voient s'affiche net (« seen ») ou par le contour de son sens (« outline » : vision aveugle, vision
 * véritable, filtres de dnd5e) ; ce qu'elles ne voient pas n'est jamais net (caché, ou contour de l'ouïe, « heard », §62). Puis le même relevé réglage « Vision simulée » coupé, pour comparer avec le rendu du cœur seul (journal, sans attente).
 *
 * Sans l'Arène de la vision (autre monde), non applicable : le lanceur saute un scénario dont la scène manque.
 */
import { ARENE_VISION } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const OBSERVERS = ["Humain", "Occultiste du diable", "Rôdeur elfe", "Vision véritable", "Vision aveugle", "Vibrations", "Sens tout", "Voir l'invisible"];
const TARGETS = ["Cible dans les ténèbres", "Cible derrière les ténèbres", "Cible au loin", "Cible dans le noir", "Cible invisible"];

// observateur → [dans les ténèbres, derrière les ténèbres, au loin (témoin), dans le noir (obscurité ordinaire), invisible] : les règles
// voient-elles ? Distances (diagonales à 5 ft) : voir ARENE_VISION.
const EXPECTED = Object.fromEntries(Object.entries({
  "Humain":               [false, false, true, false, false],
  "Rôdeur elfe":          [false, false, true, true,  false],   // vision dans le noir 60 ft : le noir ordinaire, pas les Ténèbres
  "Occultiste du diable": [true,  true,  true, true,  false],   // Vision du diable 120 ft : « voit normalement », pas l'invisible
  "Vision véritable":     [true,  true,  true, true,  true],
  "Vision aveugle":       [true,  false, true, true,  true],    // 30 ft : la cible derrière les Ténèbres est à 55 ft
  "Vibrations":           [true,  true,  true, true,  true],    // 60 ft, ni murs ni lumière
  "Sens tout":            [true,  true,  true, true,  true],    // mode générique du cœur, 120 ft, ni murs ni lumière
  "Voir l'invisible":     [false, false, true, false, true]     // une vue : ni Ténèbres ni noir, mais l'invisible en pleine lumière
}).map(([name, row]) => [name, Object.fromEntries(TARGETS.map((t, i) => [t, row[i]]))]));

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

    // 0. Avant les Ténèbres et le noir : tout le monde voit tout (pleine lumière), sauf la Cible invisible.
    const before = (await matrix()).filter(r => r.target !== "Cible invisible");
    ctx.expect(before.every(r => r.rules.sees === true), "pleine lumière : chaque observateur voit chaque cible visible (règles)");
    ctx.expect(before.every(r => ["seen", "outline"].includes(r.screen)), "pleine lumière : chaque cible visible s'affiche");

    // 1. Ténèbres depuis la fiche de l'Occultiste du diable, centrées sur la Cible dans les ténèbres.
    const box = await ctx.box(tokens[ARENE_VISION.darknessOn]);
    const centre = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
    const dark = await ctx.use({ tokenId: warlock.id, identifier: "darkness", area: { shape: "circle", ...centre, radius: 3 * grid } });
    ctx.expect(dark.used && !!dark.regionId, "Ténèbres posées");
    if ( !dark.regionId ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: dark.regionId }).catch(() => {}));

    // 1 bis. Obscurité ordinaire (sans sort) autour de la Cible dans le noir : une région « Ajuster l'obscurité », comme `furtivite-bg3`.
    const { sceneId } = await ctx.scene();
    const [dx, dy, dw, dh] = ARENE_VISION.dark;
    const night = await ctx.call("create-region", { sceneId, name: "Obscurité (essai)", color: "#000000",
      shapes: [{ type: "rectangle", x: dx * grid, y: dy * grid, width: dw * grid, height: dh * grid }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
    const nightId = night?.id ?? night?.regionId ?? night?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: nightId }).catch(() => {}));
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

    // 4 bis. Aveuglé et Assourdi : la Vision du diable et la vision véritable s'éteignent, la vision aveugle reste ; l'Assourdi n'entend
    // plus rien (pas de contour, pas d'oreille).
    const status = (name, statusId, active) => ctx.call("set-status", { tokenId: tokens[name].id, statusId, active });
    const BLINDED = ["Occultiste du diable", "Vision véritable", "Vision aveugle"];
    for ( const name of BLINDED ) { ctx.restore(() => status(name, "blinded", false).catch(() => {})); await status(name, "blinded", true); }
    ctx.restore(() => status("Humain", "deafened", false).catch(() => {}));
    await status("Humain", "deafened", true);
    await pause(1000);
    const BLIND_EXPECTED = {
      "Occultiste du diable": [false, false, false, false, false],
      "Vision véritable":     [false, false, false, false, false],
      "Vision aveugle":       [true,  false, true,  true,  true]    // 30 ft : dans les Ténèbres, le témoin, le noir, l'Invisible
    };
    const impaired = (await ctx.engine("visionMatrix", { observerIds: [...BLINDED, "Humain"].map(n => tokens[n].id), targetIds: TARGETS.map(n => tokens[n].id) })).rows;
    ctx.log("Aveuglé (Occultiste, Vision véritable, Vision aveugle), Assourdi (Humain) :");
    show(impaired);
    for ( const r of impaired ) {
      if ( r.observer === "Humain" ) {
        const want = EXPECTED.Humain[r.target];
        ctx.expect(r.rules.hears === false, `Humain Assourdi : n'entend pas ${r.target}`);
        if ( !want ) ctx.expect(r.screen === "hidden", `Humain Assourdi : ${r.target} ni vue ni entendue à l'écran (écran : ${r.screen})`);
        continue;
      }
      const want = BLIND_EXPECTED[r.observer][TARGETS.indexOf(r.target)];
      ctx.expect(r.rules.sees === want, `${r.observer} Aveuglé ${want ? "perçoit" : "ne voit pas"} ${r.target} (règles)`);
      if ( r.rules.sees ) ctx.expect(["seen", "outline"].includes(r.screen), `${r.observer} Aveuglé : ${r.target} affichée par son sens (écran : ${r.screen})`);
      // Ce qu'il ne perçoit pas, il l'entend : le contour de l'ouïe, même Aveuglé (le cœur saute la perception de la lumière d'une
      // source aveuglée ; le mode `dasHearing` du moteur prend le relais).
      else ctx.expect(r.screen === (r.rules.hears ? "heard" : "hidden"), `${r.observer} Aveuglé : ${r.target} ${r.rules.hears ? "entendue" : "absente"} à l'écran (écran : ${r.screen})`);
    }
    for ( const name of BLINDED ) await status(name, "blinded", false);
    await status("Humain", "deafened", false);
    await pause(800);

    // 4 ter. Le geste du MJ : le Rôdeur elfe déjà sélectionné, puis Aveuglé à la main — le cœur ne refait que sa source de vision
    // (placeables/token.mjs:4580), pas toutes : l'ouïe en mémoire doit survivre (elle disparaissait, vu le 2026-11-08).
    const ranger = tokens["Rôdeur elfe"];
    ctx.restore(() => ctx.engine("controlToken", { tokenId: null }).catch(() => {}));
    await ctx.engine("controlToken", { tokenId: ranger.id });
    await pause(800);
    ctx.restore(() => status("Rôdeur elfe", "blinded", false).catch(() => {}));
    await status("Rôdeur elfe", "blinded", true);
    await pause(1500);
    const heardBlind = await ctx.engine("screenHere", { targetIds: TARGETS.map(n => tokens[n].id) });
    ctx.log(`Rôdeur elfe sélectionné puis Aveuglé : ${heardBlind.tokens.map(t => `${t.name} ${t.shown}`).join(", ")}`);
    ctx.expect(heardBlind.tokens.every(t => t.shown === "heard"), "Rôdeur elfe Aveuglé à la main : chaque cible entendue (contour de l'ouïe)");
    await status("Rôdeur elfe", "blinded", false);
    await ctx.engine("controlToken", { tokenId: null });
    await pause(800);

    // 4 quater. Lumière du jour (niveau 3) posée à 20 ft des Ténèbres (niveau 2) : elles sont dissipées, l'Humain voit la cible.
    const human = tokens["Humain"];
    await ctx.ensureItem(human, "Compendium.dnd-players-handbook.spells.phbsplDaylight00", { system: { method: "atwill" } });
    ctx.restore(() => ctx.removeEffectsNamed(human, /concentr/i));
    const day = await ctx.use({ tokenId: human.id, identifier: "daylight", area: { shape: "circle", x: centre.x - (4 * grid), y: centre.y, radius: 12 * grid } });
    ctx.expect(day.used && !!day.regionId, "Lumière du jour posée");
    if ( day.regionId ) {
      ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: day.regionId }).catch(() => {}));
      await pause(2500);
      const regions = (await ctx.call("list-scene-objects", { sceneId, types: ["Region"] })).objects?.Region ?? [];
      ctx.expect(!regions.some(r => r.id === dark.regionId), "les Ténèbres sont dissipées");
      const after = (await ctx.engine("visionMatrix", { observerIds: [human.id], targetIds: [tokens["Cible dans les ténèbres"].id, tokens["Cible derrière les ténèbres"].id] })).rows;
      show(after);
      for ( const r of after ) ctx.expect(r.rules.sees && (r.screen === "seen"), `Ténèbres dissipées : l'Humain voit ${r.target} (écran : ${r.screen})`);
      await ctx.call("delete-scene-object", { type: "Region", objectId: day.regionId }).catch(() => {});
      await pause(1000);
    }

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
