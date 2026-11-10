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

/**
 * 1 bis (§406) : la même règle pour une activité que le moteur **réutilise** plus tard d'après un message d'utilisation (une zone qui
 * tombe, une impulsion au tour du lanceur, un sort préparé) : `activity.use()` recalcule la montée d'après l'emplacement proposé, au
 * niveau du sort (§405) — sans `scaling` ni emplacement dans la configuration, l'activité part au niveau de base. Trouvé à la création du
 * gardien : l'explosion de la Boule de feu à retardement (`zoneEnd`, runtime/areas.mjs). Le gardien regarde les `.use(` des fonctions
 * qui relisent un message d'utilisation ; la configuration passe `scaling`, un `slot` ou `castLevelUsage` (core/usage.mjs).
 */
const REUSE_EXCEPTIONS = {
  "runtime/after-sneak.mjs#onResolution": "aptitude après une Attaque sournoise (`afterSneak`) : pas un sort, rien ne monte",
  "runtime/correction.mjs#correctZone": "la configuration `usage` est bâtie plus haut avec l'emplacement du niveau choisi par le MJ (`slotKey`)"
};

describe("circulation 1 bis — une activité réutilisée d'après un message d'utilisation garde son niveau (§406)", () => {
  it("tout .use( d'une fonction qui relit un message d'utilisation passe la montée, ou est une exception justifiée", () => {
    const sites = FILES.filter(f => !/testing/.test(f)).flatMap(file => callsIn(file, /use/)
      .filter(c => /game\.messages\.get\(|usageMessage|getAssociatedActivity\(|\.usage/.test(c.fn.body))
      .map(c => ({ file, line: c.line, fn: c.fn.name, ok: /scaling|castLevelUsage\(|followUpScaling\(|slot/.test(c.args),
        what: ".use( sans niveau de lancement" })));
    const { bad, stale } = check(sites, REUSE_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
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

/* -------------------------------------------- */
/*  4. Des dégâts typés, pas un nombre nu
/* -------------------------------------------- */

/**
 * `Actor5e#applyDamage(nombre)` met `options.ignore = true` : résistances, immunités et vulnérabilités sont sautées (dnd5e 6.0.6,
 * dnd5e.mjs:43266-43269). Le moteur passe toujours une liste `[{ value, type, properties }]` — un littéral, ou une liste nommée
 * `damages` / `applied` bâtie plus haut (adapter/messages.mjs `applyDamageToToken`). Un nombre nu n'est voulu que là où la règle
 * l'exige, listé ci-dessous.
 */
const TYPED_DAMAGE_EXCEPTIONS = {
  "runtime/engine-commands.mjs#COMMANDS": "« elle tombe à 0 PV » (Regard mortel, K2 §323) : des dégâts égaux à ses PV, sans type ni résistance",
  "runtime/triggers.mjs#onDamaged": "Lien protecteur sans formule (§156) : le lanceur subit le même montant que le porteur, déjà après ses résistances, sans type"
};

describe("circulation 4 — applyDamage reçoit des dégâts typés", () => {
  it("tout applyDamage du moteur passe une liste [{ value, type }], ou est une exception justifiée", () => {
    const sites = FILES.filter(f => !/testing/.test(f)).flatMap(file => callsIn(file, /applyDamage/).map(c => {
      const first = c.args.trim();
      const ok = first.startsWith("[") || /^(damages|applied)\b/.test(first);
      return { file, line: c.line, fn: c.fn.name, ok, what: `applyDamage(${first.replace(/\s+/g, " ").slice(0, 40)}…)` };
    }));
    const { bad, stale } = check(sites, TYPED_DAMAGE_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  5. Le niveau de lancement d'un message : `system.scaling`
/* -------------------------------------------- */

/**
 * dnd5e 6 note la montée d'emplacement sur le message d'utilisation dans `system.scaling` (dnd5e.mjs:17956) ; `flags.dnd5e.scaling`
 * n'existe que sur un item cloné (`scaledClone`) ou un effet (concentration, effet appliqué), et la migration le retire des messages
 * (dnd5e.mjs:94993). Lu sur un message, il vaut toujours rien : trois défauts à la création du gardien (§406 — Globe d'invulnérabilité,
 * Façonneur de sorts, copies données par un sort, tous au niveau de base). Le gardien refuse `getFlag("dnd5e", "scaling")` et
 * `flags.dnd5e.scaling` lus sur un nom de message (`message`, `msg`, `m`, `usage`, `carrier`, `usageMessage`, `origin`…).
 */
const MESSAGE_SCALING_FLAG = /\b(?:message|msg|m|usage|usageMessage|carrier|origin|originMessage|card|attackMessage)\??\.(?:getFlag\??\.?\(\s*"dnd5e"\s*,\s*"scaling"|flags\??\.dnd5e\??\.scaling)/g;

describe("circulation 5 — la montée d'un message se lit dans system.scaling", () => {
  it("aucun message n'est lu par flags.dnd5e.scaling", () => {
    const bad = [];
    for ( const file of FILES ) {
      const text = code(file);
      for ( const m of text.matchAll(MESSAGE_SCALING_FLAG) ) bad.push(`${file}:${lineAt(text, m.index)} — ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  /**
   * Une carte d'utilisation fabriquée par le moteur (zone rejouée, sauvegarde répétée, impulsion, émanation, riposte, correction) porte
   * la montée : elle recopie le `system` d'une vraie carte d'utilisation, ou passe `scaling` (`cardScaling`, adapter/areas.mjs).
   * Sans elle, `getAssociatedActivity({ scaled: true })` rend l'activité au niveau de base (trouvé à la création : riposte par
   * sauvegarde et les cinq fabriques `getCardData` d'adapter/areas.mjs).
   */
  it("toute carte `type: \"usage\"` créée par le moteur porte `scaling` ou recopie le `system` d'une carte d'utilisation", () => {
    const bad = [];
    for ( const file of FILES.filter(f => !/testing/.test(f)) ) {
      const text = code(file);
      for ( const m of text.matchAll(/type:\s*"usage"/g) ) {
        const fn = enclosing(text, m.index);
        if ( !/\bscaling\b|cardScaling\(|\.\.\.\s*\w*[Mm]essage\??\.system\b|\.\.\.\s*usage\??\.system\b/.test(fn.body) ) bad.push(`${file}:${lineAt(text, m.index)} (${fn.name})`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  6. La carte d'origine par son id : `_source.system.origin`
/* -------------------------------------------- */

/**
 * `system.origin` d'un message de dnd5e est un `ForeignDocumentField` (dnd5e.mjs:86248) : lu sur le document, il rend le message
 * d'origine lui-même (ou null), pas son id — `game.messages.get(message.system.origin)` ne trouve jamais rien. L'id se lit dans
 * `_source.system.origin` (adapter/messages.mjs `originOf`) ; dans une configuration de message (`messageConfig.data.system.origin`), c'est
 * bien un id. Défaut trouvé à la création (§406) : le niveau de lancement d'une attaque relu sur la carte d'attaque au lieu de la carte
 * d'utilisation (runtime/engine-messages.mjs).
 */
describe("circulation 6 — l'id de la carte d'origine se lit dans _source", () => {
  it("aucun game.messages.get(…system.origin) hors de `_source` ou d'une configuration `data.system.origin`", () => {
    const bad = [];
    for ( const file of FILES ) {
      const text = code(file);
      for ( const m of text.matchAll(/messages\.get\(([^)]*?)\bsystem\??\.origin\b/g) ) {
        if ( /_source\??\.$|data\??\.$/.test(m[1]) ) continue;
        bad.push(`${file}:${lineAt(text, m.index)} — ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  7. Un item reconnu par identifierOf, pas par son identifiant brut
/* -------------------------------------------- */

/**
 * Un item créé sans identifiant (premium, ou dans un client en français) reçoit de dnd5e `formatIdentifier(nom)` — le nom **traduit**
 * par Babele (dnd5e.mjs:35923-35926) : « pied-de-biche » au lieu de « crowbar ». Le moteur reconnaît un item par `identifierOf`
 * (adapter/content.mjs : source, nom anglais gardé par Babele…) et lit son contenu par `contentOf`. Comparer `system.identifier` à une
 * valeur n'est voulu que là où l'on lit des données brutes, listé ci-dessous. Défaut trouvé à la création (§406) : le Pied-de-biche
 * (runtime/doors.mjs).
 */
const RAW_IDENTIFIER_EXCEPTIONS = {
  "adapter/apply-effects.mjs#lostEffectOf": "index d'un compendium (données sources, identifiant anglais du module)",
  "adapter/sneak.mjs#owns": "identifierOf d'abord ; l'identifiant brut en repli, pour un item que le moteur a lui-même créé",
  "adapter/turn.mjs#costFor": "l'item d'action de base que le moteur crée lui-même, d'identifiant fixe (`dnd5e-combat-search`)",
  "runtime/diagnostic/checks.mjs#officialFor": "diagnostic : compare les données brutes d'un monde à celles du compendium",
  "runtime/diagnostic/checks.mjs#cleanActor": "diagnostic : nettoyage Midi d'une fiche, sur les identifiants bruts de ses items",
  "runtime/diagnostic/checks.mjs#creatures": "diagnostic : répare justement l'identifiant brut"
};

describe("circulation 7 — un item se reconnaît par identifierOf", () => {
  it("aucune comparaison de system.identifier hors des exceptions justifiées", () => {
    const sites = [];
    for ( const file of FILES.filter(f => /^(adapter|runtime|ui)\//.test(f) && !/testing/.test(f)) ) {
      const text = code(file);
      for ( const m of text.matchAll(/system\??\.identifier\s*(?:===|!==)|(?:===|!==)\s*[\w.?]*system\??\.identifier\b/g) ) {
        sites.push({ file, line: lineAt(text, m.index), fn: enclosing(text, m.index).name, ok: false, what: m[0] });
      }
    }
    const { bad, stale } = check(sites, RAW_IDENTIFIER_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });
});
