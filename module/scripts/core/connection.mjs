/**
 * §388 : le test de connexion et de compatibilité d'un joueur — la partie pure (aucun global Foundry).
 *  - `pingStats` : les allers-retours MJ → joueur → MJ (médiane, pire, irrégularité) et l'écart d'horloge, lu sur l'essai le plus court.
 *  - `fingerprint` / `apiShape` : l'empreinte du code vraiment chargé par un client. Les scripts des modules sont servis sans numéro de
 *    version dans l'adresse : un navigateur peut garder l'ancien code après une mise à jour. Même version annoncée, empreinte
 *    différente : le cache du navigateur.
 *  - `diagnose` : les constats, chacun `{ id, level, data }` (niveaux `ok` < `info` < `warn` < `bad`), traduits par l'interface.
 *  - `connectionMarkdown` : le texte à copier (Discord, issue), avec une fonction de traduction fournie.
 */

import { hash } from "./debug.mjs";

export const LEVELS = Object.freeze(["ok", "info", "warn", "bad"]);

/** Les seuils, en millisecondes sauf mention. */
export const THRESHOLDS = Object.freeze({
  pingWarn: 300, pingBad: 1000,
  jitterWarn: 400,
  clockWarn: 2000, clockBad: 10000,
  fpsWarn: 24, fpsBad: 12,
  textureWarn: 4096
});

/** Les rendus logiciels : pas de carte graphique utilisée (accélération matérielle coupée dans le navigateur). */
export const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|microsoft basic render|software/i;

const median = values => {
  if ( !values.length ) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * Les statistiques des essais. Chaque essai : `{ sent, received, remote }` (horloge du MJ à l'envoi et au retour, horloge du joueur à
 * la réponse) ; un essai perdu : `{ lost: true }`.
 * L'écart d'horloge (joueur − MJ) est lu sur l'essai le plus court, où le milieu de l'aller-retour est le plus sûr.
 */
export function pingStats(samples=[]) {
  const ok = samples.filter(s => !s.lost && Number.isFinite(s.sent) && Number.isFinite(s.received));
  const rtts = ok.map(s => Math.max(0, s.received - s.sent));
  const best = ok.reduce((a, s) => (!a || ((s.received - s.sent) < (a.received - a.sent)) ? s : a), null);
  const med = median(rtts);
  return {
    count: samples.length,
    lost: samples.length - ok.length,
    min: rtts.length ? Math.min(...rtts) : null,
    median: med,
    worst: rtts.length ? Math.max(...rtts) : null,
    jitter: rtts.length ? Math.max(...rtts) - Math.min(...rtts) : null,
    offset: (best && Number.isFinite(best.remote)) ? Math.round(best.remote - ((best.sent + best.received) / 2)) : null
  };
}

/**
 * Les chemins des fonctions d'une API publique, jusqu'à `depth` niveaux (« ui.cost », « rolls.request »…), triés. Seuls les objets
 * simples sont parcourus : une instance (une barre, une fenêtre) porte un état vivant qui change d'un client à l'autre (vu en jeu :
 * `bar.pending`, `bar.popupRef`) et ferait croire à un autre code.
 */
export function apiShape(api, depth=2, prefix="") {
  if ( !api || ((typeof api !== "object") && (typeof api !== "function")) || (depth <= 0) ) return [];
  const out = [];
  for ( const key of Object.keys(api).sort() ) {
    const path = prefix ? `${prefix}.${key}` : key;
    let value;
    try { value = api[key]; } catch { continue; }
    if ( typeof value === "function" ) out.push(path);
    else if ( isPlain(value) ) {
      out.push(path);
      out.push(...apiShape(value, depth - 1, path));
    }
  }
  return out;
}

const isPlain = v => !!v && (typeof v === "object") && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** L'empreinte d'une liste de chaînes (ordre indifférent). Rien à lire : `null`. */
export function fingerprint(parts) {
  if ( !parts?.length ) return null;
  return hash([...parts].map(String).sort().join("\n"));
}

/**
 * Le joueur comparé au MJ : versions, modules actifs, code chargé.
 * @param {object} reference  Ce que le client du MJ dit de lui.
 * @param {object} probe      Ce que le client du joueur dit de lui.
 */
export function compareClients(reference={}, probe={}) {
  const gmMods = new Map((reference.modules ?? []).map(m => [m.id, m]));
  const modules = [];
  for ( const m of probe.modules ?? [] ) {
    const gm = gmMods.get(m.id);
    if ( !gm ) continue;
    const version = (gm.version ?? null) !== (m.version ?? null);
    const code = !version && !!gm.code && !!m.code && (gm.code !== m.code);
    if ( version || code ) modules.push({ id: m.id, gm: gm.version ?? null, player: m.version ?? null, code });
  }
  const gmActive = new Set(reference.activeModules ?? []);
  const playerActive = new Set(probe.activeModules ?? []);
  return {
    foundry: (reference.foundry && probe.foundry && (reference.foundry !== probe.foundry)) ? { gm: reference.foundry, player: probe.foundry } : null,
    system: (reference.system && probe.system && (reference.system !== probe.system)) ? { gm: reference.system, player: probe.system } : null,
    modules,
    missing: [...gmActive].filter(id => !playerActive.has(id)).sort(),
    extra: [...playerActive].filter(id => !gmActive.has(id)).sort()
  };
}

/**
 * Les constats, du plus grave au moins grave (l'ordre de la liste à égalité).
 * @param {object} input
 * @param {object} input.pings      `pingStats(…)`.
 * @param {object} [input.probe]    Ce que le joueur a répondu (absent : il n'a pas répondu).
 * @param {object} [input.reference]
 * @param {object} [input.thresholds]
 */
export function diagnose({ pings, probe=null, reference={}, thresholds=THRESHOLDS }={}) {
  const out = [];
  const add = (id, level, data={}) => out.push({ id, level, data });
  const T = thresholds;

  // Connexion
  if ( !pings?.median && (pings?.median !== 0) ) add("noAnswer", "bad", { lost: pings?.lost ?? 0, count: pings?.count ?? 0 });
  else {
    const level = (pings.median >= T.pingBad) ? "bad" : (pings.median >= T.pingWarn) ? "warn" : "ok";
    add("ping", level, { median: pings.median, worst: pings.worst, min: pings.min });
    if ( pings.jitter >= T.jitterWarn ) add("jitter", "warn", { jitter: pings.jitter, worst: pings.worst });
    if ( pings.lost ) add("lost", "warn", { lost: pings.lost, count: pings.count });
    if ( Number.isFinite(pings.offset) ) {
      const abs = Math.abs(pings.offset);
      const s = Math.round(pings.offset / 100) / 10;
      if ( abs >= T.clockBad ) add("clock", "bad", { seconds: s });
      else if ( abs >= T.clockWarn ) add("clock", "warn", { seconds: s });
    }
  }
  if ( !probe ) {
    if ( pings?.median || (pings?.median === 0) ) add("noProbe", "bad");
    return sortFindings(out);
  }

  // Versions et cache
  const diff = compareClients(reference, probe);
  if ( diff.foundry ) add("foundryVersion", "bad", diff.foundry);
  if ( diff.system ) add("systemVersion", "bad", diff.system);
  const stale = diff.modules.filter(m => !m.code);
  const cached = diff.modules.filter(m => m.code);
  if ( stale.length ) add("moduleVersion", "bad", { modules: stale.map(m => `${m.id} ${m.player ?? "?"} → ${m.gm ?? "?"}`).join(", ") });
  if ( cached.length ) add("browserCache", "bad", { modules: cached.map(m => m.id).join(", ") });
  if ( diff.missing.length || diff.extra.length ) add("moduleSet", "warn", { missing: diff.missing.join(", ") || "—", extra: diff.extra.join(", ") || "—" });
  if ( !stale.length && !cached.length && !diff.foundry && !diff.system ) add("versions", "ok", { count: (probe.modules ?? []).length });

  // Pièges connus
  // Babele (2.9.1) : seul un client MJ avec « Parcourir les fichiers » cherche les traductions ; il en publie la liste (réglages de monde
  // `babele.translationFiles` / `mappingFiles`, à chaque `ready`, dans SA langue). Les autres clients lisent cette liste.
  const published = probe.babele && (probe.babeleBrowses === false);
  if ( published && (probe.babelePublished === 0) ) add("babeleEmpty", "warn");
  if ( probe.language && reference.language && (probe.language !== reference.language) ) {
    add(published ? "babeleLanguage" : "language", "info", { player: probe.language, gm: reference.language });
  }
  if ( probe.hidden ) add("hidden", "warn");
  if ( probe.audioLocked ) add("audioLocked", "warn");
  if ( probe.character === "none" ) add("noCharacter", "info");
  else if ( probe.character === "notOwned" ) add("characterNotOwned", "warn");
  if ( probe.diceSoNice ) add("diceSoNice", "info");

  // Machine et affichage
  if ( probe.gpu && SOFTWARE_GPU.test(probe.gpu) ) add("softwareGpu", "bad", { gpu: probe.gpu });
  if ( probe.webgl2 === false ) add("webgl2", "bad");
  if ( Number.isFinite(probe.maxTextureSize) && (probe.maxTextureSize <= T.textureWarn) ) add("texture", "warn", { size: probe.maxTextureSize });
  if ( probe.canvas === false ) add("noCanvas", "info");
  else if ( (probe.fps === 0) && !probe.hidden ) add("frozen", "warn");
  else if ( Number.isFinite(probe.fps) && !probe.hidden ) {
    const level = (probe.fps < T.fpsBad) ? "bad" : (probe.fps < T.fpsWarn) ? "warn" : "ok";
    add("fps", level, { fps: probe.fps });
  }
  if ( probe.browserFamily && (probe.browserFamily !== "chromium") ) add("browser", "info", { browser: probe.browserFamily });

  // État de jeu
  if ( probe.viewedScene && reference.viewedScene && (probe.viewedScene !== reference.viewedScene) ) add("scene", "info");
  if ( probe.errors > 0 ) add("errors", "warn", { count: probe.errors });

  return sortFindings(out);
}

function sortFindings(list) {
  return list.map((f, i) => ({ f, i })).sort((a, b) => (LEVELS.indexOf(b.f.level) - LEVELS.indexOf(a.f.level)) || (a.i - b.i)).map(x => x.f);
}

/** Le niveau le plus grave d'une liste de constats. */
export function worstLevel(findings=[]) {
  return findings.reduce((w, f) => (LEVELS.indexOf(f.level) > LEVELS.indexOf(w) ? f.level : w), "ok");
}

/** Le nom du navigateur : la marque de `navigator.userAgentData` (sans les marques leurres « Not?A_Brand »), sinon le « user agent ». */
export function browserName(brands=[], userAgent="") {
  const real = (brands ?? []).filter(b => !/not.?a.?brand/i.test(b.brand ?? ""));
  const pick = real.find(b => b.brand !== "Chromium") ?? real[0];
  return pick ? `${pick.brand} ${pick.version}` : userAgent;
}

/** La famille du navigateur, depuis son « user agent » : chromium, firefox, safari ou other. */
export function browserFamily(userAgent="") {
  if ( /firefox\//i.test(userAgent) ) return "firefox";
  if ( /(chrome|chromium|crios|edg|opr|electron)\//i.test(userAgent) ) return "chromium";
  if ( /safari\//i.test(userAgent) ) return "safari";
  return "other";
}

const ICON = { ok: "✅", info: "ℹ️", warn: "⚠️", bad: "❌" };

/**
 * Le texte à copier.
 * @param {object} result  `{ role, at, pings, findings, probe }`.
 * @param {(key: string, data?: object) => string} t  La traduction d'une clé courte (« Titre », « Constat.ping »…).
 */
export function connectionMarkdown(result, t=(key) => key) {
  const lines = [`### ${t("Titre")} — ${result.role ?? "?"}`, ""];
  for ( const f of result.findings ?? [] ) lines.push(`- ${ICON[f.level] ?? "-"} ${t(`Constat.${f.id}`, f.data)}`);
  const p = result.probe;
  if ( p ) {
    lines.push("", `<details><summary>${t("Details")}</summary>`, "", "```");
    const row = (k, v) => { if ( (v !== null) && (v !== undefined) && (v !== "") ) lines.push(`${k}: ${v}`); };
    row("foundry", p.foundry);
    row("system", p.system);
    row("language", p.language);
    row("browser", p.client);
    row("os", p.os);
    row("gpu", p.gpu);
    row("maxTextureSize", p.maxTextureSize);
    row("webgl2", p.webgl2);
    row("performanceMode", p.performanceMode);
    row("fps", p.fps);
    row("screen", p.screen);
    row("viewport", p.viewport);
    row("devicePixelRatio", p.dpr);
    row("memory (GB)", p.memory);
    row("cores", p.cores);
    row("ping (ms)", result.pings ? `min ${result.pings.min} · median ${result.pings.median} · worst ${result.pings.worst} · lost ${result.pings.lost}/${result.pings.count}` : null);
    row("clock offset (ms)", result.pings?.offset);
    row("modules", (p.modules ?? []).map(m => `${m.id} ${m.version ?? "?"}${m.code ? ` [${m.code}]` : ""}`).join(", "));
    const settings = Object.entries(p.settings ?? {});
    if ( settings.length ) row("client settings", settings.map(([k, v]) => `${k}=${v}`).join(", "));
    lines.push("```", "", "</details>");
  }
  return lines.join("\n");
}
