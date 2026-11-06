/**
 * §383 (issue #38) : une invocation à plusieurs formes lancée comme depuis la barre d'actions (sans la fenêtre de dnd5e) ouvre la
 * fenêtre « Choisir la forme » du moteur, et la forme choisie est celle que dnd5e invoque — pas la première d'office.
 *  1. Convocation de céleste : Défenseur (le second profil ; avant le correctif, Vengeur était pris sans rien demander).
 *  2. Convocation d'élémentaire : Feu (le troisième des quatre).
 * Le Magicien reçoit les sorts du Manuel des joueurs le temps du test ; rien n'est consommé ; les créatures posées sont retirées.
 */
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// `index` : la forme choisie, par sa place (les noms suivent la langue du client du MJ : Defender / Défenseur avec le PHB-fr).
// `fx` : un morceau du nom de l'animation d'apparition attendue quand BLFX et darsh-animations sont actifs (Céleste : l'entrée que
// darsh-animations ajoute, BLFX n'en a pas ; Élémentaire : celle de BLFX).
const CASES = [
  { item: "phbsplSummonCele", index: 1, label: "Défenseur", fx: "holy_light2" },
  { item: "phbsplSummonElem", index: 2, label: "Feu", fx: null },
  // Depuis la fiche, par le MJ, sans emplacement de niveau 5 (Kaalisti, Occultiste 5, dans le retour de table) : « Plus de charge »
  // (§77) → « Lancer quand même », dont la relance sautait la fenêtre de dnd5e — Vengeur d'office.
  { item: "phbsplSummonCele", index: 1, label: "Défenseur (fiche, sans emplacement)", fx: null, sheet: true }
];

export default {
  name: "invocations — la forme se choisit quand la barre saute la fenêtre de dnd5e (Céleste, Élémentaire)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const grid = await ctx.gridSize();
    const pos = await ctx.position(mage);
    const summoned = [];
    // dnd5e crée un acteur du monde pour la créature invoquée quand il n'en a pas déjà un (`Actor5e.fetchExisting`) : ceux du test
    // partent à la corbeille du connecteur.
    const actorsBefore = new Set((await ctx.call("list-actors", {})).map(a => a.id));
    const actorsMade = new Set();
    ctx.restore(async () => {
      for ( const id of actorsMade ) if ( !actorsBefore.has(id) ) await ctx.call("trash-document", { documentType: "Actor", documentId: id }).catch(() => {});
      const live = (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.map(t => t.id);
      for ( const id of summoned ) if ( live.includes(id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
      for ( const d of (await ctx.call("list-dialogs", { dialogsOnly: true })).windows ?? [] ) {
        if ( /Summon|Convocation/.test(d.title ?? "") ) await ctx.call("answer-dialog", { id: d.id, close: true }).catch(() => {});
      }
    });

    // L'animation de Convocation de céleste vient de darsh-animations ≥ la version qui publie `previewSummon` (son SPEC §22).
    const summonFx = !!(await ctx.call("call-module-api", { moduleId: "darsh-animations", fn: "previewSummon", args: {} }).catch(() => null));
    const slots6 = Number((await ctx.call("get-actor", { actorId: mage.actorId })).system?.spells?.spell6?.value) > 0;
    const slots5 = Number((await ctx.call("get-actor", { actorId: mage.actorId })).system?.spells?.spell5?.value) > 0;
    const animated = !!(await ctx.call("call-module-api", { moduleId: "darsh-animations", fn: "renderer", args: {} }).catch(() => null))
      && ((await ctx.engine("sequencer", {})).available);
    for ( const [n, { item: source, index, label, fx, sheet=false }] of CASES.entries() ) {
      const itemId = await ctx.ensureItem(mage, SPELLS + source);
      if ( sheet && slots5 ) { ctx.log(`${source} : le Magicien a des emplacements de niveau 5, cas « sans emplacement » sauté`); continue; }
      const started = await ctx.engine("castFromBar", { tokenId: mage.id, itemId, sheet, x: pos.x + ((n + 1) * grid), y: pos.y + grid });
      if ( sheet ) {
        const asked = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 8000 });
        const forced = (asked.windows ?? []).find(d => (d.buttons ?? []).some(b => b.action === "yes") && !(d.fields ?? []).some(f => f.name === "profile"));
        if ( !ctx.expect(!!forced, `${source} : le MJ peut lancer sans emplacement (« Plus de charge »)`) ) continue;
        await ctx.call("answer-dialog", { id: forced.id, button: "yes" });
      }
      const wanted = started.profiles[index];
      if ( !ctx.expect(!!wanted, `${source} : la forme ${label} existe (${started.profiles.map(p => p.name).join(" / ")})`) ) continue;
      let dialog = null;
      for ( let i = 0; !dialog && (i < 8); i++ ) {
        const found = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 });
        dialog = (found.windows ?? []).find(d => (d.fields ?? []).some(f => f.name === "profile"));
        if ( !dialog ) await pause(500);
      }
      if ( !ctx.expect(!!dialog, `${source} : la fenêtre « Choisir la forme » s'ouvre (${sheet ? "relance sans emplacement" : "barre"}, sans la fenêtre de dnd5e)`) ) continue;
      await ctx.call("answer-dialog", { id: dialog.id, fields: { profile: wanted.id }, button: "summon" });
      let captured = null;
      for ( let i = 0; i < 20; i++ ) {
        await pause(500);
        captured = await ctx.engine("summonCaptured", {});
        if ( captured?.tokens ) break;
      }
      ctx.expect(captured?.summoned?.profile === wanted.id, `${source} : dnd5e invoque la forme choisie, ${wanted.name} (${captured?.summoned?.name ?? "rien"})`);
      const placed = captured?.tokens ?? [];
      summoned.push(...placed.map(t => t.id));
      for ( const t of placed ) if ( t.actorId ) actorsMade.add(t.actorId);
      ctx.expect(placed.length > 0, `${source} : la créature est posée (${placed.map(t => t.name).join(", ") || "aucune"})`);
      // L'apparition (darsh-animations, BLFX « After Summon ») : des effets Sequencer en cours peu après la pose.
      let files = [];
      for ( let i = 0; animated && !(fx && !summonFx) && (i < 10); i++ ) {
        await pause(400);
        files = (await ctx.engine("sequencer", {})).effects.map(e => e.file);
        if ( files.length && (!fx || files.some(f => f.includes(fx))) ) break;
      }
      if ( fx && !summonFx ) ctx.log(`${source} : darsh-animations sans les animations d'invocation (§22) : apparition non vérifiée`);
      else if ( animated ) ctx.expect(files.length > 0 && (!fx || files.some(f => f.includes(fx))),
        `${source} : une animation d'apparition joue (${files.map(f => f.split("/").pop()).slice(0, 3).join(", ") || "aucune"})`);
      await pause(2500);
    }

    // §385 : Création de morts-vivants — sans corps à viser, la fenêtre demande combien de goules (1 à 3 au niveau 6) ; 1 choisie.
    // Sans emplacement de niveau 6, le MJ passe ensuite par « Plus de charge » (le sort part à son propre niveau, §384).
    const undead = await ctx.ensureItem(mage, SPELLS + "phbsplCreateUnde");
    await ctx.engine("castFromBar", { tokenId: mage.id, itemId: undead, sheet: true, x: pos.x + (4 * grid), y: pos.y + grid });
    let form = null;
    for ( let i = 0; !form && (i < 8); i++ ) {
      const found = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 });
      form = (found.windows ?? []).find(d => (d.fields ?? []).some(f => f.name === "count"));
      if ( !form ) await pause(500);
    }
    const countField = form?.fields?.find(f => f.name === "count");
    if ( ctx.expect(!!form, "Création de morts-vivants : la fenêtre demande le nombre, sans cible à désigner") ) {
      ctx.expect((countField.options ?? []).map(o => o.value).join(",") === "1,2,3", `de 1 à 3 goules au niveau 6 (${(countField.options ?? []).map(o => o.value).join(",")})`);
      await ctx.call("answer-dialog", { id: form.id, fields: { count: "1" }, button: "summon" });
      if ( !slots6 ) {
        const asked = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 6000 });
        const forced = (asked.windows ?? []).find(d => (d.buttons ?? []).some(b => b.action === "yes"));
        if ( forced ) await ctx.call("answer-dialog", { id: forced.id, button: "yes" });
      }
      let captured = null;
      for ( let i = 0; i < 20; i++ ) {
        await pause(500);
        captured = await ctx.engine("summonCaptured", {});
        if ( captured?.tokens ) break;
      }
      const placed = captured?.tokens ?? [];
      summoned.push(...placed.map(t => t.id));
      for ( const t of placed ) if ( t.actorId ) actorsMade.add(t.actorId);
      ctx.expect(captured?.summoned?.count === 1, `dnd5e pose le nombre choisi : ${captured?.summoned?.count ?? "rien"} (niveau ${captured?.summoned?.level ?? "?"})`);
      ctx.expect(placed.length === 1, `une seule goule posée (${placed.length})`);
      ctx.expect(captured?.summoned?.level === 6, `au niveau du sort, 6 (${captured?.summoned?.level})`);
      // §386 : la goule du Monster Manual 2024 (sinon du SRD 2024), pas celle du SRD 2014 que désignent les données du sort.
      const mm = (await ctx.call("list-compendiums", {})).some(p => p.id === "dnd-monster-manual.actors");
      const wanted = mm ? "Compendium.dnd-monster-manual.actors." : "Compendium.dnd5e.actors24.";
      ctx.expect(String(captured?.summoned?.uuid ?? "").startsWith(wanted), `goule du ${mm ? "Monster Manual 2024" : "SRD 2024"} (${captured?.summoned?.uuid})`);
    }
  }
};
