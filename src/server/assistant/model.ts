import { FunctionCallingConfigMode, type Content } from "@google/genai";
import { LIMITS } from "@/domain/assistant";
import { vertexGenerate, type Generate } from "../llm/gemini";
import { costUsd } from "../llm/pricing";
import { LlmError } from "../llm/types";

// One round with Cookie's model (intent 0007, spec §4.1): it reads the
// conversation so far and must call a tool. `answer` and `bark` are tools
// too, so every round ends in a function call the server can check.

export type ToolDeclaration = { name: string; description: string; parameters: Record<string, unknown> };

export type ModelCall = { id?: string; name: string; args: Record<string, unknown> };

export type RoundRequest = {
  system: string;
  tools: ToolDeclaration[];
  contents: Content[];
  // The only tools she may call this round: on her last round, the two
  // that end the question. The tool list itself stays the same.
  only?: string[];
};

export type RoundResult = {
  calls: ModelCall[];
  // The model's turn, to append to the conversation as is (it carries the
  // model's own bookkeeping for its tool calls).
  content: Content;
  model: string;
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export interface AssistantModel {
  round(request: RoundRequest): Promise<RoundResult>;
}

export const ASSISTANT_MODEL = () => process.env.ASSISTANT_MODEL ?? "gemini-3.8-flash";

// Gemini Flash on Vertex AI (plan SP-C2): tool calling forced, thinking
// off (the lowest setting; LIM-2).
export function geminiAssistant(generate?: Generate, model = ASSISTANT_MODEL()): AssistantModel {
  return {
    async round(req) {
      let response;
      try {
        // Made here, so Vertex AI not being set up is "can't answer right
        // now" like any other failure, not a crash.
        generate ??= vertexGenerate();
        response = await generate({
          model,
          contents: req.contents,
          config: {
            systemInstruction: req.system,
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.parameters,
                })),
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.ANY,
                ...(req.only ? { allowedFunctionNames: req.only } : {}),
              },
            },
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: LIMITS.outputTokens,
            // Someone is waiting: the SDK's default (5 attempts, backing
            // off for up to a minute) is far too patient (plan SP-C2).
            httpOptions: {
              timeout: LIMITS.roundTimeoutMs,
              retryOptions: { attempts: 2, initialDelay: 0.3, maxDelay: 1 },
            },
          },
        });
      } catch (err) {
        const status = (err as { status?: number }).status;
        throw new LlmError(
          status === 429 ? "quota" : "unavailable",
          status === 429 ? "Gemini is busy or over its quota." : "Gemini didn't answer.",
        );
      }
      const candidate = response.candidates?.[0];
      if (response.promptFeedback?.blockReason || !candidate?.content)
        throw new LlmError("refusal", "Gemini declined to answer.");
      const usage = response.usageMetadata;
      const input = usage?.promptTokenCount ?? 0;
      const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
      return {
        calls: (response.functionCalls ?? []).flatMap((c) =>
          c.name ? [{ id: c.id, name: c.name, args: c.args ?? {} }] : [],
        ),
        content: candidate.content,
        model,
        modelVersion: response.modelVersion ?? model,
        inputTokens: input,
        outputTokens: output,
        costUsd: costUsd(model, { input, output }),
      };
    },
  };
}

// A model that answers from a script: for tests, and for local development
// and end-to-end tests (ASSISTANT_LLM=fake). Requests are kept so tests can
// check what the model was sent.
export type AssistantScript = (request: RoundRequest, round: number) => ModelCall[];

export type ScriptedAssistant = AssistantModel & { requests: RoundRequest[] };

export function scriptedAssistant(script: AssistantScript): ScriptedAssistant {
  const requests: RoundRequest[] = [];
  return {
    requests,
    async round(request) {
      // A copy: the caller keeps adding to `contents`.
      requests.push({ ...request, contents: [...request.contents] });
      // The round within this question: one more than the tool calls so far.
      const round =
        request.contents.filter((c) => c.role === "model" && c.parts?.some((p) => p.functionCall)).length + 1;
      const calls = script(request, round);
      return {
        calls,
        content: {
          role: "model",
          parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
        },
        model: "assistant-scripted",
        modelVersion: "assistant-scripted",
        inputTokens: 1000,
        outputTokens: 50,
        costUsd: 0.001,
      };
    },
  };
}
