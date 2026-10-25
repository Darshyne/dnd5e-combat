/**
 * §244 : la serrure d'une porte (issue #22). Ce que le MJ règle dans la configuration du mur (section « DAS · Serrure », drapeau
 * `flags.dnd5e-combat.lock`) : un DD pour crocheter, un DD pour forcer (ou « ne peut pas être forcée »), une clé facultative (nom ou
 * identifiant d'objet). Un DD vide : le MJ tranche sur le résultat, comme avant. Les règles 2024 ne donnent pas de DD fixe ; les
 * repères du Guide du maître (Facile 10, Moyen 15, Difficile 20…) sont proposés dans le champ.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Les façons d'ouvrir une serrure. */
export const LOCK_METHODS = Object.freeze(["pick", "force", "key"]);

/** Les repères de DD du Guide du maître, proposés dans la configuration du mur. */
export const LOCK_DC_PRESETS = Object.freeze([5, 10, 15, 20, 25, 30]);

/** Réglage de monde `lockFailure` : un échec ne coûte rien (« free ») ou un seul essai par personnage et par façon (« once »). */
export const LOCK_FAILURE_MODES = Object.freeze(["free", "once"]);

const dcOf = value => {
  if ( (value === null) || (value === undefined) || (value === "") ) return null;
  const n = Number(value);
  return (Number.isFinite(n) && (n >= 1)) ? Math.round(n) : null;
};

/**
 * Le drapeau `lock` d'un mur, lu sans faire confiance à sa forme.
 * @param {object} [flag]
 * @returns {{pickDc: number|null, forceDc: number|null, unforceable: boolean, key: string}}
 */
export function normalizeLock(flag) {
  const f = (flag && (typeof flag === "object")) ? flag : {};
  return {
    pickDc: dcOf(f.pickDc),
    forceDc: dcOf(f.forceDc),
    unforceable: f.unforceable === true,
    key: String(f.key ?? "").trim()
  };
}

const fold = s => String(s ?? "").trim().toLocaleLowerCase();

/**
 * Cet objet est-il la clé ? Même nom (sans la casse ni les espaces autour), ou même identifiant dnd5e.
 * @param {{name?: string, identifier?: string}} item
 * @param {string} key
 */
export function isKey(item, key) {
  const wanted = fold(key);
  if ( !wanted || !item ) return false;
  return (fold(item.name) === wanted) || (fold(item.identifier) === wanted);
}

/**
 * Le verdict d'un essai : « success », « failure », ou « gm » quand la porte n'a pas de DD pour cette façon (le MJ tranche).
 * @param {object} lock      normalizeLock
 * @param {"pick"|"force"} method
 * @param {number} total     Le total du test.
 */
export function judgeAttempt(lock, method, total) {
  if ( (method === "force") && lock.unforceable ) return "failure";
  const dc = (method === "pick") ? lock.pickDc : lock.forceDc;
  if ( dc === null ) return "gm";
  if ( !Number.isFinite(total) ) return "failure";
  return (total >= dc) ? "success" : "failure";
}

/**
 * Les essais déjà faits sur une serrure (drapeau `lockTries` : { [personnage]: ["pick", "force"] }), lus proprement.
 * @param {object} [flag]
 * @returns {Record<string, string[]>}
 */
export function normalizeTries(flag) {
  const out = {};
  if ( !flag || (typeof flag !== "object") ) return out;
  for ( const [who, methods] of Object.entries(flag) ) {
    const list = [methods].flat().filter(m => (m === "pick") || (m === "force"));
    if ( list.length ) out[who] = [...new Set(list)];
  }
  return out;
}

/**
 * La clé d'un personnage dans le drapeau des essais : son uuid sans points (une mise à jour Foundry déplie une clé à points en objets
 * imbriqués : « Actor.abc » deviendrait { Actor: { abc } }).
 */
export function triesKey(uuid) {
  return String(uuid ?? "").replaceAll(".", "_");
}

/** Ce personnage a-t-il déjà essayé cette façon, quand le réglage n'accorde qu'un essai ? */
export function alreadyTried(tries, who, method, mode) {
  return (mode === "once") && (tries[who] ?? []).includes(method);
}

/** Les essais après un échec de `who` (réglage « un essai ») ; inchangés sinon. */
export function recordTry(tries, who, method, mode) {
  if ( (mode !== "once") || !who ) return tries;
  const list = new Set(tries[who] ?? []);
  list.add(method);
  return { ...tries, [who]: [...list] };
}

/**
 * Les entrées de serrure qu'un personnage voit devant une porte verrouillée, dans l'ordre du menu.
 * @param {object} lock                normalizeLock
 * @param {object} state
 * @param {boolean} state.hasKey       Il porte la clé.
 * @param {Record<string, string[]>} state.tries
 * @param {string} state.who           Le personnage (son uuid).
 * @param {string} state.mode          Réglage `lockFailure`.
 * @returns {Array<{method: string, spent: boolean}>}  `spent` : essai déjà fait (l'entrée le dit, un clic le rappelle).
 */
export function lockChoices(lock, { hasKey=false, tries={}, who="", mode="free" }={}) {
  const out = [];
  if ( lock.key && hasKey ) out.push({ method: "key", spent: false });
  out.push({ method: "pick", spent: alreadyTried(tries, who, "pick", mode) });
  if ( !lock.unforceable ) out.push({ method: "force", spent: alreadyTried(tries, who, "force", mode) });
  return out;
}

/** L'état de porte après un succès : crochetée ou ouverte à la clé, elle est fermée ; forcée, elle s'ouvre. */
/**
 * §247 : la charge du hook public `dnd5e-combat.lockAttempt` (hors documents) — la façon, l'issue (`success`, `failure`, `gm`) et le
 * total du test (null pour la clé, ou un total illisible).
 */
export function attemptReport(method, outcome, total) {
  const value = Number(total);
  return { method, outcome, total: ((method !== "key") && (total !== null) && (total !== undefined) && Number.isFinite(value)) ? value : null };
}

export function stateAfter(method) {
  return (method === "force") ? "open" : "closed";
}
