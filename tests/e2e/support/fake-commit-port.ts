// Kept apart from fake-commit.ts so the Playwright config can import it
// without loading the fake site.
export const FAKE_COMMIT_PORT = Number(process.env.FAKE_COMMIT_PORT ?? 4466);
