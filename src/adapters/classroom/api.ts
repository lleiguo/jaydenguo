import { FetchError, politeFetch } from "../http";

// Google Classroom API (SRC-8), read with Jayden's school Google account.
// The school's Workspace admin may block the app (spec F-5, spikes.md SP-5),
// so every answer is checked and a refusal is kept word for word: the owner
// needs the exact reason to choose a fallback.

export const classroomApiBase = () => process.env.CLASSROOM_API_BASE ?? "https://classroom.googleapis.com";

// Asked for when the owner connects the school account (plan M4.1).
export const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  // His own coursework, submissions and returned grades.
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
];

// What the connect flow and the connection test record on the credential.
// Only a count: course names, teachers and classmates stay out of it.
export type ClassroomProbe =
  | { ok: true; checkedAt: string; courses: number }
  | { ok: false; checkedAt: string; status: number | null; reason: string };

export async function probeClassroom(accessToken: string, now = new Date()): Promise<ClassroomProbe> {
  const checkedAt = now.toISOString();
  const url = new URL("/v1/courses", classroomApiBase());
  url.searchParams.set("studentId", "me");
  url.searchParams.set("courseStates", "ACTIVE");
  url.searchParams.set("pageSize", "100");
  let res: Response;
  try {
    res = await politeFetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    return {
      ok: false,
      checkedAt,
      status: null,
      reason: err instanceof FetchError ? err.message : "Couldn't reach Classroom",
    };
  }
  const body = (await res.json().catch(() => ({}))) as {
    courses?: unknown[];
    error?: { status?: string; message?: string };
  };
  if (!res.ok) {
    const reason = [body.error?.status, body.error?.message].filter(Boolean).join(": ");
    return {
      ok: false,
      checkedAt,
      status: res.status,
      reason: (reason || `HTTP ${res.status}`).slice(0, 300),
    };
  }
  return { ok: true, checkedAt, courses: body.courses?.length ?? 0 };
}

// Google's own words when it refuses the grant before the app sees a token,
// e.g. "admin_policy_enforced" when the school blocks the app. Only a short
// code is kept, never free text from the query string.
export function googleErrorCode(value: string | null): string | null {
  return value && /^[a-z_]{1,40}$/.test(value) ? value : null;
}
