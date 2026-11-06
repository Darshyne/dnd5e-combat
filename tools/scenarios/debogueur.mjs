/**
 * §380 (issue #36) : le débogueur intégré, chez le MJ. Une sonde fait échouer exprès un inscrit du routeur, deux fois : une seule erreur,
 * comptée deux fois, avec son libellé, son hook et le module mis en cause ; une promesse rejetée sans être attrapée est relevée à part.
 * Le rapport ne contient le nom d'aucun utilisateur (rôles à la place), même cité dans la description ; le contexte d'un token ne
 * donne pas son nom ; l'adresse GitHub reste sous sa longueur et vise le dépôt du moteur.
 * Les erreurs de la sonde (« DAS debug probe ») ne comptent pas comme des défauts du scénario (tools/scenario.mjs).
 */
const PROBE_LABEL = "debug: probe (deliberate failure)";

export default {
  name: "debogueur — erreurs regroupées, piste, rapport sans noms",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args);
    await api("debugClear");
    ctx.restore(() => api("debugClear").catch(() => {}));

    await api("debugThrow", { message: "route" });
    await api("debugThrow", { message: "route" });
    await api("debugThrow", { message: "promise", via: "rejection" });
    await new Promise(r => setTimeout(r, 300));

    const players = await ctx.call("list-players", {});
    const names = players.map(p => p.name).filter(n => n && (n.length >= 3));
    const { tokens } = await ctx.scene();
    const token = tokens.find(t => t.actorId) ?? null;
    const report = await api("debugReport", { description: `${names.join(", ")} saw this`, token: token?.id ?? null });

    const probe = report.errors.find(e => e.label === PROBE_LABEL);
    ctx.expect(!!probe, `l'échec de la sonde est relevé avec son libellé (${report.errors.map(e => e.label ?? e.message).join(" | ") || "rien"})`);
    if ( probe ) {
      ctx.expect(probe.count === 2, `deux échecs identiques : une erreur comptée ${probe.count} fois (attendu 2)`);
      ctx.expect(probe.hook === "dnd5e-combat.debugProbe", `son hook : ${probe.hook}`);
      ctx.expect(probe.module === "dnd5e-combat", `le module mis en cause : ${probe.module}`);
      ctx.expect(probe.clients.length === 1 && !names.includes(probe.clients[0]), `le client en rôle : ${probe.clients.join(", ")}`);
    }
    const rejection = report.errors.find(e => e.kind === "rejection");
    ctx.expect(!!rejection && /promise/.test(rejection.message), `la promesse rejetée est relevée à part (${rejection?.message ?? "absente"})`);

    // En mot entier, comme le nettoyage (core/debug.mjs) : « darsh » dans l'identifiant d'un module (« darsh-loot ») n'est pas un nom.
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const word = n => new RegExp(`(?<![\\p{L}\\p{N}_./-])${escape(n)}(?![\\p{L}\\p{N}_/-]|\\.\\w)`, "iu");
    const leaked = names.filter(n => word(n).test(report.markdown));
    ctx.expect(!leaked.length, `aucun nom d'utilisateur dans le rapport (${leaked.join(", ") || "aucun"})`);
    if ( token ) {
      ctx.expect(!!report.context?.actorType, `le contexte du token est joint (${report.context?.actorType ?? "absent"})`);
      ctx.expect(!report.markdown.includes(token.name) || (token.name.length < 3),
        `le nom du token (« ${token.name} ») n'apparaît pas`);
    }
    ctx.expect(report.environment.foundry && report.environment.system?.startsWith("dnd5e"), `environnement : Foundry ${report.environment.foundry}, ${report.environment.system}`);
    ctx.expect(report.urlLength > 0 && report.urlLength <= 7000, `adresse GitHub de ${report.urlLength} caractères (≤ 7000)`);
    ctx.expect(report.repos[0] === "Darshyne/dnd5e-combat", `dépôt proposé : ${report.repos[0] ?? "aucun"}`);
    ctx.log(`rapport : ${report.errors.length} erreur(s), piste ${report.trail} geste(s), Markdown ${report.markdown.length} car., JSON ${report.jsonLength} car.`);
  }
};
