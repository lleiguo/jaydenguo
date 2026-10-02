import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { costUsd } from "./pricing";
import { modelJsonSchema, parseAnswer } from "./schema";
import { LlmError, type ModelRequest, type ModelResult, type StructuredModel } from "./types";

// Claude on Vertex AI (plan M5.4): reads coach and club emails into
// suggestions (EML-2). Text only.

export const CLAUDE_MODEL = () => process.env.CLAUDE_MODEL ?? "claude-opus-5";

type Client = Pick<AnthropicVertex, "messages">;
type CreateParams = Parameters<Client["messages"]["create"]>[0];
type Content = Extract<CreateParams["messages"][number]["content"], unknown[]>;

function vertexClient(): Client {
  const projectId = process.env.VERTEX_PROJECT;
  if (!projectId) throw new LlmError("unavailable", "Vertex AI isn't set up (VERTEX_PROJECT is missing).");
  return new AnthropicVertex({ projectId, region: process.env.CLAUDE_VERTEX_REGION ?? "global" });
}

export function claudeModel(client: Client = vertexClient(), model = CLAUDE_MODEL()): StructuredModel {
  return {
    name: "claude",
    async call<T>(req: ModelRequest<T>): Promise<ModelResult<T>> {
      const content: Content = [{ type: "text", text: req.prompt }];
      let response: Awaited<ReturnType<Client["messages"]["create"]>>;
      try {
        response = (await client.messages.create({
          model,
          max_tokens: 16_000,
          stream: false,
          thinking: { type: "adaptive" },
          output_config: {
            effort: "medium",
            format: { type: "json_schema", schema: modelJsonSchema(req.schema) },
          },
          system: req.system,
          messages: [{ role: "user", content }],
        })) as typeof response;
      } catch (err) {
        throw claudeError(err);
      }
      if (!("content" in response)) throw new LlmError("unavailable", "Claude on Vertex AI didn't answer.");
      if (response.stop_reason === "refusal") throw new LlmError("refusal", "Claude declined to answer.");
      if (response.stop_reason === "max_tokens")
        throw new LlmError("invalid_output", "Claude's answer was cut off before it finished.");
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const output = parseAnswer(req.schema, text, "Claude");
      const u = response.usage;
      const usage = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      };
      return {
        output,
        model,
        modelVersion: response.model ?? model,
        inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
        outputTokens: usage.output,
        costUsd: costUsd(model, usage),
      };
    },
  };
}

function claudeError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const status = (err as { status?: number }).status;
  if (status === 429)
    return new LlmError("quota", "Claude is over its quota on Vertex AI. Raise the Claude quota.");
  if (status === 404)
    return new LlmError("unavailable", "This Claude model isn't available in the Vertex AI project.");
  if (status === 400 || status === 413)
    return new LlmError("too_large", "The request was too large for Claude.");
  return new LlmError("unavailable", "Claude on Vertex AI didn't answer. Try again later.");
}
