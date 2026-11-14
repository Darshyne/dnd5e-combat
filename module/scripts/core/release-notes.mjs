/**
 * §439 : le message de mise à jour — la partie pure (aucun global Foundry). Les notes elles-mêmes sont des données
 * (`content/releases.mjs`, une entrée par version publiée) ; ici, ce qu'on en tire pour un monde donné :
 *  - `notesBetween` : les notes des versions sorties depuis la dernière vue par le MJ ;
 *  - `lateModules`  : les modules de la suite installés en dessous de la version avec laquelle cette version a été testée ;
 *  - `compatibility`: Foundry, le système et les livres installés face aux versions testées ;
 *  - `activeRisks` / `recommendedChecks` : les risques écrits à la main et les vérifications du diagnostic conseillées, quand leur
 *    condition (`when`) est remplie dans ce monde ;
 *  - `validateReleases` : le garde-fou de release (tests/release-notes.test.mjs).
 *
 * « Installé » (`installed`) : `{ foundry, system, modules: [{ id, title, version, active }] }`, lu par l'interface.
 */

const VERSION = /^\d+(\.\d+)*$/;

const parts = v => String(v ?? "").trim().split(".").map(s => Number.parseInt(s, 10) || 0);

/** Compare deux versions « 0.283.0 », « 14.370 » : négatif si `a` est plus ancienne, 0 si égales, positif si plus récente. */
export function compareVersions(a, b) {
  const pa = parts(a), pb = parts(b);
  for ( let i = 0; i < Math.max(pa.length, pb.length); i++ ) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if ( d ) return d;
  }
  return 0;
}

/**
 * L'écart entre une version installée et la version testée : `null` si égales, sinon `{ way: "older" | "newer", level }`.
 * Seul le dernier nombre diffère (14.370 → 14.371, 6.1.0 → 6.1.2) : un correctif, `info`. Un nombre avant lui : `warn`.
 */
export function versionGap(installed, tested) {
  const diff = compareVersions(installed, tested);
  if ( !diff ) return null;
  const pi = parts(installed), pt = parts(tested);
  const last = Math.max(pi.length, pt.length) - 1;
  let first = 0;
  while ( (pi[first] ?? 0) === (pt[first] ?? 0) ) first++;
  return { way: diff < 0 ? "older" : "newer", level: first < last ? "warn" : "info" };
}

/** La note d'une version exacte, ou `null`. */
export const noteOf = (releases, version) => releases.find(r => r.version === version) ?? null;

/**
 * Les notes à montrer, de la plus récente à la plus ancienne : celles des versions après `seen` jusqu'à `current` comprise.
 * Sans `seen` (ouverture à la main) : les `limit` dernières jusqu'à `current`.
 */
export function notesBetween(releases, { seen=null, current, limit=5 }={}) {
  const upTo = releases.filter(r => compareVersions(r.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  if ( !seen ) return upTo.slice(0, limit);
  return upTo.filter(r => compareVersions(r.version, seen) > 0);
}

/** Les versions testées qui valent pour `current` : celles de la note la plus récente qui ne la dépasse pas. */
export function testedFor(releases, current) {
  return notesBetween(releases, { current, limit: 1 })[0]?.tested ?? null;
}

const activeModule = (installed, id) => (installed?.modules ?? []).find(m => (m.id === id) && m.active) ?? null;

/** Les modules de la suite actifs dans ce monde et plus anciens que la version testée : `[{ id, title, version, tested }]`. */
export function lateModules(tested, installed) {
  const out = [];
  for ( const [id, min] of Object.entries(tested?.modules ?? {}) ) {
    const m = activeModule(installed, id);
    if ( m && (compareVersions(m.version, min) < 0) ) out.push({ id, title: m.title ?? id, version: m.version ?? "?", tested: min });
  }
  return out;
}

/**
 * Foundry, le système et les livres face aux versions testées : `[{ kind: "foundry" | "system" | "book", id?, title, version, tested,
 * way, level }]`, seulement ce qui diffère. Un livre absent ou inactif n'est pas un écart.
 */
export function compatibility(tested, installed) {
  const out = [];
  const add = (kind, title, version, wanted, id) => {
    const gap = (version && wanted) ? versionGap(version, wanted) : null;
    if ( gap ) out.push({ kind, id, title, version, tested: wanted, ...gap });
  };
  add("foundry", "Foundry VTT", installed?.foundry, tested?.foundry);
  add("system", "dnd5e", installed?.system, tested?.system);
  for ( const [id, wanted] of Object.entries(tested?.books ?? {}) ) {
    const m = activeModule(installed, id);
    if ( m ) add("book", m.title ?? id, m.version, wanted, id);
  }
  return out;
}

/**
 * Une condition `when` : `{ module, min?, below? }` (ce module est actif, à partir de `min`, avant `below`) et / ou
 * `{ system: "6.1.0" }` (le système à partir de cette version). Sans condition : toujours vrai.
 */
export function matches(when, installed) {
  if ( !when ) return true;
  if ( when.system && (compareVersions(installed?.system, when.system) < 0) ) return false;
  if ( when.module ) {
    const m = activeModule(installed, when.module);
    if ( !m ) return false;
    if ( when.min && (compareVersions(m.version, when.min) < 0) ) return false;
    if ( when.below && (compareVersions(m.version, when.below) >= 0) ) return false;
  }
  return true;
}

/** Les risques écrits dans ces notes dont la condition est remplie : `[{ id, version }]`, sans doublon. */
export function activeRisks(notes, installed) {
  return unique(notes.flatMap(n => (n.risks ?? []).filter(r => matches(r.when, installed)).map(r => ({ id: r.id, version: n.version }))));
}

/** Les vérifications du diagnostic conseillées par ces notes, dans ce monde : `[{ id, version }]`, sans doublon. */
export function recommendedChecks(notes, installed) {
  return unique(notes.flatMap(n => (n.checks ?? []).filter(c => matches(c.when, installed)).map(c => ({ id: c.id, version: n.version }))));
}

function unique(list) {
  const seen = new Set();
  return list.filter(x => !seen.has(x.id) && seen.add(x.id));
}

/** Tout ce que la fenêtre montre, d'un coup. */
export function releaseReport(releases, { seen=null, current, installed={} }={}) {
  const notes = notesBetween(releases, { seen, current });
  const tested = testedFor(releases, current);
  return {
    current, seen, notes, tested,
    late: lateModules(tested, installed),
    compatibility: compatibility(tested, installed),
    risks: activeRisks(notes, installed),
    checks: recommendedChecks(notes, installed)
  };
}

/** Y a-t-il quelque chose à dire ? (une version sans note et un monde à jour : rien ne s'ouvre.) */
export const hasNews = report => !!(report.notes.length || report.late.length || report.compatibility.length || report.risks.length);

/**
 * Le garde-fou : les défauts de la table des notes, en clair. `version` (celle de `module.json`) doit avoir sa note.
 * @param {object[]} releases
 * @param {object} [options]
 * @param {string} [options.version]      La version du manifeste.
 * @param {string[]} [options.checkIds]   Les vérifications que le diagnostic connaît.
 */
export function validateReleases(releases, { version=null, checkIds=null }={}) {
  const problems = [];
  const ids = new Set();
  if ( !Array.isArray(releases) || !releases.length ) return ["aucune note de version"];
  for ( const r of releases ) {
    const at = `note ${r?.version ?? "?"}`;
    if ( !VERSION.test(r?.version ?? "") ) { problems.push(`${at} : version illisible`); continue; }
    if ( ids.has(r.version) ) problems.push(`${at} : en double`);
    ids.add(r.version);
    if ( !Array.isArray(r.highlights) || !r.highlights.length ) problems.push(`${at} : aucune nouveauté (highlights)`);
    for ( const h of r.highlights ?? [] ) if ( !/^[a-z][A-Za-z0-9]*$/.test(h) ) problems.push(`${at} : nouveauté « ${h} » mal nommée`);
    const t = r.tested;
    if ( !t || !VERSION.test(t.foundry ?? "") || !VERSION.test(t.system ?? "") ) problems.push(`${at} : versions testées de Foundry et du système manquantes (tested)`);
    for ( const [id, v] of [...Object.entries(t?.modules ?? {}), ...Object.entries(t?.books ?? {})] ) {
      if ( !VERSION.test(v ?? "") ) problems.push(`${at} : version testée de ${id} illisible`);
    }
    for ( const risk of r.risks ?? [] ) if ( !/^[a-z][A-Za-z0-9]*$/.test(risk?.id ?? "") ) problems.push(`${at} : risque sans id`);
    for ( const c of r.checks ?? [] ) {
      if ( !c?.id ) problems.push(`${at} : vérification sans id`);
      else if ( checkIds && !checkIds.includes(c.id) ) problems.push(`${at} : vérification « ${c.id} » inconnue du diagnostic`);
    }
  }
  const sorted = [...releases].sort((a, b) => compareVersions(b.version, a.version));
  if ( releases.some((r, i) => r !== sorted[i]) ) problems.push("les notes ne sont pas rangées de la plus récente à la plus ancienne");
  if ( version && !ids.has(version) ) {
    problems.push(`la version ${version} de module/module.json n'a pas sa note de nouveautés → l'ajouter en tête de module/scripts/content/releases.mjs, avec ses textes dans module/lang/ (en, fr, pt-BR)`);
  }
  return problems;
}
