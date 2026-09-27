// Driving time from home to a tournament venue (TEN-9), from Google's Routes
// API with the worker's own service account (no API key). Only the home
// postal code and the venue's public address are sent. Without
// ROUTES_PROJECT (local runs, tests) there's no drive time, and the job
// falls back to the site's straight-line search radius.

export type DriveTimer = (from: string, to: string) => Promise<number | null>;

type Requester = (body: unknown) => Promise<{ status: number; data: unknown }>;

async function googleRequester(project: string): Promise<Requester> {
  const { GoogleAuth } = await import("google-auth-library");
  const client = await new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  }).getClient();
  return async (body) => {
    const res = await client.request({
      url: "https://routes.googleapis.com/directions/v2:computeRoutes",
      method: "POST",
      headers: {
        "X-Goog-User-Project": project,
        "X-Goog-FieldMask": "routes.duration",
      },
      data: body,
      validateStatus: () => true,
      timeout: 15_000,
    });
    return { status: res.status, data: res.data };
  };
}

// "4210s" → 71 minutes.
export function minutesOf(data: unknown): number | null {
  const d = (data as { routes?: { duration?: string }[] } | null)?.routes?.[0]?.duration;
  const s = typeof d === "string" ? Number(d.replace(/s$/, "")) : NaN;
  return Number.isFinite(s) && s >= 0 ? Math.round(s / 60) : null;
}

export function routesDriveTimer(opts: { project?: string; request?: Requester } = {}): DriveTimer | null {
  const project = opts.project ?? process.env.ROUTES_PROJECT;
  if (!project && !opts.request) return null;
  let requester: Promise<Requester> | null = opts.request ? Promise.resolve(opts.request) : null;
  const cache = new Map<string, number | null>();
  return async (from, to) => {
    const key = `${from}|${to}`;
    if (cache.has(key)) return cache.get(key)!;
    requester ??= googleRequester(project!);
    const res = await (
      await requester
    )({
      origin: { address: from },
      destination: { address: to },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
    });
    const minutes = res.status === 200 ? minutesOf(res.data) : null;
    cache.set(key, minutes);
    return minutes;
  };
}
