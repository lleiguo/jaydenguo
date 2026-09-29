"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import FullCalendar, { type CalendarRef, type EventDropInfo, type EventInput } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/domain/constants";
import { schoolBlocks } from "@/domain/school-blocks";
import { RefreshButton } from "@/components/sport/refresh-button";
import type { CalendarPayload, ClashView, EventView, Undo } from "@/lib/calendar-types";
import { allDayMove } from "./all-day";
import { call } from "./api";
import { CATEGORY_INFO } from "./categories";
import { EventDetail } from "./event-detail";
import { EventForm } from "./event-form";
import { usePersistentFilters, type Filters } from "./filters";
import { Modal } from "./modal";
import { announceChange, useLiveUpdates } from "./use-live-updates";
import { UndoToast, nextToastId, type Toast } from "./undo-toast";

// The combined calendar (plan M1.8-M1.11).

type Range = { from: string; to: string };
type Clash = ClashView & { other?: EventView };

function isVisible(e: EventView, f: Filters): boolean {
  // Closure banners stay visible whoever is hidden (CAL-3a).
  if (e.category === "school_closure") return true;
  // Shown while any of its people is (owner, 2026-09-28).
  if (!e.owners.some((id) => !f.hiddenPeople.includes(id))) return false;
  if (f.hiddenCategories.includes(e.category)) return false;
  if (e.source && f.hiddenSources.includes(e.source.id)) return false;
  return true;
}

export function CalendarApp({ initialView, initialDate }: { initialView?: string; initialDate?: string }) {
  const calRef = useRef<CalendarRef>(null);
  const [mounted, setMounted] = useState(false);
  const [range, setRange] = useState<Range | null>(null);
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [filters, setFilters] = usePersistentFilters();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventView | "new" | null>(null);
  const [series, setSeries] = useState<Parameters<typeof EventForm>[0]["series"]>();
  const [toast, setToast] = useState<Toast | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  // SCH-1: school days show one "School" block until tapped (per visit).
  const [expandedSchool, setExpandedSchool] = useState<ReadonlySet<string>>(new Set());

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const load = useCallback(async (r: Range) => {
    const res = await fetch(
      `/api/v1/events?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,
    );
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (range) void load(range);
  }, [range, load]);
  const reload = useCallback(() => {
    if (range) void load(range);
  }, [range, load]);
  useLiveUpdates(data?.cursor ?? null, reload);

  const byId = useMemo(() => new Map((data?.events ?? []).map((e) => [e.id, e])), [data]);
  const people = useMemo(() => data?.people ?? [], [data]);
  // Names on an event, unless it's only the primary person's.
  const ownerLabel = useCallback(
    (e: EventView) => {
      const primary = people.find((p) => p.isPrimary)?.id;
      if (e.owners.length === 1 && e.owners[0] === primary) return null;
      return people
        .filter((p) => e.owners.includes(p.id))
        .map((p) => p.name)
        .join(", ");
    },
    [people],
  );
  const clashesOf = useMemo(() => {
    const m = new Map<string, Clash[]>();
    for (const c of data?.clashes ?? []) {
      for (const [self, other] of [
        [c.a, c.b],
        [c.b, c.a],
      ]) {
        m.set(self, [...(m.get(self) ?? []), { ...c, other: byId.get(other) }]);
      }
    }
    return m;
  }, [data, byId]);

  const sources = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of data?.events ?? []) if (e.source) m.set(e.source.id, e.source.name);
    return [...m];
  }, [data]);

  const shown = useMemo(
    () =>
      (data?.events ?? []).filter(
        (e) => !(e.status === "cancelled" && e.source === null) && isVisible(e, filters),
      ),
    [data, filters],
  );
  const blocks = useMemo(() => (data ? schoolBlocks(shown, data.homeTimeZone) : []), [shown, data]);

  const fcEvents: EventInput[] = useMemo(() => {
    if (!data) return [];
    const out: EventInput[] = [];
    // Open clashes of some events, split by whether the other side is shown.
    const clashState = (ids: string[]) => {
      const open = ids.flatMap((id) => clashesOf.get(id) ?? []).filter((c) => !c.acceptedId);
      const visible = open.some((c) => !c.other || isVisible(c.other, filters));
      const hidden = open.some((c) => c.other && !isVisible(c.other, filters));
      return { open: open.length > 0, clash: visible ? "visible" : hidden ? "hidden" : null };
    };
    const folded = new Set<string>();
    for (const b of blocks) {
      if (expandedSchool.has(b.date)) continue;
      for (const c of b.classes) folded.add(c.id);
      const { open, clash } = clashState(b.classes.map((c) => c.id));
      out.push({
        id: `school:${b.date}`,
        title: "School",
        start: b.start,
        end: b.end,
        editable: false,
        className: ["hub-ev", "cat-school_class", open ? "hub-clash" : ""].filter(Boolean).join(" "),
        extendedProps: { schoolBlock: { date: b.date, count: b.classes.length }, clash },
      });
    }
    for (const e of shown) {
      if (folded.has(e.id)) continue;
      const { open, clash } = clashState([e.id]);
      out.push({
        id: e.id,
        title: e.title,
        // All-day events are stored as UTC midnights of their dates; the
        // calendar runs in the home zone, so give it plain dates or it
        // shows them a day early west of UTC.
        start: e.allDay ? e.start.slice(0, 10) : e.start,
        end: e.allDay ? e.end.slice(0, 10) : e.end,
        allDay: e.allDay,
        editable: e.status === "active" && !e.deletedAt,
        className: [
          "hub-ev",
          `cat-${e.category}`,
          open ? "hub-clash" : "",
          e.override?.skip ? "hub-skipped" : "",
          e.status === "cancelled" ? "hub-cancelled" : "",
        ]
          .filter(Boolean)
          .join(" "),
        extendedProps: { view: e, clash },
      });
    }
    for (const d of data.closures) {
      const next = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      out.push({ start: d, end: next, allDay: true, display: "background", className: "hub-closure-bg" });
    }
    return out;
  }, [data, filters, clashesOf, shown, blocks, expandedSchool]);

  const done = useCallback(
    (message: string, undo?: Undo) => {
      setSelected(null);
      setEditing(null);
      setSeries(undefined);
      setToast({ message, undo, id: nextToastId() });
      reload();
      announceChange();
    },
    [reload],
  );

  // CON-3: drag and drop (mouse, or long-press on touch) saves a move.
  const onDrop = async (info: Pick<EventDropInfo, "event" | "oldEvent" | "revert">) => {
    const { event, oldEvent } = info;
    if (event.allDay !== oldEvent.allDay || !event.start) {
      info.revert();
      setToast({ message: "Use Move to… to change between all-day and timed.", id: nextToastId() });
      return;
    }
    const end =
      event.end ??
      new Date(event.start.getTime() + ((oldEvent.end?.getTime() ?? 0) - (oldEvent.start?.getTime() ?? 0)));
    try {
      const res = await call<{ undo: Undo }>(
        `/api/v1/events/${event.id}/move`,
        "POST",
        event.allDay ? allDayMove(event, oldEvent) : { start: event.start, end },
      );
      done(`Moved ${event.title}.`, res.undo);
    } catch (err) {
      info.revert();
      setToast({ message: (err as Error).message, id: nextToastId() });
    }
  };

  const openEdit = async (e: EventView) => {
    if (e.seriesId) setSeries(await call(`/api/v1/series/${e.seriesId}`, "GET"));
    setEditing(e);
    setSelected(null);
  };

  const selectedEvent = selected ? byId.get(selected) : undefined;
  const openClashes = (data?.clashes ?? []).filter((c) => !c.acceptedId).length;
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* CAL-3a people chips, always visible above the calendar. */}
        {people.map((p) => {
          const on = !filters.hiddenPeople.includes(p.id);
          return (
            <button
              key={p.id}
              aria-pressed={on}
              onClick={() =>
                setFilters({
                  ...filters,
                  hiddenPeople: on
                    ? [...filters.hiddenPeople, p.id]
                    : filters.hiddenPeople.filter((x) => x !== p.id),
                })
              }
              className={`rounded-full border px-3 py-1 text-sm ${on ? "border-blue-700 bg-blue-700 text-white" : ""}`}
            >
              {p.name}
            </button>
          );
        })}
        <button
          className="rounded-full border px-3 py-1 text-sm"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
        >
          Filters
        </button>
        {blocks.some((b) => expandedSchool.has(b.date)) && (
          <button
            className="rounded-full border px-3 py-1 text-sm"
            onClick={() => setExpandedSchool(new Set())}
          >
            Collapse school
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <RefreshButton sourceIds="all" site="all sources" what="the calendar" />
          <button
            className="rounded-md bg-blue-700 px-3 py-1 text-sm text-white"
            onClick={() => setEditing("new")}
          >
            + Add event
          </button>
        </div>
        {openClashes > 0 && (
          <a
            href="/settings/clashes"
            className="text-sm font-medium text-red-700 underline dark:text-red-400"
          >
            ⚠ {openClashes} clash{openClashes === 1 ? "" : "es"} in view
          </a>
        )}
      </div>

      {showFilters && (
        <fieldset className="flex flex-col gap-2 rounded border p-2 text-sm">
          <legend className="px-1">Show</legend>
          <div className="flex flex-wrap gap-3">
            {CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!filters.hiddenCategories.includes(c)}
                  onChange={(ev) =>
                    setFilters({
                      ...filters,
                      hiddenCategories: ev.target.checked
                        ? filters.hiddenCategories.filter((x) => x !== c)
                        : [...filters.hiddenCategories, c],
                    })
                  }
                />
                {CATEGORY_INFO[c].icon} {CATEGORY_INFO[c].label}
              </label>
            ))}
          </div>
          {sources.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {sources.map(([id, name]) => (
                <label key={id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!filters.hiddenSources.includes(id)}
                    onChange={(ev) =>
                      setFilters({
                        ...filters,
                        hiddenSources: ev.target.checked
                          ? filters.hiddenSources.filter((x) => x !== id)
                          : [...filters.hiddenSources, id],
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <div data-testid="calendar" className="hub-cal min-h-[60vh] p-1">
        {mounted && data !== undefined && (
          <FullCalendar
            ref={calRef}
            plugins={[classicThemePlugin, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={initialView ?? (narrow ? "listWeek" : "timeGridWeek")}
            initialDate={initialDate}
            timeZone={data?.homeTimeZone ?? "local"}
            headerToolbar={{
              start: "prev,next today",
              center: "title",
              end: "timeGridDay,timeGridWeek,dayGridMonth,listWeek",
            }}
            buttons={{
              timeGridDay: { text: "Day" },
              timeGridWeek: { text: "Week" },
              dayGridMonth: { text: "Month" },
              listWeek: { text: "Agenda" },
              today: { text: "Today" },
            }}
            height="auto"
            nowIndicator
            editable
            eventDurationEditable
            eventLongPressDelay={400}
            slotMinTime="06:00:00"
            slotMaxTime="22:00:00"
            dayMaxEvents
            events={fcEvents}
            datesSet={(arg) => {
              const next = { from: arg.start.toISOString(), to: arg.end.toISOString() };
              setRange((r) => (r?.from === next.from && r?.to === next.to ? r : next));
            }}
            eventClick={(arg) => {
              arg.jsEvent.preventDefault();
              const block = arg.event.extendedProps.schoolBlock as { date: string } | undefined;
              if (block) setExpandedSchool((s) => new Set(s).add(block.date));
              else if (arg.event.id) setSelected(arg.event.id);
            }}
            eventDrop={onDrop}
            eventResize={(info) => onDrop(info)}
            eventContent={(arg) => {
              const clash = arg.event.extendedProps.clash as string | null;
              const clashMark = clash && (
                <span
                  role="img"
                  aria-label={clash === "hidden" ? "clash with a hidden event" : "clash"}
                  title={clash === "hidden" ? "Clash with a hidden event" : "Clash"}
                >
                  ⚠
                </span>
              );
              const block = arg.event.extendedProps.schoolBlock as
                { date: string; count: number } | undefined;
              if (block) {
                return (
                  <div
                    className="hub-ev-body"
                    data-testid="school-block"
                    data-date={block.date}
                    data-clash={clash ?? "none"}
                    title="Show the classes"
                  >
                    <span role="img" aria-label="School">
                      🏫
                    </span>
                    {clashMark}
                    {arg.timeText && <span>{arg.timeText}</span>}
                    <span className="hub-title">School · {block.count} classes</span>
                  </div>
                );
              }
              const e = arg.event.extendedProps.view as EventView | undefined;
              if (!e) return null;
              const info = CATEGORY_INFO[e.category];
              return (
                <div
                  className="hub-ev-body"
                  data-testid="cal-event"
                  data-event-id={e.id}
                  data-clash={clash ?? "none"}
                >
                  <span role="img" aria-label={info.label}>
                    {info.icon}
                  </span>
                  {clashMark}
                  {arg.timeText && <span>{arg.timeText}</span>}
                  <span className="hub-title">{e.title}</span>
                  {ownerLabel(e) && <span className="hub-owner">· {ownerLabel(e)}</span>}
                  {e.override?.sourceChangedAt && <span title="Source changed since you moved this">↻</span>}
                  {e.schoolClosed && <span title="School closed">🚫</span>}
                </div>
              );
            }}
          />
        )}
      </div>

      {selectedEvent && data && (
        <Modal title={selectedEvent.title} onClose={() => setSelected(null)}>
          <EventDetail
            event={selectedEvent}
            clashes={clashesOf.get(selectedEvent.id) ?? []}
            people={data.people}
            tz={data.homeTimeZone}
            onAction={done}
            onEdit={() => openEdit(selectedEvent)}
          />
        </Modal>
      )}
      {editing && data && (
        <Modal
          title={editing === "new" ? "Add event" : series ? "Edit repeating event" : "Edit event"}
          onClose={() => {
            setEditing(null);
            setSeries(undefined);
          }}
        >
          <EventForm
            tz={data.homeTimeZone}
            people={data.people}
            event={editing === "new" || series ? undefined : editing}
            series={series}
            defaultDate={range?.from.slice(0, 10)}
            onSaved={(m) => done(m)}
          />
        </Modal>
      )}
      <UndoToast
        toast={toast}
        onDone={(undone) => {
          setToast(null);
          if (undone) {
            reload();
            announceChange();
          }
        }}
      />
    </div>
  );
}
