import { describe, it, expect } from "vitest";
import {
  selectAreaTargets, turnKeyOf, openArea, shouldTrigger, markHit, entersArea
} from "../module/scripts/core/area.mjs";

const c = (name, disposition, extra = {}) => ({ token: `T.${name}`, actor: `A.${name}`, name, disposition, ...extra });
const mage = c("Magicien", 1);
const guerrier = c("Guerrier", 1);
const zombi = c("Zombi", -1);
const goule = c("Goule", -1);
const all = [mage, guerrier, zombi, goule];
const names = list => list.map(t => t.name);

describe("selectAreaTargets", () => {
  it("un cône partant du lanceur ne le touche pas, mais touche ses alliés", () => {
    const out = selectAreaTargets(all, { origin: mage.token, originDisposition: 1, excludeOrigin: true, affects: "creature" });
    expect(names(out)).toEqual(["Guerrier", "Zombi", "Goule"]);
  });
  it("une boule de feu posée à distance touche aussi le lanceur s'il est dedans", () => {
    const out = selectAreaTargets(all, { origin: mage.token, originDisposition: 1, excludeOrigin: false, affects: "creature" });
    expect(names(out)).toEqual(["Magicien", "Guerrier", "Zombi", "Goule"]);
  });
  it("une zone « ennemis » épargne le camp du lanceur et le lanceur", () => {
    const out = selectAreaTargets(all, { origin: mage.token, originDisposition: 1, excludeOrigin: false, affects: "enemy" });
    expect(names(out)).toEqual(["Zombi", "Goule"]);
  });
  it("une zone « alliés » ne garde que le camp du lanceur", () => {
    const out = selectAreaTargets(all, { origin: zombi.token, originDisposition: -1, excludeOrigin: true, affects: "ally" });
    expect(names(out)).toEqual(["Goule"]);
  });
  it("ignore les créatures hors de combat", () => {
    const out = selectAreaTargets([zombi, c("Squelette", -1, { defeated: true })], { origin: mage.token, originDisposition: 1, excludeOrigin: true });
    expect(names(out)).toEqual(["Zombi"]);
  });
  it("sans camp connu pour le lanceur, ne filtre pas par camp", () => {
    const out = selectAreaTargets(all, { origin: null, originDisposition: null, excludeOrigin: false, affects: "enemy" });
    expect(out).toHaveLength(4);
  });
});

describe("zone qui dure (Rayon de lune 2024 : entrée ou fin de tour, une fois par tour)", () => {
  const key = turnKeyOf(2, 1);
  const moonbeam = openArea(["enter", "turnEnd"], key, ["T.Zombi"]);

  it("ceux qu'elle a touchés à la pose ne le sont pas de nouveau ce tour-ci", () => {
    expect(shouldTrigger(moonbeam, { event: "turnEnd", token: "T.Zombi", turnKey: key })).toBe(false);
  });
  it("une créature qui entre pendant ce tour est touchée", () => {
    expect(shouldTrigger(moonbeam, { event: "enter", token: "T.Goule", turnKey: key })).toBe(true);
  });
  it("au tour de jeu suivant, la mémoire est remise à zéro", () => {
    expect(shouldTrigger(moonbeam, { event: "turnEnd", token: "T.Zombi", turnKey: turnKeyOf(2, 2) })).toBe(true);
  });
  it("ignore les moments que la zone ne connaît pas", () => {
    expect(shouldTrigger(moonbeam, { event: "turnStart", token: "T.Goule", turnKey: key })).toBe(false);
  });
  it("entrer puis finir son tour dans la zone : une seule fois", () => {
    const after = markHit(moonbeam, { token: "T.Goule", turnKey: key });
    expect(shouldTrigger(after, { event: "turnEnd", token: "T.Goule", turnKey: key })).toBe(false);
  });
  it("noter un token à un nouveau tour oublie ceux du tour précédent", () => {
    const next = turnKeyOf(2, 2);
    const after = markHit(moonbeam, { token: "T.Goule", turnKey: next });
    expect(after).toMatchObject({ turnKey: next, hit: ["T.Goule"] });
    expect(moonbeam.hit).toEqual(["T.Zombi"]);
  });
  it("hors combat, une seule clé de tour", () => {
    expect(turnKeyOf(null, null)).toBe("hors-combat");
  });
});

describe("entrer dans une zone", () => {
  it("arriver dedans depuis l'extérieur", () => expect(entersArea(false, [false, true])).toBe(true));
  it("la traverser sans s'y arrêter compte aussi", () => expect(entersArea(false, [true, false])).toBe(true));
  it("s'y déplacer en y étant déjà n'est pas une entrée", () => expect(entersArea(true, [true, true])).toBe(false));
  it("rester dehors", () => expect(entersArea(false, [false, false])).toBe(false));
});

describe("selectAreaTargets — ligne d'effet (P2)", () => {
  it("une créature que la zone n'atteint pas (plancher, plafond) est écartée ; inconnu ne l'écarte pas", () => {
    const below = c("Rat", -1, { lineOfEffect: false });
    const unknown = c("Chauve-souris", -1, { lineOfEffect: null });
    const out = selectAreaTargets([mage, zombi, below, unknown], { origin: mage.token, originDisposition: 1, excludeOrigin: false, affects: "creature" });
    expect(names(out)).toEqual(["Magicien", "Zombi", "Chauve-souris"]);
  });
});

describe("selectAreaTargets — vraie sphère (P2)", () => {
  it("une créature dans le cylindre de la région mais hors de la sphère est écartée", () => {
    const corner = c("Harpie", -1, { inVolume: false });
    const inside = c("Rat", -1, { inVolume: true });
    const out = selectAreaTargets([zombi, corner, inside], { origin: mage.token, originDisposition: 1, excludeOrigin: false, affects: "creature" });
    expect(names(out)).toEqual(["Zombi", "Rat"]);
  });
});
