import type { Attendance, Category } from "@/domain/constants";

// What the calendar API returns (spec CAL-1..9, CON-2..5). Shared by the
// route handlers and the client.

export type EventView = {
  id: string;
  title: string;
  category: Category;
  attendance: Attendance;
  // Effective times (after a move), ISO strings.
  start: string;
  end: string;
  allDay: boolean;
  status: "active" | "cancelled";
  deletedAt: string | null;
  notes: string | null;
  locationName: string | null;
  sourceUrl: string | null;
  // Null for events added on this site.
  source: { id: string; name: string; kind: string } | null;
  seriesId: string | null;
  lastSyncedAt: string | null;
  override: {
    id: string;
    skip: boolean;
    // Whose event it is, when the owner changed it from the source's.
    attendance: Attendance | null;
    moved: boolean;
    originalStart: string;
    originalEnd: string;
    // The source changed the event after it was moved (CON-5).
    sourceChangedAt: string | null;
    snapshot: { start: string; end: string; title: string } | null;
    createdBy: string;
    createdAt: string;
  } | null;
  // An activity on a school closure day (CAL-7).
  schoolClosed: boolean;
};

export type ClashView = {
  a: string;
  b: string;
  overlapMin: number;
  // Set when the owner accepted this clash (CON-4).
  acceptedId: string | null;
};

export type CalendarPayload = {
  events: EventView[];
  clashes: ClashView[];
  closures: string[];
  homeTimeZone: string;
  cursor: number;
};

// How the client undoes an action (CON-3: undo for 10 s).
export type Undo = { method: "POST"; url: string; body?: unknown };
