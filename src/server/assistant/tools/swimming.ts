import { z } from "zod";
import { eventLabel, formatChange, formatSwimTime } from "@/domain/swim";
import { listMeets, listResults, loadEvent, loadPersonalBests, type ResultView } from "../../swim/load";
import { shapeMeet } from "./shape";
import { has, problem, type Tool } from "./types";

const input = z.object({
  view: z
    .enum(["meets", "results", "pbs", "event"])
    .describe(
      "meets: upcoming meets with his sessions and entries, and the last few past ones. results: his latest swims (or one meet's, with `meet`). pbs: personal bests. event: one event's history and forecast (needs `event`).",
    ),
  event: z.string().optional().describe('An event, e.g. "200 IM", "50 free", "100 back SCM"'),
  meet: z.string().optional().describe("A meet's name, or part of it"),
});

const MAX_SWIMS = 20;

const shapeSwim = (r: ResultView) => ({
  date: r.swimDate,
  meet: r.meetName,
  event: eventLabel(r),
  time: r.timeMs ? formatSwimTime(r.timeMs) : undefined,
  place: r.place,
  pb: r.isPb || undefined,
  change: r.changeMs ? formatChange(r.changeMs) : undefined,
  disqualified: r.dqReason ?? undefined,
});

// "200 IM" matches "200 IM SCM" and "200 IM LCM": every word asked for is
// in the event's label.
const matches = (label: string, asked: string) => {
  const words = label.toLowerCase().split(" ");
  return asked
    .toLowerCase()
    .replace(/freestyle/g, "free")
    .replace(/backstroke/g, "back")
    .replace(/breaststroke/g, "breast")
    .replace(/butterfly/g, "fly")
    .replace(/individual medley|medley/g, "im")
    .replace(/(\d)\s*m\b/g, "$1")
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => words.includes(w));
};

// TOOL-4: the primary person's swimming (TOOL-16).
export const swimmingTool: Tool<z.infer<typeof input>> = {
  name: "swimming",
  kind: "hub",
  label: "Swimming",
  description:
    "Swimming for the family's swimmer only (the first name in People): upcoming meets with sessions and entries, results, personal bests, and one event's progression with a forecast.",
  input,
  async run(ctx, q) {
    if (q.view === "meets") {
      const m = await listMeets(ctx.db);
      return { upcoming: m.upcoming.map(shapeMeet), lastMeets: m.past.slice(0, 3).map(shapeMeet) };
    }

    if (q.view === "results") {
      const all = await listResults(ctx.db);
      const shown = q.meet ? all.filter((r) => has(r.meetName, q.meet!)) : all;
      if (q.meet && !shown.length) return problem(`no results for a meet called ${q.meet}`);
      return { swims: shown.slice(0, MAX_SWIMS).map(shapeSwim), more: shown.length > MAX_SWIMS || undefined };
    }

    if (q.view === "pbs") {
      const pbs = await loadPersonalBests(ctx.db);
      return {
        personalBests: pbs.map((p) => ({
          event: eventLabel(p),
          time: formatSwimTime(p.timeMs),
          date: p.swimDate,
          meet: p.meetName,
          timesSwum: p.swims,
        })),
      };
    }

    if (!q.event) return problem("give the event in `event`, e.g. 200 IM");
    const keys = new Map((await listResults(ctx.db)).map((r) => [r.key, eventLabel(r)]));
    const found = [...keys].filter(([, label]) => matches(label, q.event!));
    if (!found.length)
      return problem(`he has no swims in ${q.event}; his events are ${[...keys.values()].join(", ")}`);
    const events = await Promise.all(found.slice(0, 3).map(([key]) => loadEvent(ctx.db, key)));
    return {
      events: events.flatMap((e) =>
        e
          ? [
              {
                event: eventLabel(e.event),
                personalBest: e.pbSteps.length
                  ? { time: formatSwimTime(e.pbSteps.at(-1)!.timeMs), date: e.pbSteps.at(-1)!.swimDate }
                  : undefined,
                swims: e.swims.slice(0, 8).map(shapeSwim),
                forecastEstimate:
                  e.forecast.status === "ok"
                    ? e.forecast.points.map((p) => ({
                        inMonths: p.months,
                        time: formatSwimTime(p.timeMs),
                        range: `${formatSwimTime(p.lowMs)}–${formatSwimTime(p.highMs)}`,
                      }))
                    : e.forecast.reason,
              },
            ]
          : [],
      ),
    };
  },
};
