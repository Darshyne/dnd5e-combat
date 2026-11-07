/**
 * Issue #42, suite : la vue et l'ouïe face aux zones et aux murs, dans l'« Arène de la vision » (`node tools/arene-vision.mjs` d'abord).
 * Chaque phase pose sa zone ou ses murs, relève règles et écran pour chaque observateur (`api.mcp.visionMatrix`), puis les retire.
 *
 *  1. Nappe de brouillard (sphère de 20 ft) sur la Cible dans les ténèbres : la brume ne se perce que par la vision aveugle, les
 *     vibrations et Sense All — ni la vision véritable, ni la Vision du diable, ni la vision dans le noir. Le reste s'entend.
 *  2. Silence (sphère de 20 ft) au même endroit : la vue ne change pas, mais rien ne s'entend dedans ni à travers (« aucun son ne peut
 *     naître dans la Sphère ni la traverser ») ; ailleurs, on entend.
 *  3. Murs entre les observateurs de gauche et la Cible au loin : mur plein (ni vue ni son), vitre (la vue passe, pas le son), rideau
 *     (le son passe, pas la vue). Sense All ignore les murs.
 *  4. Une cible en vol dans le noir : les vibrations ne la perçoivent plus (detection-modes/tremor-perception.mjs), la vision dans le
 *     noir, si.
 *  5. L'Invisible révélé : Détection de l'invisibilité (l'Humain, sur lui-même) ; Lueurs féeriques sur la Cible invisible — tous la voient.
 * Écran : ce que les règles voient s'affiche (net ou par le contour de son sens) ; le reste est entendu (contour de l'ouïe) ou absent.
 */
import { ARENE_VISION } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = "Compendium.dnd-players-handbook.spells.";
const FOG = `${SPELLS}phbsplFogCloud00`;
const SILENCE = `${SPELLS}phbsplSilence000`;
const OBSERVERS = ["Humain", "Occultiste du diable", "Rôdeur elfe", "Vision véritable", "Vision aveugle", "Vibrations", "Sens tout", "Voir l'invisible"];
const LEFT = ["Humain", "Occultiste du diable", "Rôdeur elfe", "Vision véritable", "Sens tout", "Voir l'invisible"];   // à gauche du mur
const WALL = { NONE: 0, NORMAL: 20 };

export default {
  name: "vision — brume, Silence, murs (vue, son), vibrations et vol (Arène de la vision)",
  scene: ARENE_VISION.name,

  async run(ctx) {
    const tokens = {};
    for ( const name of [...OBSERVERS, ...Object.keys(ARENE_VISION.tokens).filter(n => n.startsWith("Cible"))] ) tokens[name] = await ctx.token(name);
    const caster = tokens["Occultiste du diable"];
    const grid = await ctx.gridSize();
    const { sceneId } = await ctx.scene();
    ctx.restore(() => ctx.removeEffectsNamed(caster, /concentr/i));
    const matrix = async (observers, targets) => (await ctx.engine("visionMatrix", { observerIds: observers.map(n => tokens[n].id),
      targetIds: targets.map(n => tokens[n].id) })).rows;
    const show = rows => { for ( const r of rows ) ctx.log(`  ${r.observer} → ${r.target} : règles ${r.rules.sees ? "voit" : "ne voit pas"}${r.rules.hears ? ", entend" : ", n'entend pas"} (${r.rules.distance} ft${r.rules.blocked.length ? `, ${r.rules.blocked.join("+")}` : ""}) ; écran ${r.screen}`); };
    /** Une ligne : règles attendues (vue, ouïe), et l'écran qui en découle. */
    const check = (r, sees, hears, label) => {
      ctx.expect(r.rules.sees === sees, `${label} : ${r.observer} ${sees ? "voit" : "ne voit pas"} ${r.target} (règles)`);
      if ( hears !== null ) ctx.expect(r.rules.hears === hears, `${label} : ${r.observer} ${hears ? "entend" : "n'entend pas"} ${r.target}`);
      const screen = r.rules.sees ? ["seen", "outline"] : [r.rules.hears ? "heard" : "hidden"];
      ctx.expect(screen.includes(r.screen), `${label} : ${r.observer} → ${r.target} à l'écran ${screen.join(" ou ")} (écran : ${r.screen})`);
    };
    const box = await ctx.box(tokens["Cible dans les ténèbres"]);
    const centre = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
    const zone = async (uuid, identifier) => {
      await ctx.ensureItem(caster, uuid, { system: { method: "atwill" } });
      const used = await ctx.use({ tokenId: caster.id, identifier, area: { shape: "circle", ...centre, radius: 4 * grid } });
      ctx.expect(used.used && !!used.regionId, `${identifier} posé`);
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      await pause(2000);
      return used.regionId;
    };
    const drop = async id => { if ( id ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); await pause(1200); };
    const IN = "Cible dans les ténèbres", BEHIND = "Cible derrière les ténèbres", FAR = "Cible au loin";

    // 1. Nappe de brouillard.
    const fog = await zone(FOG, "fog-cloud");
    if ( fog ) {
      // [dans, derrière] : la vue les atteint-elle à travers la brume ?
      const FOG_SEES = { "Humain": [false, false], "Occultiste du diable": [false, false], "Rôdeur elfe": [false, false],
        "Vision véritable": [false, false], "Vision aveugle": [true, false], "Vibrations": [true, true], "Sens tout": [true, true],
        "Voir l'invisible": [false, false] };
      const rows = await matrix(OBSERVERS, [IN, BEHIND, FAR]);
      ctx.log("Nappe de brouillard :"); show(rows);
      for ( const r of rows ) {
        const sees = (r.target === FAR) ? true : FOG_SEES[r.observer][(r.target === IN) ? 0 : 1];
        check(r, sees, true, "brume");
      }
      await drop(fog);
      await ctx.removeEffectsNamed(caster, /concentr/i);
    }

    // 2. Silence.
    const silence = await zone(SILENCE, "silence");
    if ( silence ) {
      const rows = await matrix(["Humain", "Rôdeur elfe", "Vision aveugle", "Vibrations"], [IN, BEHIND, FAR]);
      ctx.log("Silence :"); show(rows);
      for ( const r of rows ) {
        // La vue ne change pas (pleine lumière) ; l'ouïe s'arrête à la sphère — la cible dedans, ou derrière elle.
        check(r, true, (r.target === FAR) ? true : ((r.target === IN) ? false : null), "Silence");
        if ( r.target === BEHIND ) {
          const crosses = r.rules.blocked.includes("silence");
          ctx.expect(r.rules.hears === !crosses, `Silence : ${r.observer} ${crosses ? "n'entend pas" : "entend"} ${r.target} (le trait ${crosses ? "traverse" : "évite"} la sphère)`);
        }
      }
      await drop(silence);
      await ctx.removeEffectsNamed(caster, /concentr/i);
    }

    // 3. Murs entre la gauche (colonne 6) et la Cible au loin (colonne 10) : colonne 9, des lignes 0 à 7.
    const x = 9 * grid;
    const listWalls = async () => ((await ctx.call("list-scene-objects", { sceneId, types: ["Wall"] })).objects?.Wall ?? []).map(w => w.id);
    for ( const [label, sight, sound] of [["mur plein", WALL.NORMAL, WALL.NORMAL], ["vitre", WALL.NONE, WALL.NORMAL], ["rideau", WALL.NORMAL, WALL.NONE]] ) {
      const before = new Set(await listWalls());
      await ctx.call("create-walls", { sceneId, walls: [{ c: [x, 0, x, 7 * grid], move: WALL.NORMAL, sight, light: sight, sound }] });
      const added = (await listWalls()).filter(id => !before.has(id));
      ctx.restore(async () => { for ( const id of added ) await ctx.call("delete-scene-object", { type: "Wall", objectId: id }).catch(() => {}); });
      await pause(1500);
      const rows = await matrix(LEFT, [FAR]);
      ctx.log(`${label} :`); show(rows);
      for ( const r of rows ) {
        const always = r.observer === "Sens tout";   // Sense All : ni murs ni lumière
        check(r, always || (sight === WALL.NONE), sound === WALL.NONE, label);
      }
      for ( const id of added ) await ctx.call("delete-scene-object", { type: "Wall", objectId: id }).catch(() => {});
      await pause(1000);
    }

    // 4. En vol dans le noir : la vision dans le noir la voit, les vibrations non.
    const [dx, dy, dw, dh] = ARENE_VISION.dark;
    const night = await ctx.call("create-region", { sceneId, name: "Obscurité (essai)", color: "#000000",
      shapes: [{ type: "rectangle", x: dx * grid, y: dy * grid, width: dw * grid, height: dh * grid }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
    const nightId = night?.id ?? night?.regionId ?? night?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: nightId }).catch(() => {}));
    const dark = tokens["Cible dans le noir"];
    const fly = active => ctx.call("set-status", { tokenId: dark.id, statusId: "flying", active });
    ctx.restore(() => fly(false).catch(() => {}));
    await pause(1500);
    let rows = await matrix(["Vibrations", "Rôdeur elfe"], ["Cible dans le noir"]);
    ctx.log("dans le noir, au sol :"); show(rows);
    for ( const r of rows ) check(r, true, true, "au sol");
    await fly(true);
    await pause(1500);
    rows = await matrix(["Vibrations", "Rôdeur elfe"], ["Cible dans le noir"]);
    ctx.log("dans le noir, en vol :"); show(rows);
    for ( const r of rows ) check(r, r.observer === "Rôdeur elfe", true, "en vol");
    await fly(false);
    await ctx.call("delete-scene-object", { type: "Region", objectId: nightId }).catch(() => {});
    await pause(1000);

    // 5. L'Invisible révélé : Détection de l'invisibilité (sur soi, l'Humain) ; Lueurs féeriques sur la Cible invisible (Occultiste).
    const invisible = "Cible invisible";
    await ctx.call("set-status", { tokenId: tokens[invisible].id, statusId: "invisible", active: true });
    await ctx.removeEffectsNamed(tokens[invisible], /outlined|silhouette|faerie|lueur/i);
    await pause(1000);
    let rowsInv = await matrix(["Humain", "Rôdeur elfe"], [invisible]);
    for ( const r of rowsInv ) check(r, false, true, "Invisible");
    const human = tokens["Humain"];
    await ctx.ensureItem(human, `${SPELLS}phbsplSeeInvisib`, { system: { method: "atwill" } });
    ctx.restore(() => ctx.removeEffectsNamed(human, /see invisib|détection|concentr/i));
    // L'effet du sort (sens spécial « Invisible creatures ») se pose au bouton de la carte de dnd5e : posé ici directement.
    const seeItem = await ctx.itemId(human.id, "see-invisibility");
    await ctx.engine("placeItemEffect", { tokenId: human.id, casterId: human.id, itemId: seeItem, effectId: "BRwB0T8buWhJAuDx" });
    await pause(1500);
    rowsInv = await matrix(["Humain", "Rôdeur elfe"], [invisible]);
    ctx.log("Détection de l'invisibilité (Humain) :"); show(rowsInv);
    for ( const r of rowsInv ) check(r, r.observer === "Humain", true, "Détection de l'invisibilité");
    await ctx.removeEffectsNamed(human, /see invisib|détection|concentr/i);
    await pause(1000);
    // Lueurs féeriques : sauvegarde de Dextérité de la cible — rejouée jusqu'à l'échec (10 essais au plus).
    await ctx.ensureItem(caster, `${SPELLS}phbsplFaerieFire`, { system: { method: "atwill" } });
    const ib = await ctx.box(tokens[invisible]);
    let lit = false;
    for ( let n = 1; (n <= 10) && !lit; n++ ) {
      const used = await ctx.use({ tokenId: caster.id, identifier: "faerie-fire",
        area: { shape: "rectangle", x: ib.x - (grid / 2), y: ib.y - (grid / 2), width: grid * 2, height: grid * 2 } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      await pause(2500);
      lit = (await ctx.effects(tokens[invisible])).some(e => /outlined|silhouette|faerie|lueur/i.test(e.name ?? ""));
      if ( !lit ) { await ctx.removeEffectsNamed(caster, /concentr/i); if ( used.regionId ) await ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}); }
    }
    ctx.expect(lit, "Lueurs féeriques : la Cible invisible a raté sa sauvegarde");
    if ( lit ) {
      ctx.restore(() => ctx.removeEffectsNamed(tokens[invisible], /outlined|silhouette|faerie|lueur/i));
      rowsInv = await matrix(["Humain", "Rôdeur elfe", "Voir l'invisible"], [invisible]);
      ctx.log("Lueurs féeriques sur la Cible invisible :"); show(rowsInv);
      for ( const r of rowsInv ) check(r, true, true, "Lueurs féeriques");
    }
  }
};
