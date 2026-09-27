import { api } from "@/server/http";
import { loadCalibration } from "@/server/tennis/load";

// TEN-6: the backtest behind "How accurate is this?".
export const GET = api(async ({ db }) => Response.json(await loadCalibration(db)));
