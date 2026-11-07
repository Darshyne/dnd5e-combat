/**
 * §380 : fonctions de test du débogueur, pour les scénarios (`api.mcp`, connecteur `call-module-api`). Une sonde fait échouer exprès un
 * inscrit du routeur ; `debugReport` rend le rapport tel que la fenêtre le construirait, avec l'adresse GitHub qu'elle ouvrirait.
 */

import { issueUrl, reportJson } from "../core/debug.mjs";
import { buildDebugReport, debugApi, DEBUG_PROBE_HOOK, flush, reportRepos } from "./debug.mjs";
import { gmOnly } from "./testing-shared.mjs";
import { testConnection } from "./connection.mjs";

/** Fait échouer la sonde du routeur (`via: "route"`) ou rejette une promesse non attrapée (`via: "rejection"`). */
export function debugThrow({ message="test", via="route" }={}) {
  gmOnly();
  if ( via === "rejection" ) Promise.reject(new Error(`DAS debug probe: ${message}`));
  else Hooks.callAll(DEBUG_PROBE_HOOK, { message });
  return { total: debugApi.total() };
}

/** Le rapport de ce client (MJ) : groupes relevés, Markdown, longueur du JSON et de l'adresse GitHub, dépôts proposés. */
export function debugReport({ description="", includeNames=false, token=null }={}) {
  gmOnly();
  const doc = token ? canvas.scene?.tokens.get(token) ?? null : null;
  const { report, markdown } = buildDebugReport({ description, includeNames, token: doc });
  const repos = reportRepos(report);
  const url = issueUrl({ repo: repos[0]?.repo, title: "test", body: markdown, note: "(cut)" });
  return {
    total: debugApi.total(),
    errors: report.errors.map(e => ({ sig: e.sig, module: e.module, kind: e.kind, label: e.label, hook: e.hook, count: e.count,
      clients: e.clients, message: e.message, trail: e.trail.length })),
    trail: report.trail.length, context: report.context, environment: { ...report.environment, modules: report.environment.modules?.length },
    markdown, jsonLength: reportJson(report).length, urlLength: url?.length ?? 0, repos: repos.map(r => r.repo)
  };
}

/** Efface ce que ce client a relevé (erreurs, piste, journal). */
export function debugClear() {
  gmOnly();
  debugApi.clear();
  return { total: debugApi.total() };
}

/** Le mode détaillé de ce client, et un envoi immédiat vers le MJ actif (sans effet chez lui). */
export async function debugVerbose({ on }={}) {
  gmOnly();
  const verbose = debugApi.verbose(on);
  await flush();
  return { verbose };
}

/** §388 : le test de connexion d'un joueur connecté, comme l'entrée du menu de la liste des joueurs le lance (sans la fenêtre). */
export async function connectionTest({ userId, count=5 }={}) {
  gmOnly();
  const user = game.users.get(userId) ?? game.users.find(u => u.active && !u.isGM);
  if ( !user ) throw new Error("no connected player");
  const r = await testConnection(user, { count });
  return { role: r.role, pings: r.pings, findings: r.findings, probe: r.probe ? { ...r.probe, settings: r.probe.settings } : null };
}
