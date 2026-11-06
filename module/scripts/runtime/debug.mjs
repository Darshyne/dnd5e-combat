/**
 * §380 (issue #36) : le débogueur intégré — la capture, sur chaque client.
 *  - Dès le chargement du script (avant `init`, pour voir aussi les erreurs du démarrage) : `console.error` / `console.warn`
 *    enveloppés, `window` « error » et « unhandledrejection ». Le routeur signale en plus chaque inscrit qui échoue, avec son
 *    libellé et son hook (`noteRouterError`) ; la même erreur n'est alors pas relevée une seconde fois par la console.
 *  - Par défaut, seules les erreurs où un module de la suite apparaît (pile, ou message préfixé « <id> | ») sont gardées
 *    (réglage CLIENT `debugAllModules` : tout). Réglage CLIENT `debugCapture` : coupé, plus rien n'est enveloppé.
 *  - La piste : les 50 derniers gestes DAS de ce client (activités utilisées, résolutions, opérations refusées, tours, scènes),
 *    décrits par identifiants ; chaque nouvelle erreur en fige les 10 derniers. Les voisins y ajoutent les leurs (`api.debug.trail`).
 *  - Mode détaillé (en mémoire, jusqu'au rechargement) : les lignes de console des modules de la suite gardées en plus (300).
 *  - Un client qui n'est pas le MJ actif lui envoie, au plus toutes les 3 s, ce qui est nouveau (requête `DEBUG_QUERY`).
 * Rien n'est écrit dans le monde ; rien ne quitte la table sans un clic dans la fenêtre du rapport (ui/debug-report.mjs, lot 3).
 */

import { MODULE_ID } from "../constants.mjs";
import { attribute, createErrorLog, createRing, errorIn, formatArgs, packagesOfStack } from "../core/debug.mjs";
import { isSuiteTitle } from "../core/settings-layout.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";

export const DEBUG_CAPTURE_SETTING = "debugCapture";
export const DEBUG_ALL_SETTING = "debugAllModules";
export const DEBUG_QUERY = `${MODULE_ID}.debug`;
export const DEBUG_VERBOSE_QUERY = `${MODULE_ID}.debugVerbose`;
export const DEBUG_HOOK = `${MODULE_ID}.debug`;
export const RELAY_MS = 3000;

const SELF_FILE = `${MODULE_ID}/scripts/runtime/debug.mjs`;
const IGNORE = [SELF_FILE, "lib-wrapper"];

const errors = createErrorLog();
const trailRing = createRing(50);
const logRing = createRing(300);
const registered = new Map();     // module → { module, repo, collect }
const listeners = new Set();
const state = { installed: false, enabled: true, all: false, verbose: false, busy: false, pending: [], timer: null, original: null };
let lastRouterError = null;

/* -------------------------------------------- */
/*  Filtre                                      */
/* -------------------------------------------- */

/** Un paquet de la suite : titre « DAS · … » ou inscrit par `api.debug.register`. Avant que les modules soient lus : oui. */
export function isSuitePackage(id) {
  if ( !id || id.startsWith("system:") ) return false;
  if ( (id === MODULE_ID) || registered.has(id) ) return true;
  const modules = globalThis.game?.modules;
  if ( !modules?.get ) return true;
  return isSuiteTitle(modules.get(id)?.title);
}

/** Le préfixe « <id> | » d'un message de console, s'il nomme un module de la suite. */
function prefixed(message) {
  const m = /^([a-z0-9][\w-]*) \|/i.exec(message);
  return m && isSuitePackage(m[1]) ? m[1] : null;
}

/** Une erreur concerne-t-elle la suite ? Le paquet attribué, puis le préfixe du message. */
function concernsSuite(modules, message) {
  return modules.some(isSuitePackage) || !!prefixed(message);
}

/* -------------------------------------------- */
/*  Relevé                                      */
/* -------------------------------------------- */

const userId = () => globalThis.game?.user?.id ?? null;

/**
 * Une erreur relevée sur ce client. Les champs : `{ kind, message, stack, label, hook, module }`.
 * @returns {object|null} le groupe, ou null si l'erreur est hors de la suite (et le réglage ne garde pas tout).
 */
export function recordError({ kind="error", message="", stack="", label=null, hook=null, module=null }) {
  if ( !state.enabled || state.busy ) return null;
  state.busy = true;     // une erreur pendant le relevé (un écouteur) ne boucle pas
  try {
    const modules = packagesOfStack(stack);
    const owner = module ?? attribute(stack, { ignore: IGNORE }) ?? prefixed(message);
    if ( !state.all && !concernsSuite(owner ? [owner, ...modules] : modules, message) ) return null;
    const { group, isNew } = errors.add({ kind, message, stack, label, hook, module: owner, modules, client: userId(),
      trail: trailRing.last(10) });
    for ( const fn of listeners ) {
      try { fn(group, isNew); } catch { /* un écouteur fautif ne casse pas le relevé */ }
    }
    return group;
  } finally { state.busy = false; }
}

/** Appelé par le routeur quand un inscrit échoue : l'erreur avec son libellé et son hook. */
export function noteRouterError(entry, err) {
  lastRouterError = err;
  recordError({ kind: entry.level === "warn" ? "warn" : "error", message: formatArgs([err]), stack: err?.stack ?? "",
    label: entry.label, hook: entry.hook, module: MODULE_ID });
}

/** Appelé par le routeur quand un inscrit annule une opération : un geste de la piste. */
export function noteRefused(entry) {
  trail("refused", `${entry.hook} ← ${entry.label}`);
}

/** Une ligne de console enveloppée. */
function fromConsole(kind, args) {
  const err = errorIn(args);
  if ( err && (err === lastRouterError) ) { lastRouterError = null; return; }   // déjà relevée par le routeur, avec son libellé
  recordError({ kind, message: formatArgs(args), stack: err?.stack ?? new Error().stack ?? "" });
}

/** En mode détaillé, une ligne de console d'un module de la suite. */
function fromLog(args) {
  const message = formatArgs(args);
  const module = prefixed(message);
  if ( module ) logRing.push({ t: Date.now(), client: userId(), module, kind: "log", text: message });
}

/** Un geste de la piste. `text` : des identifiants, jamais un nom. */
export function trail(kind, text="", { module=MODULE_ID }={}) {
  if ( !state.enabled ) return null;
  return trailRing.push({ t: Date.now(), client: userId(), module, kind: String(kind), text: String(text).slice(0, 300) });
}

/* -------------------------------------------- */
/*  Installation                                */
/* -------------------------------------------- */

const onWindowError = event => recordError({ kind: "error", message: formatArgs([event.error ?? event.message]),
  stack: event.error?.stack ?? (event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : "") });
const onRejection = event => {
  const reason = event.reason;
  recordError({ kind: "rejection", message: formatArgs([reason]), stack: reason?.stack ?? "" });
};

/** Enveloppe la console et écoute les erreurs globales. Sans effet si c'est déjà fait. */
export function installCapture(target=globalThis) {
  if ( state.installed || !target.console ) return;
  const c = target.console;
  const original = { error: c.error, warn: c.warn, log: c.log };
  state.original = { target, ...original };
  c.error = function(...args) { original.error.apply(this, args); fromConsole("error", args); };
  c.warn = function(...args) { original.warn.apply(this, args); fromConsole("warn", args); };
  c.log = function(...args) { original.log.apply(this, args); if ( state.verbose ) fromLog(args); };
  target.addEventListener?.("error", onWindowError);
  target.addEventListener?.("unhandledrejection", onRejection);
  state.installed = true;
}

/**
 * Rend la console d'origine. Si un autre module a enveloppé la console après nous (le connecteur), on n'y touche pas : nos
 * enveloppes restent mais ne relèvent plus rien (`enabled` faux).
 */
export function uninstallCapture() {
  if ( !state.installed ) return;
  const { target, error, warn, log } = state.original;
  target.removeEventListener?.("error", onWindowError);
  target.removeEventListener?.("unhandledrejection", onRejection);
  const c = target.console;
  const ours = fn => fn.toString().includes("fromConsole") || fn.toString().includes("fromLog");
  if ( ours(c.error) ) c.error = error;
  if ( ours(c.warn) ) c.warn = warn;
  if ( ours(c.log) ) c.log = log;
  state.installed = false;
}

/* -------------------------------------------- */
/*  Remontée vers le MJ actif                   */
/* -------------------------------------------- */

/** Chez un client qui n'est pas le MJ actif : envoie ce qui est nouveau. Garde l'envoi pour plus tard s'il n'y a pas de MJ. */
export async function flush() {
  const gm = globalThis.game?.users?.activeGM;
  if ( gm?.isSelf ) return false;      // le MJ actif garde tout chez lui
  state.pending = state.pending.concat(errors.delta()).slice(-200);
  if ( !state.pending.length || !gm?.active ) return false;
  const items = state.pending;
  state.pending = [];
  try {
    await gm.query(DEBUG_QUERY, { userId: userId(), items }, { timeout: 10000 });
    return true;
  } catch {
    state.pending = items.concat(state.pending).slice(-200);
    return false;
  }
}

/** Chez le MJ actif : ce qu'un autre client a relevé. */
export function receive({ userId: from, items }={}) {
  if ( !Array.isArray(items) ) return false;
  errors.merge(items.slice(0, 200), from ?? null);
  for ( const fn of listeners ) {
    try { fn(null, true); } catch { /* idem */ }
  }
  return true;
}

/** Le mode détaillé sur ce client. */
export function setVerbose(on) {
  state.verbose = !!on;
  trail("debug", `verbose ${state.verbose ? "on" : "off"}`);
  return state.verbose;
}

/** Le MJ : le mode détaillé chez tous les clients connectés (les autres à la réception de la requête). */
export async function setVerboseEverywhere(on) {
  setVerbose(on);
  const users = (globalThis.game?.users ?? []).filter(u => u.active && !u.isSelf);
  await Promise.allSettled(users.map(u => u.query(DEBUG_VERBOSE_QUERY, { on: !!on }, { timeout: 5000 })));
  return users.length;
}

/* -------------------------------------------- */
/*  Piste : les gestes du moteur                */
/* -------------------------------------------- */

function onUseActivity(activity, usage, results) {
  const item = activity?.item;
  const targets = globalThis.game?.user?.targets?.size ?? 0;
  trail("use", `${identifierOf(item) || item?.type || "?"} · ${activity?.type ?? "?"}${targets ? ` · ${targets} target(s)` : ""}`
    + `${activity?.actor?.type ? ` · ${activity.actor.type}` : ""}`);
}

function onResolution(resolution, event) {
  const n = resolution?.targets?.length ?? 0;
  trail("resolution", [event?.type ?? event, resolution?.step, n ? `${n} target(s)` : null].filter(Boolean).join(" · "));
}

function onCombat(combat, changed) {
  if ( !("turn" in (changed ?? {})) && !("round" in (changed ?? {})) ) return;
  const actor = combat?.combatant?.actor;
  trail("turn", `round ${combat?.round ?? "?"} · turn ${combat?.turn ?? "?"}${actor?.type ? ` · ${actor.type}` : ""}`);
}

function onScene(canvas) {
  const s = canvas?.scene;
  const levels = s?.levels?.size ?? s?.levels?.length ?? 0;
  trail("scene", `grid ${s?.grid?.type ?? "?"} · ${s?.grid?.size ?? "?"} px · ${s?.grid?.distance ?? "?"} ${s?.grid?.units ?? ""}`
    + `${levels ? ` · ${levels} level(s)` : ""}`);
}

/* -------------------------------------------- */
/*  API                                         */
/* -------------------------------------------- */

export const debugApi = Object.freeze({
  /** Un voisin se déclare : `{ module, repo?, collect? }` — `collect()` rend une section d'environnement (valeurs simples). */
  register({ module, repo=null, collect=null }={}) {
    if ( typeof module !== "string" || !module ) return false;
    registered.set(module, { module, repo, collect: typeof collect === "function" ? collect : null });
    return true;
  },
  /** Un geste d'un voisin dans la piste : `trail(module, kind, text)`. */
  trail: (module, kind, text) => trail(kind, text, { module }),
  errors: () => errors.list(),
  total: () => errors.total(),
  trailList: () => trailRing.list(),
  logs: () => logRing.list(),
  registered: () => Array.from(registered.values()),
  verbose: on => (on === undefined ? state.verbose : setVerbose(on)),
  verboseEverywhere: setVerboseEverywhere,
  /** Écouter les nouvelles erreurs (la pastille de l'interface) ; rend une fonction pour arrêter. */
  onError(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  clear() { errors.clear(); trailRing.clear(); logRing.clear(); state.pending = []; },
  get enabled() { return state.enabled; }
});

/** Les sections des voisins, chacune lue à part (une section qui échoue est notée, pas fatale). */
export function collectSections() {
  const out = [];
  for ( const { module, collect } of registered.values() ) {
    if ( !collect ) continue;
    try { out.push({ module, data: collect() ?? {} }); }
    catch(err) { out.push({ module, data: { error: formatArgs([err]) } }); }
  }
  return out;
}

/** Les dépôts connus : ceux des voisins inscrits, puis l'`url` du module.json de chaque module de la suite. */
export function knownRepos() {
  const out = {};
  for ( const mod of globalThis.game?.modules ?? [] ) if ( mod.active && isSuitePackage(mod.id) && mod.url ) out[mod.id] = mod.url;
  for ( const { module, repo } of registered.values() ) if ( repo ) out[module] = repo;
  return out;
}

/* -------------------------------------------- */
/*  Inscription                                 */
/* -------------------------------------------- */

/** À `init`, même en veille et à tout niveau d'automatisation : réglages, requêtes, piste, remontée. */
export function registerDebug() {
  game.settings.register(MODULE_ID, DEBUG_CAPTURE_SETTING, {
    name: "DND5ECOMBAT.Reglage.debugCapture.Nom", hint: "DND5ECOMBAT.Reglage.debugCapture.Aide",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: value => applyCapture(value)
  });
  game.settings.register(MODULE_ID, DEBUG_ALL_SETTING, {
    name: "DND5ECOMBAT.Reglage.debugAllModules.Nom", hint: "DND5ECOMBAT.Reglage.debugAllModules.Aide",
    scope: "client", config: true, type: Boolean, default: false,
    onChange: value => { state.all = !!value; }
  });
  try {
    applyCapture(game.settings.get(MODULE_ID, DEBUG_CAPTURE_SETTING));
    state.all = !!game.settings.get(MODULE_ID, DEBUG_ALL_SETTING);
  } catch { /* réglages illisibles : valeurs par défaut */ }

  CONFIG.queries[DEBUG_QUERY] = data => receive(data);
  CONFIG.queries[DEBUG_VERBOSE_QUERY] = ({ on }={}) => setVerbose(on);

  const opts = label => ({ label: `debug: ${label}`, always: true });
  route("dnd5e.postUseActivity", onUseActivity, opts("use"));
  route(`${MODULE_ID}.resolution`, onResolution, opts("resolution"));
  route("updateCombat", onCombat, opts("turn"));
  route("canvasReady", onScene, opts("scene"));
  route("userConnected", (user, connected) => { if ( connected && user?.isGM ) flush(); }, opts("relay"));
  route("setup", () => Hooks.callAll(DEBUG_HOOK, debugApi), opts("neighbours"));
  route("ready", () => {
    if ( state.timer ) clearInterval(state.timer);
    state.timer = setInterval(() => { if ( state.enabled && !game.users.activeGM?.isSelf ) flush(); }, RELAY_MS);
  }, opts("relay"));
}

function applyCapture(on) {
  state.enabled = !!on;
  if ( state.enabled ) installCapture();
  else uninstallCapture();
}

// Au chargement du script : la capture tourne avant `init` (les erreurs du démarrage). Le réglage la coupe à `init`.
installCapture();
