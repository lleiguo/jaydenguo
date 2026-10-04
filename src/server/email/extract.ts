import { z } from "zod";
import { CATEGORIES } from "../../domain/constants";
import type { EmailMessage } from "../../adapters/gmail";
import type { StructuredModel } from "../llm/types";

// Suggestions from coach and club emails (EML-2, plan M5.8): a model reads
// one allow-listed email and lists the new events, changes and
// cancellations it mentions, each with the fields it found, a short quote
// from the email and how sure it is of each field. It never writes to the
// calendar; the owner approves or rejects each suggestion (EML-3).

export const EMAIL_PROMPT_VERSION = "email-1";

const confidence = z.enum(["high", "medium", "low"]);

// Gemini doesn't keep to a length limit in the schema, so text that runs long
// is cut to fit instead of failing the whole email.
const clipped = (max: number) =>
  z
    .string()
    .describe(`at most ${max} characters`)
    .overwrite((s) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s));

export const suggestionSchema = z.object({
  kind: z.enum(["new", "change", "cancel"]),
  // For a change or cancellation: the upcoming event it's about, by its
  // label in the list the model was given (e.g. "E3"), or null.
  target: z.string().nullable(),
  title: clipped(200).pipe(z.string().min(1)),
  date: z.iso.date().nullable().describe("YYYY-MM-DD; for a change, the new date"),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .describe("HH:MM, 24-hour, local time; null for all day or unknown"),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  location: clipped(300).nullable(),
  category: z.enum(CATEGORIES),
  notes: clipped(500).nullable(),
  quote: clipped(400)
    .pipe(z.string().min(1))
    .describe("The sentence(s) from the email this comes from, word for word, at most 400 characters"),
  confidence: z.object({
    overall: confidence,
    title: confidence,
    date: confidence,
    time: confidence,
    location: confidence,
  }),
});
export type ExtractedSuggestion = z.infer<typeof suggestionSchema>;

export const extractionSchema = z.object({ suggestions: z.array(suggestionSchema).max(10) });

export type UpcomingEvent = { label: string; title: string; start: string; category: string };

export const EXTRACT_SYSTEM = `You read emails from a child's coaches, clubs and teams for a parent, and list the calendar changes they contain.
For each event the email announces, reschedules or cancels, give one suggestion:
- "new" for an event not in the list of upcoming events;
- "change" when an event in the list moves or changes place (set "target" to its label);
- "cancel" when an event in the list is cancelled (set "target" to its label).
Only use what the email says. Dates are local; resolve words like "next Saturday" from the email's sent date. If the email has nothing for the calendar (a newsletter, a receipt, a thank-you), return no suggestions.
Quote the email word for word for each suggestion. Mark a field "low" when you had to guess it, "medium" when it's implied, "high" when it's stated.`;

export function extractPrompt(email: EmailMessage, upcoming: UpcomingEvent[], homeTimeZone: string) {
  const list = upcoming.length
    ? upcoming.map((e) => `${e.label}: ${e.title} (${e.category}), ${e.start}`).join("\n")
    : "(none)";
  return `Time zone: ${homeTimeZone}
Email sent: ${email.receivedAt}
From: ${email.from}
Subject: ${email.subject}

Upcoming events on the calendar (next 60 days):
${list}

Email text:
"""
${email.text}
"""`;
}

export type Extractor = (
  email: EmailMessage,
  upcoming: UpcomingEvent[],
  homeTimeZone: string,
) => Promise<{ suggestions: ExtractedSuggestion[]; model: string; costUsd: number }>;

export function modelExtractor(model: StructuredModel): Extractor {
  return async (email, upcoming, tz) => {
    const result = await model.call({
      purpose: "email",
      system: EXTRACT_SYSTEM,
      prompt: extractPrompt(email, upcoming, tz),
      schema: extractionSchema,
    });
    return { suggestions: result.output.suggestions, model: result.modelVersion, costUsd: result.costUsd };
  };
}
