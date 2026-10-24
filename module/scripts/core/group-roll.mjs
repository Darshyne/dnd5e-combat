/**
 * §242 (issue #18) : jets demandés par le MJ à plusieurs personnages — test de caractéristique, sauvegarde, compétence ou outil,
 * avec un DD (affiché ou caché aux joueurs), l'Avantage ou le Désavantage, un modificateur fixe et un libellé (« Sauter le pont »).
 * Ici, la règle seule : la demande valide, le résultat de chacun, le verdict du test de groupe (PHB 2024 : le groupe réussit si au
 * moins la moitié de ses membres réussit) et ce qu'un joueur a le droit de voir.
 *
 * Pur : aucune dépendance à Foundry.
 */

export const ROLL_TYPES = Object.freeze(["check", "save", "skill", "tool"]);

/**
 * La demande, normalisée ; une erreur (texte anglais, pour la console) si elle ne se joue pas.
 * @param {object} input
 * @param {string} input.type          "check" | "save" | "skill" | "tool"
 * @param {string} input.key           La caractéristique (check, save), la compétence ou l'outil.
 * @param {number|string|null} [input.dc]
 * @param {boolean} [input.hideDc]     Le DD n'est pas montré aux joueurs.
 * @param {boolean} [input.advantage]
 * @param {boolean} [input.disadvantage]
 * @param {number|string} [input.bonus]  Modificateur fixe (entier, positif ou négatif).
 * @param {string} [input.label]
 * @param {boolean} [input.group]      Test de groupe (2024).
 * @param {string|null} [input.ability] Pour une compétence ou un outil : une autre caractéristique que celle par défaut.
 * @returns {{request: object|null, error: string|null}}
 */
export function normalizeRequest(input={}) {
  const type = String(input.type ?? "");
  if ( !ROLL_TYPES.includes(type) ) return { request: null, error: `unknown roll type "${type}"` };
  const key = String(input.key ?? "").trim();
  if ( !key ) return { request: null, error: "no ability, skill or tool given" };
  const dcNumber = Number(input.dc);
  const dc = ((input.dc === null) || (input.dc === undefined) || (input.dc === "") || !Number.isFinite(dcNumber)) ? null
    : Math.max(0, Math.round(dcNumber));
  const bonusNumber = Number(input.bonus);
  const bonus = Number.isFinite(bonusNumber) ? Math.round(bonusNumber) : 0;
  let advantage = !!input.advantage;
  let disadvantage = !!input.disadvantage;
  if ( advantage && disadvantage ) advantage = disadvantage = false;   // les deux s'annulent (PHB 2024)
  const ability = ((type === "skill") || (type === "tool")) && input.ability ? String(input.ability) : null;
  return {
    request: {
      type, key, ability, dc, hideDc: (dc !== null) && !!input.hideDc, advantage, disadvantage, bonus,
      label: String(input.label ?? "").trim().slice(0, 120), group: !!input.group
    },
    error: null
  };
}

/** Réussite d'un total contre un DD : true, false, ou null sans DD ni total. */
export function outcomeOf(total, dc) {
  if ( (dc === null) || (dc === undefined) || !Number.isFinite(Number(total)) ) return null;
  return Number(total) >= Number(dc);
}

/**
 * Le point de la demande : chacun (`waiting` ou `rolled`, total, réussite), le compte, et le verdict du groupe.
 * @param {{dc: number|null, group: boolean}} request
 * @param {Array<{total: number|null}>} entries  `total` null : pas encore lancé.
 * @returns {{entries: Array<object>, rolled: number, waiting: number, successes: number, failures: number, done: boolean,
 *   success: boolean|null}}  `success` : le verdict — du groupe (test de groupe), sinon de tous (chacun réussit) ; null sans DD ou
 *   tant que le résultat n'est pas acquis.
 */
export function tally(request, entries) {
  const dc = request?.dc ?? null;
  const out = entries.map(e => {
    const rolled = Number.isFinite(e.total) && (e.total !== null);
    return { ...e, status: rolled ? "rolled" : "waiting", success: rolled ? outcomeOf(e.total, dc) : null };
  });
  const rolled = out.filter(e => e.status === "rolled").length;
  const waiting = out.length - rolled;
  const successes = out.filter(e => e.success === true).length;
  const failures = out.filter(e => e.success === false).length;
  const done = (out.length > 0) && (waiting === 0);
  let success = null;
  if ( (dc !== null) && out.length ) {
    if ( request.group ) {
      // « Si au moins la moitié du groupe réussit, le groupe réussit » — acquis dès que la moitié a réussi, ou perdu dès que
      // trop ont échoué pour l'atteindre.
      const needed = Math.ceil(out.length / 2);
      if ( successes >= needed ) success = true;
      else if ( (out.length - failures) < needed ) success = false;
    }
    else if ( failures > 0 ) success = false;
    else if ( done ) success = true;
  }
  return { entries: out, rolled, waiting, successes, failures, done, success };
}

/**
 * Ce qu'un client a le droit de voir : le MJ tout ; un joueur, sans le DD caché, ni réussites, ni verdict tant qu'il est caché.
 * @param {object} view     `tally()` complété de la demande (`request`).
 * @param {{gm: boolean}} viewer
 */
export function visibleTo(view, { gm }) {
  if ( gm || !view?.request?.hideDc ) return view;
  return {
    ...view,
    request: { ...view.request, dc: null },
    entries: view.entries.map(e => ({ ...e, success: null })),
    successes: null, failures: null, success: null
  };
}
