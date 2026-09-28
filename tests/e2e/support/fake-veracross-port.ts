// Kept apart from fake-veracross.ts so the Playwright config can import it
// without loading the fake site.
export const FAKE_VERACROSS_PORT = Number(process.env.FAKE_VERACROSS_PORT ?? 4468);
