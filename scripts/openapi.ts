// Writes openapi.json (intent 0004, API-4): paths from the route registry,
// request bodies from their zod schemas, response bodies from the types in
// src/server/openapi/responses.ts, read with the TypeScript checker (so
// inferred and Drizzle-derived types come out exactly as the code sees them).
//
//   pnpm openapi          write openapi.json
//   pnpm openapi --check  fail if openapi.json is out of date (CI)

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";
import { operations } from "../src/server/openapi/registry";

type Schema = Record<string, unknown>;

const root = path.resolve(__dirname, "..");
const responsesFile = path.join(root, "src/server/openapi/responses.ts");
const outFile = path.join(root, "openapi.json");

// ---------- response types → JSON Schema ----------

function programFor(file: string) {
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  return ts.createProgram([file], { ...parsed.options, noEmit: true, incremental: false });
}

export function responseSchemas(): { exported: Map<string, Schema>; components: Record<string, Schema> } {
  const program = programFor(responsesFile);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(responsesFile);
  if (!source) throw new Error(`can't read ${responsesFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(source)!;

  const components: Record<string, Schema> = {};
  // Component name for each named type (by declaration), so two different
  // types that share a name get distinct components.
  const names = new Map<ts.Symbol, string>();
  const inProgress = new Set<string>();

  const isProjectDecl = (d: ts.Declaration) => {
    const f = d.getSourceFile().fileName;
    return !f.includes("/node_modules/") && f.startsWith(root);
  };

  const used = new Set<string>();
  function componentName(sym: ts.Symbol, preferred = sym.getName()): string {
    const known = names.get(sym);
    if (known) return known;
    let name = preferred;
    for (let i = 2; used.has(name); i++) name = `${preferred}${i}`;
    used.add(name);
    names.set(sym, name);
    return name;
  }

  // A named project type (alias without type arguments, or an interface)
  // becomes a shared component.
  function namedSymbol(type: ts.Type): ts.Symbol | null {
    const alias = type.aliasSymbol;
    if (alias && !type.aliasTypeArguments?.length && alias.declarations?.some(isProjectDecl)) return alias;
    const sym = type.getSymbol();
    if (
      sym &&
      type.isClassOrInterface() &&
      !(type as ts.InterfaceType).typeParameters?.length &&
      sym.declarations?.some(isProjectDecl)
    )
      return sym;
    return null;
  }

  function fail(where: string, what: string): never {
    throw new Error(`openapi: ${where}: ${what} can't be sent as JSON`);
  }

  function schemaOf(type: ts.Type, where: string, allowRef = true): Schema {
    const named = allowRef ? namedSymbol(type) : null;
    if (named) {
      const name = componentName(named);
      if (!components[name] && !inProgress.has(name)) {
        inProgress.add(name);
        components[name] = schemaOf(type, name, false);
        inProgress.delete(name);
      }
      return { $ref: `#/components/schemas/${name}` };
    }

    const f = type.flags;
    if (f & ts.TypeFlags.Any || f & ts.TypeFlags.Unknown) return {};
    if (f & ts.TypeFlags.StringLiteral)
      return { type: "string", const: (type as ts.StringLiteralType).value };
    if (f & ts.TypeFlags.NumberLiteral)
      return { type: "number", const: (type as ts.NumberLiteralType).value };
    if (f & ts.TypeFlags.BooleanLiteral)
      return { type: "boolean", const: checker.typeToString(type) === "true" };
    if (f & ts.TypeFlags.String || f & ts.TypeFlags.TemplateLiteral) return { type: "string" };
    if (f & ts.TypeFlags.Number) return { type: "number" };
    if (f & ts.TypeFlags.Boolean) return { type: "boolean" };
    if (f & ts.TypeFlags.Null) return { type: "null" };
    if (f & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) fail(where, "undefined");
    if (f & ts.TypeFlags.BigInt) fail(where, "bigint");

    if (type.isUnion()) return unionSchema(type.types, where);

    const symName = type.getSymbol()?.getName();
    if (symName === "Date") return { type: "string", format: "date-time" };
    if (symName === "Map" || symName === "Set" || symName === "WeakMap") fail(where, symName);
    if (type.getCallSignatures().length) fail(where, "a function");

    if (checker.isArrayType(type)) {
      const [item] = checker.getTypeArguments(type as ts.TypeReference);
      return { type: "array", items: schemaOf(item, `${where}[]`) };
    }
    if (checker.isTupleType(type)) {
      const items = checker
        .getTypeArguments(type as ts.TypeReference)
        .map((t, i) => schemaOf(t, `${where}[${i}]`));
      return { type: "array", prefixItems: items, minItems: items.length, maxItems: items.length };
    }

    // Objects (including intersections and mapped types like Pick/Omit).
    const properties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const prop of checker.getPropertiesOfType(type)) {
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      let propType = decl ? checker.getTypeOfSymbolAtLocation(prop, decl) : checker.getTypeOfSymbol(prop);
      let optional = !!(prop.flags & ts.SymbolFlags.Optional);
      if (propType.isUnion() && propType.types.some((t) => t.flags & ts.TypeFlags.Undefined)) {
        optional = true;
        const rest = propType.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
        if (!rest.length) continue;
        properties[prop.getName()] =
          rest.length === 1
            ? schemaOf(rest[0], `${where}.${prop.getName()}`)
            : unionSchema(rest, `${where}.${prop.getName()}`);
      } else {
        if (propType.flags & ts.TypeFlags.Undefined) continue;
        propType = propType as ts.Type;
        properties[prop.getName()] = schemaOf(propType, `${where}.${prop.getName()}`);
      }
      if (!optional) required.push(prop.getName());
    }
    const schema: Schema = { type: "object", properties };
    if (required.length) schema.required = required;
    const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
    if (index) schema.additionalProperties = schemaOf(index.type, `${where}[key]`);
    else if (!Object.keys(properties).length) schema.additionalProperties = true;
    return schema;
  }

  function unionSchema(members: readonly ts.Type[], where: string): Schema {
    const types = members.filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
    const hasNull = types.some((t) => t.flags & ts.TypeFlags.Null);
    const rest = types.filter((t) => !(t.flags & ts.TypeFlags.Null));
    // true | false
    const bools = rest.filter((t) => t.flags & ts.TypeFlags.BooleanLiteral);
    const others = rest.filter((t) => !(t.flags & ts.TypeFlags.BooleanLiteral));
    let schema: Schema;
    if (others.length && others.every((t) => t.flags & ts.TypeFlags.StringLiteral) && !bools.length) {
      schema = { type: "string", enum: others.map((t) => (t as ts.StringLiteralType).value) };
    } else if (!others.length && bools.length) {
      schema = bools.length === 2 ? { type: "boolean" } : schemaOf(bools[0], where);
    } else {
      const parts = [
        ...others.map((t) => schemaOf(t, where)),
        ...(bools.length === 2 ? [{ type: "boolean" }] : bools.map((t) => schemaOf(t, where))),
      ];
      schema = parts.length === 1 ? parts[0] : { anyOf: parts };
    }
    if (!hasNull) return schema;
    if (typeof schema.type === "string" && !schema.$ref) {
      const nullable: Schema = { ...schema, type: [schema.type, "null"] };
      if (Array.isArray(schema.enum)) nullable.enum = [...schema.enum, null];
      return nullable;
    }
    return { anyOf: [...((schema.anyOf as Schema[]) ?? [schema]), { type: "null" }] };
  }

  // Top-level types keep their exported names; claim them first.
  const tops: { name: string; type: ts.Type }[] = [];
  for (const sym of checker.getExportsOfModule(moduleSymbol)) {
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    if (!(target.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface))) continue;
    componentName(target, sym.getName());
    tops.push({ name: sym.getName(), type: checker.getDeclaredTypeOfSymbol(target) });
  }
  const exported = new Map<string, Schema>();
  for (const { name, type } of tops) {
    const schema = schemaOf(type, name);
    if (schema.$ref) exported.set(name, schema);
    else {
      components[name] = schema;
      exported.set(name, { $ref: `#/components/schemas/${name}` });
    }
  }
  return { exported, components };
}

// ---------- the document ----------

function jsonSchemaOf(schema: z.ZodType, io: "input" | "output" = "input"): Schema {
  const out = z.toJSONSchema(schema, { io, unrepresentable: "any", target: "draft-2020-12" }) as Schema;
  delete out.$schema;
  return out;
}

export function buildDocument(): Schema {
  const { exported, components } = responseSchemas();
  const refFor = (name: string): Schema => {
    const s = exported.get(name);
    if (!s) throw new Error(`openapi: response type ${name} isn't exported from responses.ts`);
    return s;
  };
  const paths: Record<string, Record<string, Schema>> = {};
  for (const op of operations) {
    const params: Schema[] = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    if (op.query) {
      const q = jsonSchemaOf(op.query) as { properties?: Record<string, Schema>; required?: string[] };
      for (const [name, schema] of Object.entries(q.properties ?? {}))
        params.push({ name, in: "query", required: !!q.required?.includes(name), schema });
    }
    const status = op.status ?? 200;
    const responses: Record<string, Schema> = {};
    if (op.binary) {
      responses["200"] = {
        description: "The whole file.",
        content: { [op.binary]: { schema: { type: "string", format: "binary" } } },
      };
      responses["206"] = {
        description: "The requested range.",
        content: { [op.binary]: { schema: { type: "string", format: "binary" } } },
      };
    } else if (op.response === null) {
      responses[String(status)] = { description: "Done." };
    } else {
      responses[String(status)] = {
        description: "OK",
        content: { "application/json": { schema: refFor(op.response) } },
      };
    }
    responses.default = {
      description: "An error, in words the app can show.",
      content: { "application/json": { schema: refFor("ErrorResponse") } },
    };
    const operation: Schema = {
      operationId: op.operationId,
      summary: op.summary,
      ...(op.spec && { description: `Spec: ${op.spec}` }),
      ...(params.length && { parameters: params }),
      ...(op.body && {
        requestBody: {
          required: !op.bodyOptional,
          content: { "application/json": { schema: jsonSchemaOf(op.body) } },
        },
      }),
      responses,
    };
    (paths[op.path] ??= {})[op.method.toLowerCase()] = operation;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Jayden Hub API",
      version: "1",
      description:
        "The /api/v1 JSON API behind jaydenguo.com and its iPhone app. Generated by `pnpm openapi`; do not edit.",
    },
    servers: [{ url: "https://jaydenguo.com" }],
    security: [{ session: [] }, { device: [] }],
    paths,
    components: {
      schemas: Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b))),
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "__session" },
        device: { type: "http", scheme: "bearer" },
      },
    },
  };
}

if (require.main === module) {
  const text = `${JSON.stringify(buildDocument(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(outFile, "utf8");
    } catch {}
    if (current !== text) {
      console.error("openapi.json is out of date: run `pnpm openapi` and commit the result.");
      process.exit(1);
    }
    console.log("openapi.json is up to date.");
  } else {
    writeFileSync(outFile, text);
    console.log(`wrote ${path.relative(process.cwd(), outFile)}`);
  }
}
