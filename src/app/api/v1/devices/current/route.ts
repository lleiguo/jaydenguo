import { api } from "@/server/http";
import {
  deviceKindsInput,
  deviceSettings,
  registerDevice,
  registerDeviceInput,
  setDeviceKinds,
} from "@/server/push/notify";

// This phone's notifications (intent 0004, PUSH-3): whether it's
// registered and which kinds it wants.
export const GET = api(async ({ db, session }) => Response.json(await deviceSettings(db, session)));

// The app sends its APNs token after each launch (PUSH-6).
export const POST = api(async ({ db, session, request }) =>
  Response.json(await registerDevice(db, session, registerDeviceInput.parse(await request.json()))),
);

// Kinds, and whose events "Time to leave" covers (intent 0027, TRF-A3).
export const PATCH = api(async ({ db, session, request }) =>
  Response.json(await setDeviceKinds(db, session, deviceKindsInput.parse(await request.json()))),
);
