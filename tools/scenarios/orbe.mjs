/**
/**
 * Orbe chromatique (SPEC §16.27) — **interactif** :
 *  1. le type de dégâts : au premier lancement, la fenêtre « type de dégâts » s'ouvre à l'écran du MJ (auteur ici) — en
 *     choisir un ; le jet de dégâts porte ce type ;
 *  2. le rebond : on relance (même type, fixé d'avance) jusqu'à un coup qui touche avec un double aux d8 ; la visée « l'orbe
 *     bondit » s'ouvre à l'écran du MJ — cliquer la seconde cible (amenée à 10 ft) ; le rebond part vers elle, gratuit, même
 *     type. Cibles : le Zombi (CA basse : assez de coups au but) et le Loup, à défaut Rahadin et Morgantha.
 * Monde `ravenloft` ; hors de la suite (`node tools/scenario.mjs orbe`).
 */
const MODULE_ID = "dnd5e-combat";
// Une cible de CA basse (assez de coups au but pour voir un double), et une seconde à 10 ft pour le rebond.
const VICTIMS = ["Zombi", "Rahadin, chambellan du château"];
const SECONDS = ["Loup", "Morgantha - Coven"];
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Orbe chromatique — type choisi, rebond (interactif : choisir un type, puis cliquer la seconde cible)",
  interactive: true,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const VICTIM = VICTIMS.find(n => tokens.some(t => t.name === n));
    const SECOND = SECONDS.find(n => tokens.some(t => t.name === n));
    if ( !tokens.some(t => t.name === "Bramo") || !VICTIM || !SECOND ) { ctx.log("Bramo, une cible ou une seconde cible absente : non applicable"); return; }
    const bramo = await ctx.token("Bramo");
    const victim = await ctx.token(VICTIM);
    const second = await ctx.token(SECOND);
    const grid = await ctx.gridSize();
    const at = await ctx.position(bramo);
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + (3 * grid), y: at.y });
    await ctx.call("move-token", { tokenId: second.id, x: at.x + (5 * grid), y: at.y });

    const damageTypeOf = async resolution => {
      const damage = (await ctx.call("list-chat-messages", { limit: 40 })).messages?.find(m => m.id === resolution.damageRoll?.messageId);
      const raw = damage?.rolls?.[0];
      const roll = (typeof raw === "string") ? JSON.parse(raw) : raw;
      return roll?.options?.type ?? roll?.type ?? null;
    };

    // 1. Type choisi à la fenêtre : on relance jusqu'à toucher (le type ne se voit que sur un jet de dégâts).
    ctx.log(">>> Fenêtre « Orbe chromatique — type de dégâts » à l'écran : choisis un type.");
    let first = null;
    for ( let n = 1; (n <= 5) && !first; n++ ) {
      await ctx.setHp(victim, 150);
      const used = await ctx.use({ tokenId: bramo.id, identifier: "chromatic-orb", activityType: "attack", consume: false, targetTokenIds: [victim.id],
        ...(n > 1 ? { usageConfig: { [MODULE_ID]: { damageType: "fire" } } } : {}) });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 60000 });
      if ( r.targets[0]?.hit ) first = r;
    }
    ctx.expect(!!first, `l'orbe touche ${VICTIM}`);
    if ( !first ) return;
    const type = await damageTypeOf(first);
    const chosen = (await ctx.call("list-chat-messages", { limit: 60, flagScope: MODULE_ID })).messages?.find(m => m.id === (first.origin ?? first.carrier));
    const flagged = chosen?.flags?.[MODULE_ID]?.damageType ?? chosen?.flags?.damageType ?? null;
    ctx.expect(!!type && (type === flagged), `dégâts de type « ${type} », le type choisi (${flagged})`);

    // 2. Rebond : un double aux d8, puis le clic du MJ sur Morgantha.
    let leapUsage = null;
    for ( let n = 1; (n <= 25) && !leapUsage; n++ ) {
      await ctx.setHp(victim, 150);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: bramo.id, identifier: "chromatic-orb", activityType: "attack", consume: false, targetTokenIds: [victim.id],
        usageConfig: { [MODULE_ID]: { damageType: flagged ?? "fire" } } });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 60000 });
      if ( !r.targets[0]?.hit ) continue;
      const faces = await (async () => {
        const damage = (await ctx.call("list-chat-messages", { limit: 40 })).messages?.find(m => m.id === r.damageRoll?.messageId);
        return (damage?.rolls?.[0]?.dice?.[0]?.results ?? damage?.rolls?.[0]?.terms?.[0]?.results ?? []).map(x => x.result ?? x);
      })();
      const double = faces.length && (new Set(faces).size < faces.length);
      ctx.log(`lancement ${n} : touché, d8 ${faces.join(", ") || "?"}${double ? ` — DOUBLE : clique ${SECOND} !` : ""}`);
      if ( !double ) continue;
      for ( const until = Date.now() + 60000; !leapUsage && (Date.now() < until); await sleep(1000) ) {
        leapUsage = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.leap ?? m.flags?.leap));
      }
    }
    // Le journal du moteur autour des rebonds (proposé, refusé), avant que le lanceur ne le vide.
    for ( const line of (await ctx.engineLog()).filter(l => /rebond|double|type de dégâts/i.test(l)).slice(-10) ) ctx.log(`· ${line.slice(0, 200)}`);
    ctx.expect(!!leapUsage, "l'orbe a bondi");
    if ( !leapUsage ) return;
    const flags = leapUsage.flags?.[MODULE_ID] ?? leapUsage.flags ?? {};
    ctx.expect((leapUsage.targets ?? []).some(t => (t.name ?? t) === SECOND), `rebond vers ${SECOND}`);
    ctx.expect(flags.cost === "free", `rebond gratuit (${flags.cost})`);
    const r2 = await ctx.settle(leapUsage.id, { timeoutMs: 60000 }).catch(() => null);
    if ( r2?.targets?.[0]?.hit ) ctx.expect((await damageTypeOf(r2)) === flagged, `le rebond garde le type (${flagged})`);
  }
};
