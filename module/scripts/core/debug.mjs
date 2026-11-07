/**
 * §380 (issue #36) : le débogueur intégré — la partie pure. Regrouper les erreurs par signature, attribuer une erreur à un module
 * par sa pile, garder la piste des derniers gestes, nettoyer un rapport de ce qui identifie la table (noms, monde, adresses),
 * l'écrire en Markdown ou en JSON et en tirer l'adresse d'une page GitHub « New issue » pré-remplie.
 * Rien ici ne lit Foundry : l'horloge, les noms et les modules sont donnés.
 */

export const MAX_MESSAGE = 1000;
export const MAX_FRAMES = 15;
export const MAX_GROUPS = 200;
export const TRAIL_SNAPSHOT = 10;

/* -------------------------------------------- */
/*  Piles d'appels                              */
/* -------------------------------------------- */

const FRAME_URL = /(?:https?|file):\/\/|\/(?:modules|systems)\//;
const PACKAGE = /\/(modules|systems)\/([^/?#\s]+)\//;

/** Les lignes d'une pile qui pointent vers un fichier (formats Chrome « at f (url) » et Firefox « f@url »). */
export function stackFrames(stack) {
  if ( typeof stack !== "string" ) return [];
  return stack.split("\n").map(l => l.trim()).filter(l => l && FRAME_URL.test(l));
}

/** Le paquet d'une ligne de pile : `{ type: "module" | "system", id }`, ou null (cœur de Foundry, navigateur). */
export function packageOfFrame(frame) {
  const m = PACKAGE.exec(frame ?? "");
  return m ? { type: m[1] === "systems" ? "system" : "module", id: m[2] } : null;
}

/** Les paquets cités par une pile, dans l'ordre, sans doublon (« system:dnd5e » pour un système). */
export function packagesOfStack(stack) {
  const out = [];
  for ( const frame of stackFrames(stack) ) {
    const p = packageOfFrame(frame);
    if ( !p ) continue;
    const key = p.type === "system" ? `system:${p.id}` : p.id;
    if ( !out.includes(key) ) out.push(key);
  }
  return out;
}

/**
 * Le paquet mis en cause : le premier de la pile qui n'est pas ignoré (le débogueur lui-même, lib-wrapper qui ne fait que relayer).
 * @param {string} stack
 * @param {object} [options]
 * @param {string[]} [options.ignore]  Paquets ou fichiers à sauter (`"lib-wrapper"`, `"dnd5e-combat/scripts/runtime/debug.mjs"`).
 */
export function attribute(stack, { ignore=[] }={}) {
  for ( const frame of stackFrames(stack) ) {
    if ( ignore.some(i => frame.includes(i.includes("/") ? i : `/${i}/`)) ) continue;
    const p = packageOfFrame(frame);
    if ( p ) return p.type === "system" ? `system:${p.id}` : p.id;
  }
  return null;
}

/* -------------------------------------------- */
/*  Messages                                    */
/* -------------------------------------------- */

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Un argument de console en texte : une erreur par « Nom: message », un objet en JSON tronqué. */
export function formatArg(arg) {
  if ( arg instanceof Error ) return `${arg.name}: ${arg.message}`;
  if ( (arg === null) || (arg === undefined) ) return String(arg);
  if ( typeof arg === "object" ) {
    try { return clip(JSON.stringify(arg), 300); }
    catch { return Object.prototype.toString.call(arg); }
  }
  return String(arg);
}

/**
 * Les arguments d'un appel de console en un message, coupé à `MAX_MESSAGE`. Un premier argument chaîne avec des substitutions de
 * console (`%c` styles, `%s` `%d` `%i` `%f` `%o` `%O`) est d'abord rempli : les styles disparaissent, les valeurs prennent leur place
 * (PixiJS écrit « %cPixiJS Deprecation Warning: %c%s », styles, texte).
 */
export function formatArgs(args) {
  const list = Array.from(args ?? []);
  const parts = [];
  if ( (typeof list[0] === "string") && /%[cdifoOs]/.test(list[0]) ) {
    let i = 1;
    parts.push(list[0].replace(/%([%cdifoOs])/g, (whole, k) => {
      if ( k === "%" ) return "%";
      if ( i >= list.length ) return whole;
      const value = list[i++];
      return k === "c" ? "" : formatArg(value);
    }));
    list.splice(0, i);
  }
  parts.push(...list.map(formatArg));
  return clip(parts.join(" ").trim(), MAX_MESSAGE);
}

/** Un texte qui n'est qu'une pile d'appels (lignes « at … » ou « f@url », « Error » en tête au plus) : PixiJS l'écrit seul. */
export function isBareStack(text) {
  const lines = String(text ?? "").split("\n").map(l => l.trim()).filter(Boolean);
  if ( !lines.length ) return false;
  const body = /^Error\b/.test(lines[0]) ? lines.slice(1) : lines;
  return (body.length > 0) && body.every(l => /^at\s/.test(l) || /^[^\s@]*@\S+:\d+:\d+$/.test(l));
}

/** Un avertissement de dépréciation (Foundry « Deprecated since Version », PixiJS « Deprecation Warning », « is deprecated »). */
export const isDeprecation = message => /\bdeprecat/i.test(String(message ?? ""));

/** La première erreur parmi des arguments de console (pour sa pile), sinon null. */
export function errorIn(args) {
  return Array.from(args ?? []).find(a => a instanceof Error) ?? null;
}

/** Hachage FNV-1a 32 bits en hexadécimal : court, stable, sans dépendance. */
export function hash(text) {
  let h = 0x811c9dc5;
  for ( let i = 0; i < text.length; i++ ) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * La signature d'une erreur : son message sans ce qui varie d'une fois à l'autre (identifiants Foundry, nombres) et sa première
 * ligne de pile sans l'adresse du serveur ni la colonne. Deux erreurs de même signature sont « la même » et se comptent.
 */
export function signature({ kind="error", message="", stack="" }={}) {
  const text = String(message).replace(/\b[a-zA-Z0-9]{16}\b/g, "<id>").replace(/\d+(\.\d+)?/g, "#");
  const frame = (stackFrames(stack)[0] ?? "").replace(/(?:https?|file):\/\/[^/\s)]+/g, "").replace(/\?[^:\s)]*/g, "")
    .replace(/:(\d+):\d+(\)?)$/, ":$1$2");
  return hash(`${kind}|${text}|${frame}`);
}

/* -------------------------------------------- */
/*  Anneau et regroupement                      */
/* -------------------------------------------- */

/** Un anneau borné : les `limit` derniers éléments. */
export function createRing(limit=50) {
  let items = [];
  return {
    push(item) {
      items.push(item);
      if ( items.length > limit ) items.splice(0, items.length - limit);
      return item;
    },
    list() { return items.slice(); },
    last(n) { return n > 0 ? items.slice(-n) : []; },
    clear() { items = []; },
    get size() { return items.length; }
  };
}

/**
 * Le journal des erreurs, groupées par signature. Un client joueur en tire un « delta » (les groupes nouveaux ou qui ont compté
 * depuis le dernier envoi) pour le MJ actif, qui le fusionne dans le sien.
 * @param {object} [options]
 * @param {number} [options.limit]  Groupes gardés au plus ; au-delà, les moins récents partent.
 * @param {() => number} [options.now]
 */
export function createErrorLog({ limit=MAX_GROUPS, now=() => Date.now() }={}) {
  let groups = new Map();
  let sent = new Map();       // signature → compte déjà envoyé

  const trim = () => {
    if ( groups.size <= limit ) return;
    const oldest = Array.from(groups.values()).sort((a, b) => a.last - b.last).slice(0, groups.size - limit);
    for ( const g of oldest ) { groups.delete(g.sig); sent.delete(g.sig); }
  };

  const addClient = (group, client) => {
    if ( client && !group.clients.includes(client) ) group.clients.push(client);
  };

  return {
    /**
     * Une erreur relevée. `entry` : `{ kind, message, stack, module, modules, label, hook, client, trail }`.
     * @returns {{ group: object, isNew: boolean }}
     */
    add(entry) {
      const message = clip(String(entry.message ?? ""), MAX_MESSAGE);
      const kind = entry.kind ?? "error";
      const sig = entry.sig ?? signature({ kind, message, stack: entry.stack });
      const t = now();
      let group = groups.get(sig);
      const isNew = !group;
      if ( isNew ) {
        group = { sig, kind, message, stack: stackFrames(entry.stack).slice(0, MAX_FRAMES), module: entry.module ?? null,
          modules: entry.modules ?? packagesOfStack(entry.stack), label: entry.label ?? null, hook: entry.hook ?? null,
          thirdParty: !!entry.thirdParty, deprecation: !!entry.deprecation, count: 0, first: t, last: t, clients: [], trail: (entry.trail ?? []).slice(-TRAIL_SNAPSHOT) };
        groups.set(sig, group);
      }
      group.count += Math.max(1, entry.count ?? 1);
      group.last = t;
      addClient(group, entry.client);
      if ( isNew ) trim();
      return { group, isNew };
    },

    /** Les groupes nouveaux ou qui ont compté depuis le dernier appel, avec `added` (le nombre de fois en plus). */
    delta() {
      const out = [];
      for ( const g of groups.values() ) {
        const added = g.count - (sent.get(g.sig) ?? 0);
        if ( added <= 0 ) continue;
        out.push({ ...g, stack: g.stack.slice(), clients: g.clients.slice(), trail: g.trail.slice(), added });
        sent.set(g.sig, g.count);
      }
      return out;
    },

    /** Un delta venu d'un autre client (côté MJ) : chaque groupe compte `added` fois de plus, et cite ce client. */
    merge(items, client) {
      for ( const item of items ?? [] ) {
        const known = groups.get(item.sig);
        if ( known ) {
          known.count += Math.max(1, item.added ?? 1);
          known.last = now();
          addClient(known, client);
          continue;
        }
        groups.set(item.sig, { sig: item.sig, kind: item.kind ?? "error", message: clip(String(item.message ?? ""), MAX_MESSAGE),
          stack: (item.stack ?? []).slice(0, MAX_FRAMES), module: item.module ?? null, modules: item.modules ?? [],
          label: item.label ?? null, hook: item.hook ?? null, thirdParty: !!item.thirdParty, deprecation: !!item.deprecation,
          count: Math.max(1, item.added ?? 1), first: now(), last: now(),
          clients: client ? [client] : [], trail: (item.trail ?? []).slice(-TRAIL_SNAPSHOT) });
        trim();
      }
    },

    /** Les groupes, les plus récents d'abord. */
    list() { return Array.from(groups.values()).sort((a, b) => b.last - a.last); },
    get(sig) { return groups.get(sig) ?? null; },
    /** Le nombre total d'erreurs relevées (répétitions comprises). */
    total() { return Array.from(groups.values()).reduce((n, g) => n + g.count, 0); },
    clear() { groups = new Map(); sent = new Map(); },
    get size() { return groups.size; }
  };
}

/* -------------------------------------------- */
/*  Confidentialité                             */
/* -------------------------------------------- */

export const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Un nom se masque en mot entier : pas collé à une lettre, un chiffre, un tiret, un souligné ou une barre oblique (l'identifiant d'un
 * module, « darsh-loot », « foundry-connecteur-claude », un chemin), ni précédé d'un point ou suivi d'un point et d'une lettre (un
 * nom de fichier). « Zoé. » en fin de phrase reste un nom.
 */
export const WORD_BEFORE = "(?<![\\p{L}\\p{N}_./-])";
export const WORD_AFTER = "(?![\\p{L}\\p{N}_/-]|\\.\\w)";

/**
 * Les utilisateurs en rôles : le MJ « MJ » (« MJ 2 » s'il y en a plusieurs), les joueurs « Joueur 1 », « Joueur 2 »… dans l'ordre
 * donné. Les libellés sont fournis (langue de l'interface).
 * @param {{ id: string, name: string, isGM: boolean }[]} users
 * @returns {Map<string, string>} id → libellé
 */
export function roleLabels(users, { gm="GM", player="Player" }={}) {
  const out = new Map();
  let gms = 0;
  let players = 0;
  // Numérotés seulement si plusieurs MJ sont connectés (`active`, vrai par défaut) : un compte MJ de test resté hors ligne ne fait pas
  // de l'unique MJ de la partie un « GM 1 ».
  const gmCount = users.filter(u => u.isGM && (u.active ?? true)).length;
  for ( const u of users ) {
    if ( u.isGM ) out.set(u.id, (gmCount > 1) ? `${gm} ${++gms}` : gm);
    else out.set(u.id, `${player} ${++players}`);
  }
  return out;
}

/**
 * Un nettoyeur de texte : les noms donnés (utilisateurs, titre du monde, noms d'acteurs quand on ne les veut pas) remplacés par
 * leur libellé, les adresses réduites à leur chemin (l'hôte d'une partie Forge nomme la partie), sans paramètres de requête, le
 * dossier de compte Forge masqué, les clés et jetons visibles effacés.
 * @param {object} [options]
 * @param {Array<[string, string]>} [options.names]  Paires [texte à masquer, remplacement]. Les textes de moins de 3 lettres sont ignorés.
 */
export function createScrubber({ names=[] }={}) {
  const pairs = names.filter(([text]) => (typeof text === "string") && (text.trim().length >= 3))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([text, by]) => [new RegExp(`${WORD_BEFORE}${escapeRegExp(text.trim())}${WORD_AFTER}`, "giu"), by]);
  return text => {
    if ( typeof text !== "string" ) return text;
    let out = text
      .replace(/assets\.forge-vtt\.com\/[^/\s"')]+\//g, "assets.forge-vtt.com/<account>/")
      .replace(/(?:https?|wss?):\/\/(?!assets\.forge-vtt\.com)[^/\s"')]+/g, "")
      .replace(/(\.[a-z0-9]{1,5})\?[^\s"'):]*/gi, "$1")
      .replace(/\b(api[-_]?key|token|password|secret|session)(["']?\s*[:=]\s*["']?)[^\s"',;&)]+/gi, "$1$2<hidden>");
    for ( const [re, by] of pairs ) out = out.replace(re, by);
    return out;
  };
}

/** Nettoie toutes les chaînes d'une valeur (objets et tableaux parcourus), sans toucher aux clés. */
export function scrubDeep(value, scrub) {
  if ( typeof value === "string" ) return scrub(value);
  if ( Array.isArray(value) ) return value.map(v => scrubDeep(v, scrub));
  if ( value && (typeof value === "object") ) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, scrub)]));
  }
  return value;
}

/**
 * Les réglages qu'un rapport peut montrer : booléens, nombres finis et chaînes courtes sans espace (un choix : « full », « 2024 »).
 * Les objets, les listes et le texte libre (notes, factions, signalements) n'y vont jamais.
 * @param {Record<string, unknown>} values
 * @param {object} [options]
 * @param {string[]} [options.exclude]  Clés à ne jamais montrer, même simples.
 */
export function safeSettings(values, { exclude=[] }={}) {
  const out = {};
  for ( const [key, v] of Object.entries(values ?? {}) ) {
    if ( exclude.includes(key) ) continue;
    if ( (typeof v === "boolean") || ((typeof v === "number") && Number.isFinite(v)) ) out[key] = v;
    else if ( (typeof v === "string") && (v.length <= 40) && !/\s/.test(v) ) out[key] = v;
  }
  return out;
}

/* -------------------------------------------- */
/*  Le rapport                                  */
/* -------------------------------------------- */

export const REPORT_SCHEMA = 1;

/**
 * Le rapport, nettoyé. Les erreurs gardées sont celles dont la signature est dans `selected` (toutes si absent).
 * @param {object} input
 * @param {string} [input.description]
 * @param {object} [input.environment]   Versions, modules, réglages, client, scène (déjà simples).
 * @param {object[]} [input.errors]      Groupes du journal.
 * @param {string[]} [input.selected]    Signatures retenues.
 * @param {object[]} [input.trail]       Les derniers gestes.
 * @param {object[]} [input.flagged]     Items signalés `{ identifier, note }`.
 * @param {object[]} [input.sections]    Sections des modules voisins `{ module, data }`.
 * @param {object} [input.context]       Le contexte d'un token (menu contextuel).
 * @param {number} input.now
 * @param {(text: string) => string} [scrub]
 */
export function buildReport(input, scrub=t => t) {
  const now = input.now;
  const selected = input.selected ? new Set(input.selected) : null;
  const ago = t => (Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 100) / 10) : null);
  const step = s => ({ ago: ago(s.t), client: s.client ?? null, module: s.module ?? null, kind: s.kind, text: s.text ?? "" });
  const errors = (input.errors ?? []).filter(g => !selected || selected.has(g.sig)).map(g => ({
    sig: g.sig, kind: g.kind, module: g.module, modules: g.modules ?? [], label: g.label, hook: g.hook, message: g.message,
    thirdParty: !!g.thirdParty, deprecation: !!g.deprecation, count: g.count, firstAgo: ago(g.first), lastAgo: ago(g.last), clients: g.clients ?? [], stack: g.stack ?? [],
    trail: (g.trail ?? []).map(step)
  }));
  const report = {
    schema: REPORT_SCHEMA,
    generated: new Date(now).toISOString(),
    description: input.description ?? "",
    environment: input.environment ?? {},
    context: input.context ?? null,
    errors,
    trail: (input.trail ?? []).map(step),
    flagged: input.flagged ?? [],
    sections: input.sections ?? []
  };
  return scrubDeep(report, scrub);
}

const fence = text => String(text).replace(/```/g, "ˋˋˋ");
const line = text => fence(String(text ?? "")).replace(/\s*\n\s*/g, " ");

export const MARKDOWN_LABELS = {
  description: "Description", noDescription: "(none)", environment: "Environment", context: "Token context", errors: "Errors",
  noErrors: "No error recorded.", trail: "Recent DAS actions", flagged: "Flagged items", sections: "Modules",
  times: "×", clients: "clients", hook: "hook", lastSeen: "last", ago: "ago", before: "Before this error",
  settings: "DAS settings changed from their default", others: "Other modules (not DAS)",
  othersHint: "Raised by modules outside the suite; kept because « all modules » is ticked in the DAS debugger.",
  deprecation: "deprecation"
};

/** Une durée écoulée lisible : « 12 s », « 47 min », « 2 h 05 ». */
export function formatAgo(seconds) {
  if ( !Number.isFinite(seconds) ) return "?";
  const s = Math.max(0, Math.round(seconds));
  if ( s < 60 ) return `${s} s`;
  if ( s < 3600 ) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

/**
 * Le titre d'une erreur : la première ligne de son message, sans le « Error: » que le type dit déjà, coupée à un mot sous `max`.
 * @returns {{ title: string, whole: boolean }}  `whole` : le titre dit tout le message (inutile de le répéter en bloc).
 */
export function errorTitle(message, max=120) {
  const text = String(message ?? "").trim();
  const first = text.split("\n")[0].replace(/^(?:Uncaught\s+)?Error:\s*/, "").trim();
  let title = first;
  if ( title.length > max ) {
    const cut = title.lastIndexOf(" ", max - 1);
    title = `${title.slice(0, cut > max / 2 ? cut : max - 1).trimEnd()}…`;
  }
  return { title, whole: (title === first) && !text.includes("\n") };
}

const value = v => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

/** Une liste « - clé : valeur » d'un objet plat ou presque (les sous-objets en JSON compact). */
function bullets(obj, indent="") {
  return Object.entries(obj ?? {}).filter(([, v]) => (v !== undefined) && (v !== null) && (v !== ""))
    .map(([k, v]) => `${indent}- **${k}**: ${line(value(v))}`);
}

const stepLine = (s, L) => `- ${formatAgo(s.ago)} ${L.ago} · ${[s.client, s.module, s.kind].filter(Boolean).join(" · ")} — ${line(s.text)}`;

/** Le rapport en Markdown (GitHub, Discord). Les titres sont donnés ; par défaut en anglais, la langue des issues. */
export function reportMarkdown(report, labels={}) {
  const L = { ...MARKDOWN_LABELS, ...labels };
  const out = [];
  out.push(`## ${L.description}`, "", report.description?.trim() ? fence(report.description.trim()) : L.noDescription, "");
  const env = report.environment ?? {};
  out.push(`## ${L.environment}`, "");
  const { modules, settings, ...rest } = env;
  out.push(...bullets(rest));
  if ( modules?.length ) out.push(`- **modules** (${modules.length}): ${modules.map(m => `${m.id} ${m.version ?? ""}`.trim()).join(", ")}`);
  if ( settings && Object.keys(settings).length ) {
    out.push("", `<details><summary>${L.settings} (${Object.keys(settings).length})</summary>`, "", ...bullets(settings), "", "</details>");
  }
  out.push("");
  if ( report.context ) out.push(`## ${L.context}`, "", ...bullets(report.context), "");
  const ours = report.errors.filter(e => !e.thirdParty);
  const others = report.errors.filter(e => e.thirdParty);
  out.push(`## ${L.errors}`, "");
  if ( !ours.length ) out.push(L.noErrors, "");
  for ( const e of ours ) out.push(...errorMarkdown(e, L));
  if ( others.length ) {
    out.push(`## ${L.others}`, "", L.othersHint, "", `<details><summary>${L.others} (${others.length})</summary>`, "");
    for ( const e of others ) out.push(...errorMarkdown(e, L));
    out.push("</details>", "");
  }
  if ( report.trail.length ) out.push(`## ${L.trail}`, "", ...report.trail.map(s => stepLine(s, L)), "");
  if ( report.flagged.length ) out.push(`## ${L.flagged}`, "", ...report.flagged.map(f => `- \`${line(f.identifier)}\`${f.note ? ` — ${line(f.note)}` : ""}`), "");
  if ( report.sections.length ) {
    out.push(`## ${L.sections}`, "");
    for ( const s of report.sections ) out.push(`### ${line(s.module)}`, "", ...bullets(s.data), "");
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Une erreur du rapport en lignes de Markdown : titre, contexte, message entier s'il est long, pile, gestes d'avant. */
function errorMarkdown(e, L) {
  const out = [];
  const head = [e.module ? `[${e.module}]` : null, e.kind, e.deprecation ? L.deprecation : null, `${L.times}${e.count}`]
    .filter(Boolean).join(" ");
  const { title, whole } = errorTitle(e.message);
  out.push(`### ${head} — ${line(title)}`, "");
  const meta = [e.label ? line(e.label) : null, e.hook ? `${L.hook} \`${line(e.hook)}\`` : null,
    e.clients.length ? `${L.clients}: ${e.clients.join(", ")}` : null,
    Number.isFinite(e.lastAgo) ? `${L.lastSeen} ${formatAgo(e.lastAgo)} ${L.ago}` : null].filter(Boolean);
  if ( meta.length ) out.push(meta.join(" · "), "");
  if ( !whole ) out.push("```", fence(e.message), "```", "");
  if ( e.stack.length ) out.push("```", ...e.stack.map(fence), "```", "");
  if ( e.trail.length ) out.push(`<details><summary>${L.before}</summary>`, "", ...e.trail.map(s => stepLine(s, L)), "", "</details>", "");
  return out;
}

/** Le rapport en JSON lisible (le fichier à joindre). */
export function reportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/* -------------------------------------------- */
/*  GitHub                                      */
/* -------------------------------------------- */

/** « propriétaire/dépôt » d'une adresse GitHub (`url` d'un module.json, avec ou sans `.git`), sinon null. */
export function githubRepo(url) {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Le dépôt à proposer : celui du module le plus mis en cause (erreurs × répétitions) qui a un dépôt GitHub, sinon `fallback`.
 * @param {object[]} errors
 * @param {Record<string, string>} repos  Module → « propriétaire/dépôt ».
 */
export function pickRepo(errors, repos, fallback=null) {
  const score = new Map();
  for ( const e of errors ?? [] ) {
    if ( e.module && repos[e.module] ) score.set(e.module, (score.get(e.module) ?? 0) + (e.count ?? 1));
  }
  const best = Array.from(score.entries()).sort((a, b) => b[1] - a[1])[0];
  return best ? repos[best[0]] : fallback;
}

/** Coupe un texte à une fin de ligne pour que son encodage d'adresse tienne dans `budget`, ferme un bloc de code ouvert, ajoute `note`. */
export function truncateForUrl(text, budget, note="") {
  if ( encodeURIComponent(text).length <= budget ) return text;
  const tail = note ? `\n\n${note}\n` : "\n";
  let cut = text.length;
  let body = text;
  while ( cut > 0 ) {
    cut = Math.floor(cut * 0.9);
    const nl = text.lastIndexOf("\n", cut);
    body = text.slice(0, nl > 0 ? nl : cut);
    if ( ((body.match(/^```/gm) ?? []).length % 2) === 1 ) body += "\n```";
    if ( encodeURIComponent(body + tail).length <= budget ) break;
  }
  return `${body}${tail}`;
}

/**
 * L'adresse de la page « New issue » pré-remplie d'un dépôt. Le corps est coupé pour que l'adresse reste sous `max` caractères
 * (GitHub refuse les adresses trop longues) ; `note` dit alors de joindre le fichier complet.
 */
export function issueUrl({ repo, title="", body="", max=7000, note="" }) {
  if ( !repo ) return null;
  const base = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=`;
  return base + encodeURIComponent(truncateForUrl(body, Math.max(200, max - base.length), note));
}
