// Balayage des capacités de monstres du Monster Manual, classées par mécanisme (SPEC §18).
// Mode "pack" : les 684 entrées de dnd-monster-manual.features (versions génériques).
// Mode "actors" : les copies réellement portées par les 520 créatures, groupées par (source, nom, texte).
// Lit l'extraction anglaise du dépôt voisin (work/mm-en, non versionnée : `npm run extract` là-bas).
// node tools/balayage-mm.mjs <sortie.md> [actors|pack]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../Foundry dnd5 module trad bestiaire/work/mm-en");
const read = dir => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), "utf8")));
const features = read("features");
const actors = read("actors");
const MODE = process.argv[3] ?? "actors";

const text = f => (f.system?.description?.value ?? "").replace(/\[\[lookup [^\]]*\]\]/g, "…")
  .replace(/\[\[\/(\w+)[^\]]*\]\]/g, "[$1]").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&")
  .replace(/&Reference\[(\w+)[^\]]*\]/g, "$1").replace(/\s+/g, " ").trim();
const acts = f => Object.values(f.system?.activities ?? {});
const activation = f => new Set(acts(f).map(a => a.activation?.type).filter(Boolean));
const isLegendary = f => activation(f).has("legendary") || /^Legendary Actions/i.test(f.name);
const recovery = f => [f.system?.uses, ...acts(f).map(a => a.uses)].flatMap(u => u?.recovery ?? []).map(r => r.period);

const users = new Map();
const carried = new Map();
for (const a of actors) for (const it of a.items ?? []) {
  const src = it._stats?.compendiumSource?.match(/features\.Item\.(\w+)/)?.[1];
  if (src) (users.get(src) ?? users.set(src, []).get(src)).push(a.name);
  if (!["feat", "weapon"].includes(it.type)) continue;
  const key = (src ?? "local") + "|" + it.name + "|" + text(it);
  (carried.get(key) ?? carried.set(key, { item: it, owners: [] }).get(key)).owners.push(a.name);
}
const pool = MODE === "pack"
  ? features.map(f => ({ item: f, owners: users.get(f._id) ?? [] }))
  : [...carried.values()];

// [clé, libellé, brique, test(item, texte)]
const MECHS = [
  ["multiattack", "Attaques multiples", "NOUVEAU — enchaînement", f => /^Multiattack/i.test(f.name)],
  ["hitSave", "Attaque + sauvegarde sœur (au toucher)", "B16", f => acts(f).some(a => a.type === "attack") && acts(f).some(a => a.type === "save")],
  ["hitAuto", "Attaque qui pose un état sans sauvegarde (« the target has the X condition »)", "B7 (on: hit)", (f, t) => acts(f).some(a => a.type === "attack") && !acts(f).some(a => a.type === "save") && /the target has the \w+ condition|target is (Grappled|Restrained|Prone)|has the (Grappled|Prone|Restrained|Poisoned|Blinded) condition/i.test(t)],
  ["breath", "Souffle / zone à sauvegarde (cône, ligne, sphère, émanation)", "natif + zones du moteur", f => acts(f).some(a => a.type === "save" && ["cone", "line", "sphere", "cube", "cylinder", "radius", "wall", "emanation"].includes(a.target?.template?.type))],
  ["recharge", "Recharge X–6", "natif ? (dnd5e.combatRecovery)", f => recovery(f).includes("recharge")],
  ["perDay", "X/Jour, par repos", "natif", f => recovery(f).some(p => ["day", "lr", "sr", "dawn", "dusk"].includes(p))],
  ["spellcasting", "Incantation (activités cast)", "natif + moteur (sorts)", f => /^Spellcasting/i.test(f.name) || acts(f).some(a => a.type === "cast")],
  ["grapple", "Agrippé (DD d'évasion)", "B15 / B7", (f, t) => /Grappled/.test(t)],
  ["restrained", "Entravé", "B7", (f, t) => /Restrained/.test(t)],
  ["prone", "À terre", "B7", (f, t) => /\bProne\b/.test(t)],
  ["poisoned", "Empoisonné", "B7", (f, t) => /Poisoned/.test(t)],
  ["frightened", "Effrayé", "B7", (f, t) => /Frightened/.test(t)],
  ["charmed", "Charmé", "B7", (f, t) => /Charmed/.test(t)],
  ["paralyzed", "Paralysé", "B7", (f, t) => /Paralyzed/.test(t)],
  ["stunned", "Étourdi", "B7", (f, t) => /Stunned/.test(t)],
  ["blinded", "Aveuglé", "B7", (f, t) => /Blinded/.test(t)],
  ["incapacitated", "Neutralisé", "B7", (f, t) => /Incapacitated/.test(t)],
  ["deafened", "Assourdi", "B7", (f, t) => /Deafened/.test(t)],
  ["petrified", "Pétrifié (souvent en deux temps)", "B7 + NOUVEAU (progression)", (f, t) => /Petrified/.test(t)],
  ["resave", "Sauvegarde répétée en fin / début de tour", "B4", (f, t) => /repeats? the (\[save\]|save|saving throw)/i.test(t)],
  ["endsOnDamage", "Cesse si la cible subit des dégâts", "B8", (f, t) => /ends (early )?(if|when) .{0,50}takes (any )?damage/i.test(t)],
  ["push", "Poussée", "B3", (f, t) => /pushed|push(es)? (the target|it|them|each)/i.test(t)],
  ["pull", "Traction", "B3", (f, t) => /pulled|pulls? (the target|it|them|each)/i.test(t)],
  ["lasting", "Zone qui dure (entre / commence ou finit son tour dedans)", "B1", (f, t) => /(enters|starts its turn|ends its turn) (in|within)/i.test(t)],
  ["emanation", "Émanation passive (aura)", "B13", (f, t) => /Emanation/i.test(t) && !acts(f).some(a => a.type === "save" && a.activation?.type === "action")],
  ["teleport", "Téléportation", "B11", (f, t) => /teleports?/i.test(t) || acts(f).some(a => a.type === "teleport")],
  ["reaction", "Réaction", "B5 (moment à lire au cas par cas)", f => activation(f).has("reaction")],
  ["parry", "Parade (+CA contre une attaque)", "B5 (isHit)", (f, t) => /^Parry/i.test(f.name) || /adds? \S+ to its AC/i.test(t)],
  ["bonus", "Action bonus", "natif (budget)", f => activation(f).has("bonus")],
  ["packTactics", "Tactique de meute", "B6 (fait « allié à 5 ft de la cible »)", f => /^Pack Tactics/i.test(f.name)],
  ["advantage", "Autre avantage conditionnel aux attaques", "B6", (f, t) => !/^Pack Tactics/i.test(f.name) && /Advantage on (attack rolls|an attack roll|the attack roll)/i.test(t)],
  ["disadvantage", "Désavantage imposé", "B6", (f, t) => /Disadvantage on (attack rolls|ability checks|saving throws|the next)/i.test(t)],
  ["sunlight", "Sensibilité au soleil", "B6 + fait « en plein soleil »", (f, t) => /sunlight/i.test(t)],
  ["magicResist", "Résistance à la magie", "NOUVEAU — avantage aux sauvegardes contre les sorts", f => /^Magic Resistance/i.test(f.name)],
  ["legendaryResist", "Résistance légendaire (échec → réussite)", "NOUVEAU — choix après la sauvegarde", f => /^Legendary Resistance/i.test(f.name)],
  ["extraDamage", "Dégâts supplémentaires conditionnels", "B2", (f, t) => /(extra|additional) (\[damage\] |\d+ \(\S+\) )?\w* ?damage|deals an extra/i.test(t)],
  ["charge", "Charge / Bond (déplacé en ligne droite avant l'attaque)", "NOUVEAU — fait « a bougé de X vers la cible »", (f, t) => /(moved|moves|flew|flies|swam) (at least )?\S+ (feet|ft)[^.]{0,80}(straight|toward|immediately before)/i.test(t) || /^(Charge|Pounce|Tramplin|Aquatic Charge|Tactical Charge|Smelting Charge)/i.test(f.name)],
  ["trample", "Piétinement d'une cible À terre", "B2 / fait « cible À terre »", (f, t) => /^Trample/i.test(f.name) || /against a Prone/i.test(t)],
  ["tempHp", "PV temporaires", "natif (heal temp)", (f, t) => /Temporary Hit Points/i.test(t)],
  ["heal", "Soin de soi (drain, festin)", "natif (heal) ou NOUVEAU (soin = dégâts infligés)", (f, t) => /regains? (a number of )?Hit Points equal to/i.test(t)],
  ["regen", "Régénération en début de tour (coupée par un type de dégâts)", "NOUVEAU — startOfTurn heal + blocage", (f, t) => /^Regeneration/i.test(f.name) || /regains? \S+ Hit Points at the start of/i.test(t)],
  ["hpMax", "Réduction du maximum de PV", "NOUVEAU — effet sur hp.tempmax", (f, t) => /Hit Point maximum (decreases|is reduced)/i.test(t)],
  ["noHeal", "Ne peut plus regagner de PV", "NOUVEAU", (f, t) => /can't regain Hit Points/i.test(t)],
  ["swallow", "Avaler / engloutir", "NOUVEAU", (f, t) => /swallow|engulf/i.test(t)],
  ["deathBurst", "À sa mort / à 0 PV (explosion, dernier sursaut)", "NOUVEAU — moment « tombe » du porteur", (f, t) => /(When|If) (it|the \w+) (dies|is reduced to 0 Hit Points|drops to 0)/i.test(t)],
  ["undying", "Refuse de tomber (Ténacité des morts-vivants…)", "NOUVEAU — sauvegarde à 0 PV", (f, t) => /^(Undead Fortitude|Relentless|Rejuvenation)/i.test(f.name) || /drops? to 1 Hit Point instead/i.test(t)],
  ["shapechange", "Changement de forme", "NOUVEAU (hors combat surtout)", (f, t) => /shape-?shift|transforms? into|polymorph/i.test(t)],
  ["summon", "Invocation / appel", "B12", (f, t) => acts(f).some(a => a.type === "summon") || /summons?/i.test(t)],
  ["noOA", "Ne provoque pas d'attaque d'opportunité", "NOUVEAU — légalité AO (Vol rasant, Fuite agile)", (f, t) => /doesn't provoke Opportunity Attacks|without provoking/i.test(t)],
  ["disengage", "Désengagement / Se cacher / Foncer en action bonus", "natif (actions de base)", (f, t) => /takes? the (Disengage|Hide|Dash)( or \w+)* action/i.test(t)],
  ["speed", "Vitesse réduite / 0", "B7 / effet de vitesse", (f, t) => /Speed (is reduced|becomes 0|decreases|is halved)|Speed of 0/i.test(t)],
  ["invisible", "Devient Invisible", "natif + §17.3", (f, t) => /Invisible/.test(t)],
  ["damageThreshold", "Résistance ou immunité conditionnelle", "natif (traits) ou B14", (f, t) => /(Resistance|Immunity) to/i.test(t)],
  ["passive", "Passif sans effet de combat (Amphibie, Pattes d'araignée…)", "rien", f => !acts(f).length && /^(Amphibious|Spider Climb|Water Breathing|Keen |Hold Breath|Limited Amphibiousness|Beast of Burden|Siege Monster|Illumination|Web Walker|Mimicry|Unusual Nature|Standing Leap|Flyby|Echolocation|Spider Sense|Web Sense|Speak with|Telepathic|Light Sensitivity|Mimicry|Sure-Footed|Legendary Resistance)/i.test(f.name)],
];

const byMech = new Map(MECHS.map(m => [m[0], []]));
const rows = [], unmatched = [];
let legendary = 0;
for (const { item: f, owners } of pool) {
  if (isLegendary(f)) { legendary += 1; continue; }
  const t = text(f);
  const hits = MECHS.filter(m => { try { return m[3](f, t); } catch { return false; } }).map(m => m[0]);
  const row = { name: f.name, type: f.type, act: [...activation(f)].join("/"), acts: acts(f).map(a => a.type).join("+"),
    n: owners.length, owners: [...new Set(owners)].slice(0, 4).join(", "), hits, t };
  rows.push(row);
  for (const h of hits) byMech.get(h).push(row);
  if (!hits.length) unmatched.push(row);
}

const line = r => `- **${r.name}** (${r.type}, ${r.act || "—"}, ${r.acts || "sans activité"}, ×${r.n} : ${r.owners}) — ${r.t.slice(0, 280)}`;
const out = [`# Balayage ${MODE} — ${pool.length} capacités distinctes, ${actors.length} créatures`,
  `Actions légendaires écartées : ${legendary}. Restent ${rows.length}. Non classées : ${unmatched.length}.`, "",
  "| Mécanisme | Brique | Capacités | Créatures |", "|---|---|---|---|"];
const summary = MECHS.map(([k, label, brick]) => {
  const l = byMech.get(k);
  return { k, label, brick, count: l.length, reach: new Set(l.flatMap(r => r.owners ? [] : [])).size, sum: l.reduce((s, r) => s + r.n, 0) };
}).sort((a, b) => b.sum - a.sum);
for (const s of summary) out.push(`| ${s.label} | ${s.brick} | ${s.count} | ${s.sum} |`);
out.push("");
for (const s of summary) {
  out.push(`## ${s.label} — ${s.brick} (${s.count})`, ...byMech.get(s.k).sort((a, b) => b.n - a.n).map(line), "");
}
out.push(`## Non classées (${unmatched.length})`, ...unmatched.sort((a, b) => b.n - a.n).map(line));
fs.writeFileSync(process.argv[2], out.join("\n"));
console.log(out.slice(0, summary.length + 5).join("\n"));
const tally = arr => Object.entries(arr.reduce((m, k) => (m[k] = (m[k] ?? 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).map(e => e.join(":")).join(" ");
console.log("activation :", tally(rows.flatMap(r => r.act ? r.act.split("/") : ["—"])));
console.log("activités  :", tally(rows.flatMap(r => r.acts ? r.acts.split("+") : ["—"])));
