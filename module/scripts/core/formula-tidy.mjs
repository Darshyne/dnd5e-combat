/**
 * §438 : une formule de dés lisible. Le Manuel 3.0.0 a retiré des échelles que le contenu remplace par des formules sur le niveau de
 * classe (`2d(6 + 2 * min(1, floor(@classes.ranger.levels / 11)))`) : une fois les données remplacées, chaque groupe de nombres entre
 * parenthèses (avec `floor`, `ceil`, `round`, `min`, `max`) est calculé — `2d(6 + 2 * min(1, floor(5 / 11)))` → `2d6`. Rien d'autre ne
 * change (dés, `@` restants, texte). Pur.
 */

const GROUP = /(floor|ceil|round|min|max)?\(([\d\s+\-*/.,]*)\)/;

/** Un groupe calculable : « min(1, 2) » → 1 ; « (6 + 2) » → 8 ; null s'il ne l'est pas. */
function evaluate(fn, inner) {
  const parts = inner.split(",").map(p => p.trim());
  if ( parts.some(p => !/^[\d\s+\-*/.]+$/.test(p)) ) return null;
  let values;
  try { values = parts.map(p => Function(`"use strict"; return (${p});`)()); } catch { return null; }
  if ( values.some(v => !Number.isFinite(v)) ) return null;
  if ( !fn ) return (values.length === 1) ? values[0] : null;
  if ( (fn === "min") || (fn === "max") ) return Math[fn](...values);
  return (values.length === 1) ? Math[fn](values[0]) : null;
}

export function tidyDice(formula) {
  let text = String(formula ?? "");
  for ( let guard = 0; guard < 50; guard++ ) {
    let changed = false;
    text = text.replace(new RegExp(GROUP.source, "g"), (all, fn, inner) => {
      const v = evaluate(fn, inner);
      if ( v === null ) return all;
      changed = true;
      return String(Number.isInteger(v) ? v : Math.round(v * 1000) / 1000);
    });
    if ( !changed ) break;
  }
  return text;
}
