import { z } from "zod";
import { isValidTimeZone } from "../domain/time";

// PATCH /api/v1/settings: the home time zone (CAL-9) and home's address
// (intent 0027, TRF-R2); either may be left out.
export const settingsInput = z
  .object({
    homeTimeZone: z.string().refine(isValidTimeZone, "unknown time zone").optional(),
    homeAddress: z.string().max(300).optional(),
  })
  .refine((v) => v.homeTimeZone !== undefined || v.homeAddress !== undefined, "Nothing to change");
