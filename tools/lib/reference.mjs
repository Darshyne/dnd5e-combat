/**
 * Les références générées du moteur (`docs/reference/`) : API publique, hooks, réglages, clés de contenu, scénarios.
 * Rien n'y est écrit à la main : tout est relu dans le code, pour que la référence ne dérive pas.
 *  - L'API, les réglages et les écoutes viennent du module **chargé** hors de Foundry, avec des globals factices (comme
 *    `tests/load.test.mjs`) : l'objet `api` réel, chaque `game.settings.register`, `api.routes()`.
 *  - Les hooks émis, les scénarios et les descriptions viennent d'une lecture du texte des sources.
 * `build()` rend `{ "<fichier>.md": texte }` ; `tools/reference.mjs` les écrit, `tests/reference.test.mjs` les compare.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scenarioMeta } from "./scenario-meta.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPTS = join(ROOT, "module/scripts");
const MODULE_ID = "dnd5e-combat";
const slash = path => path.split("\\").join("/");

/** Tous les `.mjs` d'un dossier, triés, en chemins relatifs à `base`. */
function filesUnder(dir, base=dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const full = join(dir, name);
    if ( statSync(full).isDirectory() ) return filesUnder(full, base);
    return name.endsWith(".mjs") ? [slash(relative(base, full))] : [];
  });
}

const cell = text => String(text ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const clip = (text, max=220) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const sections = text => [...new Set(text.match(/§\d+(?:\.\d+)*/g) ?? [])];

/** Le commentaire qui précède `index` dans `text` (bloc `/** … *\/` ou lignes `//`), nettoyé, ou "". */
function commentBefore(text, index) {
  const before = text.slice(0, index).replace(/[ \t]*$/, "");
  const block = before.match(/\/\*\*?((?:(?!\*\/)[\s\S])*)\*\/\s*$/);
  if ( block ) return block[1].split("\n").map(line => line.replace(/^\s*\*?\s?/, "")).join(" ").replace(/\s+/g, " ").trim();
  const lines = [];
  // `index` est souvent un début de ligne : le saut de ligne qui le précède ne compte pas comme une ligne vide.
  for ( const line of before.replace(/\r?\n$/, "").split("\n").reverse() ) {
    const found = line.match(/^\s*\/\/\s?(.*)$/);
    if ( !found ) break;
    lines.unshift(found[1]);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ le module chargé ---- */

let loaded = null;

/** Charge le module avec des globals factices et rend `{ api, settings, routes }`. Une seule fois par processus. */
async function load() {
  if ( loaded ) return loaded;
  const hooks = {};
  const once = {};
  const holder = {};
  const settings = [];
  const same = fn => fn;
  const caller = () => new Error().stack.split("\n").map(line => line.match(/module[\\/]scripts[\\/]([^:)?]+\.mjs)/)?.[1]).find(Boolean)?.split("\\").join("/") ?? "?";
  const saved = { Hooks: globalThis.Hooks, foundry: globalThis.foundry, game: globalThis.game, CONFIG: globalThis.CONFIG };
  globalThis.Hooks = { on: (h, f) => (hooks[h] ??= []).push(f), once: (h, f) => (once[h] ??= []).push(f), callAll() {}, call() { return true; } };
  globalThis.foundry = { utils: { throttle: same, debounce: same, isNewerVersion: () => false } };
  globalThis.game = {
    modules: { get: id => (id === MODULE_ID ? holder : null) },
    system: { version: "6.0.6" }, users: {},
    settings: { register(namespace, key, data) { settings.push({ namespace, key, data, file: caller() }); }, get() { return undefined; } }
  };
  globalThis.CONFIG = { queries: {}, DND5E: { statusEffects: {} } };
  const log = console.log;
  console.log = () => {};
  try {
    await import(pathToFileURL(join(SCRIPTS, "dnd5e-combat.mjs")).href);
    (once.init ?? []).forEach(fn => fn());
  }
  finally { console.log = log; }
  loaded = { api: holder.api, settings, routes: holder.api.routes() };
  for ( const [key, value] of Object.entries(saved) ) if ( value !== undefined ) globalThis[key] = value;
  return loaded;
}

/* ------------------------------------------------------------------ lecture des sources ---- */

/** Le texte entre la parenthèse ouvrante en `open` et sa fermante, espaces réduits. */
function balanced(text, open) {
  let depth = 0;
  for ( let i = open; i < text.length; i++ ) {
    if ( "([{".includes(text[i]) ) depth += 1;
    else if ( ")]}".includes(text[i]) && (--depth === 0) ) return text.slice(open, i + 1).replace(/\s+/g, " ");
  }
  return "(…)";
}

/** `{ files: { chemin: texte }, definitions: { nom: [{ file, doc, params }] }, constants: { NOM: "dnd5e-combat.x" } }`. */
function scanSources() {
  const files = Object.fromEntries(filesUnder(SCRIPTS).map(file => [file, readFileSync(join(SCRIPTS, file), "utf8")]));
  const definitions = {};
  const constants = {};
  for ( const [file, text] of Object.entries(files) ) {
    for ( const found of text.matchAll(/^(export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)\s*\(/gm) )
      (definitions[found[2]] ??= []).push({ file, exported: !!found[1], doc: commentBefore(text, found.index),
        signature: balanced(text, found.index + found[0].length - 1) });
    for ( const found of text.matchAll(/^(export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z0-9_$]+\s*=>)/gm) )
      (definitions[found[2]] ??= []).push({ file, exported: !!found[1], doc: commentBefore(text, found.index) });
    for ( const found of text.matchAll(/^(?:export\s+)?const\s+([A-Z0-9_]+)\s*=\s*(?:`\$\{MODULE_ID\}\.([A-Za-z0-9]+)`|"dnd5e-combat\.([A-Za-z0-9]+)")/gm) )
      (constants[found[1]] ??= []).push({ file, name: found[2] ?? found[3], doc: commentBefore(text, found.index) });
  }
  return { files, definitions, constants };
}

/* ------------------------------------------------------------------ API ---- */

const signature = fn => {
  // Sous vitest, un import devient `__vite_ssr_import_N__.NOM` dans le texte de la fonction : on rend le nom d'origine.
  const source = Function.prototype.toString.call(fn).replace(/__vite_ssr_import_\d+__\./g, "");
  const open = source.indexOf("(");
  if ( (open < 0) || (open > source.indexOf("=>") && source.includes("=>") && !/^(async\s+)?function/.test(source)) ) {
    const arrow = source.match(/^(?:async\s+)?([A-Za-z0-9_$]+)\s*=>/);
    return arrow ? `(${arrow[1]})` : "()";
  }
  let depth = 0;
  for ( let i = open; i < source.length; i++ ) {
    if ( "([{".includes(source[i]) ) depth += 1;
    else if ( ")]}".includes(source[i]) && (--depth === 0) ) return source.slice(open, i + 1).replace(/\s+/g, " ");
  }
  return "(…)";
};

/**
 * Où une fonction de l'API est écrite : on cherche son texte exact (`Function#toString`) dans les sources. C'est ce qui retrouve une
 * fonction fléchée ou une méthode écrite en ligne dans un objet (`clear() { … }`, `options: item => …`), dont le nom n'est que la
 * clé et que la recherche par nom confondait avec une homonyme d'un autre fichier. Plusieurs endroits au même texte : celui qui est
 * écrit sous la même clé. La description est le commentaire qui précède la ligne, seulement si la fonction est la première chose de
 * cette ligne (sinon le commentaire parlerait d'une autre propriété) : une fonction écrite en ligne prend une ligne à elle.
 * @returns {{file: string, doc: string}|null}  null : texte introuvable (fonction liée ou fabriquée) — on se rabat sur le nom.
 */
function locate(fn, key, sources) {
  const raw = Function.prototype.toString.call(fn);
  if ( (raw.length < 8) || raw.includes("[native code]") ) return null;
  // Sous vitest, un import devient `__vite_ssr_import_N__.NOM` (`(0, __vite_ssr_import_N__.NOM)` dans un appel), où NOM est le nom
  // exporté et non l'alias du fichier (`reports as itemReports`) : ces morceaux valent « un nom quelconque » dans la recherche, pour que
  // `npm run reference` (node) et `npm test` (vitest) retrouvent le même endroit.
  const parts = raw.split(/\(0\s*,\s*__vite_ssr_import_\d+__\.[A-Za-z0-9_$]+\)|__vite_ssr_import_\d+__\.[A-Za-z0-9_$]+|__vite_ssr_import_meta__|__vite_ssr_dynamic_import__/);
  const longest = parts.reduce((a, b) => (b.length > a.length ? b : a), "");
  const pattern = (parts.length > 1)
    // Le texte trouvé doit finir là où finit la fonction : `() => x()` ne doit pas tomber dans `() => y().z`.
    ? new RegExp(`${parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[A-Za-z0-9_$.]+")}(?![A-Za-z0-9_$.(\\[])`, "g") : null;
  const text = parts.length > 1 ? null : raw;
  const hits = [];
  for ( const [file, source] of Object.entries(sources.files) ) {
    if ( text ) {
      for ( let at = source.indexOf(text); at >= 0; at = source.indexOf(text, at + 1) ) hits.push({ file, source, at });
    }
    else if ( source.includes(longest) ) for ( const found of source.matchAll(pattern) ) hits.push({ file, source, at: found.index });
  }
  if ( !hits.length ) return null;
  // Sous la même clé (ou le même nom) : `clé: …`, `const clé = …`, `clé(…) {`, `function clé(`.
  const names = [...new Set([key, fn.name].filter(Boolean))].map(n => n.replace(/\$/g, "\\$")).join("|");
  const keyed = new RegExp(`(?:^|[^A-Za-z0-9_$.])(?:(?:const|let|var)\\s+)?(?:${names})\\s*[:=]\\s*$`);
  const own = new RegExp(`^(?:async\\s+)?(?:function\\s*\\*?\\s*)?(?:${names})\\s*\\(`);
  const underKey = hit => own.test(raw) || keyed.test(hit.source.slice(Math.max(0, hit.at - 80), hit.at));
  // Un motif à noms réécrits (vitest) peut tomber sur un autre texte de même forme : sans la clé, il faut qu'il soit seul.
  const hit = hits.find(underKey) ?? ((text || (hits.length === 1)) ? hits[0] : null);
  if ( !hit ) return null;
  const lineStart = hit.source.lastIndexOf("\n", hit.at) + 1;
  const prefix = hit.source.slice(lineStart, hit.at);
  const first = /^\s*(?:export\s+)?(?:(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*|[A-Za-z0-9_$]+\s*:\s*|static\s+)?$/.test(prefix);
  return { file: hit.file, doc: first ? commentBefore(hit.source, lineStart) : "" };
}

function apiRows(api, sources) {
  const rows = [];
  const walk = (value, path, depth) => {
    for ( const key of Object.keys(value) ) {
      const item = value[key];
      const here = [...path, key];
      if ( typeof item === "function" ) {
        const candidates = sources.definitions[item.name] ?? [];
        const sign = signature(item);
        const definition = locate(item, key, sources)
          ?? candidates.find(c => c.signature === sign) ?? ((candidates.length === 1) ? candidates[0] : null);
        rows.push({ path: here.join("."), kind: "fonction", signature: sign, internal: item.name,
          file: definition?.file ?? (candidates.length ? "" : "dnd5e-combat.mjs"), doc: definition?.doc ?? "" });
      }
      else if ( item && (typeof item === "object") && !Array.isArray(item) && (depth < 3) && Object.values(item).some(v => typeof v === "function") ) walk(item, here, depth + 1);
      else {
        const kind = (item === null) ? "valeur" : Array.isArray(item) ? `liste (${item.length})` : (typeof item === "object") ? `données (${Object.keys(item).length} clés)` : typeof item;
        rows.push({ path: here.join("."), kind, signature: "", internal: "", file: "", doc: "" });
      }
    }
  };
  walk(api, [], 0);
  return rows;
}

function apiPage(api, sources) {
  const rows = apiRows(api, sources);
  const groups = new Map();
  for ( const row of rows ) {
    const head = row.path.includes(".") ? row.path.split(".")[0] : "(racine)";
    if ( !groups.has(head) ) groups.set(head, []);
    groups.get(head).push(row);
  }
  const order = [...groups.keys()].sort((a, b) => (a === "(racine)" ? -1 : b === "(racine)" ? 1 : a.localeCompare(b)));
  const out = [
    "# API publique — `game.modules.get(\"dnd5e-combat\").api`",
    "",
    GENERATED,
    "",
    `${rows.filter(r => r.kind === "fonction").length} fonctions dans ${order.length} groupes, relevées sur l'objet réel du module chargé. La description est le`,
    "commentaire de la fonction dans le code (début seulement) ; le fichier est relatif à `module/scripts/`. Les valeurs non",
    "fonctions (`active`, `reason`…) sont l'état du module. `mcp` : fonctions de test du connecteur, MJ seulement.",
    ""
  ];
  for ( const head of order ) {
    out.push(`## \`${head === "(racine)" ? "api" : `api.${head}`}\``, "", "| Chemin | Signature | Fichier | Description |", "|---|---|---|---|");
    for ( const row of groups.get(head).sort((a, b) => a.path.localeCompare(b.path)) ) {
      const sign = (row.kind === "fonction") ? `\`${cell(row.signature)}\`` : `_${row.kind}_`;
      out.push(`| \`api.${row.path}\` | ${sign} | ${row.file ? `\`${row.file}\`` : ""} | ${cell(clip(row.doc))} |`);
    }
    out.push("");
  }
  return { text: out.join("\n"), paths: rows.map(r => r.path).sort() };
}

/* ------------------------------------------------------------------ hooks ---- */

function emittedHooks(sources) {
  const found = new Map();
  const note = (name, entry) => { if ( !found.has(name) ) found.set(name, []); found.get(name).push(entry); };
  for ( const [file, text] of Object.entries(sources.files) ) {
    for ( const call of text.matchAll(/Hooks\.(callAll|call)\(\s*(`\$\{MODULE_ID\}\.([A-Za-z0-9]+)`|"dnd5e-combat\.([A-Za-z0-9]+)"|`\$\{MODULE_ID\}\.\$\{[^}]+\}`|"([a-z0-9]+\.[A-Za-z0-9.]+)"|([A-Za-z_$][A-Za-z0-9_$]*))/g) ) {
      const cancellable = call[1] === "call";
      const lineStart = text.lastIndexOf("\n", call.index) + 1;
      const line = text.slice(lineStart, text.indexOf("\n", call.index));
      const doc = commentBefore(text, lineStart);
      // Les arguments passés aux écouteurs : tout ce qui suit le nom du hook dans l'appel.
      const all = balanced(text, call.index + call[0].indexOf("("));
      const first = call[2].replace(/\s+/g, " ");
      const rest = all.slice(1, -1).replace(/\s+/g, " ").slice(first.length).replace(/^\s*,\s*/, "");
      const entry = { file, cancellable, doc, line, args: rest };
      if ( call[3] || call[4] ) note(`${MODULE_ID}.${call[3] ?? call[4]}`, entry);
      else if ( call[5] ) note(call[5], entry);
      else if ( call[6] ) {
        const constant = (sources.constants[call[6]] ?? []).find(c => c.file === file) ?? sources.constants[call[6]]?.[0];
        if ( constant ) note(`${MODULE_ID}.${constant.name}`, { ...entry, constantDoc: constant.doc });
        else {
          // Un nom de hook tenu dans une variable locale : les noms `${MODULE_ID}.x` écrits dans les lignes qui précèdent.
          const above = text.slice(0, call.index).split("\n").slice(-12).join("\n");
          const names = [...above.matchAll(/`\$\{MODULE_ID\}\.([A-Za-z0-9]+)`/g)].map(found => found[1]);
          if ( names.length ) for ( const name of new Set(names) ) note(`${MODULE_ID}.${name}`, entry);
          else note(`(nom non résolu : ${call[6]})`, entry);
        }
      }
      else {
        // Un nom composé (`${MODULE_ID}.${name}`) dans une fonction d'aide : les noms que le fichier lui passe en clair.
        const helpers = [...text.slice(0, call.index).matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)];
        const helper = helpers.length ? helpers[helpers.length - 1][1] : null;
        // La description d'un tel nom : le commentaire qui précède la ligne où le fichier le passe à la fonction d'aide.
        const uses = helper ? [...text.matchAll(new RegExp(`\\b${helper.replace(/\$/g, "\\$")}\\(\\s*"([A-Za-z0-9]+)"`, "g"))] : [];
        const names = uses.map(found => found[1]);
        const docOf = name => uses.filter(u => u[1] === name).map(u => commentBefore(text, text.lastIndexOf("\n", u.index) + 1)).find(Boolean) ?? "";
        if ( names.length ) for ( const name of new Set(names) ) note(`${MODULE_ID}.${name}`, { ...entry, doc: docOf(name) });
        else note(`${MODULE_ID}.<moment>`, entry);
      }
    }
  }
  return found;
}

/**
 * La description d'un hook émis. Une seule fait foi : celle de la constante qui nomme le hook, sinon celle du premier point
 * d'émission (fichiers dans l'ordre alphabétique, puis l'ordre du texte) qui en a une.
 */
const hookDoc = entries => entries.map(e => e.constantDoc).find(Boolean) ?? entries.map(e => e.doc).find(Boolean) ?? "";

async function hooksPage(routes, sources) {
  const { MOMENTS } = await import(pathToFileURL(join(SCRIPTS, "core/triggers.mjs")).href);
  const emitted = emittedHooks(sources);
  const own = [...emitted.keys()].filter(name => name.startsWith(`${MODULE_ID}.`) && !name.includes("<")).sort();
  const foreign = [...emitted.keys()].filter(name => !name.startsWith(`${MODULE_ID}.`) && !name.startsWith("(")).sort();
  const out = [
    "# Hooks",
    "",
    GENERATED,
    "",
    "## Hooks émis par le moteur",
    "",
    `${own.length} hooks \`dnd5e-combat.*\`, relevés sur chaque \`Hooks.call\` / \`Hooks.callAll\` du code. **Annulable** : émis par`,
    "`Hooks.call` — un écouteur qui rend `false` arrête la suite. La description est le commentaire placé juste avant la constante",
    "qui nomme le hook, sinon juste avant la ligne d'émission (la première qui en a un) ; les § renvoient au journal.",
    "",
    "| Hook | Annulable | Arguments | Émis dans | § | Description |",
    "|---|---|---|---|---|---|"
  ];
  for ( const name of own ) {
    const entries = emitted.get(name);
    const files = [...new Set(entries.map(e => e.file))].sort();
    const doc = hookDoc(entries);
    const refs = [...new Set(entries.flatMap(e => sections(`${e.constantDoc ?? ""} ${e.doc} ${e.line}`)))];
    const args = [...new Set(entries.map(e => e.args).filter(Boolean))].map(a => `\`${cell(clip(a, 90))}\``).join("<br>");
    out.push(`| \`${name}\` | ${entries.some(e => e.cancellable) ? "oui" : ""} | ${args} | ${files.map(f => `\`${f}\``).join(", ")} | ${refs.join(" ")} | ${cell(clip(doc))} |`);
  }
  const unresolved = [...emitted.keys()].filter(name => name.startsWith("("));
  if ( unresolved.length ) out.push("", `Non résolus (à nommer par une constante) : ${unresolved.join(", ")}.`);
  out.push("", "## Moments", "",
    "Chaque moment de `core/triggers.mjs` (`MOMENTS`) est publié par `announce()` en `dnd5e-combat.<moment>` (`Hooks.callAll`, avec le",
    "contexte du moment) et sert de clé `on` aux déclarations de contenu.", "", "| Moment | Sens |", "|---|---|");
  for ( const [moment, meaning] of Object.entries(MOMENTS) ) out.push(`| \`${moment}\` | ${cell(meaning)} |`);
  out.push("", "## Hooks d'autres espaces émis par le moteur", "", "| Hook | Annulable | Émis dans |", "|---|---|---|");
  for ( const name of foreign ) {
    const entries = emitted.get(name);
    out.push(`| \`${name}\` | ${entries.some(e => e.cancellable) ? "oui" : ""} | ${[...new Set(entries.map(e => e.file))].sort().map(f => `\`${f}\``).join(", ")} |`);
  }
  const names = Object.keys(routes).sort();
  out.push("", "## Hooks écoutés, dans l'ordre d'appel", "",
    `${names.length} hooks, relevés par \`api.routes()\` sur le module chargé au niveau d'automatisation « full ». Un seul écouteur par hook`,
    "(`runtime/router.mjs`) appelle les inscrits dans cet ordre, qui est celui des `register…()` de `dnd5e-combat.mjs`. **MJ** : l'inscrit",
    "ne s'exécute que chez le MJ actif. **stop** : il peut annuler le hook en rendant `false`.", "");
  for ( const name of names ) {
    out.push(`### \`${name}\``, "");
    routes[name].forEach((entry, index) => {
      const marks = [entry.executor ? "MJ" : "", entry.cancellable ? "stop" : ""].filter(Boolean).join(", ");
      out.push(`${index + 1}. ${entry.label}${marks ? ` _(${marks})_` : ""}`);
    });
    out.push("");
  }
  return { text: out.join("\n"), own, moments: Object.keys(MOMENTS).sort() };
}

/* ------------------------------------------------------------------ réglages ---- */

async function settingsPage(settings) {
  const { SETTINGS_TABS } = await import(pathToFileURL(join(SCRIPTS, "core/settings-layout.mjs")).href);
  const lang = JSON.parse(readFileSync(join(ROOT, "module/lang/fr.json"), "utf8"));
  const tabOf = {};
  for ( const tab of SETTINGS_TABS ) for ( const key of tab.keys ?? [] ) tabOf[key] = tab.id;
  const label = data => (typeof data.name === "string" ? (lang[data.name] ?? "") : "");
  const show = value => {
    if ( value === undefined ) return "";
    if ( typeof value === "string" ) return `\`"${value}"\``;
    if ( (value === null) || (typeof value !== "object") ) return `\`${value}\``;
    const json = JSON.stringify(value);
    return `\`${json.length > 40 ? `${json.slice(0, 39)}…` : json}\``;
  };
  const rows = settings.filter(s => s.namespace === MODULE_ID).map(s => ({
    key: s.key, scope: s.data.scope ?? "", type: s.data.type?.name ?? typeof s.data.type, default: show(s.data.default),
    choices: s.data.choices ? Object.keys(s.data.choices).join(", ") : "", tab: tabOf[s.key] ?? "", shown: !!s.data.config,
    file: s.file, label: label(s.data)
  }));
  const tabs = [...SETTINGS_TABS.map(t => t.id), ""];
  const out = [
    "# Réglages",
    "",
    GENERATED,
    "",
    `${rows.length} réglages, relevés sur chaque \`game.settings.register\` du module chargé. **Portée** : \`world\` = la table (MJ),`,
    "`client` = ce poste, `user` = ce joueur. **Onglet** : celui de la fenêtre de réglages DAS (`core/settings-layout.mjs`) ; sans onglet,",
    "le réglage est une mémoire interne ou se règle ailleurs (interrupteur, fenêtre dédiée). Le libellé est celui de `lang/fr.json`.",
    ""
  ];
  for ( const tab of tabs ) {
    const list = rows.filter(r => r.tab === tab).sort((a, b) => a.key.localeCompare(b.key));
    if ( !list.length ) continue;
    out.push(`## ${tab ? `Onglet \`${tab}\`` : "Hors de la fenêtre de réglages"}`, "", "| Clé | Libellé | Portée | Type | Défaut | Choix | Fichier |", "|---|---|---|---|---|---|---|");
    for ( const row of list )
      out.push(`| \`${row.key}\` | ${cell(row.label)} | ${row.scope} | ${row.type} | ${cell(row.default)} | ${cell(row.choices)} | \`${row.file}\` |`);
    out.push("");
  }
  return { text: out.join("\n"), keys: rows.map(r => r.key).sort() };
}

/* ------------------------------------------------------------------ contenu ---- */

async function contentPage() {
  const { SHIPPED } = await import(pathToFileURL(join(SCRIPTS, "content/index.mjs")).href);
  const byKey = new Map();
  const bump = (key, identifier) => { if ( !byKey.has(key) ) byKey.set(key, []); byKey.get(key).push(identifier); };
  const actions = new Map();
  for ( const [identifier, entry] of Object.entries(SHIPPED) ) {
    for ( const key of Object.keys(entry ?? {}) ) bump(key, identifier);
    for ( const trigger of entry?.triggers ?? [] ) {
      for ( const action of trigger.do ?? [] ) {
        const name = `${trigger.on} → ${action.type}`;
        if ( !actions.has(name) ) actions.set(name, new Set());
        actions.get(name).add(identifier);
      }
    }
  }
  const sample = list => { const sorted = [...list].sort(); return sorted.slice(0, 6).map(i => `\`${i}\``).join(", ") + (sorted.length > 6 ? ", …" : ""); };
  const out = [
    "# Contenu par identifiant",
    "",
    GENERATED,
    "",
    `${Object.keys(SHIPPED).length} identifiants dnd5e ont une entrée dans le contenu livré (\`content/\`, schéma \`core/content.mjs\`). Cette page`,
    "répond à « quels items utilisent telle clé » ; ce qu'une clé veut dire est dans le schéma (`core/content/entry.mjs`). Pour un item",
    "précis en jeu : `api.content.of(item)`, `api.content.inspect(actor)`.",
    "",
    "## Clés d'une entrée",
    "",
    "| Clé | Entrées | Exemples |",
    "|---|---|---|"
  ];
  for ( const [key, list] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0])) ) out.push(`| \`${key}\` | ${list.length} | ${sample(list)} |`);
  out.push("", "## Déclencheurs : moment → action", "", "| Moment → action | Entrées | Exemples |", "|---|---|---|");
  for ( const [name, set] of [...actions.entries()].sort((a, b) => a[0].localeCompare(b[0])) ) out.push(`| \`${name}\` | ${set.size} | ${sample(set)} |`);
  out.push("");
  return { text: out.join("\n") };
}

/* ------------------------------------------------------------------ scénarios ---- */

function scenariosPage() {
  const dir = join(ROOT, "tools/scenarios");
  const rows = filesUnder(dir).map(file => {
    const meta = scenarioMeta(readFileSync(join(dir, file), "utf8"));
    const folder = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    return { id: file.replace(/\.mjs$/, ""), folder, scene: meta.scene, refs: meta.refs.slice(0, 4), text: meta.summary };
  });
  const folders = [...new Set(rows.map(r => r.folder))].sort();
  const out = [
    "# Scénarios en jeu",
    "",
    GENERATED,
    "",
    `${rows.length} scénarios (\`tools/scenarios/\`), joués dans le client du MJ par le connecteur : \`node tools/reload.mjs && node`,
    "tools/scenario.mjs <noms>`. **Scène** : vide = l'« Arène de test » ; sinon la scène que le scénario demande (sauté si elle manque).",
    "Les scénarios d'un sous-dossier ne font pas partie de la passe complète : `node tools/scenario.mjs tools/scenarios/<dossier>`. Les",
    "`balayage-*` ne se jouent que nommés. Choisir sans connaître les noms : `--grep <mot>`, `--section <§>`, `--scene <nom>` ; `--list` montre",
    "la sélection sans rien jouer.",
    ""
  ];
  for ( const folder of folders ) {
    out.push(`## ${folder ? `\`${folder}/\`` : "Passe complète"}`, "", "| Scénario | Scène | § | Ce qu'il vérifie |", "|---|---|---|---|");
    for ( const row of rows.filter(r => r.folder === folder) )
      out.push(`| \`${row.id.slice(folder ? folder.length + 1 : 0)}\` | ${cell(row.scene)} | ${row.refs.join(" ")} | ${cell(clip(row.text, 180))} |`);
    out.push("");
  }
  return { text: out.join("\n") };
}

/* ------------------------------------------------------------------ ensemble ---- */

const GENERATED = "> Généré par `npm run reference` (`tools/reference.mjs`) : ne pas modifier à la main. `npm test` échoue si cette page n'est plus à jour.";

/** Toutes les pages : `{ "API.md": texte, … }`, plus `surface` (chemins d'API, hooks et réglages, pour le contrat des voisins). */
export async function build() {
  const { api, settings, routes } = await load();
  const sources = scanSources();
  const apiDoc = apiPage(api, sources);
  const hooks = await hooksPage(routes, sources);
  const settingsDoc = await settingsPage(settings);
  const content = await contentPage();
  const scenarios = scenariosPage();
  const readme = [
    "# Référence du moteur",
    "",
    GENERATED,
    "",
    "Ces pages sont relues dans le code à chaque génération ; elles disent **ce qui existe**, pas pourquoi. Après avoir ajouté une",
    "fonction d'API, un hook, un réglage, une entrée de contenu ou un scénario : `npm run reference`, et commiter le résultat.",
    "",
    "| Page | Pour répondre à |",
    "|---|---|",
    `| [API.md](API.md) | que publie \`api\`, avec quels arguments, et où est le code ? (${apiDoc.paths.length} chemins) |`,
    `| [HOOKS.md](HOOKS.md) | quels hooks le moteur émet-il (${hooks.own.length}), lesquels écoute-t-il, et dans quel ordre ? |`,
    `| [SETTINGS.md](SETTINGS.md) | quel réglage porte cette clé, sa portée, son défaut, son onglet ? (${settingsDoc.keys.length}) |`,
    "| [CONTENT.md](CONTENT.md) | quels items utilisent telle clé du contenu, tel moment, telle action ? |",
    "| [SCENARIOS.md](SCENARIOS.md) | quel scénario vérifie quoi, sur quelle scène ? |",
    "",
    "`surface.json` : la liste nue des chemins d'API, des hooks émis, des moments (publiés en `dnd5e-combat.<moment>`) et des clés de",
    "réglage — le contrat que les modules voisins vérifient dans leurs propres tests (`tools/contract/`).",
    ""
  ].join("\n");
  const surface = `${JSON.stringify({ api: apiDoc.paths, hooks: hooks.own, moments: hooks.moments, settings: settingsDoc.keys }, null, 2)}\n`;
  return { "README.md": readme, "API.md": apiDoc.text, "HOOKS.md": hooks.text, "SETTINGS.md": settingsDoc.text, "CONTENT.md": content.text,
    "SCENARIOS.md": scenarios.text, "surface.json": surface };
}

/**
 * Ce qui n'a pas de description dans la référence : `{ api: [{ path, file }], hooks: [{ name, files }] }`. Toute l'API publique est
 * comptée, `api.mcp` compris (voir `tests/reference.test.mjs`) ; les hooks sont les `dnd5e-combat.*` émis, hors moments.
 */
export async function undocumented() {
  const { api } = await load();
  const sources = scanSources();
  const apiGaps = apiRows(api, sources).filter(r => (r.kind === "fonction") && !r.doc).map(r => ({ path: `api.${r.path}`, file: r.file }));
  const hookGaps = [...emittedHooks(sources).entries()]
    .filter(([name, entries]) => name.startsWith(`${MODULE_ID}.`) && !name.includes("<") && !hookDoc(entries))
    .map(([name, entries]) => ({ name, files: [...new Set(entries.map(e => e.file))].sort() }));
  return { api: apiGaps, hooks: hookGaps };
}

export const REFERENCE_DIR = join(ROOT, "docs/reference");
