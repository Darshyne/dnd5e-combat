#!/usr/bin/env node
/**
 * Historique par item (2026-10-22) : pour chaque sort, don, aptitude et objet du Manuel des joueurs, tout ce que le dépôt sait de lui —
 * l'entrée du moteur, les sections du `SPEC.md` qui le citent, les commits qui ont touché son entrée de contenu ou ses scénarios, les
 * scénarios qui le jouent, son statut aux relevés (`RELEVE_SORTS.md`, `RELEVE_DONS.md`) et son dernier résultat de balayage
 * (`prive/balayages/`). Le `SPEC.md` est rangé par étape et nomme les items en français, sans identifiant : cet index le reprend
 * par item. Régénéré à la demande ; n'écrit que dans `prive/` (noms et renvois, aucun texte du livre).
 *   node tools/historique-items.mjs [dossier packs du Manuel] [dossier fr du PHB-fr]
 * Défauts : `F:/Foundry V14/Data/modules/dnd-players-handbook/packs`, `../Foundry dnd5 module trad player manuel du joueur/module/compendium/fr`.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT } from "../module/scripts/content/index.mjs";

const [packs="F:/Foundry V14/Data/modules/dnd-players-handbook/packs", fr="../Foundry dnd5 module trad player manuel du joueur/module/compendium/fr"] = process.argv.slice(2);
const PACKS = { spells: "Sorts", feats: "Dons", classes: "Aptitudes de classe", origins: "Origines", equipment: "Objets" };
const tmp = mkdtempSync(join(tmpdir(), "historique-"));

/* ---- les items et leurs noms ---- */
const items = [];
for ( const pack of Object.keys(PACKS) ) {
  const copy = join(tmp, pack);
  mkdirSync(copy, { recursive: true });
  for ( const f of readdirSync(join(packs, pack)) ) if ( f !== "LOCK" ) cpSync(join(packs, pack, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  const names = existsSync(join(fr, `dnd-players-handbook.${pack}.json`)) ? JSON.parse(readFileSync(join(fr, `dnd-players-handbook.${pack}.json`), "utf8")).entries : {};
  for await ( const [key, v] of db.iterator() ) {
    if ( !key.startsWith("!items!") || !v.system?.identifier ) continue;
    if ( (pack === "classes") && (v.type !== "feat") ) continue;
    items.push({ pack, id: v._id, en: v.name, fr: names[v.name]?.name ?? null, identifier: v.system.identifier, level: v.system.level,
      requirements: v.system.requirements ?? "" });
  }
  await db.close();
}

/* ---- le SPEC en sections ---- */
const spec = readFileSync("prive/SPEC.md", "utf8").split("\n");
const sections = [];
let current = null;
for ( const line of spec ) {
  const m = line.match(/^#{2,3} (\d+(?:\.\d+)*)\.? (.*)/);
  if ( m ) { current = { num: m[1], title: m[2].slice(0, 90), text: "" }; sections.push(current); continue; }
  if ( current ) current.text += `${line}\n`;
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Les sections qui citent l'item : son identifiant entre accents graves, ou son nom (français ou anglais) avec sa majuscule. */
function sectionsOf(item) {
  const patterns = [new RegExp(`\`${escape(item.identifier)}\``)];
  for ( const name of [item.fr, item.en] ) {
    // Un nom d'un seul mot court est aussi un mot de la langue (« Lumière », « Rage ») : il ne compte qu'entre guillemets.
    if ( !name ) continue;
    const single = !/\s/.test(name) && (name.length < 9);
    patterns.push(single ? new RegExp(`[«"“] ?${escape(name)} ?[»"”]`) : new RegExp(`(^|[^\\p{L}])${escape(name)}($|[^\\p{L}])`, "u"));
  }
  return sections.filter(s => patterns.some(p => p.test(s.title) || p.test(s.text))).map(s => s.num);
}

/* ---- les commits qui ont touché une entrée de contenu ou un scénario ---- */
const log = execFileSync("git", ["log", "-p", "--no-color", "--format=@@@%h %ad %s", "--date=short", "--", "module/scripts/content", "tools/scenarios"],
  { encoding: "utf8", maxBuffer: 1 << 30 });
const commitsOf = new Map();
let commit = null;
for ( const line of log.split("\n") ) {
  if ( line.startsWith("@@@") ) { commit = line.slice(3); continue; }
  if ( !commit || !/^[+-][^+-]/.test(line) ) continue;
  for ( const m of line.matchAll(/["'`]([a-z0-9]+(?:-[a-z0-9]+)+)["'`]/g) ) {
    if ( !commitsOf.has(m[1]) ) commitsOf.set(m[1], new Set());
    commitsOf.get(m[1]).add(commit);
  }
}

/* ---- scénarios, relevés, balayages ---- */
const scenarioFiles = readdirSync("tools/scenarios", { recursive: true }).filter(f => f.endsWith(".mjs"));
const scenarioText = scenarioFiles.map(f => [f.replace(/\.mjs$/, "").replace(/\\/g, "/"), readFileSync(join("tools/scenarios", f), "utf8")]);
const status = new Map();
for ( const m of readFileSync("prive/RELEVE_SORTS.md", "utf8").matchAll(/^\| [^|]+ \| `([^`]+)` \| ([^|]+) \|/gm) ) status.set(m[1], m[2].trim());
const feats = readFileSync("prive/RELEVE_DONS.md", "utf8");
const sweeps = new Map();
if ( existsSync("prive/balayages") ) {
  for ( const f of readdirSync("prive/balayages").filter(f => f.endsWith(".json")).sort() ) {
    for ( const row of JSON.parse(readFileSync(join("prive/balayages", f), "utf8")) ) {
      const issues = row.runs.flatMap(r => r.issues);
      sweeps.set(row.identifier, { file: f.replace(/\.json$/, ""), verdict: issues.length ? `✗ ${issues.join(" ; ").slice(0, 160)}` : (row.runs.length ? "✓" : "non joué") });
    }
  }
}

/* ---- l'index ---- */
const out = ["# Historique par item", "",
  `Généré le ${new Date().toISOString().slice(0, 10)} par \`tools/historique-items.mjs\` — ne pas modifier à la main. Pour chaque item du Manuel des`,
  "joueurs : son entrée au moteur (clés de `CONTENT`), son statut au relevé de lecture, les sections du `SPEC.md` qui le citent (par son",
  "identifiant, ou son nom français ou anglais), les commits qui ont touché son entrée de contenu ou un scénario qui le cite, les",
  "scénarios qui le jouent, et son dernier balayage dans l'Arène des sorts. Les sections trouvées par le nom peuvent inclure une simple",
  "mention ; un item sans rien de tout cela n'est pas listé.", ""];
let listed = 0;
for ( const [pack, title] of Object.entries(PACKS) ) {
  const rows = [];
  const list = items.filter(i => i.pack === pack).sort((a, b) => ((a.level ?? 0) - (b.level ?? 0)) || (a.fr ?? a.en).localeCompare(b.fr ?? b.en));
  for ( const item of list ) {
    const engine = Object.keys(CONTENT[item.identifier] ?? {}).filter(k => k !== "source");
    const secs = sectionsOf(item);
    const commits = [...(commitsOf.get(item.identifier) ?? [])];
    const scen = scenarioText.filter(([, text]) => text.includes(`"${item.identifier}"`) || text.includes(item.id)).map(([name]) => name);
    const st = status.get(item.identifier) ?? (feats.includes(item.fr ?? "\u0000") ? "RELEVE_DONS" : "");
    const sweep = sweeps.get(item.identifier);
    if ( !engine.length && !secs.length && !commits.length && !scen.length && !sweep ) continue;
    listed++;
    const label = `**${item.fr ?? item.en}**${item.fr ? ` (${item.en})` : ""} \`${item.identifier}\`${pack === "spells" ? ` · niv. ${item.level}` : item.requirements ? ` · ${item.requirements}` : ""}`;
    const lines = [`- ${label}`];
    if ( engine.length || st ) lines.push(`  - moteur : ${engine.join(", ") || "rien"}${st ? ` · relevé : ${st}` : ""}`);
    if ( secs.length ) lines.push(`  - SPEC : ${secs.map(n => `§${n}`).join(", ")}`);
    if ( commits.length ) lines.push(`  - commits : ${commits.slice(0, 12).join(" · ")}${commits.length > 12 ? ` · (+${commits.length - 12})` : ""}`);
    if ( scen.length ) lines.push(`  - scénarios : ${scen.join(", ")}`);
    if ( sweep ) lines.push(`  - balayage (${sweep.file}) : ${sweep.verdict}`);
    rows.push(lines.join("\n"));
  }
  if ( rows.length ) out.push(`## ${title} (${rows.length})`, "", ...rows, "");
}
writeFileSync("prive/HISTORIQUE_ITEMS.md", out.join("\n"));
console.log(`prive/HISTORIQUE_ITEMS.md : ${listed} items sur ${items.length}`);
