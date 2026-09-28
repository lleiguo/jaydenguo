import type { ReviewModel } from "../../domain/video-constants";
import type { Media, ModelRequest, ModelResult, StructuredModel } from "./types";

// A model that answers from a script instead of Vertex AI: for tests, and
// for local development and end-to-end tests of the video pages
// (VIDEO_LLM=fake). Every request is kept so tests can check what a model
// was sent (e.g. that judges never see model names).

export type Script = (request: ModelRequest<unknown>) => unknown;

export type ScriptedModel = StructuredModel & { requests: ModelRequest<unknown>[] };

export function scriptedModel(name: ReviewModel, input: Media["kind"], script: Script): ScriptedModel {
  const requests: ModelRequest<unknown>[] = [];
  return {
    name,
    input,
    requests,
    async call<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
      requests.push(request as ModelRequest<unknown>);
      const output = request.schema.parse(script(request as ModelRequest<unknown>));
      return {
        output,
        model: `${name}-scripted`,
        modelVersion: `${name}-scripted`,
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.01,
      };
    },
  };
}
