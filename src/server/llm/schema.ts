import { z } from "zod";
import { LlmError } from "./types";

// Turns a zod schema into the JSON schema both models accept for structured
// output. Their schema support is a subset: no numeric or length limits, and
// every object closed with every property required. The limits still apply,
// because the answer is parsed with the full zod schema afterwards.

const DROP = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "default",
]);

type Json = Record<string, unknown>;

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (DROP.has(key)) continue;
    out[key] = clean(value);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Json);
  }
  return out;
}

export function modelJsonSchema(schema: z.ZodType): Json {
  return clean(z.toJSONSchema(schema, { io: "output", unrepresentable: "any" })) as Json;
}

// Parses a model's JSON answer; a mismatch is an LlmError the caller may
// retry once.
export function parseAnswer<T>(schema: z.ZodType<T>, text: string, who: string): T {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LlmError("invalid_output", `${who} didn't answer in the expected format.`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new LlmError(
      "invalid_output",
      `${who}'s answer didn't match the expected format (${first?.path.join(".") || "root"}: ${first?.message}).`,
    );
  }
  return parsed.data;
}
