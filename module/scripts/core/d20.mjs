/**
 * Issue #47 : ce qu'un d20 lancé avec l'Avantage ou le Désavantage a donné — les dés gardés et les dés écartés.
 * Les résultats sont ceux d'un terme de dé de Foundry (`{ result, active, discarded, rerolled }`) : un dé relancé (Chanceux des
 * Halfelins) est remplacé, pas écarté ; il n'est ni gardé ni écarté.
 * @param {Array<{result: number, active?: boolean, discarded?: boolean, rerolled?: boolean}>} results
 * @param {number} advantageMode  Le mode retenu par dnd5e : 1 Avantage, -1 Désavantage, 0 jet normal.
 * @returns {{mode: number, kept: number[], dropped: number[]}|null}  null quand rien n'a été écarté (jet normal).
 */
export function keptAndDropped(results, advantageMode=0) {
  const rolled = (results ?? []).filter(r => Number.isFinite(r?.result) && !r.rerolled);
  const dropped = rolled.filter(r => r.discarded).map(r => r.result);
  if ( !dropped.length ) return null;
  const kept = rolled.filter(r => !r.discarded && (r.active !== false)).map(r => r.result);
  if ( !kept.length ) return null;
  // Sans mode connu (vieux message), les dés parlent : un dé écarté plus haut que le dé gardé, c'est un Désavantage.
  const mode = (advantageMode === 1) || (advantageMode === -1) ? advantageMode : ((Math.max(...dropped) > Math.max(...kept)) ? -1 : 1);
  return { mode, kept, dropped };
}
