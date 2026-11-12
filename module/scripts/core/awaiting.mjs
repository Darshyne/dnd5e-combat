/**
 * §381 (issue #35) : qui la table attend — une fenêtre de réaction, de choix ou de jet ouverte chez un joueur ou chez le MJ. Ce qui se
 * calcule sans Foundry : la forme d'une attente diffusée (jamais ce qu'elle demande), son expiration, et où chaque client la montre.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Les sortes d'attente : une réaction, un choix (option, confirmation), un jet de dés. */
export const AWAITING_KINDS = Object.freeze(["reaction", "choice", "roll"]);

/** Le client qui attend rafraîchit ses attentes à ce rythme ; une attente non rafraîchie depuis `AWAITING_STALE_MS` est oubliée. */
export const AWAITING_REFRESH_MS = 20000;
export const AWAITING_STALE_MS = 60000;
/** Après la fin annoncée d'une fenêtre à délai (le temps qu'elle se résolve seule), son attente tombe d'elle-même. */
export const AWAITING_GRACE_MS = 5000;

/** Les modes du réglage `awaitingGm` : une fenêtre du MJ pour une créature sans joueur. */
export const AWAITING_GM_MODES = Object.freeze(["discreet", "token", "hidden"]);

/**
 * La forme diffusée d'une attente : rien d'autre que ces champs — ni le nom de la réaction, ni l'objet, ni l'invite.
 * @param {object} raw
 * @returns {{id: string, userId: string, userName: string, token: string|null, actor: string|null, kind: string, gm: boolean,
 *   player: boolean, since: number, seconds: number|null, refreshed: number}|null}  null si l'attente est inutilisable.
 */
export function awaitingEntry(raw={}) {
  const id = String(raw.id ?? "");
  const userId = String(raw.userId ?? "");
  if ( !id || !userId ) return null;
  const since = Number.isFinite(raw.since) ? raw.since : 0;
  const seconds = Number(raw.seconds) > 0 ? Number(raw.seconds) : null;
  return {
    id, userId, userName: String(raw.userName ?? ""),
    token: raw.token ? String(raw.token) : null,
    actor: raw.actor ? String(raw.actor) : null,
    kind: AWAITING_KINDS.includes(raw.kind) ? raw.kind : "choice",
    gm: raw.gm === true,
    player: raw.player === true,
    since, seconds,
    refreshed: Number.isFinite(raw.refreshed) ? raw.refreshed : since
  };
}

/**
 * §426 : le libellé d'une attente réservé aux MJ (le titre de la fenêtre : « Inspiration héroïque — Paladin »). Il ne fait PAS partie de
 * l'attente diffusée (`awaitingEntry` ne le garde pas) : il voyage à part, vers les seuls MJ, pour leur File. Une ligne, 80 caractères
 * au plus ; chaîne vide si rien d'utilisable.
 */
export function gmLabel(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return (clean.length > 80) ? `${clean.slice(0, 79)}…` : clean;
}

/** Une attente est-elle encore valable à `now` ? Ni oubliée (pas de nouvelles), ni au-delà de la fin de son délai. */
export function awaitingAlive(entry, now) {
  if ( !entry ) return false;
  if ( (now - entry.refreshed) > AWAITING_STALE_MS ) return false;
  if ( entry.seconds && ((now - entry.since) > ((entry.seconds * 1000) + AWAITING_GRACE_MS)) ) return false;
  return true;
}

/** Ce qui reste du délai, de 1 (vient de s'ouvrir) à 0 ; null sans délai. */
export function awaitingLeft(entry, now) {
  if ( !entry?.seconds ) return null;
  const total = entry.seconds * 1000;
  return Math.max(0, Math.min(1, 1 - ((now - entry.since) / total)));
}

/**
 * Où ce client montre l'attente.
 *  - `none` : rien (c'est lui qui répond, ou la table a éteint l'indicateur, ou le MJ le garde pour lui) ;
 *  - `token` : le sablier au-dessus du token ;
 *  - `banner` : le bandeau discret « Le MJ décide… », sans désigner de créature.
 * Une fenêtre du MJ pour une créature sans joueur révélerait qu'elle a une réaction ou une option : le réglage `gmMode` décide ce que
 * les joueurs en voient. Le MJ, lui, voit tout sur les tokens. Une fenêtre du MJ pour un personnage joueur (joueur absent) n'est pas
 * un secret : sur le token.
 * @param {object} entry
 * @param {{userId: string, isGM: boolean, enabled?: boolean, hidden?: boolean, gmMode?: string}} viewer
 * @returns {"none"|"token"|"banner"}
 */
export function awaitingPlacement(entry, { userId, isGM, enabled=true, hidden=false, gmMode="discreet" }) {
  if ( !entry || !enabled || hidden ) return "none";
  if ( entry.userId === userId ) return "none";
  const secret = entry.gm && !entry.player;
  if ( !secret || isGM ) return entry.token ? "token" : "none";
  if ( gmMode === "hidden" ) return "none";
  if ( gmMode === "token" ) return entry.token ? "token" : "banner";
  return "banner";
}

/**
 * Le tableau des attentes connues de ce client : celles d'un utilisateur remplacent les précédentes (`replace`), une attente arrive ou
 * part (`add`, `remove`), un utilisateur déconnecté perd toutes les siennes (`drop`). Rend un nouveau tableau, trié par ancienneté.
 * @param {object[]} entries
 * @param {{type: "add"|"remove"|"replace"|"drop", entry?: object, id?: string, userId?: string, list?: object[]}} change
 */
export function applyAwaiting(entries, change) {
  const list = [...entries];
  const sorted = l => l.sort((a, b) => (a.since - b.since) || a.id.localeCompare(b.id));
  switch ( change?.type ) {
    case "add": {
      const entry = awaitingEntry(change.entry);
      if ( !entry ) return sorted(list);
      return sorted([...list.filter(e => e.id !== entry.id), entry]);
    }
    case "remove": return sorted(list.filter(e => e.id !== change.id));
    case "drop": return sorted(list.filter(e => e.userId !== change.userId));
    case "replace": {
      const fresh = (change.list ?? []).map(awaitingEntry).filter(e => e && (e.userId === change.userId));
      return sorted([...list.filter(e => e.userId !== change.userId), ...fresh]);
    }
    default: return sorted(list);
  }
}

/** Les attentes encore valables à `now`. */
export function pruneAwaiting(entries, now) {
  return entries.filter(e => awaitingAlive(e, now));
}
