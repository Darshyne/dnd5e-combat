/**
 * Relevé des activités à choix des données premium (issue #38, SPEC §389) : invocations, transformations, enchantements — partout
 * où dnd5e ne laisse choisir que dans SA fenêtre d'utilisation, et que la barre d'actions, « Lancer quand même » ou une relance du
 * moteur sautent. Pour chacune, ce que portent ses données et les cas à risque :
 *   formes        plusieurs profils, tailles ou types de créature (le choix se perd sans fenêtre ; §383 le couvre pour « summon »)
 *   par-niveau    des profils réservés à certains niveaux (`level.min/max`)
 *   nombre        un nombre de créatures qui dépend du niveau (`count` en formule), ou caché dans la cible du sort seulement
 *                 (Animation des morts : `target.affects.count`), sans `summon.chooseCount` du moteur
 *   srd-2014      une créature du SRD 2014 de dnd5e (`dnd5e.monsters`) ; « → MM » / « → SRD 2024 » si l'équivalent existe (§386)
 *   introuvable   un profil dont la créature n'est dans aucun compendium relevé
 *   ne-pose-rien  `summon.prompt` faux et pas dans `PLACES_SUMMONS` (rien n'apparaît, sauf un voisin qui reprend l'invocation)
 *   vise          l'activité vise un objet ou une créature : le moteur ouvre sa visée (cadavres, os…), sauf `untargeted`
 * Et ce que le moteur déclare pour l'identifiant (`CONTENT[identifier].summon`, `placesSummons`).
 *
 * Lit une COPIE des bases LevelDB (Foundry les verrouille), n'écrit rien dans le dépôt public : le détail (noms premium) va dans le
 * JSON demandé, hors du dépôt, et un résumé Markdown dans `prive/RELEVE_INVOCATIONS.md` si `--md` est donné.
 *   node tools/releve-invocations.mjs "F:/Foundry V14/Data" <sortie.json> [--md prive/RELEVE_INVOCATIONS.md]
 */
import { cpSync, mkdirSync, readdirSync, mkdtempSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { mmActorId, srdMonsterId } from "../module/scripts/core/summon.mjs";

const args = process.argv.slice(2);
const mdAt = args.indexOf("--md");
const md = (mdAt >= 0) ? args.splice(mdAt, 2)[1] : null;
const [data, out] = args;
if ( !data || !out ) {
  console.error("usage : node tools/releve-invocations.mjs <dossier Data de Foundry> <sortie.json> [--md <fichier.md>]");
  process.exit(1);
}

/** Les paquets relevés : modules premium (s'ils sont installés) et le système. */
const PACKAGES = [
  { id: "dnd-players-handbook", kind: "modules" }, { id: "dnd-monster-manual", kind: "modules" },
  { id: "dnd-dungeon-masters-guide", kind: "modules" }, { id: "dnd-ravenloft-horrors-within", kind: "modules" },
  { id: "dnd-heroes-borderlands", kind: "modules" }, { id: "dnd5e", kind: "systems" }
];
const MM = "dnd-monster-manual.actors";
const SRD24 = "dnd5e.actors24";

const tmp = mkdtempSync(join(tmpdir(), "releve-invocations-"));

async function read(dir, fn) {
  const copy = join(tmp, dir.replace(/[^A-Za-z0-9]+/g, "_"));
  mkdirSync(copy, { recursive: true });
  for ( const f of readdirSync(dir) ) if ( f !== "LOCK" ) cpSync(join(dir, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  try { for await ( const [key, value] of db.iterator() ) fn(key, value); }
  finally { await db.close(); }
}

/** Les acteurs connus (uuid → nom) et les items à activités, de tous les compendiums. */
const actors = new Map();
const items = [];
for ( const { id: pkg, kind } of PACKAGES ) {
  const root = join(data, kind, pkg, "packs");
  if ( !existsSync(root) ) { console.warn(`absent : ${pkg}`); continue; }
  for ( const pack of readdirSync(root) ) {
    // Les compendiums 2014 de dnd5e (SRD 5.1) ne servent plus : seuls ceux de 2024 (`*24`) — mais leurs acteurs restent connus, pour
    // dire qu'un profil y pointe (`srd-2014`).
    const legacy = (pkg === "dnd5e") && !pack.endsWith("24");
    const dir = join(root, pack);
    if ( !statSync(dir).isDirectory() || !existsSync(join(dir, "CURRENT")) ) continue;
    const actorNames = new Map();
    await read(dir, (key, value) => {
      if ( key.startsWith("!actors!") ) {
        actors.set(`Compendium.${pkg}.${pack}.Actor.${value._id}`, value.name);
        actorNames.set(value._id, value.name);
      } else if ( legacy ) {
        return;
      } else if ( key.startsWith("!items!") ) {
        items.push({ pack: `${pkg}.${pack}`, owner: null, item: value });
      } else if ( key.startsWith("!actors.items!") ) {
        items.push({ pack: `${pkg}.${pack}`, owner: key.split("!")[2].split(".")[0], item: value });
      }
    });
    for ( const row of items ) if ( (row.pack === `${pkg}.${pack}`) && row.owner && actorNames.has(row.owner) ) row.ownerName = actorNames.get(row.owner);
  }
}

/** L'uuid tel que Foundry le résout (forme courte `Compendium.p.k.id` comprise). */
function knownActor(uuid) {
  if ( actors.has(uuid) ) return actors.get(uuid);
  const m = /^Compendium\.([^.]+)\.([^.]+)\.(?:Actor\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""));
  return m ? (actors.get(`Compendium.${m[1]}.${m[2]}.Actor.${m[3]}`) ?? null) : null;
}

/** §386 : l'équivalent 2024 d'une créature du SRD 2014, comme le moteur le cherche. */
function preferred(uuid) {
  if ( !srdMonsterId(uuid) ) return null;
  const id = mmActorId(knownActor(uuid));
  if ( !id ) return null;
  for ( const pack of [MM, SRD24] ) {
    const [pkg, name] = pack.split(".");
    if ( actors.has(`Compendium.${pkg}.${name}.Actor.${id}`) ) return pack === MM ? "MM 2024" : "SRD 2024";
  }
  return null;
}

const PLACES = new Set(Object.entries(CONTENT).filter(([, e]) => e?.placesSummons).map(([id]) => id));
const variable = f => /@|d\d/i.test(String(f ?? ""));
// Ce qui ouvre la visée du moteur (un « espace » se pose sans viser : Main du mage, Œil du mage).
const AIMED = new Set(["object", "creature", "creatureOrObject", "ally", "enemy", "willing"]);

const rows = [];
for ( const { pack, ownerName, item } of items ) {
  const s = item.system ?? {};
  const identifier = s.identifier || null;
  const content = identifier ? CONTENT[identifier] : null;
  for ( const a of Object.values(s.activities ?? {}) ) {
    if ( !["summon", "transform", "enchant"].includes(a.type) ) continue;
    const profiles = a.type === "enchant" ? (a.effects ?? []) : (a.profiles ?? []);
    const flags = [];
    const sizes = (a.creatureSizes ?? []).length;
    const types = (a.creatureTypes ?? []).length;
    // Une invocation à plusieurs formes a la fenêtre « Choisir la forme » du moteur (§383) : signalée à part, couverte.
    // Enchantements et transformations : la même fenêtre du moteur (§391) ; la Forme sauvage a la sienne (§16.39).
    if ( (profiles.length > 1) || (sizes > 1) || (types > 1) ) flags.push(a.type === "summon" ? "formes (couvert §383)"
      : (["wild-shape", "circle-forms"].includes(identifier) ? "formes (couvert §16.39)" : `formes (couvert §391) ${a.type}`));
    if ( profiles.some(p => (p.level?.min ?? null) !== null || (p.level?.max ?? null) !== null) ) flags.push("par-niveau");
    const targetCount = (a.target?.override ? a.target?.affects?.count : s.target?.affects?.count) ?? "";
    if ( a.type === "summon" ) {
      const countVaries = profiles.some(p => variable(p.count));
      const hiddenCount = !countVaries && variable(targetCount);
      if ( (countVaries || hiddenCount) && !content?.summon?.chooseCount ) flags.push(hiddenCount ? "nombre (dans la cible)" : "nombre");
      for ( const p of profiles ) {
        if ( a.summon?.mode === "cr" ) continue;
        if ( p.uuid && srdMonsterId(p.uuid) ) {
          const to = preferred(p.uuid);
          // Le moteur prend l'équivalent 2024 quand il existe (§386) : couvert ; sans équivalent, la créature 2014 reste.
          flags.push(to ? `srd-2014 couvert §386 ${knownActor(p.uuid) ?? "?"} → ${to}` : `srd-2014 ${knownActor(p.uuid) ?? "?"} (sans équivalent)`);
        }
        if ( p.uuid && !knownActor(p.uuid) ) flags.push(`introuvable ${p.uuid}`);
      }
      // Lumière, Flamme éternelle : le moteur pose l'objet lui-même (§16.35, contenu `light` « on: summon »).
      if ( (a.summon?.prompt === false) && !PLACES.has(identifier) && (content?.light?.on !== "summon") ) flags.push("ne-pose-rien");
    }
    const affects = (a.target?.override ? a.target?.affects?.type : s.target?.affects?.type) ?? "";
    if ( (a.type === "summon") && AIMED.has(affects) && !content?.summon?.untargeted ) flags.push(`vise (${affects})`);
    rows.push({
      pack, owner: ownerName ?? null, item: item.name, identifier, activity: a._id, type: a.type, name: a.name || "",
      level: s.level ?? null, profiles: profiles.map(p => p.name || knownActor(p.uuid) || p._id), sizes, types,
      count: profiles.map(p => p.count || "1"), targetCount, prompt: a.summon?.prompt ?? null, mode: a.summon?.mode ?? null,
      engine: content ? Object.keys(content).filter(k => ["summon", "placesSummons", "enchantTarget", "pact"].includes(k)) : [],
      flags: [...new Set(flags)]
    });
  }
}

// « À risque » : au moins un drapeau qui n'est pas couvert par le moteur.
const covered = f => f.startsWith("formes (couvert") || f.startsWith("srd-2014 couvert");
const risky = rows.filter(r => r.flags.some(f => !covered(f)));
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
const by = key => rows.filter(r => r.flags.some(f => (key === "srd-2014 (") ? (f.startsWith("srd-2014 ") && f.includes("sans équivalent")) : f.startsWith(key))).length;
console.log(`${rows.length} activités (summon / transform / enchant), ${risky.length} à risque`);
for ( const key of ["formes (couvert", "par-niveau", "nombre", "srd-2014 couvert", "srd-2014 (", "introuvable", "ne-pose-rien", "vise"] ) console.log(`  ${key} : ${by(key)}`);

if ( md ) {
  const line = r => `| ${r.item}${r.owner ? ` (${r.owner})` : ""} | \`${r.identifier ?? "—"}\` | ${r.type} | ${r.profiles.length} | ${r.flags.join(" ; ")} | ${r.engine.join(", ") || "—"} |`;
  const groups = new Map();
  for ( const r of risky ) {
    const k = r.pack;
    if ( !groups.has(k) ) groups.set(k, []);
    groups.get(k).push(r);
  }
  const body = [...groups].map(([pack, list]) => `### ${pack}\n\n| Objet | Identifiant | Activité | Formes | Risques | Moteur |\n|---|---|---|---|---|---|\n${
    list.sort((a, b) => String(a.item).localeCompare(String(b.item))).map(line).join("\n")}`).join("\n\n");
  writeFileSync(md, `# Relevé des activités à choix (invocation, transformation, enchantement)

Généré par \`tools/releve-invocations.mjs\` le ${new Date().toISOString().slice(0, 10)} (SPEC §389). ${rows.length} activités, ${risky.length} à risque.
Risques : voir l'en-tête de l'outil. « Moteur » : ce que le contenu du moteur déclare pour l'identifiant.

${body}
`);
  console.log(`résumé : ${md}`);
}
