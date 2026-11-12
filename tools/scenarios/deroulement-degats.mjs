/**
 * §419 : le réglage « Dégâts et soins » (`damageFlow`, cadre « Déroulement ») — qui lance les dés et qui décide de les appliquer, sur un
 * Trait de feu de l'Ensorceleur contre le Zombi (Arène de test), tiré jusqu'à toucher :
 *  1. `click` : après le coup, la fenêtre « Lancer les dégâts » de l'auteur ; aucun jet tant qu'elle est ouverte ; cliquée, les dégâts
 *     sont lancés et appliqués.
 *  2. `validate` : les dégâts sont lancés d'office, la fenêtre du MJ « Appliquer ? » s'ouvre, les PV n'ont pas bougé ; refusé, rien n'est
 *     appliqué et la résolution se clôt ; rejoué et accepté, les PV tombent.
 *  3. `clickValidate` : les deux fenêtres, dans l'ordre.
 *  4. `auto` : aucune fenêtre (le comportement de toujours).
 * Le scénario joue en MJ : l'auteur du tir et le MJ qui valide sont le même client. Le réglage est remis à sa valeur d'avant.
 */
const MODULE_ID = "dnd5e-combat";
const TERMINAL = new Set(["done", "missed", "undone"]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "déroulement : dégâts — au clic de l'auteur, validés par le MJ, les deux, d'office",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const before = (await ctx.engine("setting", { key: "damageFlow" }))?.now ?? "level";
    const mode = value => ctx.engine("setting", { key: "damageFlow", value });
    ctx.restore(() => mode(before));

    /** La fenêtre de l'auteur (bouton `roll`) ou celle du MJ (boutons `apply` / `refuse`), s'il y en a une. */
    const flowWindow = async () => {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 400 }).catch(() => null);
      for ( const w of (r?.windows ?? []) ) {
        const actions = (w.buttons ?? []).map(b => b.action);
        if ( actions.includes("roll") ) return { id: w.id, kind: "roll" };
        if ( actions.includes("apply") && actions.includes("refuse") ) return { id: w.id, kind: "validate", text: [w.content, w.text].filter(Boolean).join(" ") };
      }
      return null;
    };
    ctx.restore(async () => { for ( let w; (w = await flowWindow()); ) await ctx.call("answer-dialog", { id: w.id, button: (w.kind === "roll") ? "roll" : "refuse" }).catch(() => {}); });

    /**
     * Tire jusqu'à toucher (huit essais). `answers` : la réponse à la fenêtre du MJ (« apply » ou « refuse »). Rend ce qui s'est passé :
     * les fenêtres vues dans l'ordre, les jets de dégâts présents à l'ouverture de chacune, les PV à ce moment, la résolution finale.
     */
    const shoot = async ({ validate="apply" }={}) => {
      for ( let i = 0; i < 8; i++ ) {
        await ctx.setHp(zombi, hp0);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
        const seen = [];
        let r = null;
        for ( const stop = Date.now() + 40000; Date.now() < stop; ) {
          r = await ctx.resolution(used.usageMessageId);
          if ( r && TERMINAL.has(r.step) ) break;
          const w = await flowWindow();
          if ( w ) {
            await pause(1200);   // le temps qu'un jet enchaîné à tort arrive
            const damageRolls = (await ctx.messagesSince(since)).filter(m => m.type === "damage").length;
            seen.push({ kind: w.kind, damageRolls, hp: await ctx.hp(zombi), text: w.text ?? "" });
            await ctx.call("answer-dialog", { id: w.id, button: (w.kind === "roll") ? "roll" : validate });
          }
          await pause(300);
        }
        if ( !r?.targets?.[0]?.hit ) continue;
        await pause(1500);
        const messages = await ctx.messagesSince(since);
        return { r, seen, hpAfter: await ctx.hp(zombi), damageRolls: messages.filter(m => m.type === "damage").length };
      }
      return null;
    };
    const kinds = shot => shot.seen.map(s => s.kind).join(" puis ") || "aucune";

    // 1. Au clic de l'auteur.
    await mode("click");
    let shot = await shoot();
    if ( ctx.expect(!!shot, "click : le Trait de feu touche (huit essais au plus)") ) {
      ctx.expect(kinds(shot) === "roll", `click : la fenêtre « Lancer les dégâts » de l'auteur, et elle seule (${kinds(shot)})`);
      ctx.expect(shot.seen[0]?.damageRolls === 0, `click : aucun jet de dégâts tant qu'elle est ouverte (${shot.seen[0]?.damageRolls})`);
      ctx.expect((shot.r.step === "done") && (shot.damageRolls === 1) && (shot.hpAfter < hp0), `click : cliquée, un jet, dégâts appliqués (${hp0} → ${shot.hpAfter})`);
    }

    // 2. Validés par le MJ : refusés, puis acceptés.
    await mode("validate");
    shot = await shoot({ validate: "refuse" });
    if ( ctx.expect(!!shot, "validate : le Trait de feu touche") ) {
      ctx.expect(kinds(shot) === "validate", `validate : la fenêtre « Appliquer ? » du MJ, et elle seule (${kinds(shot)})`);
      ctx.expect((shot.seen[0]?.damageRolls === 1) && (shot.seen[0]?.hp === hp0), `validate : dégâts déjà lancés, PV intacts à l'ouverture (${shot.seen[0]?.damageRolls} jet, ${shot.seen[0]?.hp} PV)`);
      ctx.expect(/Zombi/.test(shot.seen[0]?.text ?? ""), `validate : la fenêtre nomme la cible (${(shot.seen[0]?.text ?? "").slice(0, 120)})`);
      ctx.expect((shot.r.step === "done") && (shot.hpAfter === hp0) && !shot.r.targets[0].damage, `validate : refusé, rien n'est appliqué, la résolution est close (${shot.r.step}, ${shot.hpAfter} PV)`);
    }
    shot = await shoot({ validate: "apply" });
    if ( ctx.expect(!!shot, "validate : le Trait de feu touche une seconde fois") ) {
      ctx.expect((shot.r.step === "done") && (shot.hpAfter < hp0), `validate : accepté, dégâts appliqués (${hp0} → ${shot.hpAfter})`);
    }

    // 3. Les deux.
    await mode("clickValidate");
    shot = await shoot({ validate: "apply" });
    if ( ctx.expect(!!shot, "clickValidate : le Trait de feu touche") ) {
      ctx.expect(kinds(shot) === "roll puis validate", `clickValidate : la fenêtre de l'auteur, puis celle du MJ (${kinds(shot)})`);
      ctx.expect(shot.hpAfter < hp0, `clickValidate : dégâts appliqués (${hp0} → ${shot.hpAfter})`);
    }

    // 4. D'office.
    await mode("auto");
    shot = await shoot();
    if ( ctx.expect(!!shot, "auto : le Trait de feu touche") ) {
      ctx.expect(!shot.seen.length && (shot.hpAfter < hp0), `auto : aucune fenêtre, dégâts appliqués (${kinds(shot)}, ${hp0} → ${shot.hpAfter})`);
    }
  }
};
