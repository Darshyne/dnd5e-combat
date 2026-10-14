/**
 * Sauvegardes du diagnostic (SPEC §177) : règles pures, testées par tests/backup.test.mjs.
 *
 * Avant toute réparation, chaque document touché (« racine ») est copié dans une entrée du compendium « DAS · Sauvegardes » ;
 * restaurer remet la racine exactement comme elle était. Trois sortes de racines :
 *   Actor  un acteur du monde (ses objets et ses effets compris) ;
 *   Item   un objet du monde (ses effets compris) ;
 *   Token  un token non lié : sa copie propre de l'acteur (ce que ses objets et effets sont devenus dans son delta).
 */

/** Les collections incluses d'une racine, par sorte. */
export const EMBEDDED = Object.freeze({ Actor: ["items", "effects"], Item: ["effects"], Token: ["items", "effects"] });

/** Les champs qu'une restauration ne remet jamais (identité, rangement, droits, historique). */
export const KEPT_FIELDS = Object.freeze(["_id", "_stats", "folder", "sort", "ownership"]);

/**
 * Ce qu'il faut faire d'une collection incluse pour revenir à la sauvegarde : supprimer ce qui n'y était pas, recréer ce qui a
 * disparu (avec son id), remettre le reste à l'identique.
 * @param {{ _id: string }[]} current   Les documents inclus actuels (données).
 * @param {{ _id: string }[]} saved     Ceux de la sauvegarde.
 * @returns {{ remove: string[], create: object[], update: object[] }}
 */
export function restorePlan(current=[], saved=[]) {
  const now = new Set(current.map(d => d._id));
  const then = new Map(saved.map(d => [d._id, d]));
  return {
    remove: [...now].filter(id => !then.has(id)),
    create: saved.filter(d => !now.has(d._id)),
    update: saved.filter(d => now.has(d._id))
  };
}

/** Les données de premier niveau d'une racine à remettre (sans ses collections incluses ni les champs gardés). */
export function rootFields(type, data) {
  const skip = new Set([...KEPT_FIELDS, ...(EMBEDDED[type] ?? [])]);
  return Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !skip.has(k)));
}

/** La clé d'une racine (pour ne la sauvegarder qu'une fois). */
export const rootKey = root => `${root.type}:${root.uuid}`;

/** Les racines distinctes d'une liste de tâches (dans l'ordre de première apparition). */
export function uniqueRoots(tasks) {
  const seen = new Map();
  for ( const t of tasks ?? [] ) if ( t?.root && !seen.has(rootKey(t.root)) ) seen.set(rootKey(t.root), t.root);
  return [...seen.values()];
}

/**
 * Une sauvegarde relue est-elle complète ? Chaque racine attendue doit y être, avec exactement les mêmes ids d'objets et
 * d'effets que l'original au moment de la copie. Rend la liste des problèmes (vide : complète).
 * @param {{ type: string, uuid: string, data: object }[]} expected   Ce qui a été copié.
 * @param {{ type: string, uuid: string, data: object }[]} readBack   Ce que le compendium rend.
 */
export function verifyBackup(expected, readBack) {
  const problems = [];
  const got = new Map((readBack ?? []).map(r => [rootKey(r), r]));
  for ( const e of expected ?? [] ) {
    const r = got.get(rootKey(e));
    if ( !r ) { problems.push(`missing ${rootKey(e)}`); continue; }
    for ( const field of EMBEDDED[e.type] ?? [] ) {
      const a = (e.data?.[field] ?? []).map(d => d._id).sort().join(",");
      const b = (r.data?.[field] ?? []).map(d => d._id).sort().join(",");
      if ( a !== b ) problems.push(`${rootKey(e)}: ${field} differ`);
    }
  }
  return problems;
}

/** Le nom d'une entrée de sauvegarde : « Diagnostic — 2026-10-13 14:05 (3) ». */
export function backupName(label, date, count) {
  const pad = n => String(n).padStart(2, "0");
  const d = new Date(date);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${label} — ${stamp} (${count})`;
}
