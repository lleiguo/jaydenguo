import { afterEach, describe, expect, it, vi } from "vitest";
import { googleErrorCode, probeClassroom } from "@/adapters/classroom/api";

// SP-5 (plan M4.1): the Classroom check keeps a count, or the exact refusal.

const now = new Date("2026-10-01T12:00:00Z");
const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

describe("probeClassroom", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts his active classes and keeps nothing else", async () => {
    answer(200, {
      courses: [
        { id: "1", name: "Science 5" },
        { id: "2", name: "Math 5" },
      ],
    });
    const probe = await probeClassroom("token", now);
    expect(probe).toEqual({ ok: true, checkedAt: now.toISOString(), courses: 2 });
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as URL);
    expect(url.pathname).toBe("/v1/courses");
    expect(url.searchParams.get("studentId")).toBe("me");
  });

  it("treats no classes as readable", async () => {
    answer(200, {});
    expect(await probeClassroom("token", now)).toMatchObject({ ok: true, courses: 0 });
  });

  it("keeps Google's refusal word for word", async () => {
    answer(403, {
      error: { code: 403, status: "PERMISSION_DENIED", message: "The caller does not have permission" },
    });
    expect(await probeClassroom("token", now)).toEqual({
      ok: false,
      checkedAt: now.toISOString(),
      status: 403,
      reason: "PERMISSION_DENIED: The caller does not have permission",
    });
  });

  it("says when Classroom can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("network"))),
    );
    expect(await probeClassroom("token", now)).toMatchObject({ ok: false, status: null });
  });
});

describe("googleErrorCode", () => {
  it("accepts Google's short codes only", () => {
    expect(googleErrorCode("admin_policy_enforced")).toBe("admin_policy_enforced");
    expect(googleErrorCode("<script>")).toBeNull();
    expect(googleErrorCode("x".repeat(41))).toBeNull();
    expect(googleErrorCode(null)).toBeNull();
  });
});
