/**
 * Garder le défilement d'une fenêtre redessinée en entier (`_replaceHTML` qui remplace tout le contenu) : sans cela, chaque clic
 * (case, « Tout décocher », réglage modifié) ramène la fenêtre tout en haut. On relève la position de chaque zone qui défile avant
 * le remplacement et on la remet après, tant que la fenêtre montre la même vue (`view`, ainsi l'onglet) ; changer de vue repart en haut.
 */

/**
 * Remplacer le contenu de `content` par `result` en gardant le défilement des zones `selectors` (et de `content` lui-même).
 * @param {HTMLElement} content      Le conteneur de la fenêtre (`.window-content`).
 * @param {HTMLElement} result       Le nouveau contenu.
 * @param {string[]} selectors       Les zones qui défilent, retrouvées dans l'ancien et le nouveau contenu par ces sélecteurs.
 * @param {object} memo              Un objet propre à la fenêtre, gardé d'un rendu à l'autre (`{ view, tops }`).
 * @param {string} view              La vue montrée ; si elle change, rien n'est remis.
 */
export function replaceKeepingScroll(content, result, selectors, memo, view) {
  const same = memo.view === view;
  const tops = same ? readTops(content, selectors) : null;
  content.replaceChildren(result);
  memo.view = view;
  if ( tops ) writeTops(content, selectors, tops);
}

/** La position de chaque zone : `{ "": haut du conteneur, [sélecteur]: [haut de chaque élément trouvé] }`. */
export function readTops(content, selectors) {
  const tops = { "": content.scrollTop ?? 0 };
  for ( const s of selectors ) tops[s] = [...content.querySelectorAll(s)].map(e => e.scrollTop ?? 0);
  return tops;
}

/** Remettre les positions relevées par `readTops`, élément par élément dans l'ordre du document. */
export function writeTops(content, selectors, tops) {
  for ( const s of selectors ) {
    const found = [...content.querySelectorAll(s)];
    (tops[s] ?? []).forEach((top, i) => { if ( found[i] && top ) found[i].scrollTop = top; });
  }
  if ( tops[""] ) content.scrollTop = tops[""];
}
