import { describe, it, expect } from "vitest";
import { sizeLimitIn, sizeGateOf, siblingSaveOf, announcesHitSave } from "../module/scripts/core/riders.mjs";

describe("porte de taille (M3)", () => {
  it("lit la taille en anglais et en français", () => {
    expect(sizeLimitIn("Large or smaller")).toBe("lg");
    expect(sizeLimitIn("a Medium or smaller creature")).toBe("med");
    expect(sizeLimitIn("de taille G ou inférieure")).toBe("lg");
    expect(sizeLimitIn("une créature de taille TG ou inférieure Agrippée")).toBe("huge");
    expect(sizeLimitIn("de taille M ou inferieure")).toBe("med");
    expect(sizeLimitIn("that isn’t an Undead or elf")).toBeNull();
    expect(sizeLimitIn("")).toBeNull();
  });

  it("préfère la valeur de l'activité", () => {
    expect(sizeGateOf({ special: "Medium or smaller", description: "<p>If the target is a Huge or smaller creature…</p>" })).toBe("med");
  });

  it("lit la phrase « If the target is » de la description (Queue du Tyrannosaure)", () => {
    const description = "<p>[[/attack extended]]. [[/damage average extended]]. If the target is a Huge or smaller creature, it has the &amp;Reference[Prone apply=false] condition.</p>";
    expect(sizeGateOf({ description })).toBe("huge");
  });

  it("résout un lookup vers l'activité sœur (Défense du Sanglier)", () => {
    const description = "<p>[[/attack extended]]. [[/damage average extended]]. If the target is a [[lookup @target.affects.type activity=abcdefghijklmnop]] [[lookup @target.affects.special activity=abcdefghijklmnop]] and the boar moved 20+ feet straight toward it immediately before the hit, the target takes an extra 3 (1d6) damage and has the Prone condition.</p>";
    expect(sizeGateOf({ description, specialOf: id => (id === "abcdefghijklmnop" ? "Medium or smaller" : "") })).toBe("med");
  });

  it("en français (Morsure du Loup traduite)", () => {
    const description = "<p>[[/attack extended]]. [[/damage average extended]]. Si la cible est une créature de taille M ou inférieure, elle subit l'état &amp;Reference[Prone apply=false].</p>";
    expect(sizeGateOf({ description })).toBe("med");
  });

  it("« If target is », sans article (Déchirure de la Bête éclipsante)", () => {
    expect(sizeGateOf({ description: "<p>[[/attack extended]]. [[/damage average extended]]. If target is a Large or smaller creature, it has the Prone condition.</p>" })).toBe("lg");
  });

  it("ignore une taille hors de la phrase sur la cible", () => {
    expect(sizeGateOf({ description: "<p>The blob can move through the spaces of Huge or smaller creatures.</p>" })).toBeNull();
    expect(sizeGateOf({ description: "<p>[[/attack extended]]. [[/damage average extended]].</p>" })).toBeNull();
  });
});

const GHOUL = "<p>[[/attack extended]]. [[/damage average extended]]. If the target is a [[lookup @target.affects.type activity=u64Kjp19EAOJoLeo]] [[lookup @target.affects.special activity=u64Kjp19EAOJoLeo]], it is subjected to the following effect.</p><p><em>Constitution Saving Throw:</em> DC [[lookup @save.dc.value activity=u64Kjp19EAOJoLeo]].</p><p><em>Failure:</em> The target has the Paralyzed condition until the end of its next turn.</p>";

describe("amorce d'une sauvegarde au toucher", () => {
  it("formules du MM, en anglais et en français", () => {
    expect(announcesHitSave(GHOUL)).toBe(true);
    expect(announcesHitSave("<p>[[/attack extended]]. [[/damage average extended]]. If the target is a creature, it must make the following saving throw.</p>")).toBe(true);
    expect(announcesHitSave("<p>[[/attack extended]]. Si la cible est une créature qui n’est ni un Mort-vivant ni un elfe, elle est soumise à l’effet suivant.</p>")).toBe(true);
    expect(announcesHitSave("<p>La cible subit en outre l'effet suivant.</p>")).toBe(true);
  });

  it("fiches au format 2014 et leurs traductions : la sauvegarde après « Hit: » / « Touché : »", () => {
    // Épée courte empoisonnée (synthétique, grammaire 2014) ; Bec de corbeau-garou ; Griffes et Morsure traduites.
    expect(announcesHitSave("<p>Melee Weapon Attack: [[/attack]] to hit, reach 5 ft., one target. Hit: [[/damage average]] damage, and the target must make a DC 15 Constitution saving throw, taking 24 ([[/r 7d6]]) poison damage on a failed save, or half as much damage on a successful one.</p>")).toBe(true);
    expect(announcesHitSave("<p>[[/attack extended]], reach 5 ft., one target. Hit: 1 piercing damage in raven form. If the target is a humanoid, it must succeed on a [[/save con 10 format=long]] or be cursed with wereraven lycanthropy.</p>")).toBe(true);
    expect(announcesHitSave("<p>Attaque d'arme au corps à corps : [[/attack]] au toucher, allonge 1,50 m, une créature. Touché : [[/damage average]] dégâts. Si la cible est une créature, elle doit réussir un jet de sauvegarde de Force DD 13 ou se retrouver &amp;Reference[Prone apply=false].</p>")).toBe(true);
    expect(announcesHitSave("<p>(Forme hybride uniquement) Attaque d’arme au corps à corps : [[/attack]] pour toucher. Touché : [[/damage average]] dégâts. Si la cible est un humanoïde, elle doit réussir un jet de sauvegarde de Constitution DD 10 ou être maudite.</p>")).toBe(true);
  });

  it("format 2014 sans « Hit: » : pas de sauvegarde au toucher (Attaque à mains nues, arme magique)", () => {
    expect(announcesHitSave("<p>Grapple. The target must succeed on a Strength or Dexterity saving throw (it chooses), or it has the Grappled condition.</p>")).toBe(false);
    expect(announcesHitSave("<p>When you hit a creature with this weapon, it must succeed on a DC 15 Constitution saving throw or be Poisoned.</p>")).toBe(false);
  });

  it("pas au toucher : Otyugh (après un repos long), objets du PHB", () => {
    expect(announcesHitSave("<p>[[/attack extended]]. [[/damage average extended]], and the target has the Poisoned condition. Whenever the Poisoned target finishes a Long Rest, it is subjected to the following effect.</p>")).toBe(false);
    expect(announcesHitSave("<p>See: &amp;Reference[unarmedstrike]</p>")).toBe(false);
    expect(announcesHitSave("<p>When you hit a Fiend or an Undead with this magic weapon, that creature takes an extra 2d6 Radiant damage. If the target has 25 Hit Points or fewer after taking this damage, it must succeed on a DC 15 Wisdom saving throw or be destroyed.</p>")).toBe(false);
  });
});

describe("sauvegarde sœur au toucher (M2)", () => {
  const attack = { id: "attackattackatta", type: "attack", activation: { type: "action" } };
  const save = (over={}) => ({ id: "savesavesavesave", type: "save", activation: { type: "" }, target: { template: { type: "" }, affects: { count: "1" } }, ...over });

  it("Griffe de la Goule : une attaque, une sauvegarde sans activation propre", () => {
    expect(siblingSaveOf([attack, save()], GHOUL)).toBe("savesavesavesave");
    expect(siblingSaveOf([attack, save({ activation: { type: "special" } })], GHOUL)).toBe("savesavesavesave");
    // Blême, lycanthropes : la sauvegarde porte l'activation « action » de l'attaque.
    expect(siblingSaveOf([attack, save({ activation: { type: "action" } }), { id: "summonsummonsumm", type: "summon", activation: { type: "action" } }], GHOUL)).toBe("savesavesavesave");
    expect(siblingSaveOf([attack, save(), { id: "escapeescapeesca", type: "check", activation: { type: "special" } }], GHOUL)).toBe("savesavesavesave");
  });

  it("ne devine pas : sans attaque, deux sauvegardes, une zone, une activation propre, plusieurs cibles", () => {
    expect(siblingSaveOf([save()], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save(), save({ id: "secondsecondseco" })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save({ target: { template: { type: "radius" } } })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save({ activation: { type: "reaction" } })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save({ activation: { type: "bonus" } })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack, save({ target: { affects: { count: "3" } } })], GHOUL)).toBeNull();
    expect(siblingSaveOf([attack], GHOUL)).toBeNull();
    // Même forme que la Griffe de la Goule, sans l'amorce : Coup à mains nues du PHB (Lutte/Bousculade).
    expect(siblingSaveOf([attack, save({ activation: { type: "action" } })], "<p>See: &amp;Reference[unarmedstrike]</p>")).toBeNull();
  });
});
