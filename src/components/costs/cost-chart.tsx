import type { DayTotal } from "@/domain/costs";

// Daily cost, stacked: infrastructure at the base, AI on top (COST-1).
// Server-rendered SVG with classes only (the strict CSP allows no inline
// styles). Each day's bar has a native tooltip, and every value is also in
// the table under the chart (NFR-9). Colours: the validated two-hue pair,
// stepped separately for dark mode.

const W = 760;
const H = 240;
const M = { top: 12, right: 8, bottom: 28, left: 52 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const INFRA_FILL = "fill-[#2a78d6] dark:fill-[#3987e5]";
export const AI_FILL = "fill-[#eb6834] dark:fill-[#d95926]";

function niceStep(max: number, target: number) {
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
}

export function money(n: number, currency: string, digits = 2) {
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${n.toFixed(digits)} ${currency}`;
  }
}

export function CostChart({ days, currency }: { days: DayTotal[]; currency: string }) {
  const max = Math.max(...days.map((d) => d.infra + d.ai), 0);
  const step = max > 0 ? niceStep(max, 4) : 1;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const slot = plotW / days.length;
  const barW = Math.max(1, slot - 2);
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const digits = top < 10 ? 2 : 0;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-medium">Cost per day, last {days.length} days</span>
        <Swatch fill={INFRA_FILL} label="Infrastructure" />
        <Swatch fill={AI_FILL} label="AI (Vertex AI)" />
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Daily cost for the last ${days.length} days, infrastructure and AI. The same numbers are in the table below.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-neutral-200 dark:stroke-neutral-800"
              strokeWidth={1}
            />
            <text
              x={M.left - 6}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-neutral-600 text-[11px] dark:fill-neutral-400"
            >
              {money(t, currency, digits)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = M.left + i * slot + 1;
          const infra = Math.max(0, d.infra);
          const ai = Math.max(0, d.ai);
          const hInfra = (infra / top) * plotH;
          const hAi = (ai / top) * plotH;
          const label = `${d.day}: ${money(d.total, currency)} (infrastructure ${money(d.infra, currency)}, AI ${money(d.ai, currency)})`;
          return (
            <g key={d.day} className="group">
              <title>{label}</title>
              {/* A full-height hit area, bigger than the bar. */}
              <rect
                x={x - 1}
                y={M.top}
                width={slot}
                height={plotH}
                className="fill-transparent group-hover:fill-neutral-500/10"
              />
              {hInfra > 0 && (
                <rect x={x} y={y(infra)} width={barW} height={hInfra} rx={1} className={INFRA_FILL} />
              )}
              {hAi > 0 && (
                <rect
                  x={x}
                  y={y(infra) - hAi - (hInfra > 0 ? 1 : 0)}
                  width={barW}
                  height={hAi}
                  rx={1}
                  className={AI_FILL}
                />
              )}
              {d.day.endsWith("-01") && (
                <text x={x} y={H - 8} className="fill-neutral-600 text-[11px] dark:fill-neutral-400">
                  {MONTHS[Number(d.day.slice(5, 7)) - 1]} 1
                </text>
              )}
            </g>
          );
        })}
        <line
          x1={M.left}
          x2={W - M.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-neutral-400 dark:stroke-neutral-600"
          strokeWidth={1}
        />
      </svg>
    </figure>
  );
}

function Swatch({ fill, label }: { fill: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="12" height="12" aria-hidden="true">
        <rect width="12" height="12" rx="2" className={fill} />
      </svg>
      {label}
    </span>
  );
}
