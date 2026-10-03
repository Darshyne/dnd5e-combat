# darsh-dnd · Core (`dnd5e-combat`)

Moteur de règles et de combat D&D 5.5 (règles 2024) pour **Foundry VTT V14** et **dnd5e 6.x**. C'est le cœur
de la suite *darsh-dnd* : un seul module possède toute la boucle de combat, à la place de Midi-QOL, CPR et
consorts.

- **Économie d'action et légalité** : budget du tour, portée et allonge, contrôle doux de ce qui est permis.
- **Résolution** : attaques, jets de sauvegarde (ceux des PNJ sont lancés par le moteur, ceux des joueurs
  s'ouvrent sur leur écran), zones et zones persistantes, concentration, conditions → avantage/désavantage.
- **Réactions** avant et après le jet adverse (Bouclier, Représailles infernales, attaques d'opportunité
  résolues *avant* le déplacement…), auras, déclencheurs de début et de fin de tour.
- **Déplacement à la souris** façon Baldur's Gate 3 : clic au sol = trajet (A* maison), clic sur un ennemi =
  attaque de base, menus contextuels, mode ciblage.
- **Vision et lumière des règles** : qui voit qui, lumière vive / faible / ténèbres, Fouille, Perception passive.
- Classes et espèces du *Player's Handbook 2024* automatisées, ainsi que de nombreuses capacités de monstres.
  Les règles sont déclarées par identifiant dnd5e : elles valent pour toute créature, PJ ou PNJ.

Le moteur ne modifie ni le cœur ni le système : il passe par les hooks publics. Il publie une API pour les
modules voisins (`game.modules.get("dnd5e-combat").api`) : état d'interface (`api.ui`), approche d'un token
(`api.approach`), contenu par identifiant (`api.content`), et des hooks génériques (`dnd5e-combat.claimClick`,
`dnd5e-combat.tokenMenu`, `dnd5e-combat.dropItems`…). Il ne connaît aucun de ses voisins par leur nom.

Un module de créatures peut déclarer les règles de ses propres capacités, par identifiant dnd5e, sans toucher
au moteur :

```js
Hooks.once("dnd5e-combat.registerContent", register => register("mon-module", {
  "mon-identifiant": { /* clés décrites en tête de module/scripts/core/content.mjs */ }
}));
```

Ou `api.content.register(source, table)` après coup. Chaque entrée est validée comme le contenu livré.

## Suite darsh-dnd

| Module | Rôle |
|---|---|
| [`dnd5e-combat`](https://github.com/Darshyne/dnd5e-combat) | Ce module : règles, combat, déplacement, vision |
| [`darsh-dnd-ui`](https://github.com/Darshyne/darsh-dnd-ui) | Interface de combat (barre d'actions, portraits, frise d'initiative) |
| [`darsh-loot`](https://github.com/Darshyne/darsh-loot) | Butin, conteneurs, vol, marchands |
| [`dnd5e-lumiere`](https://github.com/Darshyne/dnd5e-lumiere) | Ombres et ambiance, purement visuel |
| [`darsh-animations`](https://github.com/Darshyne/darsh-animations) | Animations Boss Loot (BLFX) pour les capacités qu'il ne reconnaît pas |

## Installation

Dans Foundry (ou sur The Forge), *Installer un module* → coller l'URL de manifeste :

```
https://github.com/Darshyne/dnd5e-combat/releases/latest/download/module.json
```

Depuis les sources : le module Foundry est le
sous-dossier `module/`, à copier ou lier dans `Data/modules/dnd5e-combat`. Les compendiums ne sont pas
versionnés : `npm install` puis `npm run packs`, Foundry fermé.

- Requiert : Foundry V14, dnd5e ≥ 6.0.0. Incompatible avec Midi-QOL.
- Tests : `npm test` (Vitest ; le cœur des règles est pur et se teste hors de Foundry).

État : en développement actif, utilisé à la table de l'auteur. Interface et textes en français.

## Licence

Code sous licence MIT (voir `LICENSE`).

Ce travail inclut des éléments du System Reference Document 5.2 (« SRD 5.2 ») de Wizards of the Coast LLC,
disponible sur https://www.dndbeyond.com/srd. Le SRD 5.2 est sous licence Creative Commons Attribution 4.0
International, disponible sur https://creativecommons.org/licenses/by/4.0/legalcode.

Ce module n'est ni affilié à Wizards of the Coast ni approuvé par elle. Il ne contient aucun contenu des
livres ou modules premium : il automatise les objets que ces modules fournissent, à partir de leur
identifiant dnd5e.
