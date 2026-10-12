/**
 * Relevé des sorts du Manuel des joueurs (2024) : pour chaque sort, ce que portent ses données (activités, effets, durée,
 * concentration, zone), les listes de classe qui le donnent, et ce que le moteur déclare pour son identifiant (`CONTENT`).
 * Lit une COPIE des bases LevelDB du module premium (Foundry les verrouille), n'écrit rien dans le dépôt : le JSON (qui contient
 * le texte des sorts, contenu premium) va où on le demande, hors du dépôt.
 *   node tools/releve-sorts.mjs "F:/Foundry V14/Data/modules/dnd-players-handbook/packs" <sortie.json>
 */
import { cpSync, mkdirSync, rmSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT } from "../module/scripts/content/index.mjs";

const [src, out] = process.argv.slice(2);
if ( !src || !out ) { console.error("usage : node tools/releve-sorts.mjs <dossier packs du module> <sortie.json>"); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), "releve-sorts-"));

async function read(pack, fn) {
  const copy = join(tmp, pack);
  mkdirSync(copy, { recursive: true });
  for ( const f of readdirSync(join(src, pack)) ) if ( f !== "LOCK" ) cpSync(join(src, pack, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  for await ( const [key, value] of db.iterator() ) fn(key, value);
  await db.close();
}

const text = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

// Listes de classe et de sous-classe : pages « spells » du journal du Manuel (uuid de chaque sort).
const lists = new Map();
await read("content", (key, page) => {
  if ( !key.startsWith("!journal.pages!") || (page.type !== "spells") || !["class", "subclass"].includes(page.system?.type) ) return;
  for ( const uuid of page.system?.spells ?? [] ) {
    const id = String(uuid).split(".").pop();
    if ( !lists.has(id) ) lists.set(id, new Set());
    lists.get(id).add(page.system.identifier);
  }
});

const spells = [];
const effectsOf = new Map();
await read("spells", (key, value) => {
  if ( key.startsWith("!items.effects!") ) {
    const itemId = key.split("!")[2].split(".")[0];
    if ( !effectsOf.has(itemId) ) effectsOf.set(itemId, []);
    effectsOf.get(itemId).push(value);
    return;
  }
  if ( key.startsWith("!items!") ) spells.push(value);
});

const rows = spells.map(item => {
  const s = item.system ?? {};
  const effects = (effectsOf.get(item._id) ?? []).map(e => ({
    id: e._id, name: e.name, statuses: e.statuses ?? [], type: e.type,
    changes: (e.changes ?? e.system?.changes ?? []).map(c => `${c.key} ${c.mode} ${c.value}`)
  }));
  const activities = Object.values(s.activities ?? {}).map(a => ({
    type: a.type, name: a.name || "", activation: a.activation?.override ? a.activation?.type : undefined,
    damage: (a.damage?.parts ?? []).map(p => `${p.number ?? ""}d${p.denomination ?? ""}${p.bonus ? `+${p.bonus}` : ""} ${(p.types ?? []).join("/")}`.trim()),
    healing: a.healing ? `${a.healing.number ?? ""}d${a.healing.denomination ?? ""}${a.healing.bonus ? `+${a.healing.bonus}` : ""} ${(a.healing.types ?? []).join("/")}`.trim() : undefined,
    save: a.save?.ability?.length ? `${[a.save.ability].flat().join("/")} ${a.damage?.onSave ?? ""}`.trim() : undefined,
    attack: a.type === "attack" ? `${a.attack?.type?.value ?? ""} ${a.attack?.type?.classification ?? ""}`.trim() : undefined,
    template: a.target?.override ? (a.target?.template?.type || undefined) : undefined,
    effects: (a.effects ?? []).map(e => e._id),
    summon: a.type === "summon" ? (a.profiles ?? []).length : undefined
  }));
  const ident = s.identifier ?? "";
  return {
    id: item._id, name: item.name, identifier: ident, level: s.level, school: s.school,
    lists: [...(lists.get(item._id) ?? [])].sort(),
    activation: s.activation?.type, castTime: s.activation?.value ?? null,
    range: `${s.range?.value ?? ""} ${s.range?.units ?? ""}`.trim(),
    target: `${s.target?.affects?.count ?? ""} ${s.target?.affects?.type ?? ""}`.trim(),
    template: s.target?.template?.type ? `${s.target.template.type} ${s.target.template.size ?? ""}` : "",
    duration: `${s.duration?.value ?? ""} ${s.duration?.units ?? ""}`.trim(),
    concentration: (s.properties ?? []).includes("concentration"), ritual: (s.properties ?? []).includes("ritual"),
    activities, effects,
    engine: CONTENT[ident] ? Object.keys(CONTENT[ident]).filter(k => k !== "source") : [],
    text: text(s.description?.value)
  };
}).sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));

rmSync(tmp, { recursive: true, force: true });
writeFileSync(out, JSON.stringify(rows, null, 1));
const withEngine = rows.filter(r => r.engine.length).length;
console.log(`${rows.length} sorts → ${out} ; ${withEngine} avec une entrée du moteur`);
for ( let l = 0; l <= 9; l++ ) console.log(`  niveau ${l} : ${rows.filter(r => r.level === l).length}`);
