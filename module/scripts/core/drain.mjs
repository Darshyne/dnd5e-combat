/**
 * M8 (SPEC §18.16) : drain du maximum de points de vie (Absorption de vie des Nécrophage, Âme-en-peine, Spectre ; Trompe du
 * Chasme ; Coup du Golem d'argile ; Morsure et Drain sanguin des vampires ; Baiser drainant ; Parole funeste ; Drain
 * d'énergie de la Demi-liche) ; §105 : drain d'une valeur de caractéristique (Caresse dévitalisante de l'Ombre), et les fiches
 * au format 2014 ou écrites en français (Drain de vie d'une brume vampirique faite à la main). Ce que dit le texte anglais
 * d'origine, ou le texte français d'une fiche sans original. Fonctions pures, sans Foundry.
 */

const plain = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…")
  .replace(/&Reference\[([^\]]+)\](?:\{[^}]*\})?/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/’/g, "'").replace(/\s+/g, " ");

/** Types de dégâts nommés en français dans la phrase du drain. */
const FRENCH_TYPES = { "nécrotiques": "necrotic", "nécrotique": "necrotic", "radiants": "radiant", "psychiques": "psychic" };

/** Caractéristiques, par leur nom anglais et français. */
const ABILITIES = {
  strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha",
  force: "str", "dextérité": "dex", sagesse: "wis", charisme: "cha"
};

/** La quantité drainée : un jet enrichi `[[/r 1d4]]`, ou des dés écrits en clair. */
const DICE = /\[\[\/r ([^\]#]+?)(?:#[^\]]*)?\]\](?:\{[^}]*\})?|(\d+d\d+(?:\s*[+-]\s*\d+)?)/.source;
const ABILITY_EN = new RegExp(String.raw`\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score (?:decreases|is reduced) by (?:${DICE})`, "i");
const ABILITY_FR = new RegExp(String.raw`\bvaleur de (Force|Dextérité|Constitution|Intelligence|Sagesse|Charisme)(?: de la cible)? (?:est réduite|diminue|baisse) de (?:${DICE})`, "i");

/**
 * - `equal` : « its Hit Point maximum decreases by an amount equal to the [Necrotic] damage taken » — `type` : ce type-là
 *   seulement (null : tous) ;
 * - `regains` : « and the vampire regains Hit Points equal to that amount » ;
 * - `fixed` : « the target's Hit Point maximum decreases by 14 ([[/r 4d6]]) » — une formule, sur une sauvegarde ratée ;
 * - `onFailedSave` : format 2014, « must succeed on a … saving throw or its Hit Point maximum is reduced by… » — la part
 *   égale aux dégâts ne se draine que si la sauvegarde que le toucher impose est ratée ;
 * - `ability` : « the target's Strength score decreases by [[/r 1d4]] » — { key, formula }, au toucher.
 * Une réduction « every 24 hours » (malédictions de la Momie, du Slaad) n'est pas un drain de combat : ignorée.
 * @param {string} html
 * @returns {{equal: boolean, type: string|null, regains: boolean, fixed: string|null, onFailedSave: boolean, ability: {key: string, formula: string}|null}}
 */
export function readDrain(html) {
  const raw = String(html ?? "").replace(/’/g, "'");
  const text = plain(raw);
  const none = { equal: false, type: null, regains: false, fixed: null, onFailedSave: false, ability: null };
  if ( /\bevery \d+ hours\b|\btoutes les \d+ heures\b/i.test(text) ) return none;
  const en = text.match(/Hit Point maximum (?:decreases|is reduced) by an amount equal to the (?:([A-Za-z]+) )?damage taken/i);
  const fr = text.match(/maximum de points de vie (?:est réduit|diminue|baisse) d'un montant égal aux dégâts (?:([a-zàâéèêîôû]+) )?subis/i);
  const equal = !!(en || fr);
  const type = en?.[1] ? en[1].toLowerCase() : (fr?.[1] ? (FRENCH_TYPES[fr[1].toLowerCase()] ?? null) : null);
  const regains = /\bregains Hit Points equal to that amount\b|\bregagne (?:autant de points de vie|un nombre de points de vie égal à ce montant)/i.test(text);
  const fixed = raw.match(/Hit Point maximum decreases by \d+ \(\[\[\/r ([^\]#]+?)(?:#[^\]]*)?\]\]\)/i)?.[1]?.trim() ?? null;
  const onFailedSave = equal && (/\bmust succeed on [^.]{0,80}saving throw or its Hit Point maximum/i.test(text)
    || /\bdoit réussir un jet de sauvegarde[^.]{0,80}sinon son maximum de points de vie/i.test(text));
  const a = raw.match(ABILITY_EN) ?? raw.match(ABILITY_FR);
  const ability = a ? { key: ABILITIES[a[1].toLowerCase()], formula: (a[2] ?? a[3]).trim() } : null;
  return { equal, type, regains, fixed, onFailedSave, ability };
}

/** Le texte dit-il un drain que le moteur sait jouer ? */
export const drains = rule => !!(rule && (rule.equal || rule.fixed || rule.ability));

/**
 * La part drainée de dégâts calculés (valeurs finales par type, après résistances) : ceux du type nommé, ou tous les dégâts
 * (hors soins et PV temporaires) ; jamais plus que le total subi.
 * @param {Array<{type: string, value: number}>} damages
 * @param {string|null} type
 * @param {number} [amount]   Total subi.
 */
export function drainedAmount(damages, type, amount) {
  const skip = new Set(["healing", "temphp", "maximum"]);
  const sum = damages.filter(d => (d.value > 0) && !skip.has(d.type) && (!type || (d.type === type))).reduce((n, d) => n + d.value, 0);
  return Math.max(0, Math.min(Math.trunc(sum), Math.trunc(amount ?? sum)));
}

/**
 * L'effet qui porte un drain sur la cible : un seul par source et par grandeur drainée, dont le total grossit à chaque drain.
 * Maximum de PV : `hp.tempmax` (que dnd5e ajoute au maximum, data/actor/templates/attributes.mjs:468), jusqu'au repos long
 * (« until the target finishes a Long Rest ») ; caractéristique : jusqu'au repos long aussi (le Monster Manual 2024 ne dit
 * pas de durée ; choix de l'utilisateur, 2026-10-07).
 * @param {{kind: "hp"|string, total: number}} drain   `kind` : "hp", ou la clé de la caractéristique.
 * @returns {{key: string, change: number, expiry: "longRest"}}
 */
export function drainEffectShape({ kind, total }) {
  if ( kind === "hp" ) return { key: "system.attributes.hp.tempmax", change: -total, expiry: "longRest" };
  return { key: `system.abilities.${kind}.value`, change: -total, expiry: "longRest" };
}

/**
 * §120 : ce que l'auteur regagne (clé `lifesteal`, Caresse du vampire) — une part des dégâts de ce type infligés, arrondie à
 * l'entier inférieur (« la moitié des dégâts nécrotiques infligés »).
 * @param {Array<{value: number, type: string}>} damages
 * @param {{damageType?: string, fraction?: number}} rule
 * @returns {number}
 */
export function lifestealAmount(damages, { damageType=null, fraction=1 }={}) {
  return Math.max(0, Math.floor(drainedAmount(damages, damageType) * fraction));
}
