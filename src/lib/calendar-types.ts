import type { Attendance, Category } from "@/domain/constants";
import type { Person } from "@/domain/people";

// What the calendar API returns (spec CAL-1..9, CON-2..5). Shared by the
// route handlers and the client.

export type EventView = {
  id: string;
  title: string;
  category: Category;
  attendance: Attendance;
  // Whose event (`people.id`s), after any override; never empty.
  owners: string[];
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
  // One occurrence of a repeating event (a series here, or a feed's), so
  // "skip every repeat" applies. Optional so the app still reads answers
  // cached before the field existed.
  repeats?: boolean;
  // Cookie added it and the worker hasn't written it to the family's
  // Google Calendar yet (intent 0008, GCW-4). Optional, like `repeats`.
  beingAdded?: boolean;
  lastSyncedAt: string | null;
  override: {
    id: string;
    skip: boolean;
    // Whose event it is, when the owner changed it from the source's.
    attendance: Attendance | null;
    // Whose event, when the owner changed it from the source's.
    owners: string[] | null;
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
  // The people both events belong to.
  people: string[];
  // Set when the owner accepted this clash (CON-4).
  acceptedId: string | null;
};

export type CalendarPayload = {
  events: EventView[];
  clashes: ClashView[];
  closures: string[];
  homeTimeZone: string;
  // Primary person first.
  people: Person[];
  // The signed-in parent's person, by their Google email (intent 0024,
  // OWN-4): a new event is ticked for them. Only on GET /api/v1/events.
  me?: string | null;
  cursor: number;
};

// How the client undoes an action (CON-3: undo for 10 s).
export type Undo = { method: "POST"; url: string; body?: unknown };
