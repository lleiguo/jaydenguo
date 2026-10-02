import type { z } from "zod";
import type { ToolKind } from "@/domain/assistant";
import type { Person } from "@/domain/people";
import { wallClock } from "@/domain/time";
import type { Db } from "../../db/client";
import type { MemoryView } from "../memory";
import type { AssistantSettings } from "../settings";
import type { AssistantSource } from "../turns";
import type { PageFetch, WebSearch } from "../web";

// One of Cookie's tools (intent 0007, spec §2.4). The list is fixed: adding
// a tool is a spec change. Hub tools only read, through the loaders the
// pages use.

export type ToolContext = {
  db: Db;
  now: Date;
  timeZone: string;
  people: Person[];
  // Who is asking, and their question's own words: memory tools act only
  // on what the question asks for (MEM-1, MEM-5).
  userId: string;
  question: string;
  // What this question has done so far.
  turn: TurnState;
  settings: AssistantSettings;
  web: { search: WebSearch; fetch: PageFetch };
};

export type TurnState = {
  // A web tool has run: nothing may be saved after that (MEM-1).
  webRan: boolean;
  saved: MemoryView | null;
  forgot: MemoryView | null;
  // A web search's answer: it ends the question, word for word.
  webAnswer: { text: string; sources: AssistantSource[] } | null;
  // Pages read with web_fetch, for the answer's sources (CHR-4).
  webSources: AssistantSource[];
  // What the searches cost, on top of Cookie's own model calls.
  webCost: { inputTokens: number; outputTokens: number; costUsd: number; searches: number };
};

export const newTurn = (): TurnState => ({
  webRan: false,
  saved: null,
  forgot: null,
  webAnswer: null,
  webSources: [],
  webCost: { inputTokens: 0, outputTokens: 0, costUsd: 0, searches: 0 },
});

export type Tool<I = unknown> = {
  name: string;
  kind: Exclude<ToolKind, "end">;
  // Shown under an answer as where it came from (CHR-4).
  label: string;
  description: string;
  input: z.ZodType<I>;
  run(ctx: ToolContext, input: I): Promise<unknown>;
};

// For the model: something it asked for can't be done, in words it can act on.
export const problem = (message: string) => ({ error: message });

const two = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Times go to the model in the home time zone, so it never converts:
// "2026-10-03 Sat 17:30".
export function stamp(at: Date | string, tz: string): string {
  const w = wallClock(new Date(at), tz);
  const day = DAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()];
  return `${w.year}-${two(w.month)}-${two(w.day)} ${day} ${two(w.hour)}:${two(w.minute)}`;
}

export function clock(at: Date | string, tz: string): string {
  const w = wallClock(new Date(at), tz);
  return `${two(w.hour)}:${two(w.minute)}`;
}

export const dayOf = (date: string) => `${date} ${DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;

export const namesOf = (ids: readonly string[], people: readonly Person[]) =>
  ids.flatMap((id) => people.find((p) => p.id === id)?.name ?? []);

// A person by the name the model heard: exact first, then a partial match.
export function findPerson(name: string, people: readonly Person[]): Person | null {
  const wanted = name.trim().toLowerCase();
  return (
    people.find((p) => p.name.toLowerCase() === wanted) ??
    people.find((p) => p.name.toLowerCase().includes(wanted) || wanted.includes(p.name.toLowerCase())) ??
    null
  );
}

export const has = (haystack: string | null | undefined, needle: string) =>
  !!haystack && haystack.toLowerCase().includes(needle.trim().toLowerCase());
