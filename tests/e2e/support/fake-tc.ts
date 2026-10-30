import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { FAKE_TC_PORT } from "./fake-tc-port";

// A stand-in for tc.tournamentsoftware.com (SP-2) for unit, integration and
// e2e tests. It serves the scrubbed pages in tests/fixtures/tennis-tc at the
// paths the real site uses; any other path gets the site's error page (with
// status 200, as the real site does). The profile page also carries
// contact details planted here, to prove the adapter keeps none of them.
// Loopback only, like the other fakes.

const DIR = "tests/fixtures/tennis-tc";
export const TC_FIXTURE = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")) as {
  org: string;
  self: { profileId: string; memberId: string };
  opponents: { profileId: string; memberId: string }[];
  currentTournament: string;
  pastTournament: string;
  nextOpponentTournamentPlayer: string;
};
export const TC_PROFILE_URL = (base: string) => `${base}/player-profile/${TC_FIXTURE.self.profileId}`;
// The fixture's "today": the day between his quarter final and semi final.
export const TC_NOW = new Date("2024-09-28T16:00:00Z");
export const PLANTED_PRIVATE = ["555-0199", "private-parent@example.test", "Planted Home Address 12"];

const planted = `<div class="module"><h3 class="module__title"><span class="module__title-main">Contact</span></h3>
<span class="p-tel">${PLANTED_PRIVATE[0]}</span><a href="mailto:${PLANTED_PRIVATE[1]}">${PLANTED_PRIVATE[1]}</a>
<span class="p-street-address">${PLANTED_PRIVATE[2]}</span></div>`;

const errorPage = `<!doctype html><html><head><title>Tennis Canada</title></head><body>
<a href="/user?returnUrl=%2Ferror%2F404%3Fec%3D404">Log in</a><h2>Page not found</h2></body></html>`;

function routes(): Map<string, string> {
  const f = TC_FIXTURE;
  const [op1, op2, next] = f.opponents;
  const r = new Map<string, string>([
    [`/player-profile/${f.self.profileId}`, "profile.html"],
    [`/player-profile/${f.self.profileId}/tournaments`, "profile-tournaments.html"],
    [`/player-profile/${f.self.profileId}/tournaments/2024/TournamentsForYear`, "year-current.html"],
    [`/player-profile/${f.self.profileId}/tournaments/2023/TournamentsForYear`, "year-previous.html"],
    [`/tournament/${f.currentTournament}`, "tournament-current.html"],
    [`/tournament/${f.pastTournament}`, "tournament-past.html"],
    [`/tournament/${f.currentTournament}/Draw/15/GetDrawContent`, "draw-current.html"],
    [`/tournament/${f.currentTournament}/Draw/15/GetMatchesContent`, "draw-current-matches.html"],
    [`/tournament/${f.pastTournament}/Draw/38/GetDrawContent`, "draw-compass.html"],
    [
      `/tournament/${f.currentTournament}/player/${f.nextOpponentTournamentPlayer}`,
      "tournament-player-next.html",
    ],
    [`/player-profile/${op1.profileId}`, "opponent-1.html"],
    [`/player-profile/${op1.profileId}/tournaments/2024/TournamentsForYear`, "opponent-1-year-current.html"],
    [`/player-profile/${op1.profileId}/tournaments/2023/TournamentsForYear`, "opponent-1-year-previous.html"],
    [`/player-profile/${op2.profileId}`, "opponent-2.html"],
    [`/player-profile/${op2.profileId}/tournaments/2024/TournamentsForYear`, "opponent-2-year-current.html"],
    [`/player-profile/${next.profileId}`, "opponent-next.html"],
    [
      `/player-profile/${next.profileId}/tournaments/2024/TournamentsForYear`,
      "opponent-next-year-current.html",
    ],
    // Tournament entries (SP-7): search, event lists, overviews, event pages.
    ["/find/tournament/DoSearch", "entries/search.html"],
    [`/sport/events.aspx?id=${ENTRY_FIXTURE.a}`, "entries/events-a.html"],
    [`/sport/events.aspx?id=${ENTRY_FIXTURE.b}`, "entries/events-b.html"],
    [`/sport/events.aspx?id=${ENTRY_FIXTURE.c}`, "entries/events-c.html"],
    [`/tournament/${ENTRY_FIXTURE.a}`, "entries/tournament-a.html"],
    [`/tournament/${ENTRY_FIXTURE.b}`, "entries/tournament-b.html"],
    [`/sport/event.aspx?id=${ENTRY_FIXTURE.a}&event=6`, "entries/event-a6.html"],
    [`/sport/event.aspx?id=${f.currentTournament}&event=13`, "entries/event-current.html"],
  ]);
  return new Map([...r].map(([k, v]) => [k.toLowerCase(), v]));
}

// The hand-built entry pages' tournaments: A has his event (U9 Orange Boys,
// event 6), B clashes with A and is farther, C has no event for him (U12 green).
export const ENTRY_FIXTURE = {
  a: "a0000000-0000-4000-8000-00000000000a",
  b: "b0000000-0000-4000-8000-00000000000b",
  c: "c0000000-0000-4000-8000-00000000000c",
  // His tournament player number in the fixture's current tournament.
  selfCurrentTp: "1021",
};

// The signed-in entry flow (SP-7, M3b.6): the login the fake accepts, the
// events each tournament's form offers, and which tournaments ask for
// payment after Submit.
export const TC_LOGIN = { username: "fake-tc-user", password: "fake-tc-pass" };
// eventNo/event: the same event on the event list (for "My entries").
export const ENTRY_OPTIONS: Record<
  string,
  { value: string; label: string; eventNo: string; event: string }[]
> = {
  [ENTRY_FIXTURE.a]: [
    { value: "9006", label: "BU9 - Orange $30.00", eventNo: "6", event: "U9 Orange Boys" },
    { value: "9005", label: "BU10 - Orange $30.00", eventNo: "5", event: "U10 (Orange Ball)" },
  ],
  [ENTRY_FIXTURE.b]: [{ value: "9105", label: "BS10 - Orange $45.00", eventNo: "3", event: "U10 Orange" }],
};
const ENTRY_NAMES: Record<string, string> = {
  [ENTRY_FIXTURE.a]: "Fixture Rookie Open",
  [ENTRY_FIXTURE.b]: "Fixture Fall Classic",
};

// An entry on the account's "My entries" page.
export type AccountEntryFake = { eventNo: string; event: string; label?: string };

export type EntrySubmission = { tournament: string; eventId: string; agreed: boolean };

type Options = {
  // Replace a page's HTML (e.g. a changed score) for one test.
  edit?: (file: string, html: string) => string;
  // Paths requested, for assertions.
  requests?: string[];
  // Entry forms submitted, and tournaments whose entry asks for payment.
  submissions?: EntrySubmission[];
  paid?: Set<string>;
  // Tournaments entered on the site, not by the app: "My entries" lists
  // them, and their entry page shows the blank form again, as the real
  // site does.
  handEntered?: Map<string, AccountEntryFake>;
};

const myEntryCard = (t: string, e: AccountEntryFake) => {
  const id = t.toUpperCase();
  return `<div class="module-container"> <div class="media"> <div class="media__wrapper"> <div class="media__content"> <h4 class="media__title media__title--medium"> <a href="/sport/tournament?id=${id}" title="${ENTRY_NAMES[t] ?? "Fixture Tournament"}" class="media__link"> <span class="nav-link__value">${ENTRY_NAMES[t] ?? "Fixture Tournament"}</span> </a> </h4> <small class="media__subheading"> <span class="nav-link"> <span class="nav-link__value"> Fixture Tennis Club | Nearby </span> </span> </small> <small class="media__subheading media__subheading--muted"> <span class="nav-link"> <span class="nav-link__value"> <time datetime="2024-10-05 00:00">2024-10-05</time> </span> </span> </small> </div> <div class="media__aside"> <ul class="list list--inline list--spacing"> <li class="list__item"> <a role="button" href="/individual-entry-view/${id}/F0000000-0000-4000-8000-000000000001" title="Entered" class="btn btn--small btn--round btn--success"> <span class="nav-link__value">Entered</span> </a> </li> </ul> </div> </div> </div> <div class="module-divider"> <div class="module-divider__body"> <ul class="list list--naked"> <li class="list__item"> <a href="/sport/event.aspx?id=${id}&amp;event=${e.eventNo}" class="nav-link"><span class="nav-link__value">${e.event}</span> </a> </li> </ul> </div> </div> </div>`;
};

const readBody = async (req: import("node:http").IncomingMessage) => {
  let raw = "";
  for await (const c of req) raw += c;
  return new URLSearchParams(raw);
};
const fixture = (file: string) => readFileSync(`${DIR}/${file}`, "utf8");

export function createFakeTc(opts: Options = {}): Server {
  const table = routes();
  const redirects = new Map(
    TC_FIXTURE.opponents.map((o) => [
      `/player/${TC_FIXTURE.org}/${Buffer.from(`base64:${o.memberId}`).toString("base64")}`.toLowerCase(),
      `/player-profile/${o.profileId}`,
    ]),
  );
  // Entered tournaments (the fake's "My entry" state).
  const entered = new Map<string, AccountEntryFake>();
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (await entryFlow(req, res, url, entered, opts)) return;
    // The old /sport/*.aspx pages are told apart by their query string.
    const path = (url.pathname + (url.pathname.endsWith(".aspx") ? url.search : "")).toLowerCase();
    opts.requests?.push(url.pathname);
    const to = redirects.get(path);
    if (to) {
      res.writeHead(302, { location: to }).end();
      return;
    }
    const file = table.get(path);
    let html = file ? readFileSync(`${DIR}/${file}`, "utf8") : errorPage;
    if (file === "profile.html") html = html.replace("</body>", `${planted}</body>`);
    if (file && opts.edit) html = opts.edit(file, html);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": "ASP.NET_SessionId=fake; path=/; HttpOnly",
    });
    res.end(html);
  });
}

// The signed-in pages: log in, the entry form, Submit, "My entry", and a
// payment page. True when the request was one of them.
async function entryFlow(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  url: URL,
  entered: Map<string, AccountEntryFake>,
  opts: Options,
): Promise<boolean> {
  const html = (body: string, status = 200, cookie?: string) => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      ...(cookie ? { "set-cookie": cookie } : {}),
    });
    res.end(body);
  };
  const redirect = (to: string, cookie?: string) => {
    res.writeHead(302, { location: to, ...(cookie ? { "set-cookie": cookie } : {}) });
    res.end();
  };
  const signedIn = /(?:^|;\s*)tc_auth=ok(?:;|$)/.test(req.headers.cookie ?? "");
  const path = url.pathname.toLowerCase();

  if (path === "/user/login" && req.method === "GET") {
    html(fixture("entries/login.html").replace("{{RETURN_URL}}", url.searchParams.get("ReturnUrl") ?? "/"));
    return true;
  }
  if (path === "/user" && req.method === "POST") {
    const form = await readBody(req);
    const ok =
      form.get("__RequestVerificationToken") === "fake-login-token" &&
      form.get("Login") === TC_LOGIN.username &&
      form.get("Password") === TC_LOGIN.password;
    // A wrong login: the form again, at /user, with the site's message.
    if (!ok)
      html(
        fixture("entries/login.html")
          .replace("{{RETURN_URL}}", form.get("ReturnUrl") ?? "/")
          .replace(
            "<fieldset>",
            '<div class="validation-summary-errors"><ul><li>Invalid login or password</li></ul></div><fieldset>',
          ),
      );
    else redirect(form.get("ReturnUrl") || "/", "tc_auth=ok; path=/; HttpOnly");
    return true;
  }
  if (path === "/user/entries" && req.method === "GET") {
    if (!signedIn) {
      redirect(`/user/login?ReturnUrl=${encodeURIComponent(url.pathname)}`);
      return true;
    }
    const all = [...(opts.handEntered ?? []), ...entered];
    html(
      fixture("entries/user-entries.html").replace(
        "{{CARDS}}",
        all.map(([t, e]) => myEntryCard(t, e)).join("\n"),
      ),
    );
    return true;
  }
  const entry = /^\/individual-entry\/([0-9a-f-]+)$/.exec(path);
  if (entry && req.method === "GET") {
    if (!signedIn) {
      redirect(`/user/login?ReturnUrl=${encodeURIComponent(url.pathname)}`);
      return true;
    }
    const t = entry[1];
    const done = entered.get(t);
    if (done) {
      html(fixture("entries/my-entry.html").replace("{{EVENT}}", done.label!));
      return true;
    }
    const options = (ENTRY_OPTIONS[t] ?? [])
      .map((o) => `<option value="${o.value}">${o.label}</option>`)
      .join("\n");
    html(
      fixture("entries/entry-form.html")
        .replace("{{TOURNAMENT}}", t)
        .replace("{{OPTIONS}}", options)
        .replace(
          "{{ERRORS}}",
          url.searchParams.get("error")
            ? '<span class="field-validation-error">Please select at least one event.</span>'
            : "",
        ),
    );
    return true;
  }
  if (path === "/online-entry/individualentry/submitentry" && req.method === "POST") {
    const form = await readBody(req);
    const t = (form.get("TournamentCode") ?? "").toLowerCase();
    const eventId = form.get("EventDetails.SelectedEvents[0].EventID") ?? "";
    const agreed = form.getAll("DisclaimerAgree")[0] === "true";
    const option = (ENTRY_OPTIONS[t] ?? []).find((o) => o.value === eventId);
    if (!signedIn || form.get("__RequestVerificationToken") !== "fake-form-token") {
      html("<main><h2>Something went wrong</h2></main>", 400);
      return true;
    }
    opts.submissions?.push({ tournament: t, eventId, agreed });
    if (!option || !agreed) {
      redirect(`/individual-entry/${t}?error=1`);
      return true;
    }
    if (opts.paid?.has(t)) {
      redirect(`/online-entry/payment/${t}`);
      return true;
    }
    entered.set(t, {
      eventNo: option.eventNo,
      event: option.event,
      label: option.label.replace(/\s*\$.*$/, ""),
    });
    redirect(`/individual-entry/${t}`);
    return true;
  }
  const pay = /^\/online-entry\/payment\/([0-9a-f-]+)$/.exec(path);
  if (pay) {
    const fee = (ENTRY_OPTIONS[pay[1]] ?? [])[0]?.label.match(/\$[\d.]+/)?.[0] ?? "";
    html(fixture("entries/payment.html").replace("{{FEE}}", fee));
    return true;
  }
  return false;
}

if (process.argv[1]?.endsWith("fake-tc.ts")) {
  const server = createFakeTc();
  server.listen(FAKE_TC_PORT, "127.0.0.1", () =>
    console.log(`fake Tennis Canada site on http://127.0.0.1:${FAKE_TC_PORT}`),
  );
}
