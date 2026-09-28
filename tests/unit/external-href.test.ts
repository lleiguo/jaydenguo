import { describe, expect, it } from "vitest";
import { externalHref } from "@/lib/external-href";

describe("externalHref", () => {
  it("keeps web links", () => {
    expect(externalHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(externalHref("http://example.com")).toBe("http://example.com/");
  });
  it("drops script, data and odd links", () => {
    expect(externalHref("javascript:alert(1)")).toBeUndefined();
    expect(externalHref(" JavaScript:alert(1)")).toBeUndefined();
    expect(externalHref("data:text/html,<script>1</script>")).toBeUndefined();
    expect(externalHref("not a url")).toBeUndefined();
    expect(externalHref(null)).toBeUndefined();
  });
});
