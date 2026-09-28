import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyEntryPage,
  feeOf,
  parseEntryForm,
  pickEventOption,
  type EventOption,
} from "@/adapters/tennis-tc/registrar";

// Entering him on the site (plan M3b.6, spikes.md SP-7), from hand-built
// pages with the real site's structure.

const page = (file: string, subs: Record<string, string> = {}) =>
  Object.entries(subs).reduce(
    (html, [k, v]) => html.replace(`{{${k}}}`, v),
    readFileSync(`tests/fixtures/tennis-tc/entries/${file}`, "utf8"),
  );
const opt = (value: string, label: string): EventOption => ({ value, label, fee: feeOf(label) });
const SELECT = opt("", "Select event");

describe("pickEventOption", () => {
  it("matches the search's event by ball colour and age", () => {
    const options = [SELECT, opt("1", "BU9 - Orange $30.00"), opt("2", "BU10 - Orange $30.00")];
    expect(pickEventOption(options, "U9 Orange Boys")?.value).toBe("1");
    expect(pickEventOption(options, "U10 (Orange Ball)")?.value).toBe("2");
  });

  it("takes the only event of the right colour", () => {
    expect(pickEventOption([SELECT, opt("5", "BS10 - Green $45.00")], "RT 9 - 12 (Green)")?.value).toBe("5");
  });

  it("won't pick an event of another colour", () => {
    expect(pickEventOption([SELECT, opt("5", "BS10 - Green $45.00")], "U10 (Orange Ball)")).toBeNull();
  });

  it("won't guess between several", () => {
    const options = [SELECT, opt("1", "Boys Orange A $30.00"), opt("2", "Boys Orange B $30.00")];
    expect(pickEventOption(options, "Orange")).toBeNull();
  });

  it("takes an exact name", () => {
    expect(pickEventOption([SELECT, opt("7", "U9 Orange Boys")], "u9 orange boys")?.value).toBe("7");
  });
});

describe("feeOf", () => {
  it("reads the fee from the option text", () => {
    expect(feeOf("BS10 - Green $45.00")).toBe("$45.00");
    expect(feeOf("BS10 - Green")).toBeNull();
  });
});

describe("parseEntryForm", () => {
  it("finds the form's fields, the event select and the agreement", () => {
    const form = parseEntryForm(
      page("entry-form.html", {
        TOURNAMENT: "t-1",
        OPTIONS: '<option value="9">BU9 - Orange $30.00</option>',
        ERRORS: "",
      }),
    )!;
    expect(form.action).toBe("/online-entry/IndividualEntry/SubmitEntry");
    expect(form.eventField).toBe("EventDetails.SelectedEvents[0].EventID");
    expect(form.agreeField).toBe("DisclaimerAgree");
    expect(form.options.map((o) => [o.value, o.label, o.fee])).toEqual([
      ["", "Select event", null],
      ["9", "BU9 - Orange $30.00", "$30.00"],
    ]);
    expect(form.fields.map((f) => f.name)).toEqual([
      "__RequestVerificationToken",
      "TournamentCode",
      "OrganizationPerson_Code",
      "CommentDetails.Comments",
      "DisclaimerAgree",
    ]);
    expect(form.fields.find((f) => f.name === "TournamentCode")?.value).toBe("t-1");
  });

  it("is null on a page without the form", () => {
    expect(parseEntryForm(page("login.html"))).toBeNull();
  });
});

describe("classifyEntryPage", () => {
  const url = "https://tc.example.test/individual-entry/t-1";
  it("reads an entry that's in", () => {
    expect(classifyEntryPage(page("my-entry.html", { EVENT: "BU9 - Orange" }), url)).toEqual({
      kind: "entered",
    });
  });

  it("sees a request for payment", () => {
    expect(
      classifyEntryPage(
        page("payment.html", { FEE: "$45.00" }),
        "https://tc.example.test/online-entry/payment/t-1",
      ),
    ).toMatchObject({ kind: "payment" });
    // A pay button is enough, whatever the address.
    expect(classifyEntryPage(page("payment.html", { FEE: "$45.00" }), url)).toMatchObject({
      kind: "payment",
    });
  });

  it("sees an unpaid entry", () => {
    const unpaid = page("my-entry.html", { EVENT: "BU9 - Orange" }).replace(
      "Entered",
      "Entered · Payment pending",
    );
    expect(classifyEntryPage(unpaid, url)).toMatchObject({ kind: "payment" });
  });

  it("reports the site's own error when the form comes back", () => {
    const back = page("entry-form.html", {
      TOURNAMENT: "t-1",
      OPTIONS: "",
      ERRORS: '<span class="field-validation-error">Please select at least one event.</span>',
    });
    expect(classifyEntryPage(back, url)).toEqual({
      kind: "rejected",
      message: "Please select at least one event.",
    });
  });

  it("doesn't claim success on a page it doesn't know", () => {
    expect(classifyEntryPage("<main><h2>Thanks</h2></main>", url)).toEqual({ kind: "unknown" });
  });
});
