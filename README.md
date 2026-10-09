# DAS · Core (`dnd5e-combat`)

A D&D 5.5 (2024 rules) rules and combat engine for **Foundry VTT V14** and **dnd5e 6.x**. It is the core of
**Darshyne's Automation Suite (DAS)**: a single module owns the whole combat loop, replacing Midi-QOL, CPR and the like.

- **Action economy and legality**: per-turn budget, range and reach, soft checks on what is allowed.
- **Resolution**: attacks, saving throws (NPC saves are rolled by the engine, player saves open on the player's
  own screen), areas and lingering zones, concentration, conditions → advantage/disadvantage.
- **Reactions** before and after the opposing roll (Shield, Hellish Rebuke, opportunity attacks resolved
  *before* the move…), auras, start- and end-of-turn triggers.
- **Mouse-driven movement** in the style of Baldur's Gate 3: click the ground to move along a path (custom A*),
  click an enemy to make a basic attack, context menus, targeting mode.
- **Vision and light rules**: who sees whom, bright light / dim light / darkness, Search, passive Perception.
- Every class and species of the *Player's Handbook 2024* is automated, along with many monster abilities.
  Rules are declared per dnd5e identifier, so they apply to any creature, PC or NPC.

The engine patches neither the Foundry core nor the system: it only uses public hooks. It exposes an API for
neighbouring modules (`game.modules.get("dnd5e-combat").api`): UI state (`api.ui`), walking a token up to a
target (`api.approach`), stopping this client's walks (`api.stopWalks`), the turn budget (`api.budget.issues` /
`api.budget.spend`), content by identifier (`api.content`), and generic hooks (`dnd5e-combat.claimClick`,
`dnd5e-combat.tokenMenu` — on other tokens and on one's own —, `dnd5e-combat.dropItems`…). It does not know any of its
neighbours by name.

A creature module can declare the rules for its own abilities, by dnd5e identifier, without touching the
engine:

```js
Hooks.once("dnd5e-combat.registerContent", register => register("my-module", {
  "my-identifier": { /* keys documented at the top of module/scripts/core/content.mjs */ }
}));
```

Or call `api.content.register(source, table)` later on. Each entry is validated just like the bundled content.

For tools that build rules without code, `api.content.recipes` describes the common building blocks (bonus damage,
advantage, condition on a hit or a failed save, push/pull, repeated save, lasting zone, aura, reaction, teleport,
summon…) as typed form fields, and `api.content.recipes.build(recipes, { identifier })` turns them into an entry
(`module/scripts/core/recipes.mjs`). [DAS · Homebrew](https://github.com/Darshyne/darsh-homebrew) uses it.

## Darshyne's Automation Suite

| Module | Role |
|---|---|
| [`dnd5e-combat`](https://github.com/Darshyne/dnd5e-combat) | This module: rules, combat, movement, vision |
| [`darsh-dnd-ui`](https://github.com/Darshyne/darsh-dnd-ui) | Combat UI (action bar, party portraits, initiative strip) |
| [`darsh-loot`](https://github.com/Darshyne/darsh-loot) | Loot, containers, theft, merchants |
| [`dnd5e-lumiere`](https://github.com/Darshyne/dnd5e-lumiere) | Shadows and ambience, purely visual |
| [`darsh-animations`](https://github.com/Darshyne/darsh-animations) | Boss Loot (BLFX) animations for abilities it does not recognise |
| [`darsh-homebrew`](https://github.com/Darshyne/darsh-homebrew) | Step-by-step creator of automated items, no code |

## Installation

In Foundry (or on The Forge), *Install Module* → paste the manifest URL:

```
https://github.com/Darshyne/dnd5e-combat/releases/latest/download/module.json
```

From source: the Foundry module is the `module/` subfolder, to copy or link into `Data/modules/dnd5e-combat`.
Compendiums are not versioned: run `npm install` then `npm run packs`, with Foundry closed.

- Requires: Foundry V14, dnd5e ≥ 6.0.0. Incompatible with Midi-QOL.
- Tests: `npm test` (Vitest; the rules core is pure and can be tested outside Foundry).

Status: under active development, used at the author's table. The in-game interface and texts are in French
only for now.

## License

Code under the MIT license (see `LICENSE`).

This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC,
available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0
International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

This module is not affiliated with, nor endorsed by, Wizards of the Coast. It contains no content from the
premium books or modules: it automates the items those modules provide, based on their dnd5e identifier.
