import { eq } from "drizzle-orm";
import { z } from "zod";
import { settings } from "@db/schema";
import { LIMITS } from "@/domain/assistant";
import type { DbOrTx } from "../db/client";

// Settings → Cookie (intent 0007, spec §4.3).

const KEY = "assistant";

export type AssistantSettings = {
  // LIM-5, in US dollars.
  monthlyCapUsd: number;
  // VOX-5
  speak: boolean;
  // TOOL-17. Off until the owner decides spec concern K-2.
  web: boolean;
  // CSEC-3: words that never go into a web search.
  privateTerms: string[];
};

export const assistantSettingsInput = z
  .object({
    monthlyCapUsd: z.number().min(0).max(200),
    speak: z.boolean(),
    web: z.boolean(),
    privateTerms: z.array(z.string().trim().min(1).max(60)).max(100),
  })
  .partial();

const defaultCap = () => {
  const n = Number(process.env.ASSISTANT_MONTHLY_CAP_USD);
  return process.env.ASSISTANT_MONTHLY_CAP_USD && Number.isFinite(n) && n >= 0 ? n : LIMITS.defaultCapUsd;
};

export async function getAssistantSettings(db: DbOrTx): Promise<AssistantSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return {
    monthlyCapUsd: defaultCap(),
    speak: true,
    web: false,
    privateTerms: [],
    ...((row?.value as Partial<AssistantSettings>) ?? {}),
  };
}

export async function saveAssistantSettings(db: DbOrTx, patch: Partial<AssistantSettings>) {
  const value = { ...(await getAssistantSettings(db)), ...patch };
  await db
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  return value;
}
