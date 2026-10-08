/**
 * Actions de base livrées comme items (SPEC §15.2, tranché le 2026-09-23 : des items plutôt que des
 * cases ajoutées par le moteur — un item passe par la même légalité et le même budget que le reste,
 * et la fiche, la barre d'actions et le menu le montrent sans rien de plus). Le moteur les crée sur les
 * personnages des joueurs (runtime/basics.mjs) ; il les reconnaît à `flags["dnd5e-combat"].basicAction`.
 * Noms et textes dans lang/ (`DND5ECOMBAT.Action.<clé>`), d'après le Manuel des joueurs 2024 en français.
 *
 * `turnFlag` : l'état du tour que l'action pose (core/turn.mjs, `basicAction`). Sans lui, l'action
 * coûte ce que dit son activation, comme n'importe quel item.
 */

export const BASIC_ACTIONS = Object.freeze({
  dash: { img: "icons/svg/wingfoot.svg", activityId: "dnd5eCombatDash0" },
  disengage: { img: "icons/svg/door-exit.svg", activityId: "dnd5eCombatDseng" },
  dodge: { img: "icons/svg/shield.svg", activityId: "dnd5eCombatDodge" },
  // S'échapper d'une empoignade (runtime/grapple.mjs) : une action, test d'Athlétisme ou d'Acrobaties.
  escape: { img: "icons/svg/net.svg", activityId: "dnd5eCombatEscap" },
  // Intention (Ready) : l'action est dépensée, l'état « Intention » montré ; le déclencheur reste au joueur.
  ready: { img: "icons/svg/clockwork.svg", activityId: "dnd5eCombatReady" },
  // Furtivité (Hide) : Discrétion DD 15, hors de vue de tout ennemi (runtime/hide.mjs).
  hide: { img: "icons/svg/cowled.svg", activityId: "dnd5eCombatHide0" },
  // Chercher (Search) : Sagesse (Perception) contre les créatures cachées, lumière comprise (runtime/search.mjs).
  search: { img: "icons/svg/eye.svg", activityId: "dnd5eCombatSrch0" },
  // Soutien (Help), partie attaque : sur un ennemi à 1,50 m (runtime/help.mjs).
  help: { img: "icons/svg/aura.svg", activityId: "dnd5eCombatHelp0",
    activity: { target: { affects: { type: "creature", count: "1" }, prompt: false }, range: { override: true, units: "touch" } } },
  // Attaque à mains nues 2024 (d'après l'item du Barbare de dnd5e 6, classes24/barbarian/class-features/
  // unarmed-strike.yml) : une attaque (1 + For, contondant) et « Lutte / Bousculade », une sauvegarde de
  // Force ou de Dextérité (au mieux de la cible) contre 8 + For + maîtrise. Un item d'identifiant
  // `unarmed-strike` déjà présent (Moine, Barbare) tient lieu du nôtre.
  // `attack` : une attaque — un familier ne la reçoit pas (« un familier ne peut pas attaquer », §107).
  unarmed: {
    attack: true,
    img: "icons/skills/melee/unarmed-punch-fist-yellow-red.webp",
    identifier: "unarmed-strike",
    activityId: "dnd5eCombatUnarm",
    saveActivityId: "dnd5eCombatGrShv",
    // Trois effets exclusifs (content/choices.mjs) : agrippé, à terre, repoussé. Le dernier n'est
    // jamais posé : le moteur le lit comme une poussée (runtime/engine.mjs).
    effects: {
      grappled: { id: "dnd5eCombatGrapl", status: "grappled", img: "systems/dnd5e/icons/svg/statuses/grappled.svg" },
      prone: { id: "dnd5eCombatProne", status: "prone", img: "systems/dnd5e/icons/svg/statuses/prone.svg" },
      pushed: { id: "dnd5eCombatPush0", push: { distance: 5, units: "ft" }, img: "icons/svg/thrust.svg" }
    }
  }
});
