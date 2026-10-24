import { describe, expect, it } from "vitest";
import { ownersFor, parseMapping, personWithEmail } from "@/domain/categories";
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

  it("gives an event to everyone named in its title", () => {
    const none = parseMapping({ default: "other" });
    expect(ownersFor("Jayden swimming", none, people)).toEqual([JAYDEN]);
    expect(ownersFor("LEI's dentist", none, people)).toEqual([LEI]);
    expect(ownersFor("Ethan and Jayden: haircut", none, people)).toEqual([JAYDEN, ETHAN]);
    expect(ownersFor("Dentist (Lei)", mapping, people)).toEqual([LEI]);
  });

  it("only matches whole names", () => {
    const none = parseMapping({ default: "other" });
    expect(ownersFor("Leighton Park walk", none, people)).toEqual([]);
    expect(ownersFor("Leighton Park walk", mapping, people)).toEqual([JAYDEN]);
  });
});

// Intent 0024: an event belongs to whoever it names, else whoever made it.
describe("ownersFor with who made it (OWN-1..OWN-5)", () => {
  const household = parseMapping({ default: "other", owners: [JAYDEN, LEI, ETHAN] });

  it("a name wins over who made it (OWN-1)", () => {
    expect(ownersFor("Jayden tennis", household, people, LEI)).toEqual([JAYDEN]);
  });

  it("no name: whoever made it, not the default owners (OWN-2, OWN-5)", () => {
    expect(ownersFor("Dentist", household, people, LEI)).toEqual([LEI]);
  });

  it("an unknown maker falls back to the default owners (OWN-3)", () => {
    expect(ownersFor("Dentist", household, people, null)).toEqual([JAYDEN, LEI, ETHAN]);
    expect(ownersFor("Dentist", household, people, "00000000-0000-4000-8000-00000000ffff")).toEqual([
      JAYDEN,
      LEI,
      ETHAN,
    ]);
  });

  it('"family" or "everyone" in the title is everyone\'s (OWN-5)', () => {
    const none = parseMapping({ default: "other" });
    expect(ownersFor("Family dinner", none, people, LEI)).toEqual([JAYDEN, LEI, ETHAN]);
    expect(ownersFor("BBQ for everyone", none, people, LEI)).toEqual([JAYDEN, LEI, ETHAN]);
    expect(ownersFor("Familyfest", none, people, LEI)).toEqual([LEI]);
  });
});

describe("personWithEmail (OWN-2)", () => {
  const emails = [
    { id: LEI, emails: ["parent@example.com"] },
    { id: ETHAN, emails: [] },
  ];

  it("matches ignoring case and spaces", () => {
    expect(personWithEmail(" Parent@Example.com", emails)).toBe(LEI);
  });

  it("is null for no email or no match", () => {
    expect(personWithEmail(null, emails)).toBeNull();
    expect(personWithEmail("other@example.com", emails)).toBeNull();
  });
});
