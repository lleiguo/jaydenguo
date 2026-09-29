import { deviceTokenInput, exchangeDeviceCode } from "@/server/auth/device";
import { clientIp } from "@/server/auth/rate-limit";
import { publicApi, readJson } from "@/server/http";

// intent 0004, API-1: the iPhone app swaps its sign-in code and PKCE
// verifier for a device token (public: the code is the credential).
export const POST = publicApi(async ({ db, request }) => {
  const input = await readJson(request, deviceTokenInput);
  const result = await exchangeDeviceCode(
    db,
    input,
    clientIp(request.headers),
    request.headers.get("user-agent"),
  );
  return Response.json(result, { status: 201 });
});
