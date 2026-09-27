// Kept apart from fake-tc.ts so the Playwright config can import it
// without loading the fake site.
export const FAKE_TC_PORT = Number(process.env.FAKE_TC_PORT ?? 4467);
