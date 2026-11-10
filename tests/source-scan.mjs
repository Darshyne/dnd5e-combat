/**
 * Lecture du code du module pour les gardiens (tests/circulation.test.mjs) : fichiers, commentaires retirés, appels avec leurs
 * arguments, fonction englobante. Pas un test : un outil des tests qui lisent la source, comme tests/layers.test.mjs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "../module/scripts");

/** Les fichiers .mjs d'un dossier de module/scripts (sous-dossiers compris), chemins relatifs à module/scripts. */
export function filesOf(dir) {
  return readdirSync(join(ROOT, dir)).flatMap(f => statSync(join(ROOT, dir, f)).isDirectory() ? filesOf(`${dir}/${f}`)
    : (f.endsWith(".mjs") ? [`${dir}/${f}`] : []));
}

/** Tous les fichiers du module, couches et point d'entrée. */
export const allFiles = () => ["core", "content", "adapter", "runtime", "ui"].flatMap(filesOf);

/**
 * Le code d'un fichier, commentaires remplacés par des espaces (les positions et les numéros de ligne restent justes). Les chaînes
 * sont gardées telles quelles ; un `//` dans une chaîne (une URL) n'est pas pris pour un commentaire.
 */
export function code(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  let out = "";
  let i = 0;
  const blank = s => s.replace(/[^\n]/g, " ");
  while ( i < src.length ) {
    const c = src[i];
    if ( (c === "/") && (src[i + 1] === "*") ) {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    }
    else if ( (c === "/") && (src[i + 1] === "/") ) {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
    }
    else if ( (c === "\"") || (c === "'") || (c === "`") ) {
      let j = i + 1;
      while ( (j < src.length) && (src[j] !== c) ) j += (src[j] === "\\") ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    }
    else { out += c; i++; }
  }
  return out;
}

/** Numéro de ligne (1…) d'une position. */
export const lineAt = (text, index) => text.slice(0, index).split("\n").length;

/** Le texte entre la parenthèse ouvrante à `open` et sa fermante (parenthèses équilibrées), sans elles. */
export function argsAt(text, open) {
  let depth = 0;
  for ( let i = open; i < text.length; i++ ) {
    if ( text[i] === "(" ) depth++;
    else if ( text[i] === ")" && (--depth === 0) ) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

const TOP = /^(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm;

/**
 * La déclaration de premier niveau (fonction, constante) qui contient la position : `{ name, body }`. Le corps va de la
 * déclaration à la suivante — assez pour un gardien qui cherche un mot dans la fonction d'un appel.
 */
export function enclosing(text, index) {
  let found = { name: "(module)", start: 0 };
  const decls = [...text.matchAll(TOP)].map(m => ({ name: m[1] ?? m[2], start: m.index }));
  for ( const d of decls ) if ( d.start <= index ) found = d;
  const next = decls.find(d => d.start > found.start && d.start > index);
  return { name: found.name, body: text.slice(found.start, next?.start ?? text.length) };
}

/**
 * Chaque appel `.<méthode>(` d'un fichier : `{ file, line, method, args, fn }` (`fn` : la déclaration englobante).
 * @param {string} file
 * @param {RegExp} methods  Ex. /rollDamage|rollAttack/
 */
export function callsIn(file, methods) {
  const text = code(file);
  const re = new RegExp(`\\.(${methods.source})\\(`, "g");
  return [...text.matchAll(re)].map(m => {
    const open = m.index + m[0].length - 1;
    return { file, line: lineAt(text, m.index), method: m[1], args: argsAt(text, open), fn: enclosing(text, m.index), text };
  });
}
