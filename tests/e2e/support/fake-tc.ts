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
  ]);
  return new Map([...r].map(([k, v]) => [k.toLowerCase(), v]));
}

type Options = {
  // Replace a page's HTML (e.g. a changed score) for one test.
  edit?: (file: string, html: string) => string;
  // Paths requested, for assertions.
  requests?: string[];
};

export function createFakeTc(opts: Options = {}): Server {
  const table = routes();
  const redirects = new Map(
    TC_FIXTURE.opponents.map((o) => [
      `/player/${TC_FIXTURE.org}/${Buffer.from(`base64:${o.memberId}`).toString("base64")}`.toLowerCase(),
      `/player-profile/${o.profileId}`,
    ]),
  );
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname.toLowerCase();
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

if (process.argv[1]?.endsWith("fake-tc.ts")) {
  const server = createFakeTc();
  server.listen(FAKE_TC_PORT, "127.0.0.1", () =>
    console.log(`fake Tennis Canada site on http://127.0.0.1:${FAKE_TC_PORT}`),
  );
}
