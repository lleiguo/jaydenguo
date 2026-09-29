import { api } from "@/server/http";
import { tennisOverview } from "@/server/tennis/overview";

// TEN-2, TEN-3, TEN-6, TEN-9, TEN-10: everything on the Tennis page: his next
// matches with predictions, tournaments in progress, coming up and past, the
// "Upcoming tournaments" rows and the ones found for him.
export const GET = api(async ({ db }) => Response.json(await tennisOverview(db)));
