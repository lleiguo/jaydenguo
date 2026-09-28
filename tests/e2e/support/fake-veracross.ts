import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";

// A stand-in for a Veracross parent portal (spikes.md SP-4) for integration
// tests: a two-step sign-in (username, then password), "My Children" drawn by
// a script after load, and Daily Schedule pages built from the scrubbed
// fixture. Two children, so picking the right one is tested. Loopback only.

export const FAKE_VERACROSS_LOGIN = { username: "parent@example.test", password: "fixture-password" };
export const SCHOOL = "example";
export const OUR_STUDENT = { name: "Kid", id: "100001" };
export const OTHER_STUDENT = { name: "Sibling", id: "100002" };

type Options = {
  // Dates (YYYY-MM-DD) with no classes on the Daily Schedule.
  noClasses?: string[];
  // Ask for a code after the password, like a site with two-step sign-in.
  requireCode?: boolean;
};

const template = readFileSync("tests/fixtures/veracross/daily-schedule.html", "utf8");
const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

export function createFakeVeracross(opts: Options = {}): Server {
  const sessions = new Set<string>();
  const requested: string[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html", ...headers });
      res.end(body);
    };
    const redirect = (to: string, headers: Record<string, string> = {}) => {
      res.writeHead(303, { location: to, ...headers });
      res.end();
    };
    const session = (req.headers.cookie ?? "").match(/vcsession=([\w-]+)/)?.[1];
    const signedIn = !!session && sessions.has(session);
    const form = async () => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      return new URLSearchParams(raw);
    };

    // Sign-in, step 1: username.
    if (url.pathname === "/login" && req.method === "GET") {
      return send(
        200,
        page(
          "Sign in",
          `<form method="post" action="/login"><label>Username <input name="username" autocomplete="username"></label><button>Next</button></form>`,
        ),
      );
    }
    if (url.pathname === "/login" && req.method === "POST") {
      const f = await form();
      const username = f.get("username") ?? "";
      if (!f.has("password")) {
        return send(
          200,
          page(
            "Sign in",
            `<form method="post" action="/login"><input type="hidden" name="username" value="${username}"><label>Password <input type="password" name="password"></label><button>Sign in</button></form>`,
          ),
        );
      }
      if (username !== FAKE_VERACROSS_LOGIN.username || f.get("password") !== FAKE_VERACROSS_LOGIN.password) {
        return send(
          200,
          page(
            "Sign in",
            `<p class="error">Invalid username or password.</p><form method="post" action="/login"><label>Username <input name="username" autocomplete="username"></label><button>Next</button></form>`,
          ),
        );
      }
      if (opts.requireCode) {
        return send(
          200,
          page("Verify", `<p>Enter the verification code we sent to your email.</p><input name="code">`),
        );
      }
      const id = crypto.randomUUID();
      sessions.add(id);
      return redirect(`/${SCHOOL}/parent`, { "set-cookie": `vcsession=${id}; Path=/; HttpOnly` });
    }

    if (url.pathname.startsWith(`/${SCHOOL}/parent`)) {
      if (!signedIn) return redirect("/login");
      requested.push(url.pathname + url.search);
      if (url.pathname === `/${SCHOOL}/parent`) {
        // My Children arrives after load, as on the real portal.
        const kids = [OTHER_STUDENT, OUR_STUDENT]
          .map(
            (k) =>
              `<div class="child"><h4 class="vx-child-name">${k.name}</h4><a href="/${SCHOOL}/parent/student/${k.id}/overview">Classes &amp; Reports</a><a href="/${SCHOOL}/parent/student/${k.id}/daily-schedule">Daily Schedule</a></div>`,
          )
          .join("");
        return send(
          200,
          page(
            "Parent Portal",
            `<div id="children"></div><script>setTimeout(() => { document.getElementById("children").innerHTML = ${JSON.stringify(kids)}; }, 50);</script>`,
          ),
        );
      }
      const m = url.pathname.match(/\/student\/(\d+)\/daily-schedule$/);
      if (m) {
        const date = url.searchParams.get("date") ?? "";
        const html = template.replace(/2030-09-09/g, date);
        if (m[1] !== OUR_STUDENT.id) return send(200, html.replace(/Mathematics/g, "Sibling-only class"));
        if (opts.noClasses?.includes(date))
          return send(
            200,
            html.replace(
              /<div class="ae-grid vx-schedule-item">[\s\S]*?schedule-item-status"><\/div>\s*<\/div>/g,
              "",
            ),
          );
        return send(200, html);
      }
    }
    send(404, "not found");
  });
  (server as Server & { requested: string[] }).requested = requested;
  return server;
}
