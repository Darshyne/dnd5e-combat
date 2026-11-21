/**
 * Les actions de base qu'une activité prend (`basicActions` du contenu), quand la déclaration dépend de ce que l'activité dépense.
 * Une même activité — même id — est, selon la donnée, la version payée ou la version gratuite d'une aptitude : le Pas du vent du
 * moine (`0MuRZ0Ur95xQTKFq`) dépense 1 point de crédo dans le Manuel des joueurs 2.2.0 (Foncer et Se désengager), et rien dans le
 * SRD 5.2 et le Manuel 3.0.0, où le point passe à une autre activité (Foncer seul). Fonction pure.
 */

/** La déclaration a-t-elle les deux formes, `{ paid, free }` ? */
export function hasPaidForm(declared) {
  return !!declared && (typeof declared === "object") && !Array.isArray(declared) && (("paid" in declared) || ("free" in declared));
}

/**
 * La déclaration qui vaut pour cette utilisation : `paid` si l'activité dépense une ressource, `free` sinon ; une déclaration sans
 * ces formes (un genre, une liste, `{ choose }`) est rendue telle quelle.
 * @param {string|string[]|{choose: string[]}|{paid?: string|string[], free?: string|string[]}|null|undefined} declared
 * @param {boolean} spends  l'activité dépense quelque chose (ses `consumption.targets`)
 */
export function basicKindsFor(declared, spends) {
  if ( !hasPaidForm(declared) ) return declared ?? null;
  return (spends ? declared.paid : declared.free) ?? null;
}
