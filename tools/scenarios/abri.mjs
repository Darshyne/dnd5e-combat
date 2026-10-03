/**
 * Abri (P1 b) : une créature interposée donne un abri partiel (+2 CA), calculé par le moteur au
 * verdict, sans rien poser sur le token. Le Guerrier est placé sur une case libre entre l'Ensorceleur et
 * le Zombi, choisie par la règle même du moteur (core/cover.mjs : depuis le meilleur coin de l'attaquant,
 * au moins une ligne coupée par le Guerrier), puis remis à sa place. Deviner « la case du milieu » ne
 * tenait pas : à un saut de cavalier, elle laisse à l'attaquant un coin dégagé. Le Zombi (CA 8) : on lit `cover` et la CA
 * corrigée dans la résolution, contre la CA que dnd5e a écrite sur le jet d'attaque.
 */
import { coverBetween } from "../../module/scripts/core/cover.mjs";

const MODULE_ID = "dnd5e-combat";

/**
 * Une case libre où le Guerrier donnerait un abri partiel au Zombi contre l'Ensorceleur, murs ignorés
 * (le moteur les comptera au verdict), la plus proche de la cible ; null s'il n'y en a pas.
 */
function coveringCell({ sorc, zombi, guerrier, tokens, size }) {
  const rect = t => ({ x: t.x, y: t.y, width: (t.width ?? 1) * size, height: (t.height ?? 1) * size });
  const sameLevel = t => (t.level ?? null) === (sorc.level ?? null);
  const others = tokens.filter(t => ![sorc.id, zombi.id, guerrier.id].includes(t.id) && !t.hidden && sameLevel(t));
  const occupied = tokens.filter(t => (t.id !== guerrier.id) && sameLevel(t)).map(rect);
  const free = c => !occupied.some(r => (c.x < r.x + r.width) && (c.x + size > r.x) && (c.y < r.y + r.height) && (c.y + size > r.y));
  const x0 = Math.min(sorc.x, zombi.x), x1 = Math.max(sorc.x, zombi.x);
  const y0 = Math.min(sorc.y, zombi.y), y1 = Math.max(sorc.y, zombi.y);
  const candidates = [];
  for ( let x = x0; x <= x1; x += size ) for ( let y = y0; y <= y1; y += size ) {
    const cell = { x, y, width: size, height: size };
    if ( !free(cell) ) continue;
    const cover = coverBetween({ attacker: rect(sorc), target: rect(zombi), bodies: [...others.map(rect), cell], inset: size * 0.1 });
    if ( (cover.degree === "half") && cover.byCreature ) candidates.push({ ...cell, d: Math.hypot(x - zombi.x, y - zombi.y) });
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates[0] ?? null;
}

export default {
  name: "abri — créature interposée, abri partiel +2",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const home = { x: guerrier.x, y: guerrier.y };
    // `move-token` (connecteur ≥ 0.27, déplacement `displace`) : un `update-scene-object` de x/y est refusé sans
    // erreur par le cœur dès qu'un mur sépare les deux cases (vu le 2026-09-23 sur Restored Keep).
    const place = async (x, y) => {
      const moved = await ctx.call("move-token", { tokenId: guerrier.id, x, y });
      if ( !moved?.moved ) throw new Error(`Guerrier non déplacé en ${x},${y}`);
    };
    ctx.restore(() => place(home.x, home.y));

    async function shoot(label) {
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
      const rolledAc = attack?.targets?.[0]?.ac ?? null;
      const t = r.targets[0];
      ctx.log(`${label} : CA du jet ${rolledAc}, CA du verdict ${t.ac}, abri ${t.cover?.degree ?? "aucun"}`);
      return { rolledAc, verdictAc: t.ac, cover: t.cover, hit: t.hit, total: r.attack.roll.total, reason: t.reason };
    }

    // Guerrier à sa place : l'abri, s'il y en a un, vient d'ailleurs (d'autres tokens peuvent être sur la ligne —
    // dans dnd-6, Sorvina, Énorme, l'est souvent) ; on vérifie la cohérence, pas l'absence d'abri.
    await place(home.x, home.y);
    const open = await shoot("Guerrier à sa place");
    ctx.expect(open.verdictAc === open.rolledAc + (open.cover?.bonus ?? 0), `CA du verdict = CA du jet + abri (${open.rolledAc} + ${open.cover?.bonus ?? 0})`);

    // Entre l'Ensorceleur et le Zombi, quelle que soit la disposition de la scène.
    const size = await ctx.gridSize();
    const { tokens } = await ctx.scene();
    const cell = coveringCell({ sorc, zombi, guerrier, tokens, size });
    if ( !cell ) { ctx.log("aucune case libre entre l'Ensorceleur et le Zombi d'où le Guerrier couvrirait : non applicable"); return; }
    ctx.log(`Guerrier posé en ${cell.x},${cell.y} (Ensorceleur ${sorc.x},${sorc.y} → Zombi ${zombi.x},${zombi.y})`);
    await place(cell.x, cell.y);
    const covered = await shoot("Guerrier interposé");
    ctx.expect(covered.cover?.degree === "half" && covered.cover?.byCreature === true, "Guerrier interposé : abri partiel par créature");
    ctx.expect(covered.verdictAc === covered.rolledAc + 2, `CA corrigée +2 : ${covered.rolledAc} → ${covered.verdictAc}`);
    const shouldHit = (covered.reason === "critical") || (covered.reason !== "fumble" && covered.total >= covered.verdictAc);
    ctx.expect(covered.hit === shouldHit, `verdict jugé contre la CA corrigée (${covered.total} vs ${covered.verdictAc} → ${covered.hit ? "touché" : "raté"})`);
  }
};
