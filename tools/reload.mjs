#!/usr/bin/env node
/**
 * Le F5 du client du MJ, sans main humaine : `api.mcp.reload` (runtime/testing.mjs) par le connecteur, puis attente du
 * retour du client avec le code frais (`api.mcp.status`, heure de chargement changée). À lancer après tout changement du
 * moteur, avant un scénario :
 *
 *   node tools/reload.mjs && node tools/scenario.mjs entrave
 *
 * Prérequis : le client du MJ a déjà chargé une version qui a `reload` (0.112.0 et plus) — sinon, un F5 à la main.
 * `call-module-api` n'existe que dans un monde où le réglage « Outils de test » du connecteur est activé.
 */

import { connect } from "./lib/connector.mjs";

const MODULE_ID = "dnd5e-combat";
const TIMEOUT_MS = 90000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function engine(mcp, fn) {
  const r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn, args: {}, waitMs: 5000 });
  if ( !r.settled ) throw new Error(`${fn} : pas de réponse`);
  return r.result;
}

try {
  const mcp = await connect();
  const before = await engine(mcp, "status");
  await engine(mcp, "reload");
  process.stdout.write(`F5 du client de ${before.user} (moteur ${before.version})`);
  const until = Date.now() + TIMEOUT_MS;
  let after = null;
  while ( Date.now() < until ) {
    await sleep(2000);
    process.stdout.write(".");
    after = await engine(mcp, "status").catch(() => null);
    if ( after?.ready && (after.bootedAt !== before.bootedAt) ) break;
    after = null;
  }
  if ( !after ) throw new Error(`le client n'est pas revenu en ${TIMEOUT_MS / 1000} s`);
  console.log(` rechargé : moteur ${after.version}${after.activeGM ? "" : " — ATTENTION : ce client n'est pas le MJ actif"}`);
  // Le canevas et les hooks du moteur finissent de s'installer après `ready`.
  await sleep(3000);
} catch(err) {
  console.error(`\nreload : ${err.message}`);
  process.exitCode = 1;
}
