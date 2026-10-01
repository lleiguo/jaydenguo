import { api } from "@/server/http";
import { videoGoogleAccess } from "@/server/video/store";

// Whether Google Drive and Photos are connected.
export const GET = api(async ({ db }) => Response.json({ google: await videoGoogleAccess(db) }));
