import { api } from "@/server/http";
import { loadCosts } from "@/server/costs";

// COST-1..5: the numbers behind Settings → Costs.
export const GET = api(async ({ db }) => Response.json(await loadCosts(db)));
