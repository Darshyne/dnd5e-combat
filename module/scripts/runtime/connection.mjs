/**
 * §388 : le test de connexion et de compatibilité d'un joueur, en direct — les mesures, sur chaque client.
 *  - Le MJ envoie au client du joueur dix requêtes « ping » (`CONNECTION_PING_QUERY`) l'une après l'autre : temps d'aller-retour
 *    MJ → serveur → joueur → serveur → MJ, et l'horloge du joueur (écart d'horloge).
 *  - Puis une requête « sonde » (`CONNECTION_PROBE_QUERY`) : le client du joueur décrit ce qu'il a chargé et ce qu'il vit — versions,
 *    empreinte du code de chaque module de la suite (cache du navigateur), langue, droit de parcourir les fichiers (Babele), personnage,
 *    fenêtre cachée, son bloqué, Dice So Nice, carte graphique (rapport de support de Foundry), images par seconde mesurées 2 s, scène
 *    vue, erreurs DAS relevées, réglages DAS de cet ordinateur qui diffèrent du défaut.
 *  - Le MJ compare à son propre client (`core/connection.mjs`) et garde le dernier résultat par joueur (joint au rapport de bug).
 * Rien n'est écrit dans le monde ; les noms ne sortent pas (rôles « Player 1 »…).
 */

import { MODULE_ID } from "../constants.mjs";
import { apiShape, browserFamily, browserName, diagnose, fingerprint, pingStats } from "../core/connection.mjs";
import { safeSettings } from "../core/debug.mjs";
import { addReportSection, debugApi, isSuitePackage, roles } from "./debug.mjs";
import { describeRoutes } from "./router.mjs";

export const CONNECTION_PING_QUERY = `${MODULE_ID}.connectionPing`;
export const CONNECTION_PROBE_QUERY = `${MODULE_ID}.connectionProbe`;
export const CONNECTION_CONSENT_QUERY = `${MODULE_ID}.connectionConsent`;
/** Réglage de monde (onglet Avancé) : le test existe. Coupé par défaut ; coupé, les clients refusent ses requêtes. */
export const CONNECTION_SETTING = "connectionTest";
/** Le temps laissé au joueur pour répondre, et la durée de son accord (le test entier tient dedans). */
export const CONSENT_MS = 60000;
export const CONSENT_VALID_MS = 120000;
export const PING_COUNT = 10;
export const FPS_MS = 2000;

const results = new Map();   // userId → dernier résultat
const consent = { until: 0, prompt: null, pending: null };

/** Le test est-il permis dans ce monde ? */
export function connectionTestEnabled() {
  try { return !!game.settings.get(MODULE_ID, CONNECTION_SETTING); } catch { return false; }
}

/** L'interface fournit la fenêtre d'accord (ui/connection-test.mjs) : `async ({ gm }) => "allowed" | "refused" | "timeout"`. */
export function setConsentPrompt(fn) {
  consent.prompt = typeof fn === "function" ? fn : null;
}

/** Chez le joueur : demander son accord (une seule fenêtre à la fois). Accordé, les mesures sont permises pendant `CONSENT_VALID_MS`. */
async function askConsent({ gm=null }={}) {
  if ( !connectionTestEnabled() ) return { answer: "disabled" };
  if ( !consent.prompt ) return { answer: "refused" };
  consent.pending ??= Promise.resolve(consent.prompt({ gm })).catch(() => "refused").finally(() => { consent.pending = null; });
  const answer = await consent.pending;
  if ( answer === "allowed" ) consent.until = Date.now() + CONSENT_VALID_MS;
  return { answer };
}

/** Les mesures ne partent que pendant un accord en cours (une requête envoyée sans passer par la fenêtre est refusée). */
function requireConsent() {
  if ( !connectionTestEnabled() || (Date.now() > consent.until) ) throw new Error("connection test not allowed by this player");
}

/** L'empreinte du code chargé d'un module de la suite : pour le moteur, ses inscriptions au routeur et ses requêtes ; pour un voisin,
 *  la forme de son API publique. Indépendante de la langue. */
export function codeFingerprint(id) {
  if ( id === MODULE_ID ) {
    const routes = Object.entries(describeRoutes()).flatMap(([hook, list]) => list.map(r => `${hook}:${r.label}`));
    const queries = Object.keys(globalThis.CONFIG?.queries ?? {}).filter(k => k.startsWith(`${MODULE_ID}.`));
    return fingerprint([...routes, ...queries]);
  }
  return fingerprint(apiShape(game.modules.get(id)?.api));
}

/** Les modules de la suite actifs sur ce client, avec leur version et l'empreinte de leur code. */
function suiteModules() {
  return Array.from(game.modules).filter(m => m.active && isSuitePackage(m.id))
    .map(m => ({ id: m.id, version: m.version ?? null, code: codeFingerprint(m.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Ce que le client du MJ sert de référence. */
export function referenceClient() {
  return {
    foundry: game.version,
    system: `${game.system.id} ${game.system.version}`,
    language: game.i18n.lang,
    modules: suiteModules(),
    activeModules: Array.from(game.modules).filter(m => m.active).map(m => m.id).sort(),
    viewedScene: game.user.viewedScene ?? null
  };
}

/** Les réglages DAS de cet ordinateur (portée client) qui diffèrent de leur valeur par défaut, simples seulement. */
function clientSettings() {
  const values = {};
  for ( const [id, s] of game.settings.settings ) {
    if ( (s.scope !== "client") || !isSuitePackage(s.namespace) ) continue;
    const type = s.type?.name ?? typeof s.type;
    if ( !["Boolean", "Number", "String"].includes(type) || ((type === "String") && !s.choices) ) continue;
    let value;
    try { value = game.settings.get(s.namespace, s.key); } catch { continue; }
    if ( value !== s.default ) values[id] = value;
  }
  return safeSettings(values);
}

/** Les images par seconde du canevas, moyennées sur `ms`. Fenêtre cachée ou pas de canevas : `null`. */
async function measureFps(ms=FPS_MS) {
  const ticker = globalThis.canvas?.app?.ticker;
  if ( !ticker || document.hidden ) return null;
  let frames = 0;
  const count = () => { frames++; };
  ticker.add(count);
  const t0 = performance.now();
  await new Promise(r => setTimeout(r, ms));
  ticker.remove(count);
  return Math.round(frames * 1000 / (performance.now() - t0));
}

/** Le rapport de support de Foundry (système, navigateur, carte graphique), s'il se lit. */
async function supportReport() {
  try { return await foundry.applications.sidebar.apps.SupportDetails.generateSupportReport(); }
  catch { return {}; }
}

function webgl2() {
  try { return !!document.createElement("canvas").getContext("webgl2"); }
  catch { return null; }
}

function setting(ns, key) {
  try { return game.settings.get(ns, key); } catch { return undefined; }
}

/** Le nombre de fichiers de traduction que le MJ a publiés pour Babele (`null` : Babele absent). */
function babelePublished() {
  if ( !game.modules.get("babele")?.active ) return null;
  const files = setting("babele", "translationFiles");
  return Array.isArray(files) ? files.length : null;
}

/** La sonde : ce client se décrit. `fps: false` : sans la mesure de 2 s. */
export async function probeClient({ fps=true }={}) {
  const support = await supportReport();
  const character = game.user.character;
  const dsn = game.modules.get("dice-so-nice");
  let audioLocked = null;
  try { audioLocked = game.audio?.locked ?? null; } catch { /* absent */ }
  return {
    ...referenceClient(),
    now: Date.now(),
    client: browserName(navigator.userAgentData?.fullVersionList ?? navigator.userAgentData?.brands, navigator.userAgent),
    browserFamily: browserFamily(navigator.userAgent),
    os: support.os ?? null,
    gpu: support.gpu ?? null,
    maxTextureSize: Number.isFinite(support.maxTextureSize) ? support.maxTextureSize : null,
    webgl2: webgl2(),
    performanceMode: support.performanceMode ?? null,
    screen: support.screen ?? `${screen.width} × ${screen.height}`,
    viewport: support.viewport ?? `${innerWidth} × ${innerHeight}`,
    dpr: globalThis.devicePixelRatio ?? null,
    memory: navigator.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency ?? null,
    canvas: !setting("core", "noCanvas") && !!globalThis.canvas?.ready,
    fps: fps ? await measureFps() : null,
    hidden: !!document.hidden,
    focused: document.hasFocus?.() ?? null,
    audioLocked,
    diceSoNice: !!dsn?.active && (setting("dice-so-nice", "enabled") !== false),
    babele: !!game.modules.get("babele")?.active,
    babeleBrowses: game.user.isGM && game.user.can("FILES_BROWSE"),
    babelePublished: babelePublished(),
    character: !character ? "none" : character.isOwner ? "owned" : "notOwned",
    errors: debugApi.total(),
    settings: clientSettings()
  };
}

/**
 * Le test, chez le MJ : allers-retours puis sonde, comparés à son propre client.
 * @param {User|string} target
 * @param {object} [options]
 * @param {number} [options.count]     Nombre d'allers-retours.
 * @param {(step: string) => void} [options.progress]
 */
export async function testConnection(target, { count=PING_COUNT, progress=() => {} }={}) {
  const user = (typeof target === "string") ? game.users.get(target) : target;
  if ( !user?.active ) throw new Error("user not connected");
  const base = { userId: user.id, role: roles().get(user.id) ?? "user", at: Date.now() };
  progress("consent");
  let answer;
  try { answer = (await user.query(CONNECTION_CONSENT_QUERY, { gm: game.user.name }, { timeout: CONSENT_MS + 10000 }))?.answer; }
  catch { answer = "noAnswer"; }
  if ( answer !== "allowed" ) {
    const id = { refused: "refused", timeout: "consentTimeout", disabled: "disabled" }[answer] ?? "noConsent";
    const result = { ...base, pings: null, probe: null, reference: null,
      findings: [{ id, level: (id === "refused") ? "info" : "warn", data: {} }] };
    results.set(user.id, result);
    return result;
  }
  const samples = [];
  for ( let i = 0; i < count; i++ ) {
    progress("ping", i + 1, count);
    const sent = Date.now();
    try {
      const answer = await user.query(CONNECTION_PING_QUERY, {}, { timeout: 5000 });
      samples.push({ sent, received: Date.now(), remote: answer?.now });
    } catch { samples.push({ lost: true }); }
  }
  const pings = pingStats(samples);
  progress("probe");
  let probe = null;
  try { probe = await user.query(CONNECTION_PROBE_QUERY, {}, { timeout: 20000 }); } catch { /* pas de réponse */ }
  const reference = referenceClient();
  // Les erreurs que ce joueur a déjà remontées au MJ actif (§380), si sa propre sonde n'a pas répondu.
  if ( probe && !probe.errors ) probe.errors = debugApi.errors().filter(g => g.clients.includes(user.id)).reduce((n, g) => n + g.count, 0);
  const result = {
    ...base,
    pings, probe, reference,
    findings: diagnose({ pings, probe, reference })
  };
  results.set(user.id, result);
  return result;
}

/** Les derniers résultats, une ligne par joueur testé (pour le rapport de bug) : rôle → aller-retour et constats non « ok ». */
export function lastConnectionTests() {
  const out = {};
  for ( const r of results.values() ) {
    const ping = Number.isFinite(r.pings?.median) ? `ping ${r.pings.median} ms (worst ${r.pings.worst})` : "no answer";
    const issues = r.findings.filter(f => f.level !== "ok").map(f => `${f.level} ${f.id}`);
    out[r.role] = [ping, ...issues].join(" · ");
  }
  return out;
}

/** À `init`, même en veille : le réglage et les trois requêtes auxquelles un client répond (accord, puis mesures sous accord). */
export function registerConnection() {
  game.settings.register(MODULE_ID, CONNECTION_SETTING, {
    name: "DND5ECOMBAT.Reglage.connectionTest.Nom", hint: "DND5ECOMBAT.Reglage.connectionTest.Aide",
    scope: "world", config: true, type: Boolean, default: false
  });
  CONFIG.queries[CONNECTION_CONSENT_QUERY] = data => askConsent(data);
  CONFIG.queries[CONNECTION_PING_QUERY] = () => { requireConsent(); return { now: Date.now() }; };
  CONFIG.queries[CONNECTION_PROBE_QUERY] = () => { requireConsent(); return probeClient(); };
  addReportSection("connection tests", lastConnectionTests);
}
