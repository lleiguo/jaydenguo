import { describe, expect, it } from "vitest";
import { deleteConfirm } from "@/domain/delete-confirm";

describe("deleteConfirm (intent 0022, DEL-2)", () => {
  it("asks plainly for an event added here", () => {
    expect(deleteConfirm("Dentist", null, false)).toBe("Delete “Dentist”?");
  });
  it("says a source event stays deleted, and tennis entries stay", () => {
    expect(deleteConfirm("Soccer", { name: "Spordle", kind: "ical" }, false)).toBe(
      "Delete “Soccer”? It stays deleted when Spordle syncs. Restore it from Settings → Deleted.",
    );
    expect(deleteConfirm("Open", { name: "Tennis", kind: "tennis_tc" }, false)).toContain(
      "This doesn't withdraw the entry.",
    );
  });
  it("says where a household event goes (DEL-4)", () => {
    const src = { name: "Household", kind: "google_calendar" };
    expect(deleteConfirm("Dinner", src, true)).toContain("goes from the family's Google Calendar too");
    expect(deleteConfirm("Dinner", src, false)).toContain("stays in the family's Google Calendar");
  });
});
