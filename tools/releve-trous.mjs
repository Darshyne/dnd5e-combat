/**
 * Relevé des trous (2026-10-22) : ce que le relevé de lecture des sorts et des dons (`prive/RELEVE_SORTS.md`, `RELEVE_DONS.md`) a pu
 * laisser passer, cherché mécaniquement dans les données — pas dans le texte relu à la main. Pour chaque sort, don, aptitude de classe
 * et trait d'espèce du Manuel des joueurs premium (et les sorts du SRD 2024 de dnd5e), croisé avec ce que le moteur déclare (`CONTENT`) :
 *  - `ref-morte`   : un id (activité ou effet) cité par l'entrée du moteur n'existe pas sur l'item — la règle ne s'accroche à rien ;
 *  - `effet-orphelin` : un effet de l'item qu'aucune activité ne pose, qui n'est pas transféré et que le moteur ne cite pas (État cadavérique) ;
 *  - `lien-casse`  : une activité pose un effet absent de l'item ;
 *  - `etat-absent` : le texte impose un état (« the Prone condition ») qu'aucun effet de l'item ne porte et que le moteur ne cite pas ;
 *  - `degats-vides`: une part de dégâts sans dés ni formule (la lance des prétirés, §151) ;
 *  - `sans-degats` : le texte annonce des dés de dégâts / de soin, aucune activité n'en porte, le moteur n'en déclare pas ;
 *  - `montee`      : sort de niveau ≥ 1 dont le texte augmente les dés au niveau supérieur, sans `scaling` sur la part ni sur l'activité ;
 *  - `tour-sans-montee` : tour de magie à dés sans montée « whole » ;
 *  - `moitie`      : « half as much damage » dans le texte et `onSave` ≠ half, ou l'inverse ;
 *  - `cle-inconnue`: changement d'effet sur une clé absente des données d'acteur de dnd5e (Maître des armures intermédiaires, §130) ;
 *  - `portee-soi`  : portée « personnelle » d'une activité qui vise une créature (relevé §124, rappelé) ;
 *  - `ident-orphelin` : une entrée du moteur dont l'identifiant n'existe dans aucune donnée lue (faute de frappe, renommage) ;
 *  - `srdRenamed` : un item du SRD 2024 renommé (même id de document que le Manuel, autre identifiant) sans la règle du Manuel.
 * Lit une COPIE des bases LevelDB, n'écrit rien dans le dépôt : le JSON (texte premium) va où on le demande, hors du dépôt.
 *   node tools/releve-trous.mjs <dossier Data de Foundry> <acteur.json> <sortie.json>
 * `acteur.json` : un acteur personnage et un PNJ lus par le connecteur (`get-actor`), en tableau — la liste des clés valides.
 */
import { cpSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT } from "../module/scripts/content/index.mjs";

const [data, actorFile, out] = process.argv.slice(2);
if ( !data || !actorFile || !out ) { console.error("usage : node tools/releve-trous.mjs <Data> <acteurs.json> <sortie.json>"); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), "releve-trous-"));

async function read(dir, fn) {
  if ( !existsSync(dir) ) return;
  const copy = join(tmp, String(Math.random()).slice(2));
  mkdirSync(copy, { recursive: true });
  for ( const f of readdirSync(dir) ) if ( f !== "LOCK" ) cpSync(join(dir, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  for await ( const [key, value] of db.iterator() ) fn(key, value);
  await db.close();
}

const text = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

/* ---- les items lus ---- */
const PHB = join(data, "modules/dnd-players-handbook/packs");
const SOURCES = [
  { book: "PHB", dir: join(PHB, "spells") }, { book: "PHB", dir: join(PHB, "feats") },
  { book: "PHB", dir: join(PHB, "classes") }, { book: "PHB", dir: join(PHB, "origins") },
  { book: "SRD", dir: join(data, "systems/dnd5e/packs/spells24") }, { book: "SRD", dir: join(data, "systems/dnd5e/packs/feats24") },
  { book: "SRD", dir: join(data, "systems/dnd5e/packs/classfeatures") }, { book: "SRD", dir: join(data, "systems/dnd5e/packs/origins24") }
];
// Seulement pour savoir quels identifiants existent (orphelins) : bestiaires, objets, Ravenloft, DMG.
const KNOWN_ONLY = [
  join(PHB, "equipment"), join(PHB, "actors"), join(data, "modules/dnd-monster-manual/packs/actors"),
  join(data, "modules/dnd-monster-manual/packs/features"), join(data, "modules/dnd-dungeon-masters-guide/packs/equipment"),
  join(data, "modules/dnd-dungeon-masters-guide/packs/features"), join(data, "modules/dnd-dungeon-masters-guide/packs/actors"),
  join(data, "modules/dnd-ravenloft-horrors-within/packs/options"), join(data, "modules/dnd-ravenloft-horrors-within/packs/items"),
  join(data, "modules/dnd-ravenloft-horrors-within/packs/actors"), join(data, "systems/dnd5e/packs/equipment24"),
  join(data, "systems/dnd5e/packs/monsterfeatures24"), join(data, "systems/dnd5e/packs/actors24")
];

const items = [];
const effectsOf = new Map();
for ( const { book, dir } of SOURCES ) {
  await read(dir, (key, value) => {
    if ( key.startsWith("!items.effects!") ) {
      const id = `${dir}|${key.split("!")[2].split(".")[0]}`;
      if ( !effectsOf.has(id) ) effectsOf.set(id, []);
      effectsOf.get(id).push(value);
    }
    else if ( key.startsWith("!items!") && ["spell", "feat"].includes(value.type) ) items.push({ book, dir, item: value });
  });
}
const known = new Set(items.map(i => i.item.system?.identifier).filter(Boolean));
const knownIds = new Map();   // identifiant → ids (activités, effets) de toutes ses versions, bestiaires compris
const noteIds = (ident, item, effects=[]) => {
  if ( !ident ) return;
  if ( !knownIds.has(ident) ) knownIds.set(ident, new Set());
  const set = knownIds.get(ident);
  for ( const id of Object.keys(item.system?.activities ?? {}) ) set.add(id);
  for ( const e of effects.concat(item.effects ?? []) ) if ( typeof e === "object" ) set.add(e._id);
};
const embeddedEffects = new Map();
for ( const dir of KNOWN_ONLY ) {
  await read(dir, (key, value) => {
    if ( key.startsWith("!actors.items.effects!") || key.startsWith("!items.effects!") ) {
      const owner = key.split("!")[2].split(".").at(-2);
      if ( !embeddedEffects.has(owner) ) embeddedEffects.set(owner, []);
      embeddedEffects.get(owner).push(value._id);
    }
    else if ( key.startsWith("!actors.items!") || key.startsWith("!items!") ) {
      const ident = value.system?.identifier;
      if ( ident ) { known.add(ident); noteIds(ident, value, (embeddedEffects.get(value._id) ?? []).map(_id => ({ _id }))); }
    }
  });
}
for ( const { dir, item } of items ) noteIds(item.system?.identifier, item, effectsOf.get(`${dir}|${item._id}`) ?? []);

/* ---- les clés d'acteur valides ---- */
const actors = JSON.parse(readFileSync(actorFile, "utf8"));
const keys = new Set();
const walk = (obj, path) => {
  if ( !obj || (typeof obj !== "object") || Array.isArray(obj) ) { keys.add(path); return; }
  keys.add(path);
  for ( const [k, v] of Object.entries(obj) ) walk(v, `${path}.${k}`);
};
for ( const a of [actors].flat() ) walk(a.system, "system");
// Valeurs dérivées que les données source n'ont pas (préparées par dnd5e) : acceptées sous un parent connu.
const DERIVED = new Set(["value", "max", "min", "bonus", "mod", "total", "dc", "bonuses", "tempmax", "temp", "effectiveMax", "mode",
  "flat", "calc", "formula", "armor", "shield", "cover", "abilities", "all"]);
const flagKeys = new Set();
const cfgPath = join(data, "systems/dnd5e/dnd5e.mjs");
if ( existsSync(cfgPath) ) {
  const src = readFileSync(cfgPath, "utf8");
  const block = src.slice(src.indexOf("DND5E.characterFlags = {"), src.indexOf("DND5E.characterFlags = {") + 20000);
  for ( const m of block.matchAll(/^ {2}(\w+): \{/gm) ) flagKeys.add(m[1]);
}
const keyOk = key => {
  if ( !key ) return true;
  if ( key.startsWith("flags.dnd5e.") ) return !flagKeys.size || flagKeys.has(key.split(".")[2]) || /^(initiative|spellCriticalThreshold|meleeCriticalDamageDice|weaponCriticalThreshold|tavernBrawler)/.test(key.split(".")[2]);
  if ( key.startsWith("flags.") || key.startsWith("macro.") || key.startsWith("ATL.") || key.startsWith("ATE.") ) return true;
  if ( !key.startsWith("system.") ) return true;
  if ( keys.has(key) ) return true;
  // Clés anciennes que dnd5e 6 renomme à l'application (documents/active-effect.mjs:80-86), valeurs préparées.
  if ( /^system\.attributes\.movement\.(speed|walk|burrow|climb|fly|jump|swim)$/.test(key) ) return true;
  if ( /^system\.(scale\.|traits\.dm\.amount\.|attributes\.hp\.bonuses\.)/.test(key) ) return true;
  const parts = key.split(".");
  for ( let i = parts.length - 1; i > 1; i-- ) {
    const parent = parts.slice(0, i).join(".");
    if ( keys.has(parent) && parts.slice(i).every(p => DERIVED.has(p) || /^(str|dex|con|int|wis|cha|mwak|rwak|msak|rsak|check|save|skill|spell|attack|damage|walk|fly|swim|climb|burrow|hover|units|darkvision|blindsight|tremorsense|truesight|special)$/.test(p)) ) return true;
  }
  return false;
};

/* ---- les relevés ---- */
const CONDITIONS = { Blinded: "blinded", Charmed: "charmed", Deafened: "deafened", Frightened: "frightened", Grappled: "grappled",
  Incapacitated: "incapacitated", Invisible: "invisible", Paralyzed: "paralyzed", Petrified: "petrified", Poisoned: "poisoned",
  Prone: "prone", Restrained: "restrained", Stunned: "stunned", Unconscious: "unconscious", Exhaustion: "exhaustion" };
const idsIn = (value, acc=new Set()) => {
  // Un id fait 16 caractères ; un nom de clé du schéma aussi parfois (« difficultTerrain ») : un mot en camelCase n'en est pas un,
  // sauf les ids lisibles des modules premium (« phbsplCompulsion »).
  if ( typeof value === "string" ) {
    if ( /^[A-Za-z0-9]{16}$/.test(value) && (!/^[a-z]+([A-Z][a-z]+)+$/.test(value) || /^(phb|mm|dmg|rhw|hotb|dnd5e)/.test(value)) ) acc.add(value);
  }
  else if ( Array.isArray(value) ) value.forEach(v => idsIn(v, acc));
  else if ( value && (typeof value === "object") ) for ( const [k, v] of Object.entries(value) ) { idsIn(k, acc); idsIn(v, acc); }
  return acc;
};
const changesOf = e => e.changes ?? e.system?.changes ?? [];
const rows = [];
const allFeats = [];
const seen = new Set();
for ( const { book, dir, item } of items ) {
  const s = item.system ?? {};
  const ident = s.identifier ?? "";
  // Un même identifiant au PHB et au SRD : le PHB d'abord, le SRD seulement s'il n'a pas de version PHB.
  const dedupe = `${item.type}|${ident}`;
  if ( (book === "SRD") && seen.has(dedupe) ) continue;
  seen.add(dedupe);
  const effects = effectsOf.get(`${dir}|${item._id}`) ?? [];
  const effectIds = new Set(effects.map(e => e._id));
  const activities = Object.values(s.activities ?? {});
  const activityIds = new Set(activities.map(a => a._id));
  const entry = CONTENT[ident];
  const entryIds = entry ? idsIn(entry) : new Set();
  const entryText = entry ? JSON.stringify(entry) : "";
  const desc = text(s.description?.value);
  const findings = [];
  const add = (kind, detail) => findings.push({ kind, detail });

  // ref-morte : id cité par le moteur, absent de cet item (et de toute version de cet identifiant).
  for ( const id of entryIds ) {
    if ( activityIds.has(id) || effectIds.has(id) ) continue;
    if ( knownIds.get(ident)?.has(id) ) continue;
    if ( /^dnd5eactivity\d{3}$/.test(id) ) { add("ref-morte", `${id} (activité générique absente)`); continue; }
    // Un id d'un autre item (un sort cité par une aptitude) : signalé à part, moins grave.
    const elsewhere = [...knownIds.entries()].find(([, set]) => set.has(id))?.[0];
    if ( !elsewhere ) add("ref-morte", id);
  }
  // Effets.
  const posed = new Set(activities.flatMap(a => (a.effects ?? []).map(e => e._id)));
  for ( const a of activities ) for ( const e of a.effects ?? [] ) if ( !effectIds.has(e._id) ) add("lien-casse", `${a.type} ${a.name || a._id} → ${e._id}`);
  for ( const e of effects ) {
    if ( e.transfer || posed.has(e._id) || entryIds.has(e._id) ) continue;
    if ( e.type === "enchantment" && activities.some(a => a.type === "enchant") ) continue;
    // Un effet visé par un `riders` d'enchantement ou nommé par le moteur.
    if ( entryText.includes(JSON.stringify(e.name)) ) continue;
    add("effet-orphelin", `${e.name} (${e._id})${e.statuses?.length ? ` [${e.statuses.join(", ")}]` : ""}`);
  }
  for ( const e of effects.filter(e => e.type !== "enchantment") ) for ( const c of changesOf(e) ) if ( !keyOk(c.key) ) add("cle-inconnue", `${e.name} : ${c.key} = ${c.value}`);
  // États annoncés.
  const statuses = new Set(effects.flatMap(e => e.statuses ?? []));
  for ( const [name, id] of Object.entries(CONDITIONS) ) {
    const re = new RegExp(`(have|has|gains?|give[sn]?|is|are|be|becomes?|knocked|fall|falls)\\s+(the\\s+)?${name}\\s+condition|${name} condition (until|for)`, "i");
    const m = desc.match(re);
    if ( !m ) continue;
    // Une condition préalable (« unless you have the Incapacitated condition ») n'est pas un état imposé.
    if ( /(unless|if|while|isn't|aren't|don't|doesn't|lack|not|without)[^.]{0,40}$/i.test(desc.slice(Math.max(0, m.index - 50), m.index)) ) continue;
    if ( statuses.has(id) || entryText.includes(`"${id}"`) ) continue;
    if ( new RegExp(`(immun\\w* to|ends? the|remove[sd]? the|end one|doesn't have|can't (have|be))[^.]{0,40}${name}`, "i").test(desc) && !new RegExp(`(has|have|gains?) the ${name}`, "i").test(desc) ) continue;
    add("etat-absent", name);
  }
  // Dégâts.
  const dmgParts = activities.flatMap(a => (a.damage?.parts ?? []).map(p => ({ a, p })));
  for ( const { a, p } of dmgParts ) {
    const hasDice = (p.number && p.denomination) || p.custom?.enabled && p.custom?.formula?.trim() || String(p.bonus ?? "").trim();
    if ( !hasDice ) add("degats-vides", `${a.type} ${a.name || a._id}`);
  }
  const textDice = /\b\d*d(4|6|8|10|12|20)\b[^.]{0,40}\b(\w+ )?(damage|Hit Points)/i.test(desc);
  const anyRoll = dmgParts.length || activities.some(a => a.healing?.number || a.healing?.custom?.formula || a.healing?.bonus);
  const engineRoll = /formula|damage|dice|heal/i.test(entryText);
  if ( textDice && !anyRoll && !engineRoll && activities.length ) add("sans-degats", desc.match(/\b\d*d(4|6|8|10|12|20)\b[^.]{0,40}/i)?.[0]);
  if ( item.type === "spell" ) {
    const higher = desc.split(/Using a Higher-Level Spell Slot\.?|At Higher Levels\.?/i)[1] ?? "";
    const cantrip = desc.split(/Cantrip Upgrade\.?/i)[1] ?? "";
    const scaled = dmgParts.some(({ p }) => p.scaling?.mode || p.scaling?.number || p.scaling?.formula)
      || activities.some(a => a.healing?.scaling?.mode || a.healing?.scaling?.number || a.healing?.scaling?.formula);
    if ( (s.level >= 1) && /(damage|healing|Hit Points|temporary)[^.]*increases by \d*d\d+|increases by \d*d\d+[^.]*(damage|healing)/i.test(higher) && !scaled && !/scal|perLevel|higher/i.test(entryText) ) add("montee", higher.slice(0, 120));
    if ( (s.level === 0) && /increases by|\d+d\d+/i.test(cantrip) && dmgParts.length && !dmgParts.some(({ p }) => p.scaling?.mode) && !/scal|cantrip/i.test(entryText) ) add("tour-sans-montee", cantrip.slice(0, 120));
    const half = /half as much damage|half damage|half the damage/i.test(desc);
    const saves = activities.filter(a => (a.type === "save") && a.damage?.parts?.length);
    if ( half && saves.length && !saves.some(a => a.damage?.onSave === "half") ) add("moitie", `texte : moitié ; onSave = ${saves.map(a => a.damage?.onSave || "none").join("/")}`);
    // Le moteur corrige la part sur une réussite (`saveDamage`) : plus un trou.
    if ( !half && saves.some(a => (a.damage?.onSave === "half") && !entry?.saveDamage?.[a._id]) && !/half/i.test(desc) ) add("moitie", "onSave = half, le texte ne le dit pas");
  }
  // Portée personnelle vers une créature.
  for ( const a of activities ) {
    const range = a.range?.override ? a.range?.units : s.range?.units;
    const affects = a.target?.override ? a.target?.affects?.type : s.target?.affects?.type;
    const template = a.target?.override ? a.target?.template?.type : s.target?.template?.type;
    if ( (range === "self") && ["creature", "ally", "enemy", "willing"].includes(affects) && !template && !/ranges|self/i.test(entryText) ) add("portee-soi", `${a.type} ${a.name || a._id} → ${affects}`);
  }
  if ( (item.type === "feat") && (book === "PHB") ) allFeats.push({ name: item.name, identifier: ident, id: item._id, cls: s.requirements ?? "" });
  if ( findings.length ) rows.push({ book, type: item.type, subtype: s.type?.value ?? "", level: s.level, name: item.name, identifier: ident, id: item._id,
    engine: entry ? Object.keys(entry).filter(k => k !== "source") : [], findings, text: desc.slice(0, 1500) });
}
// Un item du SRD 2024 qui garde l'id de document du Manuel sous un autre identifiant (« black-tentacles » pour
// « evards-black-tentacles ») : sans entrée propre ni alias, il n'a pas la règle du Manuel dans un monde sans le Manuel premium.
const phbById = new Map(items.filter(i => i.book === "PHB").map(i => [i.item._id, i.item.system?.identifier]));
const srdRenamed = items.filter(i => i.book === "SRD").map(i => ({ srd: i.item.system?.identifier, phb: phbById.get(i.item._id), name: i.item.name }))
  .filter(x => x.phb && x.srd && (x.phb !== x.srd) && CONTENT[x.phb] && !CONTENT[x.srd]);
const orphans = Object.keys(CONTENT).filter(id => !known.has(id) && !/^cos-|^das-|^test/.test(id) && !CONTENT[id]?.source);
writeFileSync(out.replace(/.json$/, "") + "-aptitudes.json", JSON.stringify(allFeats));
writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), items: items.length, rows, orphans, srdRenamed }, null, 1));
const count = {};
for ( const r of rows ) for ( const f of r.findings ) count[f.kind] = (count[f.kind] ?? 0) + 1;
console.log(`${items.length} items lus, ${rows.length} avec un relevé :`, count, `; identifiants du moteur sans donnée : ${orphans.length} ; renommés au SRD sans règle : ${srdRenamed.map(x => x.srd).join(", ") || "aucun"}`);
