/**
 * M7 (SPEC §18.11) : auras de monstre qui agissent — Aura de feu (dégâts à la fin du tour du porteur), Puanteur (sauvegarde
 * au début du tour d'une créature dedans). Ce que le contenu ne dit pas se lit dans le texte anglais d'origine de l'item :
 * « sauf s'il est Neutralisé », « autre qu'un Ghast », « immunisé … pendant 24 heures ». Fonctions pures, sans Foundry.
 */

import { areHostile } from "./reaction.mjs";

/**
 * Les moments d'une émanation : la fin du tour de son porteur, le début du tour d'une créature qui s'y trouve, la mort de
 * son porteur (§18.14, Mort explosive des Méphites, Convulsions du Balor).
 */
export const EMANATION_MOMENTS = Object.freeze(["ownTurnEnd", "turnStart", "death"]);

const plain = html => String(html ?? "").replace(/\[\[[^\]]*\]\]/g, "…").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");

/**
 * Ce que le texte anglais d'une émanation précise.
 *  - `active` : « unless / while … doesn't have the Incapacitated condition » — éteinte si le porteur est Neutralisé ;
 *  - `kin` : « any creature (other than a Ghast) » — ceux qui portent la même émanation n'y sont pas soumis ;
 *  - `immunity` : « Success: The target is immune to this …'s Fear Aura for 24 hours » (`all: false`, ce porteur-là) ou
 *    « immune to the Stench of all ghasts for 1 hour » (`all: true`, toutes les émanations de ce nom).
 * @param {string} html
 * @returns {{active: boolean, kin: boolean, immunity: {hours: number, all: boolean}|null}}
 */
export function readEmanationText(html) {
  const text = plain(html);
  const active = /\b(unless|while|provided)\b[^.]{0,80}\bIncapacitated\b/i.test(text);
  const kin = /\bother than an?\s/i.test(text);
  let immunity = null;
  const m = text.match(/\bimmune to (the [^.]*? of all|this|th)[^.]*?\bfor (?:the next )?(\d+|one|an?) hours?\b/i);
  if ( m ) {
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : 1;
    immunity = { hours: n, all: /\bof all\b/i.test(m[1]) };
  }
  return { active, kin, immunity };
}

/**
 * Qui l'émanation atteint, parmi des créatures dont on connaît la distance au porteur.
 * @param {{token: string, disposition: number, radius: number, affects: "any"|"enemy", inactive: boolean}} source
 * @param {Array<{token: string, disposition: number, distance: number, lineOfEffect?: boolean|null, kin?: boolean,
 *   immune?: boolean, sees?: boolean|null, out?: boolean}>} candidates
 *   `out` : hors jeu (mort, caché, objet piloté) ; `sees` : false exclut (l'émanation demande d'être vue), null n'exclut pas.
 * @returns {string[]}
 */
export function emanationTargets(source, candidates) {
  if ( source.inactive ) return [];
  return candidates.filter(c => {
    if ( (c.token === source.token) || c.out || c.kin || c.immune ) return false;
    if ( !(c.distance <= source.radius + 1e-6) ) return false;
    if ( c.lineOfEffect === false ) return false;   // une émanation est arrêtée par un abri total (§14.2)
    if ( c.sees === false ) return false;
    if ( source.affects === "enemy" ) return areHostile(source.disposition, c.disposition);   // « de son choix » : les camps opposés
    return true;
  }).map(c => c.token);
}

