import type { Point } from "../../domain/leave";
import { googleRequester, type Requester } from "../tennis/drive";

// Drive time with live traffic (intent 0027, TRF-R1): Google Routes
// `computeRoutes`, TRAFFIC_AWARE, leaving now, called with the worker's own
// service account like the tennis drive times (TEN-9), so there's no API key
// (TRFSEC-4). Without ROUTES_PROJECT (local runs) there's no route service.
// Addresses and places are never logged.

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

export const ROUTE_FIELDS = "routes.duration,routes.legs.startLocation,routes.legs.endLocation";

const waypoint = (p: Place) =>
  "address" in p ? { address: p.address } : { location: { latLng: { latitude: p.lat, longitude: p.lng } } };

type LatLng = { latLng?: { latitude?: number; longitude?: number } } | undefined;
const point = (l: LatLng): Point | null =>
  typeof l?.latLng?.latitude === "number" && typeof l.latLng.longitude === "number"
    ? { lat: l.latLng.latitude, lng: l.latLng.longitude }
    : null;

export function googleRoutes(request: () => Promise<Requester>): RouteFn {
  let requester: Promise<Requester> | null = null;
  return async (origin, destination) => {
    requester ??= request();
    const res = await (
      await requester
    )({
      origin: waypoint(origin),
      destination: waypoint(destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    });
    // A route the service can't make is a 200 with no routes, or a 400 or
    // 404 for an address it can't find. Status only: the body can echo the
    // addresses.
    if (res.status === 400 || res.status === 404) return null;
    if (res.status !== 200) throw new Error(`Routes API ${res.status}`);
    const route = (
      res.data as {
        routes?: { duration?: string; legs?: { startLocation?: LatLng; endLocation?: LatLng }[] }[];
      } | null
    )?.routes?.[0];
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
  const project = process.env.ROUTES_PROJECT;
  return project ? googleRoutes(() => googleRequester(project, ROUTE_FIELDS)) : null;
}
