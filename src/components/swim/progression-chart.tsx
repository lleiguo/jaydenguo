"use client";

import { useMemo, useRef, useState } from "react";
import { formatSwimTime } from "@/domain/swim";
import type { ForecastPoint } from "@/domain/swim-forecast";

// Progression for one event and course (SWM-4) with the forecast (SWM-5).
// Hand-drawn SVG: no chart library, no inline styles, so it renders on the
// server and runs under the strict CSP. Faster times are higher up. Every
// value is also in the table under the chart.

type Point = { id: string; swimDate: string; timeMs: number; isPb: boolean };

type Props = {
  points: Point[];
  pbSteps: { swimDate: string; timeMs: number }[];
  forecast: { curve: { date: string; timeMs: number }[]; points: ForecastPoint[] } | null;
  today: string;
  label: string;
};

const W = 720;
const H = 320;
const M = { top: 16, right: 20, bottom: 36, left: 64 };
const DAY = 86_400_000;
const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) =>
  `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
}

type Hover = { x: number; lines: [string, string][]; y: number };

export function ProgressionChart({ points, pbSteps, forecast, today, label }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const scale = useMemo(() => {
    const dates = [
      ...points.map((p) => day(p.swimDate)),
      ...(forecast?.points.map((p) => day(p.date)) ?? []),
    ];
    const times = [
      ...points.map((p) => p.timeMs),
      ...(forecast?.points.flatMap((p) => [p.lowMs, p.highMs]) ?? []),
      ...(forecast?.curve.map((c) => c.timeMs) ?? []),
    ];
    let x0 = Math.min(...dates);
    let x1 = Math.max(...dates);
    if (x1 - x0 < 60) [x0, x1] = [x0 - 30, x1 + 30];
    const pad = (Math.max(...times) - Math.min(...times)) * 0.08 || 1000;
    const t0 = Math.min(...times) - pad;
    const t1 = Math.max(...times) + pad;
    const x = (d: number) => M.left + ((d - x0) / (x1 - x0)) * (W - M.left - M.right);
    // Faster (smaller) times at the top.
    const y = (t: number) => M.top + ((t - t0) / (t1 - t0)) * (H - M.top - M.bottom);
    const step = niceStep(t1 - t0, 6);
    const yTicks: number[] = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) yTicks.push(t);
    const xTicks: { d: number; label: string }[] = [];
    const first = new Date(x0 * DAY);
    const spanMonths = (x1 - x0) / 30.4;
    const every = spanMonths > 30 ? 6 : spanMonths > 12 ? 3 : spanMonths > 5 ? 2 : 1;
    for (let m = first.getUTCMonth() + 1; ; m += 1) {
      const d = Date.UTC(first.getUTCFullYear(), m, 1) / DAY;
      if (d > x1) break;
      const month = new Date(d * DAY).getUTCMonth();
      if (month % every) continue;
      xTicks.push({ d, label: month === 0 ? String(new Date(d * DAY).getUTCFullYear()) : MONTHS[month] });
    }
    return { x, y, yTicks, xTicks, x0, x1 };
  }, [points, forecast]);

  const { x, y } = scale;
  const lastDay = points.length ? day(points[points.length - 1].swimDate) : scale.x1;
  const pbPath = pbSteps
    .map((s, i) => {
      const next = pbSteps[i + 1] ? day(pbSteps[i + 1].swimDate) : lastDay;
      return `${i ? "L" : "M"}${x(day(s.swimDate))},${y(s.timeMs)} H${x(next)}${
        pbSteps[i + 1] ? ` V${y(pbSteps[i + 1].timeMs)}` : ""
      }`;
    })
    .join(" ");
  const curvePath = forecast?.curve
    .map((c, i) => `${i ? "L" : "M"}${x(day(c.date))},${y(c.timeMs)}`)
    .join(" ");
  const todayX = day(today) >= scale.x0 && day(today) <= scale.x1 ? x(day(today)) : null;

  // Hover and focus: snap to the nearest swim or projection.
  const targets = useMemo(() => {
    const list: { d: number; lines: [string, string][]; t: number }[] = points.map((p) => ({
      d: day(p.swimDate),
      t: p.timeMs,
      lines: [
        [formatSwimTime(p.timeMs), shortDate(p.swimDate)],
        ...(p.isPb ? ([["PB", "new personal best"]] as [string, string][]) : []),
      ],
    }));
    for (const f of forecast?.points ?? [])
      list.push({
        d: day(f.date),
        t: f.timeMs,
        lines: [
          [`≈ ${formatSwimTime(f.timeMs)}`, `Estimate, ${shortDate(f.date)}`],
          [`${formatSwimTime(f.lowMs)}–${formatSwimTime(f.highMs)}`, "likely range"],
        ],
      });
    return list;
  }, [points, forecast]);

  const show = (t: (typeof targets)[number]) => setHover({ x: x(t.d), y: y(t.t), lines: t.lines });
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg || !targets.length) return;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const nearest = targets.reduce((a, b) => (Math.abs(x(b.d) - px) < Math.abs(x(a.d) - px) ? b : a));
    show(nearest);
  };

  const tipW = 190;
  const tipH = 12 + (hover?.lines.length ?? 0) * 20;
  const tipX = hover ? (hover.x + 12 + tipW > W - M.right ? hover.x - 12 - tipW : hover.x + 12) : 0;
  const tipY = hover ? Math.min(Math.max(M.top, hover.y - tipH / 2), H - M.bottom - tipH) : 0;

  return (
    <figure className="swim-chart flex flex-col gap-2">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-700 dark:text-neutral-300">
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="4" className="swim-dot" />
          </svg>
          Swims
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="14" aria-hidden="true">
            <path d="M1 7 H17" className="swim-pb" />
          </svg>
          Personal best
        </span>
        {forecast && (
          <span className="flex items-center gap-1.5">
            <svg width="18" height="14" aria-hidden="true">
              <path d="M1 7 H17" className="swim-forecast" />
            </svg>
            Estimate with likely range
          </span>
        )}
        <span className="text-neutral-500">Faster is higher.</span>
      </figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full rounded-md"
        role="img"
        aria-label={`${label}: ${points.length} swims${forecast ? ", with an estimate" : ""}. Values are in the table below.`}
        onPointerLeave={() => setHover(null)}
      >
        {scale.yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="swim-grid" />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="swim-axis">
              {formatSwimTime(t)}
            </text>
          </g>
        ))}
        {scale.xTicks.map((t) => (
          <text key={t.d} x={x(t.d)} y={H - M.bottom + 20} textAnchor="middle" className="swim-axis">
            {t.label}
          </text>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} className="swim-grid" />
        {todayX !== null && (
          <g>
            <line x1={todayX} x2={todayX} y1={M.top} y2={H - M.bottom} className="swim-today" />
            <text x={todayX + 4} y={M.top + 10} className="swim-axis">
              Today
            </text>
          </g>
        )}
        {curvePath && <path d={curvePath} className="swim-forecast" />}
        {forecast?.points.map((f) => (
          <g key={f.date}>
            <line
              x1={x(day(f.date))}
              x2={x(day(f.date))}
              y1={y(f.lowMs)}
              y2={y(f.highMs)}
              className="swim-range"
            />
            <line
              x1={x(day(f.date)) - 6}
              x2={x(day(f.date)) + 6}
              y1={y(f.lowMs)}
              y2={y(f.lowMs)}
              className="swim-range"
            />
            <line
              x1={x(day(f.date)) - 6}
              x2={x(day(f.date)) + 6}
              y1={y(f.highMs)}
              y2={y(f.highMs)}
              className="swim-range"
            />
            <circle cx={x(day(f.date))} cy={y(f.timeMs)} r="5" className="swim-forecast-dot" />
          </g>
        ))}
        {pbPath && <path d={pbPath} className="swim-pb" />}
        {points.map((p) => (
          <circle
            key={p.id}
            cx={x(day(p.swimDate))}
            cy={y(p.timeMs)}
            r={p.isPb ? 5 : 4}
            className={p.isPb ? "swim-dot swim-dot-pb" : "swim-dot"}
            tabIndex={0}
            aria-label={`${shortDate(p.swimDate)}: ${formatSwimTime(p.timeMs)}${p.isPb ? ", personal best" : ""}`}
            onFocus={() =>
              show({
                d: day(p.swimDate),
                t: p.timeMs,
                lines: targets.find((t) => t.d === day(p.swimDate) && t.t === p.timeMs)!.lines,
              })
            }
            onBlur={() => setHover(null)}
          />
        ))}
        <rect
          x={M.left}
          y={M.top}
          width={W - M.left - M.right}
          height={H - M.top - M.bottom}
          className="swim-hit"
          onPointerMove={onMove}
        />
        {hover && (
          <g pointerEvents="none">
            <line x1={hover.x} x2={hover.x} y1={M.top} y2={H - M.bottom} className="swim-crosshair" />
            <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="6" className="swim-tip" />
            {hover.lines.map(([value, what], i) => (
              <text key={i} x={tipX + 10} y={tipY + 22 + i * 20} className="swim-tip-text">
                <tspan className="swim-tip-value">{value}</tspan> {what}
              </text>
            ))}
          </g>
        )}
      </svg>
    </figure>
  );
}
