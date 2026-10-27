/**
 * §249 : l'Avantage ou le Désavantage donné **par cible** par celui qui utilise l'activité (un voisin : le MJ qui juge le jeu de rôle
 * des joueurs devant un piège). Il se passe dans le message d'utilisation, `flags.dnd5e-combat.targetModes` = `[{ token: <uuid du
 * token>, mode: "advantage" | "disadvantage" }]`, et s'applique au jet de sauvegarde demandé à cette cible ; pour une attaque, il est
 * **inversé** sur le jet d'attaque contre elle (une cible favorisée est plus dure à toucher). Une liste et pas un objet indexé par
 * UUID : le cœur développe les clés à points d'un drapeau (`Scene.x.Token.y` devenait un objet imbriqué, vu en jeu le 2026-10-27).
 */

const MODES = new Set(["advantage", "disadvantage"]);

/** Les modes donnés, par UUID de token, valeurs inconnues retirées ; null s'il n'y en a pas. */
export function normalizeTargetModes(raw) {
  if ( !Array.isArray(raw) ) return null;
  const out = Object.fromEntries(raw.filter(e => e?.token && MODES.has(e.mode)).map(e => [e.token, e.mode]));
  return Object.keys(out).length ? out : null;
}

/** Le mode de la sauvegarde de cette cible : `{ advantage, disadvantage }`. */
export function saveModeFor(modes, uuid) {
  const mode = modes?.[uuid];
  return { advantage: mode === "advantage", disadvantage: mode === "disadvantage" };
}

/**
 * Le jet d'attaque contre ces cibles (une attaque, un jet pour toutes) : le mode inversé de chacune. Les cibles sans mode donné comptent
 * comme « normal ». Si elles ne s'accordent pas, rien n'est posé (`agreed: false`) : à l'appelant de faire une attaque par groupe.
 * @param {(string|null)[]} perTarget  Le mode donné de chaque cible.
 * @returns {{ advantage: boolean, disadvantage: boolean, agreed: boolean }}
 */
export function attackModeAgainst(perTarget) {
  const flipped = perTarget.map(m => (m === "advantage") ? -1 : (m === "disadvantage") ? 1 : 0);
  if ( !flipped.length ) return { advantage: false, disadvantage: false, agreed: true };
  const agreed = flipped.every(v => v === flipped[0]);
  if ( !agreed ) return { advantage: false, disadvantage: false, agreed: false };
  return { advantage: flipped[0] === 1, disadvantage: flipped[0] === -1, agreed: true };
}
