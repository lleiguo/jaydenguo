import type { Point } from "../../domain/leave";
import { registerSecret } from "../log";

// Drive time with live traffic (intent 0027, TRF-R1): Google Routes
// `computeRoutes`, TRAFFIC_AWARE, leaving now. The key is ROUTES_API_KEY,
// restricted to this API (TRFSEC-4). Addresses and places are never logged.

export type Place = Point | { address: string };

export type Route = {
  minutes: number;
  // Where the route starts and ends, so the job can tell "still there" and
  // "arrived" (TRF-P3, TRF-P4) even when it started from an address.
  start: Point | null;
  end: Point | null;
};

// `null`: the service couldn't find a drivable route (an address it can't
// resolve, TRF-E2). Throws on any other failure (TRF-R4).
export type RouteFn = (origin: Place, destination: Place) => Promise<Route | null>;

const URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELDS = "routes.duration,routes.legs.startLocation,routes.legs.endLocation";

const waypoint = (p: Place) =>
  "address" in p ? { address: p.address } : { location: { latLng: { latitude: p.lat, longitude: p.lng } } };

type LatLng = { latLng?: { latitude?: number; longitude?: number } } | undefined;
const point = (l: LatLng): Point | null =>
  typeof l?.latLng?.latitude === "number" && typeof l.latLng.longitude === "number"
    ? { lat: l.latLng.latitude, lng: l.latLng.longitude }
    : null;

export function googleRoutes(key: string, fetchFn: typeof fetch = fetch): RouteFn {
  return async (origin, destination) => {
    const res = await fetchFn(URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": FIELDS },
      body: JSON.stringify({
        origin: waypoint(origin),
        destination: waypoint(destination),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // Status only: the body can echo the addresses.
    if (!res.ok) throw new Error(`Routes API ${res.status}`);
    const data = (await res.json()) as {
      routes?: { duration?: string; legs?: { startLocation?: LatLng; endLocation?: LatLng }[] }[];
    };
    const route = data.routes?.[0];
    const seconds = route?.duration ? Number.parseFloat(route.duration) : NaN;
    if (!route || !Number.isFinite(seconds)) return null;
    const legs = route.legs ?? [];
    return {
      minutes: Math.max(1, Math.round(seconds / 60)),
      start: point(legs[0]?.startLocation),
      end: point(legs.at(-1)?.endLocation),
    };
  };
}

export function defaultRoutes(): RouteFn | null {
  const key = process.env.ROUTES_API_KEY;
  if (!key) return null;
  registerSecret(key);
  return googleRoutes(key);
}
