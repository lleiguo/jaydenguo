import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

// intent 0004, API-4: every /api/v1 JSON response the e2e suite sees must
// match openapi.json, so the iPhone app's generated client can decode it.

type Doc = {
  paths: Record<
    string,
    Record<string, { responses: Record<string, { content?: Record<string, { schema: object }> }> }>
  >;
  components: object;
};

const doc = JSON.parse(readFileSync(path.resolve(__dirname, "../../../openapi.json"), "utf8")) as Doc;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

// Literal paths before templated ones (/videos/scoreboard before /videos/{id}).
const templates = Object.keys(doc.paths)
  .map((t) => ({
    t,
    re: new RegExp(`^${t.replace(/\{\w+\}/g, "[^/]+")}$`),
    params: (t.match(/\{/g) ?? []).length,
  }))
  .sort((a, b) => a.params - b.params);

const cache = new Map<string, ValidateFunction | null>();

function validatorFor(template: string, method: string, status: number): ValidateFunction | null {
  const key = `${method} ${template} ${status}`;
  if (cache.has(key)) return cache.get(key)!;
  const responses = doc.paths[template]?.[method]?.responses ?? {};
  const schema = (responses[String(status)] ?? (status >= 400 ? responses.default : undefined))?.content?.[
    "application/json"
  ]?.schema;
  const fn = schema ? ajv.compile({ ...schema, components: doc.components }) : null;
  cache.set(key, fn);
  return fn;
}

// Null when the body matches; otherwise a readable problem.
export function checkResponse(
  method: string,
  pathname: string,
  status: number,
  body: unknown,
): string | null {
  const m = method.toLowerCase();
  const match = templates.find((x) => x.re.test(pathname) && doc.paths[x.t][m]);
  if (!match) return `${method} ${pathname}: not in openapi.json`;
  const responses = doc.paths[match.t][m].responses;
  if (!responses[String(status)] && status < 400)
    return `${method} ${pathname}: status ${status} not in openapi.json`;
  const validate = validatorFor(match.t, m, status);
  if (!validate) return status === 204 ? null : `${method} ${pathname} ${status}: no JSON schema`;
  if (validate(body)) return null;
  const errors = (validate.errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath || "/"} ${e.message}`)
    .join("; ");
  return `${method} ${pathname} ${status}: ${errors}`;
}
