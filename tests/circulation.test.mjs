/**
 * Gardiens de circulation (§406) : comment une information doit circuler dans le moteur, tenu par la lecture du code — comme
 * tests/layers.test.mjs tient les couches. Chaque règle dit le défaut qu'elle empêche ; chaque exception est listée, avec sa raison.
 * Une exception qui ne correspond plus à aucun appel fait échouer le test : la liste reste juste.
 * Référence : prive/ARCHITECTURE.md, « Règles de circulation ».
 */
import { describe, it, expect } from "vitest";
import { allFiles, callsIn, code, lineAt, enclosing } from "./source-scan.mjs";

const FILES = allFiles();
const key = site => `${site.file}#${site.fn}`;

/** Vérifie une liste de sites contre une liste blanche `{ "fichier#fonction": raison }` : rend les fautifs et les exceptions mortes. */
function check(sites, allowed) {
  const bad = sites.filter(s => !s.ok && !(key(s) in allowed)).map(s => `${s.file}:${s.line} (${s.fn}) — ${s.what}`);
  const used = new Set(sites.filter(s => !s.ok).map(key));
  const stale = Object.keys(allowed).filter(k => !used.has(k));
  return { bad, stale };
}

/* -------------------------------------------- */
/*  1. Les dés d'une activité au niveau de lancement (§404)
/* -------------------------------------------- */

/**
 * Une activité relue par son uuid (`fromUuid(message.system.activity.uuid)`), prise sur la fiche (`item.system.activities.get`) ou
 * par `getAssociatedActivity()` sans `{ scaled: true }` est celle de la fiche, **au niveau de base** : ses dés « Using a Higher-Level
 * Spell Slot » manquent (§404 : Orbe chromatique lancée au niveau 3 → 3d8 au lieu de 5d8, présent de 0.166.0 à 0.281.1). Toute
 * fonction qui lance les dés d'une activité (`rollDamage`, `getDamageConfig`, une formule d'activité dans `new Roll`) passe donc par
 * le niveau de lancement : `atCastLevel` (core/usage.mjs), `item.scaledClone(n)`, `getAssociatedActivity({ scaled: true })` ou
 * `followUpScaling` — ou figure ci-dessous avec sa raison.
 */
const CAST_LEVEL = /atCastLevel\(|scaledClone\(|scaled:\s*true|followUpScaling\(/;

const CAST_LEVEL_EXCEPTIONS = {
  "adapter/defenses.mjs#spendHitDiceToHeal": "dés de vie dépensés (Résilience…) : le nombre est choisi, rien ne monte avec un emplacement",
  "adapter/inspiration.mjs#offerRollBonus": "dé ajouté à un jet (Inspiration, Chanceux, Se ressaisir) : formule de la règle, pas de montée",
  "adapter/regeneration.mjs#regenerate": "Régénération d'un monstre : une aptitude, jamais lancée avec un emplacement",
  "adapter/usage.mjs#hasDamageParts": "ne lance rien : regarde seulement si l'activité a des dés de dégâts",
  "runtime/correction.mjs#rollDamage": "reçoit l'activité déjà au niveau choisi (applyCorrection : `item.scaledClone(scaling)`)",
  "runtime/cure.mjs#sharePool": "repli quand le jet de dnd5e manque : le chemin normal lit le message `healing` de dnd5e, déjà au niveau "
    + "lancé ; réserves d'aptitudes (Survivance, Châtiment exaltant…) et Guérison de groupe (niveau 9, ne monte pas)",
  "runtime/felled.mjs#onResolution": "soin d'une aptitude déclenché par une créature qui tombe (`fellRule`) : aucun sort, aucune montée",
  "runtime/maneuver-dice.mjs#onPostUse": "dé de supériorité (Maître de guerre) : la taille suit le niveau de classe, pas un emplacement",
  "runtime/maneuver-dice.mjs#chosenAc": "dé de supériorité (Parade) : même raison"
};

/** Les sites qui lancent des dés d'une activité. */
function diceSites() {
  const sites = [];
  for ( const file of FILES ) {
    for ( const c of callsIn(file, /rollDamage|getDamageConfig/) ) {
      sites.push({ file, line: c.line, fn: c.fn.name, ok: CAST_LEVEL.test(c.fn.body), what: `.${c.method}( sans niveau de lancement` });
    }
    const text = code(file);
    for ( const m of text.matchAll(/new\s+(?:Roll|CONFIG\.Dice\.DamageRoll)\(([^\n]*)/g) ) {
      // Une formule tirée d'une activité : sa formule de soin, de jet (`roll.formula`), ou les données de jet de l'activité.
      if ( !/activit|\.healing\b|\.roll\.formula/.test(m[1]) ) continue;
      const fn = enclosing(text, m.index);
      sites.push({ file, line: lineAt(text, m.index), fn: fn.name, ok: CAST_LEVEL.test(fn.body), what: "formule d'activité sans niveau de lancement" });
    }
  }
  return sites;
}

describe("circulation 1 — les dés d'une activité au niveau de lancement (§404)", () => {
  it("toute fonction qui lance les dés d'une activité passe par le niveau de lancement, ou est une exception justifiée", () => {
    const { bad, stale } = check(diceSites(), CAST_LEVEL_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale, "exceptions qui ne servent plus : à retirer").toEqual([]);
  });

  it("le gardien voit bien le défaut du §404 (une relecture par uuid sans atCastLevel)", () => {
    const fn = "async function f(m) { const a = await fromUuid(m.system.activity.uuid); return a.rollDamage({}, {}, { data: { system: { origin: m.id } } }); }";
    expect(CAST_LEVEL.test(fn)).toBe(false);
    expect(CAST_LEVEL.test(fn.replace("a.rollDamage", "atCastLevel(a, 2).rollDamage"))).toBe(true);
  });
});

/* -------------------------------------------- */
/*  2. Un jet rattaché à sa carte d'origine
/* -------------------------------------------- */

/**
 * Un jet d'attaque ou de dégâts lancé par le moteur porte la carte d'utilisation qui l'a produit (`data.system.origin`, comme le
 * bouton de la carte de dnd5e, activity/attack.mjs). Sans elle, le jet se « porte » lui-même : la résolution qui attend ce jet ne le
 * reconnaît pas (bloquée en `awaitingAttack`), le niveau de lancement (`system.scaling` du message d'origine, §404) et le type de dégâts
 * choisi (§16) sont perdus.
 */
const ORIGIN_EXCEPTIONS = {
  "adapter/messages.mjs#rollDamageForAttack": "`system` bâti plus haut avec `origin: originOf(attackMessage)` (et les cibles, §373)",
  "runtime/ammo.mjs#onPreRollAttack": "relance le même jet après le choix de la munition, avec la configuration de message d'origine (`message`)"
};

describe("circulation 2 — jets rattachés à leur carte d'origine", () => {
  it("tout rollAttack / rollDamage du moteur passe `system.origin`, ou est une exception justifiée", () => {
    const sites = FILES.flatMap(file => callsIn(file, /rollAttack|rollDamage/).map(c => ({
      file, line: c.line, fn: c.fn.name, ok: /\borigin\b/.test(c.args), what: `.${c.method}( sans system.origin`
    })));
    const { bad, stale } = check(sites, ORIGIN_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale, "exceptions qui ne servent plus : à retirer").toEqual([]);
  });
});

/* -------------------------------------------- */
/*  3. La position validée d'un token, pas sa position animée
/* -------------------------------------------- */

/**
 * Piège de Foundry V14 (vu le 2026-09-20, adapter/turn.mjs `committedPosition`) : `token.x` / `token.y` d'un TokenDocument et
 * `token.object.center` suivent l'animation du déplacement ; lus juste après un `move`, ils donnent encore une case de départ (dans un
 * onglet masqué, toujours). Toute mesure du moteur (adapter/, runtime/, core/) part de `token._source` : `committedPosition`,
 * `getCenterPoint(token._source)`. L'interface (ui/) peut dessiner à la position animée. Le gardien lit les noms usuels d'un token
 * (`token`, `tok`) et toute lecture par `.document` ou `.object` ; il a trouvé deux défauts à sa création (§406 : Ténèbres qui dissipent
 * les lumières de sort, zones de sort proches d'un lanceur).
 */
const ANIMATED = /\b(?:token|tok)\??\.(?:x|y)\b|\.document\??\.(?:x|y)\b|\.object\??\.(?:x|y|center)\b|getCenterPoint\??\.?\(\s*\)/g;
const ANIMATED_EXCEPTIONS = {};

describe("circulation 3 — position validée (`_source`), pas animée", () => {
  it("adapter/, runtime/, core/ ne lisent pas token.x, .document.x, .object.center ni getCenterPoint() sans `_source`", () => {
    const sites = [];
    for ( const file of FILES.filter(f => /^(adapter|runtime|core)\//.test(f) && !/testing/.test(f)) ) {
      const text = code(file);
      for ( const m of text.matchAll(ANIMATED) ) {
        sites.push({ file, line: lineAt(text, m.index), fn: enclosing(text, m.index).name, ok: false, what: m[0] });
      }
    }
    const { bad, stale } = check(sites, ANIMATED_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });
});
