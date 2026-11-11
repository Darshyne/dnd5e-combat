import { describe, expect, it } from "vitest";
import { forwardsIssue, mergeIssues } from "../module/scripts/core/forced.mjs";

describe("§411 forwardsIssue — what a refused click sends along with the use", () => {
  it("leaves to the legality window what it sees itself", () => {
    for ( const kind of ["outOfRange", "plane", "chain", "contact"] ) expect(forwardsIssue(kind)).toBe(false);
  });
  it("forwards target type, tether, Cleave, ricochet", () => {
    expect(forwardsIssue("other")).toBe(true);
  });
  it("forwards line of sight only when the gesture skips engage", () => {
    expect(forwardsIssue("blind")).toBe(false);
    expect(forwardsIssue("blind", { blind: true })).toBe(true);
  });
});

describe("§411 mergeIssues", () => {
  it("merges without duplicates, keeping order", () => {
    expect(mergeIssues(["a", "b"], ["b", "c"], "d", "a")).toEqual(["a", "b", "c", "d"]);
  });
  it("drops empty and non-text entries", () => {
    expect(mergeIssues(["", null, "a"], undefined, [42])).toEqual(["a"]);
  });
});
