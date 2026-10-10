/**
 * §123-§124 : relevé des activités du Manuel des joueurs à portée « personnelle » qui visent pourtant une autre créature (sans
 * zone) — un défaut de données qui, sans règle du moteur, soignait le lanceur ou partait sans cible. Lit une COPIE des bases
 * LevelDB du module premium (Foundry les verrouille), n'écrit rien ; donne pour chaque activité son activation, si le moteur a une
 * règle pour l'objet, et ce que `rangeUnitsOf` (adapter/content.mjs) en fait.
 *   node tools/releve-portee-personnelle.mjs "F:/Foundry V14/Data/modules/dnd-players-handbook/packs"
 */
import { cpSync, mkdirSync, rmSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT } from "../module/scripts/content/index.mjs";

const src = process.argv[2];
if ( !src ) { console.error("usage : node tools/releve-portee-personnelle.mjs <dossier packs du module>"); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), "releve-"));
const TARGETS = new Set(["creature", "creatureOrObject", "ally", "willing", "enemy", "any", "object"]);
const rows = [];
for ( const pack of ["classes", "spells", "feats", "origins", "equipment"] ) {
  const copy = join(tmp, pack);
  mkdirSync(copy, { recursive: true });
  for ( const f of readdirSync(join(src, pack)) ) if ( f !== "LOCK" ) cpSync(join(src, pack, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  for await ( const [key, item] of db.iterator() ) {
    if ( !key.startsWith("!items!") ) continue;
    for ( const [id, a] of Object.entries(item.system?.activities ?? {}) ) {
      if ( (a.range?.units !== "self") || !TARGETS.has(a.target?.affects?.type) || a.target?.template?.type ) continue;
      const ident = item.system?.identifier ?? "";
      const entry = CONTENT[ident];
      const one = ["", "1"].includes(String(a.target?.affects?.count ?? "").trim());
      const fixed = entry?.ranges?.[id];
      const aimed = fixed ? (fixed.units === "self" ? "sur soi (contenu)" : `portée ${fixed.value} ${fixed.units}`)
        : !one ? "plusieurs cibles : tel quel"
        : (a.type === "heal") ? "visée (soin)"
        : (a.type === "attack") ? "visée (attaque)"
        : (["action", "bonus"].includes(a.activation?.type) && !entry) ? "visée (§124)"
        : entry ? "circuit du moteur" : "tel quel (réaction, supplément)";
      rows.push([a.activation?.type || "-", item.name, ident, id, a.type, a.name || "", aimed]);
    }
  }
  await db.close();
}
rmSync(tmp, { recursive: true, force: true });
rows.sort((a, b) => a[6].localeCompare(b[6]) || a[1].localeCompare(b[1]));
for ( const r of rows ) console.log(r.join(" | "));
console.log(`\n${rows.length} activités`);
