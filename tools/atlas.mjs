#!/usr/bin/env node
/**
 * Atlas de l'automatisation (2026-10-28) : chaque sort, don, aptitude, objet et capacité de créature des modules premium, avec ses champs
 * structurants (activation, portée, cibles, zone, durée, attaque, dégâts, soins, sauvegarde, effets, invocation, utilisations,
 * déplacement, règles du moteur) et, pour chacun, qui le prend en charge :
 *  - `das` : une règle du moteur (`CONTENT`, par identifiant) ;
 *  - `sys` : les données dnd5e de l'item, que le moteur résout de façon générique ;
 *  - `man` : le texte l'annonce, ni les données ni le moteur ne le portent (laissé au MJ) ;
 *  - `bad` : défaut de données (part de dégâts vide, effet lié absent).
 * Statut global : le relevé de lecture (`prive/RELEVE_SORTS.md`) quand il en a un, sinon déduit des champs. Versions : empreinte des
 * données premium, empreinte de l'entrée du moteur, dernier commit qui l'a touchée ; l'historique (empreintes et statuts, aucun texte)
 * est tenu dans `prive/atlas/historique.json`, une ligne de plus par item à chaque changement.
 * Lit une COPIE des bases LevelDB (Foundry les verrouille). Le JSON produit contient le texte premium : il va hors du dépôt.
 *   node tools/atlas.mjs <dossier de sortie> [dossier Data de Foundry]
 * Sortie : `atlas-<onglet>.json` (sorts, dons, aptitudes, objets, creatures), `atlas-resume.json`, et `prive/ATLAS.md` (comptes, sans texte).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT } from "../module/scripts/content/index.mjs";

const [out, data = "F:/Foundry V14/Data"] = process.argv.slice(2);
if ( !out ) { console.error("usage : node tools/atlas.mjs <dossier de sortie> [Data]"); process.exit(1); }
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "atlas-"));
const ENGINE_VERSION = JSON.parse(readFileSync("module/module.json", "utf8")).version;
const TODAY = new Date().toISOString().slice(0, 10);

const MODULES = [
  { id: "dnd-players-handbook", label: "PHB 2024", packs: ["spells", "feats", "classes", "origins", "equipment", "actors"],
    fr: "../Foundry dnd5 module trad player manuel du joueur/module/compendium/fr" },
  { id: "dnd-dungeon-masters-guide", label: "DMG 2024", packs: ["equipment", "features", "actors"],
    fr: "../Foundry dnd5 module trad Game master/module/compendium/fr" },
  { id: "dnd-monster-manual", label: "MM 2025", packs: ["actors"], fr: "../Foundry dnd5 module trad bestiaire/compendium/fr" },
  { id: "dnd-ravenloft-horrors-within", label: "Ravenloft", packs: ["options", "items", "actors"],
    fr: "../Foundry dnd5 module trad Ravenloft/module/compendium/fr" },
  { id: "dnd-heroes-borderlands", label: "Heroes of the Borderlands", packs: ["options", "items", "actors"], fr: null }
];

async function read(dir, fn) {
  if ( !existsSync(dir) ) return;
  const copy = join(tmp, String(Math.random()).slice(2));
  mkdirSync(copy, { recursive: true });
  for ( const f of readdirSync(dir) ) if ( f !== "LOCK" ) cpSync(join(dir, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  for await ( const [key, value] of db.iterator() ) fn(key, value);
  await db.close();
}

const text = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/g, " ")
  .replace(/\s+/g, " ").trim();
const hash = v => createHash("sha1").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 8);
const units = { ft: "ft", mi: "mi", m: "m", km: "km", self: "personnelle", touch: "contact", spec: "spéciale", any: "illimitée" };

/* ---- catégories des clés du moteur ---- */
const CATS = {
  at: ["hitRider", "smite", "advantageIfFighting", "critMark", "halfOnMiss", "rangedFeat", "bonusAttack", "projectiles", "replacesAttack",
    "sneakAttack", "cunningStrikes", "cunningStrikeMax", "afterSneak", "sneakBonus", "savageAttacker", "piercer", "peerlessAim",
    "overwhelmingStrike", "reckless", "greatWeaponFighting", "thrownDamage", "flurry", "martialArts", "commandStrike", "sweep", "onNatural1",
    "critMove", "studiedAttacks", "oneAttack", "rolledAc", "heroicWarrior", "stunningStrike", "openHand", "oneAttack", "reactiveStrike",
    "interposeShield", "opportunityDisadvantage", "combatInspiration", "scoreFloor"],
  dm: ["saveDamage", "drain", "burst", "bolt", "storm", "lifesteal", "damageShield", "ignoresResistance", "elementalAdept",
    "spellDamageTypes", "potentCantrip", "empower", "discharge", "grappleDamage", "burns", "kindles", "flammable", "noDamage", "hpTiers",
    "byWounds", "absorb", "thrownDamage", "rage", "persistentRage", "swallow"],
  he: ["cures", "curesAll", "healMax", "healsDownedMax", "supremeHealing", "revivesFull", "regeneration", "hitDiceHeal", "healingRerolls",
    "fortifiedHealing", "lastStandHeal", "discipleOfLife", "blessedHealer", "tempHpPool", "stabilizes", "blocksHealing", "wardsAtZero",
    "stableAtZero", "atZero", "relentless", "endurance"],
  sv: ["saveAdvantage", "savedEffects", "saveDisadvantageFor", "willingFails", "saveAdvantageSize", "fleeOnFailedSave", "evasion",
    "fortitude", "pendingDie", "portent", "rollBonus", "elusive"],
  ar: ["emanation", "aura", "walls", "thinWall", "pointWall", "cellWall", "zoneAffects", "selfZone", "obscures", "difficultTerrain",
    "zoneEffects", "zoneCharges", "zoneEnd", "casterPulse", "movable", "globe", "encloses", "barrier", "wallSide", "wallAura", "slippery",
    "prismatic", "coverThrough", "sculptSpells", "scatter"],
  tg: ["targets", "castTargets", "ranges", "cantripRange", "enchantTarget"],
  du: ["effectEnds", "breaksOn", "actionEnds", "effectsExpire", "atTurnStart", "keepsConcentration", "concentrationBreaker", "recast",
    "recastCost", "holdsStill"],
  ef: ["effectChanges", "effectWhile", "effectStatuses", "effectThen", "effectsIf", "grantsSpeeds", "grantsResistances", "seesInvisible",
    "revealsInvisible", "levitate", "blink", "resize", "endsOwnConditions", "endsCurses", "dispel", "potionEffect", "light",
    "carriedLight", "noReactions", "noActions", "noOpportunityAttacks", "duplicates"],
  su: ["summon", "placesSummons", "orders"],
  us: ["usageLimits", "actionOrBonus", "grantsAction", "limitedAction", "basicActions", "slotRecovery", "regainOnInitiative", "metamagic",
    "ritualAdept", "extraFirstTurn", "pact", "spellRecall"],
  mv: ["teleport", "afterTeleport", "jump", "leap", "movesAfter", "swapPlaces", "transpose", "etherealShift", "climbsOnTurn", "fleetStep",
    "noOpportunity", "tether", "sharesSpace", "quickStand", "critMove", "haltOnReaction"]
};
// Événements de fin annoncés par le texte. `fixed` : une échéance que la durée d'un effet dnd5e suffit à porter ; `engine` : ce qui,
// dans l'entrée de contenu du moteur, porte ce type de fin.
const END_EVENTS = [
  { id: "resave", label: "sauvegarde répétée", engine: /"resave"|"repeatsSave"/,
    re: /\brepeats? the save|\bmakes? (another|a new) [^.]{0,30}saving throw at the (end|start) of each of its turns|at the (end|start) of each of its turns, (it|the target|the creature) (can )?(makes?|repeats?)/i },
  { id: "damage", label: "fin sur dégâts", engine: /"isDamaged"|"breaksOn":\[[^\]]*"damage"/,
    re: /\b(ends?|wakes? up)[^.]{0,40}\b(if|when) (it|the target|the creature|they) takes? (any )?damage|\bdamage ends (the|this)/i },
  { id: "acts", label: "fin si le porteur attaque ou lance un sort", engine: /"breaksOn"/,
    re: /\bends (early )?(for (it|that target) )?(if|when) [^.]{0,50}\b(makes? an attack|attack roll|casts? a spell|deals damage)/i },
  { id: "action", label: "action pour mettre fin", engine: /"actionEnds"|"escape"/,
    re: /\b(can )?(take|use) an action to [^.]{0,60}(end|escape|free)|\bas an action, [^.]{0,40}(end|escape)/i },
  { id: "distance", label: "fin hors de portée", engine: /"tether"|"effectEnds"/,
    re: /\bends (early )?if [^.]{0,60}(more than|farther than|beyond) \d+ feet/i },
  { id: "early", label: "fin anticipée (autre)", engine: /"effectEnds"|"breaksOn"|"zoneEnd"|"endsOwnConditions"|"concentrationBreaker"|"effectsExpire"/,
    re: /\b(spell|effect) ends (early )?(if|when|for)|\bends early\b/i },
  { id: "nextTurn", label: "fin du prochain tour", fixed: true, engine: /"effectEnds"|"atTurnStart"|"effectsExpire"/,
    re: /\buntil the (start|end) of (your|its|the \w+'s) next turn/i },
  { id: "thisTurn", label: "fin de ce tour", fixed: true, engine: /"effectEnds"|"atTurnStart"|"effectsExpire"/,
    re: /\buntil the (start|end) of (your|its) turn\b/i }
];
const END_STATUS = { das: "DAS", sys: "système", man: "manuel" };
const CAT_OF = new Map();
for ( const [cat, keys] of Object.entries(CATS) ) for ( const k of keys ) if ( !CAT_OF.has(k) ) CAT_OF.set(k, cat);

/* ---- relevés, balayages, scénarios, commits ---- */
const reading = new Map();
if ( existsSync("prive/RELEVE_SORTS.md") ) {
  for ( const m of readFileSync("prive/RELEVE_SORTS.md", "utf8").matchAll(/^\| [^|]+ \| `([^`]+)` \| ([^|]+) \| ([^|]*) \|/gm) ) {
    reading.set(m[1], { status: m[2].trim(), missing: m[3].trim() });
  }
}
const READING_TO = { moteur: "das", dnd5e: "sys", partiel: "part", trou: "man", "hors-combat": "off", manuel: "gm" };
// Relevé des dons : ses lignes nomment les dons en français (parfois groupés, l'anglais entre parenthèses), sans identifiant.
const fold = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const featReading = new Map();
if ( existsSync("prive/RELEVE_DONS.md") ) {
  for ( const m of readFileSync("prive/RELEVE_DONS.md", "utf8").matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]*) \|$/gm) ) {
    const state = m[2].trim();
    if ( /^(État|---)/.test(state) ) continue;
    const g = /^FAUX/.test(state) ? "bad" : /^(Plus tard|À FAIRE)/i.test(state) ? "man"
      : /^(FAIT|MOTEUR|Attaque réactive|Observateur FAIT)/.test(state) ? (/: non|à faire|pas d'/.test(state) ? "part" : "das")
      : /^OK/.test(state) ? "sys" : null;
    if ( !g ) continue;
    for ( const part of m[1].split(/,|\/| et /) ) {
      for ( const name of [part.replace(/\(.*?\)/g, ""), ...(part.match(/\(([^)]+)\)/g) ?? []).map(s => s.slice(1, -1))] ) {
        if ( fold(name) ) featReading.set(fold(name), { status: state, missing: m[3].trim(), g });
      }
    }
  }
}
// Identifiants que le code du moteur nomme hors des tables de contenu (Combat à deux armes, Maître d'armes…) : une règle DAS aussi.
const codeRefs = new Set();
for ( const f of readdirSync("module/scripts", { recursive: true }).map(String).filter(f => f.endsWith(".mjs") && !/^content[\\/]/.test(f)) ) {
  for ( const m of readFileSync(join("module/scripts", f), "utf8").matchAll(/["'`]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)["'`]/g) ) codeRefs.add(m[1]);
}
const ADVANCEMENT = { AbilityScoreImprovement: "caractéristiques", Trait: "maîtrises", ItemGrant: "objets ou sorts accordés",
  ItemChoice: "choix d'objets ou de sorts", ScaleValue: "valeur d'échelle", HitPoints: "points de vie", Size: "taille", Subclass: "sous-classe" };
const sweeps = new Map();
if ( existsSync("prive/balayages") ) {
  for ( const f of readdirSync("prive/balayages").filter(f => f.endsWith(".json")).sort() ) {
    for ( const row of JSON.parse(readFileSync(join("prive/balayages", f), "utf8")) ) {
      const issues = row.runs.flatMap(r => r.issues);
      sweeps.set(row.identifier, { at: f.replace(/^\w+-|\.json$/g, ""), ok: !issues.length && !!row.runs.length,
        note: issues.length ? issues.join(" ; ").slice(0, 300) : (row.runs.length ? "" : "non joué") });
    }
  }
}
const scenarioFiles = readdirSync("tools/scenarios", { recursive: true }).filter(f => f.endsWith(".mjs"));
const scenarioText = scenarioFiles.map(f => [f.replace(/\.mjs$/, "").replace(/\\/g, "/"), readFileSync(join("tools/scenarios", f), "utf8")]);
const scenariosOf = ident => scenarioText.filter(([, t]) => t.includes(`"${ident}"`)).map(([n]) => n);
const log = execFileSync("git", ["log", "-p", "--no-color", "--format=@@@%h %ad %s", "--date=short", "--", "module/scripts/content"],
  { encoding: "utf8", maxBuffer: 1 << 30 });
const commitsOf = new Map();
let commit = null;
for ( const line of log.split("\n") ) {
  if ( line.startsWith("@@@") ) { commit = line.slice(3); continue; }
  if ( !commit ) continue;
  // Une entrée de premier niveau d'une table de contenu (deux espaces d'indentation), nue ou entre guillemets.
  for ( const m of line.matchAll(/^[+-] {2}["']?([a-z][a-z0-9-]*)["']?\s*:/g) ) {
    if ( !commitsOf.has(m[1]) ) commitsOf.set(m[1], []);
    const list = commitsOf.get(m[1]);
    if ( !list.includes(commit) ) list.push(commit);
  }
}

/* ---- lecture des modules ---- */
const CONDITIONS = { Blinded: "blinded", Charmed: "charmed", Deafened: "deafened", Frightened: "frightened", Grappled: "grappled",
  Incapacitated: "incapacitated", Invisible: "invisible", Paralyzed: "paralyzed", Petrified: "petrified", Poisoned: "poisoned",
  Prone: "prone", Restrained: "restrained", Stunned: "stunned", Unconscious: "unconscious", Exhaustion: "exhaustion" };
const ITEM_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
const rows = [];
const versions = {};

function babele(mod, pack) {
  if ( !mod.fr ) return {};
  const f = join(mod.fr, `${mod.id}.${pack}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).entries ?? {} : {};
}

function tabOf(item) {
  if ( item.type === "spell" ) return "sorts";
  if ( ITEM_TYPES.has(item.type) ) return "objets";
  if ( item.type !== "feat" ) return null;
  const t = item.system?.type?.value ?? "";
  if ( t === "feat" ) return "dons";
  if ( t === "monster" ) return null;
  return "aptitudes";
}

for ( const mod of MODULES ) {
  const manifest = join(data, "modules", mod.id, "module.json");
  if ( !existsSync(manifest) ) continue;
  const version = JSON.parse(readFileSync(manifest, "utf8")).version;
  versions[mod.id] = { label: mod.label, version };
  for ( const pack of mod.packs ) {
    const dir = join(data, "modules", mod.id, "packs", pack);
    const fr = babele(mod, pack);
    const items = [];
    const actors = new Map();
    const effects = new Map();
    await read(dir, (key, v) => {
      if ( key.startsWith("!items.effects!") || key.startsWith("!actors.items.effects!") ) {
        // « item » ou « acteur.item » : les créatures du Manuel des monstres partagent leurs ids d'items.
        const owner = key.split("!")[2].split(".").slice(0, -1).join(".");
        if ( !effects.has(owner) ) effects.set(owner, []);
        effects.get(owner).push(v);
      }
      else if ( key.startsWith("!items!") ) items.push({ item: v });
      else if ( key.startsWith("!actors.items!") ) items.push({ item: v, actorId: key.split("!")[2].split(".")[0] });
      else if ( key.startsWith("!actors!") ) actors.set(v._id, v);
    });
    for ( const { item, actorId } of items ) {
      let tab;
      let owner = null;
      if ( actorId ) {
        const actor = actors.get(actorId);
        if ( !actor || (actor.type !== "npc") ) continue;
        if ( !["weapon", "feat"].includes(item.type) && !Object.keys(item.system?.activities ?? {}).length ) continue;
        if ( item.type === "spell" ) continue;
        tab = "creatures";
        const afr = fr[actor.name] ?? fr[actor._id];
        owner = { en: actor.name, fr: afr?.name ?? null, cr: actor.system?.details?.cr ?? null, type: actor.system?.details?.type?.value ?? "",
          tr: afr?.items?.[item._id] ?? afr?.items?.[item.name] ?? null };
      }
      else tab = tabOf(item);
      if ( !tab ) continue;
      const frEntry = owner ? owner.tr : (fr[item.name] ?? fr[item._id]);
      rows.push(describe({ item, tab, mod, version, pack, owner, actorId, frEntry,
        effects: effects.get(actorId ? `${actorId}.${item._id}` : item._id) ?? [] }));
    }
  }
}
rmSync(tmp, { recursive: true, force: true });

/* ---- une ligne ---- */
function dice(p) {
  if ( !p ) return "";
  if ( p.custom?.enabled ) return p.custom.formula || "∅";
  const d = p.number && p.denomination ? `${p.number}d${p.denomination}` : "";
  const b = p.bonus ? (d ? `+${p.bonus}` : p.bonus) : "";
  return `${d}${b}` || "∅";
}
function range(r) {
  if ( !r ) return "";
  if ( ["self", "touch", "spec", "any"].includes(r.units) ) return units[r.units];
  return r.value ? `${r.value}${r.long ? `/${r.long}` : ""} ${units[r.units] ?? r.units ?? ""}`.trim() : (r.reach ? `allonge ${r.reach}` : "");
}
function duration(d) {
  if ( !d?.units ) return "";
  if ( d.units === "inst" ) return "instantanée";
  if ( d.units === "perm" ) return "permanente";
  return `${d.value ?? ""} ${d.units}`.trim();
}
function activation(a) {
  if ( !a?.type ) return "";
  return `${a.value && (a.value !== 1) ? `${a.value} ` : ""}${a.type}${a.condition ? ` (${a.condition})` : ""}`;
}

function describe({ item, tab, mod, version, pack, owner, actorId, frEntry, effects }) {
  const s = item.system ?? {};
  const acts = Object.values(s.activities ?? {});
  const ident = s.identifier ?? "";
  const entry = CONTENT[ident];
  const engine = entry ? Object.keys(entry).filter(k => k !== "source") : [];
  const desc = text(s.description?.value);
  const effectIds = new Set(effects.map(e => e._id));
  const first = acts[0] ?? {};

  // Valeurs.
  const attacks = acts.filter(a => a.type === "attack").map(a => {
    const t = a.attack?.type ?? {};
    const bonus = a.attack?.bonus ? ` +${a.attack.bonus}` : "";
    return `${t.value ?? ""} ${t.classification ?? ""}${bonus}`.trim() || "attaque";
  });
  const damages = [];
  let emptyDamage = false;
  for ( const a of acts ) {
    const parts = a.damage?.parts ?? [];
    for ( const p of parts ) {
      const f = dice(p);
      if ( f === "∅" ) emptyDamage = true;
      damages.push(`${f} ${(p.types ?? []).join("/")}`.trim());
    }
    if ( a.type === "attack" && a.damage?.includeBase && (item.type === "weapon") && s.damage?.base ) {
      damages.unshift(`${dice(s.damage.base)} ${(s.damage.base.types ?? []).join("/")}`.trim());
    }
  }
  if ( !acts.length && s.damage?.base?.denomination ) damages.push(`${dice(s.damage.base)} ${(s.damage.base.types ?? []).join("/")}`.trim());
  const heals = acts.filter(a => a.healing && (a.healing.number || a.healing.bonus || a.healing.custom?.formula))
    .map(a => `${dice(a.healing)} ${(a.healing.types ?? []).join("/")}`.trim());
  const saves = acts.filter(a => a.type === "save" && a.save).map(a => {
    const ab = [a.save.ability].flat().filter(Boolean).join("/");
    const dc = a.save.dc?.formula || (a.save.dc?.calculation ? a.save.dc.calculation : "");
    return `${ab}${dc ? ` DD ${dc}` : ""}${a.damage?.onSave ? ` · ${a.damage.onSave}` : ""}`;
  });
  const tmpl = acts.map(a => a.target?.template).concat([s.target?.template]).find(t => t?.type);
  const area = tmpl ? `${tmpl.type} ${tmpl.size ?? ""}${tmpl.units ? ` ${tmpl.units}` : ""}${tmpl.count > 1 ? ` ×${tmpl.count}` : ""}`.trim() : "";
  const aff = acts.map(a => a.target?.affects).concat([s.target?.affects]).find(t => t?.type || t?.count);
  const targets = aff ? `${aff.count ?? ""} ${aff.type ?? ""}${aff.special ? ` (${aff.special})` : ""}`.trim() : "";
  const dur = duration(s.duration) || duration(acts.find(a => a.duration?.override)?.duration);
  const conc = (s.properties ?? []).includes("concentration") || acts.some(a => a.duration?.concentration);
  const ritual = (s.properties ?? []).includes("ritual");
  const summons = acts.filter(a => ["summon", "transform"].includes(a.type))
    .map(a => `${a.type === "summon" ? "invocation" : "métamorphose"} (${(a.profiles ?? []).length} profil${(a.profiles ?? []).length > 1 ? "s" : ""})`);
  const uses = [];
  if ( s.uses?.max ) uses.push(`${s.uses.max}${(s.uses.recovery ?? []).length ? ` / ${(s.uses.recovery ?? []).map(r => r.period === "recharge" ? `recharge ${r.formula}` : r.period).join(", ")}` : ""}`);
  for ( const a of acts ) if ( a.uses?.max ) uses.push(`${a.name || a.type} : ${a.uses.max}${(a.uses.recovery ?? []).map(r => r.period === "recharge" ? ` (recharge ${r.formula})` : ` / ${r.period}`).join("")}`);
  const statuses = [...new Set(effects.flatMap(e => e.statuses ?? []))];
  const effectNames = effects.map(e => `${e.name}${e.transfer ? " (passif)" : ""}${(e.changes ?? e.system?.changes ?? []).length ? ` [${(e.changes ?? e.system?.changes).length} chgt]` : ""}`);
  const others = [...new Set(acts.map(a => a.type).filter(t => !["attack", "save", "damage", "heal", "summon", "transform"].includes(t)))];

  // Défauts de données.
  const bad = [];
  if ( emptyDamage ) bad.push("part de dégâts vide");
  const posed = new Set(acts.flatMap(a => (a.effects ?? []).map(e => e._id)));
  for ( const a of acts ) for ( const e of a.effects ?? [] ) if ( !effectIds.has(e._id) ) bad.push(`effet lié absent (${a.name || a.type})`);
  const entryText = entry ? JSON.stringify(entry) : "";
  for ( const e of effects ) {
    if ( e.transfer || posed.has(e._id) || entryText.includes(e._id) || entryText.includes(JSON.stringify(e.name)) ) continue;
    if ( (e.type === "enchantment") && acts.some(a => a.type === "enchant") ) continue;
    bad.push(`effet jamais posé : ${e.name}`);
  }

  // Ce que le texte annonce.
  const says = {
    at: /\b(melee|ranged) (weapon |spell )?attack roll|\bmake (a|an|one) (melee|ranged) (spell )?attack|\bspell attack\b/i.test(desc),
    dm: /\b\d+d\d+\b[^.]{0,60}\bdamage\b|\bdamage equal to\b/i.test(desc),
    he: /\bregains? [^.]{0,40}hit points|\bTemporary Hit Points\b/i.test(desc),
    sv: /\b(make|makes|succeed on|must succeed on) (a|an) \w+ saving throw|\b\w+ Saving Throw:/i.test(desc),
    ar: /\b\d+-foot(-radius|-long|-wide)?[- ](Emanation|Sphere|Cone|Cube|Line|Cylinder|radius)/i.test(desc),
    mv: /\bteleport|\bpush(ed|es)? [^.]{0,30}\b\d+ feet|\bpull(ed|s)? [^.]{0,30}\b\d+ feet/i.test(desc),
    su: /\bsummon|\bconjure|\bcreate[sd]? [^.]{0,30}\b(creature|spirit|servant)/i.test(desc)
  };
  const announced = [];
  for ( const [name, id] of Object.entries(CONDITIONS) ) {
    const re = new RegExp(`(have|has|gains?|give[sn]?|is|are|be|becomes?|knocked|falls?)\\s+(the\\s+)?${name}\\s+condition|${name} condition (until|for)`, "i");
    const m = desc.match(re);
    if ( !m ) continue;
    if ( /(unless|if|while|isn['’]t|aren['’]t|don['’]t|doesn['’]t|lack|not|without|immun\w*)[^.]{0,40}$/i.test(desc.slice(Math.max(0, m.index - 50), m.index)) ) continue;
    if ( statuses.includes(id) || entryText.includes(`"${id}"`) ) continue;
    announced.push(name);
  }

  // Fin : la durée des effets dans les données (V14 : { value, units, expiry }), et chaque événement de fin annoncé par le texte,
  // porté par le moteur, par la durée d'un effet (fin fixe), ou par rien.
  const span = d => {
    if ( !d?.value || !d.units ) return "";
    if ( d.units !== "seconds" ) return `${d.value} ${{ rounds: "round", turns: "tour" }[d.units] ?? d.units}${d.value > 1 ? "s" : ""}`;
    const v = d.value;
    return v % 86400 === 0 ? `${v / 86400} j` : v % 3600 === 0 ? `${v / 3600} h` : v % 60 === 0 ? `${v / 60} min` : `${v} s`;
  };
  const effectEnd = [...new Set(effects.filter(e => !e.transfer).map(e => span(e.duration)).filter(Boolean))];
  const turnBound = effects.some(e => !e.transfer && ["rounds", "turns"].includes(e.duration?.units));
  const ends = END_EVENTS.filter(e => e.re.test(desc)).map(e => ({ id: e.id, label: e.label,
    s: e.engine.test(entryText) ? "das" : (e.fixed && turnBound) ? "sys" : "man" }));
  // Une fin anticipée déjà comptée sous un type précis ne compte pas deux fois.
  const endList = ends.filter(e => (e.id !== "early") || !ends.some(o => ["damage", "acts", "distance"].includes(o.id)));

  // Statuts par champ.
  const das = cat => engine.some(k => CAT_OF.get(k) === cat);
  const S = {};
  const field = (key, sys, man, isBad=false) => { S[key] = isBad ? "bad" : das(key) ? "das" : sys ? "sys" : man ? "man" : ""; };
  field("at", attacks.length, says.at);
  field("dm", damages.length, says.dm && !damages.length, emptyDamage);
  field("he", heals.length, says.he);
  field("sv", saves.length, says.sv);
  field("ar", area, says.ar);
  field("tg", targets, false);
  field("du", dur && (dur !== "instantanée"), false);
  field("ef", effects.length, announced.length, bad.some(b => b.startsWith("effet")));
  field("su", summons.length, says.su && !summons.length && (tab !== "creatures"));
  field("us", uses.length, false);
  field("mv", false, says.mv);
  // Fin : le pire des événements annoncés ; sans événement, la durée d'un effet suffit (système).
  S.fi = endList.some(e => e.s === "man") ? "man" : endList.some(e => e.s === "sys") ? "sys" : endList.length ? "das"
    : effectEnd.length ? "sys" : "";
  const script = engine.filter(k => !CAT_OF.has(k));
  const inCode = !entry && codeRefs.has(ident);
  S.sp = (script.length || inCode) ? "das" : "";
  // Progressions dnd5e (caractéristiques, maîtrises, sorts accordés) : ce que le système applique seul à l'ajout de l'item.
  const advancements = [...new Set(Object.values(s.advancement ?? {}).map(a => ADVANCEMENT[a.type] ?? a.type))];
  S.pg = advancements.length ? "sys" : "";
  // Un champ « man » que le moteur couvre par une règle générale (triggers, choice) reste à vérifier : le relevé de lecture tranche.
  const values = Object.values(S);

  // Statut global.
  const rd = (tab === "sorts") ? reading.get(ident)
    : (tab === "dons") ? (featReading.get(fold(frEntry?.name)) ?? featReading.get(fold(item.name)) ?? null) : null;
  const rdKey = rd ? (rd.g ?? READING_TO[rd.status.replace(/\s*\(.*$/, "")] ?? null) : null;
  let g;
  if ( rdKey ) g = rdKey;
  else if ( values.includes("bad") ) g = "bad";
  else if ( values.includes("man") ) g = (values.includes("das") || values.includes("sys")) ? "part" : "man";
  else if ( engine.length || inCode ) g = "das";
  else if ( values.includes("sys") ) g = "sys";
  else g = "text";

  const frName = frEntry?.name ?? null;
  const frDesc = frEntry?.description ? text(frEntry.description) : "";
  const uid = actorId ? `${mod.id}/${pack}/${actorId}/${item._id}` : `${mod.id}/${pack}/${item._id}`;
  const sweep = sweeps.get(ident);
  const scen = ident ? scenariosOf(ident) : [];
  const commits = commitsOf.get(ident) ?? [];
  const dataHash = hash({ s: { activities: s.activities, damage: s.damage, duration: s.duration, target: s.target, range: s.range, uses: s.uses,
    properties: s.properties, level: s.level }, e: effects.map(e => ({ c: e.changes ?? e.system?.changes, st: e.statuses, t: e.transfer })) });

  return {
    k: uid, t: tab, n: item.name, f: frName, i: ident,
    m: mod.label, mv: version, p: pack, u: actorId ? `Compendium.${mod.id}.${pack}.Actor.${actorId}.Item.${item._id}` : `Compendium.${mod.id}.${pack}.Item.${item._id}`,
    o: owner ? (owner.fr ?? owner.en) : null, oe: owner?.en ?? null, ocr: owner?.cr ?? null, oty: owner?.type ?? null,
    ty: `${item.type}${s.type?.value ? ` · ${s.type.value}${s.type.subtype ? `/${s.type.subtype}` : ""}` : ""}`,
    lv: item.type === "spell" ? s.level : (s.requirements || (s.prerequisites?.level ? `niv. ${s.prerequisites.level}` : "")),
    sc: item.type === "spell" ? (s.school ?? "") : (s.rarity || ""),
    ac: activation(s.activation) || activation(first.activation),
    rg: range(s.range) || range(acts.find(a => a.range?.units)?.range),
    tg: targets, ar: area, du: dur, co: conc, ri: ritual,
    at: attacks.join(" · "), dm: damages.join(" · "), he: heals.join(" · "), sv: saves.join(" · "),
    ef: effectNames.join(" · "), st: statuses, an: announced, su: summons.join(" · "), us: uses.join(" · "),
    ot: others.join(", "), mvt: says.mv ? "annoncé" : "",
    pg: advancements.join(" · "),
    fi: [...effectEnd.map(x => `effet ${x}`), ...endList.map(e => `${e.label} (${END_STATUS[e.s]})`)].join(" · "), fe: endList.map(e => `${e.id}:${e.s}`),
    eng: inCode ? ["code du moteur"] : engine, ej: entry ? JSON.stringify(entry).slice(0, 1200) : "",
    S, g, bad,
    rd: rd ? rd.status : "", rdm: rd?.missing ?? "",
    sw: sweep ? `${sweep.ok ? "✓" : "✗"} ${sweep.at}${sweep.note ? ` — ${sweep.note}` : ""}` : "",
    sn: scen.length, sl: scen.slice(0, 8).join(", "),
    cm: commits[0] ?? "", cn: commits.length,
    h: dataHash, eh: entry ? hash(entryText) : "",
    d: (frDesc || desc).slice(0, 2500), dl: frDesc ? "fr" : "en"
  };
}

/* ---- historique (empreintes et statuts seulement) ---- */
const histPath = "prive/atlas/historique.json";
mkdirSync("prive/atlas", { recursive: true });
const hist = existsSync(histPath) ? JSON.parse(readFileSync(histPath, "utf8")) : { runs: [], items: {} };
const previous = hist.runs.at(-1)?.date ?? null;
hist.runs.push({ date: TODAY, engine: ENGINE_VERSION, modules: versions, rows: rows.length });
for ( const r of rows ) {
  const list = hist.items[r.k] ??= [];
  const last = list.at(-1);
  const now = { d: TODAY, v: ENGINE_VERSION, mv: r.mv, h: r.h, eh: r.eh, g: r.g };
  if ( !last ) { list.push(now); r.ch = previous ? "nouveau" : ""; }
  else if ( (last.h !== r.h) || (last.eh !== r.eh) || (last.g !== r.g) ) {
    r.ch = [last.h !== r.h ? "données" : "", last.eh !== r.eh ? "moteur" : "", last.g !== r.g ? `statut ${last.g}→${r.g}` : ""].filter(Boolean).join(", ");
    if ( last.d === TODAY ) list[list.length - 1] = now;
    else list.push(now);
  }
  else r.ch = "";
  r.rev = list.length;
  r.hi = list.map(x => `${x.d} · DAS ${x.v} · ${x.mv} · ${x.g}${x.eh ? ` · règle ${x.eh}` : ""}`).join("\n");
}
writeFileSync(histPath, JSON.stringify(hist));

/* ---- sorties ---- */
const TABS = ["sorts", "dons", "aptitudes", "objets", "creatures"];
const summary = [];
for ( const tab of TABS ) {
  const list = rows.filter(r => r.t === tab).sort((a, b) => (a.o ?? "").localeCompare(b.o ?? "") || (a.f ?? a.n).localeCompare(b.f ?? b.n));
  writeFileSync(join(out, `atlas-${tab}.json`), JSON.stringify(list));
  const byG = {};
  for ( const r of list ) byG[r.g] = (byG[r.g] ?? 0) + 1;
  const byField = {};
  for ( const r of list ) for ( const [f, st] of Object.entries(r.S) ) if ( st ) { byField[f] ??= {}; byField[f][st] = (byField[f][st] ?? 0) + 1; }
  for ( const [g, n] of Object.entries(byG) ) summary.push({ tab, kind: "statut", key: g, n });
  for ( const [f, c] of Object.entries(byField) ) for ( const [st, n] of Object.entries(c) ) summary.push({ tab, kind: "champ", key: `${f}:${st}`, n });
  const byEnd = {};
  for ( const r of list ) for ( const e of r.fe ) byEnd[e] = (byEnd[e] ?? 0) + 1;
  for ( const [key, n] of Object.entries(byEnd) ) summary.push({ tab, kind: "fin", key, n });
}
// Le tableau de bord ne lit que des lignes : les métadonnées du relevé en sont aussi.
const meta = [["date", TODAY], ["engine", ENGINE_VERSION], ["previous", previous ?? ""], ["rows", String(rows.length)],
  ["modules", Object.values(versions).map(v => `${v.label} ${v.version}`).join(" · ")]];
for ( const [key, v] of meta ) summary.push({ tab: "*", kind: "meta", key, n: 0, v });
writeFileSync(join(out, "atlas-resume.json"), JSON.stringify(summary));

const label = { das: "DAS", sys: "système", part: "partiel", man: "manuel", gm: "MJ", off: "hors combat", text: "texte", bad: "défaut" };
const md = ["# Atlas de l'automatisation", "",
  `Généré le ${TODAY} par \`tools/atlas.mjs\` (moteur ${ENGINE_VERSION}). Comptes seulement ; le détail (texte premium) est hors dépôt, dans le`,
  "tableau de bord « Atlas d'automatisation DAS ». Statuts : relevé de lecture pour les sorts, sinon déduits des champs (`das` règle du",
  "moteur, `sys` données dnd5e résolues par le moteur, `man` annoncé par le texte et porté par personne, `bad` défaut de données).", "",
  `Modules : ${Object.values(versions).map(v => `${v.label} ${v.version}`).join(" · ")}.`, "",
  "| Onglet | Items | " + Object.values(label).join(" | ") + " |", "|---|---|" + Object.keys(label).map(() => "---|").join("")];
for ( const tab of TABS ) {
  const list = rows.filter(r => r.t === tab);
  md.push(`| ${tab} | ${list.length} | ${Object.keys(label).map(g => list.filter(r => r.g === g).length || "").join(" | ")} |`);
}
md.push("", "## Champs annoncés et portés par personne (`man`)", "");
for ( const tab of TABS ) {
  const list = rows.filter(r => r.t === tab);
  const counts = Object.fromEntries(Object.keys(CATS).map(c => [c, list.filter(r => r.S[c] === "man").length]));
  md.push(`- **${tab}** : ${Object.entries(counts).filter(([, n]) => n).map(([c, n]) => `${c} ${n}`).join(" · ") || "aucun"}`);
}
md.push("", "## Types de fin (événements annoncés par le texte)", "",
  "Par type : items où le moteur le porte (DAS), où la durée d'un effet dnd5e suffit (système), où rien ne le porte (manuel).", "",
  "| Type de fin | " + TABS.join(" | ") + " |", "|---|" + TABS.map(() => "---|").join(""));
for ( const e of END_EVENTS ) {
  md.push(`| ${e.label} | ${TABS.map(tab => { const l = rows.filter(r => r.t === tab);
    const n = st => l.filter(r => r.fe.includes(`${e.id}:${st}`)).length;
    return [n("das") && `${n("das")} DAS`, n("sys") && `${n("sys")} sys`, n("man") && `${n("man")} man`].filter(Boolean).join(" · ") || "";
  }).join(" | ")} |`);
}
md.push("", "## Défauts de données", "");
for ( const r of rows.filter(r => r.bad.length).slice(0, 400) ) md.push(`- ${r.t} · ${r.o ? `${r.o} · ` : ""}${r.f ?? r.n} \`${r.i}\` (${r.m}) : ${r.bad.join(" ; ")}`);
writeFileSync("prive/ATLAS.md", md.join("\n"));
console.log(`${rows.length} lignes → ${out}`);
for ( const tab of TABS ) console.log(`  ${tab} : ${rows.filter(r => r.t === tab).length}`);
