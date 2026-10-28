import { checkLeave } from "../server/leave/check";
import { defaultRoutes } from "../server/traffic/routes";
import type { JobContext } from "./context";

// "Time to leave" (intent 0027): every 5 minutes through the day.
export async function leaveCheckJob(_args: string[], ctx: JobContext) {
  const routes = defaultRoutes();
  if (!routes) {
    ctx.log("leave: no ROUTES_API_KEY, nothing checked", {}, "WARNING");
    return;
  }
  const result = await checkLeave(await ctx.db(), { routes, log: ctx.log });
  ctx.log("leave: checked", result);
}
