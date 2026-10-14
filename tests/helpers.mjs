/** Données partagées par plusieurs tests (pas un fichier de test : Vitest ne lit que les `*.test.mjs`). */

/** Une résolution minimale : identifiants du message porteur, de l'origine, de l'activité et de la source. */
export const RESOLUTION_BASE = Object.freeze({ id: "r", carrier: "M", origin: "M", activity: "Act", source: "Src" });
