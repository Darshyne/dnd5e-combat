/**
 * Chaîne du Diable des chaînes (SRD 5.2) : une attaque dont l'identifiant dnd5e, « chain », est aussi celui de la chaîne de
 * l'équipement d'aventurier (lier une créature : `contest`). Une source lui donne son propre identifiant.
 */
import { describe, it, expect } from "vitest";
import { CONTENT, SOURCES } from "../module/scripts/content/index.mjs";

describe("Chaîne du Diable des chaînes : pas l'entrée de l'équipement", () => {
  it("l'attaque a son propre identifiant, sans entrée ; la chaîne de l'équipement garde la sienne", () => {
    expect(SOURCES["mmChainDevil0000.mmChain000000000"]).toBe("mm-chain-devil-chain");
    expect(CONTENT["mm-chain-devil-chain"]).toBeUndefined();
    expect(CONTENT.chain?.contest).toBeTruthy();
  });
});
