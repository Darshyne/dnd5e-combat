import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DEVILS_SIGHT_OUTLINE, drawnUnderVeil, tintOutlineShader } from "../module/scripts/core/light.mjs";

/**
 * Issue #42, suite (0.281.1) : de l'extérieur des Ténèbres, l'occultiste à Vision du diable pouvait viser la créature à l'intérieur, mais son
 * token ne s'affichait pas. Le mode, sans filtre de détection, n'était dessiné que sous le voile de vision du cœur.
 */
describe("issue #42 : le token vu par la Vision du diable s'affiche au-dessus du voile", () => {
  it("le liseré garde le token entier (pas de knockout), sans ondulation, rouge sombre", () => {
    expect(DEVILS_SIGHT_OUTLINE.knockout).toBe(false);
    expect(DEVILS_SIGHT_OUTLINE.wave).toBe(false);
    const [r, g, b, a] = DEVILS_SIGHT_OUTLINE.outlineColor;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(a).toBe(1);
    expect(DEVILS_SIGHT_OUTLINE.thickness).toBeGreaterThan(0);
  });

  it("le liseré se distingue du contour de l'ouïe (le testeur d'écran les sépare par leur couleur)", () => {
    const source = readFileSync(new URL("../module/scripts/ui/perception.mjs", import.meta.url), "utf8");
    const hearing = source.match(/outlineColor: \[([^\]]+)\]/)[1].split(",").map(Number);
    expect(hearing).not.toEqual([...DEVILS_SIGHT_OUTLINE.outlineColor]);
  });

  it("le mode Vision du diable déclare un filtre de détection", () => {
    const source = readFileSync(new URL("../module/scripts/ui/perception.mjs", import.meta.url), "utf8");
    const mode = source.slice(source.indexOf("class DetectionModeDevilsSight"), source.indexOf("return new DetectionModeDevilsSight"));
    expect(mode).toContain("static getDetectionFilter()");
    expect(source).toContain("tintOutlineShader(");
  });

  it("teinte le token en rouge (un token net veut dire « vue normale »)", () => {
    const [r, g, b] = DEVILS_SIGHT_OUTLINE.tintColor;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(DEVILS_SIGHT_OUTLINE.tintStrength).toBeGreaterThan(0);
    expect(DEVILS_SIGHT_OUTLINE.tintStrength).toBeLessThanOrEqual(1);
  });
});

describe("issue #42 : la teinte s'ajoute au shader de contour du cœur V14", () => {
  // Les deux lignes que la teinte attend, telles qu'elles sont dans rendering/filters/outline-overlay.mjs (14.370).
  const core = `uniform bool wave;
    void main(void) {
      vec4 texColor = mix(baseColor, wColor, k) * texAlpha;
      float oAlpha = getOutlineAlpha() * (1.0 - texAlpha);
    }`;
  it("déclare ses uniforms et teinte la couleur du token, avant le contour", () => {
    const out = tintOutlineShader(core);
    expect(out).toContain("uniform vec3 tintColor;");
    expect(out).toContain("uniform float tintStrength;");
    expect(out.indexOf("tintColor, tintStrength")).toBeGreaterThan(out.indexOf("vec4 texColor"));
    expect(out.indexOf("tintColor, tintStrength")).toBeLessThan(out.indexOf("float oAlpha"));
  });
  it("null si le cœur a changé : le contour seul", () => {
    expect(tintOutlineShader("void main(void) { gl_FragColor = vec4(1.0); }")).toBeNull();
    expect(tintOutlineShader(undefined)).toBeNull();
  });
});

describe("issue #42 : défaut « dessiné sous le voile »", () => {
  it("visible, sans filtre, hors de toute vue : le joueur ne le voit pas", () => {
    expect(drawnUnderVeil({ visible: true, filtered: false, inSight: false })).toBe(true);
  });
  it("avec un filtre : redessiné au-dessus du voile", () => {
    expect(drawnUnderVeil({ visible: true, filtered: true, inSight: false })).toBe(false);
  });
  it("dans la zone vue, ou le token qui voit lui-même : affiché normalement", () => {
    expect(drawnUnderVeil({ visible: true, filtered: false, inSight: true })).toBe(false);
    expect(drawnUnderVeil({ visible: true, filtered: false, ownVision: true, inSight: false })).toBe(false);
  });
  it("non visible : pas un défaut d'affichage", () => {
    expect(drawnUnderVeil({ visible: false, filtered: false, inSight: false })).toBe(false);
  });
});
