import { describe, expect, it } from "vitest";
import { ownersFor, parseMapping } from "@/domain/categories";
import { resolveOwners, type Person } from "@/domain/people";

const JAYDEN = "00000000-0000-4000-8000-000000000001";
const LEI = "00000000-0000-4000-8000-000000000002";
const ETHAN = "00000000-0000-4000-8000-000000000003";
const people: Person[] = [
  { id: JAYDEN, name: "Jayden", isPrimary: true },
  { id: LEI, name: "Lei", isPrimary: false },
  { id: ETHAN, name: "Ethan", isPrimary: false },
];

// Whose event it is (owner, 2026-09-28).
describe("resolveOwners", () => {
  it("means the primary person when there are no owners", () => {
    expect(resolveOwners([], people)).toEqual([JAYDEN]);
    expect(resolveOwners(null, people)).toEqual([JAYDEN]);
  });

  it("keeps known people in the people list's order, once each", () => {
    expect(resolveOwners([ETHAN, LEI, ETHAN], people)).toEqual([LEI, ETHAN]);
  });

  it("falls back to the primary person when every owner was removed", () => {
    expect(resolveOwners(["00000000-0000-4000-8000-00000000dead"], people)).toEqual([JAYDEN]);
  });
});

describe("ownersFor", () => {
  const mapping = parseMapping({
    default: "other",
    owners: [JAYDEN],
    rules: [
      { match: "(Lei)", owner: LEI },
      { match: "ethan", owner: ETHAN },
      { match: "swim", category: "swimming" },
      { match: "bogus", owner: "not-an-id" },
    ],
  });

  it("drops rules that name no real id", () => {
    expect(mapping.rules).toHaveLength(3);
  });

  it("uses every matching rule's owner", () => {
    expect(ownersFor("Dentist (Lei)", mapping)).toEqual([LEI]);
    expect(ownersFor("Ethan and Lei (Lei) dinner", mapping)).toEqual([LEI, ETHAN]);
  });

  it("falls back to the source's default owners", () => {
    expect(ownersFor("Swim practice", mapping)).toEqual([JAYDEN]);
    expect(ownersFor("Swim practice", parseMapping({ default: "other" }))).toEqual([]);
  });
});
